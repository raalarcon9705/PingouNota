import type { PaymentProvider } from '../domain/payment';
import type { ParseResult, PaginationResult } from '../shared/observed-payment';
import { parseAsaasPayments } from '../parsers/asaas-parser';
import { parseHuskyPayments } from '../parsers/husky-parser';

export interface ProviderAdapter {
  provider: PaymentProvider;
  parse(document: Document): ParseResult;
  nextPage(document: Document): PaginationResult;
  isSupportedRoute(url: string): boolean;
}

export function isSupportedAsaasRoute(urlStr: string): boolean {
  if (!urlStr || typeof urlStr !== 'string') return false;
  if (urlStr.startsWith('/') && !urlStr.startsWith('//')) {
    const path = (urlStr.split('?')[0] ?? '').split('#')[0] ?? '';
    return (
      path.startsWith('/customerPayment/index') ||
      path.startsWith('/customerPayment/list') ||
      path.startsWith('/app/cobranzas') ||
      path === '/customerPayment'
    );
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
    return (
      path.startsWith('/customerPayment/index') ||
      path.startsWith('/customerPayment/list') ||
      path.startsWith('/app/cobranzas') ||
      path === '/customerPayment'
    );
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

export const asaasAdapter: ProviderAdapter = {
  provider: 'asaas',
  parse: parseAsaasPayments,
  nextPage: getAsaasNextPage,
  isSupportedRoute: isSupportedAsaasRoute,
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
