import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import { catalogFilter, catalogWorkspaceId } from '../dist/modules/edrm-exams/lib/catalog-scope.js';

describe('catalogue par workspace', () => {
  const ws = new Types.ObjectId();

  it('workspace épinglé, sinon celui de l’entité, sinon aucun', () => {
    assert.equal(String(catalogWorkspaceId({ workspace: { _id: ws } })), String(ws));
    assert.equal(String(catalogWorkspaceId({ entity: { workspaceId: String(ws) } })), String(ws));
    assert.equal(catalogWorkspaceId({}), null);
    assert.equal(catalogWorkspaceId({ workspace: { _id: 'pas-un-id' } }), null);
  });

  it('filtre : entrées du workspace, ou entrées communes hors portail', () => {
    assert.deepEqual(catalogFilter(ws), { workspaceId: ws });
    assert.deepEqual(catalogFilter(null), { workspaceId: { $exists: false } });
  });
});
