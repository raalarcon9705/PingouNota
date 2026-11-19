import type { DeclarationState, Payment, PaymentProvider, PaymentState } from '../domain/payment';
import { reconcilePaymentObservation } from '../domain/declaration';
import { db, type PingouNotaDB } from './database';

export interface PaymentFilter {
  provider?: PaymentProvider;
  paymentState?: PaymentState;
  declarationState?: DeclarationState;
  ambiguousIdentity?: boolean;
  startDate?: string;
  endDate?: string;
}

export async function getPayment(
  provider: PaymentProvider,
  recordKey: string,
  dbInstance: PingouNotaDB = db,
): Promise<Payment | undefined> {
  return dbInstance.payments.get([provider, recordKey]);
}

export async function upsertPayment(
  payment: Payment,
  dbInstance: PingouNotaDB = db,
): Promise<Payment> {
  let existing = await dbInstance.payments.get([payment.provider, payment.recordKey]);

  if (!existing && payment.identityConfidence === 'high' && payment.sourcePaymentId) {
    existing = await dbInstance.payments
      .where('sourcePaymentId')
      .equals(payment.sourcePaymentId)
      .and((p) => p.provider === payment.provider)
      .first();
  }

  if (!existing) {
    await dbInstance.payments.put(payment);
    return payment;
  }

  // Never merge ambiguous rows
  if (payment.ambiguousIdentity || existing.ambiguousIdentity) {
    if (!existing.ambiguousIdentity) {
      await dbInstance.payments.update([existing.provider, existing.recordKey], {
        ambiguousIdentity: true,
      });
    }

    const separateRow: Payment = {
      ...payment,
      recordKey:
        payment.recordKey === existing.recordKey
          ? `${payment.recordKey}_ambiguous_${crypto.randomUUID()}`
          : payment.recordKey,
      ambiguousIdentity: true,
    };

    await dbInstance.payments.put(separateRow);
    return separateRow;
  }

  // Reconcile observation for unambiguous rows
  const reconciled = reconcilePaymentObservation(existing, payment);
  await dbInstance.payments.put(reconciled);
  return reconciled;
}

export async function upsertPayments(
  payments: Payment[],
  dbInstance: PingouNotaDB = db,
): Promise<Payment[]> {
  return dbInstance.transaction('rw', dbInstance.payments, async () => {
    const results: Payment[] = [];
    for (const payment of payments) {
      results.push(await upsertPayment(payment, dbInstance));
    }
    return results;
  });
}

export async function listPayments(
  filter?: PaymentFilter,
  dbInstance: PingouNotaDB = db,
): Promise<Payment[]> {
  let results = await dbInstance.payments.toArray();

  if (filter) {
    results = results.filter((p) => {
      if (filter.provider && p.provider !== filter.provider) return false;
      if (filter.paymentState && p.paymentState !== filter.paymentState) return false;
      if (filter.declarationState && p.declarationState !== filter.declarationState) return false;
      if (
        filter.ambiguousIdentity !== undefined &&
        p.ambiguousIdentity !== filter.ambiguousIdentity
      ) {
        return false;
      }
      if (filter.startDate && (!p.paymentDate || p.paymentDate < filter.startDate)) return false;
      if (filter.endDate && (!p.paymentDate || p.paymentDate > filter.endDate)) return false;
      return true;
    });
  }

  // Sort descending by paymentDate or lastObservedAt
  results.sort((a, b) => {
    const dateA = a.paymentDate || a.lastObservedAt;
    const dateB = b.paymentDate || b.lastObservedAt;
    return dateB.localeCompare(dateA);
  });

  return results;
}

export async function deletePayment(
  provider: PaymentProvider,
  recordKey: string,
  dbInstance: PingouNotaDB = db,
): Promise<void> {
  await dbInstance.payments.delete([provider, recordKey]);
}

export async function clearPayments(dbInstance: PingouNotaDB = db): Promise<void> {
  await dbInstance.payments.clear();
}
