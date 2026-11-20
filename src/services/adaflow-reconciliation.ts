import { browser } from 'wxt/browser';
import { db, type PingouNotaDB } from '../storage/database';
import type { TakerProfile } from '../domain/taker';
import type { ServiceTemplate } from '../domain/template';
import {
  fetchAdaflowDeclarations,
  type AdaflowReconciledDeclaration,
  type AdaflowImportedTaker,
  type AdaflowImportedTemplate,
  type FetchAdaflowDeclarationsOptions,
  type FetchAdaflowDeclarationsResult,
} from './adaflow-scraper';

export {
  fetchAdaflowDeclarations,
  type AdaflowReconciledDeclaration,
  type AdaflowImportedTaker,
  type AdaflowImportedTemplate,
  type FetchAdaflowDeclarationsOptions,
  type FetchAdaflowDeclarationsResult,
};

export const RECONCILIATION_AUDIT_STORAGE_KEY = 'last_reconciliation_audit';
export const PROPOSED_TAKERS_STORAGE_KEY = 'adaflow_proposed_takers';
export const PROPOSED_TEMPLATES_STORAGE_KEY = 'adaflow_proposed_templates';

export interface ProposedTaker {
  id: string;
  serviceTakerId?: string;
  name: string;
  document?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: TakerProfile['address'];
  discoveredFromNfse?: string;
  suggestedAt: string;
}

export interface ProposedTemplate {
  id: string;
  name: string;
  description: string;
  cnae?: string;
  withholdTaxes?: boolean;
  discoveredFromNfse?: string;
  suggestedAt: string;
}

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
    requiresManualAction?: boolean;
  }>;
}

export interface ReconcileAdaflowResult {
  matchedCount: number;
  updatedCount: number;
  declarationsFound: number;
  audit?: ReconciliationAuditRecord;
}

let memoryAuditForTesting: ReconciliationAuditRecord | null = null;
let memoryProposedTakersForTesting: ProposedTaker[] = [];
let memoryProposedTemplatesForTesting: ProposedTemplate[] = [];

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

export function _resetProposedForTesting(): void {
  memoryProposedTakersForTesting = [];
  memoryProposedTemplatesForTesting = [];
}

/**
 * Recupera os tomadores sugeridos (propostas aguardando aprovação) do storage.
 */
export async function getProposedTakers(): Promise<ProposedTaker[]> {
  try {
    if (typeof browser !== 'undefined' && browser?.storage?.local?.get) {
      const res = await browser.storage.local.get(PROPOSED_TAKERS_STORAGE_KEY);
      if (res?.[PROPOSED_TAKERS_STORAGE_KEY]) {
        return res[PROPOSED_TAKERS_STORAGE_KEY] as ProposedTaker[];
      }
      return [];
    }
    if (typeof chrome !== 'undefined' && chrome?.storage?.local?.get) {
      return new Promise<ProposedTaker[]>((resolve) => {
        chrome.storage.local.get([PROPOSED_TAKERS_STORAGE_KEY], (res: Record<string, unknown>) => {
          resolve((res?.[PROPOSED_TAKERS_STORAGE_KEY] as ProposedTaker[]) || []);
        });
      });
    }
  } catch (err) {
    console.warn('[PingouNota:Reconciliação] Falha ao recuperar tomadores propostos:', err);
  }
  return [...memoryProposedTakersForTesting];
}

/**
 * Salva a lista de tomadores sugeridos no storage.
 */
