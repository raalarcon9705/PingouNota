import { z } from 'zod';
import { db, PingouNotaDB } from '../storage/database';
import { paymentSchema, type Payment } from '../domain/payment';
import { takerProfileSchema, type TakerProfile } from '../domain/taker';
import { serviceTemplateSchema, type ServiceTemplate } from '../domain/template';
import { nfseOperationSchema, type NfseOperation } from '../domain/nfse-operation';

export const SCHEMA_VERSION = 1;

export interface BackupEnvelope {
  schemaVersion: 1;
  exportedAt: string;
  payments: Payment[];
  takers: TakerProfile[];
  templates: ServiceTemplate[];
  nfseOperations: NfseOperation[];
  preferences?: Record<string, unknown>;
}

export const backupEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  exportedAt: z.string().min(1, 'Data de exportação é obrigatória'),
  payments: z.array(paymentSchema),
  takers: z.array(takerProfileSchema),
  templates: z.array(serviceTemplateSchema),
  nfseOperations: z.array(nfseOperationSchema),
  preferences: z.record(z.string(), z.unknown()).optional(),
});

export interface BackupCounts {
  payments: number;
  takers: number;
  templates: number;
  nfseOperations: number;
}

export interface BackupPreview {
  schemaVersion: number;
  exportedAt: string;
  counts: BackupCounts;
  duplicates: BackupCounts;
  validationErrors: string[];
  isValid: boolean;
}

/**
 * Serializa os dados locais de pagamentos, tomadores, templates e operações em JSON versionado.
 * O token da Adaflow e estados de runtime de scraping não são exportados.
 */
export async function exportBackupJson(
  targetDb?: PingouNotaDB,
): Promise<{ jsonString: string; filename: string; envelope: BackupEnvelope }> {
  const activeDb = targetDb ?? db;

  const [payments, takers, templates, nfseOperations] = await Promise.all([
    activeDb.payments.toArray(),
    activeDb.takers.toArray(),
    activeDb.templates.toArray(),
    activeDb.nfseOperations.toArray(),
  ]);

  const exportedAt = new Date().toISOString();
  const datePart = exportedAt.split('T')[0];
  const filename = `pingounota-backup-${datePart}.json`;

  const envelope: BackupEnvelope = {
    schemaVersion: 1,
    exportedAt,
    payments,
    takers,
    templates,
    nfseOperations,
  };

  const jsonString = JSON.stringify(envelope, null, 2);

  return {
    jsonString,
    filename,
    envelope,
  };
}

/**
 * Dispara o download do arquivo de backup no navegador.
 * Seguro para ambientes sem DOM (testes, workers).
 */
