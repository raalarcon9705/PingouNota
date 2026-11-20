import { browser } from 'wxt/browser';
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

export const RECONCILIATION_AUDIT_STORAGE_KEY = 'last_reconciliation_audit';

export interface ReconciliationAuditRecord {
  timestamp: string;
  declarationsFound: number;
  matchedCount: number;
  updatedCount: number;
  alreadyDeclaredCount: number;
  unmatchedCount: number;
  details: Array<{
    asaasPaymentId: string;
    nfseNumber?: string;
    adaflowNfseId: number;
    date?: string;
    description?: string;
    status: 'updated' | 'already_declared' | 'not_found';
  }>;
}

export interface ReconcileAdaflowResult {
  matchedCount: number;
  updatedCount: number;
  declarationsFound: number;
  audit?: ReconciliationAuditRecord;
}

let memoryAuditForTesting: ReconciliationAuditRecord | null = null;

/**
 * Recupera o último registro de auditoria de conciliação do storage.
 */
export async function getLastReconciliationAudit(): Promise<ReconciliationAuditRecord | null> {
  try {
    if (typeof browser !== 'undefined' && browser?.storage?.local?.get) {
      const result = await browser.storage.local.get(RECONCILIATION_AUDIT_STORAGE_KEY);
      const audit = result?.[RECONCILIATION_AUDIT_STORAGE_KEY];
      if (audit) return audit as ReconciliationAuditRecord;
      return null;
    }

    if (typeof chrome !== 'undefined' && chrome?.storage?.local?.get) {
      return new Promise<ReconciliationAuditRecord | null>((resolve) => {
        chrome.storage.local.get([RECONCILIATION_AUDIT_STORAGE_KEY], (res: Record<string, unknown>) => {
          const audit = res?.[RECONCILIATION_AUDIT_STORAGE_KEY];
          if (audit) {
            resolve(audit as ReconciliationAuditRecord);
          } else {
            resolve(null);
          }
        });
      });
    }
  } catch (error) {
    console.warn('[PingouNota:Reconciliação] Falha ao recuperar auditoria de storage.local:', error);
  }

  return memoryAuditForTesting;
}

/**
 * Salva o registro de auditoria de conciliação no storage.
 */
export async function saveLastReconciliationAudit(audit: ReconciliationAuditRecord): Promise<void> {
  memoryAuditForTesting = audit;

  try {
    if (typeof browser !== 'undefined' && browser?.storage?.local?.set) {
      await browser.storage.local.set({ [RECONCILIATION_AUDIT_STORAGE_KEY]: audit });
      return;
    }

    if (typeof chrome !== 'undefined' && chrome?.storage?.local?.set) {
      await new Promise<void>((resolve, reject) => {
        chrome.storage.local.set({ [RECONCILIATION_AUDIT_STORAGE_KEY]: audit }, () => {
          if (chrome.runtime?.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      });
      return;
    }
  } catch (error) {
    console.error('[PingouNota:Reconciliação] Falha ao salvar auditoria em storage.local:', error);
  }
}

/**
 * Helper interno para reset em testes de unidade.
 */
export function _resetMemoryAuditForTesting(): void {
  memoryAuditForTesting = null;
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
  console.info(
    `[PingouNota:Reconciliação] 🔄 Iniciando conciliação de ${declarations.length} notas com pagamentos locais...`,
  );

  let matchedCount = 0;
  let updatedCount = 0;
  let alreadyDeclaredCount = 0;
  let unmatchedCount = 0;

  const details: ReconciliationAuditRecord['details'] = [];

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
          console.info(
            `[PingouNota:Reconciliação] ✅ Cobrança Asaas ${decl.asaasPaymentId}: marcada como DECLARADA (Nota ${decl.nfseNumber || decl.adaflowNfseId}, Emissão: ${decl.date || 'N/A'})`,
          );
          details.push({
            asaasPaymentId: decl.asaasPaymentId,
            nfseNumber: decl.nfseNumber,
            adaflowNfseId: decl.adaflowNfseId,
            date: decl.date,
            description: decl.description,
            status: 'updated',
          });
        } else {
          alreadyDeclaredCount++;
          console.info(
            `[PingouNota:Reconciliação] ℹ️ Cobrança Asaas ${decl.asaasPaymentId}: já estava declarada anteriormente.`,
          );
          details.push({
            asaasPaymentId: decl.asaasPaymentId,
            nfseNumber: decl.nfseNumber,
            adaflowNfseId: decl.adaflowNfseId,
            date: decl.date,
            description: decl.description,
            status: 'already_declared',
          });
        }
      } else {
        unmatchedCount++;
        console.warn(
          `[PingouNota:Reconciliação] ⚠️ Cobrança Asaas ${decl.asaasPaymentId} (Nota ${decl.nfseNumber || decl.adaflowNfseId}): não encontrada na base local de pagamentos.`,
        );
        details.push({
          asaasPaymentId: decl.asaasPaymentId,
          nfseNumber: decl.nfseNumber,
          adaflowNfseId: decl.adaflowNfseId,
          date: decl.date,
          description: decl.description,
          status: 'not_found',
        });
      }
    }
  });

  const audit: ReconciliationAuditRecord = {
    timestamp: new Date().toISOString(),
    declarationsFound: declarations.length,
    matchedCount,
    updatedCount,
    alreadyDeclaredCount,
    unmatchedCount,
    details,
  };

  await saveLastReconciliationAudit(audit);

  console.info(
    `[PingouNota:Reconciliação] 📊 Conciliação finalizada: ${matchedCount} correspondências (${updatedCount} recém-marcadas, ${alreadyDeclaredCount} já declaradas, ${unmatchedCount} não encontradas no Asaas).`,
  );

  return {
    matchedCount,
    updatedCount,
    declarationsFound: declarations.length,
    audit,
  };
}
