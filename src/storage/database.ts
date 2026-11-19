import Dexie, { type EntityTable, type Table } from 'dexie';
import type { Payment, PaymentProvider } from '../domain/payment';
import type { TakerProfile } from '../domain/taker';
import type { ServiceTemplate } from '../domain/template';
import type { NfseOperation } from '../domain/nfse-operation';

export interface AppMetadata {
  key: string;
  value: unknown;
  updatedAt?: string;
}

export class PingouNotaDB extends Dexie {
  payments!: Table<Payment, [PaymentProvider, string]>;
  takers!: EntityTable<TakerProfile, 'id'>;
  templates!: EntityTable<ServiceTemplate, 'id'>;
  nfseOperations!: EntityTable<NfseOperation, 'id'>;
  metadata!: EntityTable<AppMetadata, 'key'>;

  constructor(dbName = 'PingouNotaDB') {
    super(dbName);
    this.version(1).stores({
      payments:
        '[provider+recordKey], provider, sourcePaymentId, paymentState, declarationState, paymentDate, lastObservedAt',
      takers: 'id, document, name',
      templates: 'id',
      nfseOperations: 'id, provider, paymentRecordKey, externalId, &idempotencyKey, status',
      metadata: 'key',
    });
  }
}

export const db = new PingouNotaDB();

export function createDatabase(name = 'PingouNotaDB'): PingouNotaDB {
  return new PingouNotaDB(name);
}
