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
      expect(first?.serviceTakerId).toBe('21116');
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
      expect(third?.serviceTakerId).toBe('20739');
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

    it('normalizes formatted payment numbers with dots, spaces, hyphens, and slashes', () => {
      // Standalone formatted numbers
      expect(extractAsaasPaymentId('89.155.748')).toBe('89155748');
      expect(extractAsaasPaymentId('89 155 748')).toBe('89155748');
      expect(extractAsaasPaymentId('89-155748')).toBe('89155748');

      // Formatted numbers within descriptions
      expect(
        extractAsaasPaymentId('referente a cobrança Asaas nº 89.155.748'),
      ).toBe('89155748');

      expect(
        extractAsaasPaymentId('referente à cobrança Asaas nº 932162415'),
      ).toBe('932162415');

      expect(
        extractAsaasPaymentId('Serviços prestados referente a cobrança Asaas 89 155 748'),
      ).toBe('89155748');

      expect(
        extractAsaasPaymentId('Cobrança Asaas #89-155748 parcela 1'),
      ).toBe('89155748');

      expect(
        extractAsaasPaymentId('Asaas 891557/1'),
      ).toBe('8915571');
    });

    it('falls back to 8-12 digit sequence if cleaned ID is less than 7 digits', () => {
      expect(
        extractAsaasPaymentId('Asaas nº 123 - contrato 2026112001'),
      ).toBe('2026112001');

      // Preserves raw digits if still < 7 and no fallback exists
      expect(
        extractAsaasPaymentId('Asaas nº 12345'),
      ).toBe('12345');
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

    it('extracts complete taker information from slideover HTML', () => {
      const slideoverHtml = `
        <turbo-frame id="slideover_body">
          <div data-field="description">Serviço referente à cobrança Asaas nº 12345678</div>
          <div data-section="taker">
            <h3 data-field="taker_name">ACME Corporation Ltda</h3>
            <span data-field="taker_document">12.345.678/0001-90</span>
            <a data-field="taker_email" href="mailto:contato@acme.com.br">contato@acme.com.br</a>
            <a data-field="taker_phone" href="tel:+5511987654321">(11) 98765-4321</a>
            <div data-field="taker_address">
              <span data-field="address_line1">Av. Brigadeiro Faria Lima</span>
              <span data-field="address_number">1000</span>
              <span data-field="address_neighborhood">Itaim Bibi</span>
              <span data-field="address_city">São Paulo</span>
              <span data-field="address_state">SP</span>
              <span data-field="address_postal_code">01452-001</span>
              <span data-field="address_country">BR</span>
            </div>
          </div>
        </turbo-frame>
      `;

      const detail = parseAdaflowSlideover(slideoverHtml);
      expect(detail.asaasPaymentId).toBe('12345678');
      expect(detail.taker).toBeDefined();
      expect(detail.taker?.name).toBe('ACME Corporation Ltda');
      expect(detail.taker?.document).toBe('12.345.678/0001-90');
      expect(detail.taker?.email).toBe('contato@acme.com.br');
      expect(detail.taker?.phone).toBe('+5511987654321');
      expect(detail.taker?.address).toEqual({
        line1: 'Av. Brigadeiro Faria Lima',
        number: '1000',
        neighborhood: 'Itaim Bibi',
        city: 'São Paulo',
        state: 'SP',
        postalCode: '01452-001',
        country: 'BR',
      });
    });

    it('extracts taker info with text pattern matching when data-field attributes are absent', () => {
      const slideoverHtml = `
        <turbo-frame id="slideover_body">
          <div class="service-description">Desenvolvimento web referente à cobrança Asaas 88776655</div>
          <div class="taker-section">
            <p class="taker-name">João da Silva</p>
            <p>CPF: 123.456.789-01</p>
            <p>E-mail: joao@silva.com</p>
            <p>Telefone: (21) 99887-6655</p>
            <p class="taker-address">Rua das Acácias, 50, Tijuca, Rio de Janeiro - RJ, 20510-000</p>
          </div>
        </turbo-frame>
      `;

      const detail = parseAdaflowSlideover(slideoverHtml);
      expect(detail.asaasPaymentId).toBe('88776655');
      expect(detail.taker).toBeDefined();
      expect(detail.taker?.name).toBe('João da Silva');
      expect(detail.taker?.document).toBe('123.456.789-01');
      expect(detail.taker?.email).toBe('joao@silva.com');
      expect(detail.taker?.phone).toBe('(21) 99887-6655');
      expect(detail.taker?.address).toBeDefined();
      expect(detail.taker?.address?.line1).toBe('Rua das Acácias');
      expect(detail.taker?.address?.number).toBe('50');
      expect(detail.taker?.address?.city).toBe('Rio de Janeiro');
      expect(detail.taker?.address?.state).toBe('RJ');
      expect(detail.taker?.address?.postalCode).toBe('20510-000');
    });

    it('parses real slideover layout with SERVIÇO header from user fixture (Nº 78)', () => {
      // Replicates the real Adaflow slideover layout shown in the user screenshot:
      // Title: Nº 78 SERGIVANDO ALAIR MARTINS
      // Box: VALOR R$ 7,90, DATA 17/10/2026, SERVIÇO header + description
      const slideoverHtml = `
        <turbo-frame id="slideover_body">
          <div class="px-5 py-4">
            <h2 class="text-sm text-gray-500">Nº 78</h2>
            <h1 class="text-xl font-bold text-gray-900">SERGIVANDO ALAIR MARTINS</h1>
            <div class="mt-4 rounded-xl bg-gray-50 p-4">
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <span class="text-xs uppercase text-gray-400">VALOR</span>
                  <p class="font-bold">R$ 7,90</p>
                </div>
                <div>
                  <span class="text-xs uppercase text-gray-400">DATA</span>
                  <p class="font-bold">17/10/2026</p>
                </div>
              </div>
              <div class="mt-4">
                <span class="text-xs uppercase text-gray-400 font-semibold">SERVIÇO</span>
                <p class="mt-1 text-sm text-gray-700">
                  Prestação de serviços de consulta judicial pela plataforma Komwise, referente à cobrança Asaas nº 932162415.
                </p>
              </div>
            </div>
            <div class="mt-6">
              <span class="text-xs uppercase text-gray-400 font-semibold">ACOMPANHAMENTO</span>
              <p>Emitida</p>
            </div>
          </div>
        </turbo-frame>
      `;

      const detail = parseAdaflowSlideover(slideoverHtml);
      expect(detail.asaasPaymentId).toBe('932162415');
      expect(detail.description).toBe(
        'Prestação de serviços de consulta judicial pela plataforma Komwise, referente à cobrança Asaas nº 932162415.',
      );
      // Ensure internal NFSe number "78" is not extracted as the Asaas payment ID
      expect(detail.asaasPaymentId).not.toBe('78');
    });

    it('rejects short numeric strings like internal NFSe numbers (e.g. 78) as Asaas payment IDs', () => {
      expect(extractAsaasPaymentId('78')).toBeNull();
      expect(extractAsaasPaymentId('Nº 78')).toBeNull();
      expect(extractAsaasPaymentId('12345')).toBeNull();
    });

    it('extracts payment ID from reference without the word Asaas when cobrança is specified with >=7 digits', () => {
      expect(
        extractAsaasPaymentId('Prestação de serviços referente à cobrança nº 932162415'),
      ).toBe('932162415');
    });
  });
});