export async function saveProposedTakers(proposals: ProposedTaker[]): Promise<void> {
  memoryProposedTakersForTesting = [...proposals];
  try {
    if (typeof browser !== 'undefined' && browser?.storage?.local?.set) {
      await browser.storage.local.set({ [PROPOSED_TAKERS_STORAGE_KEY]: proposals });
      return;
    }
    if (typeof chrome !== 'undefined' && chrome?.storage?.local?.set) {
      await new Promise<void>((resolve, reject) => {
        chrome.storage.local.set({ [PROPOSED_TAKERS_STORAGE_KEY]: proposals }, () => {
          if (chrome.runtime?.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      });
      return;
    }
  } catch (err) {
    console.warn('[PingouNota:Reconciliação] Falha ao salvar tomadores propostos:', err);
  }
}

/**
 * Aprova um tomador sugerido, persistindo-o no Dexie e removendo a sugestão.
 */
export async function approveProposedTaker(
  id: string,
  taker: TakerProfile,
  dbInstance: PingouNotaDB = db,
): Promise<void> {
  await dbInstance.takers.put({
    ...taker,
    createdAt: taker.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const current = await getProposedTakers();
  const filtered = current.filter((p) => p.id !== id);
  await saveProposedTakers(filtered);
}

/**
 * Descarta um tomador sugerido sem salvá-lo no Dexie.
 */
export async function dismissProposedTaker(id: string): Promise<void> {
  const current = await getProposedTakers();
  const filtered = current.filter((p) => p.id !== id);
  await saveProposedTakers(filtered);
}

/**
 * Recupera os modelos sugeridos (propostas aguardando aprovação) do storage.
 */
export async function getProposedTemplates(): Promise<ProposedTemplate[]> {
  try {
    if (typeof browser !== 'undefined' && browser?.storage?.local?.get) {
      const res = await browser.storage.local.get(PROPOSED_TEMPLATES_STORAGE_KEY);
      if (res?.[PROPOSED_TEMPLATES_STORAGE_KEY]) {
        return res[PROPOSED_TEMPLATES_STORAGE_KEY] as ProposedTemplate[];
      }
      return [];
    }
    if (typeof chrome !== 'undefined' && chrome?.storage?.local?.get) {
      return new Promise<ProposedTemplate[]>((resolve) => {
        chrome.storage.local.get([PROPOSED_TEMPLATES_STORAGE_KEY], (res: Record<string, unknown>) => {
          resolve((res?.[PROPOSED_TEMPLATES_STORAGE_KEY] as ProposedTemplate[]) || []);
        });
      });
    }
  } catch (err) {
    console.warn('[PingouNota:Reconciliação] Falha ao recuperar modelos propostos:', err);
  }
  return [...memoryProposedTemplatesForTesting];
}

/**
 * Salva a lista de modelos sugeridos no storage.
 */
export async function saveProposedTemplates(proposals: ProposedTemplate[]): Promise<void> {
  memoryProposedTemplatesForTesting = [...proposals];
  try {
    if (typeof browser !== 'undefined' && browser?.storage?.local?.set) {
      await browser.storage.local.set({ [PROPOSED_TEMPLATES_STORAGE_KEY]: proposals });
      return;
    }
    if (typeof chrome !== 'undefined' && chrome?.storage?.local?.set) {
      await new Promise<void>((resolve, reject) => {
        chrome.storage.local.set({ [PROPOSED_TEMPLATES_STORAGE_KEY]: proposals }, () => {
          if (chrome.runtime?.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      });
      return;
    }
  } catch (err) {
    console.warn('[PingouNota:Reconciliação] Falha ao salvar modelos propostos:', err);
  }
}

/**
 * Aprova um modelo sugerido, persistindo-o no Dexie e removendo a sugestão.
 */
export async function approveProposedTemplate(
  id: string,
  template: ServiceTemplate,
  dbInstance: PingouNotaDB = db,
): Promise<void> {
  await dbInstance.templates.put({
    ...template,
    createdAt: template.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const current = await getProposedTemplates();
  const filtered = current.filter((p) => p.id !== id);
  await saveProposedTemplates(filtered);
}

/**
 * Descarta um modelo sugerido sem salvá-lo no Dexie.
 */
export async function dismissProposedTemplate(id: string): Promise<void> {
  const current = await getProposedTemplates();
  const filtered = current.filter((p) => p.id !== id);
  await saveProposedTemplates(filtered);
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
 * Upserts service takers extracted from Adaflow into db.takers.
 */
export async function importAdaflowTakers(
  takers: Array<{
    serviceTakerId?: string;
    name: string;
    document?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: TakerProfile['address'];
  }>,
  dbInstance: PingouNotaDB = db,
): Promise<number> {
  if (!takers || takers.length === 0) return 0;

  let importedCount = 0;
  await dbInstance.transaction('rw', dbInstance.takers, async () => {
    for (const t of takers) {
      if (!t.name || !t.name.trim()) continue;
      const name = t.name.trim();
      const slug =
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '') || String(Date.now());
      const id = t.serviceTakerId || `taker_${slug}`;

      let existing = await dbInstance.takers.get(id);
      if (!existing && t.serviceTakerId) {
        existing = await dbInstance.takers
          .filter((taker) => taker.externalId === t.serviceTakerId)
          .first();
      }
      if (!existing) {
        existing = await dbInstance.takers.where('name').equalsIgnoreCase(name).first();
      }

      if (existing) {
        let changed = false;
        if (!existing.name && name) {
          existing.name = name;
          changed = true;
        }
        if (!existing.externalId && t.serviceTakerId) {
          existing.externalId = t.serviceTakerId;
          changed = true;
        }
        if (!existing.document && t.document) {
          existing.document = t.document;
          changed = true;
        }
        if (!existing.email && t.email) {
          existing.email = t.email;
          changed = true;
        }
        if (!existing.phone && t.phone) {
          existing.phone = t.phone;
          changed = true;
        }
        if (changed) {
          existing.updatedAt = new Date().toISOString();
          await dbInstance.takers.put(existing);
          importedCount++;
        }
      } else {
        const newTaker: TakerProfile = {
          id,
          name,
          document: t.document || null,
          externalId: t.serviceTakerId || null,
          email: t.email || null,
          phone: t.phone || null,
          address: t.address || {
            line1: 'Importado Adaflow',
            number: null,
            neighborhood: null,
            city: 'São Paulo',
            state: 'SP',
            postalCode: '01000-000',
            country: 'Brasil',
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await dbInstance.takers.put(newTaker);
        importedCount++;
      }
    }
  });

  console.info(`[PingouNota:Tomadores] 👥 ${takers.length} tomadores importados/atualizados da Adaflow.`);
  return importedCount;
}

/**
 * Reconciles parsed Adaflow declarations against Asaas payments in IndexedDB.
 * Updates matching payments in 'nao_declarado' or 'falha_adaflow' state to 'marcado_localmente'
 * with manualDeclaredAt inside an atomic Dexie transaction.
 */
export async function reconcileAdaflowDeclarations(
  declarations: AdaflowReconciledDeclaration[],
  dbInstance: PingouNotaDB = db,
  takers?: AdaflowImportedTaker[],
  templates?: AdaflowImportedTemplate[],
): Promise<ReconcileAdaflowResult> {
  // Propose takers rather than silent auto-insertion
  if (takers && takers.length > 0) {
    const existingTakers = await dbInstance.takers.toArray();
    const currentProposals = await getProposedTakers();
    const newProposals: ProposedTaker[] = [];

    for (const t of takers) {
      if (!t.name || !t.name.trim()) continue;
      const trimmedName = t.name.trim().toLowerCase();
      const extId = t.serviceTakerId?.trim();

      const inDb = existingTakers.some((dbTaker) => {
        if (extId && dbTaker.externalId === extId) return true;
        return dbTaker.name.trim().toLowerCase() === trimmedName;
      });
      if (inDb) continue;

      const inProposals =
        currentProposals.some((p) => {
          if (extId && p.serviceTakerId === extId) return true;
          return p.name.trim().toLowerCase() === trimmedName;
        }) ||
        newProposals.some((p) => {
          if (extId && p.serviceTakerId === extId) return true;
          return p.name.trim().toLowerCase() === trimmedName;
        });
      if (inProposals) continue;

      const slug =
        trimmedName
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '') || String(Date.now());
      const proposalId = extId || `prop_taker_${slug}`;

      newProposals.push({
        id: proposalId,
        serviceTakerId: extId || undefined,
        name: t.name.trim(),
        document: t.document || null,
        email: t.email || null,
        phone: t.phone || null,
        address: t.address || {
          line1: 'Importado Adaflow',
          number: null,
          neighborhood: null,
          city: 'São Paulo',
          state: 'SP',
          postalCode: '01000-000',
          country: 'Brasil',
        },
        discoveredFromNfse: t.discoveredFromNfse,
        suggestedAt: new Date().toISOString(),
      });
    }

    if (newProposals.length > 0) {
      await saveProposedTakers([...currentProposals, ...newProposals]);
      console.info(
        `[PingouNota:Tomadores] 💡 ${newProposals.length} novos tomadores sugeridos para aprovação do usuário.`,
      );
    }
  }

  // Propose templates rather than silent auto-insertion
  if (templates && templates.length > 0) {
    const existingTemplates = await dbInstance.templates.toArray();
    const currentProposals = await getProposedTemplates();
    const newProposals: ProposedTemplate[] = [];

    for (const tmpl of templates) {
      if (!tmpl.description || !tmpl.description.trim()) continue;
      const trimmedDesc = tmpl.description.trim().toLowerCase();
      const trimmedName = tmpl.name.trim().toLowerCase();

      const inDb = existingTemplates.some((dbTmpl) => {
        return (
          dbTmpl.description.trim().toLowerCase() === trimmedDesc ||
          dbTmpl.name.trim().toLowerCase() === trimmedName
        );
      });
      if (inDb) continue;

      const inProposals =
        currentProposals.some((p) => {
          return (
            p.description.trim().toLowerCase() === trimmedDesc ||
            p.name.trim().toLowerCase() === trimmedName
          );
        }) ||
        newProposals.some((p) => {
          return (
            p.description.trim().toLowerCase() === trimmedDesc ||
            p.name.trim().toLowerCase() === trimmedName
          );
        });
      if (inProposals) continue;

      const slug =
        trimmedName
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '') || String(Date.now());
      const proposalId = tmpl.id || `prop_tmpl_${slug}_${Math.random().toString(36).slice(2, 6)}`;

      newProposals.push({
        id: proposalId,
        name: tmpl.name.trim(),
        description: tmpl.description.trim(),
        cnae: tmpl.cnae || '6201-5/01',
        withholdTaxes: tmpl.withholdTaxes ?? false,
        discoveredFromNfse: tmpl.discoveredFromNfse,
        suggestedAt: new Date().toISOString(),
      });
    }

    if (newProposals.length > 0) {
      await saveProposedTemplates([...currentProposals, ...newProposals]);
      console.info(
        `[PingouNota:Modelos] 💡 ${newProposals.length} novos modelos sugeridos para aprovação do usuário.`,
      );
    }
  }

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
            requiresManualAction: false,
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
            requiresManualAction: false,
          });
        }
      } else {
        unmatchedCount++;
        console.warn(
          `[PingouNota:Reconciliação] ⚠️ [Atenção: Ação Manual Requerida] Cobrança Asaas ${decl.asaasPaymentId} (Nota ${decl.nfseNumber || decl.adaflowNfseId}): não encontrada na base local de pagamentos. Requer conferência manual.`,
        );
        details.push({
          asaasPaymentId: decl.asaasPaymentId,
          nfseNumber: decl.nfseNumber,
          adaflowNfseId: decl.adaflowNfseId,
          date: decl.date,
          description: decl.description,
          status: 'not_found',
          requiresManualAction: true,
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
