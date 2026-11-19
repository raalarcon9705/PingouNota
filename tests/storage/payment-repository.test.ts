import { beforeEach, describe, expect, it } from 'vitest';
import type { Payment } from '../../src/domain/payment';
import type { NfseOperation } from '../../src/domain/nfse-operation';
import { createDatabase, type PingouNotaDB } from '../../src/storage/database';
import {
  clearPayments,
  getPayment,
  listPayments,
  upsertPayment,
  upsertPayments,
} from '../../src/storage/payment-repository';

describe('Payment Repository', () => {
  let testDb: PingouNotaDB;

  beforeEach(async () => {
    testDb = createDatabase(`test-db-${Date.now()}-${Math.random()}`);
    await clearPayments(testDb);
  });

  function makePayment(overrides: Partial<Payment> = {}): Payment {
    const recordKey = overrides.recordKey ?? 'pay_asaas_001';
    return {
      provider: 'asaas',
      recordKey,
      sourcePaymentId:
        overrides.sourcePaymentId !== undefined ? overrides.sourcePaymentId : recordKey,
      identityConfidence: 'high',
      ambiguousIdentity: false,
      identityFingerprint: `fp_${recordKey}`,
      payerName: 'Empresa Teste S.A.',
      amountCents: 245000,
      currency: 'BRL',
      paymentDate: '2026-11-10',
      sourceStatus: 'Recebido',
      paymentState: 'recebido',
      declarationState: 'nao_declarado',
      lastObservedAt: '2026-11-19T09:00:00Z',
      manualDeclaredAt: null,
      ...overrides,
    };
  }

  it('inserts a new payment and retrieves it', async () => {
    const payment = makePayment();
    const saved = await upsertPayment(payment, testDb);

    expect(saved.recordKey).toBe('pay_asaas_001');

    const retrieved = await getPayment('asaas', 'pay_asaas_001', testDb);
    expect(retrieved).toBeDefined();
    expect(retrieved?.payerName).toBe('Empresa Teste S.A.');
    expect(retrieved?.amountCents).toBe(245000);
    expect(retrieved?.declarationState).toBe('nao_declarado');
  });

  it('preserves declarationState, manualDeclaredAt, and linked operation on duplicate observation', async () => {
    // 1. Initial insert and declaration
    const initial = makePayment({
      declarationState: 'marcado_localmente',
      manualDeclaredAt: '2026-11-19T10:00:00Z',
      linkedNfseOperationId: 'op_xyz',
    });
    await upsertPayment(initial, testDb);

    // 2. Duplicate observation arrives later with updated observed timestamp and payer formatting
    const observedAgain = makePayment({
      payerName: 'EMPRESA TESTE S.A.',
      lastObservedAt: '2026-11-19T11:00:00Z',
      // Incoming scan sees no declaration info
      declarationState: 'nao_declarado',
      manualDeclaredAt: null,
      linkedNfseOperationId: null,
    });

    const reconciled = await upsertPayment(observedAgain, testDb);

    expect(reconciled.declarationState).toBe('marcado_localmente');
    expect(reconciled.manualDeclaredAt).toBe('2026-11-19T10:00:00Z');
    expect(reconciled.linkedNfseOperationId).toBe('op_xyz');
    expect(reconciled.payerName).toBe('EMPRESA TESTE S.A.');
    expect(reconciled.lastObservedAt).toBe('2026-11-19T11:00:00Z');

    // Confirm DB has only 1 record
    const all = await listPayments(undefined, testDb);
    expect(all.length).toBe(1);
  });

  it('matches high-confidence rows by portal ID (sourcePaymentId) and reconciles even with different recordKey', async () => {
    // 1. Initial high-confidence payment stored with key "key_initial"
    const initial = makePayment({
      recordKey: 'key_initial',
      sourcePaymentId: 'portal_pay_999',
      identityConfidence: 'high',
      declarationState: 'marcado_localmente',
      manualDeclaredAt: '2026-11-19T10:00:00Z',
    });
    await upsertPayment(initial, testDb);

    // 2. Incoming observation has different recordKey, but same sourcePaymentId
    const incoming = makePayment({
      recordKey: 'key_different',
      sourcePaymentId: 'portal_pay_999',
      identityConfidence: 'high',
      payerName: 'Novo Nome do Pagador',
      declarationState: 'nao_declarado',
      manualDeclaredAt: null,
    });

    const reconciled = await upsertPayment(incoming, testDb);

    // Should match by sourcePaymentId, preserve declaration state and original recordKey
    expect(reconciled.recordKey).toBe('key_initial');
    expect(reconciled.declarationState).toBe('marcado_localmente');
    expect(reconciled.manualDeclaredAt).toBe('2026-11-19T10:00:00Z');
    expect(reconciled.payerName).toBe('Novo Nome do Pagador');

    // Ensure database contains only 1 record, not 2
    const all = await listPayments(undefined, testDb);
    expect(all.length).toBe(1);
    expect(all[0]?.recordKey).toBe('key_initial');
  });

  it('rejects duplicate idempotencyKey on nfseOperations table due to unique index', async () => {
    const op1: NfseOperation = {
      id: 'op_1',
      provider: 'asaas',
      paymentRecordKey: 'pay_001',
      externalId: 'ext_001',
      idempotencyKey: 'idemp_unique_key_123',
      payloadJson: '{}',
      adaflowNfseId: null,
      status: 'queued',
      createdAt: '2026-11-19T10:00:00Z',
      updatedAt: '2026-11-19T10:00:00Z',
    };

    await testDb.nfseOperations.add(op1);

    const op2: NfseOperation = {
      id: 'op_2',
      provider: 'asaas',
      paymentRecordKey: 'pay_002',
      externalId: 'ext_002',
      idempotencyKey: 'idemp_unique_key_123', // duplicate idempotencyKey!
      payloadJson: '{}',
      adaflowNfseId: null,
      status: 'queued',
      createdAt: '2026-11-19T10:05:00Z',
      updatedAt: '2026-11-19T10:05:00Z',
    };

    await expect(testDb.nfseOperations.add(op2)).rejects.toThrow();
  });

  it('updates source status and flags reversal for review when declared payment is reversed', async () => {
    const declared = makePayment({
      paymentState: 'recebido',
      declarationState: 'marcado_localmente',
      manualDeclaredAt: '2026-11-19T08:00:00Z',
    });
    await upsertPayment(declared, testDb);

    const reversedObservation = makePayment({
      sourceStatus: 'Estornado',
      paymentState: 'revertido_ou_cancelado',
      lastObservedAt: '2026-11-19T14:00:00Z',
    });

    const updated = await upsertPayment(reversedObservation, testDb);

    expect(updated.paymentState).toBe('revertido_ou_cancelado');
    expect(updated.sourceStatus).toBe('Estornado');
    expect(updated.declarationState).toBe('marcado_localmente');
    expect(updated.reversalFlaggedForReview).toBe(true);

    const fromDb = await getPayment('asaas', 'pay_asaas_001', testDb);
    expect(fromDb?.reversalFlaggedForReview).toBe(true);
  });

  it('never merges ambiguous rows on composite collision', async () => {
    const compositeKey = 'hash_composite_123';

    // First low-confidence payment with composite key
    const payment1 = makePayment({
      provider: 'husky',
      recordKey: compositeKey,
      sourcePaymentId: null,
      identityConfidence: 'low',
      ambiguousIdentity: false,
      identityFingerprint: compositeKey,
      amountCents: 500000,
      currency: 'USD',
      payerName: 'Acme Corp',
    });
    await upsertPayment(payment1, testDb);

    // Second payment arrives with same composite key but marked ambiguous (or collision)
    const payment2 = makePayment({
      provider: 'husky',
      recordKey: compositeKey,
      sourcePaymentId: null,
      identityConfidence: 'low',
      ambiguousIdentity: true,
      identityFingerprint: compositeKey,
      amountCents: 500000,
      currency: 'USD',
      payerName: 'Acme Corp',
    });
    await upsertPayment(payment2, testDb);

    // Both rows must exist in database! Neither was merged or overwritten.
    const huskyPayments = await listPayments({ provider: 'husky' }, testDb);
    expect(huskyPayments.length).toBe(2);

    // Both must now have ambiguousIdentity === true
    expect(huskyPayments.every((p) => p.ambiguousIdentity)).toBe(true);

    // Their recordKeys must be distinct
    const keys = huskyPayments.map((p) => p.recordKey);
    expect(new Set(keys).size).toBe(2);
  });

  it('upserts a batch of payments in a transaction', async () => {
    const batch: Payment[] = [
      makePayment({ recordKey: 'pay_1', sourcePaymentId: 'pay_1', amountCents: 10000 }),
      makePayment({ recordKey: 'pay_2', sourcePaymentId: 'pay_2', amountCents: 20000 }),
      makePayment({ recordKey: 'pay_3', sourcePaymentId: 'pay_3', amountCents: 30000 }),
    ];

    const results = await upsertPayments(batch, testDb);
    expect(results.length).toBe(3);

    const all = await listPayments(undefined, testDb);
    expect(all.length).toBe(3);
  });

  it('lists payments with filters', async () => {
    await upsertPayments(
      [
        makePayment({
          provider: 'asaas',
          recordKey: 'p1',
          paymentState: 'recebido',
          declarationState: 'nao_declarado',
          paymentDate: '2026-11-01',
        }),
        makePayment({
          provider: 'asaas',
          recordKey: 'p2',
          paymentState: 'aguardando_recebimento',
          declarationState: 'nao_declarado',
          paymentDate: '2026-11-02',
        }),
        makePayment({
          provider: 'husky',
          recordKey: 'p3',
          paymentState: 'recebido',
          declarationState: 'marcado_localmente',
          paymentDate: '2026-11-03',
        }),
        makePayment({
          provider: 'asaas',
          recordKey: 'p4',
          paymentState: 'recebido',
          declarationState: 'nao_declarado',
          paymentDate: null,
        }),
      ],
      testDb,
    );

    const asaasOnly = await listPayments({ provider: 'asaas' }, testDb);
    expect(asaasOnly.length).toBe(3);

    const recebidos = await listPayments({ paymentState: 'recebido' }, testDb);
    expect(recebidos.length).toBe(3);

    const naoDeclarados = await listPayments({ declarationState: 'nao_declarado' }, testDb);
    expect(naoDeclarados.length).toBe(3);

    // Date filtering must exclude payments with null paymentDate
    const dateFiltered = await listPayments(
      { startDate: '2026-11-02', endDate: '2026-11-03' },
      testDb,
    );
    expect(dateFiltered.length).toBe(2);
    expect(dateFiltered.every((p) => p.paymentDate !== null)).toBe(true);
  });
});
