import { describe, expect, it, vi } from 'vitest';
import {
  asaasAdapter,
  fetchAsaasPayments,
  getAsaasNextPage,
  isSupportedAsaasRoute,
} from '../../src/services/adapters';

function createDocument(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('Asaas Adapters & Authenticated Fetch Strategy', () => {
  describe('isSupportedAsaasRoute', () => {
    it('accepts valid Asaas payment routes', () => {
      expect(isSupportedAsaasRoute('https://app.asaas.com/payment/list')).toBe(true);
      expect(isSupportedAsaasRoute('https://asaas.com/payment/index')).toBe(true);
      expect(isSupportedAsaasRoute('https://asaas.com/payment')).toBe(true);
      expect(isSupportedAsaasRoute('https://app.asaas.com/customerPayment/index')).toBe(true);
      expect(isSupportedAsaasRoute('https://app.asaas.com/customerPayment/list')).toBe(true);
      expect(isSupportedAsaasRoute('https://app.asaas.com/app/cobranzas')).toBe(true);
      expect(isSupportedAsaasRoute('/payment/list')).toBe(true);
      expect(isSupportedAsaasRoute('/customerPayment/index')).toBe(true);
    });

    it('rejects unsupported or non-Asaas routes including internal API endpoints', () => {
      expect(isSupportedAsaasRoute('https://evil.com/payment/list')).toBe(false);
      expect(isSupportedAsaasRoute('https://app.asaas.com/settings')).toBe(false);
      expect(isSupportedAsaasRoute('https://www.asaas.com/paymentList/loadTableContent')).toBe(false);
      expect(isSupportedAsaasRoute('/paymentList/loadTableContent')).toBe(false);
      expect(isSupportedAsaasRoute('/other/path')).toBe(false);
      expect(isSupportedAsaasRoute('')).toBe(false);
    });
  });

  describe('fetchAsaasPayments', () => {
    const sampleRowHtml1 = `
      <atlas-table-row data-payment-id="967583773" href="/payment/show/967583773">
        <atlas-table-col column-label="Nome"><atlas-text>Caio Tiburcio</atlas-text></atlas-table-col>
        <atlas-table-col column-label="Valor">R$ 47,00</atlas-table-col>
        <atlas-table-col column-label="Data de vencimento">14/11/2026<atlas-icon name="check-filled" tooltip="Recebida em 13/11/2026"></atlas-icon></atlas-table-col>
      </atlas-table-row>
    `;

    const sampleRowHtml2 = `
      <atlas-table-row data-payment-id="967581581" href="/payment/show/967581581">
        <atlas-table-col column-label="Nome"><atlas-text>Jonatas Dutra</atlas-text></atlas-table-col>
        <atlas-table-col column-label="Valor">R$ 11,90</atlas-table-col>
        <atlas-table-col column-label="Data de vencimento">13/11/2026<atlas-icon name="check-filled" tooltip="Recebida em 13/11/2026"></atlas-icon></atlas-table-col>
      </atlas-table-row>
    `;

    it('successfully fetches single page, parses content, and sets pagination: end', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          content: sampleRowHtml1,
          totalRecords: 1,
          message: '',
        }),
      });

      const result = await fetchAsaasPayments(1, 50, undefined, mockFetch as unknown as typeof fetch);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(calledUrl).toContain('/paymentList/loadTableContent?status=CONFIRMED&status=RECEIVED&page=1&itemsPerPage=50');
      expect(calledInit.credentials).toBe('same-origin');
      expect(calledInit.headers).toEqual({
        accept: '*/*',
        'x-requested-with': 'XMLHttpRequest',
      });

      expect(result.warnings).toEqual([]);
      expect(result.pagination).toEqual({ kind: 'end' });
      expect(result.payments).toHaveLength(1);
      expect(result.payments[0]).toEqual({
        provider: 'asaas',
        sourcePaymentId: '967583773',
        identityConfidence: 'high',
        payerName: 'Caio Tiburcio',
        amountCents: 4700,
        currency: 'BRL',
        paymentDate: '2026-11-14',
        sourceStatus: 'Recebida em 13/11/2026',
        paymentState: 'recebido',
      });
    });

    it('accumulates all pages in a single call when multiple pages exist', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('page=1')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              content: sampleRowHtml1,
              totalRecords: 2,
              message: '',
            }),
          };
        }
        if (url.includes('page=2')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              content: sampleRowHtml2,
              totalRecords: 2,
              message: '',
            }),
          };
        }
        throw new Error(`Unexpected URL ${url}`);
      });

      const result = await fetchAsaasPayments(1, 1, undefined, mockFetch as unknown as typeof fetch, 5);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.pagination).toEqual({ kind: 'end' });
      expect(result.payments).toHaveLength(2);
      expect(result.payments[0]?.sourcePaymentId).toBe('967583773');
      expect(result.payments[1]?.sourcePaymentId).toBe('967581581');
      expect(result.payments[1]?.payerName).toBe('Jonatas Dutra');
      expect(result.payments[1]?.amountCents).toBe(1190);
    });

    it('logs structured audit info with table to console', async () => {
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const groupSpy = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
      const tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {});
      const groupEndSpy = vi.spyOn(console, 'groupEnd').mockImplementation(() => {});

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          content: sampleRowHtml1,
          totalRecords: 1,
          message: '',
        }),
      });

      await fetchAsaasPayments(1, 50, undefined, mockFetch as unknown as typeof fetch);

      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('[PingouNota:Asaas] 🔍 Escaneando cobranças... Página 1: 1 encontradas (Total acumulado: 1 de 1)'),
      );
      expect(groupSpy).toHaveBeenCalledWith(
        expect.stringContaining('[PingouNota:Asaas] 📋 Cobranças sincronizadas (1 pagamentos)'),
      );
      expect(tableSpy).toHaveBeenCalledWith([
        {
          ID: '967583773',
          Pagador: 'Caio Tiburcio',
          Valor: 47,
          Estado: 'recebido',
          Status: 'Recebida em 13/11/2026',
        },
      ]);
      expect(groupEndSpy).toHaveBeenCalledTimes(1);

      infoSpy.mockRestore();
      groupSpy.mockRestore();
      tableSpy.mockRestore();
      groupEndSpy.mockRestore();
    });

    it('always returns pagination: end even if maxPages limits further fetching', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          content: sampleRowHtml1,
          totalRecords: 50,
          message: '',
        }),
      });

      // maxPages = 1 forces only page 1 to be fetched
      const result = await fetchAsaasPayments(1, 10, undefined, mockFetch as unknown as typeof fetch, 1);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.pagination).toEqual({ kind: 'end' });
      expect(result.payments).toHaveLength(1);
    });

    it('calculates totalPages dynamically using the number of rows returned in firstPage.content', async () => {
      // 2 rows in firstPage content, totalRecords: 4 -> pageSize = 2 -> totalPages = 2
      const twoRowsHtml = sampleRowHtml1 + sampleRowHtml2;
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('page=1')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              content: twoRowsHtml,
              totalRecords: 4,
              message: '',
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            content: twoRowsHtml,
            totalRecords: 4,
            message: '',
          }),
        };
      });

      // Pass itemsPerPage = 50, but firstPage only has 2 rows; dynamic pageSize should be 2, fetching page 2
      const result = await fetchAsaasPayments(1, 50, undefined, mockFetch as unknown as typeof fetch, 10);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.payments).toHaveLength(4);
      expect(result.pagination).toEqual({ kind: 'end' });
    });

    it('preserves partial batch when a subsequent page fetch fails', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('page=1')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              content: sampleRowHtml1,
              totalRecords: 2,
              message: '',
            }),
          };
        }
        // Page 2 fails with network error
        throw new Error('Connection reset on page 2');
      });

      const result = await fetchAsaasPayments(1, 1, undefined, mockFetch as unknown as typeof fetch, 5);

      // Should have successfully parsed page 1 rows rather than dropping everything
      expect(result.payments).toHaveLength(1);
      expect(result.payments[0]?.sourcePaymentId).toBe('967583773');
      expect(result.pagination).toEqual({ kind: 'end' });
    });

    it('falls back to parsing document when fetch throws a network error', async () => {
      const fallbackDoc = createDocument(`
        <table data-testid="payments-table">
          <tbody>
            <tr data-payment-id="dom_pay_001">
              <td data-field="payer"><span class="payer-name">Fallback DOM User</span></td>
              <td data-field="amount">R$ 99,00</td>
              <td data-field="status"><span class="badge">Recebido</span></td>
            </tr>
          </tbody>
        </table>
      `);

      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error (offline)'));

      const result = await fetchAsaasPayments(1, 50, fallbackDoc, mockFetch as unknown as typeof fetch);

      expect(result.payments).toHaveLength(1);
      expect(result.payments[0]?.sourcePaymentId).toBe('dom_pay_001');
      expect(result.payments[0]?.payerName).toBe('Fallback DOM User');
      expect(result.payments[0]?.amountCents).toBe(9900);
      expect(result.payments[0]?.paymentState).toBe('recebido');
    });

    it('falls back to parsing document when server responds with 500 error or success: false', async () => {
      const fallbackDoc = createDocument(`
        <atlas-easy-table class="js-payment-list-table">
          <atlas-table-row data-payment-id="dom_atlas_001">
            <atlas-table-col column-label="Nome"><atlas-text>Atlas DOM User</atlas-text></atlas-table-col>
            <atlas-table-col column-label="Valor">R$ 55,00</atlas-table-col>
            <atlas-table-col column-label="Data de vencimento">20/12/2026<atlas-icon name="check-filled" tooltip="Recebida em 20/12/2026"></atlas-icon></atlas-table-col>
          </atlas-table-row>
        </atlas-easy-table>
      `);

      const mockFetch500 = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ success: false }),
      });

      const res1 = await fetchAsaasPayments(1, 50, fallbackDoc, mockFetch500 as unknown as typeof fetch);
      expect(res1.payments).toHaveLength(1);
      expect(res1.payments[0]?.sourcePaymentId).toBe('dom_atlas_001');
      expect(res1.payments[0]?.payerName).toBe('Atlas DOM User');

      const mockFetchSuccessFalse = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: false, content: null }),
      });

      const res2 = await fetchAsaasPayments(1, 50, fallbackDoc, mockFetchSuccessFalse as unknown as typeof fetch);
      expect(res2.payments).toHaveLength(1);
      expect(res2.payments[0]?.sourcePaymentId).toBe('dom_atlas_001');
    });
  });

  describe('getAsaasNextPage', () => {
    it('returns next link if next button exists and is active', () => {
      const doc = createDocument('<a class="pagination-next" href="/payment/list?offset=50">Próxima</a>');
      expect(getAsaasNextPage(doc)).toEqual({ kind: 'next', href: '/payment/list?offset=50' });
    });

    it('returns end if no pagination is found or next button is disabled', () => {
      const docEmpty = createDocument('<div>No pagination</div>');
      expect(getAsaasNextPage(docEmpty)).toEqual({ kind: 'end' });

      const docDisabled = createDocument('<a class="pagination-next disabled" href="/payment/list?offset=50">Próxima</a>');
      expect(getAsaasNextPage(docDisabled)).toEqual({ kind: 'end' });
    });
  });

  describe('asaasAdapter integration', () => {
    it('exposes fetchPayments on asaasAdapter', () => {
      expect(asaasAdapter.fetchPayments).toBe(fetchAsaasPayments);
    });
  });
});
