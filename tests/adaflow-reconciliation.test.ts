import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabase, type PingouNotaDB } from '../src/storage/database';
import type { Payment } from '../src/domain/payment';
import {
  fetchAdaflowDeclarations,
  normalizeDateIso,
  reconcileAdaflowDeclarations,
  type AdaflowReconciledDeclaration,
} from '../src/services/adaflow-reconciliation';
import { extensionMessageSchema } from '../src/shared/messages';

describe('Adaflow Reconciliation Service', () => {
  let testDb: PingouNotaDB;

  beforeEach(async () => {
    testDb = createDatabase(`test-db-${Date.now()}-${Math.random()}`);
    await testDb.payments.clear();
  });

  function makePayment(overrides: Partial<Payment> = {}): Payment {
    const recordKey = overrides.recordKey ?? 'pay_001';
    return {
      provider: 'asaas',
      recordKey,
      sourcePaymentId: overrides.sourcePaymentId !== undefined ? overrides.sourcePaymentId : recordKey,
      identityConfidence: 'high',
      ambiguousIdentity: false,
      identityFingerprint: `fp_${recordKey}`,
      payerName: 'Cliente Teste',
      amountCents: 15000,
      currency: 'BRL',
      paymentDate: '2026-10-15',
      sourceStatus: 'Recebido',
      paymentState: 'recebido',
      declarationState: 'nao_declarado',
      lastObservedAt: '2026-10-16T10:00:00Z',
      manualDeclaredAt: null,
      ...overrides,
    };
  }

  describe('normalizeDateIso', () => {
    it('normalizes DD/MM/YYYY into ISO date format', () => {
      const iso = normalizeDateIso('17/10/2026');
      expect(iso).toContain('2026-10-17');
      expect(new Date(iso).getTime()).not.toBeNaN();
    });

    it('normalizes valid ISO strings', () => {
      const iso = normalizeDateIso('2026-11-20T10:00:00.000Z');
      expect(iso).toBe('2026-11-20T10:00:00.000Z');
    });

    it('falls back to current time on empty or invalid date', () => {
      const fallbackNull = normalizeDateIso(null);
      const fallbackEmpty = normalizeDateIso('');
      const fallbackInvalid = normalizeDateIso('not-a-date');

      expect(new Date(fallbackNull).getTime()).not.toBeNaN();
      expect(new Date(fallbackEmpty).getTime()).not.toBeNaN();
      expect(new Date(fallbackInvalid).getTime()).not.toBeNaN();
    });
  });

  describe('reconcileAdaflowDeclarations', () => {
    it('reconciles and updates undeclared Asaas payments to marcado_localmente', async () => {
      const p1 = makePayment({
        recordKey: 'rec_01',
        sourcePaymentId: '1001',
        declarationState: 'nao_declarado',
      });
      const p2 = makePayment({
        recordKey: 'rec_02',
        sourcePaymentId: '1002',
        declarationState: 'marcado_localmente',
        manualDeclaredAt: '2026-09-01T00:00:00.000Z',
      });
      const pHusky = makePayment({
        provider: 'husky',
        recordKey: 'rec_03',
        sourcePaymentId: '1003',
        declarationState: 'nao_declarado',
      });

      await testDb.payments.bulkPut([p1, p2, pHusky]);

      const declarations: AdaflowReconciledDeclaration[] = [
        {
          asaasPaymentId: '1001',
          adaflowNfseId: 8881,
          nfseNumber: 'Nº 1',
          date: '17/10/2026',
          amountCents: 15000,
        },
        {
          asaasPaymentId: '1002',
          adaflowNfseId: 8882,
          nfseNumber: 'Nº 2',
          date: '18/10/2026',
          amountCents: 20000,
        },
        {
          asaasPaymentId: '1003', // husky provider should not match
          adaflowNfseId: 8883,
          nfseNumber: 'Nº 3',
        },
        {
          asaasPaymentId: '9999', // not in database
          adaflowNfseId: 8884,
        },
      ];

      const result = await reconcileAdaflowDeclarations(declarations, testDb);

      expect(result.declarationsFound).toBe(4);
      expect(result.matchedCount).toBe(2); // 1001 and 1002
      expect(result.updatedCount).toBe(1); // only 1001 was updated from nao_declarado

      const updatedP1 = await testDb.payments.get(['asaas', 'rec_01']);
      expect(updatedP1?.declarationState).toBe('marcado_localmente');
      expect(updatedP1?.manualDeclaredAt).toContain('2026-10-17');

      const unchangedP2 = await testDb.payments.get(['asaas', 'rec_02']);
      expect(unchangedP2?.declarationState).toBe('marcado_localmente');
      expect(unchangedP2?.manualDeclaredAt).toBe('2026-09-01T00:00:00.000Z');

      const unchangedHusky = await testDb.payments.get(['husky', 'rec_03']);
      expect(unchangedHusky?.declarationState).toBe('nao_declarado');
    });
  });

  describe('fetchAdaflowDeclarations', () => {
    it('traverses multiple pages, fetches slideover details, and extracts Asaas IDs', async () => {
      const page1Html = `
        <div id="nfse_201" data-nfse-id="201" class="group hover:bg-gray-50">
          <p class="w-24">15/10/2026</p>
          <p class="font-semibold text-base truncate">Empresa A</p>
          <p class="text-[13px] text-neutral-500 truncate">Nº 10</p>
          <span class="status-chip--success">Emitido</span>
          <span class="inline-block">R$ 100,00</span>
          <a title="Baixar PDF" href="/files/nf-10.pdf">PDF</a>
        </div>
        <div id="nfse_202" data-nfse-id="202" class="group hover:bg-gray-50">
          <p class="w-24">16/10/2026</p>
          <p class="font-semibold text-base truncate">Empresa B</p>
          <p class="text-[13px] text-neutral-500 truncate">Nº 11</p>
          <span class="status-chip--success">Emitido</span>
          <span class="inline-block">R$ 200,00</span>
        </div>
        <nav class="pagy series-nav">
          <a role="link" aria-current="page">1</a>
          <a href="/nfses?page=2" rel="next">2</a>
        </nav>
      `;

      const page2Html = `
        <div id="nfse_203" data-nfse-id="203" class="group hover:bg-gray-50">
          <p class="w-24">17/10/2026</p>
          <p class="font-semibold text-base truncate">Empresa C</p>
          <p class="text-[13px] text-neutral-500 truncate">Nº 12</p>
          <span class="status-chip--success">Emitido</span>
          <span class="inline-block">R$ 300,00</span>
        </div>
        <nav class="pagy series-nav">
          <a role="link" aria-current="page">2</a>
        </nav>
      `;

      const slideover201 = `
        <turbo-frame id="slideover_body">
          <div data-field="description">Serviço de suporte referente à cobrança Asaas nº 55443322</div>
        </turbo-frame>
      `;

      const slideover202 = `
        <turbo-frame id="slideover_body">
          <div data-field="description">Outro serviço qualquer sem vínculo asaas</div>
        </turbo-frame>
      `;

      const slideover203 = `
        <turbo-frame id="slideover_body">
          <div data-field="description">Fatura mensal Asaas #99887766</div>
        </turbo-frame>
      `;

      const mockFetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(url);

        if (urlStr.endsWith('/nfses')) {
          return new Response(page1Html, { status: 200 });
        }
        if (urlStr.includes('/nfses?page=2')) {
          return new Response(page2Html, { status: 200 });
        }
        if (urlStr.endsWith('/nfses/201')) {
          expect(init?.headers).toEqual({ 'Turbo-Frame': 'slideover_body' });
          expect(init?.credentials).toBe('same-origin');
          return new Response(slideover201, { status: 200 });
        }
        if (urlStr.endsWith('/nfses/202')) {
          return new Response(slideover202, { status: 200 });
        }
        if (urlStr.endsWith('/nfses/203')) {
          return new Response(slideover203, { status: 200 });
        }

        return new Response('Not found', { status: 404 });
      });

      const declarations = await fetchAdaflowDeclarations({
        startUrl: '/nfses',
        maxPages: 10,
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(declarations).toHaveLength(2);
      expect(declarations[0]).toEqual({
        asaasPaymentId: '55443322',
        adaflowNfseId: 201,
        nfseNumber: 'Nº 10',
        date: '15/10/2026',
        amountCents: 10000,
        pdfUrl: '/files/nf-10.pdf',
      });
      expect(declarations[1]).toEqual({
        asaasPaymentId: '99887766',
        adaflowNfseId: 203,
        nfseNumber: 'Nº 12',
        date: '17/10/2026',
        amountCents: 30000,
        pdfUrl: undefined,
      });
    });

    it('handles individual slideover fetch failure gracefully without aborting run', async () => {
      const pageHtml = `
        <div id="nfse_301" data-nfse-id="301" class="group hover:bg-gray-50">
          <p class="font-semibold text-base truncate">Empresa 1</p>
          <span class="inline-block">R$ 50,00</span>
        </div>
        <div id="nfse_302" data-nfse-id="302" class="group hover:bg-gray-50">
          <p class="font-semibold text-base truncate">Empresa 2</p>
          <span class="inline-block">R$ 60,00</span>
        </div>
      `;

      const slideover302 = `
        <turbo-frame id="slideover_body">
          <div>Cobrança Asaas 123456789</div>
        </turbo-frame>
      `;

      const mockFetch = vi.fn(async (url: RequestInfo | URL) => {
        const urlStr = String(url);
        if (urlStr.endsWith('/nfses')) {
          return new Response(pageHtml, { status: 200 });
        }
        if (urlStr.endsWith('/nfses/301')) {
          // Failure on first invoice
          return new Response('Internal Server Error', { status: 500 });
        }
        if (urlStr.endsWith('/nfses/302')) {
          return new Response(slideover302, { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      });

      const declarations = await fetchAdaflowDeclarations({
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(declarations).toHaveLength(1);
      expect(declarations[0]?.asaasPaymentId).toBe('123456789');
      expect(declarations[0]?.adaflowNfseId).toBe(302);
    });

    it('respects maxPages limit', async () => {
      const page1Html = `
        <div id="nfse_401" data-nfse-id="401" class="group hover:bg-gray-50">
          <p class="font-semibold text-base truncate">Empresa</p>
        </div>
        <nav class="pagy series-nav">
          <a href="/nfses?page=2" rel="next">2</a>
        </nav>
      `;

      const mockFetch = vi.fn(async (url: RequestInfo | URL) => {
        const urlStr = String(url);
        if (urlStr.endsWith('/nfses')) {
          return new Response(page1Html, { status: 200 });
        }
        if (urlStr.endsWith('/nfses/401')) {
          return new Response('<turbo-frame id="slideover_body">Asaas nº 778899</turbo-frame>', {
            status: 200,
          });
        }
        return new Response('Not found', { status: 404 });
      });

      const declarations = await fetchAdaflowDeclarations({
        maxPages: 1,
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(declarations).toHaveLength(1);
      // Ensure page 2 was never fetched
      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('page=2'),
        expect.anything(),
      );
    });
  });

  describe('ADAFLOW_RECONCILIATION_OBSERVED message schema', () => {
    it('validates correct ADAFLOW_RECONCILIATION_OBSERVED message', () => {
      const validMsg = {
        type: 'ADAFLOW_RECONCILIATION_OBSERVED',
        declarations: [
          {
            asaasPaymentId: 'pay_9988',
            adaflowNfseId: 12345,
            nfseNumber: 'Nº 50',
            date: '17/10/2026',
            amountCents: 15000,
            pdfUrl: 'https://app.adaflow.com/nf-50.pdf',
          },
        ],
      };

      const result = extensionMessageSchema.safeParse(validMsg);
      expect(result.success).toBe(true);
    });

    it('rejects invalid message missing required fields', () => {
      const invalidMsg = {
        type: 'ADAFLOW_RECONCILIATION_OBSERVED',
        declarations: [
          {
            // missing asaasPaymentId and adaflowNfseId
            nfseNumber: 'Nº 50',
          },
        ],
      };

      const result = extensionMessageSchema.safeParse(invalidMsg);
      expect(result.success).toBe(false);
    });
  });
});
