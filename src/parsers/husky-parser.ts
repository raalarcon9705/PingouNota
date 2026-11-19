import { normalizePaymentState } from '../domain/declaration';
import type { ObservedPayment, ParseResult, ParseWarning, PaginationResult } from '../shared/observed-payment';
import { parseDateToIso } from './asaas-parser';

export function parseHuskyCurrencyAndAmount(rawText: string | null | undefined): {
  amountCents: number | null;
  currency: string | null;
} {
  if (!rawText) return { amountCents: null, currency: null };
  const trimmed = rawText.trim();
  if (!trimmed) return { amountCents: null, currency: null };

  let currency: string | null = null;
  const upper = trimmed.toUpperCase();
  if (upper.includes('USD')) {
    currency = 'USD';
  } else if (upper.includes('EUR') || upper.includes('€')) {
    currency = 'EUR';
  } else if (upper.includes('GBP') || upper.includes('£')) {
    currency = 'GBP';
  } else if (upper.includes('CAD')) {
    currency = 'CAD';
  } else if (upper.includes('AUD')) {
    currency = 'AUD';
  } else if (upper.includes('BRL') || upper.includes('R$')) {
    currency = 'BRL';
  } else if (trimmed.includes('$')) {
    currency = 'USD';
  } else {
    currency = 'USD';
  }

  const cleaned = trimmed.replace(/[A-Za-z$€£R]/g, '').trim();
  if (!cleaned || !/\d/.test(cleaned)) {
    return { amountCents: null, currency };
  }

  let normalized: string;
  if (cleaned.includes('.') && cleaned.includes(',')) {
    if (cleaned.indexOf('.') < cleaned.indexOf(',')) {
      // Brazilian format: 1.234,56
      normalized = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      // US format: 1,234.56
      normalized = cleaned.replace(/,/g, '');
    }
  } else if (cleaned.includes(',')) {
    // e.g. 500,00
    normalized = cleaned.replace(',', '.');
  } else {
    // e.g. 500.00 or 500
    normalized = cleaned;
  }
  const parsed = parseFloat(normalized);
  if (isNaN(parsed)) {
    return { amountCents: null, currency };
  }

  return {
    amountCents: Math.round(parsed * 100),
    currency,
  };
}

function parsePagination(doc: Document): PaginationResult {
  const nextBtn = doc.querySelector(
    '[data-testid="pagination-next"], a.pagination-next, a[rel="next"], .pagination .next a',
  );

  if (!nextBtn) {
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

  return { kind: 'next', href };
}

export function parseHuskyPayments(document: Document): ParseResult {
  const container = document.querySelector(
    '[data-testid="transfers-list"], .transfers-container, .husky-transfers-list',
  );

  if (!container) {
    return {
      payments: [],
      warnings: [
        {
          code: 'unsupported_layout',
          message: 'Lista de transferências do Husky não encontrada no documento.',
          rowIndex: null,
        },
      ],
      pagination: {
        kind: 'unsupported',
        reason: 'Lista de transferências não encontrada',
      },
    };
  }

  const cardElements = Array.from(
    container.querySelectorAll(
      'article.transfer-card, [data-testid="transfer-card"], .transfer-card, div.transfer-row, div[data-transfer-id]',
    ),
  );

  const payments: ObservedPayment[] = [];
  const warnings: ParseWarning[] = [];

  cardElements.forEach((card, index) => {
    let sourcePaymentId =
      card.getAttribute('data-transfer-id')?.trim() ||
      card.getAttribute('data-payment-id')?.trim() ||
      null;

    if (!sourcePaymentId) {
      const idEl = card.querySelector('.transfer-id, [data-field="transfer-id"]');
      const text = idEl?.textContent?.trim();
      if (text && text !== '-' && text !== '—' && text !== 'N/A') {
        sourcePaymentId = text;
      }
    }

    const identityConfidence = sourcePaymentId ? 'high' : 'low';
    if (!sourcePaymentId) {
      warnings.push({
        code: 'missing_id',
        message: `ID da transferência ausente no card ${index + 1}`,
        rowIndex: index,
      });
    }

    const senderEl = card.querySelector(
      '[data-field="sender"] .transfer-sender, .transfer-sender, [data-field="sender"], .sender-name, [data-field="payer"]',
    );
    const payerName = senderEl?.textContent?.trim() || null;

    const dateElem = card.querySelector('[data-field="date"], .transfer-date, .payment-date');
    const paymentDate = parseDateToIso(dateElem?.textContent?.trim());

    const amountElem = card.querySelector(
      '[data-field="amount"] .transfer-amount, .transfer-amount, [data-field="amount"]',
    );
    const { amountCents, currency } = parseHuskyCurrencyAndAmount(amountElem?.textContent?.trim());
    if (amountCents === null) {
      warnings.push({
        code: 'missing_amount',
        message: `Valor ausente ou inválido no card ${index + 1}`,
        rowIndex: index,
      });
    }

    const statusElem = card.querySelector(
      '[data-field="status"], .transfer-status, .badge',
    );
    const sourceStatus = statusElem?.textContent?.trim() || '';
    const paymentState = normalizePaymentState(sourceStatus, 'husky');
    if (paymentState === 'desconhecido') {
      warnings.push({
        code: 'unknown_status',
        message: `Status desconhecido "${sourceStatus}" no card ${index + 1}`,
        rowIndex: index,
      });
    }

    payments.push({
      provider: 'husky',
      sourcePaymentId,
      identityConfidence,
      payerName,
      amountCents,
      currency,
      paymentDate,
      sourceStatus,
      paymentState,
    });
  });

  const pagination = parsePagination(document);

  return {
    payments,
    warnings,
    pagination,
  };
}
