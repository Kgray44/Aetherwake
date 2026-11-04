import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setImmediate as flush, setTimeout as delay } from 'node:timers/promises';
import { agentTemplates } from '../../agent-product/service.mts';
import type { AgentMutationReceipt } from '../../agent-product/contracts.ts';
import type { ProviderConnectionStatus } from '../../application-contract/provider-connections.ts';
import { RESPONSES_ENDPOINT } from '../../openai-provider/responses.mts';
import { composeWorkspaceBlueprint } from '../../block-library/workspace-architect.mts';
import type { TemplateBody } from '../../block-library/contracts.ts';
import type { MissionContextSource } from '../../vela-core/src/mission-context.mts';
import { BackendCore } from '../src/core.mts';
import type { OrdinaryConnectionPort } from '../src/contracts.mts';
import { MissionService, type MissionServiceHost } from '../src/mission-service.mts';
import { MissionWorkrooms } from '../src/mission-workroom.mts';
import type { MissionAgentDashboard, MissionExecutionContext, MissionExecutor, MissionPlan, MissionPreview,
  MissionProjection, MissionScope, MissionTaskPlan, MissionWorkroom, MissionWorkroomPreview } from '../src/mission-contracts.mts';

const scope: MissionScope = { workspaceId: 'origin', projectId: 'project' };
const roomScope: MissionScope = { workspaceId: 'workroom', projectId: scope.projectId };
const task = (id: string): MissionTaskPlan => ({ id, objective: 'Synthetic objective ' + id, dependencies: [], claims: [],
  executor: 'chatgpt.specialist', criterion: id, timeoutMs: 2000, maxAttempts: 1,
  specialist: { role: 'Synthetic ' + id, provider: 'chatgpt-plan-responses', model: 'synthetic-model',
    connectionVersion: 1, settingsStamp: 'PRIVATE_SETTINGS_STAMP', instructions: 'PRIVATE_SPECIALIST_INSTRUCTIONS',
    profile: { id: 'profile-' + id, title: 'Saved ' + id, profileVersion: 2, resourceVersion: 3,
      instructions: 'PRIVATE_PROFILE_INSTRUCTIONS' } } });
const room: MissionWorkroom = { kind: 'workroom', workspaceId: roomScope.workspaceId, title: 'Synthetic room',
  templateId: 'template', missionCards: { team: 'team-card', evidence: 'evidence-card' },
  missionAgentCards: { alpha: 'alpha-card', beta: 'beta-card' } };

