import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { createCanonicalTemplateHost } from '../../block-library/canonical-host.mts';
import { TemplateService } from '../../block-library/service.mts';
import { composeWorkspaceBlueprint } from '../../block-library/workspace-architect.mts';
import type { BlockKind } from '../../block-library/contracts.ts';
import type { WorkspaceRecoveryPreview, WorkspaceRecoveryReceipt, WorkspaceRecoverySnapshot,
  WorkspaceRecoveryState } from '../../application-contract/workspace-recovery.ts';
import type { Command } from '../../workspace-engine/contracts.mts';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { DesktopState } from '../src/desktop.mts';
import { WorkspaceRecoveryService, type WorkspaceRecoveryHost } from '../src/workspace-recovery.mts';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'aerynth-workspace-recovery-')), path = join(directory, 'state.sqlite');
  let kernel: WorkspaceKernel, desktop: DesktopState, recovery: WorkspaceRecoveryService, library: TemplateService;
  let policyVersion = 'local-owner-policy-1';
  const denied = new Set<string>();
  const create = () => {
    kernel = WorkspaceKernel.open(path);
    const db = kernel.withTransaction(db => db);
    desktop = new DesktopState(kernel, db);
    const engine = desktop.nativeBlockServices().engine;
    db.exec('CREATE TABLE IF NOT EXISTS test_recovery_events(command_id TEXT PRIMARY KEY,workspace_id TEXT,action TEXT,version INTEGER) STRICT;');
    const host: WorkspaceRecoveryHost = { db, atomic: work => kernel.withTransaction(work),
      snapshot(workspaceId): WorkspaceRecoverySnapshot | null {
        if (denied.has(workspaceId)) return null;
        const workspace = db.prepare(`SELECT w.*,l.version AS layout_version,p.state AS project_state,p.version AS project_version
          FROM workspaces w JOIN workspace_layouts l ON l.workspace_id=w.id LEFT JOIN projects p ON p.id=w.project_id WHERE w.id=?`).get(workspaceId);
        if (!workspace || workspace.project_id !== null && (workspace.project_state !== 'active' || denied.has(String(workspace.project_id)))) return null;
        const counts = db.prepare('SELECT count(*) AS placements,count(DISTINCT resource_id) AS resources FROM blocks WHERE workspace_id=?').get(workspaceId)!;
        return { workspaceId, title: String(workspace.title), projectId: workspace.project_id as string | null,
          projectVersion: workspace.project_id === null ? null : Number(workspace.project_version), policyVersion,
          state: workspace.state as 'active' | 'archived', version: Number(workspace.version), layoutVersion: Number(workspace.layout_version),
          placementCount: Number(counts.placements), resourceCount: Number(counts.resources) };
      },
      archive: (workspaceId, archived, expectedVersion) => desktop.apply({ type: 'archiveWorkspace', workspaceId, archived, expectedVersion },
        () => { throw Error('recovery must not create conversations'); }),
      record: event => { db.prepare('INSERT INTO test_recovery_events VALUES(?,?,?,?)')
        .run(event.commandId, event.workspaceId, event.action, event.workspaceVersion); },
    };
    recovery = new WorkspaceRecoveryService(host);
    library = new TemplateService(db, createCanonicalTemplateHost({ db, kernel, engine,
      atomic: work => kernel.withTransaction(work), capabilities: () => ({ revision: 1,
        kinds: { note: { state: 'available' }, conversation: { state: 'available' } },
        providers: { local: { state: 'available' } }, velaPlanning: { state: 'unsupported' } }),
      createResource: (kind, title, _provider, projectId) => {
        assert.ok(kind === 'note' || kind === 'conversation');
        return (kind === 'note' ? kernel.createNote(title, '', projectId) : kernel.createConversationRef(title, projectId)).id;
      },
      resourceKind: id => kernel.getResource(id).resource.kind as BlockKind,
      navigateWorkspace: workspaceId => desktop.apply({ type: 'navigate', target: { kind: 'workspace', workspaceId } }, () => { throw Error('unused'); }),
      setTaskGroupMembers: () => { throw Error('unused'); }, isAuthorized: subject => !denied.has(subject.id),
    }));
  };
  create();
  return { directory, denied, get kernel() { return kernel; }, get db() { return kernel.withTransaction(db => db); },
    get desktop() { return desktop; }, get engine() { return desktop.nativeBlockServices().engine; },
    get recovery() { return recovery; }, get library() { return library; },
    policy(value: string) { policyVersion = value; }, reopen() { kernel.close(); create(); },
    close() { kernel.close(); const target = resolve(directory), suffix = relative(resolve(tmpdir()), target);
      assert.ok(suffix.startsWith('aerynth-workspace-recovery-') && !suffix.startsWith('..') && !isAbsolute(suffix));
      rmSync(target, { recursive: true, force: true }); },
  };
}
type Fixture = ReturnType<typeof fixture>;
function state(f: Fixture, workspaceId: string) {
  const result = f.recovery.dispatch({ name: 'state', input: { workspaceId } }) as WorkspaceRecoveryState;
  assert.ok(result.available);
  return result;
}
function preview(f: Fixture, workspaceId: string) {
  const current = state(f, workspaceId);
  return f.recovery.dispatch({ name: 'preview', input: { workspaceId, action: current.action,
    creationEventId: current.creationEventId, expectedVersion: current.version, expectedLayoutVersion: current.layoutVersion } }) as WorkspaceRecoveryPreview;
}
function apply(f: Fixture, review: WorkspaceRecoveryPreview, commandId = randomUUID()) {
  return f.recovery.dispatch({ name: 'apply', input: { previewId: review.previewId, fingerprint: review.fingerprint, commandId } }) as WorkspaceRecoveryReceipt;
}
function run(f: Fixture, workspaceId: string, command: object) {
  return f.engine.execute({ workspaceId, expectedRevision: f.engine.project(workspaceId).revision, commandId: randomUUID(), ...command } as Command);
}

