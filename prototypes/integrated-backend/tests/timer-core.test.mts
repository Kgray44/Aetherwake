import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { DatabaseSync } from 'node:sqlite';
import { BackendCore } from '../src/core.mts';
import type { Options, StreamEvent } from '../src/contracts.mts';
import type { ClockTimerDocument, TimerClockReading, TimerMutationResult, TimerOperation } from '../../timer-product/contracts.ts';
import type { CreatedBlock, BlockInstanceSettings, WorkspaceTemplate, AppliedTemplate } from '../../block-library/contracts.ts';
import { defaultOrganization } from '../../workspace-engine/organization.mts';
import { presentation } from '../../workspace-engine/geometry.mts';
import type { VelaBackendState } from '../src/contracts.mts';
const velaState=async(core:BackendCore)=>await core.command('vela',{name:'state',input:{}}) as VelaBackendState;

function fixture(t: TestContext, syntheticClock = true) {
  const directory = mkdtempSync(join(tmpdir(), 'aerynth-core-timers-')), path = join(directory, 'canonical.db');
  const clock: TimerClockReading = { epochMs: Date.parse('2026-11-04T12:00:00Z'), monotonicMs: 1000, sessionId: 'synthetic-core-session:1', timeZone: 'UTC', locale: 'en-US' };
  const events: StreamEvent[] = [], cores: BackendCore[] = [];
  const open = () => {
    const options: Options = { path, provider: 'fixture', contentPolicy: 'synthetic-only', ...(syntheticClock ? { syntheticTimerClock: clock } : {}) };
    const core = new BackendCore(options, event => events.push(event)); cores.push(core); return core;
  };
  const core = open();
  t.after(async () => {
    for (const instance of cores) await instance.command('close', {}).catch(() => {});
    assert.equal(resolve(dirname(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('aerynth-core-timers-'));
    rmSync(directory, { recursive: true, force: true });
  });
  const db = () => (cores.at(-1) as any).db as DatabaseSync;
  const count = (table: string) => { assert.match(table, /^[a-z_]+$/u); return Number(db().prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n); };
  const read = async (instance: BackendCore, resourceId: string) => (await instance.command('clockTimers', { name: 'read', input: { resourceId } })).result as ClockTimerDocument;
  const create = async (instance = core) => (await instance.command('clockTimers', { name: 'create', input: { commandId: randomUUID(), title: 'Synthetic canonical clock' } })).result as TimerMutationResult;
  const mutate = async (resourceId: string, operations: TimerOperation[], instance = core) => (await instance.command('clockTimers', { name: 'mutate', input: {
    commandId: randomUUID(), resourceId, expectedVersion: (await read(instance, resourceId)).resource.version, operations } })).result as TimerMutationResult;
  return { core, clock, events, open, db, count, create, read, mutate };
}

test('fresh unrelated Core has no timer schema, domain or sampler and advertises no fake clock capability', async t => {
  const f = fixture(t, false); await f.core.command('desktop', { type: 'snapshot' });
  const caps = (await f.core.command('library', { name: 'capabilities', input: {} })).result as any;
  assert.notEqual(caps.kinds.clock_timer.state, 'available');
  assert.equal(f.db().prepare("SELECT 1 FROM sqlite_master WHERE name='timer_documents'").get(), undefined);
  assert.equal((f.core as any).timerDomain, undefined);
  assert.deepEqual(await f.core.command('providerActivity', {}), { codexConnections: 0, providerRequests: 0, systemMemoryReads: 0, scope: 'process-session-native-attempts' });
});

test('actual Core command creates a generic semantic clock resource and pure reads keep SQLite unchanged', async t => {
  const f = fixture(t), created = await f.create(), snapshot = await f.core.command('desktop', { type: 'snapshot' });
  assert.equal(snapshot.resources.find(resource => resource.id === created.resourceId)?.kind, 'clock_timer');
  assert.equal(f.db().prepare('SELECT kind FROM resources WHERE id=?').get(created.resourceId)!.kind, 'generic');
  assert.equal(f.count('notes'), 0); assert.equal(f.count('blocks'), 0);
  const changes = f.db().prepare('SELECT total_changes() AS n').get()!.n;
  const read = await f.core.command('clockTimers', { name: 'read', input: { resourceId: created.resourceId } });
  const listed = await f.core.command('clockTimers', { name: 'list', input: {} });
  assert.equal(read.desktop, undefined); assert.equal(listed.desktop, undefined); assert.equal(f.db().prepare('SELECT total_changes() AS n').get()!.n, changes);
  assert.equal((await f.core.command('openResource', { resourceId: created.resourceId })).status, 'ready');
  const caps = (await f.core.command('library', { name: 'capabilities', input: {} })).result as any; assert.equal(caps.kinds.clock_timer.state, 'available');
});

test('library clock creation, placement configuration and multiple workspace views share actual timer IDs', async t => {
  const f = fixture(t);
  let desktop = await f.core.command('desktop', { type: 'createWorkspace', title: 'Left clock view', projectId: null });
  const left = desktop.activeWorkspaceId!;
  const creation = await f.core.command('library', { name: 'createBlock', input: { commandId: 'synthetic:library-clock', workspaceId: left,
    expectedLayoutVersion: desktop.layoutVersion, kind: 'clock_timer', title: 'Shared clock' } });
  const created = creation.result as CreatedBlock; assert.equal(creation.desktop?.resources.find(resource => resource.id === created.resourceId)?.kind, 'clock_timer');
  const timer = await f.mutate(created.resourceId, [{ type: 'createTimer', key: 'timer', name: 'Shared tea', durationMs: 60000, start: true }]);
  const settings = (await f.core.command('library', { name: 'getBlockSettings', input: created.placementId })).result as BlockInstanceSettings;
  await f.core.command('library', { name: 'configureBlock', input: { placementId: created.placementId, expectedVersion: settings.version,
    configuration: { ...settings.configuration, clockTimer: { mode: 'stopwatch', selectedTimerId: timer.createdIds.timer } } } });
  desktop = await f.core.command('desktop', { type: 'createWorkspace', title: 'Right clock view', projectId: null });
  const right = desktop.activeWorkspaceId!, current = await f.read(f.core, created.resourceId);
  const attached = (await f.core.command('library', { name: 'attachBlock', input: { commandId: 'synthetic:attach-clock', workspaceId: right,
    expectedLayoutVersion: desktop.layoutVersion, kind: 'clock_timer', resourceId: created.resourceId, expectedResourceVersion: current.resource.version } })).result as CreatedBlock;
  assert.notEqual(attached.placementId, created.placementId); assert.equal(attached.resourceId, created.resourceId);
  assert.equal(f.count('timer_documents'), 1); assert.equal(f.count('notes'), 0);
  const block = (await f.core.command('desktop', { type: 'snapshot' })).blocks.find(block => block.id === attached.placementId)!;
  await f.core.command('desktop', { type: 'detach', blockId: block.id, expectedVersion: block.version });
  assert.equal((await f.read(f.core, created.resourceId)).timers[0].id, timer.createdIds.timer);
});

test('desktop clock creation and template creation use the domain factory without creating notes', async t => {
  const f = fixture(t);
  let desktop = await f.core.command('desktop', { type: 'createResource', kind: 'clock_timer', title: 'Unplaced clock', workspaceId: null });
  assert.equal(desktop.resources.filter(resource => resource.kind === 'clock_timer').length, 1); assert.equal(f.count('notes'), 0);
  const organization = defaultOrganization();
  const { order: _order, spans: _spans, ...structured } = organization.structured;
  const saved = (await f.core.command('library', { name: 'saveTemplate', input: { name: 'Synthetic clock template', description: 'Synthetic clock creation', tags: [], source: 'saved',
    body: { schemaVersion: 1, organization: { schemaVersion: organization.schemaVersion, mode: organization.mode, gap: organization.gap, structured },
      resources: [{ key: 'clock', label: 'Clock', source: { mode: 'new', kind: 'clock_timer', title: 'Template clock' } }],
      placements: [{ key: 'clock-view', resourceKey: 'clock', presentation: presentation({ width: 420, height: 520 }) }],
      groups: [], viewport: { x: 0, y: 0, zoom: 1 } } } as any })).result as WorkspaceTemplate;
  const applied = (await f.core.command('library', { name: 'applyTemplate', input: { commandId: randomUUID(), templateId: saved.id, expectedVersion: saved.version,
    title: 'Clock workspace', projectId: null } })).result as AppliedTemplate;
  desktop = await f.core.command('desktop', { type: 'snapshot' });
  assert.ok(applied.workspaceId); assert.equal(desktop.resources.filter(resource => resource.kind === 'clock_timer').length, 2);
  assert.equal(f.count('timer_documents'), 2); assert.equal(f.count('notes'), 0);
});

test('Core expiry becomes a durable in-app notice and observed stream event; only explicit ACK dismisses it', async t => {
  const f = fixture(t), created = await f.create();
  const timer = await f.mutate(created.resourceId, [{ type: 'createTimer', key: 'timer', name: 'Native completion', durationMs: 1000, start: true }]);
  f.clock.epochMs += 2000; f.clock.monotonicMs += 2000;
  await f.core.command('timerHostResume', {});
  const completed = await f.read(f.core, created.resourceId); assert.equal(completed.timers[0].state, 'completed'); assert.equal(completed.pendingExpiries.length, 1);
  const event = f.events.find(event => event.type === 'clock_timer.expired')!;
  assert.equal(event.classification, 'observed'); assert.equal(event.providerId, 'aerynth-native'); assert.equal(event.resourceId, created.resourceId);
  assert.deepEqual(event.payload.clockTimer?.expiryIds, [completed.pendingExpiries[0].id]);
  assert.equal(f.count('timer_delivery_receipts'), 0, 'No OS notification receipt is fabricated');
  await f.mutate(created.resourceId, [{ type: 'acknowledgeExpiry', expiryId: completed.pendingExpiries[0].id }]);
  assert.equal((await f.read(f.core, created.resourceId)).pendingExpiries.length, 0);
  assert.equal((await f.read(f.core, created.resourceId)).timers[0].id, timer.createdIds.timer);
  assert.equal((await f.core.command('providerActivity', {})).providerRequests, 0);
});

test('persisted timers recover on Core startup without opening a block and keep wall-recovery uncertainty', async t => {
  const f = fixture(t), created = await f.create(); await f.mutate(created.resourceId, [{ type: 'createTimer', key: 'timer', name: 'Reopened timer', durationMs: 3000, start: true }]);
  await f.core.command('close', {}); f.events.length = 0; f.clock.epochMs += 6000; f.clock.monotonicMs = 0; f.clock.sessionId = 'synthetic-core-session:2';
  const reopened = f.open();
  for (let i = 0; i < 100 && !f.events.some(event => event.type === 'clock_timer.expired'); i++) await new Promise<void>(resolve => setImmediate(resolve));
  assert.ok(f.events.some(event => event.type === 'clock_timer.expired'));
  const document = await f.read(reopened, created.resourceId); assert.equal(document.pendingExpiries[0].wallRecovery, true);
  assert.equal(document.timers[0].state, 'completed'); assert.equal(f.count('blocks'), 0); assert.equal(f.count('resources'), 1);
});

test('current Core resource/project organization checks fence mutation, replay and archived project access', async t => {
  const f = fixture(t), created = await f.create();
  const access = (f.core as any).conversationAccess, original = access.resource.bind(access); let writable = true;
  access.resource = (id: string, purpose?: string, ...rest: unknown[]) => purpose === 'organize' && !writable ? false : original(id, purpose, ...rest);
  writable = false;
  assert.equal((await f.read(f.core, created.resourceId)).canEdit, false);
  await assert.rejects(f.mutate(created.resourceId, [{ type: 'stopwatchStart' }]), /timer_read_only/u);
  writable = true;
  let desktop = await f.core.command('desktop', { type: 'createProject', title: 'Scoped clock project' }); const project = desktop.projects[0];
  const scoped = (await f.core.command('clockTimers', { name: 'create', input: { commandId: 'synthetic:scoped-clock', title: 'Scoped clock', projectId: project.id } })).result as TimerMutationResult;
  desktop = await f.core.command('desktop', { type: 'archiveSubject', kind: 'project', id: project.id, expectedVersion: project.version, archived: true });
  await assert.rejects(f.read(f.core, scoped.resourceId), /timer_unavailable/u);
  const listed = (await f.core.command('clockTimers', { name: 'list', input: {} })).result as { id: string }[];
  assert.equal(listed.some(resource => resource.id === scoped.resourceId), false);
});

test('synthetic clocks cannot be injected into private profiles and private resume rejects ordinary synthetic callers', async t => {
  const f = fixture(t, false); await assert.rejects(f.core.command('timerHostResume', {}), /native_timer_resume_required/u);
  assert.throws(() => new BackendCore({ path: ':memory:', contentPolicy: 'local-private', syntheticTimerClock: f.clock }), /synthetic_timer_clock_forbidden/u);
});

test('Vela native timer lifecycle creates one canonical clock/block and journal followups preserve exact timer identity', async t => {
  const f=fixture(t),desktop=await f.core.command('desktop',{type:'createWorkspace',title:'Synthetic Vela timer workspace',projectId:null});
  const route=async(intent:string)=>{const value=await f.core.command('velaRouteNative',{intent});assert.ok(value.matched,intent);assert.equal(value.request.state,'completed',value.request.errorCode);return value.request;};
  const first=await route('Set a bread timer for fifteen minutes');
  let state=await velaState(f.core),receipt=state.receipts.find(value=>value.requestId===first.id)!;
  assert.equal(receipt.state,'applied');assert.equal(receipt.clockTimer?.verification.receiptMatchesCurrent,true);
  const resourceId=receipt.clockTimer!.resourceId!,timerId=receipt.clockTimer!.timerId!;
  assert.ok(resourceId&&timerId);assert.equal(receipt.clockTimer!.workspaceId,desktop.activeWorkspaceId);
  assert.ok(receipt.clockTimer!.blockId);assert.equal(f.count('timer_documents'),1);assert.equal(f.count('notes'),0);assert.equal(f.count('blocks'),1);
  for(const [intent,expected] of [['Pause my bread timer','paused'],['Resume my bread timer','running'],['Add five minutes','running'],
    ['Reset that timer','ready'],['Start my bread timer','running'],['Cancel my bread timer','cancelled']] as const) {
    await route(intent);const document=await f.read(f.core,resourceId);assert.equal(document.timers[0].id,timerId);assert.equal(document.timers[0].state,expected);
  }
  await route('How much time is left?');await route('Show all my timers');
  state=await velaState(f.core);assert.equal(state.conversation?.messages.filter(message=>message.source==='user').length,9);
  assert.ok(state.conversation?.messages.filter(message=>message.role==='assistant').every(message=>message.source==='vela-native'&&message.classification==='observed'));
  assert.equal((await f.core.command('providerActivity',{})).providerRequests,0);assert.equal(f.count('timer_documents'),1);assert.equal(f.count('blocks'),1);
  assert.ok(f.events.some(event=>event.type==='vela.native.clockTimer'&&event.classification==='observed'));
});

test('Vela stopwatch, saved world clocks and current city time use native timer results with no provider execution',async t=>{
  const f=fixture(t);
  for(const intent of ['Start a stopwatch','Record a lap on the stopwatch','Pause the stopwatch','Resume the stopwatch','Add a clock for Tokyo','Show all my world clocks',"What's the time in Tokyo?"]) {
    f.clock.epochMs+=1000;f.clock.monotonicMs+=1000;
    const value=await f.core.command('velaRouteNative',{intent});assert.ok(value.matched,intent);assert.equal(value.request.state,'completed',value.request.errorCode);
  }
  const listed=(await f.core.command('clockTimers',{name:'list',input:{}})).result as {id:string}[];assert.equal(listed.length,1);
  const document=await f.read(f.core,listed[0].id);assert.equal(document.stopwatch.laps.length,1);assert.equal(document.worldClocks[0].timeZone,'Asia/Tokyo');
  const state=await velaState(f.core);assert.match(state.conversation!.messages.at(-1)!.content,/Asia\/Tokyo/u);
  assert.equal(f.count('notes'),0);assert.equal((await f.core.command('providerActivity',{})).providerRequests,0);
});

test('Vela unknown cities and missing duration clarify canonically without starting the native timer sampler',async t=>{
  const f=fixture(t,false);
  for(const intent of ["What's the time in Madeupopolis?",'Create a bread timer']) {
    const result=await f.core.command('velaRouteNative',{intent});assert.ok(result.matched);assert.equal(result.request.state,'responded');assert.equal(result.request.response?.kind,'clarification');
  }
  assert.equal((f.core as any).timerDomain,undefined);assert.equal(f.db().prepare("SELECT 1 FROM sqlite_master WHERE name='timer_documents'").get(),undefined);
  const state=await velaState(f.core);assert.equal(state.conversation!.messages.length,4);assert.equal(state.plans.length,0);
  assert.equal((await f.core.command('providerActivity',{})).providerRequests,0);
});

test('Vela deletes require exact plan review and a deleted canonical last timer clarifies instead of selecting another',async t=>{
  const f=fixture(t);await f.core.command('velaRouteNative',{intent:'Set a bread timer for one minute'});await f.core.command('velaRouteNative',{intent:'Set a laundry timer for two minutes'});
  const result=await f.core.command('velaRouteNative',{intent:'Delete my laundry timer'});assert.ok(result.matched);assert.equal(result.request.state,'awaiting-review');
  let state=await velaState(f.core),plan=state.plans.find(value=>value.id===result.request.planId)!;
  assert.equal(plan.state,'prepared');const resourceId=state.receipts.find(value=>value.state==='applied')!.clockTimer!.resourceId!;
  assert.equal((await f.read(f.core,resourceId)).timers.length,2);await assert.rejects(f.core.command('vela',{name:'apply',input:plan.id}),/review_authorization_required/u);
  await f.core.command('vela',{name:'review',input:{planId:plan.id,fingerprint:plan.fingerprint,decision:'approve'}});
  await f.core.command('vela',{name:'apply',input:plan.id});assert.equal((await f.read(f.core,resourceId)).timers.length,1);
  const followup=await f.core.command('velaRouteNative',{intent:'Reset that timer'});assert.ok(followup.matched);assert.equal(followup.request.response?.kind,'clarification');
  assert.equal((await f.read(f.core,resourceId)).timers[0].name,'bread');
});

test('Vela timer journal and canonical followup survive Core restart and completion remains a durable in-app expiry',async t=>{
  const f=fixture(t);const initial=await f.core.command('velaRouteNative',{intent:'Set a bread timer for five seconds'});assert.ok(initial.matched);
  const state=await velaState(f.core),receipt=state.receipts.find(value=>value.requestId===initial.request.id)!.clockTimer!;
  await f.core.command('close',{});f.clock.epochMs+=1000;f.clock.monotonicMs=0;f.clock.sessionId='synthetic:journal-reopen';
  const reopened=f.open(),followup=await reopened.command('velaRouteNative',{intent:'Add five minutes'});assert.ok(followup.matched);assert.equal(followup.request.state,'completed',followup.request.errorCode);
  const document=await f.read(reopened,receipt.resourceId!);assert.equal(document.timers[0].id,receipt.timerId);assert.equal(document.timers[0].durationMs,305000);
  f.clock.epochMs+=400000;f.clock.monotonicMs+=400000;await reopened.command('timerHostResume',{});
  assert.equal((await f.read(reopened,receipt.resourceId!)).pendingExpiries.length,1);assert.equal(f.count('timer_delivery_receipts'),0);
  assert.ok(f.events.some(event=>event.type==='clock_timer.expired'));assert.equal(f.count('timer_documents'),1);
});

test('actual Vela receipt save failure rolls back timer mutation and expiry while preserving the previous native wake',async t=>{
  const f=fixture(t);await f.core.command('desktop',{type:'createWorkspace',title:'Synthetic rollback workspace',projectId:null});
  const created=await f.core.command('velaRouteNative',{intent:'Set a bread timer for ten seconds'});assert.ok(created.matched);
  const state=await velaState(f.core),old=state.receipts.find(value=>value.requestId===created.request.id)!.clockTimer!;
  const receipts=f.count('timer_receipts'),events=f.events.filter(event=>event.type.startsWith('clock_timer.')).length;
  f.clock.epochMs+=1000;f.clock.monotonicMs+=1000;
  f.db().exec(`CREATE TRIGGER synthetic_reject_timer_receipt BEFORE UPDATE ON vela_state
    WHEN EXISTS(SELECT 1 FROM json_each(NEW.json,'$.receipts') WHERE json_extract(value,'$.state')='applied'
      AND json_extract(value,'$.clockTimer.operation')='mutate' AND json_extract(value,'$.clockTimer.resourceVersion')=3)
    BEGIN SELECT RAISE(ABORT,'synthetic_timer_receipt_failure'); END;`);
  const failed=await f.core.command('velaRouteNative',{intent:'Shorten my bread timer by 9900 milliseconds'});assert.ok(failed.matched);
  assert.equal(failed.request.state,'unknown');const document=await f.read(f.core,old.resourceId!);
  assert.equal(document.resource.version,2);assert.equal(document.timers[0].state,'running');assert.equal(document.timers[0].remainingMs,9000);
  assert.equal(document.timers[0].id,old.timerId);assert.equal(f.count('timer_expiries'),0);assert.equal(f.count('timer_receipts'),receipts);
  assert.equal(f.events.filter(event=>event.type.startsWith('clock_timer.')).length,events);assert.equal((f.core as any).timerDomain.status().scheduled,true);
  assert.equal(f.count('timer_documents'),1);assert.equal(f.count('blocks'),1);assert.equal(f.count('notes'),0);
});

test('active-card hints resolve the current canonical placement/settings and stale hints cannot select a different timer',async t=>{
  const f=fixture(t),desktop=await f.core.command('desktop',{type:'createWorkspace',title:'Synthetic focus workspace',projectId:null});
  await f.core.command('velaRouteNative',{intent:'Set a bread timer for fifteen minutes'});await f.core.command('velaRouteNative',{intent:'Set a laundry timer for ten minutes'});
  const state=await velaState(f.core),first=state.receipts.find(value=>value.clockTimer?.operation==='create')!.clockTimer!;
  const resourceId=first.resourceId!,document=await f.read(f.core,resourceId),bread=document.timers.find(timer=>timer.name==='bread')!,laundry=document.timers.find(timer=>timer.name==='laundry')!;
  const settings=(await f.core.command('library',{name:'getBlockSettings',input:first.blockId!})).result as BlockInstanceSettings;
  await f.core.command('library',{name:'configureBlock',input:{placementId:first.blockId!,expectedVersion:settings.version,
    configuration:{...settings.configuration,clockTimer:{mode:'timer',selectedTimerId:bread.id}}}});
  const focused=await f.core.command('velaRouteNative',{intent:'Please pause this timer',activeCard:{workspaceId:desktop.activeWorkspaceId!,blockId:first.blockId!}});
  assert.ok(focused.matched);assert.equal(focused.request.state,'completed');const current=await f.read(f.core,resourceId);
  assert.equal(current.timers.find(timer=>timer.id===bread.id)!.state,'paused');assert.equal(current.timers.find(timer=>timer.id===laundry.id)!.state,'running');
  await f.core.command('desktop',{type:'createWorkspace',title:'New active workspace',projectId:null});
  const stale=await f.core.command('velaRouteNative',{intent:'Reset this timer',activeCard:{workspaceId:desktop.activeWorkspaceId!,blockId:first.blockId!}});
  assert.ok(stale.matched);assert.equal(stale.request.response?.kind,'clarification');assert.equal((await f.read(f.core,resourceId)).timers.find(timer=>timer.id===bread.id)!.state,'paused');
  assert.equal(f.count('timer_documents'),1);assert.equal(f.count('blocks'),1);
});
