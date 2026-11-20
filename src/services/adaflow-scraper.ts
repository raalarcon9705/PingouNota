import {
  parseAdaflowInvoicesPage,
  parseAdaflowSlideover,
} from '../parsers/adaflow-parser';
import type { TakerProfile } from '../domain/taker';

export interface AdaflowReconciledDeclaration {
  asaasPaymentId: string;
  adaflowNfseId: number;
  nfseNumber?: string;
  date?: string;
  amountCents?: number;
  pdfUrl?: string;
  description?: string;
}

export interface AdaflowImportedTaker {
  serviceTakerId?: string;
  name: string;
  document?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: TakerProfile['address'];
  discoveredFromNfse?: string;
}

export interface AdaflowImportedTemplate {
  id?: string;
  name: string;
  description: string;
  cnae?: string;
  withholdTaxes?: boolean;
  discoveredFromNfse?: string;
}

export interface FetchAdaflowDeclarationsOptions {
  startUrl?: string;
  maxPages?: number;
  fetchFn?: typeof fetch;
}

export type FetchAdaflowDeclarationsResult = AdaflowReconciledDeclaration[] & {
  declarations: AdaflowReconciledDeclaration[];
  pagesScanned: number;
  totalInvoicesFound: number;
  takers: AdaflowImportedTaker[];
  templates: AdaflowImportedTemplate[];
};

/**
 * Traverses Adaflow NFSe pages using a guaranteed queue across all pages,
 * fetches slideover details for each invoice, extracts reconciled declarations
 * with Asaas payment IDs, and collects unique takers for reuse.
 * Independent of Dexie/database so it can be safely bundled into content scripts.
 */
