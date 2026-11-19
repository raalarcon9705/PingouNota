import { browser } from 'wxt/browser';
import type { Payment } from '../domain/payment';
import type { ObservedPayment } from '../shared/observed-payment';
import { listPayments, upsertPayments } from '../storage/payment-repository';
import type { PingouNotaDB } from '../storage/database';

export function createPaymentFromObservation(
  observed: ObservedPayment,
  observedAt: string = new Date().toISOString(),
): Payment {
  const isHighConfidence =
    observed.identityConfidence === 'high' && observed.sourcePaymentId !== null;

  let recordKey: string;
  let identityFingerprint: string | null;
  let ambiguousIdentity: boolean;

  if (isHighConfidence) {
    recordKey = observed.sourcePaymentId!;
    identityFingerprint = `${observed.provider}_${observed.sourcePaymentId}`;
    ambiguousIdentity = false;
  } else {
    const rawFingerprint = `${observed.provider}:${observed.payerName ?? 'unknown'}:${observed.amountCents ?? 0}:${observed.currency ?? ''}:${observed.paymentDate ?? 'nodate'}`;
    recordKey = `comp_${rawFingerprint}`;
    identityFingerprint = rawFingerprint;
    ambiguousIdentity = true;
  }

  return {
    provider: observed.provider,
    recordKey,
    sourcePaymentId: observed.sourcePaymentId,
    identityConfidence: observed.identityConfidence,
    ambiguousIdentity,
    identityFingerprint,
    payerName: observed.payerName,
    amountCents: observed.amountCents,
    currency: observed.currency,
    paymentDate: observed.paymentDate,
    sourceStatus: observed.sourceStatus,
    paymentState: observed.paymentState,
    declarationState: 'nao_declarado',
    lastObservedAt: observedAt,
    manualDeclaredAt: null,
  };
}

export async function processObservedPayments(
  observedPayments: ObservedPayment[],
  observedAt: string = new Date().toISOString(),
  dbInstance?: PingouNotaDB,
): Promise<Payment[]> {
  const payments = observedPayments.map((p) =>
    createPaymentFromObservation(p, observedAt),
  );
  return upsertPayments(payments, dbInstance);
}

export async function updateActionBadge(dbInstance?: PingouNotaDB): Promise<number> {
  const undeclaredReceived = await listPayments(
    {
      paymentState: 'recebido',
      declarationState: 'nao_declarado',
    },
    dbInstance,
  );

  const count = undeclaredReceived.length;
  const text = count > 0 ? String(count) : '';

  try {
    if (browser?.action) {
      await browser.action.setBadgeText({ text });
      if (count > 0 && browser.action.setBadgeBackgroundColor) {
        await browser.action.setBadgeBackgroundColor({ color: '#2563eb' });
      }
    }
  } catch {
    // Ignore badge errors outside extension environment (e.g. unit tests)
  }

  return count;
}

export async function coordinatePaymentsObservation(
  observedPayments: ObservedPayment[],
  observedAt: string = new Date().toISOString(),
  dbInstance?: PingouNotaDB,
): Promise<{ savedPayments: Payment[]; undeclaredCount: number }> {
  const savedPayments = await processObservedPayments(observedPayments, observedAt, dbInstance);
  const undeclaredCount = await updateActionBadge(dbInstance);
  return { savedPayments, undeclaredCount };
}
