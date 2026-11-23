import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractAsaasRowPaymentId,
  parseAsaasPayments,
  parseBrlAmountToCents,
  parseDateToIso,
} from '../../src/parsers/asaas-parser';
import { isSupportedAsaasRoute } from '../../src/services/adapters';

function createDocument(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('Asaas Payments Parser', () => {
  const fixturePath = path.resolve(__dirname, '../fixtures/asaas-payments.html');
  const fixtureHtml = fs.readFileSync(fixturePath, 'utf-8');

  it('parses full sanitized HTML fixture with high fidelity', () => {
    const doc = createDocument(fixtureHtml);
    const result = parseAsaasPayments(doc);

    expect(result.payments).toHaveLength(7);

    // Row 1: Recebido (high confidence)
    expect(result.payments[0]).toEqual({
      provider: 'asaas',
      sourcePaymentId: 'pay_asaas_001',
      identityConfidence: 'high',
      payerName: 'Alpha Serviços de Tecnologia Ltda',
      amountCents: 245000,
      currency: 'BRL',
      paymentDate: '2026-11-15',
      sourceStatus: 'Recebido',
      paymentState: 'recebido',
    });

    // Row 2: Aguardando Pagamento (pending)
    expect(result.payments[1]).toEqual({
      provider: 'asaas',
      sourcePaymentId: 'pay_asaas_002',
      identityConfidence: 'high',
      payerName: 'Beta Consultoria e Treinamento ME',
      amountCents: 80000,
      currency: 'BRL',
      paymentDate: '2026-11-16',
      sourceStatus: 'Aguardando pagamento',
      paymentState: 'aguardando_recebimento',
    });

    // Row 3: Estornado (revertido_ou_cancelado)
    expect(result.payments[2]).toEqual({
      provider: 'asaas',
      sourcePaymentId: 'pay_asaas_003',
      identityConfidence: 'high',
      payerName: 'Gama Design e Mídia Ltda',
      amountCents: 112050,
      currency: 'BRL',
      paymentDate: '2026-11-14',
      sourceStatus: 'Estornado',
      paymentState: 'revertido_ou_cancelado',
    });

    // Row 4: Confirmado (alternate label for recebido)
    expect(result.payments[3]).toEqual({
      provider: 'asaas',
      sourcePaymentId: 'pay_asaas_004',
      identityConfidence: 'high',
      payerName: 'Delta Soluções Digitais EIRELI',
      amountCents: 300000,
      currency: 'BRL',
      paymentDate: '2026-11-17',
      sourceStatus: 'Confirmado',
      paymentState: 'recebido',
    });

    // Row 5: Cancelado (revertido_ou_cancelado)
    expect(result.payments[4]).toEqual({
      provider: 'asaas',
      sourcePaymentId: 'pay_asaas_005',
      identityConfidence: 'high',
      payerName: 'Épsilon Comunicação Integrada',
      amountCents: 65000,
      currency: 'BRL',
      paymentDate: '2026-11-13',
      sourceStatus: 'Cancelado',
      paymentState: 'revertido_ou_cancelado',
    });

    // Row 6: Desconhecido (unknown status)
    expect(result.payments[5]).toEqual({
      provider: 'asaas',
      sourcePaymentId: 'pay_asaas_006',
      identityConfidence: 'high',
      payerName: 'Omega Software House',
      amountCents: 45000,
      currency: 'BRL',
      paymentDate: '2026-11-18',
      sourceStatus: 'Em análise manual',
      paymentState: 'desconhecido',
    });

    // Row 7: Missing ID edge case
    expect(result.payments[6]).toEqual({
      provider: 'asaas',
      sourcePaymentId: null,
      identityConfidence: 'low',
      payerName: 'Zeta Inovações Web Ltda',
      amountCents: 95000,
      currency: 'BRL',
      paymentDate: '2026-11-19',
      sourceStatus: 'Recebido',
      paymentState: 'recebido',
    });

    // Warnings
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings).toContainEqual({
      code: 'unknown_status',
      message: 'Status desconhecido "Em análise manual" na linha 6',
      rowIndex: 5,
    });
    expect(result.warnings).toContainEqual({
      code: 'missing_id',
      message: 'ID do pagamento ausente na linha 7',
      rowIndex: 6,
    });

    // Pagination
    expect(result.pagination).toEqual({
      kind: 'next',
      href: '/customerPayment/index?offset=20',
    });
  });

  it('normalizes statuses: pending vs received vs reversed', () => {
    const html = `
      <table data-testid="payments-table">
        <tbody>
          <tr data-payment-id="p1">
            <td data-field="payer"><span class="payer-name">A</span></td>
            <td data-field="amount">R$ 100,00</td>
            <td data-field="status"><span class="badge">Recebida</span></td>
          </tr>
          <tr data-payment-id="p2">
            <td data-field="payer"><span class="payer-name">B</span></td>
            <td data-field="amount">R$ 100,00</td>
            <td data-field="status"><span class="badge">Pendente</span></td>
          </tr>
          <tr data-payment-id="p3">
            <td data-field="payer"><span class="payer-name">C</span></td>
            <td data-field="amount">R$ 100,00</td>
            <td data-field="status"><span class="badge">Vencida</span></td>
          </tr>
          <tr data-payment-id="p4">
            <td data-field="payer"><span class="payer-name">D</span></td>
            <td data-field="amount">R$ 100,00</td>
            <td data-field="status"><span class="badge">Revertido</span></td>
          </tr>
        </tbody>
      </table>
    `;
    const result = parseAsaasPayments(createDocument(html));
    expect(result.payments[0]?.paymentState).toBe('recebido');
    expect(result.payments[1]?.paymentState).toBe('aguardando_recebimento');
    expect(result.payments[2]?.paymentState).toBe('aguardando_recebimento');
    expect(result.payments[3]?.paymentState).toBe('revertido_ou_cancelado');
  });

  it('handles empty lists gracefully', () => {
    const html = `
      <table data-testid="payments-table">
        <tbody></tbody>
      </table>
    `;
    const result = parseAsaasPayments(createDocument(html));
    expect(result.payments).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.pagination).toEqual({ kind: 'end' });
  });

  it('emits unsupported_layout when table container is missing', () => {
    const html = `<div><p>Nenhuma tabela encontrada</p></div>`;
    const result = parseAsaasPayments(createDocument(html));
    expect(result.payments).toHaveLength(0);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'unsupported_layout' }),
    );
    expect(result.pagination).toEqual({
      kind: 'unsupported',
      reason: 'Tabela de pagamentos não encontrada',
    });
  });

  it('handles pagination disabled states', () => {
    const htmlWithDisabledLink = `
      <table data-testid="payments-table">
        <tbody>
          <tr data-payment-id="p1">
            <td data-field="status"><span class="badge">Recebido</span></td>
          </tr>
        </tbody>
      </table>
      <a class="pagination-next disabled" href="/customerPayment/index?offset=40">Próxima</a>
    `;
    const res1 = parseAsaasPayments(createDocument(htmlWithDisabledLink));
    expect(res1.pagination).toEqual({ kind: 'end' });

    const htmlWithAriaDisabled = `
      <table data-testid="payments-table">
        <tbody>
          <tr data-payment-id="p1">
            <td data-field="status"><span class="badge">Recebido</span></td>
          </tr>
        </tbody>
      </table>
      <a class="pagination-next" aria-disabled="true" href="/customerPayment/index?offset=40">Próxima</a>
    `;
    const res2 = parseAsaasPayments(createDocument(htmlWithAriaDisabled));
    expect(res2.pagination).toEqual({ kind: 'end' });

    const htmlWithHashHref = `
      <table data-testid="payments-table">
        <tbody>
          <tr data-payment-id="p1">
            <td data-field="status"><span class="badge">Recebido</span></td>
          </tr>
        </tbody>
      </table>
      <a class="pagination-next" href="#">Próxima</a>
    `;
    const res3 = parseAsaasPayments(createDocument(htmlWithHashHref));
    expect(res3.pagination).toEqual({ kind: 'end' });
  });

  it('handles missing amount and localized formats', () => {
    expect(parseBrlAmountToCents('R$ 1.250,50')).toBe(125050);
    expect(parseBrlAmountToCents('R$ 0,50')).toBe(50);
    expect(parseBrlAmountToCents('500,00')).toBe(50000);
    expect(parseBrlAmountToCents('-')).toBeNull();
    expect(parseBrlAmountToCents('')).toBeNull();

    const htmlWithMissingAmount = `
      <table data-testid="payments-table">
        <tbody>
          <tr data-payment-id="p1">
            <td data-field="amount">-</td>
            <td data-field="status"><span class="badge">Recebido</span></td>
          </tr>
        </tbody>
      </table>
    `;
    const result = parseAsaasPayments(createDocument(htmlWithMissingAmount));
    expect(result.payments[0]?.amountCents).toBeNull();
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'missing_amount', rowIndex: 0 }),
    );
  });

  it('parses date formats correctly', () => {
    expect(parseDateToIso('15/11/2026')).toBe('2026-11-15');
    expect(parseDateToIso('01/01/2025')).toBe('2025-01-01');
    expect(parseDateToIso('2026-11-15')).toBe('2026-11-15');
    expect(parseDateToIso('invalid-date')).toBeNull();
    expect(parseDateToIso('')).toBeNull();
    expect(parseDateToIso(null)).toBeNull();
  });

  describe('Atlas Web Components Live Snapshot (refs/asaas/example.html)', () => {
    const examplePath = path.resolve(__dirname, '../../refs/asaas/example.html');
    const exampleHtml = fs.readFileSync(examplePath, 'utf-8');

    it('identifies Asaas payment list route as supported', () => {
      expect(isSupportedAsaasRoute('https://app.asaas.com/payment/list')).toBe(true);
      expect(isSupportedAsaasRoute('/payment/list')).toBe(true);
      expect(isSupportedAsaasRoute('/payment/index')).toBe(true);
      expect(isSupportedAsaasRoute('/payment')).toBe(true);
      expect(isSupportedAsaasRoute('/paymentList/loadTableContent')).toBe(false);
    });

    it('parses all 10 rows with high confidence, positive amounts, valid dates, and non-empty payer names', () => {
      const doc = createDocument(exampleHtml);
      const result = parseAsaasPayments(doc);

      expect(result.warnings).toEqual([]);
      expect(result.payments).toHaveLength(10);

      for (const payment of result.payments) {
        expect(payment.provider).toBe('asaas');
        expect(payment.identityConfidence).toBe('high');
        expect(payment.sourcePaymentId).toBeTruthy();
        expect(payment.payerName).toBeTruthy();
        expect(payment.payerName?.length).toBeGreaterThan(0);
        expect(payment.amountCents).toBeGreaterThan(0);
        expect(payment.currency).toBe('BRL');
        expect(payment.paymentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(['recebido', 'aguardando_recebimento']).toContain(payment.paymentState);
      }

      // Specific spot checks
      expect(result.payments[0]).toEqual({
        provider: 'asaas',
        sourcePaymentId: '970720795',
        identityConfidence: 'high',
        payerName: 'Cliente Teste 1',
        amountCents: 4700,
        currency: 'BRL',
        paymentDate: '2026-12-26',
        sourceStatus: 'Aguardando pagamento',
        paymentState: 'aguardando_recebimento',
      });

      expect(result.payments[1]?.payerName).toBe('Cliente Teste 2');
      expect(result.payments[1]?.amountCents).toBe(4700);

      expect(result.payments[4]?.amountCents).toBe(1190);
      expect(result.payments[4]?.paymentState).toBe('recebido');
      expect(result.payments[4]?.sourceStatus).toBe('Recebida em 13/11/2026');

      expect(result.payments[5]?.amountCents).toBe(790);
      expect(result.payments[5]?.payerName).toBe('Cliente Teste 4');

      expect(result.payments[8]?.sourceStatus).toBe('Vencida');
      expect(result.payments[8]?.paymentState).toBe('aguardando_recebimento');
      expect(result.payments[8]?.amountCents).toBe(1190);
    });

    it('parses raw AJAX fragment where atlas-table-col lacks column-label attributes', () => {
      const ajaxHtml = `
        <atlas-table-row data-payment-id="pay_ajax_001" href="/payment/show/pay_ajax_001">
          <atlas-table-col>
            <atlas-layout>
              <atlas-icon name="user-filled"></atlas-icon>
              <atlas-text>Empresa Alpha Ltda</atlas-text>
            </atlas-layout>
          </atlas-table-col>
          <atlas-table-col>
            <atlas-layout>R$ 150,50</atlas-layout>
          </atlas-table-col>
          <atlas-table-col>Serviços de Consultoria</atlas-table-col>
          <atlas-table-col>Pix</atlas-table-col>
          <atlas-table-col>
            <atlas-layout>
              25/11/2026
              <atlas-icon name="check-filled" tooltip="Recebida em 24/11/2026"></atlas-icon>
            </atlas-layout>
          </atlas-table-col>
        </atlas-table-row>
      `;
      const doc = createDocument(ajaxHtml);
      const result = parseAsaasPayments(doc);

      expect(result.payments).toHaveLength(1);
      expect(result.payments[0]).toEqual({
        provider: 'asaas',
        sourcePaymentId: 'pay_ajax_001',
        identityConfidence: 'high',
        payerName: 'Empresa Alpha Ltda',
        amountCents: 15050,
        currency: 'BRL',
        paymentDate: '2026-11-25',
        sourceStatus: 'Recebida em 24/11/2026',
        paymentState: 'recebido',
      });
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('extractAsaasRowPaymentId', () => {
    it('extracts payment ID from data-payment-id attribute', () => {
      const el = createDocument('<atlas-table-row data-payment-id="932162415"></atlas-table-row>').querySelector('atlas-table-row')!;
      expect(extractAsaasRowPaymentId(el)).toBe('932162415');
    });

    it('normalizes formatted numeric payment IDs', () => {
      const el = createDocument('<atlas-table-row data-payment-id="89.155.748"></atlas-table-row>').querySelector('atlas-table-row')!;
      expect(extractAsaasRowPaymentId(el)).toBe('89155748');
    });

    it('extracts payment ID from href in various formats (payment, customerPayment, paymentList)', () => {
      const el1 = createDocument('<atlas-table-row href="/customerPayment/show/932162415"></atlas-table-row>').querySelector('atlas-table-row')!;
      expect(extractAsaasRowPaymentId(el1)).toBe('932162415');

      const el2 = createDocument('<atlas-table-row href="/paymentList/show/970720795"></atlas-table-row>').querySelector('atlas-table-row')!;
      expect(extractAsaasRowPaymentId(el2)).toBe('970720795');

      const el3 = createDocument('<atlas-table-row href="/payment/show/969041525"></atlas-table-row>').querySelector('atlas-table-row')!;
      expect(extractAsaasRowPaymentId(el3)).toBe('969041525');
    });

    it('extracts payment ID from data-anticipation-url query param', () => {
      const el = createDocument(
        '<atlas-table-row data-anticipation-url="/receivableAnticipationUnifiedJourney/index?paymentId=932162415"></atlas-table-row>',
      ).querySelector('atlas-table-row')!;
      expect(extractAsaasRowPaymentId(el)).toBe('932162415');
    });

    it('extracts payment ID from child anchor or payment-id element', () => {
      const el = createDocument(
        '<table><tr class="payment-row"><td data-field="payment-id"><a class="payment-id">#932162415</a></td></tr></table>',
      ).querySelector('tr')!;
      expect(extractAsaasRowPaymentId(el)).toBe('932162415');
    });

    it('extracts payment ID from row id attribute', () => {
      const el = createDocument('<table><tr id="payment_932162415"></tr></table>').querySelector('tr')!;
      expect(extractAsaasRowPaymentId(el)).toBe('932162415');
    });
  });
});
