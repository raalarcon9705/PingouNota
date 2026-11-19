import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseHuskyCurrencyAndAmount,
  parseHuskyPayments,
} from '../../src/parsers/husky-parser';

function createDocument(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('Husky Payments Parser', () => {
  const fixturePath = path.resolve(__dirname, '../fixtures/husky-payments.html');
  const fixtureHtml = fs.readFileSync(fixturePath, 'utf-8');

  it('parses full sanitized HTML fixture with high fidelity', () => {
    const doc = createDocument(fixtureHtml);
    const result = parseHuskyPayments(doc);

    expect(result.payments).toHaveLength(7);

    // Card 1: Na conta (recebido)
    expect(result.payments[0]).toEqual({
      provider: 'husky',
      sourcePaymentId: 'tra_husky_101',
      identityConfidence: 'high',
      payerName: 'Acme Global Technologies Inc',
      amountCents: 420000,
      currency: 'USD',
      paymentDate: '2026-11-18',
      sourceStatus: 'Na conta',
      paymentState: 'recebido',
    });

    // Card 2: Concluído (recebido)
    expect(result.payments[1]).toEqual({
      provider: 'husky',
      sourcePaymentId: 'tra_husky_102',
      identityConfidence: 'high',
      payerName: 'Stripe Inc Synthetic Client',
      amountCents: 185050,
      currency: 'USD',
      paymentDate: '2026-11-17',
      sourceStatus: 'Concluído',
      paymentState: 'recebido',
    });

    // Card 3: A caminho (must stay aguardando_recebimento)
    expect(result.payments[2]).toEqual({
      provider: 'husky',
      sourcePaymentId: 'tra_husky_103',
      identityConfidence: 'high',
      payerName: 'Global Dev Partners LLC',
      amountCents: 310000,
      currency: 'USD',
      paymentDate: '2026-11-19',
      sourceStatus: 'A caminho',
      paymentState: 'aguardando_recebimento',
    });

    // Card 4: Em processamento (EUR currency, aguardando_recebimento)
    expect(result.payments[3]).toEqual({
      provider: 'husky',
      sourcePaymentId: 'tra_husky_104',
      identityConfidence: 'high',
      payerName: 'Nordic Cloud AB',
      amountCents: 250000,
      currency: 'EUR',
      paymentDate: '2026-11-19',
      sourceStatus: 'Em processamento',
      paymentState: 'aguardando_recebimento',
    });

    // Card 5: Devolvido (revertido_ou_cancelado)
    expect(result.payments[4]).toEqual({
      provider: 'husky',
      sourcePaymentId: 'tra_husky_105',
      identityConfidence: 'high',
      payerName: 'Pacific Rim Software Ltd',
      amountCents: 90000,
      currency: 'USD',
      paymentDate: '2026-11-12',
      sourceStatus: 'Devolvido',
      paymentState: 'revertido_ou_cancelado',
    });

    // Card 6: Desconhecido (unknown status)
    expect(result.payments[5]).toEqual({
      provider: 'husky',
      sourcePaymentId: 'tra_husky_106',
      identityConfidence: 'high',
      payerName: 'Atlantic Ventures Inc',
      amountCents: 120000,
      currency: 'USD',
      paymentDate: '2026-11-15',
      sourceStatus: 'Retido para compliance',
      paymentState: 'desconhecido',
    });

    // Card 7: Missing ID edge case
    expect(result.payments[6]).toEqual({
      provider: 'husky',
      sourcePaymentId: null,
      identityConfidence: 'low',
      payerName: 'Synthetic Corp LLC',
      amountCents: 50000,
      currency: 'USD',
      paymentDate: '2026-11-19',
      sourceStatus: 'Na conta',
      paymentState: 'recebido',
    });

    // Warnings
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings).toContainEqual({
      code: 'unknown_status',
      message: 'Status desconhecido "Retido para compliance" no card 6',
      rowIndex: 5,
    });
    expect(result.warnings).toContainEqual({
      code: 'missing_id',
      message: 'ID da transferência ausente no card 7',
      rowIndex: 6,
    });

    // Pagination
    expect(result.pagination).toEqual({
      kind: 'next',
      href: '/transfers?page=2',
    });
  });

  it('keeps in-transit and processing transfers pending, while arrived is received', () => {
    const html = `
      <div data-testid="transfers-list">
        <article class="transfer-card" data-transfer-id="t1">
          <span data-field="status">In transit</span>
        </article>
        <article class="transfer-card" data-transfer-id="t2">
          <span data-field="status">Processando</span>
        </article>
        <article class="transfer-card" data-transfer-id="t3">
          <span data-field="status">Arrived</span>
        </article>
        <article class="transfer-card" data-transfer-id="t4">
          <span data-field="status">Disponível</span>
        </article>
      </div>
    `;
    const result = parseHuskyPayments(createDocument(html));
    expect(result.payments[0].paymentState).toBe('aguardando_recebimento');
    expect(result.payments[1].paymentState).toBe('aguardando_recebimento');
    expect(result.payments[2].paymentState).toBe('recebido');
    expect(result.payments[3].paymentState).toBe('recebido');
  });

  it('handles empty lists gracefully', () => {
    const html = `<div data-testid="transfers-list"></div>`;
    const result = parseHuskyPayments(createDocument(html));
    expect(result.payments).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.pagination).toEqual({ kind: 'end' });
  });

  it('emits unsupported_layout when transfers container is missing', () => {
    const html = `<main><div>Nenhuma lista aqui</div></main>`;
    const result = parseHuskyPayments(createDocument(html));
    expect(result.payments).toHaveLength(0);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'unsupported_layout' }),
    );
    expect(result.pagination).toEqual({
      kind: 'unsupported',
      reason: 'Lista de transferências não encontrada',
    });
  });

  it('handles pagination disabled states', () => {
    const htmlWithDisabled = `
      <div data-testid="transfers-list">
        <article class="transfer-card" data-transfer-id="t1">
          <span data-field="status">Na conta</span>
        </article>
      </div>
      <a data-testid="pagination-next" class="disabled" href="/transfers?page=2">Mais</a>
    `;
    const res1 = parseHuskyPayments(createDocument(htmlWithDisabled));
    expect(res1.pagination).toEqual({ kind: 'end' });

    const htmlWithAriaDisabled = `
      <div data-testid="transfers-list">
        <article class="transfer-card" data-transfer-id="t1">
          <span data-field="status">Na conta</span>
        </article>
      </div>
      <a data-testid="pagination-next" aria-disabled="true" href="/transfers?page=2">Mais</a>
    `;
    const res2 = parseHuskyPayments(createDocument(htmlWithAriaDisabled));
    expect(res2.pagination).toEqual({ kind: 'end' });
  });

  it('extracts currency codes and amounts accurately', () => {
    expect(parseHuskyCurrencyAndAmount('USD 4,200.00')).toEqual({
      amountCents: 420000,
      currency: 'USD',
    });
    expect(parseHuskyCurrencyAndAmount('$ 2,500.00')).toEqual({
      amountCents: 250000,
      currency: 'USD',
    });
    expect(parseHuskyCurrencyAndAmount('EUR 1,800.50')).toEqual({
      amountCents: 180050,
      currency: 'EUR',
    });
    expect(parseHuskyCurrencyAndAmount('GBP 3,000.00')).toEqual({
      amountCents: 300000,
      currency: 'GBP',
    });
    expect(parseHuskyCurrencyAndAmount('CAD 500.00')).toEqual({
      amountCents: 50000,
      currency: 'CAD',
    });
    expect(parseHuskyCurrencyAndAmount('AUD 750.25')).toEqual({
      amountCents: 75025,
      currency: 'AUD',
    });
    expect(parseHuskyCurrencyAndAmount('R$ 2.000,00')).toEqual({
      amountCents: 200000,
      currency: 'BRL',
    });
    expect(parseHuskyCurrencyAndAmount('-')).toEqual({
      amountCents: null,
      currency: 'USD',
    });
  });

  it('flags missing amount in cards', () => {
    const html = `
      <div data-testid="transfers-list">
        <article class="transfer-card" data-transfer-id="t1">
          <div data-field="amount">-</div>
          <span data-field="status">Na conta</span>
        </article>
      </div>
    `;
    const result = parseHuskyPayments(createDocument(html));
    expect(result.payments[0].amountCents).toBeNull();
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'missing_amount', rowIndex: 0 }),
    );
  });
});
