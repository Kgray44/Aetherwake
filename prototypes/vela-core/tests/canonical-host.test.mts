import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { canonicalVersionToken, createCanonicalVelaHost } from '../src/canonical-host.mts';
import { VelaService } from '../src/service.mts';
import type { CanonicalVelaContext, CanonicalVelaHostOptions, CanonicalVelaMetadata } from '../src/canonical-host.mts';
import type { AuthorizationRequest, ResourceRef, VelaHostPort, VelaMessage } from '../src/contracts.ts';

/** Real canonical kernel schema and one SQLite connection; only parent-owned callbacks mutate canonical data. */
function fixture() {
  const kernel = WorkspaceKernel.open(':memory:'); let db!: DatabaseSync;
  kernel.withTransaction(connection => { db = connection; });
  const project = kernel.createProject('Synthetic project'), other = kernel.createProject('Other synthetic project');
  const workspace = kernel.createWorkspace('Synthetic workspace', project.id);
  const note = kernel.createNote('Synthetic authorized note', 'Actual canonical note text.', project.id);
  const privateNote = kernel.createNote('Synthetic excluded note', 'Excluded canonical content.', other.id);
  const conversation = kernel.createConversationRef('Legacy placed conversation', null);
  // Existing placement is fixture data. The helper itself never creates blocks or changes placement/layout.
  kernel.attachBlock(workspace.id, conversation.id, { x: 0, y: 0, width: 300, height: 200, z: 0 });
  db.exec(`CREATE TABLE test_canonical_conversations(resource_id TEXT PRIMARY KEY,revision INTEGER NOT NULL);
    CREATE TABLE test_canonical_messages(id TEXT PRIMARY KEY,resource_id TEXT NOT NULL,json TEXT NOT NULL);`);
  db.prepare('INSERT INTO test_canonical_conversations VALUES(?,1)').run(conversation.id);
  let systemId: string | null = null, graphReads = 0, appends = 0, dispatches = 0, projectionRevision = 1;
  let nativeWritesThenThrows = false;
  const granted = new Set<string>(), metadataDenied = new Set<string>(), contentDenied = new Set<string>();
  const dispatched: Parameters<VelaHostPort['applyNative']>[0][] = [], authRequests: AuthorizationRequest[] = [];
  let context: CanonicalVelaContext = { principalId: 'synthetic:user', policyVersion: 'policy:1', currentProjectId: project.id, currentWorkspaceId: workspace.id, selectedResourceIds: [conversation.id, privateNote.id] };
  const revision = (id: string) => { const r = db.prepare('SELECT revision FROM test_canonical_conversations WHERE resource_id=?').get(id); return r ? Number(r.revision) : null; };
  const metadata = (): CanonicalVelaMetadata => {
    const projects = db.prepare("SELECT id,title,version FROM projects WHERE state='active'").all() as any[];
    const projectIds = new Set(projects.map(p => p.id));
    const workspaces = db.prepare("SELECT * FROM workspaces WHERE state='active'").all().filter(w => w.project_id === null || projectIds.has(w.project_id)) as any[];
    const resources = db.prepare('SELECT id,title,kind,version,state,project_id FROM resources ORDER BY id').all().map(r => ({ ...r, visible: r.state === 'active', available: true, conversationRevision: r.kind === 'conversation' ? revision(String(r.id)) ?? undefined : undefined })) as any[];
    const blocks = db.prepare('SELECT * FROM blocks ORDER BY id').all() as any[];
    return { contract: 'aerynth.desktop@1', projects, workspaces, resources, blocks, navigationBlocks: blocks, activeWorkspaceId: context.currentWorkspaceId };
  };
  const options: CanonicalVelaHostOptions = {
    db, transaction: work => kernel.withTransaction(work), metadata, currentContext: () => structuredClone(context),
    permissions: {
      scope: (c, m) => {
        const projectIds = m.projects.filter(p => p.id === c.currentProjectId).map(p => p.id);
        const workspaceIds = m.workspaces.filter(w => projectIds.includes(w.project_id!)).map(w => w.id);
        const placed = new Set((m.navigationBlocks ?? []).filter(b => workspaceIds.includes(b.workspace_id)).map(b => b.resource_id));
        return { principalId: c.principalId, policyVersion: c.policyVersion, projectIds, workspaceIds,
          resourceIds: m.resources.filter(r => projectIds.includes(r.project_id!) || placed.has(r.id) || r.id === systemId).map(r => r.id) };
      },
      metadata: ref => !metadataDenied.has(ref.id), content: ref => !contentDenied.has(ref.id),
      authorize: request => { authRequests.push(structuredClone(request)); const authorizationRef = 'host-grant:' + randomUUID(); granted.add(authorizationRef); return { decision: 'allow', authorizationRef, policyVersion: context.policyVersion }; },
    },
    revisions: { conversation: id => revision(id), workspace: () => projectionRevision },
    conversations: {
      ensure: () => {
        if (!systemId) { systemId = kernel.createConversationRef('Vela canonical conversation').id; db.prepare('INSERT INTO test_canonical_conversations VALUES(?,1)').run(systemId); } return systemId;
      },
      read: id => { graphReads++; return { resourceId: id, revision: revision(id)!, messages: db.prepare('SELECT json FROM test_canonical_messages WHERE resource_id=? ORDER BY rowid').all(id).map(r => JSON.parse(String(r.json))) }; },
      append: (id, message) => { appends++; const result: VelaMessage = { ...message, id: randomUUID() }; db.prepare('INSERT INTO test_canonical_messages VALUES(?,?,?)').run(result.id, id, JSON.stringify(result)); db.prepare('UPDATE test_canonical_conversations SET revision=revision+1 WHERE resource_id=?').run(id); return result; },
    },
    dispatch: { native: input => {
      dispatches++; assert.ok(granted.has(input.authorizationRef), 'actual parent dispatcher verifies host-issued grants'); dispatched.push(structuredClone(input));
      if (nativeWritesThenThrows) { kernel.updateNote(note.id, 'Rolled-back canonical change', Number(kernel.getResource(note.id).resource.version)); throw new Error('Synthetic dispatch failure'); }
      return { status: 'applied', receiptId: 'canonical-receipt:' + randomUUID() };
    } },
  };
  const host = createCanonicalVelaHost(options);
  const grant = (targets: ResourceRef[]) => host.authorize({ phase: 'review', requestId: 'request:synthetic', planId: 'plan:synthetic', fingerprint: 'fingerprint:synthetic', intent: 'Explicit synthetic local command', scope: host.scope(), targets, actions: [] });
  return { kernel, db, project, other, workspace, note, privateNote, conversation, host, options, metadataDenied, contentDenied, authRequests, dispatched,
    counts: () => ({ graphReads, appends, dispatches }), grant,
    changeProjection: () => { projectionRevision++; }, changeContext: (patch: Partial<CanonicalVelaContext>) => { context = { ...context, ...patch }; },
    throwAfterWrite: () => { nativeWritesThenThrows = true; }, close: () => kernel.close() };
}

