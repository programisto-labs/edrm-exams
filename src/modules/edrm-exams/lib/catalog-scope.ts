import mongoose, { Types } from 'mongoose';
import TestCategory from '../models/test-category.models.js';
import TestJob from '../models/test-job.model.js';

/**
 * Catalogue des tests (catégories, métiers) propre à chaque workspace.
 *
 * Le portail Lasco pose `req.workspace` (workspace épinglé) et `req.entity` (entité, qui porte `workspaceId`).
 * Toute recherche par nom, création, liste ou lecture d'une entrée se fait dans ce workspace : une entrée d'un
 * autre workspace n'est jamais lue, renommée ou rattachée à un test.
 *
 * Sans workspace (usage du module hors portail), le comportement historique est gardé : entrées communes,
 * sans `workspaceId`.
 */
export type CatalogWorkspaceId = Types.ObjectId | null;

function toObjectId (value: unknown): Types.ObjectId | null {
  const raw = value && typeof value === 'object' && '_id' in (value as object) ? (value as { _id: unknown })._id : value;
  if (raw == null || raw === '') return null;
  const str = String(raw);
  return Types.ObjectId.isValid(str) ? new Types.ObjectId(str) : null;
}

/** Workspace de la requête (workspace épinglé, sinon celui de l'entité), ou null hors portail. */
export function catalogWorkspaceId (req: any): CatalogWorkspaceId {
  return toObjectId(req?.workspace?._id) ?? toObjectId(req?.entity?.workspaceId);
}

/** Workspace de l'entité d'un test (migration des anciens tests, hors requête). */
export async function catalogWorkspaceIdForEntity (entityId: unknown): Promise<CatalogWorkspaceId> {
  const id = toObjectId(entityId);
  const db = mongoose.connection.db;
  if (!id || !db) return null;
  const entity = await db.collection('entities').findOne({ _id: id }, { projection: { workspaceId: 1 } });
  return toObjectId(entity?.workspaceId);
}

/** Filtre Mongo des entrées visibles depuis ce workspace. */
export function catalogFilter (workspaceId: CatalogWorkspaceId): Record<string, unknown> {
  return workspaceId ? { workspaceId } : { workspaceId: { $exists: false } };
}

/** Filtre « même nom » dans le workspace (comparaison exacte, comme avant). */
function byName (name: string, workspaceId: CatalogWorkspaceId): Record<string, unknown> {
  return { ...catalogFilter(workspaceId), name };
}

export async function findCategoryByName (name: string, workspaceId: CatalogWorkspaceId): Promise<any> {
  return TestCategory.findOne(byName(name, workspaceId));
}

export async function findOrCreateCategory (name: string, workspaceId: CatalogWorkspaceId): Promise<any> {
  const existing = await findCategoryByName(name, workspaceId);
  if (existing) return existing;
  return TestCategory.create({ name, ...(workspaceId ? { workspaceId } : {}) });
}

export async function findJobByName (name: string, workspaceId: CatalogWorkspaceId): Promise<any> {
  return TestJob.findOne(byName(name, workspaceId));
}

export async function findOrCreateJob (name: string, workspaceId: CatalogWorkspaceId): Promise<any> {
  const existing = await findJobByName(name, workspaceId);
  if (existing) return existing;
  return TestJob.create({ name, ...(workspaceId ? { workspaceId } : {}) });
}

/** Entrée du workspace par identifiant (null si elle appartient à un autre workspace). */
export async function findCategoryInWorkspace (id: unknown, workspaceId: CatalogWorkspaceId): Promise<any> {
  const oid = toObjectId(id);
  if (!oid) return null;
  return TestCategory.findOne({ _id: oid, ...catalogFilter(workspaceId) });
}

export async function findJobInWorkspace (id: unknown, workspaceId: CatalogWorkspaceId): Promise<any> {
  const oid = toObjectId(id);
  if (!oid) return null;
  return TestJob.findOne({ _id: oid, ...catalogFilter(workspaceId) });
}
