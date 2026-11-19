import type { Payment } from '../../domain/payment';
import type { ServiceTemplate } from '../../domain/template';
import {
  type NfseIssuePayload,
  type NfseOperation,
  SUPPORTED_FOREIGN_CURRENCIES,
  nfseIssuePayloadSchema,
} from '../../domain/nfse-operation';
import type { TakerProfile } from '../../domain/taker';
import { renderTemplateDescription } from '../templates';
import { takerProfileToAdaflowTaker } from '../takers';
import { AdaflowClient } from './client';
import {
  AdaflowAuthError,
  AdaflowRateLimitError,
  AdaflowTimeoutError,
} from './errors';
import { getAdaflowToken } from './settings';
import { db, type PingouNotaDB } from '../../storage/database';
import type { ExtensionMessage } from '../../shared/messages';

/**
 * Builds and validates an NFSe issue payload based on payment, template, and taker profile.
 */
export function buildNfseIssuePayload(
  payment: Payment,
  template: ServiceTemplate,
  taker: TakerProfile,
  descriptionOverride?: string,
  externalIdOverride?: string,
  options?: {
    withholdTaxes?: boolean;
    forwardingEmail?: string;
  },
): NfseIssuePayload {
  const description =
    descriptionOverride !== undefined && descriptionOverride !== null
      ? descriptionOverride
      : renderTemplateDescription(template.description, payment.paymentDate);

  const rawCurrency = (payment.currency || 'BRL').trim().toUpperCase();
  const supportedForeign = SUPPORTED_FOREIGN_CURRENCIES;

  let value_cents: number | undefined;
  let foreign_value_cents: number | undefined;
  let foreign_value_currency: (typeof supportedForeign)[number] | undefined;

  if (rawCurrency === 'BRL') {
    value_cents = payment.amountCents ?? undefined;
  } else if ((supportedForeign as readonly string[]).includes(rawCurrency)) {
    foreign_value_cents = payment.amountCents ?? undefined;
    foreign_value_currency = rawCurrency as (typeof supportedForeign)[number];
  } else {
    throw new Error(`Moeda não suportada para emissão: ${payment.currency}`);
  }

  // Exactly one of value_cents or foreign_value_cents must be set
  if (value_cents !== undefined && foreign_value_cents !== undefined) {
    throw new Error('Apenas um entre value_cents ou foreign_value_cents deve ser fornecido');
  }

  const externalId =
    externalIdOverride || `${payment.provider}_${payment.recordKey}`;

  const withholdTaxes =
    options?.withholdTaxes !== undefined
      ? options.withholdTaxes
      : Boolean(template.withholdTaxes);

  const forwardingEmail =
    options?.forwardingEmail !== undefined
      ? options.forwardingEmail.trim() || undefined
      : template.forwardingEmail?.trim() || undefined;

  const payload: NfseIssuePayload = {
    cnae: template.cnae,
    description,
    withhold_taxes: withholdTaxes,
    forwarding_email: forwardingEmail,
    external_id: externalId,
    service_taker: takerProfileToAdaflowTaker(taker),
  };

  if (value_cents !== undefined) {
    payload.value_cents = value_cents;
  }
  if (foreign_value_cents !== undefined) {
    payload.foreign_value_cents = foreign_value_cents;
    payload.foreign_value_currency = foreign_value_currency;
  }

  return nfseIssuePayloadSchema.parse(payload);
}

export interface EmissionQueueConfig {
  dbInstance?: PingouNotaDB;
  client?: AdaflowClient;
  clientFactory?: (token: string) => AdaflowClient;
  sleepFn?: (ms: number) => Promise<void>;
  nowFn?: () => number;
  getAdaflowTokenFn?: () => Promise<string | null>;
  broadcastFn?: (message: ExtensionMessage) => Promise<void> | void;
  minGapMs?: number;
  maxPerMinute?: number;
  rollingWindowMs?: number;
  maxNetworkRetries?: number;
  pollTimeoutMs?: number;
}

