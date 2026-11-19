import { browser } from 'wxt/browser';
import type { Payment, PaymentProvider } from '../domain/payment';
import type { ObservedPayment, ParseResult, PaginationResult } from '../shared/observed-payment';
import type { ScanProgress } from '../shared/messages';
export type { ScanProgress };
import { listPayments, upsertPayments } from '../storage/payment-repository';
import { db, type PingouNotaDB } from '../storage/database';
import { parseAsaasPayments } from '../parsers/asaas-parser';
import { parseHuskyPayments } from '../parsers/husky-parser';

export type ScanStatus = 'idle' | 'scanning' | 'partial' | 'complete' | 'paused' | 'failed';

export interface ScanResult {
  scanId: string;
  provider: PaymentProvider;
  status: ScanStatus;
  pagesSeen: number;
  recordsFound: number;
  reason: string | null;
  restoreStatus?: 'restored' | 'failed' | 'not_needed';
}

export interface ProviderAdapter {
  provider: PaymentProvider;
  parse(document: Document): ParseResult;
  nextPage(document: Document): PaginationResult;
  isSupportedRoute(url: string): boolean;
}

export interface RecordIdentity {
  recordKey: string;
  identityFingerprint: string | null;
  identityConfidence: 'high' | 'low';
  ambiguousIdentity: boolean;
}

export interface ScanMetadata {
  lastScanId: string;
  provider: PaymentProvider;
  status: ScanStatus;
  lastScanType: 'full' | 'incremental';
  pagesSeen: number;
  recordsFound: number;
  reason: string | null;
  lastCompletedAt?: string;
  updatedAt: string;
}

export interface RunScanOptions {
  scanId?: string;
  initialUrl?: string;
  adapter?: ProviderAdapter;
  navigate?: (url: string) => Promise<boolean>;
  getCurrentUrl?: () => string;
  getDocument?: () => Document;
  broadcastProgress?: (progress: ScanProgress) => void;
  dbInstance?: PingouNotaDB;
  isIncremental?: boolean;
  maxPages?: number;
}

