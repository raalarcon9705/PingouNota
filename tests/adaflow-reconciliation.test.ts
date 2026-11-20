import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabase, type PingouNotaDB } from '../src/storage/database';
import type { Payment } from '../src/domain/payment';
import {
  fetchAdaflowDeclarations,
  getLastReconciliationAudit,
  getAdaflowSyncState,
  setAdaflowSyncState,
  _resetSyncStateForTesting,
  ADAFLOW_SYNC_STATE_STORAGE_KEY,
  importAdaflowTakers,
  normalizeDateIso,
  reconcileAdaflowDeclarations,
  _resetMemoryAuditForTesting,
  type AdaflowReconciledDeclaration,
} from '../src/services/adaflow-reconciliation';
import { extensionMessageSchema } from '../src/shared/messages';

describe('Adaflow Reconciliation Service', () => {
  let testDb: PingouNotaDB;

  beforeEach(async () => {
    _resetMemoryAuditForTesting();
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
          description: 'Prestação de serviço de software 1001',
        },
        {
          asaasPaymentId: '1002',
          adaflowNfseId: 8882,
          nfseNumber: 'Nº 2',
          date: '18/10/2026',
          amountCents: 20000,
          description: 'Consultoria técnica 1002',
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

      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

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

      // Verify audit trail record structure and storage
      const audit = await getLastReconciliationAudit();
      expect(audit).not.toBeNull();
      expect(audit?.declarationsFound).toBe(4);
      expect(audit?.matchedCount).toBe(2);
      expect(audit?.updatedCount).toBe(1);
      expect(audit?.alreadyDeclaredCount).toBe(1);
      expect(audit?.unmatchedCount).toBe(2);
      expect(audit?.details).toHaveLength(4);
      expect(audit?.details[0]).toEqual({
        asaasPaymentId: '1001',
        nfseNumber: 'Nº 1',
        adaflowNfseId: 8881,
        date: '17/10/2026',
        description: 'Prestação de serviço de software 1001',
        status: 'updated',
        requiresManualAction: false,
      });
      expect(audit?.details[1]).toEqual({
        asaasPaymentId: '1002',
        nfseNumber: 'Nº 2',
        adaflowNfseId: 8882,
        date: '18/10/2026',
        description: 'Consultoria técnica 1002',
        status: 'already_declared',
        requiresManualAction: false,
      });
      expect(audit?.details[2]).toEqual({
        asaasPaymentId: '1003',
        nfseNumber: 'Nº 3',
        adaflowNfseId: 8883,
        date: undefined,
        description: undefined,
        status: 'not_found',
        requiresManualAction: true,
      });
      expect(audit?.details[3]).toEqual({
        asaasPaymentId: '9999',
        nfseNumber: undefined,
        adaflowNfseId: 8884,
        date: undefined,
        description: undefined,
        status: 'not_found',
        requiresManualAction: true,
      });
      expect(result.audit).toEqual(audit);

      // Verify console logs
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('[PingouNota:Reconciliação] 🔄 Iniciando conciliação de 4 notas'),
      );
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('[PingouNota:Reconciliação] ✅ Cobrança Asaas 1001: marcada como DECLARADA'),
      );
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('[PingouNota:Reconciliação] ℹ️ Cobrança Asaas 1002: já estava declarada'),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Atenção: Ação Manual Requerida] Cobrança Asaas 1003 (Nota Nº 3): não encontrada'),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Atenção: Ação Manual Requerida] Cobrança Asaas 9999 (Nota 8884): não encontrada'),
      );
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('[PingouNota:Reconciliação] 📊 Conciliação finalizada: 2 correspondências (1 recém-marcadas, 1 já declaradas, 2 não encontradas no Asaas).'),
      );

      infoSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it('reconciles payments in falha_adaflow state to marcado_localmente', async () => {
      const pFailed = makePayment({
        recordKey: 'rec_failed',
        sourcePaymentId: '2001',
        declarationState: 'falha_adaflow',
      });
      await testDb.payments.put(pFailed);

      const declarations: AdaflowReconciledDeclaration[] = [
        {
          asaasPaymentId: '2001',
          adaflowNfseId: 9991,
          date: '20/11/2026',
        },
      ];

      const result = await reconcileAdaflowDeclarations(declarations, testDb);
      expect(result.matchedCount).toBe(1);
      expect(result.updatedCount).toBe(1);

      const updated = await testDb.payments.get(['asaas', 'rec_failed']);
      expect(updated?.declarationState).toBe('marcado_localmente');
      expect(updated?.manualDeclaredAt).toContain('2026-11-20');
    });

    it('records unmatched notes (like Notas 66 e 67) requiring manual action in audit record', async () => {
      const pMatched = makePayment({
        recordKey: 'rec_matched',
        sourcePaymentId: '3001',
        declarationState: 'nao_declarado',
      });
      await testDb.payments.put(pMatched);

      const declarations: AdaflowReconciledDeclaration[] = [
        {
          asaasPaymentId: '3001',
          adaflowNfseId: 1065,
          nfseNumber: '65',
          date: '10/11/2026',
        },
      ];

      const unmatchedNotes = [
        {
          adaflowNfseId: 1066,
          nfseNumber: '66',
          takerName: 'Empresa Alpha Ltda',
          date: '11/11/2026',
          asaasPaymentId: '891557',
          description: 'Desenvolvimento de software referente a cobranca Asaas 891557',
          requiresManualAction: true,
          reason: 'Cobrança Asaas não encontrada na base local de pagamentos.',
        },
        {
          adaflowNfseId: 1067,
          nfseNumber: '67',
          takerName: 'Empresa Beta S/A',
          date: '12/11/2026',
          asaasPaymentId: null,
          description: 'Consultoria e mentoria avulsa sem ID',
          requiresManualAction: true,
        },
      ];

      const result = await reconcileAdaflowDeclarations(
        declarations,
        testDb,
        undefined,
        undefined,
        unmatchedNotes,
      );

      expect(result.matchedCount).toBe(1);
      expect(result.updatedCount).toBe(1);
      expect(result.declarationsFound).toBe(3);

      const audit = await getLastReconciliationAudit();
      expect(audit).not.toBeNull();
      expect(audit?.unmatchedCount).toBe(2);
      expect(audit?.details).toHaveLength(3);

      const note66 = audit?.details.find((d) => d.adaflowNfseId === 1066);
      expect(note66).toBeDefined();
      expect(note66?.asaasPaymentId).toBe('891557');
      expect(note66?.nfseNumber).toBe('66');
      expect(note66?.takerName).toBe('Empresa Alpha Ltda');
      expect(note66?.status).toBe('not_found');
      expect(note66?.requiresManualAction).toBe(true);
      expect(note66?.reason).toBe(
        'Cobrança Asaas não encontrada na base local de pagamentos.',
      );

      const note67 = audit?.details.find((d) => d.adaflowNfseId === 1067);
      expect(note67).toBeDefined();
      expect(note67?.asaasPaymentId).toBe('');
      expect(note67?.nfseNumber).toBe('67');
      expect(note67?.takerName).toBe('Empresa Beta S/A');
      expect(note67?.status).toBe('not_found');
      expect(note67?.requiresManualAction).toBe(true);
    });
  });

  describe('Adaflow Sync State Tracking', () => {
    beforeEach(() => {
      _resetSyncStateForTesting();
    });

    it('returns null when no sync state has been recorded', async () => {
      const state = await getAdaflowSyncState();
      expect(state).toBeNull();
    });

    it('persists and retrieves active sync state with pagination progress', async () => {
      await setAdaflowSyncState({
        isSyncing: true,
        progressMessage: 'Escaneando página 3 de notas na Adaflow...',
        currentPage: 3,
        totalPages: 5,
        updatedAt: '2026-11-20T18:00:00.000Z',
      });

      const state = await getAdaflowSyncState();
      expect(state).toEqual({
        isSyncing: true,
        progressMessage: 'Escaneando página 3 de notas na Adaflow...',
        currentPage: 3,
        totalPages: 5,
        updatedAt: '2026-11-20T18:00:00.000Z',
      });
    });

    it('updates to idle state when sync finishes', async () => {
      await setAdaflowSyncState({
        isSyncing: true,
        progressMessage: 'Iniciando...',
        updatedAt: '2026-11-20T18:00:00.000Z',
      });

      await setAdaflowSyncState({
        isSyncing: false,
        progressMessage: undefined,
        updatedAt: '2026-11-20T18:01:00.000Z',
      });

      const state = await getAdaflowSyncState();
      expect(state?.isSyncing).toBe(false);
      expect(state?.progressMessage).toBeUndefined();
    });

    it('clears sync state on _resetSyncStateForTesting', async () => {
      await setAdaflowSyncState({
        isSyncing: true,
        updatedAt: '2026-11-20T18:00:00.000Z',
      });
      _resetSyncStateForTesting();
      expect(await getAdaflowSyncState()).toBeNull();
    });
  });

  describe('Extension Messages Schema', () => {
    it('validates ADAFLOW_RECONCILIATION_COMPLETED message', () => {
      const validMsg = {
        type: 'ADAFLOW_RECONCILIATION_COMPLETED',
        matchedCount: 3,
        updatedCount: 2,
        declarationsFound: 5,
      };
      const parsed = extensionMessageSchema.safeParse(validMsg);
      expect(parsed.success).toBe(true);
    });

    it('validates ADAFLOW_RECONCILIATION_OBSERVED with unmatchedNotes', () => {
      const validMsg = {
        type: 'ADAFLOW_RECONCILIATION_OBSERVED',
        declarations: [
          {
            asaasPaymentId: '1001',
            adaflowNfseId: 10,
          },
        ],
        unmatchedNotes: [
          {
            adaflowNfseId: 11,
            nfseNumber: '66',
            takerName: 'Empresa Teste',
            requiresManualAction: true,
          },
        ],
      };
      const parsed = extensionMessageSchema.safeParse(validMsg);
      expect(parsed.success).toBe(true);
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

      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const groupSpy = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
      const openGroupSpy = vi.spyOn(console, 'group').mockImplementation(() => {});
      const tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {});
      const groupEndSpy = vi.spyOn(console, 'groupEnd').mockImplementation(() => {});

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
        description: 'Serviço de suporte referente à cobrança Asaas nº 55443322',
      });
      expect(declarations[1]).toEqual({
        asaasPaymentId: '99887766',
        adaflowNfseId: 203,
        nfseNumber: 'Nº 12',
        date: '17/10/2026',
        amountCents: 30000,
        pdfUrl: undefined,
        description: 'Fatura mensal Asaas #99887766',
      });

      expect(declarations.pagesScanned).toBe(2);
      expect(declarations.totalInvoicesFound).toBe(3);
      expect(declarations.takers).toEqual([
        {
          serviceTakerId: undefined,
          name: 'Empresa A',
          document: null,
          email: null,
          phone: null,
          address: undefined,
          discoveredFromNfse: 'Nº 10',
        },
        {
          serviceTakerId: undefined,
          name: 'Empresa B',
          document: null,
          email: null,
          phone: null,
          address: undefined,
          discoveredFromNfse: 'Nº 11',
        },
        {
          serviceTakerId: undefined,
          name: 'Empresa C',
          document: null,
          email: null,
          phone: null,
          address: undefined,
          discoveredFromNfse: 'Nº 12',
        },
      ]);
      expect(declarations.templates).toHaveLength(3);
      expect(declarations.templates[0]?.discoveredFromNfse).toBe('Nº 10');

      // Verify scraper logs
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('[PingouNota:Adaflow] 🔍 Iniciando auditoria de notas fiscais emitidas...'),
      );
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('[PingouNota:Adaflow] 📄 Página 1: 2 notas encontradas. Próxima: /nfses?page=2'),
      );
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('[PingouNota:Adaflow] ✅ Nota Nº 10 -> Vinculada à cobrança Asaas nº 55443322'),
      );
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('[PingouNota:Adaflow] ℹ️ Nota Nº 11 (Empresa B): sem referência Asaas'),
      );
      expect(groupSpy).toHaveBeenCalledWith(
        expect.stringContaining('[PingouNota:Adaflow] 📊 Resumo de notas com referência Asaas encontradas'),
      );
      expect(openGroupSpy).toHaveBeenCalledWith(
        expect.stringContaining('📋 Detalhe das Notas Fiscais Escaneadas'),
      );
      expect(tableSpy).toHaveBeenCalledTimes(2);
      expect(groupEndSpy).toHaveBeenCalledTimes(2);

      infoSpy.mockRestore();
      debugSpy.mockRestore();
      groupSpy.mockRestore();
      openGroupSpy.mockRestore();
      tableSpy.mockRestore();
      groupEndSpy.mockRestore();
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

  describe('importAdaflowTakers', () => {
    it('imports new takers and generates IDs appropriately', async () => {
      const takers = [
        { serviceTakerId: '21116', name: 'Avanto LLC' },
        { name: 'Empresa Sem ID' },
      ];

      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

      const imported = await importAdaflowTakers(takers, testDb);
      expect(imported).toBe(2);

      const t1 = await testDb.takers.get('21116');
      expect(t1).toBeDefined();
      expect(t1?.name).toBe('Avanto LLC');
      expect(t1?.externalId).toBe('21116');
      expect(t1?.address.city).toBe('São Paulo');

      const allTakers = await testDb.takers.toArray();
      expect(allTakers).toHaveLength(2);
      const t2 = allTakers.find((t) => t.name === 'Empresa Sem ID');
      expect(t2).toBeDefined();
      expect(t2?.id).toContain('taker_empresa_sem_id');

      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('[PingouNota:Tomadores] 👥 2 tomadores importados/atualizados da Adaflow.'),
      );

      infoSpy.mockRestore();
    });

    it('does not overwrite existing complete taker records', async () => {
      await testDb.takers.put({
        id: '21116',
        name: 'Avanto Original',
        document: '12.345.678/0001-90',
        externalId: '21116',
        email: 'contato@avanto.com',
        address: {
          line1: 'Rua Principal',
          number: '100',
          neighborhood: 'Centro',
          city: 'Curitiba',
          state: 'PR',
          postalCode: '80000-000',
          country: 'Brasil',
        },
      });

      const imported = await importAdaflowTakers(
        [{ serviceTakerId: '21116', name: 'Avanto LLC' }],
        testDb,
      );

      expect(imported).toBe(0);
      const after = await testDb.takers.get('21116');
      expect(after?.name).toBe('Avanto Original');
      expect(after?.document).toBe('12.345.678/0001-90');
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

    it('validates message with description field', () => {
      const validMsgWithDesc = {
        type: 'ADAFLOW_RECONCILIATION_OBSERVED',
        declarations: [
          {
            asaasPaymentId: 'pay_9988',
            adaflowNfseId: 12345,
            nfseNumber: 'Nº 50',
            date: '17/10/2026',
            amountCents: 15000,
            pdfUrl: 'https://app.adaflow.com/nf-50.pdf',
            description: 'Serviços de desenvolvimento de software referente à cobrança Asaas 9988',
          },
        ],
      };

      const result = extensionMessageSchema.safeParse(validMsgWithDesc);
      expect(result.success).toBe(true);
      if (result.success && result.data.type === 'ADAFLOW_RECONCILIATION_OBSERVED') {
        expect(result.data.declarations[0]?.description).toBe(
          'Serviços de desenvolvimento de software referente à cobrança Asaas 9988',
        );
      }
    });

    it('validates message with pagesScanned, totalInvoicesFound, and takers', () => {
      const validMsgWithStats = {
        type: 'ADAFLOW_RECONCILIATION_OBSERVED',
        declarations: [
          {
            asaasPaymentId: 'pay_9988',
            adaflowNfseId: 12345,
            nfseNumber: 'Nº 50',
          },
        ],
        pagesScanned: 3,
        totalInvoicesFound: 15,
        takers: [
          {
            serviceTakerId: '21116',
            name: 'Avanto LLC',
          },
        ],
      };

      const result = extensionMessageSchema.safeParse(validMsgWithStats);
      expect(result.success).toBe(true);
      if (result.success && result.data.type === 'ADAFLOW_RECONCILIATION_OBSERVED') {
        expect(result.data.pagesScanned).toBe(3);
        expect(result.data.totalInvoicesFound).toBe(15);
        expect(result.data.takers).toEqual([
          {
            serviceTakerId: '21116',
            name: 'Avanto LLC',
          },
        ]);
      }
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

  describe('Storage persistence for reconciliation audit', () => {
    it('persists audit record in chrome.storage.local when available', async () => {
      const storageMock: Record<string, unknown> = {};
      const originalChrome = (globalThis as unknown as { chrome?: unknown }).chrome;

      (globalThis as unknown as { chrome: unknown }).chrome = {
        storage: {
          local: {
            get: vi.fn((keys: string[], cb: (res: Record<string, unknown>) => void) => {
              const res: Record<string, unknown> = {};
              for (const k of keys) {
                if (storageMock[k] !== undefined) res[k] = storageMock[k];
              }
              cb(res);
            }),
            set: vi.fn((data: Record<string, unknown>, cb?: () => void) => {
              Object.assign(storageMock, data);
              cb?.();
            }),
          },
        },
      };

      try {
        const p1 = makePayment({
          recordKey: 'rec_s1',
          sourcePaymentId: 'pay_audit_test',
          declarationState: 'nao_declarado',
        });
        await testDb.payments.put(p1);

        const declarations: AdaflowReconciledDeclaration[] = [
          {
            asaasPaymentId: 'pay_audit_test',
            adaflowNfseId: 7777,
            nfseNumber: 'Nº 77',
            date: '20/11/2026',
            description: 'Serviço prestado com sucesso',
          },
        ];

        await reconcileAdaflowDeclarations(declarations, testDb);

        const audit = await getLastReconciliationAudit();
        expect(audit).not.toBeNull();
        expect(audit?.details[0]?.asaasPaymentId).toBe('pay_audit_test');
        expect(audit?.details[0]?.description).toBe('Serviço prestado com sucesso');
        expect(storageMock['last_reconciliation_audit']).toEqual(audit);
      } finally {
        (globalThis as unknown as { chrome: unknown }).chrome = originalChrome;
      }
    });
  });
});
