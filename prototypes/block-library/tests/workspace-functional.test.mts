import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareFunctionalWorkspaceNative } from '../prepare-functional-workspace-native.mts';
import { BackendCore } from '../../integrated-backend/src/core.mts';
import { NoteSession } from '../note-session.ts';
import type { NoteDocument } from '../note-contracts.ts';
import type { CreatedBlock, ProjectOverview } from '../contracts.ts';
import type { Detail, ConversationDraft } from '../../conversation-product/src/contracts.ts';
const require = createRequire(import.meta.url), helper = require('./workspace-functional.cjs'), { preflight, expressions: x } = require('./workspace-functional-expressions.cjs');

test('combined workspace factories compile every added/inherited expression and helpers use genuine guarded native input', () => {
  const p = preflight(); assert.equal(p.factories, 7); assert.equal(p.cases, 7); assert.deepEqual(p, preflight());
  assert.deepEqual(p.common, require('./workspace-approach-expressions.cjs').preflight());
  const source = readFileSync(new URL('./workspace-functional.cjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:js|wait)\(\s*['"`]/);
  assert.doesNotMatch(source, /\.dispatchEvent\(|\.click\(\)|\.focus\(\)|\.value\s*=/);
  assert.match(source, /driver\.js\(compileExpression\(code\)\)/);
  assert.doesNotMatch(source, /x\.host\(['"](?:execute|createConversation|authorizeConversationSend|conversationSend|connect|capabilities)['"]/);
  assert.match(readFileSync(new URL('./workspace-native.cjs', import.meta.url), 'utf8'), /includes\('--verify-functional-workspace'\)/);
});

test('functional Note observations distinguish canonical save from separate recovery and group observations require the exact member ID', async () => {
  const doc = { resource: { content: 'Canonical' }, draft: { content: 'Separate recovery' } };
  const context = { window: { aerynthHost: { command: async () => ({ result: doc }) }, __aerynth: { application: () => ({ resources: [{ id: 'group', taskMembers: [{ id: 'member' }] }] }) } } };
  assert.equal(await runInNewContext(x.noteSavedIs('note', 'Separate recovery'), context), false);
  assert.equal(runInNewContext(x.groupHas('group', 'member'), context), true);
  assert.equal(runInNewContext(x.groupHas('group', 'another'), context), false);
});

test('normal comparison requires visible viewport/footer/Vela bounds, content/fonts, canonical rendered rest and coordinator settlement without new scheduling', () => {
  const variants = { local: 'chat', codex: 'execution', note: 'document', group: 'checklist', stream: 'timeline', project: 'project' };
  const input = { cards: Object.entries(variants).map(([role, variant], index) => ({ role, id: role, variant, x: 81 + index % 3 * 414, y: 198 + Math.floor(index / 3) * 378, width: 360, height: 306 })), vela: { x: 1296, y: 207, width: 187.2, height: 234 } };
  const node = (bounds: object) => ({ bounds, style: { display: 'block', visibility: 'visible', opacity: '1' }, getBoundingClientRect() { return this.bounds; } });
  const nodes: Record<string, any> = {}, snapshot: any = { expanded: null, receipts: [], poses: {} };
  for (const card of input.cards) {
    const compact = { busy: 'false', getAttribute() { return this.busy; } }, body = { textContent: 'Actual authorized canonical projection' };
    nodes['[data-block=' + JSON.stringify(card.id) + ']'] = { ...node({ ...card }), dataset: { blockVariant: card.variant, resourceAvailability: 'available', blockComposition: 'working' }, compact, body, querySelector(selector: string) { return selector === '.aw-block-compact' ? compact : selector === '.aw-identity-body' ? body : null; } };
    snapshot.poses[card.id] = { x: card.x, y: card.y, w: card.width, h: card.height, lift: 0, yaw: 0, opacity: 1 };
    snapshot.receipts.push({ resource: card.id, status: 'settled' });
  }
  nodes['#vela'] = node({ ...input.vela }); nodes['.dock'] = node({ x: 400, y: 904, width: 800, height: 48 }); nodes['#stage'] = node({ x: 0, y: 0, width: 1600, height: 1000 });
  nodes['#status'] = node({ x: 600, y: 80, width: 400, height: 28 });
  const window = { innerWidth: 1600, innerHeight: 1000, devicePixelRatio: 1.25, __aerynth: { snapshot: () => snapshot } };
  let overlay = false;
  const document = { hidden: false, hasFocus: () => true, fonts: { status: 'loaded' }, querySelector: (selector: string) => selector.startsWith('.folio.expanded,') ? overlay ? {} : null : nodes[selector] ?? null };
  const context = { window, document, getComputedStyle: (value: any) => value.style };
  const probe = () => runInNewContext(x.comparisonProbe(input), context);
  assert.equal(probe().ready, true); assert.equal(runInNewContext(x.comparisonReady(input), context), true);
  window.innerWidth = 1450; assert.equal(probe().ready, false); assert.ok(probe().problems.includes('reference-window-too-small')); window.innerWidth = 1600;
  nodes['.dock'].bounds.y = 870; assert.ok(probe().problems.includes('group:clipped')); nodes['.dock'].bounds.y = 904;
  snapshot.receipts.push({ resource: 'local', status: 'retargeted' }); assert.ok(probe().problems.includes('local:unsettled')); snapshot.receipts.pop();
  snapshot.receipts.push({ resource: 'application:arrival', status: 'started' }); assert.ok(probe().problems.includes('workspace-arrival-unsettled')); snapshot.receipts.pop();
  nodes['#stage'].style.opacity = '0.5'; assert.ok(probe().problems.includes('workspace-arrival-unsettled')); nodes['#stage'].style.opacity = '1';
  snapshot.poses.note.y += 2; assert.ok(probe().problems.includes('note:unsettled')); snapshot.poses.note.y -= 2;
  nodes['[data-block="note"]'].compact.busy = 'true'; assert.ok(probe().problems.includes('note:content-not-ready')); nodes['[data-block="note"]'].compact.busy = 'false';
  nodes['#vela'].bounds.x = 1200; assert.ok(probe().problems.includes('note:overlaps-vela')); nodes['#vela'].bounds.x = input.vela.x;
  document.fonts.status = 'loading'; assert.ok(probe().problems.includes('fonts-loading')); document.fonts.status = 'loaded';
  overlay = true; assert.ok(probe().problems.includes('expanded-or-overlay')); overlay = false;
  assert.equal(probe().ready, true);
});

test('combined fixture and equivalent canonical operations preserve exact cross-block identities, unrelated recovery, project/task events and process reopen without a provider', async t => {
  const profile = join(tmpdir(), 'review-workspace-native-functional-source-' + randomUUID()), seed = await prepareFunctionalWorkspaceNative(profile), roles = helper.fixture(seed);
  assert.equal(seed.expected.blocks.length, 6); assert.equal(seed.expected.workspaces.length, 2); assert.equal(seed.expected.resources.length, 6);
  assert.equal(seed.validation.preflightSha256, preflight().sha256);
  const options = { path: join(profile, 'aerynth.sqlite'), privateRoot: profile, provider: 'codex' as const, contentPolicy: 'local-private' as const };
  let core = new BackendCore(options), open = true;
  t.after(async () => { if (open) await core.command('close', {}); });
  const read = async (id: string) => (await core.command('notes', { name: 'readNote', input: id })).result as NoteDocument;
  const draft = async (id: string) => await core.command('conversation', { name: 'readDraft', input: { resourceId: id } }) as ConversationDraft;
  const snapshot = () => core.command('desktop', { type: 'snapshot' });
  helper.assertNoProviderExecution(await core.command('snapshot', {}));
  helper.assertBasePlacements(await snapshot(), seed);
  const note = new NoteSession(roles.note.resourceId, {
    readNote: () => read(roles.note.resourceId),
    saveNoteDraft: async input => (await core.command('notes', { name: 'saveNoteDraft', input })).result as any,
    commitNote: async input => (await core.command('notes', { name: 'commitNote', input })).result as NoteDocument,
    discardNoteDraft: async input => (await core.command('notes', { name: 'discardNoteDraft', input })).result as NoteDocument,
  }, seed.documents[roles.note.resourceId].resource);
  await note.flushEdits(); assert.deepEqual(await read(roles.note.resourceId), seed.documents[roles.note.resourceId], 'Automatic flush retains the untouched prepared recovery');
  await note.flush(); assert.equal((await read(roles.note.resourceId)).draft, null);
  assert.equal((await read(roles.note.resourceId)).resource.content, seed.documents[roles.note.resourceId].draft!.content);
  await note.edit(seed.labels.noteText); await note.flushEdits();
  const localBefore = seed.expected.resources.find(resource => resource.id === roles.local.resourceId)!;
  await core.command('conversation', { name: 'send', input: { resourceId: roles.local.resourceId, content: seed.labels.message, expectedRevision: localBefore.conversationRevision!, commandId: randomUUID() } });
  await core.command('conversation', { name: 'saveDraft', input: { resourceId: roles.local.resourceId, expectedVersion: seed.drafts[roles.local.resourceId].version, content: seed.labels.localDraft } });
  let desktop = await snapshot();
  const create = await core.command('library', { name: 'createBlock', input: { commandId: randomUUID(), workspaceId: seed.workspaceId, expectedLayoutVersion: desktop.layoutVersion, kind: 'task', title: seed.labels.nativeTask } });
  const created = create.result as CreatedBlock; desktop = create.desktop!;
  const task = { resourceId: created.resourceId, blockId: created.placementId, createdResource: desktop.resources.find(resource => resource.id === created.resourceId)!, createdBlock: desktop.blocks.find(block => block.id === created.placementId)! };
  desktop = await core.command('desktop', { type: 'setTaskGroupMembers', groupId: roles.group.resourceId, expectedVersion: desktop.resources.find(resource => resource.id === roles.group.resourceId)!.version, taskIds: [task.resourceId] });
  desktop = await core.command('desktop', { type: 'taskStatus', resourceId: task.resourceId, expectedVersion: desktop.resources.find(resource => resource.id === task.resourceId)!.version, status: 'done' });
  const detail = await core.command('conversation', { name: 'detail', input: { resourceId: roles.local.resourceId, limit: 50 } }) as Detail;
  helper.assertCompleted(desktop, seed, task, detail.messages.items[0]);
  assert.deepEqual(await read(seed.recoveryTaskId), seed.documents[seed.recoveryTaskId]); assert.deepEqual(await draft(roles.codex.resourceId), seed.drafts[roles.codex.resourceId]);
  const overview = (await core.command('library', { name: 'projectOverview', input: seed.projectId })).result as ProjectOverview;
  assert.deepEqual(overview.tasks, { open: 0, done: 1 });
  const replay = await core.command('replay', { after: seed.baselineEventCursor, limit: 250 }), event = replay.events.find(event => event.type === 'application/taskStatus');
  assert.ok(event); assert.equal(event.classification, 'observed'); assert.equal(event.resourceId, null, 'Do not invent per-resource attribution absent from the canonical application event'); assert.equal(event.executionId, null);
  const canonical = { projects: desktop.projects, workspaces: desktop.workspaces, resources: desktop.resources, relationships: desktop.relationships };
  const documents = await Promise.all([read(roles.note.resourceId), read(seed.recoveryTaskId)]), drafts = await Promise.all([draft(roles.local.resourceId), draft(roles.codex.resourceId)]);
  await core.command('close', {}); open = false; core = new BackendCore(options); open = true;
  const restored = await snapshot(); helper.assertCompleted(restored, seed, task, detail.messages.items[0]);
  assert.deepEqual({ projects: restored.projects, workspaces: restored.workspaces, resources: restored.resources, relationships: restored.relationships }, canonical);
  assert.deepEqual(await Promise.all([read(roles.note.resourceId), read(seed.recoveryTaskId)]), documents);
  assert.deepEqual(await Promise.all([draft(roles.local.resourceId), draft(roles.codex.resourceId)]), drafts);
  assert.deepEqual((await core.command('replay', { after: seed.baselineEventCursor, limit: 250 })).events.find(value => value.eventId === event.eventId), event);
  helper.assertNoProviderExecution(await core.command('snapshot', {}));
  const mutated = structuredClone(restored); mutated.blocks[0].width++; assert.throws(() => helper.assertCompleted(mutated, seed, task, detail.messages.items[0]));
  const wrongCodex = structuredClone(seed); wrongCodex.placements.codex.resourceId = roles.local.resourceId; assert.throws(() => helper.fixture(wrongCodex));
  const bytes = readFileSync(join(profile, 'workspace-functional-seed.json')); await assert.rejects(prepareFunctionalWorkspaceNative(profile), /existing_profiles_must_be_preserved/); assert.deepEqual(readFileSync(join(profile, 'workspace-functional-seed.json')), bytes);
});

for (const rejection of ['startup', 'consumed', 'started'] as const) test('functional ' + rejection + ' rejection happens before JS/native input and releases listeners', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'review-workspace-native-functional-rejection-'));
  if (rejection === 'consumed') writeFileSync(join(profile, 'workspace-functional-expected.json'), '{"cpuOnlyMarker":true}', { flag: 'wx' });
  if (rejection === 'started') writeFileSync(join(profile, 'workspace-functional-initial-started.json'), '{"cpuOnlyMarker":true}', { flag: 'wx' });
  const argv = process.argv; process.argv = [...argv, '--verify-functional-workspace', '--verification-deadline-ms=30000'];
  const contents: any = new EventEmitter(); contents.isDestroyed = () => false;
  const forbidden = () => { throw Error('No native operation on rejected profile'); };
  for (const name of ['executeJavaScript', 'sendInputEvent', 'capturePage', 'insertText']) contents[name] = forbidden;
  const win = { isDestroyed: () => false, isVisible: () => true, isMinimized: () => false, isFocused: () => true, focus: forbidden, webContents: contents }; let exit = -1;
  try {
    const receipt = await require('./workspace-native.cjs').verify({ win, app: { exit(code: number) { exit = code; } }, privateRoot: profile, source: {}, moduleStarted: Date.now(), startupErrors: rejection === 'startup' ? ['Synthetic startup error'] : [] });
    assert.equal(receipt.passed, false); assert.equal(receipt.journeyBComplete, false); assert.equal(exit, 1); assert.equal(receipt.actions.length + receipt.screenshots.length, 0);
    assert.match(receipt.error, rejection === 'startup' ? /Observed startup/ : /consumed_initial_profile_must_be_preserved/);
    assert.equal(contents.listenerCount('console-message') + contents.listenerCount('before-input-event'), 0);
    if (rejection === 'consumed') assert.deepEqual(JSON.parse(readFileSync(join(profile, 'workspace-functional-expected.json'), 'utf8')), { cpuOnlyMarker: true });
    if (rejection === 'started') assert.deepEqual(JSON.parse(readFileSync(join(profile, 'workspace-functional-initial-started.json'), 'utf8')), { cpuOnlyMarker: true });
  } finally { process.argv = argv; }
});
