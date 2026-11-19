import { z } from 'zod';
import type { AdaflowServiceTaker } from './taker';
import { adaflowServiceTakerSchema } from './taker';

export const SUPPORTED_FOREIGN_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD'] as const;
export type ForeignCurrency = (typeof SUPPORTED_FOREIGN_CURRENCIES)[number];

export interface NfseIssuePayload {
  cnae: string;
  description: string;
  value_cents?: number;
  foreign_value_cents?: number;
  foreign_value_currency?: 'USD' | 'EUR' | 'GBP' | 'CAD' | 'AUD';
  withhold_taxes: boolean;
  forwarding_email?: string;
  external_id: string;
  service_taker: AdaflowServiceTaker;
}

export interface NfseOperation {
  id: string;
  provider: 'asaas' | 'husky';
  paymentRecordKey: string;
  externalId: string;
  idempotencyKey: string;
  payloadJson: string;
  adaflowNfseId: number | null;
  status: 'queued' | 'requested' | 'issued' | 'failed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  errorMessage?: string | null;
}

export const nfseIssuePayloadSchema = z
  .object({
    cnae: z.string().min(1, 'CNAE é obrigatório'),
    description: z.string().min(1, 'Descrição é obrigatória'),
    value_cents: z.number().int().positive('Valor em centavos deve ser positivo').optional(),
    foreign_value_cents: z
      .number()
      .int()
      .positive('Valor estrangeiro em centavos deve ser positivo')
      .optional(),
    foreign_value_currency: z.enum(SUPPORTED_FOREIGN_CURRENCIES).optional(),
    withhold_taxes: z.boolean().default(false),
    forwarding_email: z
      .string()
      .email('E-mail de encaminhamento inválido')
      .optional()
      .or(z.literal('')),
    external_id: z.string().min(1, 'external_id é obrigatório'),
    service_taker: adaflowServiceTakerSchema,
  })
  .refine(
    (data) => {
      const hasDomestic = data.value_cents !== undefined && data.value_cents > 0;
      const hasForeign =
        data.foreign_value_cents !== undefined &&
        data.foreign_value_cents > 0 &&
        Boolean(data.foreign_value_currency);
      return hasDomestic || hasForeign;
    },
    {
      message:
        'Deve fornecer value_cents ou foreign_value_cents com foreign_value_currency suportada',
    },
  );

export const nfseOperationSchema = z.object({
  id: z.string().min(1, 'ID é obrigatório'),
  provider: z.enum(['asaas', 'husky']),
  paymentRecordKey: z.string().min(1, 'paymentRecordKey é obrigatório'),
  externalId: z.string().min(1, 'externalId é obrigatório'),
  idempotencyKey: z.string().min(1, 'idempotencyKey é obrigatório'),
  payloadJson: z.string().min(1, 'payloadJson é obrigatório'),
  adaflowNfseId: z.number().int().nullable(),
  status: z.enum(['queued', 'requested', 'issued', 'failed', 'cancelled']),
  createdAt: z.string(),
  updatedAt: z.string(),
  errorMessage: z.string().nullable().optional(),
});