export class EmissionQueue {
  private readonly db: PingouNotaDB;
  private readonly client?: AdaflowClient;
  private readonly clientFactory?: (token: string) => AdaflowClient;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly nowFn: () => number;
  private readonly getAdaflowTokenFn: () => Promise<string | null>;
  private readonly broadcastFn?: (message: ExtensionMessage) => Promise<void> | void;
  private readonly minGapMs: number;
  private readonly maxPerMinute: number;
  private readonly rollingWindowMs: number;
  private readonly maxNetworkRetries: number;
  private readonly pollTimeoutMs: number;

  private isProcessing = false;
  private lastPostTime = 0;
  private postTimestamps: number[] = [];
  private pausedUntil = 0;
  private pollingTimer?: ReturnType<typeof setInterval>;

  constructor(config: EmissionQueueConfig = {}) {
    this.db = config.dbInstance ?? db;
    this.client = config.client;
    this.clientFactory = config.clientFactory;
    this.sleepFn = config.sleepFn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.nowFn = config.nowFn ?? (() => Date.now());
    this.getAdaflowTokenFn = config.getAdaflowTokenFn ?? getAdaflowToken;
    this.broadcastFn = config.broadcastFn;
    this.minGapMs = config.minGapMs ?? 13000; // 13 seconds minimum gap
    this.maxPerMinute = config.maxPerMinute ?? 5; // max 5 POSTs per rolling minute
    this.rollingWindowMs = config.rollingWindowMs ?? 60000;
    this.maxNetworkRetries = config.maxNetworkRetries ?? 3;
    this.pollTimeoutMs = config.pollTimeoutMs ?? 15 * 60 * 1000; // 15 minutes
  }

  public resetPacing(): void {
    this.lastPostTime = 0;
    this.postTimestamps = [];
    this.pausedUntil = 0;
  }

  private async enforcePacing(): Promise<void> {
    while (true) {
      const now = this.nowFn();

      // Check if paused due to 429
      if (this.pausedUntil > now) {
        const waitMs = this.pausedUntil - now;
        await this.sleepFn(waitMs);
        continue;
      }

      // Filter rolling window
      this.postTimestamps = this.postTimestamps.filter(
        (ts) => now - ts < this.rollingWindowMs,
      );

      if (this.postTimestamps.length >= this.maxPerMinute) {
        const oldest = this.postTimestamps[0]!;
        const waitMs = this.rollingWindowMs - (now - oldest) + 50;
        if (waitMs > 0) {
          await this.sleepFn(waitMs);
          continue;
        }
      }

      // Check sequential gap
      if (this.lastPostTime > 0) {
        const elapsed = now - this.lastPostTime;
        if (elapsed < this.minGapMs) {
          const waitMs = this.minGapMs - elapsed;
          await this.sleepFn(waitMs);
          continue;
        }
      }

      break;
    }
  }

  private recordPost(timestamp: number): void {
    this.lastPostTime = timestamp;
    this.postTimestamps.push(timestamp);
  }

