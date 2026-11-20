import { normalizePaymentState } from '../domain/declaration';
import type { ObservedPayment, ParseResult, ParseWarning, PaginationResult } from '../shared/observed-payment';

export function parseDateToIso(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const trimmed = dateStr.trim();
  if (!trimmed) return null;

  // DD/MM/YYYY or DD-MM-YYYY
  const brMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (brMatch && brMatch[1] && brMatch[2] && brMatch[3]) {
    const day = brMatch[1].padStart(2, '0');
    const month = brMatch[2].padStart(2, '0');
    const year = brMatch[3];
    return `${year}-${month}-${day}`;
  }

  // Already ISO format YYYY-MM-DD
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch && isoMatch[1] && isoMatch[2] && isoMatch[3]) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  return null;
}

export function parseBrlAmountToCents(amountStr: string | null | undefined): number | null {
  if (!amountStr) return null;
  const trimmed = amountStr.trim();
  if (!trimmed) return null;

  const cleaned = trimmed.replace(/[^\d,.-]/g, '');
  if (!cleaned || !/\d/.test(cleaned)) return null;

  let normalized: string;
  if (cleaned.includes(',')) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (cleaned.includes('.')) {
    normalized = cleaned;
  } else {
    normalized = `${cleaned}.00`;
  }

  const parsed = parseFloat(normalized);
  if (isNaN(parsed)) return null;

  return Math.round(parsed * 100);
}

