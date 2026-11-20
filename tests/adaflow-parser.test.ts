import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  extractAsaasPaymentId,
  parseAdaflowInvoicesPage,
  parseAdaflowSlideover,
} from '../src/parsers/adaflow-parser';

describe('Adaflow Parser', () => {
  const exampleHtmlPath = path.resolve(__dirname, '../refs/adaflow/example.html');
  const exampleHtml = fs.readFileSync(exampleHtmlPath, 'utf-8');

  describe('Real Fixture (refs/adaflow/example.html)', () => {
    it('parses all 20 invoices with expected fields', () => {
      const { invoices, pagination } = parseAdaflowInvoicesPage(exampleHtml);

      expect(invoices).toHaveLength(20);

      // Verify the first card (id: 137395, Nº 80)
      const first = invoices[0];
      expect(first).toBeDefined();
      expect(first?.adaflowNfseId).toBe(137395);
      expect(first?.nfseNumber).toBe('Nº 80');
      expect(first?.date).toBe('30/10/2026');
      expect(first?.takerName).toBe('Avanto LLC');
      expect(first?.amountCents).toBe(1660681);
      expect(first?.status).toBe('Emitido');
      expect(first?.pdfUrl).toContain('/nf-80.pdf');
      expect(first?.xmlUrl).toContain('/nf-80.xml');

      // Verify the third card (id: 134525, Nº 78 - SERGIVANDO ALAIR MARTINS)
      const third = invoices[2];
      expect(third).toBeDefined();
      expect(third?.adaflowNfseId).toBe(134525);
      expect(third?.nfseNumber).toBe('Nº 78');
      expect(third?.date).toBe('17/10/2026');
      expect(third?.takerName).toBe('SERGIVANDO ALAIR MARTINS');
      expect(third?.amountCents).toBe(790); // R$ 7,90
      expect(third?.status).toBe('Emitido');
      expect(third?.pdfUrl).toContain('/nf-78.pdf');
      expect(third?.xmlUrl).toContain('/nf-78.xml');

      // Verify pagination
      expect(pagination.currentPage).toBe(1);
      expect(pagination.nextHref).toBe('/nfses?page=2');
      expect(pagination.pageHrefs).toEqual([
        '/nfses?page=2',
        '/nfses?page=3',
        '/nfses?page=4',
      ]);
    });
  });

  describe('extractAsaasPaymentId', () => {
    it('extracts ID using primary regex (referente [aà] cobran[çc]a Asaas (nº/num/no/.) {id})', () => {
      expect(
        extractAsaasPaymentId(
          'Serviços de desenvolvimento de software referente à cobrança Asaas nº 12345678',
        ),
      ).toBe('12345678');

      // Variant with "cobranca" and uppercase "Nº"
      expect(
        extractAsaasPaymentId(
          'Referente à cobranca Asaas Nº 87654321 prestação de serviço',
        ),
      ).toBe('87654321');

      // Variant with "referente a", "num."
      expect(
        extractAsaasPaymentId(
          'Serviços referente a cobranca Asaas num. 55667788',
        ),
      ).toBe('55667788');

      // Variant with "referente a", "no", no dot
      expect(
        extractAsaasPaymentId(
          'referente a cobrança Asaas no 44332211',
        ),
      ).toBe('44332211');

      // Variant directly following Asaas with number
      expect(
        extractAsaasPaymentId(
          'referente a cobrança Asaas 11223344',
        ),
      ).toBe('11223344');
    });

    it('extracts ID using fallback: Asaas (nº/num/no/#) {id}', () => {
      expect(
        extractAsaasPaymentId('Consultoria técnica - Asaas nº 99887766'),
      ).toBe('99887766');

      expect(
        extractAsaasPaymentId('Consultoria técnica - Asaas num. 99887766'),
      ).toBe('99887766');

      expect(
        extractAsaasPaymentId('Consultoria técnica - Asaas no 99887766'),
      ).toBe('99887766');

      expect(
        extractAsaasPaymentId('Consultoria técnica - Asaas n. 99887766'),
      ).toBe('99887766');
    });

    it('extracts ID using fallback: cobrança Asaas {id}', () => {
      expect(
        extractAsaasPaymentId('Mensalidade escolar cobrança Asaas 55443322'),
      ).toBe('55443322');
    });

    it('extracts ID using fallback: Asaas #{id} and Asaas {digits}', () => {
      expect(
        extractAsaasPaymentId('Fatura ref Asaas #1234567'),
      ).toBe('1234567');

      expect(
        extractAsaasPaymentId('Honorários Asaas 9876543210'),
      ).toBe('9876543210');
    });

    it('returns null when no Asaas pattern is found', () => {
      expect(extractAsaasPaymentId('Serviços prestados sem referência')).toBeNull();
      expect(extractAsaasPaymentId(null)).toBeNull();
      expect(extractAsaasPaymentId('')).toBeNull();
    });
  });

  describe('parseAdaflowSlideover', () => {
    it('parses slideover body with Turbo-Frame and extracts description and payment ID', () => {
      const slideoverHtml = `
        <turbo-frame id="slideover_body">
          <div class="p-6">
            <h2 class="text-xl font-bold">Nota Fiscal Nº 78</h2>
            <div data-field="description" class="mt-4 text-gray-700 whitespace-pre-wrap">
              Prestação de serviços digitais referente à cobrança Asaas nº 10293847
            </div>
          </div>
        </turbo-frame>
      `;

      const detail = parseAdaflowSlideover(slideoverHtml);
      expect(detail.asaasPaymentId).toBe('10293847');
      expect(detail.description).toContain('referente à cobrança Asaas nº 10293847');
    });

    it('parses slideover body with whitespace-pre-wrap paragraph fallback', () => {
      const slideoverHtml = `
        <turbo-frame id="slideover_body">
          <div>
            <p class="whitespace-pre-wrap">
              Licença de software Asaas nº 44556677
            </p>
          </div>
        </turbo-frame>
      `;

      const detail = parseAdaflowSlideover(slideoverHtml);
      expect(detail.asaasPaymentId).toBe('44556677');
      expect(detail.description).toContain('Asaas nº 44556677');
    });

    it('handles slideover without matching Asaas payment ID', () => {
      const slideoverHtml = `
        <turbo-frame id="slideover_body">
          <div class="service-description">
            Prestação de serviços avulsos de design gráfico.
          </div>
        </turbo-frame>
      `;

      const detail = parseAdaflowSlideover(slideoverHtml);
      expect(detail.asaasPaymentId).toBeNull();
      expect(detail.description).toBe('Prestação de serviços avulsos de design gráfico.');
    });
  });
});
