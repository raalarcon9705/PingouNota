import { parseBrlAmountToCents } from './asaas-parser';

export interface AdaflowParsedInvoice {
  adaflowNfseId: number;
  nfseNumber: string;
  date: string;
  takerName: string;
  serviceTakerId?: string;
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

export interface AdaflowSlideoverTaker {
  name?: string;
  document?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: {
    line1: string;
    number: string | null;
    neighborhood: string | null;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
}

export interface AdaflowSlideoverDetail {
  asaasPaymentId: string | null;
  description?: string;
  taker?: AdaflowSlideoverTaker;
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
 * Extracts Asaas Payment ID using robust candidate punctuation matching and normalization:
 * Captures tokens like 89.155.748, 89 155 748, 89-155748, 891557/1, etc.
 * Normalizes all punctuation to digits and verifies length.
 */
export function extractAsaasPaymentId(text: string | null | undefined): string | null {
  if (!text) return null;

  const patterns = [
    /referente [aà] cobran[çc]a Asaas\s*(?:n[º°o\.]|num\.?|#)?\s*([0-9][0-9\.\s\-_/]*[0-9]|\d+)/i,
    /cobran[çc]a Asaas\s*(?:n[º°o\.]|num\.?|#)?\s*([0-9][0-9\.\s\-_/]*[0-9]|\d+)/i,
    /Asaas\s*(?:n[º°o\.]|num\.?|#)?\s*([0-9][0-9\.\s\-_/]*[0-9]|\d+)/i,
  ];

  for (const regex of patterns) {
    const match = text.match(regex);
    if (match && match[1]) {
      const rawMatch = match[1];
      const cleaned = rawMatch.replace(/\D/g, '');
      if (cleaned.length >= 7) {
        return cleaned;
      }
      // Constrain fallback to the context near the Asaas mention
      const contextStartIndex = Math.max(0, (match.index ?? 0) - 20);
      const nearbyContext = text.slice(contextStartIndex, (match.index ?? 0) + match[0].length + 50);
      const fallbackMatch = nearbyContext.match(/(?:^|\D)(\d{8,12})(?:\D|$)/);
      if (fallbackMatch && fallbackMatch[1]) {
        return fallbackMatch[1];
      }
      if (cleaned.length > 0) {
        return cleaned;
      }
    }
  }

  // Handle case where text itself is purely a formatted numeric token (e.g. "89.155.748")
  const trimmed = text.trim();
  if (/^[0-9][0-9\.\s\-_/]*[0-9]$|^\d+$/.test(trimmed)) {
    const cleaned = trimmed.replace(/\D/g, '');
    if (cleaned.length > 0) {
      return cleaned;
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

  // Extract duplicate link to obtain service_taker_id query param
  const duplicateLink = cardEl.querySelector('a[href*="service_taker_id="]')?.getAttribute('href');
  const serviceTakerIdMatch = duplicateLink?.match(/service_taker_id=(\d+)/);
  const serviceTakerId = serviceTakerIdMatch ? serviceTakerIdMatch[1] : undefined;

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
    serviceTakerId,
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

function extractAddressFromScope(scope: Element | Document): {
  line1: string;
  number: string | null;
  neighborhood: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
} | undefined {
  const line1El = scope.querySelector(
    '[data-field="taker_address_line1"], [data-field="address_line1"], [data-field="logradouro"], .address-line1',
  );
  const numberEl = scope.querySelector(
    '[data-field="taker_address_number"], [data-field="address_number"], [data-field="numero"], .address-number',
  );
  const neighborhoodEl = scope.querySelector(
    '[data-field="taker_address_neighborhood"], [data-field="address_neighborhood"], [data-field="bairro"], .address-neighborhood',
  );
  const cityEl = scope.querySelector(
    '[data-field="taker_address_city"], [data-field="address_city"], [data-field="cidade"], .address-city',
  );
  const stateEl = scope.querySelector(
    '[data-field="taker_address_state"], [data-field="address_state"], [data-field="uf"], [data-field="estado"], .address-state',
  );
  const postalCodeEl = scope.querySelector(
    '[data-field="taker_address_postal_code"], [data-field="address_postal_code"], [data-field="cep"], .address-cep',
  );
  const countryEl = scope.querySelector(
    '[data-field="taker_address_country"], [data-field="address_country"], [data-field="pais"], .address-country',
  );

  if (line1El || cityEl || postalCodeEl) {
    return {
      line1: line1El?.textContent?.trim() || '',
      number: numberEl?.textContent?.trim() || null,
      neighborhood: neighborhoodEl?.textContent?.trim() || null,
      city: cityEl?.textContent?.trim() || '',
      state: stateEl?.textContent?.trim() || '',
      postalCode: postalCodeEl?.textContent?.trim() || '',
      country: countryEl?.textContent?.trim() || 'BR',
    };
  }

  const addrContainer = scope.querySelector(
    '[data-field="taker_address"], .taker-address, [data-field="address"], .address',
  );
  if (addrContainer) {
    const raw = addrContainer.textContent?.trim() || '';
    if (raw) {
      const cepMatch = raw.match(/\b\d{5}-?\d{3}\b/);
      const postalCode = cepMatch ? cepMatch[0] : '';
      const stateMatch = raw.match(/(?:-\s*|\/\s*|\b)([A-Z]{2})\b/);
      const state = stateMatch ? stateMatch[1] : '';

      const parts = raw.split(',').map((s) => s.trim());
      const line1 = parts[0] || raw;
      const number = parts[1] && /^\d+[\w\s]*$/.test(parts[1]) ? parts[1] : null;
      const part2 = parts[2];
      const neighborhood = part2 && !part2.includes('-') ? part2 : null;
      let city = '';
      if (state) {
        const cityMatch = raw.match(/,\s*([^,\-]+?)\s*-\s*[A-Z]{2}/);
        if (cityMatch && cityMatch[1]) city = cityMatch[1].trim();
      }

      return {
        line1,
        number,
        neighborhood,
        city: city || 'Não informada',
        state: state || 'SP',
        postalCode: postalCode || '00000-000',
        country: 'BR',
      };
    }
  }

  return undefined;
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

  // Extract taker information if present
  const takerScope =
    searchScope.querySelector('[data-section="taker"], .taker-section, .service-taker') ||
    searchScope;

  const nameEl = takerScope.querySelector(
    '[data-field="taker_name"], .taker-name, [data-field="service_taker_name"], .service-taker-name',
  );
  const takerName = nameEl?.textContent?.trim();

  const docEl = takerScope.querySelector(
    '[data-field="taker_document"], .taker-document, [data-field="document"]',
  );
  let takerDoc = docEl?.textContent?.trim();
  if (!takerDoc) {
    const docMatch = takerScope.textContent?.match(
      /(?:\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b|\b\d{3}\.\d{3}\.\d{3}-\d{2}\b)/,
    );
    if (docMatch) {
      takerDoc = docMatch[0];
    }
  }

  const emailEl = takerScope.querySelector(
    '[data-field="taker_email"], .taker-email, a[href^="mailto:"]',
  );
  let takerEmail =
    emailEl?.getAttribute('href')?.replace(/^mailto:/i, '').trim() ||
    emailEl?.textContent?.trim();
  if (!takerEmail) {
    const emailMatch = takerScope.textContent?.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (emailMatch) {
      takerEmail = emailMatch[0];
    }
  }

  const phoneEl = takerScope.querySelector(
    '[data-field="taker_phone"], .taker-phone, a[href^="tel:"]',
  );
  let takerPhone =
    phoneEl?.getAttribute('href')?.replace(/^tel:/i, '').trim() ||
    phoneEl?.textContent?.trim();
  if (!takerPhone) {
    const phoneMatch = takerScope.textContent?.match(
      /(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)(?:9\d{4}[-\s]?\d{4}|\d{4}[-\s]?\d{4})/,
    );
    if (phoneMatch) {
      takerPhone = phoneMatch[0].trim();
    }
  }

  const takerAddress = extractAddressFromScope(takerScope);

  let taker: AdaflowSlideoverTaker | undefined;
  if (takerName || takerDoc || takerEmail || takerPhone || takerAddress) {
    taker = {
      name: takerName,
      document: takerDoc || null,
      email: takerEmail || null,
      phone: takerPhone || null,
      address: takerAddress,
    };
  }

  return {
    asaasPaymentId,
    description,
    taker,
  };
}