function parsePagination(doc: Document): PaginationResult {
  const nextBtn = doc.querySelector(
    'a.pagination-next, [data-testid="pagination-next"], a[rel="next"], .pagination .next a, li.pagination-next a',
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

export function parseAsaasPayments(document: Document): ParseResult {
  const atlasTable = document.querySelector(
    'atlas-easy-table.js-payment-list-table, atlas-easy-table[url*="payment"], atlas-easy-table',
  );
  const directAtlasRows = Array.from(document.querySelectorAll('atlas-table-row'));

  const legacyTable = document.querySelector(
    'table[data-testid="payments-table"], [data-testid="payments-table"], table.payments-table, .asaas-payments-table',
  );

  if (!atlasTable && directAtlasRows.length === 0 && !legacyTable) {
    return {
      payments: [],
      warnings: [
        {
          code: 'unsupported_layout',
          message: 'Tabela de pagamentos do Asaas não encontrada no documento.',
          rowIndex: null,
        },
      ],
      pagination: {
        kind: 'unsupported',
        reason: 'Tabela de pagamentos não encontrada',
      },
    };
  }

  const payments: ObservedPayment[] = [];
  const warnings: ParseWarning[] = [];

  if (atlasTable || directAtlasRows.length > 0) {
    const rowElements = atlasTable
      ? Array.from(atlasTable.querySelectorAll('atlas-table-row'))
      : directAtlasRows;

    rowElements.forEach((row, index) => {
      let sourcePaymentId = row.getAttribute('data-payment-id')?.trim() || null;
      if (!sourcePaymentId) {
        const href =
          row.getAttribute('href') ||
          row.getAttribute('data-link-url') ||
          row.querySelector('a[href*="/payment/show/"]')?.getAttribute('href') ||
          '';
        const match = href.match(/\/payment\/show\/(\d+)/);
        if (match && match[1]) {
          sourcePaymentId = match[1];
        }
      }
      if (!sourcePaymentId) {
        const idEl = row.querySelector('a.payment-id, [data-field="payment-id"] a, [data-field="payment-id"]');
        const text = idEl?.textContent?.trim();
        if (text && text !== '-' && text !== '—' && text !== 'N/A') {
          sourcePaymentId = text;
        }
      }

      const identityConfidence = sourcePaymentId ? 'high' : 'low';
      if (!sourcePaymentId) {
        warnings.push({
          code: 'missing_id',
          message: `ID do pagamento ausente na linha ${index + 1}`,
          rowIndex: index,
        });
      }

      let payerName: string | null = null;
      const nameCol = row.querySelector(
        'atlas-table-col[column-label="Nome"], atlas-table-col[column-label="nome"], atlas-table-col.js-customer-account-name',
      );
      if (nameCol) {
        const textEl = nameCol.querySelector('atlas-text');
        if (textEl?.textContent?.trim()) {
          payerName = textEl.textContent.trim().replace(/\s+/g, ' ');
        } else {
          const clone = nameCol.cloneNode(true) as HTMLElement;
          clone.querySelectorAll('atlas-icon, .badge, .tooltip').forEach((el) => el.remove());
          payerName = clone.textContent?.trim().replace(/\s+/g, ' ') || null;
        }
      }
      if (payerName === '') payerName = null;

      const amountCol = row.querySelector(
        'atlas-table-col[column-label="Valor"], atlas-table-col[column-label="valor"], atlas-table-col.js-payment-value',
      );
      const rawAmount = amountCol?.textContent?.trim();
      const amountCents = parseBrlAmountToCents(rawAmount);
      if (amountCents === null) {
        warnings.push({
          code: 'missing_amount',
          message: `Valor ausente ou inválido na linha ${index + 1}`,
          rowIndex: index,
        });
      }

      const dateCol = row.querySelector(
        'atlas-table-col[column-label="Data de vencimento"], atlas-table-col[column-label="data de vencimento"], atlas-table-col.js-payment-due-date',
      );
      const rawDate = dateCol?.textContent?.trim();
      const dateMatch = rawDate?.match(/(\d{1,2}[/-]\d{1,2}[/-]\d{4}|\d{4}-\d{2}-\d{2})/);
      const paymentDate = parseDateToIso(dateMatch ? dateMatch[0] : rawDate);

      let statusIcon = dateCol?.querySelector(
        'atlas-icon[name="clock-filled"], atlas-icon[name="check-filled"], atlas-icon[name="x-filled"], atlas-icon[theme="warning"], atlas-icon[theme="success"], atlas-icon[theme="danger"]',
      ) || dateCol?.querySelector('atlas-icon[tooltip]:not([name="eye-filled"])');

      if (!statusIcon) {
        statusIcon = row.querySelector(
          'atlas-icon[name="clock-filled"], atlas-icon[name="check-filled"], atlas-icon[name="x-filled"], atlas-icon[tooltip]:not([name="eye-filled"]):not([name="user-filled"])',
        );
      }

      const sourceStatus = statusIcon?.getAttribute('tooltip')?.trim() || '';
      const paymentState = normalizePaymentState(sourceStatus, 'asaas');
      if (paymentState === 'desconhecido') {
        warnings.push({
          code: 'unknown_status',
          message: `Status desconhecido "${sourceStatus}" na linha ${index + 1}`,
          rowIndex: index,
        });
      }

      payments.push({
        provider: 'asaas',
        sourcePaymentId,
        identityConfidence,
        payerName,
        amountCents,
        currency: 'BRL',
        paymentDate,
        sourceStatus,
        paymentState,
      });
    });
  } else if (legacyTable) {
    let rowElements = Array.from(
      legacyTable.querySelectorAll('tbody tr.payment-row, tbody tr[data-payment-id]'),
    );

    if (rowElements.length === 0) {
      rowElements = Array.from(legacyTable.querySelectorAll('tbody tr')).filter(
        (tr) => tr.querySelectorAll('td').length > 0,
      );
    }

    rowElements.forEach((row, index) => {
      let sourcePaymentId = row.getAttribute('data-payment-id')?.trim() || null;
      if (!sourcePaymentId) {
        const idEl = row.querySelector('a.payment-id, [data-field="payment-id"] a, [data-field="payment-id"]');
        const text = idEl?.textContent?.trim();
        if (text && text !== '-' && text !== '—' && text !== 'N/A') {
          sourcePaymentId = text;
        }
      }

      const identityConfidence = sourcePaymentId ? 'high' : 'low';
      if (!sourcePaymentId) {
        warnings.push({
          code: 'missing_id',
          message: `ID do pagamento ausente na linha ${index + 1}`,
          rowIndex: index,
        });
      }

      const specificPayerName = row.querySelector('[data-field="payer"] .payer-name, .payer-name');
      let payerName: string | null = specificPayerName?.textContent?.trim() || null;
      if (!payerName) {
        const payerField = row.querySelector('[data-field="payer"]');
        if (payerField) {
          const clone = payerField.cloneNode(true) as HTMLElement;
          clone.querySelectorAll('.payer-doc, .text-muted').forEach((el) => el.remove());
          payerName = clone.textContent?.trim() || null;
        }
      }
      if (payerName === '') payerName = null;

      const dateElem = row.querySelector('[data-field="date"], .payment-date, td.date');
      const paymentDate = parseDateToIso(dateElem?.textContent?.trim());

      const amountElem = row.querySelector('[data-field="amount"], .payment-amount, td.amount');
      const rawAmount = amountElem?.textContent?.trim();
      const amountCents = parseBrlAmountToCents(rawAmount);
      if (amountCents === null) {
        warnings.push({
          code: 'missing_amount',
          message: `Valor ausente ou inválido na linha ${index + 1}`,
          rowIndex: index,
        });
      }

      const statusElem = row.querySelector(
        '[data-field="status"] .badge, [data-field="status"], .payment-status, .badge',
      );
      const sourceStatus = statusElem?.textContent?.trim() || '';
      const paymentState = normalizePaymentState(sourceStatus, 'asaas');
      if (paymentState === 'desconhecido') {
        warnings.push({
          code: 'unknown_status',
          message: `Status desconhecido "${sourceStatus}" na linha ${index + 1}`,
          rowIndex: index,
        });
      }

      payments.push({
        provider: 'asaas',
        sourcePaymentId,
        identityConfidence,
        payerName,
        amountCents,
        currency: 'BRL',
        paymentDate,
        sourceStatus,
        paymentState,
      });
    });
  }

  const pagination = parsePagination(document);

  return {
    payments,
    warnings,
    pagination,
  };
}