test('one canonical creation event authorizes recovery for Kernel, Engine, Desktop, template and existing-resource construction', () => {
  const f = fixture();
  try {
    const fromKernel = f.kernel.createWorkspace('Synthetic Kernel factory').id;
    const fromEngine = f.engine.createWorkspace('Synthetic Engine factory').workspaceId;
    f.desktop.apply({ type: 'createWorkspace', title: 'Synthetic Desktop factory', projectId: null }, () => { throw Error('unused'); });
    const fromDesktop = f.desktop.snapshot(() => ({ provider: 'local', messages: [] })).activeWorkspaceId!;
    const resource = f.kernel.createNote('Shared source', 'Retained original');
    const template = f.library.saveTemplate({ name: 'Synthetic recovery template', description: 'Canonical factory coverage', tags: [],
      body: composeWorkspaceBlueprint([{ key: 'source', label: 'Existing note', source: {
        mode: 'reference', kind: 'note', resourceId: resource.id, expectedVersion: 1 } }]) });
    const fromTemplate = f.library.applyTemplate({ commandId: randomUUID(), templateId: template.id, expectedVersion: template.version,
      title: 'Synthetic template workspace', projectId: null }).workspaceId;
    const fromResources = f.library.workspaceFromResources({ commandId: randomUUID(), title: 'Synthetic source workspace', projectId: null,
      resources: [{ resourceId: resource.id, expectedVersion: 1 }] }).createdWorkspaceId;
    for (const workspaceId of [fromKernel, fromEngine, fromDesktop, fromTemplate, fromResources]) {
      const current = state(f, workspaceId);
      const events = f.kernel.listEvents('workspace', workspaceId).filter(event => event.type === 'workspace.created');
      assert.equal(events.length, 1);
      assert.equal(current.creationEventId, events[0].id);
      assert.equal(current.createdAt, events[0].occurred_at);
      assert.equal(current.scope, 'preserve-current-content');
      assert.equal(current.action, 'undo-creation');
    }
    assert.equal(f.db.prepare('SELECT count(*) AS total FROM recovery_actions').get()!.total, 0, 'Reading state never grants or applies recovery');
  } finally { f.close(); }
});

