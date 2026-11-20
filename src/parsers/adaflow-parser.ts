import { parseBrlAmountToCents } from './asaas-parser';

export interface AdaflowParsedInvoice {
  adaflowNfseId: number;
  nfseNumber: string;
  date: string;
  takerName: string;
  amountCents: number;
  status: string;
  pdfUrl?: string;
  xmlUrl?: string;
}

export interface AdaflowParsedPagination {
  currentPage: number;
  nextHref: string | null;
  pageHrefs: string[];
}

export interface AdaflowInvoicesPageResult {
  invoices: AdaflowParsedInvoice[];
  pagination: AdaflowParsedPagination;
}

export interface AdaflowSlideoverDetail {
  asaasPaymentId: string | null;
  description?: string;
}

function resolveDocument(htmlOrDoc: string | Document | Element): Document | Element {
  if (typeof htmlOrDoc !== 'string') {
    return htmlOrDoc;
  }
  if (typeof DOMParser !== 'undefined') {
    return new DOMParser().parseFromString(htmlOrDoc, 'text/html');
  }
  throw new Error('DOMParser is not available in the current environment');
}

/**
 * Extracts Asaas Payment ID using strict priority regexes:
 * 1. referente à cobran[çc]a Asaas nº\s*(\d+) (case-insensitive)
 * 2. Asaas nº\s*(\d+)
 * 3. cobran[çc]a Asaas\s*(\d+)
 * 4. Asaas\s*#?\s*(\d{7,12})
 */