export async function calculatePaymentFingerprint(observation: ObservedPayment): Promise<string> {
  const payer = (observation.payerName || '').trim().toLowerCase();
  const date = observation.paymentDate || '';
  const amount = observation.amountCents || 0;
  const currency = observation.currency || '';
  const inputString = `${observation.provider}|${payer}|${date}|${amount}|${currency}`;

  const encoder = new TextEncoder();
  const data = encoder.encode(inputString);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createRecordIdentity(
  observation: ObservedPayment,
  scanOccurrences: number,
  existingMatches: Payment[],
): Promise<RecordIdentity> {
  if (observation.sourcePaymentId) {
    return {
      recordKey: `${observation.provider}_${observation.sourcePaymentId}`,
      identityConfidence: 'high',
      ambiguousIdentity: false,
      identityFingerprint: null,
    };
  }

  const fingerprint = await calculatePaymentFingerprint(observation);
  const matchingExisting = existingMatches.filter(
    (m) => m.identityFingerprint === fingerprint,
  );

  const isCollision =
    scanOccurrences > 1 ||
    matchingExisting.length > 1 ||
    matchingExisting.some((m) => m.ambiguousIdentity);

  if (!isCollision) {
    return {
      recordKey: `${observation.provider}_comp_${fingerprint}`,
      identityConfidence: 'low',
      ambiguousIdentity: false,
      identityFingerprint: fingerprint,
    };
  }

  return {
    recordKey: `${observation.provider}_ambig_${fingerprint}_${crypto.randomUUID()}`,
    identityConfidence: 'low',
    ambiguousIdentity: true,
    identityFingerprint: fingerprint,
  };
}

export async function createPaymentFromObservation(
  observed: ObservedPayment,
  observedAt: string = new Date().toISOString(),
  scanOccurrences = 1,
  existingMatches: Payment[] = [],
): Promise<Payment> {
  const identity = await createRecordIdentity(observed, scanOccurrences, existingMatches);

  return {
    provider: observed.provider,
    recordKey: identity.recordKey,
    sourcePaymentId: observed.sourcePaymentId,
    identityConfidence: identity.identityConfidence,
    ambiguousIdentity: identity.ambiguousIdentity,
    identityFingerprint: identity.identityFingerprint,
    payerName: observed.payerName,
    amountCents: observed.amountCents,
    currency: observed.currency,
    paymentDate: observed.paymentDate,
    sourceStatus: observed.sourceStatus,
    paymentState: observed.paymentState,
    declarationState: 'nao_declarado',
    lastObservedAt: observedAt,
    manualDeclaredAt: null,
  };
}

export async function processObservedPayments(
  observedPayments: ObservedPayment[],
  observedAt: string = new Date().toISOString(),
  dbInstance?: PingouNotaDB,
  cumulativeScanOccurrences?: Map<string, number>,
): Promise<Payment[]> {
  const targetDb = dbInstance ?? db;
  const existingPayments = await listPayments(undefined, targetDb);

  const lowConfidenceFingerprints = new Map<ObservedPayment, string>();
  const fingerprintCountsInScan = new Map<string, number>();

  for (const obs of observedPayments) {
    if (!obs.sourcePaymentId) {
      const fp = await calculatePaymentFingerprint(obs);
      lowConfidenceFingerprints.set(obs, fp);
      fingerprintCountsInScan.set(fp, (fingerprintCountsInScan.get(fp) || 0) + 1);
      if (cumulativeScanOccurrences) {
        cumulativeScanOccurrences.set(fp, (cumulativeScanOccurrences.get(fp) || 0) + 1);
      }
    }
  }

  const paymentsToUpsert: Payment[] = [];
  const existingToMarkAmbiguous: Payment[] = [];

  for (const obs of observedPayments) {
    let scanOccurrences = 1;
    let matchingExisting: Payment[] = [];

    if (!obs.sourcePaymentId) {
      const fp = lowConfidenceFingerprints.get(obs)!;
      scanOccurrences = cumulativeScanOccurrences
        ? (cumulativeScanOccurrences.get(fp) || 1)
        : (fingerprintCountsInScan.get(fp) || 1);
      matchingExisting = existingPayments.filter((p) => p.identityFingerprint === fp);

      if (
        scanOccurrences > 1 ||
        matchingExisting.length > 1 ||
        matchingExisting.some((m) => m.ambiguousIdentity)
      ) {
        for (const existing of matchingExisting) {
          if (!existing.ambiguousIdentity) {
            existingToMarkAmbiguous.push({ ...existing, ambiguousIdentity: true });
          }
        }
      }
    }

    const payment = await createPaymentFromObservation(
      obs,
      observedAt,
      scanOccurrences,
      matchingExisting,
    );
    paymentsToUpsert.push(payment);
  }

  if (existingToMarkAmbiguous.length > 0) {
    for (const existing of existingToMarkAmbiguous) {
      await targetDb.payments.update([existing.provider, existing.recordKey], {
        ambiguousIdentity: true,
      });
    }
  }

  return upsertPayments(paymentsToUpsert, targetDb);
}

export async function updateActionBadge(dbInstance?: PingouNotaDB): Promise<number> {
  const undeclaredReceived = await listPayments(
    {
      paymentState: 'recebido',
      declarationState: 'nao_declarado',
    },
    dbInstance,
  );

  const count = undeclaredReceived.length;
  const text = count > 0 ? String(count) : '';

  try {
    if (browser?.action) {
      await browser.action.setBadgeText({ text });
      if (count > 0 && browser.action.setBadgeBackgroundColor) {
        await browser.action.setBadgeBackgroundColor({ color: '#2563eb' });
      }
    }
  } catch {
    // Ignore badge errors outside extension environment (e.g. unit tests)
  }

  return count;
}

export async function coordinatePaymentsObservation(
  observedPayments: ObservedPayment[],
  observedAt: string = new Date().toISOString(),
  dbInstance?: PingouNotaDB,
): Promise<{ savedPayments: Payment[]; undeclaredCount: number }> {
  const savedPayments = await processObservedPayments(observedPayments, observedAt, dbInstance);
  const undeclaredCount = await updateActionBadge(dbInstance);
  return { savedPayments, undeclaredCount };
}

export function isSupportedAsaasRoute(urlStr: string): boolean {
  if (!urlStr || typeof urlStr !== 'string') return false;
  if (urlStr.startsWith('/') && !urlStr.startsWith('//')) {
    const path = (urlStr.split('?')[0] ?? '').split('#')[0] ?? '';
    return (
      path.startsWith('/customerPayment/index') ||
      path.startsWith('/customerPayment/list') ||
      path.startsWith('/app/cobranzas') ||
      path === '/customerPayment'
    );
  }
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    const isAsaasHost =
      host === 'asaas.com' ||
      host.endsWith('.asaas.com') ||
      host === 'localhost' ||
      host === '127.0.0.1';
    if (!isAsaasHost) return false;
    const path = parsed.pathname;
    return (
      path.startsWith('/customerPayment/index') ||
      path.startsWith('/customerPayment/list') ||
      path.startsWith('/app/cobranzas') ||
      path === '/customerPayment'
    );
  } catch {
    return false;
  }
}

