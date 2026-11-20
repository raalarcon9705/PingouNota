import type { PaymentProvider } from '../domain/payment';
import type { ParseResult, PaginationResult } from '../shared/observed-payment';
import { parseAsaasPayments } from '../parsers/asaas-parser';
import { parseHuskyPayments } from '../parsers/husky-parser';

export interface ProviderAdapter {
  provider: PaymentProvider;
  parse(document: Document): ParseResult;
  nextPage(document: Document): PaginationResult;
  isSupportedRoute(url: string): boolean;
  fetchPayments?(
    page?: number,
    itemsPerPage?: number,
    fallbackDoc?: Document,
    fetchFn?: typeof fetch,
    maxPages?: number,
  ): Promise<ParseResult>;
}

function isAllowedAsaasPath(path: string): boolean {
  if (path.startsWith('/paymentList')) {
    return false;
  }
  return (
    path.startsWith('/customerPayment/index') ||
    path.startsWith('/customerPayment/list') ||
    path.startsWith('/app/cobranzas') ||
    path === '/customerPayment' ||
    path.startsWith('/payment/list') ||
    path.startsWith('/payment/index') ||
    path === '/payment' ||
    path.startsWith('/payment/')
  );
}

export function isSupportedAsaasRoute(urlStr: string): boolean {
  if (!urlStr || typeof urlStr !== 'string') return false;
  if (urlStr.startsWith('/') && !urlStr.startsWith('//')) {
    const path = (urlStr.split('?')[0] ?? '').split('#')[0] ?? '';
    return isAllowedAsaasPath(path);
  }
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    const isAsaasHost =
      host === 'asaas.com' ||
      host.endsWith('.asaas.com') ||
      host === 'localhost' ||
      host === '127.0.0.1';
    if (!isAsaasHost) return false;
    const path = parsed.pathname;
    return isAllowedAsaasPath(path);
  } catch {
    return false;
  }
}

export function getAsaasNextPage(doc: Document): PaginationResult {
  const nextBtn = doc.querySelector(
    'a.pagination-next, [data-testid="pagination-next"], a[rel="next"], .pagination .next a, li.pagination-next a',
  );

  if (!nextBtn) {
    const hasPaginationContainer = doc.querySelector(
      '.pagination, [data-testid="pagination"], ul.pager',
    );
    if (hasPaginationContainer) {
      return { kind: 'unsupported', reason: 'Pagination control could not be identified' };
    }
    return { kind: 'end' };
  }

  const isDisabled =
    nextBtn.hasAttribute('disabled') ||
    nextBtn.getAttribute('aria-disabled') === 'true' ||
    nextBtn.classList.contains('disabled') ||
    nextBtn.closest('.disabled') !== null;

  const href = nextBtn.getAttribute('href')?.trim();
  if (isDisabled || !href || href === '#' || href.startsWith('javascript:')) {
    return { kind: 'end' };
  }

  if (!isSupportedAsaasRoute(href)) {
    return {
      kind: 'unsupported',
      reason: `Rejected next-page target outside allowed route: ${href}`,
    };
  }

  return { kind: 'next', href };
}

