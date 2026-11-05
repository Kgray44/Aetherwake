import test from 'node:test';
import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { createCanonicalVelaHost } from '../src/canonical-host.mts';
import type { CanonicalVelaContext, CanonicalVelaHostOptions, CanonicalVelaMetadata } from '../src/canonical-host.mts';
import type { VelaScopePurpose } from '../src/contracts.ts';

/** Actual canonical collection rows; unused conversation/dispatch ports fail. */
function fixture() {
  const kernel = WorkspaceKernel.open(':memory:');
  let db!: DatabaseSync;
  kernel.withTransaction((connection) => {
    db = connection;
  });
  const project = kernel.createProject('Synthetic collection scope'),
    other = kernel.createProject('Synthetic excluded owner');
  const active = kernel.createCollection('Synthetic active collection', project.id);
  const archived = kernel.createCollection('Synthetic archived collection', project.id);
  const foreign = kernel.createCollection('Synthetic foreign collection', other.id);
  kernel.setCollectionArchived(archived.id, true, archived.version);
  kernel.setCollectionArchived(foreign.id, true, foreign.version);
  const context: CanonicalVelaContext = {
    principalId: 'synthetic:user',
    policyVersion: 'synthetic:policy',
    currentProjectId: project.id,
    currentWorkspaceId: null,
    selectedResourceIds: [],
  };
  const denied = new Set<string>(),
    purposeReads: string[][] = [];
  let legacy = false,
    restoreAllowed = true,
    auditAllowed = true,
    revision: number | null = 0;
  const metadata = (purpose?: VelaScopePurpose): CanonicalVelaMetadata => {
    const ids = purpose?.restoreCollectionIds ?? [];
    if (ids.length) purposeReads.push([...ids]);
    const collections = db
      .prepare(
        "SELECT id,title,project_id,version,state FROM collections WHERE state='active'" +
          (ids.length ? ' OR id IN(' + ids.map(() => '?').join(',') + ')' : ''),
      )
      .all(...ids) as any[];
    return {
      contract: 'aerynth.desktop@1',
      projects: db.prepare("SELECT * FROM projects WHERE state='active'").all() as any[],
      workspaces: [],
      resources: [],
      blocks: [],
      activeWorkspaceId: null,
      collections,
    };
  };
  const unused = (): never => {
    throw new Error('Unused port must not be invoked');
  };
  const options: CanonicalVelaHostOptions = {
    db,
    transaction: (work) => kernel.withTransaction(work),
    metadata,
    currentContext: () => context,
    permissions: {
      scope: (c, m) => ({
        principalId: c.principalId,
        policyVersion: c.policyVersion,
        resourceIds: [],
        workspaceIds: [],
        projectIds: m.projects.filter((p) => p.id === c.currentProjectId).map((p) => p.id),
        ...(legacy ? {} : { collectionIds: m.collections!.filter((v) => v.state === 'active' && v.project_id === c.currentProjectId).map((v) => v.id) }),
      }),
      metadata: (ref) => !denied.has(ref.id),
      content: () => false,
      authorize: (request) => ({ decision: 'allow', authorizationRef: 'synthetic:grant', policyVersion: request.scope.policyVersion }),
      restoreCollection: (ref) => restoreAllowed && !denied.has(ref.id),
      inspectCollectionArchiveReceipt: (ref) => auditAllowed && !denied.has(ref.id),
    },
    revisions: { workspace: unused, conversation: unused, collection: () => revision },
    conversations: { ensure: unused, read: unused, append: unused },
    dispatch: { native: unused },
  };
  return {
    kernel,
    db,
    project,
    other,
    active,
    archived,
    foreign,
    options,
    denied,
    purposeReads,
    context,
    legacy: () => {
      legacy = true;
    },
    restore: (value: boolean) => {
      restoreAllowed = value;
    },
    audit: (value: boolean) => {
      auditAllowed = value;
    },
    revision: (value: number | null) => {
      revision = value;
    },
    close: () => kernel.close(),
  };
}

test('legacy scopes and missing canonical revision/restoration ports cannot grant new collection authority', () => {
  const f = fixture();
  try {
    f.legacy();
    const host = createCanonicalVelaHost(f.options),
      ref = { id: f.active.id, kind: 'collection' as const };
    const scope = host.scope();
    assert.equal(scope.collectionIds, undefined);
    assert.equal(host.resolve(ref, { ...scope, collectionIds: [f.active.id] }), null, 'Forged caller scope cannot expand canonical access');
    assert.equal(host.search('collection', scope, 20).filter((r) => r.kind === 'collection').length, 0);
    const restoreScope = host.scope({ restoreCollectionIds: [f.archived.id] });
    assert.deepEqual(restoreScope.collectionIds, []);
    assert.equal(host.resolve({ id: f.archived.id, kind: 'collection' }, restoreScope, { restoreCollection: true }), null);
    assert.deepEqual(f.purposeReads, [], 'A legacy scope never fetches archived titles');
  } finally {
    f.close();
  }
  const g = fixture();
  try {
    const withoutRevision = createCanonicalVelaHost({ ...g.options, revisions: { ...g.options.revisions, collection: undefined } });
    assert.deepEqual(withoutRevision.scope().collectionIds, []);
    g.revision(null);
    assert.deepEqual(createCanonicalVelaHost(g.options).scope().collectionIds, []);
    g.revision(200000000);
    assert.deepEqual(createCanonicalVelaHost(g.options).scope().collectionIds, [], 'Unsafe pair cannot alias another revision');
    g.revision(0);
    const withoutRestore = createCanonicalVelaHost({ ...g.options, permissions: { ...g.options.permissions, restoreCollection: undefined } });
    const scope = withoutRestore.scope({ restoreCollectionIds: [g.archived.id] });
    assert.ok(scope.collectionIds!.includes(g.active.id));
    assert.ok(!scope.collectionIds!.includes(g.archived.id));
    assert.equal(
      withoutRestore.resolve({ id: g.archived.id, kind: 'collection' }, { ...scope, collectionIds: [g.archived.id] }, { restoreCollection: true }),
      null,
    );
    assert.deepEqual(g.purposeReads, [], 'An absent restoration callback cannot authorize archived metadata reads');
    const malformed = createCanonicalVelaHost({
      ...g.options,
      permissions: { ...g.options.permissions, scope: (c, m) => ({ ...g.options.permissions.scope(c, m), collectionIds: null as any }) },
    });
    assert.throws(() => malformed.scope({ restoreCollectionIds: [g.archived.id] }), /invalid_canonical_scope/);
  } finally {
    g.close();
  }
});

