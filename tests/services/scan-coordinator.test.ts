import { beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type PingouNotaDB } from '../../src/storage/database';
import { clearPayments, listPayments } from '../../src/storage/payment-repository';
import {
  coordinatePaymentsObservation,
  createPaymentFromObservation,
} from '../../src/services/scan-coordinator';
import type { ObservedPayment } from '../../src/shared/observed-payment';
import { extensionMessageSchema } from '../../src/shared/messages';

describe('Scan Coordinator & Message Validation', () => {
  let testDb: PingouNotaDB;

  beforeEach(async () => {
    testDb = createDatabase(`test-scan-db-${Date.now()}-${Math.random()}`);
    await clearPayments(testDb);
  });

  const sampleObservedPayment: ObservedPayment = {
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

  it('transforms high-confidence observed payment with proper IDs and fingerprints', () => {
    const payment = createPaymentFromObservation(sampleObservedPayment, '2026-11-19T10:00:00Z');
    expect(payment.provider).toBe('asaas');
    expect(payment.recordKey).toBe('pay_123');
    expect(payment.sourcePaymentId).toBe('pay_123');
    expect(payment.identityConfidence).toBe('high');
    expect(payment.ambiguousIdentity).toBe(false);
    expect(payment.identityFingerprint).toBe('asaas_pay_123');
    expect(payment.declarationState).toBe('nao_declarado');
    expect(payment.lastObservedAt).toBe('2026-11-19T10:00:00Z');
  });

  it('transforms low-confidence observed payment generating composite key and ambiguousIdentity = true', () => {
    const lowConfidence: ObservedPayment = {
      ...sampleObservedPayment,
      sourcePaymentId: null,
      identityConfidence: 'low',
    };
    const payment = createPaymentFromObservation(lowConfidence, '2026-11-19T10:00:00Z');
    expect(payment.recordKey).toContain('comp_asaas:Empresa Alpha:150000:BRL:2026-11-15');
    expect(payment.identityConfidence).toBe('low');
    expect(payment.ambiguousIdentity).toBe(true);
    expect(payment.sourcePaymentId).toBeNull();
  });

  it('persists observed payments and counts undeclared received for badge', async () => {
    const observations: ObservedPayment[] = [
      sampleObservedPayment,
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
    // Only pay_123 is recebido and nao_declarado
    expect(undeclaredCount).toBe(1);

    const fromDb = await listPayments(undefined, testDb);
    expect(fromDb).toHaveLength(2);
  });

  it('validates extension messages strictly against schema', () => {
    const validDetected = {
      type: 'PORTAL_LIST_DETECTED',
      provider: 'asaas',
      pageUrl: 'https://app.asaas.com/customerPayment/index',
    };
    expect(extensionMessageSchema.safeParse(validDetected).success).toBe(true);

    const validObserved = {
      type: 'PAYMENTS_OBSERVED',
      scanId: 'scan_001',
      pageUrl: 'https://app.husky.io/transfers',
      result: {
        payments: [
          {
            provider: 'husky',
            sourcePaymentId: 'tra_101',
            identityConfidence: 'high',
            payerName: 'Sender LLC',
            amountCents: 200000,
            currency: 'USD',
            paymentDate: '2026-11-18',
            sourceStatus: 'Na conta',
            paymentState: 'recebido',
          },
        ],
        warnings: [],
        pagination: {
          kind: 'next',
          href: '/transfers?page=2',
        },
      },
    };
    expect(extensionMessageSchema.safeParse(validObserved).success).toBe(true);

    const invalidMessage = {
      type: 'UNKNOWN_ACTION',
      data: 123,
    };
    expect(extensionMessageSchema.safeParse(invalidMessage).success).toBe(false);
  });
});
