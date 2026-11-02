import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { VelaService } from '../src/service.mts';
import { VelaError, validateAction, validateProposal } from '../src/capabilities.ts';
import type { AuthorizationRequest, CanonicalConversation, ContextManifest, HostActionResult, ResourceRef, VelaHostPort, VelaMessage, VelaNativeAction, VelaPlanningPort, VelaScope } from '../src/contracts.ts';

/** Synthetic canonical host: resources, placements, conversations and command receipts share ONE db. */
function fixture(options: { planner?: VelaPlanningPort } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE canonical_resources(id TEXT PRIMARY KEY,kind TEXT,title TEXT,version INTEGER,content TEXT);
    CREATE TABLE canonical_messages(id TEXT PRIMARY KEY,conversation_id TEXT,json TEXT);
    CREATE TABLE canonical_placements(workspace_id TEXT,resource_id TEXT);
    CREATE TABLE canonical_receipts(command_id TEXT PRIMARY KEY,json TEXT);`);
  const seed = db.prepare('INSERT INTO canonical_resources VALUES(?,?,?,?,?)');
  seed.run('note:a', 'resource', 'Synthetic research', 1, 'A synthetic research note.');
  seed.run('task:b', 'resource', 'Synthetic task', 1, 'A synthetic task.');
  seed.run('note:private', 'resource', 'Excluded synthetic note', 1, 'Must never enter the planning context.');
  seed.run('workspace:a', 'workspace', 'Synthetic workspace', 1, '');
  let scope: VelaScope = { principalId: 'synthetic:user', policyVersion: 'policy:1', resourceIds: ['note:a', 'task:b'], workspaceIds: ['workspace:a'], projectIds: [] };
  let txId = 0, nativeCalls = 0, contentReads = 0, delegateCalls = 0, hostThrowsAfterEffect = false;
  const authRequests: AuthorizationRequest[] = [], authorizations = new Set<string>(), denied = new Set<string>();
  const delegated: unknown[] = [];
  function transaction<T>(work: () => T): T {
    const name = 'synthetic_' + txId++; db.exec('SAVEPOINT ' + name);
    try { const result = work(); db.exec('RELEASE ' + name); return result; }
    catch (e) { db.exec('ROLLBACK TO ' + name); db.exec('RELEASE ' + name); throw e; }
  }
  const ref = (id: string): ResourceRef | null => {
    const row = db.prepare('SELECT * FROM canonical_resources WHERE id=?').get(id);
    return row ? { id: String(row.id), kind: row.kind as ResourceRef['kind'], title: String(row.title), version: Number(row.version) } : null;
  };
  const allowed = (id: string, kind: ResourceRef['kind'], s: VelaScope) => (kind === 'resource' ? s.resourceIds : kind === 'workspace' ? s.workspaceIds : s.projectIds).includes(id);
  const host: VelaHostPort = {
    scope: () => structuredClone(scope),
    ensureConversation: () => {
      db.prepare("INSERT OR IGNORE INTO canonical_resources VALUES('conversation:vela','resource','Vela',1,'')").run(); return 'conversation:vela';
    },
    readConversation: resourceId => ({ resourceId, revision: Number(db.prepare('SELECT version FROM canonical_resources WHERE id=?').get(resourceId)?.version),
      messages: db.prepare('SELECT json FROM canonical_messages WHERE conversation_id=? ORDER BY rowid').all(resourceId).map(r => JSON.parse(String(r.json))) }),
    appendMessage: (resourceId, message) => {
      const m: VelaMessage = { ...message, id: randomUUID() };
      db.prepare('INSERT INTO canonical_messages VALUES(?,?,?)').run(m.id, resourceId, JSON.stringify(m));
      db.prepare('UPDATE canonical_resources SET version=version+1 WHERE id=?').run(resourceId); return m;
    },
    search: (query, s, limit) => db.prepare('SELECT id FROM canonical_resources WHERE title LIKE ? ORDER BY id LIMIT ?').all('%' + query + '%', limit).map(r => ref(String(r.id))!).filter(r => allowed(r.id, r.kind, s)),
    resolve: (r, s) => allowed(r.id, r.kind, s) ? ref(r.id) : null,
    readContent: (id, s) => {
      contentReads++; if (!s.resourceIds.includes(id)) return null;
      const row = db.prepare('SELECT content FROM canonical_resources WHERE id=?').get(id);
      return row ? { ref: ref(id)!, content: String(row.content), source: 'aerynth://resource/' + id } : null;
    },
    authorize: request => {
      authRequests.push(structuredClone(request));
      if (denied.has(request.phase)) return { decision: 'deny', reason: 'Synthetic explicit denial', policyVersion: scope.policyVersion };
      if (['apply', 'delegate'].includes(request.phase) && !authorizations.has(request.priorAuthorizationRef!)) return { decision: 'deny', reason: 'Missing host-issued authorization', policyVersion: scope.policyVersion };
      const authorizationRef = 'host-auth:' + randomUUID(); authorizations.add(authorizationRef);
      return { decision: 'allow', authorizationRef, policyVersion: scope.policyVersion };
    },
    applyNative: input => {
      assert.ok(authorizations.has(input.authorizationRef), 'only host-issued auth references cross the command boundary');
      for (const target of input.expectedVersions) assert.equal(ref(target.id)?.version, target.version);
      const previous = db.prepare('SELECT json FROM canonical_receipts WHERE command_id=?').get(input.commandId);
      if (previous) return JSON.parse(String(previous.json));
      nativeCalls++;
      const result: HostActionResult = transaction(() => {
        const action = input.action;
        let createdResourceId: string | undefined, createdWorkspaceId: string | undefined;
        if (action.type === 'workspaceFromResources') {
          createdWorkspaceId = 'workspace:' + randomUUID(); seed.run(createdWorkspaceId, 'workspace', action.title, 1, '');
          for (const id of action.resourceIds) db.prepare('INSERT INTO canonical_placements VALUES(?,?)').run(createdWorkspaceId, id);
        } else if (action.type === 'createResource') {
          createdResourceId = 'resource:' + randomUUID(); seed.run(createdResourceId, 'resource', action.title, 1, '');
          if (action.workspaceId) db.prepare('INSERT INTO canonical_placements VALUES(?,?)').run(action.workspaceId, createdResourceId);
        } else if (action.type === 'content') db.prepare('UPDATE canonical_resources SET content=?,version=version+1 WHERE id=?').run(action.content, action.resourceId);
        const r: HostActionResult = { status: 'applied', receiptId: 'canonical-receipt:' + randomUUID(), ...(createdResourceId ? { createdResourceId } : {}), ...(createdWorkspaceId ? { createdWorkspaceId } : {}) };
        db.prepare('INSERT INTO canonical_receipts VALUES(?,?)').run(input.commandId, JSON.stringify(r)); return r;
      });
      if (hostThrowsAfterEffect) throw new Error('Synthetic lost response after committed effect');
      return result;
    },
    delegateTask: async input => {
      assert.ok(authorizations.has(input.authorizationRef)); delegateCalls++; delegated.push(structuredClone(input));
      return { status: 'applied', receiptId: 'execution-receipt:synthetic' };
    },
  };
  const service = new VelaService({ db, host, transaction, planner: options.planner, now: () => '2026-11-02T01:50:00.000Z' });
  return { service, db, host, transaction, authRequests, denied, delegated,
    counts: () => ({ nativeCalls, contentReads, delegateCalls }),
    setScope: (value: Partial<VelaScope>) => { scope = { ...scope, ...value }; },
    throwAfterEffect: () => { hostThrowsAfterEffect = true; },
    ref, close: () => db.close() };
}
function proposal(action: VelaNativeAction = { type: 'workspaceFromResources', title: 'Research', projectId: null, resourceIds: ['note:a'] }) {
  return { schemaVersion: 1, summary: 'Create a workspace for the selected research.',
    steps: [{ id: 'organize', explanation: 'Reference the existing research note without duplicating it.', action }],
    contribution: { providerId: 'synthetic-planner', classification: 'reported' } };
}
function planner(value: unknown = proposal()) {
  let calls = 0, captured: { context: ContextManifest; intent: string } | undefined;
  const port: VelaPlanningPort = { providerId: 'synthetic-planner', availability: () => ({ available: true, busy: false }),
    propose: async input => { calls++; captured = input; return structuredClone(value); } };
  return { port, calls: () => calls, captured: () => captured };
}
async function reviewed(f: ReturnType<typeof fixture>) {
  const request = await f.service.request({ intent: 'Make a research workspace with the selected note', resourceIds: ['note:a'], authorizeProvider: true });
  assert.equal(request.state, 'awaiting-review');
  const plan = f.service.state().plans.find(p => p.id === request.planId)!;
  return f.service.review({ planId: plan.id, fingerprint: plan.fingerprint, decision: 'approve' });
}

test('opening has no inference/actions, canonical conversation survives service recreation on the same connection', () => {
  const p = planner(), f = fixture({ planner: p.port });
  try {
    assert.equal(f.service.state().conversation, null);
    const opened = f.service.open(); assert.equal(opened.conversation?.resourceId, 'conversation:vela');
    assert.equal(p.calls(), 0); assert.equal(f.counts().nativeCalls, 0); assert.equal(f.counts().contentReads, 0);
    const reopened = new VelaService({ db: f.db, host: f.host, transaction: f.transaction });
    assert.equal(reopened.state().conversation?.resourceId, opened.conversation?.resourceId);
    assert.equal(f.db.prepare("SELECT count(*) AS count FROM canonical_resources WHERE id='conversation:vela'").get()?.count, 1);
    assert.equal(f.db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name LIKE 'vela_%'").get()?.count, 1);
  } finally { f.close(); }
});

test('native actions work without provider and apply an atomic canonical workspace with exact existing resource placements', async () => {
  const f = fixture();
  try {
    const plan = f.service.native({ intent: 'Organize these two resources', action: { type: 'workspaceFromResources', title: 'Native workspace', projectId: null, resourceIds: ['note:a', 'task:b'] } });
    assert.equal(plan.state, 'approved'); assert.equal(f.counts().nativeCalls, 0);
    const applied = await f.service.apply(plan.id); assert.equal(applied.state, 'applied');
    await f.service.apply(plan.id); assert.equal(f.counts().nativeCalls, 1);
    assert.deepEqual(f.db.prepare('SELECT resource_id FROM canonical_placements ORDER BY resource_id').all().map(r => r.resource_id), ['note:a', 'task:b']);
    assert.equal(f.db.prepare("SELECT count(*) AS count FROM canonical_resources WHERE id IN ('note:a','task:b')").get()?.count, 2);
    assert.ok(f.service.state().receipts[0].createdWorkspaceId);
    assert.equal(f.service.state().receipts[0].taskVerified, false);
    assert.equal(f.service.state().conversation?.messages[0].source, 'user');
  } finally { f.close(); }
});

test('metadata search reads no content; provider receives only explicitly read authorized manifest and never auto-applies', async () => {
  const p = planner(), f = fixture({ planner: p.port });
  try {
    assert.equal(f.service.search('Synthetic').length, 3); assert.equal(f.counts().contentReads, 0);
    const plan = await reviewed(f); assert.equal(f.counts().nativeCalls, 0);
    assert.equal(p.calls(), 1); assert.deepEqual(p.captured()?.context.included.map(r => r.id), ['note:a']);
    assert.ok(!JSON.stringify(p.captured()).includes('note:private'));
    assert.equal(p.captured()?.context.included[0].trust, 'untrusted-source-data');
    assert.equal(plan.contribution?.providerId, 'synthetic-planner');
    assert.ok(f.authRequests.some(r => r.phase === 'provider-context' && r.providerId === 'synthetic-planner'));
    assert.equal((await f.service.apply(plan.id)).state, 'applied');
  } finally { f.close(); }
});

test('stale source, changed policy, incorrect fingerprint and missing approval all prevent application', async () => {
  const f = fixture({ planner: planner().port });
  try {
    const r = await f.service.request({ intent: 'Organize', resourceIds: ['note:a'], authorizeProvider: true });
    const p = f.service.state().plans.find(p => p.id === r.planId)!;
    await assert.rejects(f.service.apply(p.id), /review_authorization_required/);
    assert.throws(() => f.service.review({ planId: p.id, fingerprint: 'wrong', decision: 'approve' }), /review_fingerprint_mismatch/);
    f.service.review({ planId: p.id, fingerprint: p.fingerprint, decision: 'approve' });
    f.db.prepare("UPDATE canonical_resources SET version=2 WHERE id='note:a'").run();
    await assert.rejects(f.service.apply(p.id), /stale_target_version/); assert.equal(f.counts().nativeCalls, 0);
    f.db.prepare("UPDATE canonical_resources SET version=1 WHERE id='note:a'").run(); f.setScope({ policyVersion: 'policy:2' });
    await assert.rejects(f.service.apply(p.id), /stale_policy_version/);
  } finally { f.close(); }
});

test('provider egress denial, missing consent, busy provider, and excluded resource never launch inference', async () => {
  const p = planner(), f = fixture({ planner: p.port });
  try {
    const noConsent = await f.service.request({ intent: 'Organize', resourceIds: [], authorizeProvider: false });
    assert.equal(noConsent.errorCode, 'provider_authorization_required');
    f.denied.add('provider-context');
    const denied = await f.service.request({ intent: 'Organize', resourceIds: ['note:a'], authorizeProvider: true });
    assert.equal(denied.state, 'failed'); assert.equal(p.calls(), 0);
    await assert.rejects(f.service.request({ intent: 'Use excluded data', resourceIds: ['note:private'], authorizeProvider: true }), /resource_not_authorized/);
    p.port.availability = () => ({ available: true, busy: true });
    const busy = await f.service.request({ intent: 'Organize', resourceIds: [], authorizeProvider: true });
    assert.equal(busy.errorCode, 'provider_busy'); assert.equal(p.calls(), 0);
  } finally { f.close(); }
});

test('invalid provider actions/identity remain inspectable and cannot execute', async () => {
  for (const bad of [
    { ...proposal(), steps: [{ id: 'bad', explanation: 'Run arbitrary code', action: { type: 'shell', command: 'never execute' } }] },
    { ...proposal(), contribution: { providerId: 'impersonated-provider', classification: 'reported' } },
  ]) {
    const f = fixture({ planner: planner(bad).port });
    try {
      const r = await f.service.request({ intent: 'Organize', resourceIds: [], authorizeProvider: true });
      assert.equal(r.state, 'invalid-plan'); assert.deepEqual(r.invalidProposal, bad);
      assert.equal(f.service.state().plans.length, 0); assert.equal(f.counts().nativeCalls, 0);
    } finally { f.close(); }
  }
  assert.throws(() => validateAction({ type: 'attach', workspaceId: 'w', resourceId: 'r', unauthorized: true }), /unsupported_or_invalid_action/);
});

test('provider cancellation preserves user intent and prevents late proposed actions', async () => {
  let finish!: (value: unknown) => void;
  const port: VelaPlanningPort = { providerId: 'synthetic-planner', availability: () => ({ available: true, busy: false }), propose: () => new Promise(resolve => { finish = resolve; }) };
  const f = fixture({ planner: port });
  try {
    const pending = f.service.request({ intent: 'Keep this initiating intent', resourceIds: ['note:a'], authorizeProvider: true });
    const id = f.service.state().requests[0].id;
    assert.equal(f.service.cancel(id).state, 'cancelled'); finish(proposal());
    assert.equal((await pending).state, 'cancelled'); assert.equal(f.service.state().requests[0].intent, 'Keep this initiating intent');
    assert.equal(f.service.state().plans.length, 0); assert.equal(f.counts().nativeCalls, 0);
  } finally { f.close(); }
});

test('lost host response after real canonical effect is unknown and never automatically retried', async () => {
  const f = fixture();
  try {
    const p = f.service.native({ intent: 'Create note', action: { type: 'createResource', kind: 'note', title: 'Only once', workspaceId: null } });
    f.throwAfterEffect(); assert.equal((await f.service.apply(p.id)).state, 'unknown');
    assert.equal(f.counts().nativeCalls, 1); assert.equal(f.service.state().receipts[0].state, 'unknown');
    await assert.rejects(f.service.apply(p.id), /review_authorization_required/); assert.equal(f.counts().nativeCalls, 1);
  } finally { f.close(); }
});

test('attention has explicit app-event scope, independent presence/review, quiet/focus modes and bounded interruption budget', () => {
  const f = fixture();
  const event = { id: 'event:1', type: 'task.changed', source: 'aerynth', occurredAt: '2026-11-02T01:49:00Z', subject: { id: 'task:b', kind: 'resource' as const }, severity: 'warning' as const, classification: 'observed' as const, summary: 'Synthetic task changed', correlationId: 'synthetic:correlation' };
  try {
    assert.equal(f.service.ingestAttention(event), null);
    f.service.preferences({ expectedVersion: 1, patch: { monitoringEnabled: true, allowedEventTypes: ['task.changed'], maxInterruptionsPerHour: 1 } });
    assert.equal(f.service.ingestAttention(event)?.disposition, 'interrupt');
    assert.equal(f.service.ingestAttention({ ...event, id: 'event:2' })?.disposition, 'digest');
    f.service.open(); assert.equal(f.service.state().attention[0].reviewedAt, null);
    f.service.preferences({ expectedVersion: 2, patch: { mode: 'quiet' } });
    assert.equal(f.service.ingestAttention({ ...event, id: 'event:3' })?.disposition, 'silent');
    f.service.preferences({ expectedVersion: 3, patch: { mode: 'focused' } });
    assert.equal(f.service.ingestAttention({ ...event, id: 'event:4' })?.disposition, 'digest');
    f.service.reviewAttention(['event:1']); assert.ok(f.service.state().attention[0].reviewedAt);
    f.service.reviewAttention(['event:2'], 'dismissed'); assert.equal(f.service.state().attention[1].reviewedAt, null);
    f.setScope({ resourceIds: ['note:a'] }); assert.equal(f.service.state().attention.length, 0);
    assert.throws(() => f.service.reviewAttention(['event:3']), /attention_not_authorized/);
    assert.throws(() => f.service.preferences({ expectedVersion: 1, patch: { mode: 'normal' } }), /stale_preference_version/);
    assert.equal(f.service.state().preferences.learning, 'disabled');
  } finally { f.close(); }
});

test('delegation preserves intent/provider/context and requires separate host-issued execution authorization', async () => {
  const value = { ...proposal(), steps: [{ id: 'delegate', explanation: 'Propose a bounded provider execution', action: { type: 'delegateTask', title: 'Investigate', objective: 'Investigate the synthetic note', providerId: 'codex', resourceIds: ['note:a'], constraints: ['Do not modify anything'] } }] };
  const f = fixture({ planner: planner(value).port });
  try {
    f.service.preferences({ expectedVersion: 1, patch: { delegationEnabled: true } });
    const p = await reviewed(f); f.denied.add('delegate');
    assert.equal((await f.service.apply(p.id)).state, 'failed'); assert.equal(f.counts().delegateCalls, 0);
    f.denied.delete('delegate');
    const next = await reviewed(f); assert.equal((await f.service.apply(next.id)).state, 'applied');
    assert.equal(f.counts().delegateCalls, 1);
    const delegated = f.delegated[0] as any;
    assert.equal(delegated.initiatingIntent, 'Make a research workspace with the selected note');
    assert.equal(delegated.action.providerId, 'codex'); assert.equal(delegated.sourceConversationId, 'conversation:vela');
    assert.deepEqual(delegated.context.included.map((r: ResourceRef) => r.id), ['note:a']);
    assert.equal(f.service.state().receipts.at(-1)?.taskVerified, false);
    assert.ok(f.authRequests.some(r => r.phase === 'delegate' && r.providerId === 'codex'));
  } finally { f.close(); }
});

test('restart recovers planning/applying as unknown and stale service writers cannot overwrite newer state', async () => {
  const f = fixture();
  try {
    f.service.open();
    const stale = new VelaService({ db: f.db, host: f.host, transaction: f.transaction });
    f.service.preferences({ expectedVersion: 1, patch: { mode: 'quiet' } });
    assert.throws(() => stale.preferences({ expectedVersion: 1, patch: { mode: 'focused' } }), /concurrent_vela_writer/);
    assert.equal(f.service.state().preferences.mode, 'quiet');
    const p = f.service.native({ intent: 'Create local task', action: { type: 'createResource', kind: 'task', title: 'Later', workspaceId: null } });
    const raw = JSON.parse(String(f.db.prepare('SELECT json FROM vela_state WHERE id=1').get()!.json));
    raw.plans.find((plan: any) => plan.id === p.id).state = 'applying'; raw.requests[0].state = 'planning';
    f.db.prepare('UPDATE vela_state SET json=? WHERE id=1').run(JSON.stringify(raw));
    const reopened = new VelaService({ db: f.db, host: f.host, transaction: f.transaction });
    assert.equal(reopened.state().plans[0].state, 'unknown'); assert.equal(reopened.state().requests[0].state, 'unknown');
    assert.equal(f.counts().nativeCalls, 0);
  } finally { f.close(); }
});