export function downloadBackupFile(backup: { jsonString: string; filename: string }): void {
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    typeof Blob === 'undefined'
  ) {
    return;
  }

  const blob = new Blob([backup.jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = backup.filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * Valida o conteúdo JSON de um backup sem realizar nenhuma escrita no banco de dados.
 * Calcula contadores de novos registros e duplicados comparando IDs com o banco atual.
 */
export async function parseAndValidateBackup(
  jsonString: string,
  targetDb?: PingouNotaDB,
): Promise<{ preview: BackupPreview; envelope?: BackupEnvelope }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err) {
    return {
      preview: {
        schemaVersion: 0,
        exportedAt: '',
        counts: { payments: 0, takers: 0, templates: 0, nfseOperations: 0 },
        duplicates: { payments: 0, takers: 0, templates: 0, nfseOperations: 0 },
        validationErrors: [
          `Arquivo JSON inválido ou corrompido: ${err instanceof Error ? err.message : String(err)}`,
        ],
        isValid: false,
      },
    };
  }

  const parseResult = backupEnvelopeSchema.safeParse(parsed);
  if (!parseResult.success) {
    const rawObj = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    const validationErrors = parseResult.error.issues.map(
      (issue) => `${issue.path.length > 0 ? issue.path.join('.') + ': ' : ''}${issue.message}`,
    );

    return {
      preview: {
        schemaVersion: typeof rawObj.schemaVersion === 'number' ? rawObj.schemaVersion : 0,
        exportedAt: typeof rawObj.exportedAt === 'string' ? rawObj.exportedAt : '',
        counts: {
          payments: Array.isArray(rawObj.payments) ? rawObj.payments.length : 0,
          takers: Array.isArray(rawObj.takers) ? rawObj.takers.length : 0,
          templates: Array.isArray(rawObj.templates) ? rawObj.templates.length : 0,
          nfseOperations: Array.isArray(rawObj.nfseOperations) ? rawObj.nfseOperations.length : 0,
        },
        duplicates: { payments: 0, takers: 0, templates: 0, nfseOperations: 0 },
        validationErrors,
        isValid: false,
      },
    };
  }

  const envelope = parseResult.data as BackupEnvelope;
  const activeDb = targetDb ?? db;

  // Calcula duplicidades sem realizar nenhuma mutação
  let duplicatePayments = 0;
  for (const p of envelope.payments) {
    const existing = await activeDb.payments.get([p.provider, p.recordKey]);
    if (existing) {
      duplicatePayments++;
    }
  }

  let duplicateTakers = 0;
  for (const t of envelope.takers) {
    const existing = await activeDb.takers.get(t.id);
    if (existing) {
      duplicateTakers++;
    }
  }

  let duplicateTemplates = 0;
  for (const t of envelope.templates) {
    const existing = await activeDb.templates.get(t.id);
    if (existing) {
      duplicateTemplates++;
    }
  }

  let duplicateOperations = 0;
  for (const op of envelope.nfseOperations) {
    const existing = await activeDb.nfseOperations.get(op.id);
    if (existing) {
      duplicateOperations++;
    }
  }

  return {
    preview: {
      schemaVersion: envelope.schemaVersion,
      exportedAt: envelope.exportedAt,
      counts: {
        payments: envelope.payments.length,
        takers: envelope.takers.length,
        templates: envelope.templates.length,
        nfseOperations: envelope.nfseOperations.length,
      },
      duplicates: {
        payments: duplicatePayments,
        takers: duplicateTakers,
        templates: duplicateTemplates,
        nfseOperations: duplicateOperations,
      },
      validationErrors: [],
      isValid: true,
    },
    envelope,
  };
}

export type ImportMode = 'merge' | 'replace';

/**
 * Aplica os dados do envelope atomicamente em uma única transação Dexie.
 * No modo 'replace', limpa pagamentos, tomadores, modelos e operações antes de reinserir.
 * No modo 'merge', faz upsert dos registros mantendo os existentes intactos.
 * O token da Adaflow em browser.storage.local NUNCA é tocado.
 */
export async function applyImport(
  envelope: BackupEnvelope,
  mode: ImportMode,
  targetDb?: PingouNotaDB,
): Promise<{
  success: boolean;
  appliedCounts: BackupCounts;
}> {
  const activeDb = targetDb ?? db;

  await activeDb.transaction(
    'rw',
    [
      activeDb.payments,
      activeDb.takers,
      activeDb.templates,
      activeDb.nfseOperations,
      activeDb.metadata,
    ],
    async () => {
      if (mode === 'replace') {
        await Promise.all([
          activeDb.payments.clear(),
          activeDb.takers.clear(),
          activeDb.templates.clear(),
          activeDb.nfseOperations.clear(),
        ]);
      }

      if (envelope.payments.length > 0) {
        await activeDb.payments.bulkPut(envelope.payments);
      }
      if (envelope.takers.length > 0) {
        await activeDb.takers.bulkPut(envelope.takers);
      }
      if (envelope.templates.length > 0) {
        await activeDb.templates.bulkPut(envelope.templates);
      }
      if (envelope.nfseOperations.length > 0) {
        await activeDb.nfseOperations.bulkPut(envelope.nfseOperations);
      }
    },
  );

  return {
    success: true,
    appliedCounts: {
      payments: envelope.payments.length,
      takers: envelope.takers.length,
      templates: envelope.templates.length,
      nfseOperations: envelope.nfseOperations.length,
    },
  };
}

/**
 * Limpa todos os dados locais armazenados no Dexie (pagamentos, tomadores, templates, operações).
 * O token da Adaflow não é afetado.
 */
export async function clearAllData(targetDb?: PingouNotaDB): Promise<void> {
  const activeDb = targetDb ?? db;

  await activeDb.transaction(
    'rw',
    [
      activeDb.payments,
      activeDb.takers,
      activeDb.templates,
      activeDb.nfseOperations,
      activeDb.metadata,
    ],
    async () => {
      await Promise.all([
        activeDb.payments.clear(),
        activeDb.takers.clear(),
        activeDb.templates.clear(),
        activeDb.nfseOperations.clear(),
      ]);
    },
  );
}