export function extractAsaasPaymentId(text: string | null | undefined): string | null {
  if (!text) return null;

  const patterns = [
    /referente [aà] cobran[çc]a Asaas\s*(?:n[º°o\.]|num\.?)?\s*(\d+)/i,
    /cobran[çc]a Asaas\s*(?:n[º°o\.]|num\.?)?\s*(\d+)/i,
    /Asaas\s*(?:n[º°o\.]|num\.?|#)?\s*(\d+)/i,
  ];

  for (const regex of patterns) {
    const match = text.match(regex);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * Parses an individual Adaflow invoice card element.
 * Card structure: <div id="nfse_{id}" data-nfse-id="{id}" class="group hover:bg-gray-50">
 */
export function parseAdaflowInvoiceCard(cardEl: Element): AdaflowParsedInvoice | null {
  const dataId = cardEl.getAttribute('data-nfse-id');
  const idFromAttr = cardEl.id ? cardEl.id.replace(/^nfse_/, '') : null;
  const linkHref = cardEl.querySelector('a[href^="/nfses/"]')?.getAttribute('href');
  const linkIdMatch = linkHref?.match(/\/nfses\/(\d+)/);

  const rawId = dataId || idFromAttr || (linkIdMatch ? linkIdMatch[1] : null);
  const adaflowNfseId = rawId ? parseInt(rawId, 10) : NaN;
  if (isNaN(adaflowNfseId)) {
    return null;
  }

  const pElements = Array.from(cardEl.querySelectorAll('p'));
  const pTexts = pElements.map((p) => p.textContent?.trim() || '');

  // Extract date: DD/MM/YYYY
  const dateFromP = pTexts.find((t) => /^\d{2}\/\d{2}\/\d{4}$/.test(t));
  const dateMatch = dateFromP || cardEl.textContent?.match(/\b(\d{2}\/\d{2}\/\d{4})\b/)?.[1] || '';

  // Extract NFSe number: e.g. "Nº 78" or "78"
  const nfseNumberFromP = pTexts.find((t) => /^N[º°]?\s*\d+$/i.test(t));
  const nfseNumberMatch =
    nfseNumberFromP || cardEl.textContent?.match(/\bN[º°]?\s*\d+\b/i)?.[0] || '';

  // Extract taker name
  const takerEl =
    cardEl.querySelector('p.font-semibold.text-base.truncate') ||
    cardEl.querySelector('p.font-semibold.truncate') ||
    cardEl.querySelector('.font-semibold');
  const takerName = takerEl?.textContent?.trim() || '';

  // Extract amount
  const amountEl =
    cardEl.querySelector('[data-privacy-money-toggle-target="moneyValue"]') ||
    cardEl.querySelector('span.inline-block');
  const amountText = amountEl?.textContent?.trim() || '';
  const parsedCents = parseBrlAmountToCents(amountText);
  const amountCents = parsedCents !== null ? parsedCents : 0;

  // Extract status: e.g. "Emitido"
  const statusEl = cardEl.querySelector('span[class*="status-chip"]');
  const status = statusEl?.textContent?.trim() || '';

  // Extract PDF and XML URLs
  const pdfEl = cardEl.querySelector(
    'a[href*=".pdf"], a[title*="PDF"], a[href*="disposition=preview"]',
  );
  const pdfUrl = pdfEl?.getAttribute('href') || undefined;

  const xmlEl = cardEl.querySelector('a[href*=".xml"], a[title*="XML"]');
  const xmlUrl = xmlEl?.getAttribute('href') || undefined;

  return {
    adaflowNfseId,
    nfseNumber: nfseNumberMatch,
    date: dateMatch,
    takerName,
    amountCents,
    status,
    pdfUrl,
    xmlUrl,
  };
}

/**
 * Parses pagination from <nav class="pagy series-nav">.
 */
export function parseAdaflowPagination(root: Element | Document): AdaflowParsedPagination {
  const nav = root.querySelector('nav.pagy, nav[class*="pagy"]');
  if (!nav) {
    return {
      currentPage: 1,
      nextHref: null,
      pageHrefs: [],
    };
  }

  let currentPage = 1;
  const currentEl =
    nav.querySelector('[aria-current="page"]') ||
    nav.querySelector('.current') ||
    nav.querySelector('span.current');
  if (currentEl) {
    const parsedPage = parseInt(currentEl.textContent?.trim() || '', 10);
    if (!isNaN(parsedPage)) {
      currentPage = parsedPage;
    }
  }

  const nextEl = nav.querySelector('a[rel="next"]');
  const nextHref = nextEl ? nextEl.getAttribute('href') : null;

  const allLinks = Array.from(nav.querySelectorAll('a[href]'));
  const pageHrefs: string[] = [];

  for (const a of allLinks) {
    const href = a.getAttribute('href');
    if (href && !pageHrefs.includes(href)) {
      pageHrefs.push(href);
    }
  }

  return {
    currentPage,
    nextHref,
    pageHrefs,
  };
}

/**
 * Parses the full Adaflow invoices list page.
 */
export function parseAdaflowInvoicesPage(htmlOrDoc: string | Document): AdaflowInvoicesPageResult {
  const doc = resolveDocument(htmlOrDoc);

  const cardElements = Array.from(
    doc.querySelectorAll('div[id^="nfse_"][data-nfse-id], div[data-nfse-id]'),
  );

  const invoices: AdaflowParsedInvoice[] = [];
  for (const card of cardElements) {
    const invoice = parseAdaflowInvoiceCard(card);
    if (invoice) {
      invoices.push(invoice);
    }
  }

  const pagination = parseAdaflowPagination(doc);

  return {
    invoices,
    pagination,
  };
}

/**
 * Parses slideover detail HTML returned from GET /nfses/:id with Turbo-Frame: slideover_body.
 */
export function parseAdaflowSlideover(
  htmlOrDoc: string | Document | Element,
): AdaflowSlideoverDetail {
  const root = resolveDocument(htmlOrDoc);

  const frame =
    root.querySelector('turbo-frame#slideover_body') ||
    root.querySelector('#slideover_body') ||
    (root instanceof Element && (root.id === 'slideover_body' || root.tagName.toLowerCase() === 'turbo-frame')
      ? root
      : null);

  const searchScope = frame || root;

  // Attempt to locate a specific description block
  const descEl =
    searchScope.querySelector('[data-field="description"]') ||
    searchScope.querySelector('.service-description') ||
    searchScope.querySelector('p.whitespace-pre-wrap') ||
    searchScope.querySelector('div.whitespace-pre-wrap');

  const description =
    descEl?.textContent?.trim() ||
    frame?.textContent?.trim() ||
    (root instanceof Element ? root.textContent?.trim() : root.body?.textContent?.trim()) ||
    undefined;

  const fullTextToSearch = [
    description,
    frame?.textContent,
    root instanceof Element ? root.textContent : root.body?.textContent,
  ]
    .filter(Boolean)
    .join('\n');

  const asaasPaymentId = extractAsaasPaymentId(fullTextToSearch);

  return {
    asaasPaymentId,
    description,
  };
}