test('history revision and permission hooks are authoritative metadata-only projections', () => {
  const f = fixture(); try {
    const scope = f.host.scope(), ref = f.host.resolve({ id: f.conversation.id, kind: 'resource' }, scope)!, before = f.counts();
    assert.equal(f.host.conversationRevision!(ref.id), 1); assert.equal(f.host.canReadContent!(ref, scope), true); assert.deepEqual(f.counts(), before);
    f.contentDenied.add(ref.id); assert.equal(f.host.conversationRevision!(ref.id), null); assert.equal(f.host.canReadContent!(ref, scope), false); assert.deepEqual(f.counts(), before);
    f.contentDenied.delete(ref.id); f.metadataDenied.add(ref.id); assert.equal(f.host.conversationRevision!(ref.id), null); assert.equal(f.host.canReadContent!(ref, scope), false); assert.deepEqual(f.counts(), before);
  } finally { f.close(); }
});

test('canonical host discovers only authorized active metadata, including legacy placed chats without changing ownership', () => {
  const f = fixture();
  try {
    const before = f.db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table'").get()!.count;
    const scope = f.host.scope(), matches = f.host.search('Synthetic', scope, 30);
    assert.ok(matches.some(r => r.id === f.note.id)); assert.ok(!matches.some(r => r.id === f.privateNote.id));
    assert.ok(f.host.search('Legacy', scope, 30).some(r => r.id === f.conversation.id));
    assert.equal(f.kernel.getResource(f.conversation.id).resource.project_id, null);
    assert.deepEqual(f.host.context().selectedResourceIds, [f.conversation.id]);
    assert.equal(f.counts().graphReads, 0); assert.equal(f.counts().appends, 0); assert.equal(f.counts().dispatches, 0);
    assert.equal(f.db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table'").get()!.count, before);
  } finally { f.close(); }
});

test('content permission is separate from metadata; canonical note/conversation content has exact source revisions', () => {
  const f = fixture();
  try {
    const scope = f.host.scope(); f.contentDenied.add(f.note.id);
    assert.ok(f.host.search('authorized note', scope, 30).length); assert.equal(f.host.readContent(f.note.id, scope), null);
    f.contentDenied.delete(f.note.id); const note = f.host.readContent(f.note.id, scope)!;
    assert.equal(note.content, 'Actual canonical note text.'); assert.equal(note.ref.version, f.note.version); assert.ok(note.source.includes(encodeURIComponent(f.note.id)));
    f.host.appendMessage(f.conversation.id, { role: 'user', content: 'A canonical current message', source: 'user', classification: 'observed' });
    const conversation = f.host.readContent(f.conversation.id, f.host.scope())!;
    const body = JSON.parse(conversation.content); assert.equal(body.revision, 2); assert.equal(body.messages[0].content, 'A canonical current message');
    assert.equal(conversation.ref.version, canonicalVersionToken(1, 2));
    assert.equal(f.host.readContent(f.privateNote.id, scope), null);
  } finally { f.close(); }
});

test('conversation message freshness and engine projection revisions cannot hide under higher entity versions', () => {
  const f = fixture();
  try {
    f.db.prepare('UPDATE resources SET version=10 WHERE id=?').run(f.conversation.id);
    const old = f.host.resolve({ id: f.conversation.id, kind: 'resource' }, f.host.scope())!;
    f.host.appendMessage(f.conversation.id, { role: 'user', content: 'New message without changing resource metadata version', source: 'user', classification: 'observed' });
    const fresh = f.host.resolve(old, f.host.scope())!; assert.notEqual(fresh.version, old.version);
    assert.equal(f.kernel.getResource(f.conversation.id).resource.version, 10);
    assert.throws(() => f.grant([old]), /stale_canonical_target_version/);
    const workspace = f.host.resolve({ id: f.workspace.id, kind: 'workspace' }, f.host.scope())!;
    f.changeProjection(); assert.notEqual(f.host.resolve(workspace, f.host.scope())!.version, workspace.version);
    assert.equal(f.db.prepare('SELECT version FROM workspaces WHERE id=?').get(f.workspace.id)!.version, 1);
    assert.throws(() => f.grant([workspace]), /stale_canonical_target_version/);
  } finally { f.close(); }
});

test('archiving, placement removal, metadata denial and policy changes immediately remove access', () => {
  const f = fixture();
  try {
    const scope = f.host.scope(); f.metadataDenied.add(f.note.id);
    assert.equal(f.host.resolve({ id: f.note.id, kind: 'resource' }, scope), null);
    f.metadataDenied.delete(f.note.id); f.db.prepare('DELETE FROM blocks WHERE resource_id=?').run(f.conversation.id);
    assert.equal(f.host.resolve({ id: f.conversation.id, kind: 'resource' }, scope), null);
    f.kernel.setResourceArchived(f.note.id, true, f.note.version); assert.equal(f.host.readContent(f.note.id, scope), null);
    f.kernel.setProjectArchived(f.project.id, true, f.project.version);
    assert.equal(f.host.scope().workspaceIds.length, 0); assert.equal(f.host.context().currentProjectId, null); assert.equal(f.host.context().currentWorkspaceId, null);
    f.changeContext({ policyVersion: 'policy:2' }); assert.throws(() => f.host.search('', scope, 30), /stale_canonical_scope/);
  } finally { f.close(); }
});

test('same-connection identity and mandatory policy callbacks prevent alternative-store and allow-all fallbacks', () => {
  const f = fixture(), other = new DatabaseSync(':memory:');
  try {
    const wrong = createCanonicalVelaHost({ ...f.options, transaction: work => work(other) });
    assert.throws(() => wrong.scope(), /canonical_database_connection_mismatch/);
    assert.throws(() => createCanonicalVelaHost({ ...f.options, permissions: { ...f.options.permissions, authorize: undefined as any } }), /canonical_host_callback_required/);
    const blocked = createCanonicalVelaHost({ ...f.options, permissions: { ...f.options.permissions, authorize: request => ({ decision: 'deny', reason: 'Actual parent policy denial', policyVersion: request.scope.policyVersion }) } });
    assert.equal(blocked.authorize({ phase: 'review', requestId: 'request:synthetic', intent: 'Inspect denial', scope: blocked.scope(), targets: [], actions: [] }).decision, 'deny');
  } finally { other.close(); f.close(); }
});

test('native composite forwarding requires fresh exact target manifest and actual parent grant; helper creates no blocks/layout', () => {
  const f = fixture();
  try {
    const target = f.host.resolve({ id: f.note.id, kind: 'resource' }, f.host.scope())!;
    const input = { action: { type: 'workspaceFromResources' as const, title: 'Delegate to released Universal Block capability', projectId: null, resourceIds: [f.note.id] }, commandId: 'command:synthetic', requestId: 'request:synthetic', planId: 'plan:synthetic', intent: 'Create workspace using the parent capability', expectedVersions: [target], authorizationRef: 'forged:not-a-host-grant' };
    const blocks = f.db.prepare('SELECT count(*) AS count FROM blocks').get()!.count, workspaces = f.db.prepare('SELECT count(*) AS count FROM workspaces').get()!.count;
    assert.throws(() => f.host.applyNative(input), /actual parent dispatcher verifies/);
    const grant = f.grant([target]); assert.equal(grant.decision, 'allow'); if (grant.decision !== 'allow') return;
    assert.throws(() => f.host.applyNative({ ...input, authorizationRef: grant.authorizationRef, expectedVersions: [] }), /canonical_action_target_manifest_required/);
    assert.equal(f.host.applyNative({ ...input, authorizationRef: grant.authorizationRef }).status, 'applied');
    assert.deepEqual(f.dispatched.at(-1)?.action, input.action);
    assert.equal(f.db.prepare('SELECT count(*) AS count FROM blocks').get()!.count, blocks); assert.equal(f.db.prepare('SELECT count(*) AS count FROM workspaces').get()!.count, workspaces);
    f.throwAfterWrite(); assert.throws(() => f.host.applyNative({ ...input, authorizationRef: grant.authorizationRef }), /Synthetic dispatch failure/);
    assert.equal(f.kernel.getResource(f.note.id).note.content, 'Actual canonical note text.');
  } finally { f.close(); }
});

test('provider egress validates metadata plus content permissions and canonical conversation ownership remains host controlled', () => {
  const f = fixture();
  try {
    const id = f.host.ensureConversation('system:vela'); assert.equal(f.host.ensureConversation('system:vela'), id);
    assert.equal(f.host.readConversation(id).revision, 1); f.host.appendMessage(id, { role: 'user', content: 'Persist in same canonical SQLite history', source: 'user', classification: 'observed' });
    assert.equal(f.host.readConversation(id).messages.length, 1);
    const ref = f.host.resolve({ id: f.note.id, kind: 'resource' }, f.host.scope())!;
    f.contentDenied.add(f.note.id);
    assert.throws(() => f.host.authorize({ phase: 'provider-context', requestId: 'request:synthetic', intent: 'Inspect egress denial', scope: f.host.scope(), targets: [ref], actions: [], contextManifest: {
      id: 'manifest:synthetic', createdAt: '2026-11-02T02:00:00Z', policyVersion: 'policy:1', discovered: [ref], included: [{ ...ref, content: 'Must not be disclosed', contentDigest: 'not-a-grant', source: 'aerynth://resource', reason: 'explicit', trust: 'untrusted-source-data' }], omitted: [], contentBytes: 22, coverage: 'explicit-resources-only',
    } }), /canonical_context_content_not_authorized/);
    assert.equal(f.authRequests.length, 0);
  } finally { f.close(); }
});

test('native consent preview reads current canonical chat history without creating an assistant chat and message changes stale the preview', () => {
  const f = fixture();
  try {
    const service = new VelaService({ db: f.db, host: f.host, transaction: work => f.kernel.withTransaction(() => work()) });
    const count = f.db.prepare('SELECT count(*) AS count FROM resources').get()!.count;
    const preview = service.previewContext([f.conversation.id]);
    assert.equal(service.state().conversation, null); assert.equal(service.state().requests.length, 0);
    assert.equal(f.db.prepare('SELECT count(*) AS count FROM resources').get()!.count, count);
    assert.equal(f.counts().appends, 0); assert.equal(f.counts().dispatches, 0);
    f.host.appendMessage(f.conversation.id, { role: 'user', content: 'Message after native consent preview', source: 'user', classification: 'observed' });
    const changed = service.previewContext([f.conversation.id]);
    assert.notEqual(changed.discovered[0].version, preview.discovered[0].version);
    assert.notEqual(changed.included[0].contentDigest, preview.included[0].contentDigest);
    assert.throws(() => f.grant(preview.discovered), /stale_canonical_target_version/);
  } finally { f.close(); }
});

test('delegation attenuates metadata as well as content to the exact child resource scope and rechecks freshness', async () => {
  const f = fixture();
  try {
    let calls = 0;
    const host = createCanonicalVelaHost({ ...f.options, dispatch: { ...f.options.dispatch, delegateTask: async () => { calls++; return { status: 'applied', receiptId: 'synthetic-parent-execution-receipt' }; } } });
    const sourceConversationId = host.ensureConversation('system:vela'), ref = host.resolve({ id: f.note.id, kind: 'resource' }, host.scope())!;
    const other = host.resolve({ id: f.conversation.id, kind: 'resource' }, host.scope())!;
    const grant = f.grant([ref]); if (grant.decision !== 'allow') return;
    const context = { id: 'manifest:delegation', createdAt: '2026-11-02T02:00:00Z', policyVersion: 'policy:1', discovered: [ref], included: [], omitted: [], contentBytes: 0, coverage: 'explicit-resources-only' as const };
    const input = { action: { type: 'delegateTask' as const, title: 'Bounded synthetic delegation', objective: 'Inspect selected metadata only', providerId: 'codex-app-server', resourceIds: [f.note.id], constraints: ['No writes'] },
      commandId: 'command:delegation', requestId: 'request:delegation', planId: 'plan:delegation', initiatingIntent: 'Inspect this note', sourceConversationId, context, authorizationRef: grant.authorizationRef };
    await assert.rejects(host.delegateTask!({ ...input, context: { ...context, discovered: [ref, other] } }), /canonical_delegation_context_not_authorized/);
    assert.equal(calls, 0); assert.equal((await host.delegateTask!(input)).status, 'applied'); assert.equal(calls, 1);
    f.kernel.updateNote(f.note.id, 'Changed after delegation preview', f.note.version);
    await assert.rejects(host.delegateTask!(input), /stale_canonical_target_version/); assert.equal(calls, 1);
  } finally { f.close(); }
});
