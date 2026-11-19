import { type TakerProfile, takerProfileSchema, type AdaflowServiceTaker } from '../domain/taker';
import { db, type PingouNotaDB } from '../storage/database';

/**
 * List all saved service takers from Dexie.
 */
export async function listTakers(
  dbInstance: PingouNotaDB = db,
): Promise<TakerProfile[]> {
  const list = await dbInstance.takers.toArray();
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Retrieve a service taker by ID from Dexie.
 */
export async function getTaker(
  id: string,
  dbInstance: PingouNotaDB = db,
): Promise<TakerProfile | undefined> {
  return dbInstance.takers.get(id);
}

/**
 * Save or update a TakerProfile in Dexie.
 * Validates against takerProfileSchema.
 */
export async function saveTaker(
  taker: TakerProfile,
  dbInstance: PingouNotaDB = db,
): Promise<TakerProfile> {
  const validated = takerProfileSchema.parse(taker);
  const now = new Date().toISOString();
  const existing = await dbInstance.takers.get(validated.id);

  const toSave: TakerProfile = {
    ...validated,
    createdAt: existing?.createdAt || validated.createdAt || now,
    updatedAt: now,
  };

  await dbInstance.takers.put(toSave);
  return toSave;
}

/**
 * Delete a service taker by ID from Dexie.
 */
export async function deleteTaker(
  id: string,
  dbInstance: PingouNotaDB = db,
): Promise<void> {
  await dbInstance.takers.delete(id);
}

/**
 * Convert a TakerProfile to an AdaflowServiceTaker payload object.
 */
export function takerProfileToAdaflowTaker(
  profile: TakerProfile,
): AdaflowServiceTaker {
  return {
    document: profile.document || undefined,
    external_id: profile.externalId || undefined,
    name: profile.name,
    email: profile.email || undefined,
    address: {
      line1: profile.address.line1,
      number: profile.address.number || undefined,
      neighborhood: profile.address.neighborhood || undefined,
      city: profile.address.city,
      state: profile.address.state,
      postal_code: profile.address.postalCode,
      country: profile.address.country,
    },
  };
}