export async function fetchAdaflowDeclarations(
  options: FetchAdaflowDeclarationsOptions = {},
): Promise<FetchAdaflowDeclarationsResult> {
  const startUrl = options.startUrl ?? '/nfses';
  const maxPages = options.maxPages ?? 50;
  const fetchFn = options.fetchFn ?? globalThis.fetch;

  console.info('[PingouNota:Adaflow] 🔍 Iniciando auditoria de notas fiscais emitidas...');

  const isHttp = startUrl.startsWith('http');
  const normalizeUrl = (href: string): string => {
    const url = new URL(href, 'https://app.adaflow.com');
    return isHttp
      ? new URL(url.pathname + url.search, startUrl).toString()
      : url.pathname + url.search;
  };

  const initialUrl = isHttp ? startUrl : normalizeUrl(startUrl);
  const pageQueue: string[] = [initialUrl];
  const visited = new Set<string>();
  const reconciledDeclarations: AdaflowReconciledDeclaration[] = [];
  const uniqueTakersMap = new Map<string, AdaflowImportedTaker>();
  const uniqueTemplatesMap = new Map<string, AdaflowImportedTemplate>();
  const allScannedNotes: Array<{
    adaflowNfseId: number;
    nfseNumber?: string;
    takerName?: string;
    asaasPaymentId?: string | null;
    description?: string;
    requiresManualAction: boolean;
  }> = [];

  let pagesFetched = 0;

  while (pageQueue.length > 0 && pagesFetched < maxPages) {
    const currentUrl = pageQueue.shift()!;
    if (visited.has(currentUrl)) {
      continue;
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
        continue;
      }
      html = await response.text();
    } catch (err) {
      console.warn(`[PingouNota] Error fetching Adaflow page: ${currentUrl}`, err);
      continue;
    }

    const { invoices, pagination } = parseAdaflowInvoicesPage(html);
    const currentPage = pagination.currentPage || pagesFetched;
    const nextHref = pagination.nextHref;

    console.info(
      `[PingouNota:Adaflow] 📄 Página ${currentPage}: ${invoices.length} notas encontradas. Próxima: ${nextHref || 'fim'}`,
    );

    // Queue discovered next and page links
    const discoveredHrefs: string[] = [];
    if (pagination.nextHref) {
      discoveredHrefs.push(pagination.nextHref);
    }
    if (pagination.pageHrefs) {
      discoveredHrefs.push(...pagination.pageHrefs);
    }

    for (const href of discoveredHrefs) {
      const norm = normalizeUrl(href);
      if (!visited.has(norm) && !pageQueue.includes(norm)) {
        pageQueue.push(norm);
      }
    }

    for (const invoice of invoices) {
      const nfseIdentifier = invoice.nfseNumber || `ID ${invoice.adaflowNfseId}`;

      if (invoice.takerName && invoice.takerName.trim()) {
        const name = invoice.takerName.trim();
        const key = invoice.serviceTakerId || name.toLowerCase();
        if (!uniqueTakersMap.has(key)) {
          uniqueTakersMap.set(key, {
            serviceTakerId: invoice.serviceTakerId,
            name,
            discoveredFromNfse: nfseIdentifier,
          });
        }
      }

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
          allScannedNotes.push({
            adaflowNfseId: invoice.adaflowNfseId,
            nfseNumber: invoice.nfseNumber || undefined,
            takerName: invoice.takerName || undefined,
            asaasPaymentId: null,
            description: undefined,
            requiresManualAction: true,
          });
          continue;
        }

        const detailHtml = await detailResponse.text();
        const slideoverDetail = parseAdaflowSlideover(detailHtml);

        // Merge enriched taker details from slideover
        const takerName = slideoverDetail.taker?.name || invoice.takerName?.trim();
        if (takerName) {
          const key = invoice.serviceTakerId || takerName.toLowerCase();
          const existing = uniqueTakersMap.get(key) || {
            serviceTakerId: invoice.serviceTakerId,
            name: takerName,
          };

          uniqueTakersMap.set(key, {
            ...existing,
            serviceTakerId: existing.serviceTakerId || invoice.serviceTakerId,
            name: takerName,
            document: slideoverDetail.taker?.document ?? existing.document ?? null,
            email: slideoverDetail.taker?.email ?? existing.email ?? null,
            phone: slideoverDetail.taker?.phone ?? existing.phone ?? null,
            address: slideoverDetail.taker?.address ?? existing.address,
            discoveredFromNfse: existing.discoveredFromNfse || nfseIdentifier,
          });
        }

        // Discover template candidates from slideover description if meaningful (>15 chars)
        if (slideoverDetail.description && slideoverDetail.description.trim().length > 15) {
          const rawDesc = slideoverDetail.description.trim();
          const cleanedDesc = rawDesc
            .replace(/[-–—,]?\s*referente [aà] cobran[çc]a Asaas\s*(?:n[º°o\.]|num\.?|#)?\s*[0-9][0-9\.\s\-_/]*[0-9]?/gi, '')
            .replace(/[-–—,]?\s*cobran[çc]a Asaas\s*(?:n[º°o\.]|num\.?|#)?\s*[0-9][0-9\.\s\-_/]*[0-9]?/gi, '')
            .replace(/[-–—,]?\s*Asaas\s*(?:n[º°o\.]|num\.?|#)?\s*[0-9][0-9\.\s\-_/]*[0-9]?/gi, '')
            .replace(/\s{2,}/g, ' ')
            .trim()
            .replace(/[,\-–—\.\s]+$/, '');

          const descCandidate = cleanedDesc.length >= 10 ? cleanedDesc : rawDesc;
          const firstLine = descCandidate.split('\n')[0] || descCandidate;
          const shortName = firstLine.length > 40 ? firstLine.slice(0, 37) + '...' : firstLine;
          const templateName = `Modelo - ${shortName}`;
          const templateKey = descCandidate.toLowerCase();

          if (!uniqueTemplatesMap.has(templateKey)) {
            uniqueTemplatesMap.set(templateKey, {
              name: templateName,
              description: descCandidate,
              discoveredFromNfse: nfseIdentifier,
            });
          }
        }

        const hasAsaasId = Boolean(slideoverDetail.asaasPaymentId);
        allScannedNotes.push({
          adaflowNfseId: invoice.adaflowNfseId,
          nfseNumber: invoice.nfseNumber || undefined,
          takerName: invoice.takerName || undefined,
          asaasPaymentId: slideoverDetail.asaasPaymentId,
          description: slideoverDetail.description,
          requiresManualAction: !hasAsaasId,
        });

        if (slideoverDetail.asaasPaymentId) {
          console.info(
            `[PingouNota:Adaflow] ✅ Nota ${invoice.nfseNumber || invoice.adaflowNfseId} -> Vinculada à cobrança Asaas nº ${slideoverDetail.asaasPaymentId}`,
          );
          if (slideoverDetail.description) {
            console.debug(
              `[PingouNota:Adaflow] 📝 Descrição da nota ${invoice.nfseNumber || invoice.adaflowNfseId}: ${slideoverDetail.description}`,
            );
          }
          reconciledDeclarations.push({
            asaasPaymentId: slideoverDetail.asaasPaymentId,
            adaflowNfseId: invoice.adaflowNfseId,
            nfseNumber: invoice.nfseNumber || undefined,
            date: invoice.date || undefined,
            amountCents: invoice.amountCents,
            pdfUrl: invoice.pdfUrl,
            description: slideoverDetail.description,
          });
        } else {
          console.debug(
            `[PingouNota:Adaflow] ℹ️ Nota ${invoice.nfseNumber || invoice.adaflowNfseId} (${invoice.takerName || 'sem tomador'}): sem referência Asaas`,
          );
          console.warn(
            `⚠️ [Atenção: Ação Manual Requerida] Nota ${invoice.nfseNumber || invoice.adaflowNfseId} (${invoice.takerName || 'sem tomador'}): sem referência Asaas identificada na descrição.`,
          );
          if (slideoverDetail.description) {
            console.debug(
              `[PingouNota:Adaflow] 📝 Descrição da nota ${invoice.nfseNumber || invoice.adaflowNfseId}: ${slideoverDetail.description}`,
            );
          }
        }
      } catch (err) {
        console.warn(
          `[PingouNota] Unexpected error fetching slideover for nfse ${invoice.adaflowNfseId}`,
          err,
        );
      }
    }
  }

  const summary = reconciledDeclarations.map((item) => ({
    'ID Asaas': item.asaasPaymentId,
    'NFSe Nº': item.nfseNumber || `ID ${item.adaflowNfseId}`,
    'Data': item.date || 'N/A',
    'Valor (R$)': item.amountCents !== undefined ? (item.amountCents / 100).toFixed(2) : 'N/A',
    'Descrição': item.description || '',
  }));

  console.groupCollapsed('[PingouNota:Adaflow] 📊 Resumo de notas com referência Asaas encontradas');
  console.table(summary);
  console.groupEnd();

  console.group('[PingouNota:Adaflow] 📋 Detalhe das Notas Fiscais Escaneadas');
  console.table(
    allScannedNotes.map((n) => ({
      'NFSe Nº': n.nfseNumber || `ID ${n.adaflowNfseId}`,
      'Tomador': n.takerName || 'N/A',
      'ID Asaas': n.asaasPaymentId || '(nenhum)',
      'Descrição': n.description || '',
      'Ação Manual': n.requiresManualAction ? '⚠️ Sim' : 'Não',
    })),
  );
  console.groupEnd();

  const takers = Array.from(uniqueTakersMap.values());
  const templates = Array.from(uniqueTemplatesMap.values());

  const result = Object.assign(reconciledDeclarations, {
    declarations: reconciledDeclarations,
    pagesScanned: pagesFetched,
    totalInvoicesFound: allScannedNotes.length,
    takers,
    templates,
  });

  return result as FetchAdaflowDeclarationsResult;
}