export function getAsaasNextPage(doc: Document): PaginationResult {
  const nextBtn = doc.querySelector(
    'a.pagination-next, [data-testid="pagination-next"], a[rel="next"], .pagination .next a, li.pagination-next a',
  );

  if (!nextBtn) {
    const hasPaginationContainer = doc.querySelector(
      '.pagination, [data-testid="pagination"], ul.pager',
    );
    if (hasPaginationContainer) {
      return { kind: 'unsupported', reason: 'Pagination control could not be identified' };
    }
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

  if (!isSupportedAsaasRoute(href)) {
    return {
      kind: 'unsupported',
      reason: `Rejected next-page target outside allowed route: ${href}`,
    };
  }

  return { kind: 'next', href };
}

export const asaasAdapter: ProviderAdapter = {
  provider: 'asaas',
  parse: parseAsaasPayments,
  nextPage: getAsaasNextPage,
  isSupportedRoute: isSupportedAsaasRoute,
};

export function isSupportedHuskyRoute(urlStr: string): boolean {
  if (!urlStr || typeof urlStr !== 'string') return false;
  if (urlStr.startsWith('/') && !urlStr.startsWith('//')) {
    const path = (urlStr.split('?')[0] ?? '').split('#')[0] ?? '';
    return (
      path.startsWith('/transfers') ||
      path.startsWith('/payments') ||
      path.startsWith('/dashboard') ||
      path.startsWith('/app/transfers')
    );
  }
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    const isHuskyHost =
      host === 'husky.io' ||
      host.endsWith('.husky.io') ||
      host === 'localhost' ||
      host === '127.0.0.1';
    if (!isHuskyHost) return false;
    const path = parsed.pathname;
    return (
      path.startsWith('/transfers') ||
      path.startsWith('/payments') ||
      path.startsWith('/dashboard') ||
      path.startsWith('/app/transfers')
    );
  } catch {
    return false;
  }
}

