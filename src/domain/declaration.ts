import type { DeclarationState, Payment, PaymentProvider, PaymentState } from './payment';

export const RETRYABLE_DECLARATION_STATES: ReadonlySet<DeclarationState> = new Set([
  'nao_declarado',
  'falha_adaflow',
]);

const ASAAS_STATUS_MAP: Record<string, PaymentState> = {
  recebido: 'recebido',
  confirmado: 'recebido',
  recebida: 'recebido',
  'aguardando pagamento': 'aguardando_recebimento',
  pendente: 'aguardando_recebimento',
  vencida: 'aguardando_recebimento',
  'aguardando aprovação': 'aguardando_recebimento',
  'aguardando aprovacao': 'aguardando_recebimento',
  estornado: 'revertido_ou_cancelado',
  cancelado: 'revertido_ou_cancelado',
  revertido: 'revertido_ou_cancelado',
};

const HUSKY_STATUS_MAP: Record<string, PaymentState> = {
  'na conta': 'recebido',
  concluído: 'recebido',
  concluido: 'recebido',
  disponível: 'recebido',
  disponivel: 'recebido',
  arrived: 'recebido',
  'a caminho': 'aguardando_recebimento',
  'em processamento': 'aguardando_recebimento',
  'in transit': 'aguardando_recebimento',
  processando: 'aguardando_recebimento',
  cancelado: 'revertido_ou_cancelado',
  devolvido: 'revertido_ou_cancelado',
  revertido: 'revertido_ou_cancelado',
};

export function normalizePaymentState(
  sourceStatus: string | null | undefined,
  provider?: PaymentProvider,
): PaymentState {
  if (!sourceStatus) {
    return 'desconhecido';
  }

  const normalized = sourceStatus.trim().toLowerCase();

  if (provider === 'asaas') {
    return ASAAS_STATUS_MAP[normalized] ?? 'desconhecido';
  }

  if (provider === 'husky') {
    return HUSKY_STATUS_MAP[normalized] ?? 'desconhecido';
  }

  // If provider not specified, attempt matching both known maps
  return ASAAS_STATUS_MAP[normalized] ?? HUSKY_STATUS_MAP[normalized] ?? 'desconhecido';
}

export function canDeclarePayment(
  payment: Payment,
): { allowed: boolean; reason?: string } {
  if (payment.ambiguousIdentity) {
    return {
      allowed: false,
      reason: 'Pagamento com identificação ambígua não pode ser declarado.',
    };
  }

  if (payment.paymentState !== 'recebido') {
    return {
      allowed: false,
      reason: `Apenas pagamentos com estado recebido podem ser declarados. Estado atual: ${payment.paymentState}.`,
    };
  }

  if (!RETRYABLE_DECLARATION_STATES.has(payment.declarationState)) {
    return {
      allowed: false,
      reason: `Pagamento já declarado ou em processamento. Estado de declaração atual: ${payment.declarationState}.`,
    };
  }

  return { allowed: true };
}

export function markPaymentLocally(
  payment: Payment,
  declaredAt?: string,
): Payment {
  const eligibility = canDeclarePayment(payment);
  if (!eligibility.allowed) {
    throw new Error(eligibility.reason ?? 'Pagamento não elegível para declaração.');
  }

  return {
    ...payment,
    declarationState: 'marcado_localmente',
    manualDeclaredAt: declaredAt || new Date().toISOString(),
  };
}

export function reconcilePaymentObservation(
  existing: Payment,
  observed: Partial<Payment>,
): Payment {
  const newPaymentState =
    observed.paymentState ??
    (observed.sourceStatus
      ? normalizePaymentState(observed.sourceStatus, observed.provider ?? existing.provider)
      : existing.paymentState);

  const wasDeclared =
    existing.declarationState === 'marcado_localmente' ||
    existing.declarationState === 'emitida_adaflow' ||
    existing.declarationState === 'emissao_solicitada';

  const reversalFlaggedForReview = Boolean(
    existing.reversalFlaggedForReview ||
      (wasDeclared && newPaymentState === 'revertido_ou_cancelado'),
  );

  return {
    provider: existing.provider,
    recordKey: existing.recordKey,
    sourcePaymentId:
      observed.sourcePaymentId !== undefined ? observed.sourcePaymentId : existing.sourcePaymentId,
    identityConfidence: observed.identityConfidence ?? existing.identityConfidence,
    ambiguousIdentity: observed.ambiguousIdentity ?? existing.ambiguousIdentity,
    identityFingerprint:
      observed.identityFingerprint !== undefined
        ? observed.identityFingerprint
        : existing.identityFingerprint,
    payerName: observed.payerName !== undefined ? observed.payerName : existing.payerName,
    amountCents: observed.amountCents !== undefined ? observed.amountCents : existing.amountCents,
    currency: observed.currency !== undefined ? observed.currency : existing.currency,
    paymentDate: observed.paymentDate !== undefined ? observed.paymentDate : existing.paymentDate,
    sourceStatus: observed.sourceStatus !== undefined ? observed.sourceStatus : existing.sourceStatus,
    paymentState: newPaymentState,
    declarationState: existing.declarationState,
    lastObservedAt: observed.lastObservedAt ?? new Date().toISOString(),
    manualDeclaredAt: existing.manualDeclaredAt,
    reversalFlaggedForReview,
    linkedNfseOperationId:
      existing.linkedNfseOperationId ?? observed.linkedNfseOperationId ?? null,
  };
}