test('undo, restart and restore preserve manual geometry, shared resources, current edits, conversation identity and layout history', () => {
  const f = fixture();
  try {
    const project = f.kernel.createProject('Synthetic preservation project');
    const workspaceId = f.engine.createWorkspace('Synthetic recovery target', project.id).workspaceId;
    const other = f.engine.createWorkspace('Synthetic shared-resource view', project.id).workspaceId;
    const note = f.kernel.createNote('Shared note', 'Original source', project.id);
    const conversation = f.kernel.createConversationRef('Preserved conversation identity', project.id);
    run(f, workspaceId, { type: 'attachResource', resourceId: note.id });
    run(f, workspaceId, { type: 'attachResource', resourceId: conversation.id });
    run(f, other, { type: 'attachResource', resourceId: note.id });
    const block = f.engine.project(workspaceId).blocks[0];
    run(f, workspaceId, { type: 'moveBlock', blockId: block.blockId, x: 782, y: 417 });
    run(f, workspaceId, { type: 'checkpoint', name: 'Manual arrangement' });
    const before = f.engine.project(workspaceId), sharedBefore = f.engine.project(other).blocks;
    const history = f.db.prepare('SELECT history_json FROM workspace_engine_layouts WHERE workspace_id=?').get(workspaceId)!.history_json;
    const conversationBefore = f.kernel.getResource(conversation.id);
    f.kernel.updateNote(note.id, 'A current edit made after workspace creation', 1);
    const review = preview(f, workspaceId), undone = apply(f, review);
    assert.equal(undone.state, 'archived');
    assert.equal(undone.version, before.workspaceVersion + 1);
    assert.equal(f.kernel.getResource(note.id).note.content, 'A current edit made after workspace creation');
    assert.deepEqual(f.engine.project(other).blocks, sharedBefore);
    assert.equal(f.db.prepare('SELECT count(*) AS total FROM blocks WHERE workspace_id=?').get(workspaceId)!.total, before.blocks.length);
    f.reopen();
    assert.equal(state(f, workspaceId).state, 'archived');
    f.kernel.updateNote(note.id, 'Latest canonical edit while workspace is archived', 2);
    const restored = apply(f, preview(f, workspaceId));
    assert.equal(restored.state, 'active');
    const after = f.engine.project(workspaceId);
    assert.deepEqual(after.blocks, before.blocks);
    assert.deepEqual(after.viewport, before.viewport);
    assert.deepEqual(after.organization, before.organization);
    assert.equal(f.db.prepare('SELECT history_json FROM workspace_engine_layouts WHERE workspace_id=?').get(workspaceId)!.history_json, history);
    assert.deepEqual(f.kernel.getResource(conversation.id), conversationBefore);
    assert.equal(f.kernel.getResource(note.id).note.content, 'Latest canonical edit while workspace is archived');
    assert.deepEqual(f.engine.project(other).blocks, sharedBefore);
    assert.equal(f.db.prepare('SELECT count(*) AS total FROM test_recovery_events').get()!.total, 2);
  } finally { f.close(); }
});