export function getHuskyNextPage(doc: Document): PaginationResult {
  const nextBtn = doc.querySelector(
    '[data-testid="pagination-next"], a.pagination-next, a[rel="next"], .pagination .next a',
  );

  if (!nextBtn) {
    const hasPaginationContainer = doc.querySelector(
      '.pagination, [data-testid="pagination"], ul.pager',
    );
    if (hasPaginationContainer) {
      return { kind: 'unsupported', reason: 'Pagination control could not be identified' };
    }
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

  if (!isSupportedHuskyRoute(href)) {
    return {
      kind: 'unsupported',
      reason: `Rejected next-page target outside allowed route: ${href}`,
    };
  }

  return { kind: 'next', href };
}

export const huskyAdapter: ProviderAdapter = {
  provider: 'husky',
  parse: parseHuskyPayments,
  nextPage: getHuskyNextPage,
  isSupportedRoute: isSupportedHuskyRoute,
};

export function resolveTargetUrl(target: string, baseUrl?: string): string {
  if (!target) return '';
  if (target.startsWith('http://') || target.startsWith('https://')) {
    return target;
  }
  try {
    const base =
      baseUrl && (baseUrl.startsWith('http://') || baseUrl.startsWith('https://'))
        ? baseUrl
        : 'https://app.pingounota.local';
    return new URL(target, base).href;
  } catch {
    return target;
  }
}

export function urlsMatch(urlA: string, urlB: string): boolean {
  if (urlA === urlB) return true;
  try {
    const base = 'https://app.pingounota.local';
    const a = new URL(urlA, base);
    const b = new URL(urlB, base);
    const aIsRel = !urlA.startsWith('http://') && !urlA.startsWith('https://');
    const bIsRel = !urlB.startsWith('http://') && !urlB.startsWith('https://');
    if (aIsRel || bIsRel) {
      return a.pathname === b.pathname && a.search === b.search;
    }
    return a.origin === b.origin && a.pathname === b.pathname && a.search === b.search;
  } catch {
    return false;
  }
}

export class ScanCoordinator {
  private adapters = new Map<PaymentProvider, ProviderAdapter>();
  private activeScanId: string | null = null;
  private userInteracted = false;
  private scanControlStatus: ScanStatus | null = null;

  constructor() {
    this.registerAdapter(asaasAdapter);
    this.registerAdapter(huskyAdapter);
  }

  registerAdapter(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.provider, adapter);
  }

  getAdapter(provider: PaymentProvider): ProviderAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new Error(`No adapter registered for provider: ${provider}`);
    }
    return adapter;
  }

  recordUserInteraction(): void {
    this.userInteracted = true;
  }

  hasUserInteracted(): boolean {
    return this.userInteracted;
  }

  resetUserInteraction(): void {
    this.userInteracted = false;
  }

  async getScanMetadata(
    provider: PaymentProvider,
    dbInstance?: PingouNotaDB,
  ): Promise<ScanMetadata | null> {
    const targetDb = dbInstance ?? db;
    try {
      const entry = await targetDb.metadata.get(`scan_metadata_${provider}`);
      if (entry && entry.value) {
        return entry.value as ScanMetadata;
      }
    } catch {
      // Ignore DB read errors
    }
    return null;
  }

  async persistScanMetadata(
    metadata: ScanMetadata,
    dbInstance?: PingouNotaDB,
  ): Promise<void> {
    const targetDb = dbInstance ?? db;
    try {
      await targetDb.metadata.put({
        key: `scan_metadata_${metadata.provider}`,
        value: metadata,
        updatedAt: new Date().toISOString(),
      });
    } catch {
      // Ignore DB write errors
    }
  }

  async determineScanType(
    provider: PaymentProvider,
    dbInstance?: PingouNotaDB,
  ): Promise<{ scanType: 'full' | 'incremental'; shouldResume: boolean }> {
    const meta = await this.getScanMetadata(provider, dbInstance);
    if (!meta) {
      return { scanType: 'full', shouldResume: false };
    }
    if (meta.status === 'complete') {
      return { scanType: 'incremental', shouldResume: false };
    }
    if (meta.status === 'partial' || meta.status === 'paused') {
      return { scanType: 'full', shouldResume: true };
    }
    return { scanType: 'full', shouldResume: false };
  }

  async handlePortalListDetected(
    provider: PaymentProvider,
    _pageUrl: string,
    dbInstance?: PingouNotaDB,
  ): Promise<{ scanType: 'full' | 'incremental'; shouldResume: boolean; scanId: string }> {
    const { scanType, shouldResume } = await this.determineScanType(provider, dbInstance);
    const scanId = crypto.randomUUID();
    this.activeScanId = scanId;
    return { scanType, shouldResume, scanId };
  }

  async handleScanControl(
    action: 'start' | 'pause' | 'cancel',
    provider: PaymentProvider,
    scanId?: string,
    dbInstance?: PingouNotaDB,
  ): Promise<{ status: ScanStatus; scanId?: string }> {
    const id = scanId || this.activeScanId || crypto.randomUUID();

    if (action === 'pause') {
      this.scanControlStatus = 'paused';
      await this.persistScanMetadata(
        {
          lastScanId: id,
          provider,
          status: 'paused',
          lastScanType: 'full',
          pagesSeen: 0,
          recordsFound: 0,
          reason: 'Scan paused by user',
          updatedAt: new Date().toISOString(),
        },
        dbInstance,
      );
      return { status: 'paused', scanId: id };
    }

    if (action === 'cancel') {
      this.scanControlStatus = 'failed';
      await this.persistScanMetadata(
        {
          lastScanId: id,
          provider,
          status: 'failed',
          lastScanType: 'full',
          pagesSeen: 0,
          recordsFound: 0,
          reason: 'Scan cancelled by user',
          updatedAt: new Date().toISOString(),
        },
        dbInstance,
      );
      return { status: 'failed', scanId: id };
    }

    this.scanControlStatus = 'scanning';
    this.resetUserInteraction();
    return { status: 'scanning', scanId: id };
  }

  async runScan(
    provider: PaymentProvider,
    options?: RunScanOptions,
  ): Promise<ScanResult> {
    const scanId = options?.scanId || this.activeScanId || crypto.randomUUID();
    this.activeScanId = scanId;
    this.scanControlStatus = null;

    const targetDb = options?.dbInstance ?? db;
    const adapter = options?.adapter || this.getAdapter(provider);
    const getCurrentUrl = options?.getCurrentUrl || (() => (typeof window !== 'undefined' ? window.location.href : ''));
    const getDocument = options?.getDocument || (() => (typeof document !== 'undefined' ? document : ({} as Document)));
    const navigate = options?.navigate || (async () => true);
    const broadcastProgress = options?.broadcastProgress || ((progress: ScanProgress) => {
      try {
        if (browser?.runtime?.sendMessage) {
          browser.runtime.sendMessage({ type: 'SCAN_PROGRESS', progress }).catch(() => {});
        }
      } catch {
        // Ignore outside extension environment
      }
    });

    const initialUrl = options?.initialUrl || getCurrentUrl();
    let expectedTargetUrl = initialUrl;
    let status: ScanStatus = 'scanning';
    let pagesSeen = 0;
    let recordsFound = 0;
    let reason: string | null = null;
    let restoreStatus: 'restored' | 'failed' | 'not_needed' = 'not_needed';

    const cumulativeScanOccurrences = new Map<string, number>();
    const visitedUrls = new Set<string>();
    if (initialUrl) {
      visitedUrls.add(initialUrl);
    }

    broadcastProgress({
      scanId,
      provider,
      status: 'scanning',
      pagesSeen: 0,
      recordsFound: 0,
      reason: null,
    });

    while (status === 'scanning') {
      if (this.hasUserInteracted() || this.scanControlStatus === 'paused') {
        status = 'paused';
        reason = 'User interaction detected';
        break;
      }

      if (this.scanControlStatus === 'failed') {
        status = 'failed';
        reason = 'Scan cancelled by user';
        break;
      }

      const currentUrl = getCurrentUrl();
      if (expectedTargetUrl && !urlsMatch(currentUrl, expectedTargetUrl)) {
        status = 'partial';
        reason = `Unsafe navigation: current URL "${currentUrl}" diverged from expected target "${expectedTargetUrl}"`;
        break;
      }

      if (!adapter.isSupportedRoute(currentUrl)) {
        status = 'partial';
        reason = `Unsafe navigation: current URL "${currentUrl}" is outside supported route`;
        break;
      }

      const doc = getDocument();
      const parseResult = adapter.parse(doc);

      if (parseResult.payments.length > 0) {
        const saved = await processObservedPayments(
          parseResult.payments,
          new Date().toISOString(),
          targetDb,
          cumulativeScanOccurrences,
        );
        recordsFound += saved.length;
      }
      pagesSeen++;

      if (options?.maxPages && pagesSeen >= options.maxPages) {
        status = 'complete';
        break;
      }

      broadcastProgress({
        scanId,
        provider,
        status: 'scanning',
        pagesSeen,
        recordsFound,
        reason: null,
      });

      const pagination = adapter.nextPage(doc);

      if (pagination.kind === 'end') {
        status = 'complete';
        break;
      }

      if (pagination.kind === 'unsupported') {
        status = 'partial';
        reason = pagination.reason || 'Pagination unsupported';
        break;
      }

      if (pagination.kind === 'next') {
        const nextHref = pagination.href;

        if (!adapter.isSupportedRoute(nextHref)) {
          status = 'partial';
          reason = `Unsafe navigation: Target URL "${nextHref}" outside allowed portal origin or route`;
          break;
        }

        const resolvedTarget = resolveTargetUrl(nextHref, initialUrl);
        if (visitedUrls.has(resolvedTarget) || visitedUrls.has(nextHref)) {
          // Cycle detected: prevent infinite loop
          status = 'complete';
          break;
        }
        visitedUrls.add(resolvedTarget);
        visitedUrls.add(nextHref);

        if (this.hasUserInteracted() || this.scanControlStatus === 'paused') {
          status = 'paused';
          reason = 'User interaction detected';
          break;
        }

        expectedTargetUrl = resolvedTarget;

        try {
          await targetDb.metadata.put({
            key: `scan_nav_${scanId}`,
            value: { scanId, expectedTargetUrl, updatedAt: new Date().toISOString() },
            updatedAt: new Date().toISOString(),
          });
        } catch {
          // Ignore DB write errors
        }

        const navSuccess = await navigate(nextHref);
        if (!navSuccess) {
          status = 'partial';
          reason = `Navigation to next page "${nextHref}" failed`;
          break;
        }
      }
    }

    const finalUrl = getCurrentUrl();
    if (!urlsMatch(finalUrl, initialUrl)) {
      const isStillScanOwned = adapter.isSupportedRoute(finalUrl);
      const userInteracted = this.hasUserInteracted();

      if (!isStillScanOwned || userInteracted) {
        restoreStatus = 'failed';
        status = 'partial';
        if (!reason) {
          reason = userInteracted
            ? 'Restoration aborted due to user interaction'
            : 'Restoration aborted: URL outside scan-owned route';
        }
      } else {
        try {
          const restored = await navigate(initialUrl);
          if (restored) {
            restoreStatus = 'restored';
          } else {
            restoreStatus = 'failed';
            status = 'partial';
            if (!reason) {
              reason = 'Failed to restore starting view';
            }
          }
        } catch {
          restoreStatus = 'failed';
          status = 'partial';
          if (!reason) {
            reason = 'Failed to restore starting view';
          }
        }
      }
    } else {
      restoreStatus = 'not_needed';
    }

    const result: ScanResult = {
      scanId,
      provider,
      status,
      pagesSeen,
      recordsFound,
      reason,
      restoreStatus,
    };

    await this.persistScanMetadata(
      {
        lastScanId: scanId,
        provider,
        status,
        lastScanType: options?.isIncremental ? 'incremental' : 'full',
        pagesSeen,
        recordsFound,
        reason,
        lastCompletedAt: status === 'complete' ? new Date().toISOString() : undefined,
        updatedAt: new Date().toISOString(),
      },
      targetDb,
    );

    broadcastProgress({
      scanId,
      provider,
      status,
      pagesSeen,
      recordsFound,
      reason,
      restoreStatus,
    });

    return result;
  }
}

export const scanCoordinator = new ScanCoordinator();
