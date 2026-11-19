import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildNfseIssuePayload,
  EmissionQueue,
} from '../../src/services/adaflow/emission-queue';
import { AdaflowClient } from '../../src/services/adaflow/client';
import {
  AdaflowRateLimitError,
  AdaflowTimeoutError,
} from '../../src/services/adaflow/errors';
import type { Payment } from '../../src/domain/payment';
import type { ServiceTemplate } from '../../src/domain/template';
import type { TakerProfile } from '../../src/domain/taker';
import type { NfseOperation } from '../../src/domain/nfse-operation';
import { createDatabase, type PingouNotaDB } from '../../src/storage/database';

describe('EmissionQueue & buildNfseIssuePayload', () => {
  let testDb: PingouNotaDB;

  const sampleTemplate: ServiceTemplate = {
    id: 'tpl-1',
    name: 'Consultoria TI',
    cnae: '6201501',
    description: 'Serviços prestados no mês de {{mes}} de {{ano}}.',
    withholdTaxes: false,
    forwardingEmail: 'contato@pingounota.com',
  };

  const sampleTaker: TakerProfile = {
    id: 'taker-1',
    name: 'Empresa Teste Ltda',
    document: '12345678000195',
    externalId: 'ext-taker-1',
    email: 'financeiro@empresa.com',
    address: {
      line1: 'Avenida Paulista',
      number: '1000',
      neighborhood: 'Bela Vista',
      city: 'São Paulo',
      state: 'SP',
      postalCode: '01310-100',
      country: 'BR',
    },
  };

  const sampleDomesticPayment: Payment = {
    provider: 'asaas',
    recordKey: 'pay_dom_1',
    sourcePaymentId: 'pay_123',
    identityConfidence: 'high',
    ambiguousIdentity: false,
    identityFingerprint: null,
    payerName: 'Empresa Teste Ltda',
    amountCents: 150000,
    currency: 'BRL',
    paymentDate: '2026-11-10',
    sourceStatus: 'RECEIVED',
    paymentState: 'recebido',
    declarationState: 'nao_declarado',
    lastObservedAt: '2026-11-10T10:00:00Z',
    manualDeclaredAt: null,
  };

  const sampleForeignPayment: Payment = {
    provider: 'husky',
    recordKey: 'pay_for_1',
    sourcePaymentId: 'pay_456',
    identityConfidence: 'high',
    ambiguousIdentity: false,
    identityFingerprint: null,
    payerName: 'Acme Corp USA',
    amountCents: 250000,
    currency: 'USD',
    paymentDate: '2026-11-15',
    sourceStatus: 'COMPLETED',
    paymentState: 'recebido',
    declarationState: 'nao_declarado',
    lastObservedAt: '2026-11-15T10:00:00Z',
    manualDeclaredAt: null,
  };

  beforeEach(async () => {
    testDb = createDatabase(`test_queue_${crypto.randomUUID()}`);
    await testDb.open();
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (testDb) {
      await testDb.delete();
    }
  });

  describe('Step 1: buildNfseIssuePayload', () => {
    it('builds domestic BRL payload with value_cents and no foreign fields', () => {
      const payload = buildNfseIssuePayload(
        sampleDomesticPayment,
        sampleTemplate,
        sampleTaker,
      );

      expect(payload.value_cents).toBe(150000);
      expect(payload.foreign_value_cents).toBeUndefined();
      expect(payload.foreign_value_currency).toBeUndefined();
      expect(payload.cnae).toBe('6201501');
      expect(payload.description).toBe('Serviços prestados no mês de novembro de 2026.');
      expect(payload.withhold_taxes).toBe(false);
      expect(payload.forwarding_email).toBe('contato@pingounota.com');
      expect(payload.external_id).toBe('asaas_pay_dom_1');
      expect(payload.service_taker.name).toBe('Empresa Teste Ltda');
      expect(payload.service_taker.document).toBe('12345678000195');
    });

    it('builds foreign payload with foreign_value_cents and foreign_value_currency and no value_cents', () => {
      const payload = buildNfseIssuePayload(
        sampleForeignPayment,
        sampleTemplate,
        sampleTaker,
      );

      expect(payload.foreign_value_cents).toBe(250000);
      expect(payload.foreign_value_currency).toBe('USD');
      expect(payload.value_cents).toBeUndefined();
      expect(payload.external_id).toBe('husky_pay_for_1');
    });

    it('supports custom description override', () => {
      const payload = buildNfseIssuePayload(
        sampleDomesticPayment,
        sampleTemplate,
        sampleTaker,
        'Descrição personalizada pelo usuário',
      );

      expect(payload.description).toBe('Descrição personalizada pelo usuário');
    });

    it('supports custom externalIdOverride and options', () => {
      const payload = buildNfseIssuePayload(
        sampleDomesticPayment,
        sampleTemplate,
        sampleTaker,
        undefined,
        'custom_ext_id_999',
        {
          withholdTaxes: true,
          forwardingEmail: 'override@email.com',
        },
      );

      expect(payload.external_id).toBe('custom_ext_id_999');
      expect(payload.withhold_taxes).toBe(true);
      expect(payload.forwarding_email).toBe('override@email.com');
    });

    it('throws on unsupported currency', () => {
      const unsupportedPayment: Payment = {
        ...sampleDomesticPayment,
        currency: 'JPY',
      };

      expect(() => {
        buildNfseIssuePayload(unsupportedPayment, sampleTemplate, sampleTaker);
      }).toThrow(/Moeda não suportada/);
    });
  });

  describe('EmissionQueue Rate Limit & Sequential Pacing', () => {
    it('enforces minimum 13 seconds gap between consecutive POST requests', async () => {
      vi.useFakeTimers({
        toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
      });

      await testDb.payments.put({ ...sampleDomesticPayment, recordKey: 'pay_1' });
      await testDb.payments.put({ ...sampleDomesticPayment, recordKey: 'pay_2' });

      const op1: NfseOperation = {
        id: 'op-1',
        provider: 'asaas',
        paymentRecordKey: 'pay_1',
        externalId: 'ext_1',
        idempotencyKey: 'idem_1',
        payloadJson: JSON.stringify(
          buildNfseIssuePayload(sampleDomesticPayment, sampleTemplate, sampleTaker),
        ),
        adaflowNfseId: null,
        status: 'queued',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const op2: NfseOperation = {
        id: 'op-2',
        provider: 'asaas',
        paymentRecordKey: 'pay_2',
        externalId: 'ext_2',
        idempotencyKey: 'idem_2',
        payloadJson: JSON.stringify(
          buildNfseIssuePayload(sampleDomesticPayment, sampleTemplate, sampleTaker),
        ),
        adaflowNfseId: null,
        status: 'queued',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await testDb.nfseOperations.put(op1);
      await testDb.nfseOperations.put(op2);

      const callTimestamps: number[] = [];
      const mockClient = {
        createNfse: vi.fn().mockImplementation(async () => {
          callTimestamps.push(Date.now());
          return { id: 100 + callTimestamps.length, status: 'requested' };
        }),
        getNfse: vi.fn().mockResolvedValue({ id: 101, status: 'requested' }),
      } as unknown as AdaflowClient;

      const sleepSpy = vi.fn((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

      const queue = new EmissionQueue({
        dbInstance: testDb,
        client: mockClient,
        getAdaflowTokenFn: async () => 'test-token',
        minGapMs: 13000,
        sleepFn: sleepSpy,
      });

      const processPromise = queue.processQueue(['op-1', 'op-2']);

      // Advance timers until op-1 completes and op-2 enters sleep
      while (sleepSpy.mock.calls.length === 0) {
        await vi.advanceTimersByTimeAsync(50);
      }
      expect(mockClient.createNfse).toHaveBeenCalledTimes(1);

      // Now op-2 should hit enforcePacing and call sleepFn to wait remaining time up to 13s
      expect(sleepSpy).toHaveBeenCalledWith(expect.any(Number));
      const requestedSleepMs = sleepSpy.mock.calls[0]![0];
      expect(requestedSleepMs).toBeGreaterThan(0);
      expect(requestedSleepMs).toBeLessThanOrEqual(13000);

      // Advance by slightly less than the sleep time: op-2 still waiting
      await vi.advanceTimersByTimeAsync(requestedSleepMs - 1000);
      expect(mockClient.createNfse).toHaveBeenCalledTimes(1);

      // Advance remaining time + margin
      await vi.advanceTimersByTimeAsync(1500);
      expect(mockClient.createNfse).toHaveBeenCalledTimes(2);

      await processPromise;

      expect(callTimestamps).toHaveLength(2);
      expect(callTimestamps[1]! - callTimestamps[0]!).toBeGreaterThanOrEqual(13000);

      // Both operations should now be in 'requested' status
      const updatedOp1 = await testDb.nfseOperations.get('op-1');
      const updatedOp2 = await testDb.nfseOperations.get('op-2');
      expect(updatedOp1?.status).toBe('requested');
      expect(updatedOp2?.status).toBe('requested');
    });

    it('pauses on 429 AdaflowRateLimitError and resumes after retryAfter seconds', async () => {
      vi.useFakeTimers({
        toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
      });

      await testDb.payments.put(sampleDomesticPayment);

      const op: NfseOperation = {
        id: 'op-rate-limit',
        provider: 'asaas',
        paymentRecordKey: sampleDomesticPayment.recordKey,
        externalId: 'ext_rl',
        idempotencyKey: 'idem_rl',
        payloadJson: JSON.stringify(
          buildNfseIssuePayload(sampleDomesticPayment, sampleTemplate, sampleTaker),
        ),
        adaflowNfseId: null,
        status: 'queued',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await testDb.nfseOperations.put(op);

      let attempts = 0;
      const mockClient = {
        createNfse: vi.fn().mockImplementation(async () => {
          attempts++;
          if (attempts === 1) {
            throw new AdaflowRateLimitError('Rate limit exceeded', 60);
          }
          return { id: 888, status: 'requested' };
        }),
        getNfse: vi.fn().mockResolvedValue({ id: 888, status: 'requested' }),
      } as unknown as AdaflowClient;

      const queue = new EmissionQueue({
        dbInstance: testDb,
        client: mockClient,
        getAdaflowTokenFn: async () => 'test-token',
        minGapMs: 13000,
      });

      const processPromise = queue.processQueue(['op-rate-limit']);

      // First attempt triggers at t = 0 and throws 429 with 60s pause
      await vi.advanceTimersByTimeAsync(0);
      expect(mockClient.createNfse).toHaveBeenCalledTimes(1);

      // Advance 30s: still paused
      await vi.advanceTimersByTimeAsync(30000);
      expect(mockClient.createNfse).toHaveBeenCalledTimes(1);

      // Advance remaining 30s + pacing
      await vi.advanceTimersByTimeAsync(31000);
      expect(mockClient.createNfse).toHaveBeenCalledTimes(2);

      await processPromise;

      const updated = await testDb.nfseOperations.get('op-rate-limit');
      expect(updated?.status).toBe('requested');
      expect(updated?.adaflowNfseId).toBe(888);
    });

    it('preserves idempotency key across retries on timeout/network error', async () => {
      vi.useFakeTimers({
        toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
      });

      await testDb.payments.put(sampleDomesticPayment);

      const fixedIdempotencyKey = 'fixed-unique-key-xyz-789';
      const op: NfseOperation = {
        id: 'op-retry-idempotency',
        provider: 'asaas',
        paymentRecordKey: sampleDomesticPayment.recordKey,
        externalId: 'ext_retry',
        idempotencyKey: fixedIdempotencyKey,
        payloadJson: JSON.stringify(
          buildNfseIssuePayload(sampleDomesticPayment, sampleTemplate, sampleTaker),
        ),
        adaflowNfseId: null,
        status: 'queued',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await testDb.nfseOperations.put(op);

      let attempts = 0;
      const usedIdempotencyKeys: string[] = [];

      const mockClient = {
        createNfse: vi.fn().mockImplementation(async (_payload, key) => {
          attempts++;
          usedIdempotencyKeys.push(key);
          if (attempts === 1) {
            throw new AdaflowTimeoutError('Tempo esgotado');
          }
          return { id: 999, status: 'requested' };
        }),
        getNfse: vi.fn().mockResolvedValue({ id: 999, status: 'requested' }),
      } as unknown as AdaflowClient;

      const queue = new EmissionQueue({
        dbInstance: testDb,
        client: mockClient,
        getAdaflowTokenFn: async () => 'test-token',
        minGapMs: 100, // short gap for this test
      });

      const processPromise = queue.processQueue(['op-retry-idempotency']);

      // Trigger first attempt (throws timeout)
      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toBe(1);

      // Advance retry delay and pacing
      await vi.advanceTimersByTimeAsync(2000);
      expect(attempts).toBe(2);

      await processPromise;

      // Both attempts must use the exact same idempotencyKey
      expect(usedIdempotencyKeys).toHaveLength(2);
      expect(usedIdempotencyKeys[0]).toBe(fixedIdempotencyKey);
      expect(usedIdempotencyKeys[1]).toBe(fixedIdempotencyKey);

      const updated = await testDb.nfseOperations.get('op-retry-idempotency');
      expect(updated?.status).toBe('requested');
      expect(updated?.adaflowNfseId).toBe(999);
    });

    it('marks operation failed when Adaflow token is not configured', async () => {
      await testDb.payments.put(sampleDomesticPayment);

      const op: NfseOperation = {
        id: 'op-no-token',
        provider: 'asaas',
        paymentRecordKey: sampleDomesticPayment.recordKey,
        externalId: 'ext_no_tok',
        idempotencyKey: 'idem_no_tok',
        payloadJson: JSON.stringify(
          buildNfseIssuePayload(sampleDomesticPayment, sampleTemplate, sampleTaker),
        ),
        adaflowNfseId: null,
        status: 'queued',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await testDb.nfseOperations.put(op);

      const queue = new EmissionQueue({
        dbInstance: testDb,
        getAdaflowTokenFn: async () => null, // No token
      });

      await queue.processQueue(['op-no-token']);

      const updatedOp = await testDb.nfseOperations.get('op-no-token');
      expect(updatedOp?.status).toBe('failed');
      expect(updatedOp?.errorMessage).toContain('Token Adaflow não configurado');

      const updatedPayment = await testDb.payments.get([
        sampleDomesticPayment.provider,
        sampleDomesticPayment.recordKey,
      ]);
      expect(updatedPayment?.declarationState).toBe('falha_adaflow');
    });
  });

  describe('Polling & Status Transitions', () => {
    it('transitions requested operations to issued and updates payment state', async () => {
      await testDb.payments.put({
        ...sampleDomesticPayment,
        declarationState: 'emissao_solicitada',
      });

      const op: NfseOperation = {
        id: 'op-poll-issued',
        provider: 'asaas',
        paymentRecordKey: sampleDomesticPayment.recordKey,
        externalId: 'ext_issued',
        idempotencyKey: 'idem_issued',
        payloadJson: '{}',
        adaflowNfseId: 1001,
        status: 'requested',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await testDb.nfseOperations.put(op);

      const mockClient = {
        createNfse: vi.fn(),
        getNfse: vi.fn().mockResolvedValue({
          id: 1001,
          status: 'issued',
          number: '2026001',
        }),
      } as unknown as AdaflowClient;

      const queue = new EmissionQueue({
        dbInstance: testDb,
        client: mockClient,
        getAdaflowTokenFn: async () => 'test-token',
      });

      await queue.pollOperations();

      const updatedOp = await testDb.nfseOperations.get('op-poll-issued');
      expect(updatedOp?.status).toBe('issued');

      const updatedPayment = await testDb.payments.get([
        sampleDomesticPayment.provider,
        sampleDomesticPayment.recordKey,
      ]);
      expect(updatedPayment?.declarationState).toBe('emitida_adaflow');
    });

    it('transitions requested operations to failed on error response and updates payment state', async () => {
      await testDb.payments.put({
        ...sampleDomesticPayment,
        declarationState: 'emissao_solicitada',
      });

      const op: NfseOperation = {
        id: 'op-poll-failed',
        provider: 'asaas',
        paymentRecordKey: sampleDomesticPayment.recordKey,
        externalId: 'ext_fail',
        idempotencyKey: 'idem_fail',
        payloadJson: '{}',
        adaflowNfseId: 1002,
        status: 'requested',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await testDb.nfseOperations.put(op);

      const mockClient = {
        createNfse: vi.fn(),
        getNfse: vi.fn().mockResolvedValue({
          id: 1002,
          status: 'failed',
          error_message: 'Inscrição Municipal inválida na Prefeitura',
        }),
      } as unknown as AdaflowClient;

      const queue = new EmissionQueue({
        dbInstance: testDb,
        client: mockClient,
        getAdaflowTokenFn: async () => 'test-token',
      });

      await queue.pollOperations();

      const updatedOp = await testDb.nfseOperations.get('op-poll-failed');
      expect(updatedOp?.status).toBe('failed');
      expect(updatedOp?.errorMessage).toBe('Inscrição Municipal inválida na Prefeitura');

      const updatedPayment = await testDb.payments.get([
        sampleDomesticPayment.provider,
        sampleDomesticPayment.recordKey,
      ]);
      expect(updatedPayment?.declarationState).toBe('falha_adaflow');
    });

    it('marks operation failed and stops polling if requested for > 15 minutes', async () => {
      await testDb.payments.put({
        ...sampleDomesticPayment,
        declarationState: 'emissao_solicitada',
      });

      // Created 16 minutes ago
      const sixteenMinutesAgo = new Date(Date.now() - 16 * 60 * 1000).toISOString();
      const op: NfseOperation = {
        id: 'op-timeout-15m',
        provider: 'asaas',
        paymentRecordKey: sampleDomesticPayment.recordKey,
        externalId: 'ext_t15',
        idempotencyKey: 'idem_t15',
        payloadJson: '{}',
        adaflowNfseId: 2001,
        status: 'requested',
        createdAt: sixteenMinutesAgo,
        updatedAt: sixteenMinutesAgo,
      };
      await testDb.nfseOperations.put(op);

      const mockClient = {
        createNfse: vi.fn(),
        getNfse: vi.fn(),
      } as unknown as AdaflowClient;

      const queue = new EmissionQueue({
        dbInstance: testDb,
        client: mockClient,
        getAdaflowTokenFn: async () => 'test-token',
        pollTimeoutMs: 15 * 60 * 1000,
      });

      await queue.pollOperations();

      // client.getNfse should NOT be called because it timed out
      expect(mockClient.getNfse).not.toHaveBeenCalled();

      const updatedOp = await testDb.nfseOperations.get('op-timeout-15m');
      expect(updatedOp?.status).toBe('failed');
      expect(updatedOp?.errorMessage).toContain('15 minutos');

      const updatedPayment = await testDb.payments.get([
        sampleDomesticPayment.provider,
        sampleDomesticPayment.recordKey,
      ]);
      expect(updatedPayment?.declarationState).toBe('falha_adaflow');
    });
  });
});