  private async broadcastProgress(operationIds: string[]): Promise<void> {
    try {
      if (this.broadcastFn) {
        await this.broadcastFn({ type: 'ISSUE_QUEUE_PROGRESS', operationIds });
        return;
      }
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: 'ISSUE_QUEUE_PROGRESS', operationIds });
      }
    } catch {
      // Ignore errors when no listeners are registered
    }
  }

  /**
   * Process queued emission operations sequentially with pacing and retries.
   */
  public async processQueue(operationIds?: string[]): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    try {
      let ops: NfseOperation[];

      if (operationIds && operationIds.length > 0) {
        const loaded = await Promise.all(
          operationIds.map((id) => this.db.nfseOperations.get(id)),
        );
        ops = loaded.filter(
          (op): op is NfseOperation => Boolean(op && op.status === 'queued'),
        );
      } else {
        ops = await this.db.nfseOperations
          .where('status')
          .equals('queued')
          .sortBy('createdAt');
      }

      if (ops.length === 0) {
        return;
      }

      const token = await this.getAdaflowTokenFn();
      if (!token) {
        const now = new Date().toISOString();
        for (const op of ops) {
          await this.db.nfseOperations.update(op.id, {
            status: 'failed',
            errorMessage: 'Token Adaflow não configurado',
            updatedAt: now,
          });
          await this.db.payments.update([op.provider, op.paymentRecordKey], {
            declarationState: 'falha_adaflow',
          });
        }
        await this.broadcastProgress(ops.map((o) => o.id));
        return;
      }

      const client =
        this.client ??
        (this.clientFactory
          ? this.clientFactory(token)
          : new AdaflowClient({ token }));

      for (const op of ops) {
        // Re-check status from DB in case it changed
        const fresh = await this.db.nfseOperations.get(op.id);
        if (!fresh || fresh.status !== 'queued') {
          continue;
        }

        let retries = 0;
        let done = false;

        while (!done && retries <= this.maxNetworkRetries) {
          await this.enforcePacing();

          const now = this.nowFn();
          this.recordPost(now);

          const payload: NfseIssuePayload = JSON.parse(op.payloadJson);

          try {
            const res = await client.createNfse(payload, op.idempotencyKey);
            await this.db.nfseOperations.update(op.id, {
              adaflowNfseId: res.id,
              status: 'requested',
              updatedAt: new Date().toISOString(),
              errorMessage: null,
            });
            await this.db.payments.update([op.provider, op.paymentRecordKey], {
              declarationState: 'emissao_solicitada',
              linkedNfseOperationId: op.id,
            });
            await this.broadcastProgress([op.id]);
            done = true;
          } catch (error) {
            if (error instanceof AdaflowRateLimitError) {
              const retryAfter = error.retryAfter ?? 60;
              this.pausedUntil = this.nowFn() + retryAfter * 1000;
              await this.sleepFn(retryAfter * 1000);
              // Retry the same operation
              continue;
            } else if (
              error instanceof AdaflowTimeoutError ||
              (error instanceof Error && error.name === 'TypeError') ||
              (error instanceof Error &&
                error.message.toLowerCase().includes('network')) ||
              (error instanceof Error &&
                error.message.toLowerCase().includes('fetch'))
            ) {
              retries++;
              if (retries > this.maxNetworkRetries) {
                const msg =
                  error instanceof Error
                    ? error.message
                    : 'Tempo limite ou erro de rede';
                await this.db.nfseOperations.update(op.id, {
                  status: 'failed',
                  errorMessage: msg,
                  updatedAt: new Date().toISOString(),
                });
                await this.db.payments.update(
                  [op.provider, op.paymentRecordKey],
                  {
                    declarationState: 'falha_adaflow',
                  },
                );
                await this.broadcastProgress([op.id]);
                done = true;
              } else {
                // Short wait before retrying with identical payload and same idempotencyKey
                await this.sleepFn(1000);
              }
            } else if (error instanceof AdaflowAuthError) {
              await this.db.nfseOperations.update(op.id, {
                status: 'failed',
                errorMessage: 'Token Adaflow não configurado ou inválido',
                updatedAt: new Date().toISOString(),
              });
              await this.db.payments.update(
                [op.provider, op.paymentRecordKey],
                {
                  declarationState: 'falha_adaflow',
                },
              );
              await this.broadcastProgress([op.id]);
              done = true;
            } else {
              const msg =
                error instanceof Error
                  ? error.message
                  : 'Erro na emissão da NFSe';
              await this.db.nfseOperations.update(op.id, {
                status: 'failed',
                errorMessage: msg,
                updatedAt: new Date().toISOString(),
              });
              await this.db.payments.update(
                [op.provider, op.paymentRecordKey],
                {
                  declarationState: 'falha_adaflow',
                },
              );
              await this.broadcastProgress([op.id]);
              done = true;
            }
          }
        }
      }

      // After submitting, poll accepted operations
      await this.pollOperations();
      this.startPolling();
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Polls all operations currently in 'requested' state to check if they completed, failed, or timed out.
   */
  public async pollOperations(): Promise<void> {
    const requestedOps = await this.db.nfseOperations
      .where('status')
      .equals('requested')
      .toArray();

    if (requestedOps.length === 0) {
      this.stopPolling();
      return;
    }

    const token = await this.getAdaflowTokenFn();
    if (!token) return;

    const client =
      this.client ??
      (this.clientFactory
        ? this.clientFactory(token)
        : new AdaflowClient({ token }));

    const now = this.nowFn();

    for (const op of requestedOps) {
      const createdAtMs = new Date(op.createdAt).getTime();
      const elapsedMs = now - createdAtMs;

      // > 15 minutes timeout handling
      if (elapsedMs > this.pollTimeoutMs) {
        await this.db.nfseOperations.update(op.id, {
          status: 'failed',
          errorMessage: 'Tempo limite de emissão excedido (> 15 minutos)',
          updatedAt: new Date().toISOString(),
        });
        await this.db.payments.update([op.provider, op.paymentRecordKey], {
          declarationState: 'falha_adaflow',
        });
        await this.broadcastProgress([op.id]);
        continue;
      }

      if (op.adaflowNfseId == null) {
        continue;
      }

      try {
        const response = await client.getNfse(op.adaflowNfseId);
        const rawStatus = (
          response.status ||
          (response.nfse as any)?.status ||
          ''
        )
          .toLowerCase()
          .trim();

        if (['issued', 'emitted', 'autorizada', 'concluida'].includes(rawStatus)) {
          await this.db.nfseOperations.update(op.id, {
            status: 'issued',
            updatedAt: new Date().toISOString(),
          });
          await this.db.payments.update([op.provider, op.paymentRecordKey], {
            declarationState: 'emitida_adaflow',
          });
          await this.broadcastProgress([op.id]);
        } else if (
          ['failed', 'error', 'rejeitada', 'falha'].includes(rawStatus)
        ) {
          const errMsg =
            response.error_message ||
            (response.nfse as any)?.error_message ||
            'Emissão rejeitada pela Adaflow';
          await this.db.nfseOperations.update(op.id, {
            status: 'failed',
            errorMessage: errMsg,
            updatedAt: new Date().toISOString(),
          });
          await this.db.payments.update([op.provider, op.paymentRecordKey], {
            declarationState: 'falha_adaflow',
          });
          await this.broadcastProgress([op.id]);
        } else if (['cancelled', 'cancelada'].includes(rawStatus)) {
          await this.db.nfseOperations.update(op.id, {
            status: 'cancelled',
            updatedAt: new Date().toISOString(),
          });
          await this.db.payments.update([op.provider, op.paymentRecordKey], {
            declarationState: 'cancelada_adaflow',
          });
          await this.broadcastProgress([op.id]);
        }
      } catch (err) {
        console.warn(
          `[PingouNota] Erro ao consultar NFSe ${op.adaflowNfseId}:`,
          err,
        );
      }
    }
  }

  public startPolling(intervalMs = 20000): void {
    if (this.pollingTimer != null) return;
    this.pollingTimer = setInterval(async () => {
      try {
        const pending = await this.db.nfseOperations
          .where('status')
          .equals('requested')
          .count();
        if (pending === 0) {
          this.stopPolling();
          return;
        }
        await this.pollOperations();
      } catch {
        // Ignore polling errors
      }
    }, intervalMs);
  }

  public stopPolling(): void {
    if (this.pollingTimer != null) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = undefined;
    }
  }
}

export const emissionQueue = new EmissionQueue();