for (const change of ['entity', 'layout', 'project', 'policy', 'creation-row', 'missing-creation', 'ambiguous-creation', 'workspace-access', 'project-archive'] as const) {
  test(`apply rechecks ${change} after review before any archive or receipt`, () => {
    const f = fixture();
    try {
      const project = f.kernel.createProject('Synthetic fence project');
      const workspaceId = f.engine.createWorkspace('Synthetic fenced workspace', project.id).workspaceId;
      const review = preview(f, workspaceId);
      if (change === 'entity') f.kernel.renameWorkspace(workspaceId, 'Intervening rename', 1);
      if (change === 'layout') run(f, workspaceId, { type: 'createBlock', resource: { kind: 'note', title: 'Manual addition', content: 'Keep it' } });
      if (change === 'project') f.kernel.renameProject(project.id, 'Intervening project rename', 1);
      if (change === 'policy') f.policy('local-owner-policy-2');
      if (change === 'creation-row') f.db.prepare("UPDATE change_events SET detail_json='{} ' WHERE id=?").run(review.creationEventId);
      if (change === 'missing-creation') f.db.prepare('DELETE FROM change_events WHERE id=?').run(review.creationEventId);
      if (change === 'ambiguous-creation') f.db.prepare(`INSERT INTO change_events SELECT ?,entity_kind,entity_id,resource_id,resource_version,
        occurred_at,origin,correlation_id,type,detail_json,schema_version FROM change_events WHERE id=?`).run(randomUUID(), review.creationEventId);
      if (change === 'workspace-access') f.denied.add(workspaceId);
      if (change === 'project-archive') f.kernel.setProjectArchived(project.id, true, 1);
      assert.throws(() => apply(f, review), /workspace_recovery_(stale_snapshot|creation_changed|unavailable)/);
      assert.equal(f.db.prepare('SELECT state FROM workspaces WHERE id=?').get(workspaceId)!.state, 'active');
      assert.equal(f.db.prepare('SELECT count(*) AS total FROM recovery_actions').get()!.total, 0);
      assert.equal(f.db.prepare('SELECT count(*) AS total FROM test_recovery_events').get()!.total, 0);
      if (change === 'missing-creation' || change === 'ambiguous-creation') {
        const current = f.recovery.dispatch({ name: 'state', input: { workspaceId } }) as WorkspaceRecoveryState;
        assert.ok(!current.available);
        assert.equal(current.reason, change === 'missing-creation' ? 'creation_record_missing' : 'creation_record_ambiguous');
      }
    } finally { f.close(); }
  });
}

test('idempotent receipts survive restart, reauthorize replay, reject altered commands and do not repeat archive after restore', () => {
  const f = fixture();
  try {
    const workspaceId = f.engine.createWorkspace('Synthetic idempotence target').workspaceId;
    const review = preview(f, workspaceId), commandId = randomUUID(), first = apply(f, review, commandId);
    assert.equal(first.replayed, false);
    assert.deepEqual(apply(f, review, commandId), { ...first, replayed: true });
    f.reopen();
    assert.deepEqual(apply(f, review, commandId), { ...first, replayed: true });
    assert.throws(() => apply(f, { ...review, fingerprint: 'a'.repeat(64) }, commandId), /idempotency_conflict/);
    f.denied.add(workspaceId);
    assert.throws(() => apply(f, review, commandId), /workspace_recovery_unavailable/);
    f.denied.clear();
    apply(f, preview(f, workspaceId));
    assert.equal(state(f, workspaceId).state, 'active');
    assert.deepEqual(apply(f, review, commandId), { ...first, replayed: true });
    assert.equal(state(f, workspaceId).state, 'active', 'Replaying the historical undo receipt must not archive again');
    assert.equal(f.db.prepare('SELECT count(*) AS total FROM test_recovery_events').get()!.total, 2);
  } finally { f.close(); }
});