export async function fetchAsaasPayments(
  page: number = 1,
  itemsPerPage: number = 50,
  fallbackDoc?: Document,
  fetchFn: typeof fetch = typeof fetch !== 'undefined' ? fetch : globalThis.fetch,
  maxPages: number = 20,
): Promise<ParseResult> {
  const currentDoc = fallbackDoc || (typeof document !== 'undefined' ? document : undefined);

  try {
    const origin =
      typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null'
        ? window.location.origin
        : '';

    const buildUrl = (p: number, limit: number) =>
      `${origin}/paymentList/loadTableContent?status=CONFIRMED&status=RECEIVED&page=${p}&itemsPerPage=${limit}`;

    const fetchSinglePage = async (p: number) => {
      const url = buildUrl(p, itemsPerPage);
      const res = await fetchFn(url, {
        method: 'GET',
        headers: {
          accept: '*/*',
          'x-requested-with': 'XMLHttpRequest',
        },
        credentials: 'same-origin',
      });

      if (!res.ok) {
        throw new Error(`Fetch failed with status ${res.status}`);
      }

      const data = await res.json();
      if (!data || !data.success || typeof data.content !== 'string') {
        throw new Error('API response indicated failure or missing content');
      }

      return {
        content: data.content as string,
        totalRecords: typeof data.totalRecords === 'number' ? data.totalRecords : 0,
      };
    };

    const firstPage = await fetchSinglePage(page);
    let combinedContent = firstPage.content;
    const totalRecords = firstPage.totalRecords;
    const pageSize = (firstPage.content.match(/<atlas-table-row/g) || []).length || itemsPerPage;
    const totalPages = Math.ceil(totalRecords / pageSize);

    const firstDoc = new DOMParser().parseFromString(firstPage.content, 'text/html');
    const firstResult = parseAsaasPayments(firstDoc);
    const accumulated = [...firstResult.payments];

    console.info(
      `[PingouNota:Asaas] 🔍 Escaneando cobranças... Página ${page}: ${firstResult.payments.length} encontradas (Total acumulado: ${accumulated.length} de ${totalRecords})`,
    );

    // If there are more pages, fetch remaining pages up to maxPages
    if (totalPages > 1 && maxPages > 1) {
      const lastPageToFetch = Math.min(totalPages, page + maxPages - 1);
      try {
        for (let p = page + 1; p <= lastPageToFetch; p++) {
          const nextData = await fetchSinglePage(p);
          combinedContent += '\n' + nextData.content;
          const pageDoc = new DOMParser().parseFromString(nextData.content, 'text/html');
          const pageResult = parseAsaasPayments(pageDoc);
          accumulated.push(...pageResult.payments);
          console.info(
            `[PingouNota:Asaas] 🔍 Escaneando cobranças... Página ${p}: ${pageResult.payments.length} encontradas (Total acumulado: ${accumulated.length} de ${totalRecords})`,
          );
        }
      } catch (loopErr) {
        console.warn?.('[PingouNota] Failed to fetch subsequent page, parsing partial batch:', loopErr);
      }
    }

    const parsedDoc = new DOMParser().parseFromString(combinedContent, 'text/html');
    const result = parseAsaasPayments(parsedDoc);
    const allPayments = result.payments;

    console.groupCollapsed(`[PingouNota:Asaas] 📋 Cobranças sincronizadas (${allPayments.length} pagamentos)`);
    console.table(
      allPayments.map((p) => ({
        ID: p.sourcePaymentId,
        Pagador: p.payerName,
        Valor: (p.amountCents || 0) / 100,
        Estado: p.paymentState,
        Status: p.sourceStatus,
      })),
    );
    console.groupEnd();

    return {
      ...result,
      pagination: { kind: 'end' },
    };
  } catch (err) {
    if (currentDoc) {
      const parsed = asaasAdapter.parse(currentDoc);
      const allPayments = parsed.payments;
      console.info(
        `[PingouNota:Asaas] 🔍 Escaneando cobranças... Página 1: ${allPayments.length} encontradas (Total acumulado: ${allPayments.length} de ${allPayments.length})`,
      );
      console.groupCollapsed(`[PingouNota:Asaas] 📋 Cobranças sincronizadas (${allPayments.length} pagamentos)`);
      console.table(
        allPayments.map((p) => ({
          ID: p.sourcePaymentId,
          Pagador: p.payerName,
          Valor: (p.amountCents || 0) / 100,
          Estado: p.paymentState,
          Status: p.sourceStatus,
        })),
      );
      console.groupEnd();
      return parsed;
    }
    return {
      payments: [],
      warnings: [
        {
          code: 'unsupported_layout',
          message: `Fetch failed and no fallback document available: ${err instanceof Error ? err.message : String(err)}`,
          rowIndex: null,
        },
      ],
      pagination: {
        kind: 'unsupported',
        reason: 'Fetch failed and no fallback document available',
      },
    };
  }
}

export const asaasAdapter: ProviderAdapter = {
  provider: 'asaas',
  parse: parseAsaasPayments,
  nextPage: getAsaasNextPage,
  isSupportedRoute: isSupportedAsaasRoute,
  fetchPayments: fetchAsaasPayments,
};

export function isSupportedHuskyRoute(urlStr: string): boolean {
  if (!urlStr || typeof urlStr !== 'string') return false;
  if (urlStr.startsWith('/') && !urlStr.startsWith('//')) {
    const path = (urlStr.split('?')[0] ?? '').split('#')[0] ?? '';
    return (
      path.startsWith('/transfers') ||
      path.startsWith('/payments') ||
      path.startsWith('/dashboard') ||
      path.startsWith('/app/transfers')
    );
  }
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    const isHuskyHost =
      host === 'husky.io' ||
      host.endsWith('.husky.io') ||
      host === 'localhost' ||
      host === '127.0.0.1';
    if (!isHuskyHost) return false;
    const path = parsed.pathname;
    return (
      path.startsWith('/transfers') ||
      path.startsWith('/payments') ||
      path.startsWith('/dashboard') ||
      path.startsWith('/app/transfers')
    );
  } catch {
    return false;
  }
}

export function getHuskyNextPage(doc: Document): PaginationResult {
  const nextBtn = doc.querySelector(
    '[data-testid="pagination-next"], a.pagination-next, a[rel="next"], .pagination .next a',
  );

  if (!nextBtn) {
    const hasPaginationContainer = doc.querySelector(
      '.pagination, [data-testid="pagination"], ul.pager',
    );
    if (hasPaginationContainer) {
      return { kind: 'unsupported', reason: 'Pagination control could not be identified' };
    }
    return { kind: 'end' };
  }

  const isDisabled =
    nextBtn.hasAttribute('disabled') ||
    nextBtn.getAttribute('aria-disabled') === 'true' ||
    nextBtn.classList.contains('disabled') ||
    nextBtn.closest('.disabled') !== null;

  const href = nextBtn.getAttribute('href')?.trim();
  if (isDisabled || !href || href === '#' || href.startsWith('javascript:')) {
    return { kind: 'end' };
  }

  if (!isSupportedHuskyRoute(href)) {
    return {
      kind: 'unsupported',
      reason: `Rejected next-page target outside allowed route: ${href}`,
    };
  }

  return { kind: 'next', href };
}

export const huskyAdapter: ProviderAdapter = {
  provider: 'husky',
  parse: parseHuskyPayments,
  nextPage: getHuskyNextPage,
  isSupportedRoute: isSupportedHuskyRoute,
};