function serviceFixture(withSource = false) {
  const db = new DatabaseSync(':memory:');
  let pressure = true, sourceVersion = 1;
  const denied = new Set<string>();
  const active = new Map<string, { context: MissionExecutionContext; release(valid?: boolean): void }>();
  const executor: MissionExecutor = { lane: 'chatgpt-plan-responses', replaySafe: false, available: () => true,
    async run(context) {
      const valid = await new Promise<boolean>(accept => {
        active.set(context.task.id, { context, release: (value = true) => accept(value) });
        context.signal.addEventListener('abort', () => accept(false), { once: true });
      });
      active.delete(context.task.id);
      return { source: 'chatgpt-plan-responses:reported', value: { valid, observations: ['Finding ' + context.task.id, 'x'.repeat(241), 5],
        citations: ['https://example.org/' + context.task.id, 'https://user:secret@example.org/private', 'http://example.org/plain'],
        privateNote: 'PRIVATE_SOURCE_NOTE_BODY' }, telemetry: { durationMs: 8, providerCalls: 1,
          responseId: 'synthetic-response-' + context.task.id,
          usage: { source: 'provider-reported' as const, inputTokens: 10, outputTokens: 4, totalTokens: 14 } } };
    },
    verify: evidence => ({ passed: (evidence.value as { valid: boolean }).valid, detail: 'Checked structured synthetic report' }),
  };
  const source: MissionContextSource = { scopeVersion: () => 'synthetic-policy', retrieve: () => [{ kind: 'resource', id: 'source-note' }],
    read: ref => ({ ref, version: sourceVersion, locator: 'source-note', scope: { kind: 'workspace', id: scope.workspaceId },
      certainty: 'observed', content: 'Synthetic objective selected evidence PRIVATE_SOURCE_NOTE_BODY' }) };
  const host: MissionServiceHost = { db, atomic<T>(work: () => T): T {
    db.exec('BEGIN'); try { const value = work(); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }, authorized: candidate => !denied.has(candidate.workspaceId) && candidate.projectId === scope.projectId &&
    [scope.workspaceId, roomScope.workspaceId].includes(candidate.workspaceId),
  executors: { 'chatgpt.specialist': executor }, laneLimit: () => 2, underPressure: () => pressure,
  ...(withSource ? { contextSource: (_mission, candidate) => candidate.id === 'alpha' ? source : undefined } satisfies Partial<MissionServiceHost> : {}),
  reassign: (_mission, candidate, profileId) => ({ ...candidate.specialist!, role: 'Reassigned specialist',
    profile: { id: profileId, title: 'Replacement saved profile', profileVersion: 4, resourceVersion: 5, instructions: 'PRIVATE_NEW_PROFILE' } }) };
  let service = new MissionService(host);
  const plan: MissionPlan = { scope, objective: 'Synthetic objective', criteria: ['alpha', 'beta'], tasks: [task('alpha'), task('beta')] };
  const created = service.create('synthetic-assignment', plan);
  service.attachWorkroom(created.id, scope, room);
  const agent = (id: string): MissionAgentDashboard => {
    const result = service.workroomResource(id + '-card', roomScope);
    assert.ok(result?.dashboard?.kind === 'agent');
    return result.dashboard;
  };
  return { db, host, active, denied, id: created.id, agent, get service() { return service; },
    releasePressure() { pressure = false; service.capacityChanged(); }, editSource() { sourceVersion++; },
    async reopen() { await service.close(); service = new MissionService(host); },
    async close() { await service.close(); db.close(); } };
}

test('two specialist cards follow only their canonical task and verified reported evidence across restart', async () => {
  const f = serviceFixture();
  try {
    assert.deepEqual(new Set(f.service.workroomCardIds(roomScope)), new Set(['team-card', 'evidence-card', 'alpha-card', 'beta-card']));
    assert.equal(f.agent('alpha').state, 'queued');
    assert.deepEqual(f.agent('alpha').attempts, []);
    assert.deepEqual(f.agent('alpha').profile, { id: 'profile-alpha', title: 'Saved alpha', profileVersion: 2, resourceVersion: 3 });
    f.releasePressure();
    await flush();
    assert.equal(f.active.size, 2);
    const running = f.agent('alpha');
    assert.equal(running.state, 'running');
    assert.equal(running.attempts.length, 1);
    assert.equal(running.attempts[0].id, f.active.get('alpha')!.context.attemptId);
    assert.equal(running.attempts[0].passed, undefined);
    f.active.get('alpha')!.release();
    f.active.get('beta')!.release(false);
    await flush();
    const alpha = f.agent('alpha'), beta = f.agent('beta');
    assert.equal(alpha.state, 'verified');
    assert.equal(beta.state, 'failed');
    assert.deepEqual(alpha.attempts[0].findings, ['Finding alpha']);
    assert.deepEqual(alpha.attempts[0].citations, ['https://example.org/alpha']);
    assert.equal(beta.attempts[0].passed, false);
    assert.equal(beta.attempts[0].findings, undefined);
    assert.equal(alpha.attempts[0].source, 'chatgpt-plan-responses:reported');
    assert.equal(alpha.attempts[0].telemetry?.usage?.totalTokens, 14);
    assert.ok(alpha.attempts[0].timing?.executionMs !== undefined);
    assert.ok(alpha.attempts[0].observedAt && alpha.attempts[0].finishedAt);
    assert.ok(!JSON.stringify([alpha, beta]).includes('PRIVATE_'));
    assert.ok(!JSON.stringify(alpha).includes('Finding beta'));
    const summary = f.service.workroomResource('evidence-card', roomScope)?.dashboard;
    assert.ok(summary?.kind === 'evidence');
    assert.deepEqual(summary.rows[0].findings, alpha.attempts[0].findings);
    await f.reopen();
    assert.deepEqual(f.agent('alpha'), alpha);
    assert.deepEqual(f.agent('beta'), beta);
  } finally { await f.close(); }
});

test('a card keeps its task binding through reviewed reassignment and queued cancellation', async () => {
  const f = serviceFixture();
  try {
    const paused = f.service.control(f.id, scope, f.service.read(f.id, scope).revision, { type: 'pause' });
    const change = { type: 'reassign' as const, taskId: 'alpha', agentProfileId: 'replacement-profile' };
    const review = f.service.previewRevision(f.id, scope, paused.revision, change);
    const revised = f.service.applyRevision(f.id, scope, paused.revision, change, review.fingerprint);
    assert.equal(f.agent('alpha').taskId, 'alpha');
    assert.equal(f.agent('alpha').role, 'Reassigned specialist');
    assert.equal(f.agent('alpha').profile?.id, 'replacement-profile');
    assert.equal(f.agent('beta').profile?.id, 'profile-beta');
    assert.equal(revised.workroom?.missionAgentCards?.alpha, 'alpha-card');
    const cancelled = f.service.control(f.id, scope, revised.revision, { type: 'cancel-branch', taskId: 'alpha' });
    assert.equal(f.agent('alpha').state, 'cancelled');
    assert.deepEqual(f.agent('alpha').attempts, []);
    f.service.control(f.id, scope, cancelled.revision, { type: 'resume' });
    f.releasePressure();
    await flush();
    assert.deepEqual([...f.active.keys()], ['beta']);
    f.active.get('beta')!.release();
    await flush();
    await f.reopen();
    assert.equal(f.agent('alpha').state, 'cancelled');
    assert.equal(f.agent('beta').state, 'verified');
  } finally { await f.close(); }
});

test('agent cards recheck both workspace scopes and withdraw evidence and context after a source edit', async () => {
  const f = serviceFixture(true);
  try {
    f.releasePressure();
    await flush();
    assert.equal(f.agent('alpha').attempts[0].context?.sources[0]?.ref.id, 'source-note');
    f.active.get('alpha')!.release();
    f.active.get('beta')!.release();
    await flush();
    assert.ok(f.agent('alpha').attempts[0].evidenceId);
    assert.equal(f.service.workroomResource('alpha-card', scope), null);
    assert.equal(f.service.workroomResource('alpha-card', { ...roomScope, projectId: 'other-project' }), null);
    f.denied.add(scope.workspaceId);
    assert.deepEqual(f.service.workroomCardIds(roomScope), []);
    assert.equal(f.service.workroomResource('alpha-card', roomScope), null);
    f.denied.clear();
    f.denied.add(roomScope.workspaceId);
    assert.equal(f.service.workroomResource('alpha-card', roomScope), null);
    f.denied.clear();
    f.editSource();
    const stale = f.agent('alpha');
    assert.equal(stale.state, 'blocked');
    assert.equal(stale.attempts[0].evidenceId, undefined);
    assert.equal(stale.attempts[0].findings, undefined);
    assert.equal(stale.attempts[0].context, undefined);
    assert.equal(stale.attempts[0].passed, undefined);
    assert.equal(f.agent('beta').state, 'verified');
    assert.ok(!JSON.stringify(stale).includes('PRIVATE_'));
  } finally { await f.close(); }
});

test('an existing historical retired binding never redirects its note to a successor task', async () => {
  const f = serviceFixture();
  try {
    await f.service.close();
    const stored = JSON.parse(String(f.db.prepare('SELECT json FROM vela_missions WHERE id=?').get(f.id)!.json));
    const original = stored.tasks[0];
    // Seed a retained historical graph, rather than claim specialist replacement is currently authorized.
    stored.retiredTasks = [{ ...original, state: 'cancelled' }];
    stored.tasks[0] = { ...original, id: 'successor-alpha', objective: 'Independent successor assignment' };
    f.db.prepare('UPDATE vela_missions SET json=? WHERE id=?').run(JSON.stringify(stored), f.id);
    await f.reopen();
    const historical = f.agent('alpha');
    assert.equal(historical.taskId, 'alpha');
    assert.equal(historical.retired, true);
    assert.equal(historical.state, 'cancelled');
    assert.equal(historical.title, original.objective);
    assert.equal(f.service.workroomResource('successor-alpha-card', roomScope), null);
  } finally { await f.close(); }
});

test('workroom review uses bounded role keys for maximum-length task IDs and fences a changed plan', async () => {
  const f = serviceFixture();
  try {
    const projection = f.service.read(f.id, scope);
    delete projection.workroom;
    projection.tasks[0].id = 'a'.repeat(120);
    projection.tasks[1].id = 'b'.repeat(120);
    let captured: TemplateBody | undefined;
    const builder = new MissionWorkrooms({ missions: { read: () => projection, attachWorkroom: () => projection },
      library: {
        requestVelaTemplate: async input => ({ name: 'Synthetic draft', description: 'Synthetic review', tags: [],
          body: composeWorkspaceBlueprint([]), provenance: { requestId: input.requestId, providerId: 'synthetic-only' } }),
        saveTemplate: input => { captured = input.body; return { ...input, id: 'template', version: 1,
          source: 'vela', state: 'active', createdAt: projection.createdAt, updatedAt: projection.createdAt }; },
        applyTemplate: () => ({ workspaceId: roomScope.workspaceId, templateId: 'template', templateVersion: 1,
          resourceIds: Object.fromEntries(captured!.resources.map(role => [role.key, 'resource-' + role.key])),
          placementIds: {} }),
      }, currentScope: () => scope, projectVersion: () => 1, writable: () => true, atomic: work => work(),
      createTimeline: () => ({ resourceId: 'resource-mission-timeline', version: 1 }) });
    const stale = await builder.preview(projection.id);
    projection.planRevision++;
    assert.throws(() => builder.apply(projection.id, stale.reviewId), /mission_workroom_review_required/);
    const current = await builder.preview(projection.id);
    const built = builder.apply(projection.id, current.reviewId);
    assert.deepEqual(Object.keys(built.missionAgentCards ?? {}), ['a'.repeat(120), 'b'.repeat(120)]);
    assert.ok(captured!.resources.every(role => /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(role.key)));
    assert.equal(Object.keys(built.missionAgentCards ?? {}).length, 2);
  } finally { await f.close(); }
});

test('real Responses protocol applies long Unicode assignment labels through canonical templates without cloning profiles and restores the views', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aerynth-agent-workroom-'));
  const model = 'gpt-6.1-sol', boundary = 'b'.repeat(64), providerId = 'chatgpt-plan-responses';
  const requests: Record<string, any>[] = [];
  let release!: () => void;
  const gate = new Promise<void>(accept => { release = accept; });
  const status = async (): Promise<ProviderConnectionStatus> => ({ contract: 'aerynth.provider-connection@1', providerId,
    billingRoute: 'chatgpt-plan', state: 'ready', storageAvailable: true, pending: false, registrationVersion: 1,
    planUsageEnabled: true, inferenceVerified: false, nativeAccountHistory: false, nativeAccountMemory: false, nativeAccountSync: false });
  const connection: OrdinaryConnectionPort = { status, begin: async () => { throw Error('unused'); }, finish: async () => {}, cancel: async () => {},
    disconnect: async () => {}, refresh: async () => {}, close: async () => {},
    resolveCredential: async () => ({ providerId, kind: 'chatgpt-plan', boundaryDigest: boundary, bearer: 'SYNTHETIC_ONLY', expiresAt: Date.now() + 60000, scopes: ['chatgpt.tokens.use.direct'] }),
    revalidateCredential: async () => {}, modelCatalog: async () => ({ providerId, boundaryDigest: boundary, observedAt: Date.now(), catalogOnly: true,
      models: [{ id: model, label: 'Synthetic catalog' }] }) };
  const fakeFetch: typeof fetch = async (url, init) => {
    assert.equal(url, RESPONSES_ENDPOINT);
    requests.push(JSON.parse(String(init?.body)));
    const id = 'synthetic-assignment-response-' + requests.length;
    await gate;
    const events = [{ type: 'response.created', response: { id } },
      { type: 'response.output_text.delta', delta: JSON.stringify({ observations: ['Use controlled inputs.', 'Record observed variance.'] }) },
      { type: 'response.completed', response: { id, status: 'completed', model, usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28 }, output: [] } }];
    return new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join(''), { headers: { 'Content-Type': 'text/event-stream' } });
  };
  const options = { path: join(directory, 'state.sqlite'), provider: 'fixture' as const, contentPolicy: 'synthetic-only' as const };
  let core = new BackendCore(options, undefined, undefined, { connection, fetch: fakeFetch });
  try {
    await core.command('ordinaryProviderCheck', {});
    const desktop = await core.command('desktop', { type: 'createWorkspace', title: 'Synthetic agent workspace', projectId: null });
    const workspaceId = desktop.activeWorkspaceId!;
    await core.command('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId } });
    const prefix = 'Specialist assignment · ';
    const longResponsibility = 'Review controls '.padEnd(119 - prefix.length, 'x') + '😀 then compare the observed evidence across repeated workloads.';
    assert.ok(prefix.length + longResponsibility.length > 120);
    const members = [];
    for (const title of ['Experiment specialist', 'Independent reviewer']) {
      const { result } = await core.command('agents', { name: 'create', input: { commandId: randomUUID(), title,
        projectId: null, profile: structuredClone(agentTemplates()[0].profile) } });
      members.push({ profileId: (result as AgentMutationReceipt).agent.resourceId,
        responsibility: members.length === 0 ? longResponsibility : 'Review synthetic controls for ' + title });
    }
    const savedProfiles = (await core.command('desktop', { type: 'snapshot' })).resources.filter(resource => resource.kind === 'agent').map(resource => resource.id);
    const team = await core.command('missions', { name: 'team-save', input: { title: 'Synthetic review team', members } }) as { id: string };
    const objective = 'Assess the synthetic experiment plan';
    const preview = await core.command('missions', { name: 'preview', input: { objective, teamId: team.id } }) as MissionPreview;
    const mission = await core.command('missionStartReviewed', { objective, teamId: team.id, fingerprint: preview.fingerprint, requestId: randomUUID() }) as MissionProjection;
    const deadline = performance.now() + 5000;
    while (requests.length < 2 && performance.now() < deadline) await delay(10);
    assert.equal(requests.length, 2);
    const review = await core.command('missions', { name: 'workroom-preview', input: { id: mission.id } }) as MissionWorkroomPreview;
    assert.equal(review.cards.filter(card => card.title.startsWith('Specialist assignment · ')).length, 2);
    const longCard = review.cards.find(card => card.title.startsWith(prefix + 'Review controls '))!;
    assert.equal(longCard.title.length, 119, 'A surrogate pair crossing the 120-unit label boundary is omitted together');
    assert.equal(Buffer.from(longCard.title, 'utf8').toString('utf8'), longCard.title);
    const built = await core.command('missions', { name: 'workroom-apply', input: { id: mission.id, reviewId: review.reviewId } }) as MissionWorkroom;
    assert.deepEqual(Object.keys(built.missionAgentCards ?? {}), ['member-1', 'member-2']);
    assert.equal(new Set(Object.values(built.missionAgentCards!)).size, 2);
    await core.command('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId: built.workspaceId } });
    const dashboard = async (taskId: string) => {
      const result = await core.command('missions', { name: 'workroom-resource', input: { resourceId: built.missionAgentCards![taskId] } });
      assert.ok(result && 'dashboard' in result && result.dashboard?.kind === 'agent');
      return result.dashboard;
    };
    const running = await dashboard('member-1');
    assert.equal(running.state, 'running');
    assert.equal(running.profile?.id, members[0].profileId);
    assert.equal(running.attempts.length, 1);
    assert.equal(running.attempts[0].passed, undefined);
    release();
    let finished = await dashboard('member-1');
    while (finished.state === 'running' && performance.now() < deadline) { await delay(10); finished = await dashboard('member-1'); }
    assert.equal(finished.state, 'verified');
    assert.equal(finished.attempts[0].source, 'chatgpt-plan-responses:reported');
    assert.deepEqual(finished.attempts[0].findings, ['Use controlled inputs.', 'Record observed variance.']);
    assert.equal(finished.attempts[0].telemetry?.usage?.totalTokens, 28);
    const view = await core.command('desktop', { type: 'snapshot' });
    assert.deepEqual(view.resources.filter(resource => resource.kind === 'agent').map(resource => resource.id), savedProfiles);
    for (const id of Object.values(built.missionAgentCards!)) {
      assert.ok(view.missionWorkroomCardIds?.includes(id));
      assert.equal(view.resources.find(resource => resource.id === id)?.kind, 'note');
      const title = view.resources.find(resource => resource.id === id)!.title;
      assert.ok(title.length <= 120);
      assert.equal(Buffer.from(title, 'utf8').toString('utf8'), title);
    }
    assert.equal(finished.responsibility, longResponsibility, 'Label bounding preserves the full canonical task objective');
    await core.command('close', {});
    core = new BackendCore(options, undefined, undefined, { connection, fetch: fakeFetch });
    assert.deepEqual(await dashboard('member-1'), finished);
    assert.equal(requests.length, 2, 'Restoring assignment views must not dispatch new provider turns');
  } finally {
    release();
    await core.command('close', {});
    const target = resolve(directory), suffix = relative(resolve(tmpdir()), target);
    assert.ok(suffix.startsWith('aerynth-agent-workroom-') && !suffix.startsWith('..') && !isAbsolute(suffix));
    rmSync(target, { recursive: true, force: true });
  }
});
