import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabase, type PingouNotaDB } from '../../src/storage/database';
import { clearPayments, listPayments } from '../../src/storage/payment-repository';
import {
  calculatePaymentFingerprint,
  coordinatePaymentsObservation,
  createPaymentFromObservation,
  createRecordIdentity,
  processObservedPayments,
  ScanCoordinator,
  type ProviderAdapter,
  type ScanProgress,
} from '../../src/services/scan-coordinator';
import type { ObservedPayment, ParseResult } from '../../src/shared/observed-payment';
import { extensionMessageSchema } from '../../src/shared/messages';

function createDocument(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('Scan Coordinator, Identity & Pagination', () => {
  let testDb: PingouNotaDB;

  beforeEach(async () => {
    testDb = createDatabase(`test-scan-db-${Date.now()}-${Math.random()}`);
    await clearPayments(testDb);
  });

  const sampleHighConfidenceObs: ObservedPayment = {
    provider: 'asaas',
    sourcePaymentId: 'pay_123',
    identityConfidence: 'high',
    payerName: 'Empresa Alpha',
    amountCents: 150000,
    currency: 'BRL',
    paymentDate: '2026-11-15',
    sourceStatus: 'Recebido',
    paymentState: 'recebido',
  };

  const sampleLowConfidenceObs: ObservedPayment = {
    provider: 'asaas',
    sourcePaymentId: null,
    identityConfidence: 'low',
    payerName: 'Empresa Alpha',
    amountCents: 150000,
    currency: 'BRL',
    paymentDate: '2026-11-15',
    sourceStatus: 'Recebido',
    paymentState: 'recebido',
  };

  describe('Payment Identity (createRecordIdentity)', () => {
    it('generates high confidence identity with null fingerprint', async () => {
      const identity = await createRecordIdentity(sampleHighConfidenceObs, 1, []);
      expect(identity.recordKey).toBe('asaas_pay_123');
      expect(identity.identityConfidence).toBe('high');
      expect(identity.ambiguousIdentity).toBe(false);
      expect(identity.identityFingerprint).toBeNull();
    });

    it('generates unique low confidence composite identity using SHA-256', async () => {
      const identity = await createRecordIdentity(sampleLowConfidenceObs, 1, []);
      const expectedFingerprint = await calculatePaymentFingerprint(sampleLowConfidenceObs);

      expect(expectedFingerprint).toHaveLength(64); // SHA-256 hex string
      expect(identity.identityConfidence).toBe('low');
      expect(identity.ambiguousIdentity).toBe(false);
      expect(identity.identityFingerprint).toBe(expectedFingerprint);
      expect(identity.recordKey).toBe(`asaas_comp_${expectedFingerprint}`);
    });

    it('flags identity as ambiguous on scan occurrences collision (scanOccurrences > 1)', async () => {
      const identity1 = await createRecordIdentity(sampleLowConfidenceObs, 2, []);
      const identity2 = await createRecordIdentity(sampleLowConfidenceObs, 2, []);
      const expectedFingerprint = await calculatePaymentFingerprint(sampleLowConfidenceObs);

      expect(identity1.identityConfidence).toBe('low');
      expect(identity1.ambiguousIdentity).toBe(true);
      expect(identity1.identityFingerprint).toBe(expectedFingerprint);
      expect(identity1.recordKey).toContain(`asaas_ambig_${expectedFingerprint}_`);

      expect(identity2.identityConfidence).toBe('low');
      expect(identity2.ambiguousIdentity).toBe(true);
      expect(identity2.identityFingerprint).toBe(expectedFingerprint);
      expect(identity2.recordKey).toContain(`asaas_ambig_${expectedFingerprint}_`);

      // Both receive distinct random UUID keys to avoid merging
      expect(identity1.recordKey).not.toBe(identity2.recordKey);
    });

    it('flags identity as ambiguous when multiple existing records share fingerprint', async () => {
      const expectedFingerprint = await calculatePaymentFingerprint(sampleLowConfidenceObs);
      const existingPayment1 = await createPaymentFromObservation(sampleLowConfidenceObs);
      const existingPayment2 = await createPaymentFromObservation(sampleLowConfidenceObs);

      const identity = await createRecordIdentity(sampleLowConfidenceObs, 1, [
        existingPayment1,
        existingPayment2,
      ]);

      expect(identity.identityConfidence).toBe('low');
      expect(identity.ambiguousIdentity).toBe(true);
      expect(identity.identityFingerprint).toBe(expectedFingerprint);
      expect(identity.recordKey).toContain(`asaas_ambig_${expectedFingerprint}_`);
    });

    it('flags collision when existing match is already marked ambiguous', async () => {
      const existingAmbiguous = await createPaymentFromObservation(sampleLowConfidenceObs);
      existingAmbiguous.ambiguousIdentity = true;

      const identity = await createRecordIdentity(sampleLowConfidenceObs, 1, [existingAmbiguous]);

      expect(identity.identityConfidence).toBe('low');
      expect(identity.ambiguousIdentity).toBe(true);
      expect(identity.recordKey).toContain('asaas_ambig_');
    });

    it('handles ambiguous collision in processObservedPayments without merging rows', async () => {
      // 2 identical observations in the same batch
      const obsList: ObservedPayment[] = [
        { ...sampleLowConfidenceObs },
        { ...sampleLowConfidenceObs },
      ];

      const saved = await processObservedPayments(obsList, '2026-11-19T10:00:00Z', testDb);
      expect(saved).toHaveLength(2);

      const fromDb = await listPayments(undefined, testDb);
      expect(fromDb).toHaveLength(2);

      expect(fromDb[0]?.ambiguousIdentity).toBe(true);
      expect(fromDb[1]?.ambiguousIdentity).toBe(true);
      expect(fromDb[0]?.recordKey).not.toBe(fromDb[1]?.recordKey);
    });

    it('persists observed payments and coordinates action badge updates', async () => {
      const observations: ObservedPayment[] = [
        sampleHighConfidenceObs,
        {
          provider: 'asaas',
          sourcePaymentId: 'pay_pending',
          identityConfidence: 'high',
          payerName: 'Empresa Beta',
          amountCents: 80000,
          currency: 'BRL',
          paymentDate: '2026-11-16',
          sourceStatus: 'Aguardando pagamento',
          paymentState: 'aguardando_recebimento',
        },
      ];

      const { savedPayments, undeclaredCount } = await coordinatePaymentsObservation(
        observations,
        '2026-11-19T10:00:00Z',
        testDb,
      );

      expect(savedPayments).toHaveLength(2);
      expect(undeclaredCount).toBe(1);

      const fromDb = await listPayments(undefined, testDb);
      expect(fromDb).toHaveLength(2);
    });
  });

  describe('ScanCoordinator Navigation, Progress and Safe Fallback', () => {
    it('executes complete scan (walks pages until end) and restores starting URL', async () => {
      const coordinator = new ScanCoordinator();
      const progressList: ScanProgress[] = [];

      let currentUrl = 'https://app.asaas.com/customerPayment/index';
      let pageNum = 1;

      const page1Doc = createDocument(`
        <table data-testid="payments-table">
          <tbody>
            <tr data-payment-id="p1"><td data-field="status">Recebido</td></tr>
            <tr data-payment-id="p2"><td data-field="status">Recebido</td></tr>
          </tbody>
        </table>
        <a class="pagination-next" href="/customerPayment/index?page=2">Next</a>
      `);

      const page2Doc = createDocument(`
        <table data-testid="payments-table">
          <tbody>
            <tr data-payment-id="p3"><td data-field="status">Recebido</td></tr>
          </tbody>
        </table>
        <a class="pagination-next disabled" href="/customerPayment/index?page=2">Next</a>
      `);

      const mockAdapter: ProviderAdapter = {
        provider: 'asaas',
        parse(doc: Document): ParseResult {
          const rows = doc.querySelectorAll('tr[data-payment-id]');
          const payments: ObservedPayment[] = Array.from(rows).map((row) => ({
            provider: 'asaas',
            sourcePaymentId: row.getAttribute('data-payment-id'),
            identityConfidence: 'high',
            payerName: 'Customer',
            amountCents: 10000,
            currency: 'BRL',
            paymentDate: '2026-11-18',
            sourceStatus: 'Recebido',
            paymentState: 'recebido',
          }));
          return {
            payments,
            warnings: [],
            pagination: { kind: 'end' },
          };
        },
        nextPage(doc: Document) {
          const btn = doc.querySelector('.pagination-next');
          if (!btn || btn.classList.contains('disabled')) {
            return { kind: 'end' };
          }
          return { kind: 'next', href: btn.getAttribute('href')! };
        },
        isSupportedRoute(url: string) {
          return url.includes('/customerPayment/index');
        },
      };

      const navigateFn = vi.fn(async (targetUrl: string) => {
        currentUrl = targetUrl;
        if (targetUrl.includes('page=2')) {
          pageNum = 2;
        } else {
          pageNum = 1;
        }
        return true;
      });

      const result = await coordinator.runScan('asaas', {
        initialUrl: 'https://app.asaas.com/customerPayment/index',
        getCurrentUrl: () => currentUrl,
        getDocument: () => (pageNum === 1 ? page1Doc : page2Doc),
        navigate: navigateFn,
        adapter: mockAdapter,
        dbInstance: testDb,
        broadcastProgress: (p) => progressList.push(p),
      });

      expect(result.status).toBe('complete');
      expect(result.pagesSeen).toBe(2);
      expect(result.recordsFound).toBe(3);
      expect(result.restoreStatus).toBe('restored');
      expect(currentUrl).toBe('https://app.asaas.com/customerPayment/index');

      // Verify payments saved to DB
      const inDb = await listPayments(undefined, testDb);
      expect(inDb).toHaveLength(3);

      // Verify progress was broadcast
      expect(progressList.length).toBeGreaterThanOrEqual(3);
      expect(progressList[progressList.length - 1]?.status).toBe('complete');
    });

    it('falls back to partial scan when pagination is unsupported', async () => {
      const coordinator = new ScanCoordinator();
      const currentUrl = 'https://app.husky.io/transfers';

      const brokenDoc = createDocument(`
        <div data-testid="transfers-list">
          <article data-transfer-id="t100"><span data-field="status">Na conta</span></article>
        </div>
        <div class="pagination">Broken pagination markup</div>
      `);

      const mockAdapter: ProviderAdapter = {
        provider: 'husky',
        parse(_doc: Document): ParseResult {
          return {
            payments: [
              {
                provider: 'husky',
                sourcePaymentId: 't100',
                identityConfidence: 'high',
                payerName: 'Sender',
                amountCents: 50000,
                currency: 'USD',
                paymentDate: '2026-11-18',
                sourceStatus: 'Na conta',
                paymentState: 'recebido',
              },
            ],
            warnings: [],
            pagination: { kind: 'unsupported', reason: 'Pagination control broken' },
          };
        },
        nextPage(_doc: Document) {
          return { kind: 'unsupported', reason: 'Pagination control broken' };
        },
        isSupportedRoute(url: string) {
          return url.includes('/transfers');
        },
      };

      const result = await coordinator.runScan('husky', {
        initialUrl: currentUrl,
        getCurrentUrl: () => currentUrl,
        getDocument: () => brokenDoc,
        adapter: mockAdapter,
        dbInstance: testDb,
      });

      expect(result.status).toBe('partial');
      expect(result.reason).toBe('Pagination control broken');
      expect(result.pagesSeen).toBe(1);
      expect(result.recordsFound).toBe(1);

      // Observations on visible page must still be saved immediately
      const inDb = await listPayments(undefined, testDb);
      expect(inDb).toHaveLength(1);
      expect(inDb[0]?.sourcePaymentId).toBe('t100');
    });

    it('pauses scan when user interaction is detected', async () => {
      const coordinator = new ScanCoordinator();
      let currentUrl = 'https://app.asaas.com/customerPayment/index';

      const doc = createDocument(`
        <table data-testid="payments-table">
          <tbody><tr data-payment-id="p1"><td>Item</td></tr></tbody>
        </table>
        <a class="pagination-next" href="/customerPayment/index?page=2">Next</a>
      `);

      const mockAdapter: ProviderAdapter = {
        provider: 'asaas',
        parse() {
          return {
            payments: [
              {
                provider: 'asaas',
                sourcePaymentId: 'p1',
                identityConfidence: 'high',
                payerName: 'A',
                amountCents: 1000,
                currency: 'BRL',
                paymentDate: '2026-11-10',
                sourceStatus: 'Recebido',
                paymentState: 'recebido',
              },
            ],
            warnings: [],
            pagination: { kind: 'next', href: '/customerPayment/index?page=2' },
          };
        },
        nextPage() {
          return { kind: 'next', href: '/customerPayment/index?page=2' };
        },
        isSupportedRoute: () => true,
      };

      // Simulate user clicking on page before navigation executes
      coordinator.recordUserInteraction();

      const result = await coordinator.runScan('asaas', {
        initialUrl: currentUrl,
        getCurrentUrl: () => currentUrl,
        getDocument: () => doc,
        adapter: mockAdapter,
        dbInstance: testDb,
      });

      expect(result.status).toBe('paused');
      expect(result.reason).toContain('User interaction');
      expect(result.pagesSeen).toBe(0);
    });

    it('supports scan cancel via SCAN_CONTROL', async () => {
      const coordinator = new ScanCoordinator();
      const controlRes = await coordinator.handleScanControl('cancel', 'asaas', 'scan_test_1', testDb);

      expect(controlRes.status).toBe('failed');
      const meta = await coordinator.getScanMetadata('asaas', testDb);
      expect(meta?.status).toBe('failed');
      expect(meta?.reason).toContain('cancelled');
    });

    it('detects unsafe navigation target outside portal route or origin', async () => {
      const coordinator = new ScanCoordinator();
      const currentUrl = 'https://app.asaas.com/customerPayment/index';
      const navigateFn = vi.fn(async () => true);

      const maliciousDoc = createDocument(`
        <table data-testid="payments-table"><tbody></tbody></table>
        <a class="pagination-next" href="https://malicious-external-site.com/steal">Next</a>
      `);

      const mockAdapter: ProviderAdapter = {
        provider: 'asaas',
        parse: () => ({ payments: [], warnings: [], pagination: { kind: 'next', href: 'https://malicious-external-site.com/steal' } }),
        nextPage: () => ({ kind: 'next', href: 'https://malicious-external-site.com/steal' }),
        isSupportedRoute: (url: string) => url.startsWith('https://app.asaas.com/customerPayment/'),
      };

      const result = await coordinator.runScan('asaas', {
        initialUrl: currentUrl,
        getCurrentUrl: () => currentUrl,
        getDocument: () => maliciousDoc,
        navigate: navigateFn,
        adapter: mockAdapter,
        dbInstance: testDb,
      });

      expect(result.status).toBe('partial');
      expect(result.reason).toContain('outside allowed portal origin or route');
      // Must not follow unsafe link
      expect(navigateFn).not.toHaveBeenCalled();
    });

    it('detects URL divergence when active URL changes from expected target', async () => {
      const coordinator = new ScanCoordinator();
      const initialUrl = 'https://app.husky.io/transfers';
      let activeUrl = 'https://app.husky.io/account/billing'; // Diverged URL

      const doc = createDocument(`<div data-testid="transfers-list"></div>`);

      const mockAdapter: ProviderAdapter = {
        provider: 'husky',
        parse: () => ({ payments: [], warnings: [], pagination: { kind: 'end' } }),
        nextPage: () => ({ kind: 'end' }),
        isSupportedRoute: (url: string) => url.startsWith('https://app.husky.io/transfers'),
      };

      const result = await coordinator.runScan('husky', {
        initialUrl,
        getCurrentUrl: () => activeUrl,
        getDocument: () => doc,
        adapter: mockAdapter,
        dbInstance: testDb,
      });

      expect(result.status).toBe('partial');
      expect(result.reason).toContain('diverged from expected target');
    });

    it('handles failed restoration gracefully and sets restoreStatus = failed', async () => {
      const coordinator = new ScanCoordinator();
      let currentUrl = 'https://app.asaas.com/customerPayment/index';
      let page = 1;

      const page1Doc = createDocument(`
        <table data-testid="payments-table">
          <tbody><tr data-payment-id="p1"><td>A</td></tr></tbody>
        </table>
        <a class="pagination-next" href="/customerPayment/index?page=2">Next</a>
      `);

      const page2Doc = createDocument(`
        <table data-testid="payments-table">
          <tbody><tr data-payment-id="p2"><td>B</td></tr></tbody>
        </table>
        <a class="pagination-next disabled" href="/customerPayment/index?page=2">Next</a>
      `);

      const mockAdapter: ProviderAdapter = {
        provider: 'asaas',
        parse(doc: Document) {
          const rows = doc.querySelectorAll('tr[data-payment-id]');
          return {
            payments: Array.from(rows).map((r) => ({
              provider: 'asaas',
              sourcePaymentId: r.getAttribute('data-payment-id'),
              identityConfidence: 'high',
              payerName: 'Client',
              amountCents: 5000,
              currency: 'BRL',
              paymentDate: '2026-11-18',
              sourceStatus: 'Recebido',
              paymentState: 'recebido',
            })),
            warnings: [],
            pagination: { kind: 'end' },
          };
        },
        nextPage(doc: Document) {
          const btn = doc.querySelector('.pagination-next');
          if (!btn || btn.classList.contains('disabled')) return { kind: 'end' };
          return { kind: 'next', href: btn.getAttribute('href')! };
        },
        isSupportedRoute: () => true,
      };

      const navigateFn = vi.fn(async (targetUrl: string) => {
        if (targetUrl.includes('page=2')) {
          currentUrl = 'https://app.asaas.com/customerPayment/index?page=2';
          page = 2;
          return true;
        }
        // Fail when restoring to initialUrl
        return false;
      });

      const result = await coordinator.runScan('asaas', {
        initialUrl: 'https://app.asaas.com/customerPayment/index',
        getCurrentUrl: () => currentUrl,
        getDocument: () => (page === 1 ? page1Doc : page2Doc),
        navigate: navigateFn,
        adapter: mockAdapter,
        dbInstance: testDb,
      });

      expect(result.status).toBe('partial');
      expect(result.restoreStatus).toBe('failed');
      expect(result.reason).toContain('Failed to restore starting view');
    });

    it('coordinates portal list detection and determines full vs incremental scan', async () => {
      const coordinator = new ScanCoordinator();

      // First time: no scan completed -> full scan
      const first = await coordinator.determineScanType('asaas', testDb);
      expect(first.scanType).toBe('full');
      expect(first.shouldResume).toBe(false);

      // Simulate completed scan
      await coordinator.persistScanMetadata(
        {
          lastScanId: 'scan_001',
          provider: 'asaas',
          status: 'complete',
          lastScanType: 'full',
          pagesSeen: 5,
          recordsFound: 50,
          reason: null,
          updatedAt: new Date().toISOString(),
        },
        testDb,
      );

      // Next visit: incremental scan
      const second = await coordinator.determineScanType('asaas', testDb);
      expect(second.scanType).toBe('incremental');
      expect(second.shouldResume).toBe(false);

      // If last scan was partial -> resumes full scan
      await coordinator.persistScanMetadata(
        {
          lastScanId: 'scan_002',
          provider: 'asaas',
          status: 'partial',
          lastScanType: 'full',
          pagesSeen: 2,
          recordsFound: 20,
          reason: 'Pagination broken',
          updatedAt: new Date().toISOString(),
        },
        testDb,
      );

      const third = await coordinator.determineScanType('asaas', testDb);
      expect(third.scanType).toBe('full');
      expect(third.shouldResume).toBe(true);
    });

    it('tracks cumulative fingerprint collisions across multiple pages and flags all ambiguous', async () => {
      const coordinator = new ScanCoordinator();
      let currentUrl = 'https://app.asaas.com/customerPayment/index';
      let pageNum = 1;

      const identicalObservation: ObservedPayment = {
        provider: 'asaas',
        sourcePaymentId: null,
        identityConfidence: 'low',
        payerName: 'Identical Payer',
        amountCents: 50000,
        currency: 'BRL',
        paymentDate: '2026-11-15',
        sourceStatus: 'Recebido',
        paymentState: 'recebido',
      };

      const page1Doc = createDocument(`
        <table data-testid="payments-table">
          <tbody><tr><td>P1</td></tr></tbody>
        </table>
        <a class="pagination-next" href="/customerPayment/index?page=2">Next</a>
      `);

      const page2Doc = createDocument(`
        <table data-testid="payments-table">
          <tbody><tr><td>P2</td></tr></tbody>
        </table>
        <a class="pagination-next disabled" href="/customerPayment/index?page=2">Next</a>
      `);

      const mockAdapter: ProviderAdapter = {
        provider: 'asaas',
        parse() {
          return {
            payments: [{ ...identicalObservation }],
            warnings: [],
            pagination: { kind: 'end' },
          };
        },
        nextPage(doc: Document) {
          const btn = doc.querySelector('.pagination-next');
          if (!btn || btn.classList.contains('disabled')) return { kind: 'end' };
          return { kind: 'next', href: btn.getAttribute('href')! };
        },
        isSupportedRoute: () => true,
      };

      const navigateFn = vi.fn(async (targetUrl: string) => {
        currentUrl = targetUrl;
        pageNum = 2;
        return true;
      });

      const result = await coordinator.runScan('asaas', {
        initialUrl: 'https://app.asaas.com/customerPayment/index',
        getCurrentUrl: () => currentUrl,
        getDocument: () => (pageNum === 1 ? page1Doc : page2Doc),
        navigate: navigateFn,
        adapter: mockAdapter,
        dbInstance: testDb,
      });

      expect(result.status).toBe('complete');
      expect(result.pagesSeen).toBe(2);
      expect(result.recordsFound).toBe(2);

      const fromDb = await listPayments(undefined, testDb);
      expect(fromDb).toHaveLength(2);
      expect(fromDb[0]?.ambiguousIdentity).toBe(true);
      expect(fromDb[1]?.ambiguousIdentity).toBe(true);
      expect(fromDb[0]?.recordKey).not.toBe(fromDb[1]?.recordKey);
    });

    it('stops scan when maxPages limit is reached', async () => {
      const coordinator = new ScanCoordinator();
      let page = 1;
      let currentUrl = 'https://app.asaas.com/customerPayment/index';

      const mockAdapter: ProviderAdapter = {
        provider: 'asaas',
        parse: () => ({
          payments: [],
          warnings: [],
          pagination: { kind: 'next', href: `/customerPayment/index?page=${page + 1}` },
        }),
        nextPage: () => ({ kind: 'next', href: `/customerPayment/index?page=${page + 1}` }),
        isSupportedRoute: () => true,
      };

      const result = await coordinator.runScan('asaas', {
        initialUrl: currentUrl,
        getCurrentUrl: () => currentUrl,
        getDocument: () => createDocument('<div></div>'),
        navigate: async (url) => {
          currentUrl = url;
          page++;
          return true;
        },
        adapter: mockAdapter,
        dbInstance: testDb,
        maxPages: 2,
      });

      expect(result.status).toBe('complete');
      expect(result.pagesSeen).toBe(2);
    });

    it('prevents infinite loop using cycle detection when page links back to a visited URL', async () => {
      const coordinator = new ScanCoordinator();
      let currentUrl = 'https://app.asaas.com/customerPayment/index';
      let page = 1;

      const mockAdapter: ProviderAdapter = {
        provider: 'asaas',
        parse: () => ({ payments: [], warnings: [], pagination: { kind: 'next', href: '/customerPayment/index' } }),
        nextPage: () => {
          const next = page === 1 ? '/customerPayment/index?page=2' : '/customerPayment/index';
          return { kind: 'next', href: next };
        },
        isSupportedRoute: () => true,
      };

      const result = await coordinator.runScan('asaas', {
        initialUrl: currentUrl,
        getCurrentUrl: () => currentUrl,
        getDocument: () => createDocument('<div></div>'),
        navigate: async (url) => {
          currentUrl = url;
          page = 2;
          return true;
        },
        adapter: mockAdapter,
        dbInstance: testDb,
      });

      expect(result.status).toBe('complete');
      expect(result.pagesSeen).toBe(2);
    });
  });

  describe('Extension Messages Schema Validation', () => {
    it('validates SCAN_PROGRESS and SCAN_CONTROL strictly', () => {
      const validProgress = {
        type: 'SCAN_PROGRESS',
        progress: {
          scanId: 'scan_999',
          provider: 'asaas',
          status: 'scanning',
          pagesSeen: 3,
          recordsFound: 25,
          reason: null,
          restoreStatus: 'not_needed',
        },
      };
      expect(extensionMessageSchema.safeParse(validProgress).success).toBe(true);

      const validControl = {
        type: 'SCAN_CONTROL',
        action: 'pause',
        provider: 'husky',
        scanId: 'scan_888',
      };
      expect(extensionMessageSchema.safeParse(validControl).success).toBe(true);

      const invalidControl = {
        type: 'SCAN_CONTROL',
        action: 'invalid_action',
        provider: 'husky',
      };
      expect(extensionMessageSchema.safeParse(invalidControl).success).toBe(false);
    });
  });
});