test('receipt insertion failure rolls back archive, navigation, recorded event and receipt, leaving the exact review retryable', () => {
  const f = fixture();
  try {
    const workspaceId = f.engine.createWorkspace('Synthetic transaction target').workspaceId;
    f.desktop.apply({ type: 'navigate', target: { kind: 'workspace', workspaceId } }, () => { throw Error('unused'); });
    const session = f.db.prepare('SELECT json FROM desktop_session WHERE id=1').get()!.json;
    const review = preview(f, workspaceId), commandId = randomUUID();
    f.db.exec("CREATE TRIGGER test_recovery_receipt_fault BEFORE INSERT ON recovery_actions BEGIN SELECT RAISE(ABORT,'synthetic receipt failure'); END;");
    assert.throws(() => apply(f, review, commandId), /synthetic receipt failure/);
    assert.equal(state(f, workspaceId).state, 'active');
    assert.equal(f.db.prepare('SELECT json FROM desktop_session WHERE id=1').get()!.json, session);
    assert.equal(f.db.prepare('SELECT count(*) AS total FROM recovery_actions').get()!.total, 0);
    assert.equal(f.db.prepare('SELECT count(*) AS total FROM test_recovery_events').get()!.total, 0);
    assert.equal(f.kernel.listEvents('workspace', workspaceId).filter(event => event.type === 'workspace.archived').length, 0);
    f.db.exec('DROP TRIGGER test_recovery_receipt_fault');
    assert.equal(apply(f, review, commandId).state, 'archived');
    assert.equal(f.db.prepare('SELECT count(*) AS total FROM test_recovery_events').get()!.total, 1);
  } finally { f.close(); }
});

test('strict requests, state-only reads, review capacity and expiry never silently grant an archive', () => {
  const f = fixture();
  const originalNow = Date.now;
  try {
    const workspaceId = f.engine.createWorkspace('Synthetic review limits').workspaceId;
    assert.throws(() => f.recovery.dispatch({ name: 'state', input: { workspaceId, extra: true } } as any), /invalid_workspace_recovery_request/);
    assert.throws(() => f.recovery.dispatch({ name: 'state', input: { workspaceId }, extra: true } as any), /invalid_workspace_recovery_request/);
    const current = state(f, workspaceId);
    assert.throws(() => f.recovery.dispatch({ name: 'apply', input: { previewId: randomUUID(), fingerprint: 'b'.repeat(64), commandId: randomUUID() } }), /review_required/);
    assert.throws(() => f.recovery.dispatch({ name: 'preview', input: { workspaceId, action: 'restore', creationEventId: current.creationEventId,
      expectedVersion: current.version, expectedLayoutVersion: current.layoutVersion } }), /wrong_state/);
    const first = preview(f, workspaceId);
    for (let index = 1; index < 16; index++) preview(f, workspaceId);
    assert.throws(() => preview(f, workspaceId), /review_busy/);
    const later = originalNow() + 120_001;
    Date.now = () => later;
    assert.throws(() => apply(f, first), /review_expired/);
    assert.ok(preview(f, workspaceId).previewId, 'Expired previews release bounded review capacity');
    assert.equal(state(f, workspaceId).state, 'active');
  } finally { Date.now = originalNow; f.close(); }
});

test('durable action capacity blocks new changes but preserves an authorized replay receipt', () => {
  const f = fixture();
  try {
    const workspaceId = f.engine.createWorkspace('Synthetic receipt limits').workspaceId;
    const review = preview(f, workspaceId), commandId = randomUUID(), first = apply(f, review, commandId);
    f.db.exec(`WITH RECURSIVE slots(value) AS (SELECT 1 UNION ALL SELECT value+1 FROM slots WHERE value<4095)
      INSERT INTO recovery_actions SELECT 'synthetic-capacity-'||value,'synthetic', '${workspaceId}', '{}' FROM slots;`);
    assert.equal(f.db.prepare('SELECT count(*) AS total FROM recovery_actions').get()!.total, 4096);
    assert.deepEqual(apply(f, review, commandId), { ...first, replayed: true });
    assert.throws(() => apply(f, preview(f, workspaceId)), /receipt_capacity/);
    assert.equal(state(f, workspaceId).state, 'archived');
    assert.equal(f.db.prepare('SELECT count(*) AS total FROM test_recovery_events').get()!.total, 1);
  } finally { f.close(); }
});
