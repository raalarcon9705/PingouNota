import type { PaymentProvider, PaymentState } from '../domain/payment';

export interface ObservedPayment {
  provider: PaymentProvider;
  sourcePaymentId: string | null;
  identityConfidence: 'high' | 'low';
  payerName: string | null;
  amountCents: number | null;
  currency: string | null;
  paymentDate: string | null;
  sourceStatus: string;
  paymentState: PaymentState;
}

export interface ParseWarning {
  code: 'missing_id' | 'missing_amount' | 'unknown_status' | 'unsupported_layout';
  message: string;
  rowIndex: number | null;
}

export type PaginationResult =
  | { kind: 'next'; href: string }
  | { kind: 'end' }
  | { kind: 'unsupported'; reason: string };

export interface ParseResult {
  payments: ObservedPayment[];
  warnings: ParseWarning[];
  pagination: PaginationResult;
}
