import { Types } from 'mongoose';

/**
 * Règles pures du catalogue par workspace (sans modèle : testables sans démarrer l'application).
 * Voir catalog-scope.ts.
 */
export type CatalogWorkspaceId = Types.ObjectId | null;

export function toObjectId (value: unknown): Types.ObjectId | null {
  const raw = value && typeof value === 'object' && '_id' in (value as object) ? (value as { _id: unknown })._id : value;
  if (raw == null || raw === '') return null;
  const str = String(raw);
  return Types.ObjectId.isValid(str) ? new Types.ObjectId(str) : null;
}

/** Workspace de la requête (workspace épinglé, sinon celui de l'entité), ou null hors portail. */
export function catalogWorkspaceId (req: any): CatalogWorkspaceId {
  return toObjectId(req?.workspace?._id) ?? toObjectId(req?.entity?.workspaceId);
}

/** Filtre Mongo des entrées visibles depuis ce workspace. */
export function catalogFilter (workspaceId: CatalogWorkspaceId): Record<string, unknown> {
  return workspaceId ? { workspaceId } : { workspaceId: { $exists: false } };
}
