import { z } from 'zod';

export type PaymentProvider = 'asaas' | 'husky';
export type PaymentState = 'aguardando_recebimento' | 'recebido' | 'revertido_ou_cancelado' | 'desconhecido';
export type DeclarationState =
  | 'nao_declarado'
  | 'marcado_localmente'
  | 'emissao_solicitada'
  | 'emitida_adaflow'
  | 'falha_adaflow'
  | 'cancelada_adaflow';

export interface Payment {
  provider: PaymentProvider;
  recordKey: string;
  sourcePaymentId: string | null;
  identityConfidence: 'high' | 'low';
  ambiguousIdentity: boolean;
  identityFingerprint: string | null;
  payerName: string | null;
  amountCents: number | null;
  currency: string | null;
  paymentDate: string | null;
  sourceStatus: string;
  paymentState: PaymentState;
  declarationState: DeclarationState;
  lastObservedAt: string;
  manualDeclaredAt: string | null;
  reversalFlaggedForReview?: boolean;
  linkedNfseOperationId?: string | null;
}

export const paymentProviderSchema = z.enum(['asaas', 'husky']);

export const paymentStateSchema = z.enum([
  'aguardando_recebimento',
  'recebido',
  'revertido_ou_cancelado',
  'desconhecido',
]);

export const declarationStateSchema = z.enum([
  'nao_declarado',
  'marcado_localmente',
  'emissao_solicitada',
  'emitida_adaflow',
  'falha_adaflow',
  'cancelada_adaflow',
]);

export const paymentSchema = z.object({
  provider: paymentProviderSchema,
  recordKey: z.string().min(1),
  sourcePaymentId: z.string().nullable(),
  identityConfidence: z.enum(['high', 'low']),
  ambiguousIdentity: z.boolean(),
  identityFingerprint: z.string().nullable(),
  payerName: z.string().nullable(),
  amountCents: z.number().int().nullable(),
  currency: z.string().nullable(),
  paymentDate: z.string().nullable(),
  sourceStatus: z.string(),
  paymentState: paymentStateSchema,
  declarationState: declarationStateSchema,
  lastObservedAt: z.string(),
  manualDeclaredAt: z.string().nullable(),
  reversalFlaggedForReview: z.boolean().optional(),
  linkedNfseOperationId: z.string().nullable().optional(),
});