test('explicit restoration still requires current project and metadata policy; normal search/content remain closed', () => {
  const f = fixture();
  try {
    const host = createCanonicalVelaHost(f.options),
      ordinary = host.scope(),
      archived = { id: f.archived.id, kind: 'collection' as const };
    assert.equal(host.resolve(archived, ordinary), null);
    assert.equal(host.readContent(f.archived.id, ordinary), null);
    const scope = host.scope({ restoreCollectionIds: [f.archived.id] });
    assert.ok(scope.collectionIds!.includes(f.archived.id));
    const ref = host.resolve(archived, scope, { restoreCollection: true })!;
    assert.equal(ref.state, 'archived');
    assert.equal(ref.projectId, f.project.id);
    assert.ok(!host.search('Synthetic archived', scope, 20).length, 'A restoration scope does not change normal search');
    assert.equal(host.resolve(archived, scope), null, 'Explicit resolution purpose is independently required');
    f.restore(false);
    assert.equal(host.resolve(archived, scope, { restoreCollection: true }), null);
    f.restore(true);
    f.denied.add(f.archived.id);
    assert.equal(host.resolve(archived, scope, { restoreCollection: true }), null);
    f.denied.delete(f.archived.id);
    f.denied.add(f.project.id);
    assert.equal(host.resolve(archived, scope, { restoreCollection: true }), null);
    assert.ok(!host.scope().collectionIds!.includes(f.active.id));
    f.denied.delete(f.project.id);
    assert.ok(!host.scope({ restoreCollectionIds: [f.foreign.id] }).collectionIds!.includes(f.foreign.id));
    f.db.prepare('UPDATE collections SET project_id=? WHERE id=?').run(f.other.id, f.archived.id);
    assert.equal(host.resolve(archived, scope, { restoreCollection: true }), null, 'Live ownership cannot be replaced by the saved target owner');
    f.db.prepare('UPDATE collections SET project_id=? WHERE id=?').run(f.project.id, f.archived.id);
    f.kernel.setProjectArchived(f.project.id, true, f.project.version);
    assert.equal(host.resolve(archived, scope, { restoreCollection: true }), null);
  } finally {
    f.close();
  }
});

test('historical archive receipt authorization uses only retained metadata and current ownership, with no restoration/content read', () => {
  const f = fixture();
  try {
    const host = createCanonicalVelaHost(f.options),
      original = host.scope();
    const target = host.resolve({ id: f.active.id, kind: 'collection' }, original)!;
    f.kernel.setCollectionArchived(f.active.id, true, f.active.version);
    // Change current title to prove the historical audit never rediscovers it.
    f.db.prepare('UPDATE collections SET title=? WHERE id=?').run('Synthetic undisclosed new archived title', f.active.id);
    assert.equal(host.canInspectCollectionArchiveReceipt!(target, original), true);
    assert.equal(target.title, 'Synthetic active collection');
    assert.deepEqual(f.purposeReads, []);
    const withoutAudit = createCanonicalVelaHost({ ...f.options, permissions: { ...f.options.permissions, inspectCollectionArchiveReceipt: undefined } });
    assert.equal(withoutAudit.canInspectCollectionArchiveReceipt!(target, original), false);
    f.audit(false);
    assert.equal(host.canInspectCollectionArchiveReceipt!(target, original), false);
    f.audit(true);
    f.denied.add(f.active.id);
    assert.equal(host.canInspectCollectionArchiveReceipt!(target, original), false);
    f.denied.delete(f.active.id);
    assert.equal(host.canInspectCollectionArchiveReceipt!({ ...target, kind: 'resource' }, original), false);
    assert.equal(host.canInspectCollectionArchiveReceipt!({ ...target, id: f.foreign.id }, original), false);
    assert.equal(host.canInspectCollectionArchiveReceipt!(target, { ...original, collectionIds: undefined }), false);
    f.db.prepare('UPDATE collections SET project_id=? WHERE id=?').run(f.other.id, f.active.id);
    assert.equal(host.canInspectCollectionArchiveReceipt!(target, original), false);
    f.db.prepare('UPDATE collections SET project_id=? WHERE id=?').run(f.project.id, f.active.id);
    f.context.currentProjectId = f.other.id;
    assert.equal(host.canInspectCollectionArchiveReceipt!(target, original), false);
    assert.deepEqual(f.purposeReads, []);
  } finally {
    f.close();
  }
});
