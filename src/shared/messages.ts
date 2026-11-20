import { z } from 'zod';
import type { PaymentProvider } from '../domain/payment';
import type { ParseResult } from './observed-payment';
import type { AdaflowImportedTaker, AdaflowImportedTemplate } from '../services/adaflow-scraper';
import {
  ADAFLOW_SYNC_STATE_STORAGE_KEY,
  type AdaflowSyncState,
} from '../services/adaflow-reconciliation';

export { ADAFLOW_SYNC_STATE_STORAGE_KEY, type AdaflowSyncState };

export interface ScanProgress {
  scanId: string;
  provider: PaymentProvider;
  status: 'idle' | 'scanning' | 'partial' | 'complete' | 'paused' | 'failed';
  pagesSeen: number;
  recordsFound: number;
  reason: string | null;
  restoreStatus?: 'restored' | 'failed' | 'not_needed';
}

export type ExtensionMessage =
  | { type: 'PORTAL_LIST_DETECTED'; provider: PaymentProvider; pageUrl: string }
  | { type: 'PAYMENTS_OBSERVED'; scanId: string; pageUrl: string; result: ParseResult }
  | { type: 'SCAN_CONTROL'; action: 'start' | 'pause' | 'cancel'; scanId?: string; provider: PaymentProvider }
  | { type: 'SCAN_PROGRESS'; progress: ScanProgress }
  | { type: 'ISSUE_QUEUE_START'; operationIds: string[] }
  | { type: 'ISSUE_QUEUE_PROGRESS'; operationIds: string[] }
  | {
      type: 'ADAFLOW_RECONCILIATION_COMPLETED';
      matchedCount?: number;
      updatedCount?: number;
      declarationsFound?: number;
    }
  | {
      type: 'ADAFLOW_RECONCILIATION_OBSERVED';
      declarations: Array<{
        asaasPaymentId: string;
        adaflowNfseId: number;
        nfseNumber?: string;
        date?: string;
        amountCents?: number;
        pdfUrl?: string;
        description?: string;
        takerName?: string;
      }>;
      pagesScanned?: number;
      totalInvoicesFound?: number;
      takers?: AdaflowImportedTaker[];
      templates?: AdaflowImportedTemplate[];
      unmatchedNotes?: Array<{
        adaflowNfseId: number;
        nfseNumber?: string;
        takerName?: string;
        date?: string;
        asaasPaymentId?: string | null;
        description?: string;
        requiresManualAction?: boolean;
        reason?: string;
      }>;
    };

export type AdaflowReconciliationObservedMessage = Extract<
  ExtensionMessage,
  { type: 'ADAFLOW_RECONCILIATION_OBSERVED' }
>;

export const extensionMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('PORTAL_LIST_DETECTED'),
    provider: z.enum(['asaas', 'husky']),
    pageUrl: z.string(),
  }),
  z.object({
    type: z.literal('PAYMENTS_OBSERVED'),
    scanId: z.string(),
    pageUrl: z.string(),
    result: z.object({
      payments: z.array(
        z.object({
          provider: z.enum(['asaas', 'husky']),
          sourcePaymentId: z.string().nullable(),
          identityConfidence: z.enum(['high', 'low']),
          payerName: z.string().nullable(),
          amountCents: z.number().nullable(),
          currency: z.string().nullable(),
          paymentDate: z.string().nullable(),
          sourceStatus: z.string(),
          paymentState: z.enum(['aguardando_recebimento', 'recebido', 'revertido_ou_cancelado', 'desconhecido']),
        }),
      ),
      warnings: z.array(
        z.object({
          code: z.enum(['missing_id', 'missing_amount', 'unknown_status', 'unsupported_layout']),
          message: z.string(),
          rowIndex: z.number().nullable(),
        }),
      ),
      pagination: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('next'), href: z.string() }),
        z.object({ kind: z.literal('end') }),
        z.object({ kind: z.literal('unsupported'), reason: z.string() }),
      ]),
    }),
  }),
  z.object({
    type: z.literal('SCAN_CONTROL'),
    action: z.enum(['start', 'pause', 'cancel']),
    scanId: z.string().optional(),
    provider: z.enum(['asaas', 'husky']),
  }),
  z.object({
    type: z.literal('SCAN_PROGRESS'),
    progress: z.object({
      scanId: z.string(),
      provider: z.enum(['asaas', 'husky']),
      status: z.enum(['idle', 'scanning', 'partial', 'complete', 'paused', 'failed']),
      pagesSeen: z.number(),
      recordsFound: z.number(),
      reason: z.string().nullable(),
      restoreStatus: z.enum(['restored', 'failed', 'not_needed']).optional(),
    }),
  }),
  z.object({
    type: z.literal('ISSUE_QUEUE_START'),
    operationIds: z.array(z.string()),
  }),
  z.object({
    type: z.literal('ISSUE_QUEUE_PROGRESS'),
    operationIds: z.array(z.string()),
  }),
  z.object({
    type: z.literal('ADAFLOW_RECONCILIATION_COMPLETED'),
    matchedCount: z.number().optional(),
    updatedCount: z.number().optional(),
    declarationsFound: z.number().optional(),
  }),
  z.object({
    type: z.literal('ADAFLOW_RECONCILIATION_OBSERVED'),
    declarations: z.array(
      z.object({
        asaasPaymentId: z.string(),
        adaflowNfseId: z.number(),
        nfseNumber: z.string().optional(),
        date: z.string().optional(),
        amountCents: z.number().optional(),
        pdfUrl: z.string().optional(),
        description: z.string().optional(),
        takerName: z.string().optional(),
      }),
    ),
    pagesScanned: z.number().optional(),
    totalInvoicesFound: z.number().optional(),
    takers: z
      .array(
        z.object({
          serviceTakerId: z.string().optional(),
          name: z.string(),
          document: z.string().nullable().optional(),
          email: z.string().nullable().optional(),
          phone: z.string().nullable().optional(),
          address: z.any().optional(),
          discoveredFromNfse: z.string().optional(),
        }),
      )
      .optional(),
    templates: z
      .array(
        z.object({
          id: z.string().optional(),
          name: z.string(),
          description: z.string(),
          cnae: z.string().optional(),
          withholdTaxes: z.boolean().optional(),
          discoveredFromNfse: z.string().optional(),
        }),
      )
      .optional(),
    unmatchedNotes: z
      .array(
        z.object({
          adaflowNfseId: z.number(),
          nfseNumber: z.string().optional(),
          takerName: z.string().optional(),
          date: z.string().optional(),
          asaasPaymentId: z.string().nullable().optional(),
          description: z.string().optional(),
          requiresManualAction: z.boolean().optional(),
          reason: z.string().optional(),
        }),
      )
      .optional(),
  }),
]);
