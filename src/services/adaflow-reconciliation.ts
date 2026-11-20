import { db, type PingouNotaDB } from '../storage/database';
import {
  fetchAdaflowDeclarations,
  type AdaflowReconciledDeclaration,
  type FetchAdaflowDeclarationsOptions,
} from './adaflow-scraper';

export {
  fetchAdaflowDeclarations,
  type AdaflowReconciledDeclaration,
  type FetchAdaflowDeclarationsOptions,
};

export interface ReconcileAdaflowResult {
  matchedCount: number;
  updatedCount: number;
  declarationsFound: number;
}

/**
 * Normalizes date string (DD/MM/YYYY or ISO) into an ISO string.
 */
export function normalizeDateIso(dateStr?: string | null): string {
  if (!dateStr) return new Date().toISOString();
  const trimmed = dateStr.trim();
  if (!trimmed) return new Date().toISOString();

  // DD/MM/YYYY or DD-MM-YYYY
  const brMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (brMatch && brMatch[1] && brMatch[2] && brMatch[3]) {
    const day = brMatch[1].padStart(2, '0');
    const month = brMatch[2].padStart(2, '0');
    const year = brMatch[3];
    return new Date(`${year}-${month}-${day}T12:00:00.000Z`).toISOString();
  }

  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  return new Date().toISOString();
}

/**
 * Reconciles parsed Adaflow declarations against Asaas payments in IndexedDB.
 * Updates matching payments in 'nao_declarado' or 'falha_adaflow' state to 'marcado_localmente'
 * with manualDeclaredAt inside an atomic Dexie transaction.
 */
export async function reconcileAdaflowDeclarations(
  declarations: AdaflowReconciledDeclaration[],
  dbInstance: PingouNotaDB = db,
): Promise<ReconcileAdaflowResult> {
  let matchedCount = 0;
  let updatedCount = 0;

  await dbInstance.transaction('rw', dbInstance.payments, async () => {
    for (const decl of declarations) {
      if (!decl.asaasPaymentId) continue;

      const payment = await dbInstance.payments
        .where('sourcePaymentId')
        .equals(decl.asaasPaymentId)
        .and((p) => p.provider === 'asaas')
        .first();

      if (payment) {
        matchedCount++;
        if (
          payment.declarationState === 'nao_declarado' ||
          payment.declarationState === 'falha_adaflow'
        ) {
          payment.declarationState = 'marcado_localmente';
          payment.manualDeclaredAt = decl.date
            ? normalizeDateIso(decl.date)
            : new Date().toISOString();
          await dbInstance.payments.put(payment);
          updatedCount++;
        }
      }
    }
  });

  return {
    matchedCount,
    updatedCount,
    declarationsFound: declarations.length,
  };
}
