import { beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, PingouNotaDB } from '../../src/storage/database';
import {
  exportBackupJson,
  parseAndValidateBackup,
  applyImport,
  clearAllData,
  type BackupEnvelope,
} from '../../src/services/backup';
import {
  saveAdaflowToken,
  getAdaflowToken,
  _resetMemoryTokenForTesting,
} from '../../src/services/adaflow/settings';
import type { Payment } from '../../src/domain/payment';
import type { TakerProfile } from '../../src/domain/taker';
import type { ServiceTemplate } from '../../src/domain/template';
import type { NfseOperation } from '../../src/domain/nfse-operation';

describe('Backup Service', () => {
  let testDb: PingouNotaDB;

  const samplePayment1: Payment = {
    provider: 'asaas',
    recordKey: 'pay_001',
    sourcePaymentId: 'pay_001',
    identityConfidence: 'high',
    ambiguousIdentity: false,
    identityFingerprint: 'fp_001',
    payerName: 'Cliente Teste 1',
    amountCents: 15000,
    currency: 'BRL',
    paymentDate: '2026-11-15',
    sourceStatus: 'RECEIVED',
    paymentState: 'recebido',
    declarationState: 'nao_declarado',
    lastObservedAt: '2026-11-15T10:00:00.000Z',
    manualDeclaredAt: null,
  };

  const samplePayment2: Payment = {
    provider: 'husky',
    recordKey: 'pay_002',
    sourcePaymentId: 'pay_002',
    identityConfidence: 'high',
    ambiguousIdentity: false,
    identityFingerprint: 'fp_002',
    payerName: 'Cliente Estrangeiro',
    amountCents: 300000,
    currency: 'USD',
    paymentDate: '2026-11-16',
    sourceStatus: 'COMPLETED',
    paymentState: 'recebido',
    declarationState: 'emissao_solicitada',
    lastObservedAt: '2026-11-16T10:00:00.000Z',
    manualDeclaredAt: null,
    linkedNfseOperationId: 'op_001',
  };

  const sampleTaker: TakerProfile = {
    id: 'taker_001',
    name: 'Empresa Alpha LTDA',
    document: '11222333000181',
    externalId: 'ext_alpha',
    email: 'fiscal@alpha.com',
    address: {
      line1: 'Av Paulista',
      number: '1000',
      neighborhood: 'Bela Vista',
      city: 'São Paulo',
      state: 'SP',
      postalCode: '01310-100',
      country: 'BR',
    },
  };

  const sampleTemplate: ServiceTemplate = {
    id: 'tpl_001',
    name: 'Consultoria TI',
    cnae: '6201501',
    description: 'Serviços de consultoria em desenvolvimento de sistemas',
    withholdTaxes: false,
    forwardingEmail: 'financeiro@alpha.com',
  };

  const sampleOperation: NfseOperation = {
    id: 'op_001',
    provider: 'husky',
    paymentRecordKey: 'pay_002',
    externalId: 'ext_op_001',
    idempotencyKey: 'idem_op_001_unique',
    payloadJson: JSON.stringify({ cnae: '6201501', description: 'Consultoria' }),
    adaflowNfseId: 987654,
    status: 'issued',
    createdAt: '2026-11-16T10:05:00.000Z',
    updatedAt: '2026-11-16T10:06:00.000Z',
  };

  beforeEach(async () => {
    _resetMemoryTokenForTesting();
    testDb = createDatabase(`test-backup-db-${Date.now()}-${Math.random()}`);
    await testDb.open();
  });

  describe('exportBackupJson', () => {
    it('serializes database tables and never exports Adaflow token or secrets', async () => {
      // 1. Setup DB state
      await testDb.payments.bulkPut([samplePayment1, samplePayment2]);
      await testDb.takers.put(sampleTaker);
      await testDb.templates.put(sampleTemplate);
      await testDb.nfseOperations.put(sampleOperation);

      // 2. Setup token in settings storage
      const secretToken = 'tok_live_super_secret_key_12345';
      await saveAdaflowToken(secretToken);
      expect(await getAdaflowToken()).toBe(secretToken);

      // 3. Export
      const { jsonString, filename, envelope } = await exportBackupJson(testDb);

      // 4. Verify filename format
      const todayStr = new Date().toISOString().split('T')[0];
      expect(filename).toBe(`pingounota-backup-${todayStr}.json`);

      // 5. Verify token is strictly absent from JSON and envelope
      expect(jsonString).not.toContain(secretToken);
      expect(jsonString).not.toContain('adaflow_api_token');
      expect((envelope as unknown as Record<string, unknown>).token).toBeUndefined();
      expect((envelope as unknown as Record<string, unknown>).adaflowToken).toBeUndefined();

      // 6. Verify contents
      expect(envelope.schemaVersion).toBe(1);
      expect(envelope.exportedAt).toBeDefined();
      expect(envelope.payments).toHaveLength(2);
      expect(envelope.takers).toHaveLength(1);
      expect(envelope.templates).toHaveLength(1);
      expect(envelope.nfseOperations).toHaveLength(1);

      // 7. Verify emission ID and idempotency preservation
      expect(envelope.nfseOperations[0]?.adaflowNfseId).toBe(987654);
      expect(envelope.nfseOperations[0]?.idempotencyKey).toBe('idem_op_001_unique');
    });
  });

  describe('parseAndValidateBackup', () => {
    it('returns error when JSON syntax is corrupted without writing to database', async () => {
      const corruptJson = '{"schemaVersion": 1, "payments": [';

      const result = await parseAndValidateBackup(corruptJson, testDb);

      expect(result.preview.isValid).toBe(false);
      expect(result.preview.validationErrors.length).toBeGreaterThan(0);
      expect(result.preview.validationErrors[0]).toMatch(/Arquivo JSON inválido ou corrompido/i);
      expect(result.envelope).toBeUndefined();

      // DB remains empty
      expect(await testDb.payments.count()).toBe(0);
    });

    it('returns validation errors for schema mismatch (e.g. wrong schema version)', async () => {
      const invalidEnvelope = {
        schemaVersion: 99, // unsupported version
        exportedAt: new Date().toISOString(),
        payments: [],
        takers: [],
        templates: [],
        nfseOperations: [],
      };

      const result = await parseAndValidateBackup(JSON.stringify(invalidEnvelope), testDb);

      expect(result.preview.isValid).toBe(false);
      expect(result.preview.validationErrors.length).toBeGreaterThan(0);
      expect(result.preview.validationErrors.some((e) => e.includes('schemaVersion'))).toBe(true);
      expect(result.envelope).toBeUndefined();
    });

    it('identifies duplicate records against current DB without modifying the database', async () => {
      // Put samplePayment1 and sampleTaker in DB
      await testDb.payments.put(samplePayment1);
      await testDb.takers.put(sampleTaker);

      // Envelope has samplePayment1 (duplicate), samplePayment2 (new), sampleTaker (duplicate), sampleTemplate (new)
      const validEnvelope: BackupEnvelope = {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        payments: [samplePayment1, samplePayment2],
        takers: [sampleTaker],
        templates: [sampleTemplate],
        nfseOperations: [sampleOperation],
      };

      const result = await parseAndValidateBackup(JSON.stringify(validEnvelope), testDb);

      expect(result.preview.isValid).toBe(true);
      expect(result.preview.validationErrors).toEqual([]);
      expect(result.preview.counts).toEqual({
        payments: 2,
        takers: 1,
        templates: 1,
        nfseOperations: 1,
      });
      expect(result.preview.duplicates).toEqual({
        payments: 1,
        takers: 1,
        templates: 0,
        nfseOperations: 0,
      });

      // Verify that database was completely untouched
      expect(await testDb.payments.count()).toBe(1);
      expect(await testDb.templates.count()).toBe(0);
      expect(await testDb.nfseOperations.count()).toBe(0);
    });
  });

  describe('applyImport', () => {
    it('merges records atomically without losing existing non-overlapping data', async () => {
      // Existing data in DB
      await testDb.payments.put(samplePayment1);
      await testDb.takers.put(sampleTaker);

      // Envelope updates samplePayment1 and adds samplePayment2
      const updatedPayment1: Payment = {
        ...samplePayment1,
        declarationState: 'marcado_localmente',
        manualDeclaredAt: '2026-11-15T12:00:00.000Z',
      };

      const envelope: BackupEnvelope = {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        payments: [updatedPayment1, samplePayment2],
        takers: [sampleTaker],
        templates: [sampleTemplate],
        nfseOperations: [sampleOperation],
      };

      const result = await applyImport(envelope, 'merge', testDb);

      expect(result.success).toBe(true);
      expect(result.appliedCounts.payments).toBe(2);

      // Both payments exist in DB now
      const payments = await testDb.payments.toArray();
      expect(payments).toHaveLength(2);

      const pay1 = await testDb.payments.get(['asaas', 'pay_001']);
      expect(pay1?.declarationState).toBe('marcado_localmente');
      expect(pay1?.manualDeclaredAt).toBe('2026-11-15T12:00:00.000Z');

      const pay2 = await testDb.payments.get(['husky', 'pay_002']);
      expect(pay2?.paymentState).toBe('recebido');

      // Taker, Template and Operation exist
      expect(await testDb.takers.count()).toBe(1);
      expect(await testDb.templates.count()).toBe(1);
      expect(await testDb.nfseOperations.count()).toBe(1);
    });

    it('replaces database completely when mode is replace', async () => {
      // Obsolete data in DB
      const obsoletePayment: Payment = {
        provider: 'asaas',
        recordKey: 'pay_obsolete',
        sourcePaymentId: 'pay_obsolete',
        identityConfidence: 'high',
        ambiguousIdentity: false,
        identityFingerprint: null,
        payerName: 'Antigo Cliente',
        amountCents: 5000,
        currency: 'BRL',
        paymentDate: '2026-01-01',
        sourceStatus: 'RECEIVED',
        paymentState: 'recebido',
        declarationState: 'nao_declarado',
        lastObservedAt: '2026-01-01T00:00:00.000Z',
        manualDeclaredAt: null,
      };
      await testDb.payments.put(obsoletePayment);

      // Also set a token in settings storage
      await saveAdaflowToken('tok_keep_me');

      // Envelope only has samplePayment2 and sampleTemplate
      const envelope: BackupEnvelope = {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        payments: [samplePayment2],
        takers: [],
        templates: [sampleTemplate],
        nfseOperations: [],
      };

      const result = await applyImport(envelope, 'replace', testDb);

      expect(result.success).toBe(true);

      // Obsolete payment is gone!
      expect(await testDb.payments.get(['asaas', 'pay_obsolete'])).toBeUndefined();
      expect(await testDb.payments.get(['husky', 'pay_002'])).toBeDefined();
      expect(await testDb.payments.count()).toBe(1);
      expect(await testDb.takers.count()).toBe(0);
      expect(await testDb.templates.count()).toBe(1);

      // Token in settings storage was NEVER touched
      expect(await getAdaflowToken()).toBe('tok_keep_me');
    });

    it('preserves emission IDs and idempotency keys across backup and restore', async () => {
      const envelope: BackupEnvelope = {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        payments: [samplePayment2],
        takers: [],
        templates: [],
        nfseOperations: [sampleOperation],
      };

      await applyImport(envelope, 'replace', testDb);

      const op = await testDb.nfseOperations.get('op_001');
      expect(op).toBeDefined();
      expect(op?.adaflowNfseId).toBe(987654);
      expect(op?.idempotencyKey).toBe('idem_op_001_unique');
      expect(op?.externalId).toBe('ext_op_001');
      expect(op?.status).toBe('issued');
    });

    it('rolls back transaction on write failure leaving database in previous state', async () => {
      // DB has initial payment
      await testDb.payments.put(samplePayment1);

      // Create an envelope that triggers a constraint violation on unique &idempotencyKey
      // Put an operation first
      await testDb.nfseOperations.put(sampleOperation);

      // Attempt to replace or merge with an envelope having two operations with identical idempotencyKey
      const duplicateOp: NfseOperation = {
        ...sampleOperation,
        id: 'op_002', // different id, same unique idempotencyKey
      };

      const envelope: BackupEnvelope = {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        payments: [samplePayment2],
        takers: [],
        templates: [],
        nfseOperations: [sampleOperation, duplicateOp],
      };

      await expect(applyImport(envelope, 'merge', testDb)).rejects.toThrow();

      // Original samplePayment1 is still preserved because transaction rolled back
      const pay1 = await testDb.payments.get(['asaas', 'pay_001']);
      expect(pay1).toBeDefined();
    });
  });

  describe('clearAllData', () => {
    it('clears all Dexie tables without affecting Adaflow token in storage', async () => {
      // 1. Populate DB tables
      await testDb.payments.bulkPut([samplePayment1, samplePayment2]);
      await testDb.takers.put(sampleTaker);
      await testDb.templates.put(sampleTemplate);
      await testDb.nfseOperations.put(sampleOperation);

      // 2. Set token
      await saveAdaflowToken('tok_safe_and_sound');

      // 3. Clear data
      await clearAllData(testDb);

      // 4. Verify all DB tables are empty
      expect(await testDb.payments.count()).toBe(0);
      expect(await testDb.takers.count()).toBe(0);
      expect(await testDb.templates.count()).toBe(0);
      expect(await testDb.nfseOperations.count()).toBe(0);

      // 5. Token is completely untouched
      expect(await getAdaflowToken()).toBe('tok_safe_and_sound');
    });
  });
});
