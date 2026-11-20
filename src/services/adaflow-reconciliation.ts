import { db, type PingouNotaDB } from '../storage/database';
import {
  parseAdaflowInvoicesPage,
  parseAdaflowSlideover,
} from '../parsers/adaflow-parser';

export interface AdaflowReconciledDeclaration {
  asaasPaymentId: string;
  adaflowNfseId: number;
  nfseNumber?: string;
  date?: string;
  amountCents?: number;
  pdfUrl?: string;
}

export interface FetchAdaflowDeclarationsOptions {
  startUrl?: string;
  maxPages?: number;
  fetchFn?: typeof fetch;
}

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
 * Traverses Adaflow NFSe pages, fetches slideover details for each invoice,
 * and extracts reconciled declarations with Asaas payment IDs.
 */
export async function fetchAdaflowDeclarations(
  options: FetchAdaflowDeclarationsOptions = {},
): Promise<AdaflowReconciledDeclaration[]> {
  const startUrl = options.startUrl ?? '/nfses';
  const maxPages = options.maxPages ?? 50;
  const fetchFn = options.fetchFn ?? globalThis.fetch;

  let currentUrl: string | null = startUrl;
  let pagesFetched = 0;
  const visited = new Set<string>();
  const reconciledDeclarations: AdaflowReconciledDeclaration[] = [];

  while (currentUrl && pagesFetched < maxPages) {
    if (visited.has(currentUrl)) {
      break;
    }
    visited.add(currentUrl);
    pagesFetched++;

    let html: string;
    try {
      const response = await fetchFn(currentUrl, {
        credentials: 'same-origin',
      });
      if (!response.ok) {
        console.warn(
          `[PingouNota] Failed to fetch Adaflow page: ${currentUrl} (HTTP ${response.status})`,
        );
        break;
      }
      html = await response.text();
    } catch (err) {
      console.warn(`[PingouNota] Error fetching Adaflow page: ${currentUrl}`, err);
      break;
    }

    const { invoices, pagination } = parseAdaflowInvoicesPage(html);

    for (const invoice of invoices) {
      try {
        const detailPath = `/nfses/${invoice.adaflowNfseId}`;
        const detailUrl = currentUrl.startsWith('http')
          ? new URL(detailPath, currentUrl).toString()
          : detailPath;

        const detailResponse = await fetchFn(detailUrl, {
          headers: { 'Turbo-Frame': 'slideover_body' },
          credentials: 'same-origin',
        });

        if (!detailResponse.ok) {
          console.warn(
            `[PingouNota] Failed to fetch slideover for nfse ${invoice.adaflowNfseId} (HTTP ${detailResponse.status})`,
          );
          continue;
        }

        const detailHtml = await detailResponse.text();
        const slideoverDetail = parseAdaflowSlideover(detailHtml);

        if (slideoverDetail.asaasPaymentId) {
          reconciledDeclarations.push({
            asaasPaymentId: slideoverDetail.asaasPaymentId,
            adaflowNfseId: invoice.adaflowNfseId,
            nfseNumber: invoice.nfseNumber || undefined,
            date: invoice.date || undefined,
            amountCents: invoice.amountCents,
            pdfUrl: invoice.pdfUrl,
          });
        }
      } catch (err) {
        console.warn(
          `[PingouNota] Unexpected error fetching slideover for nfse ${invoice.adaflowNfseId}`,
          err,
        );
      }
    }

    if (pagination.nextHref) {
      if (currentUrl.startsWith('http')) {
        currentUrl = new URL(pagination.nextHref, currentUrl).toString();
      } else {
        const parsed = new URL(pagination.nextHref, 'https://app.adaflow.com');
        currentUrl = parsed.pathname + parsed.search;
      }
    } else {
      currentUrl = null;
    }
  }

  return reconciledDeclarations;
}

/**
 * Reconciles parsed Adaflow declarations against Asaas payments in IndexedDB.
 * Updates matching undeclared payments to 'marcado_localmente' with manualDeclaredAt.
 */
export async function reconcileAdaflowDeclarations(
  declarations: AdaflowReconciledDeclaration[],
  dbInstance: PingouNotaDB = db,
): Promise<ReconcileAdaflowResult> {
  let matchedCount = 0;
  let updatedCount = 0;

  for (const decl of declarations) {
    if (!decl.asaasPaymentId) continue;

    const payment = await dbInstance.payments
      .where('sourcePaymentId')
      .equals(decl.asaasPaymentId)
      .and((p) => p.provider === 'asaas')
      .first();

    if (payment) {
      matchedCount++;
      if (payment.declarationState === 'nao_declarado') {
        payment.declarationState = 'marcado_localmente';
        payment.manualDeclaredAt = decl.date
          ? normalizeDateIso(decl.date)
          : new Date().toISOString();
        await dbInstance.payments.put(payment);
        updatedCount++;
      }
    }
  }

  return {
    matchedCount,
    updatedCount,
    declarationsFound: declarations.length,
  };
}
