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
  description?: string;
}

export interface FetchAdaflowDeclarationsOptions {
  startUrl?: string;
  maxPages?: number;
  fetchFn?: typeof fetch;
}

/**
 * Traverses Adaflow NFSe pages, fetches slideover details for each invoice,
 * and extracts reconciled declarations with Asaas payment IDs.
 * Independent of Dexie/database so it can be safely bundled into content scripts.
 */
export async function fetchAdaflowDeclarations(
  options: FetchAdaflowDeclarationsOptions = {},
): Promise<AdaflowReconciledDeclaration[]> {
  const startUrl = options.startUrl ?? '/nfses';
  const maxPages = options.maxPages ?? 10;
  const fetchFn = options.fetchFn ?? globalThis.fetch;

  console.info('[PingouNota:Adaflow] 🔍 Iniciando auditoria de notas fiscais emitidas...');

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
    const currentPage = pagination.currentPage || pagesFetched;
    const nextHref = pagination.nextHref;

    console.info(
      `[PingouNota:Adaflow] 📄 Página ${currentPage}: ${invoices.length} notas encontradas. Próxima: ${nextHref || 'fim'}`,
    );

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

  return reconciledDeclarations;
}
