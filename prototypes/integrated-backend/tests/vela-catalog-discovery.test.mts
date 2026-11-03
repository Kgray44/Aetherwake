import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, resolve, relative, isAbsolute } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { BackendCore } from '../src/core.mts';
import type { ProviderPort, StreamEvent, VelaBackendState, VelaOperation } from '../src/contracts.mts';
import type { EventEnvelope } from '../../codex-bridge/src/adapter.ts';

/** Real Core/SQLite, explicit synthetic stdio process only: no native Codex/model/account connection. */
function fixture(mode = 'normal', enabled = true) {
  const dir = mkdtempSync(join(tmpdir(), 'aerynth-catalog-discovery-')),
    path = join(dir, 'canonical.sqlite');
  const options = {
    path,
    provider: 'codex' as const,
    contentPolicy: 'synthetic-only' as const,
    codexExecutable: process.execPath,
    codexArgs: [fileURLToPath(new URL('../../codex-bridge/tests/catalog-server.mjs', import.meta.url)), mode],
    velaCatalogDiscovery: enabled,
  };
  const presented: StreamEvent[] = [];
  const create = () => new BackendCore(options, event => presented.push(event));
  let core = create();
  const events: EventEnvelope[] = [];
  const port = () => (core as unknown as { port: ProviderPort }).port;
  port().onEvent((event) => events.push(event));
  const vela = (name: VelaOperation['name'], input: unknown = {}) => core.command('vela', { name, input } as VelaOperation);
  const state = () => vela('state') as Promise<VelaBackendState>;
  const granted = async (resourceIds: string[] = [], intent = 'Synthetic protocol request to propose one folder.') => {
    await core.command('capabilities', {});
    const preview = await core.command('velaRequestPreview', { intent, resourceIds }),
      grant = await core.command('authorizeVelaRequest', { previewId: preview.id, signature: preview.signature });
    return { preview, input: { intent: preview.intent, resourceIds, authorizeProvider: true, previewId: preview.id, grantId: grant.grantId } };
  };
  return {
    get core() {
      return core;
    },
    port,
    events,
    presented,
    vela,
    state,
    granted,
    leases: () => (core as unknown as { velaCatalogLeases: Map<string, unknown> }).velaCatalogLeases.size,
    db: () => (core as unknown as { db: DatabaseSync }).db,
    async reopen() {
      await core.command('close', {});
      core = create();
      port().onEvent((event) => events.push(event));
    },
    async close() {
      await core.command('close', {});
      const target = resolve(dir),
        part = relative(resolve(tmpdir()), target);
      assert(part.startsWith('aerynth-catalog-discovery-') && !part.startsWith('..') && !isAbsolute(part));
      rmSync(target, { recursive: true, force: true });
    },
  };
}

test('a model-selected search opens canonical results, persists references only, and rechecks visibility after switching scope', async () => {
  const f = fixture('search');
  try {
    const project = (await f.core.command('desktop', { type: 'createProject', title: 'Synthetic instruments' })).projects[0];
    const workspace = (await f.core.command('desktop', {
      type: 'createWorkspace', title: 'Synthetic workshop', projectId: project.id,
    })).activeWorkspaceId!;
    const title = 'Synthetic calibration measurements';
    const seeded = await f.core.command('desktop', { type: 'createResource', kind: 'note', title, workspaceId: workspace });
    const resource = seeded.resources.find(item => item.title === title)!;
    assert.equal(resource.project_id, project.id);

    const { preview, input } = await f.granted([], 'Where did I put the data from calibrating the instrument?');
    assert.equal(preview.context.contentBytes, 0);
    assert(!JSON.stringify(preview.context).includes(resource.id));
    const request = await f.vela('request', input) as { id: string; planId: string; state: string };
    assert.equal(request.state, 'completed');
    const state = await f.state();
    const receipt = state.receipts.find(value => value.requestId === request.id)!;
    assert.equal(receipt.state, 'applied');
    assert.equal(receipt.providerId, null);
    assert.equal(state.plans.find(plan => plan.id === request.planId)?.steps[0].action.type, 'search');
    assert.deepEqual(state.searchResults?.[receipt.id].map(ref => [ref.id, ref.title]), [[resource.id, title]]);
    assert(!state.conversation?.messages.some(message => message.content.includes(title)));
    const saved = f.db().prepare('SELECT json FROM vela_state').get()!;
    assert.deepEqual(JSON.parse(String(saved.json)).receipts[0].foundSubjects, [{ id: resource.id, kind: 'resource' }]);
    assert(!String(saved.json).includes(title));
    assert.equal(f.events.filter(event => event.method === 'fixture/catalogResult' && event.payload.success === true).length, 1);
    assert.equal(Object.keys((await f.core.command('snapshot', {})).executions).length, 1);

    await f.reopen();
    assert.equal((await f.state()).searchResults?.[receipt.id][0].id, resource.id);
    const other = (await f.core.command('desktop', { type: 'createProject', title: 'Synthetic other scope' })).projects.find(item => item.id !== project.id)!;
    await f.core.command('desktop', { type: 'createWorkspace', title: 'Synthetic other workspace', projectId: other.id });
    const otherState = await f.state();
    assert.deepEqual(otherState.searchResults?.[receipt.id], []);
    assert(!JSON.stringify(otherState.searchResults).includes(resource.id));
    assert.equal(f.leases(), 0);
  } finally { await f.close(); }
});

for (const discovery of [false, true])
test(`reviewed Vela text reaches the model adapter and arranges the exact active workspace with canonical undo (schema discovery: ${discovery})`, async () => {
  const f = fixture('layout', discovery);
  try {
    const project = (await f.core.command('desktop', { type: 'createProject', title: 'Synthetic project' })).projects[0];
    const createWorkspace = async () => (await f.core.command('desktop', {
      type: 'createWorkspace', title: 'Synthetic studio', projectId: project.id,
    })).activeWorkspaceId!;
    const otherId = await createWorkspace();
    const workspaceId = await createWorkspace();
    assert.notEqual(workspaceId, otherId);
    const first = await f.core.command('desktop', { type: 'createResource', kind: 'note', title: 'Synthetic draft', workspaceId });
    const note = first.resources.find(resource => resource.title === 'Synthetic draft')!;
    const content = 'Synthetic text survives rearrangement.';
    await f.core.command('desktop', { type: 'content', resourceId: note.id, expectedVersion: note.version, content });
    await f.core.command('desktop', { type: 'createResource', kind: 'task', title: 'Synthetic build', workspaceId });
    const baseline = await f.core.command('desktop', { type: 'snapshot' });

    const { preview, input } = await f.granted([], discovery ? 'Can you organize my workspace?' : 'These cards could use a tidier arrangement.');
    assert.deepEqual(preview.context.activeSurface, { projectId: project.id, workspaceId });
    assert.equal(preview.context.contentBytes, 0);
    const request = await f.vela('request', input) as { id: string; planId: string; state: string };
    assert.equal(request.state, 'awaiting-review');
    const proposed = await f.state();
    const plan = proposed.plans.find(item => item.id === request.planId)!;
    assert.deepEqual(plan.steps[0].action, { type: 'applyStructuredPreset', workspaceId, preset: 'balanced' });
    const previewDeltas = f.presented.filter(event => typeof event.payload.delta === 'string');
    assert.deepEqual(previewDeltas.map(event => event.payload.delta), ['Checking the workspace.']);
    const snapshot = await f.core.command('snapshot', {});
    const execution = Object.values(snapshot.executions)[0];
    assert.equal(previewDeltas[0].turnId, execution.turnId);
    const replay = await f.core.command('replay', { after: 0, limit: 250 });
    const recorded = replay.events.find(event => event.cursor === previewDeltas[0].cursor);
    assert.equal(recorded?.eventId, previewDeltas[0].eventId);
    assert.equal(recorded?.payload.delta, undefined);
    const messages = snapshot.graph.messages.filter(message => message.conversationId === snapshot.resourceMap[execution.resourceId]);
    const replies = messages.filter(message => message.role === 'assistant');
    assert.equal(replies.length, 1);
    assert.equal(JSON.parse(replies[0].content).summary, 'Synthetic arrangement proposal.');
    assert.equal(proposed.receipts.length, 0);
    assert.equal((await f.core.command('desktop', { type: 'snapshot' })).layoutVersion, baseline.layoutVersion);
    assert.equal(f.events.filter(event => event.method === 'fixture/catalogResult' && event.payload.success === true).length, discovery ? 1 : 0);

    await f.vela('review', { planId: plan.id, fingerprint: plan.fingerprint, decision: 'approve' });
    const applied = await f.vela('apply', plan.id) as { state: string };
    assert.equal(applied.state, 'applied');
    const arranged = await f.core.command('desktop', { type: 'snapshot' });
    const geometry = (value: typeof baseline) => value.blocks.map(block => [block.id, block.resource_id, block.x, block.y, block.width, block.height]);
    assert.equal(arranged.organization?.mode, 'structured');
    assert.notDeepEqual(geometry(arranged), geometry(baseline));
    assert.deepEqual(arranged.blocks.map(block => [block.id, block.resource_id]), baseline.blocks.map(block => [block.id, block.resource_id]));
    assert.equal(arranged.resources.find(resource => resource.id === note.id)?.content, content);
    assert.equal((await f.state()).receipts.find(receipt => receipt.requestId === request.id)?.state, 'applied');

    await f.reopen();
    const restored = await f.core.command('desktop', { type: 'snapshot' });
    assert.deepEqual(geometry(restored), geometry(arranged));
    assert.equal(restored.resources.find(resource => resource.id === note.id)?.content, content);
    const undone = await f.core.command('desktop', { type: 'undo' });
    assert.deepEqual(geometry(undone), geometry(baseline));
    assert.equal(undone.organization?.mode, baseline.organization?.mode);
  } finally { await f.close(); }
});

test('the native planning adapter executes a single typed clock read after the synthetic protocol turn completes', async () => {
  const f = fixture('clock');
  try {
    const { input } = await f.granted([], 'What time is it?');
    const request = await f.vela('request', input) as { id: string; state: string };
    assert.equal(request.state, 'completed');
    const state = await f.state();
    const observed = state.conversation!.messages.find(message => message.requestId === request.id && message.source === 'vela-native');
    assert.match(observed?.content ?? '', /It.s \d{1,2}:\d{2}/u);
    assert.equal(observed?.providerId, undefined);
    assert.equal(state.receipts.find(receipt => receipt.requestId === request.id)?.state, 'applied');
    assert.equal(f.events.filter(event => event.method === 'fixture/catalogResult' && event.payload.success === true).length, 1);
    assert.equal(Object.keys((await f.core.command('snapshot', {})).executions).length, 1);
  } finally { await f.close(); }
});

test('same authorized protocol turn discovers exact schemas from a frozen resource manifest, proposes without applying, and survives SQLite restart with no lease replay', async () => {
  const f = fixture('early-call');
  try {
    const snapshot = await f.core.command('desktop', { type: 'createResource', kind: 'note', title: 'Synthetic bounded context', workspaceId: null }),
      note = snapshot.resources[0];
    await f.core.command('desktop', { type: 'content', resourceId: note.id, expectedVersion: note.version, content: 'Synthetic reviewed note. '.repeat(150) });
    const authorization = await f.granted([note.id]);
    assert.equal(authorization.preview.discovery?.mode, 'same-turn-readonly');
    let selections = 0;
    const service = (f.core as any).vela,
      original = service.previewContext.bind(service);
    service.previewContext = (...args: unknown[]) => {
      selections++;
      return original(...args);
    };
    let toolContentReads = 0;
    const core = f.core as any,
      readCatalog = core.readVelaCatalog.bind(core);
    core.readVelaCatalog = async (...args: unknown[]) => {
      const read = core.velaHost.readContent;
      core.velaHost.readContent = () => {
        toolContentReads++;
        throw new Error('Catalog tools must not read resource content');
      };
      try {
        return await readCatalog(...args);
      } finally {
        core.velaHost.readContent = read;
      }
    };
    const request = (await f.vela('request', authorization.input)) as { state: string; planId?: string };
    assert.equal(request.state, 'awaiting-review');
    assert.equal(selections, 0, 'Reviewed context is never reselected after the initiating append');
    assert.equal(toolContentReads, 0);
    const state = await f.state(),
      plan = state.plans.find((item) => item.id === request.planId)!;
    assert.equal(plan.steps[0].action.type, 'createCollection');
    assert.equal(state.receipts.length, 0);
    assert.equal(f.db().prepare('SELECT count(*) AS count FROM collections').get()!.count, 0, 'Catalog tools cannot apply the proposal');
    const executions = Object.values((await f.core.command('snapshot', {})).executions);
    assert.equal(executions.length, 1);
    assert.equal(executions[0].state, 'provider_completed');
    assert.equal(executions[0].taskVerified, false);
    assert.equal(f.events.filter((e) => e.method === 'fixture/catalogResult' && e.payload.success === true).length, 1);
    assert.equal(f.leases(), 0);
    const start = f.events.find((e) => e.method === 'fixture/threadStart')!.payload;
    assert.equal(start.experimental, true);
    const params = start.params as Record<string, unknown>;
    assert.equal(params.sandbox, 'read-only');
    assert.equal(params.approvalPolicy, 'never');
    assert(!Object.hasOwn(params, 'baseInstructions'));
    assert(!Object.hasOwn(params, 'developerInstructions'));
    assert(Array.isArray(params.dynamicTools));
    await assert.rejects(f.vela('request', authorization.input), /native_vela_grant_(consumed|required)/);
    await f.reopen();
    assert.equal(f.leases(), 0);
    assert((await f.state()).plans.some((item) => item.id === plan.id));
    assert.equal(Object.values((await f.core.command('snapshot', {})).executions).length, 1);
  } finally {
    await f.close();
  }
});
test('default-off transport supplies the complete approved legacy catalog and leaves ordinary native thread parameters unchanged', async () => {
  const f = fixture('normal', false);
  try {
    const authorization = await f.granted();
    assert.equal(authorization.preview.discovery, undefined);
    assert.equal(((await f.vela('request', authorization.input)) as { state: string }).state, 'awaiting-review');
    const start = f.events.find((e) => e.method === 'fixture/threadStart')!.payload;
    assert.equal(start.experimental, false);
    assert(!Object.hasOwn(start.params as object, 'dynamicTools'));
    assert.equal(f.events.filter((e) => e.method === 'fixture/catalogResult').length, 0);
    assert.equal(f.leases(), 0);
  } finally {
    await f.close();
  }
});
test('enabled discovery does not register tools on ordinary Codex sessions, and ordinary Vela answers need no schema lookup', async () => {
  const f = fixture();
  try {
    await f.core.command('capabilities', {});
    const chat = await f.core.command('createConversation', {
      title: 'Synthetic ordinary Codex chat',
      providerId: 'codex-app-server',
      commandId: 'synthetic:ordinary:create',
    });
    const execution = await f.core.command('execute', {
      resourceId: chat.resourceId,
      prompt: 'Synthetic ordinary conversation input',
      commandId: 'synthetic:ordinary:execute',
      authorized: true,
      expectedRevision: chat.revision,
    });
    assert.equal(execution.state, 'provider_completed');
    assert(!Object.hasOwn(f.events.find((e) => e.method === 'fixture/threadStart')!.payload.params as object, 'dynamicTools'));
    assert.equal(f.leases(), 0);
  } finally {
    await f.close();
  }
  const g = fixture('answer');
  try {
    const authorization = await g.granted();
    assert.equal(((await g.vela('request', authorization.input)) as { state: string }).state, 'responded');
    assert.equal(g.events.filter((e) => e.method === 'fixture/catalogResult').length, 0);
    assert.equal(g.leases(), 0);
  } finally {
    await g.close();
  }
});
test('unknown, stale, other-turn and content-tool requests cannot discover schemas or validate an unfetched proposal', async () => {
  for (const mode of ['unknown-id', 'wrong-digest', 'wrong-turn', 'content-tool', 'no-fetch']) {
    const f = fixture(mode);
    try {
      const authorization = await f.granted(),
        request = (await f.vela('request', authorization.input)) as { state: string };
      assert.equal(request.state, 'failed', mode);
      assert.equal((await f.state()).plans.length, 0);
      assert.equal(f.events.filter((e) => e.method === 'fixture/catalogResult' && e.payload.success === true).length, 0);
      assert.equal(f.leases(), 0);
      assert.equal(f.db().prepare('SELECT count(*) AS count FROM collections').get()!.count, 0);
    } finally {
      await f.close();
    }
  }
});
test('catalog, source and policy revocation during a turn invalidates metadata authority; duplicate native calls remain exact', async () => {
  const f = fixture('duplicate');
  try {
    const authorization = await f.granted();
    assert.equal(((await f.vela('request', authorization.input)) as { state: string }).state, 'awaiting-review');
    assert.deepEqual(
      f.events.filter((e) => e.method === 'fixture/catalogResult').map((e) => e.payload.success),
      [true, true, false],
    );
  } finally {
    await f.close();
  }
  for (const kind of ['catalog', 'source', 'scope'] as const) {
    const g = fixture();
    try {
      const snapshot = await g.core.command('desktop', { type: 'createResource', kind: 'note', title: 'Synthetic revoke target', workspaceId: null }),
        note = snapshot.resources[0];
      const authorization = await g.granted([note.id]);
      g.port().onEvent((event) => {
        if (event.method === 'fixture/catalogReady') {
          if (kind === 'catalog')
            g.core.registerVelaNativeCapabilities({
              supportedActions: [],
              dispatch() {
                throw new Error('Disabled');
              },
            });
          else if (kind === 'source') g.db().prepare("UPDATE resources SET state='archived' WHERE id=?").run(note.id);
          else (g.core as any).velaScopeStamp = () => 'synthetic:revoked-policy';
        }
      });
      assert.equal(((await g.vela('request', authorization.input)) as { state: string }).state, 'failed', kind);
      assert.equal(g.events.filter((e) => e.method === 'fixture/catalogResult' && e.payload.success === true).length, 0);
      assert.equal(g.leases(), 0);
    } finally {
      await g.close();
    }
  }
});
test('cancellation, transport loss and unsupported experimental registration leave no tool authority or extra provider turn', async () => {
  const f = fixture('cancel');
  try {
    const authorization = await f.granted(),
      pending = f.vela('request', authorization.input);
    let requestId: string | undefined;
    for (let n = 0; n < 100; n++) {
      const state = await f.state();
      requestId = state.requests[0]?.id;
      if (requestId && f.events.some((e) => e.method === 'fixture/catalogResult')) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert(requestId);
    await f.vela('cancel', requestId);
    assert.equal(((await pending) as { state: string }).state, 'cancelled');
    assert.deepEqual(
      f.events.filter((event) => event.method === 'fixture/catalogResult').map((event) => event.payload.success),
      [true, false],
      'Cancellation removes metadata authority before native interruption is confirmed',
    );
    assert.equal(f.leases(), 0);
    assert.equal(f.events.filter((e) => e.method === 'fixture/threadStart').length, 1);
  } finally {
    await f.close();
  }
  for (const mode of ['transport-loss', 'unsupported']) {
    const g = fixture(mode);
    try {
      const authorization = await g.granted();
      const request = (await g.vela('request', authorization.input)) as { state: string };
      assert(['unknown', 'failed'].includes(request.state));
      assert.equal(g.leases(), 0);
      assert.equal(Object.values((await g.core.command('snapshot', {})).executions).length, 1);
      assert.equal((await g.state()).plans.length, 0);
    } finally {
      await g.close();
    }
  }
});
test('an execution lease expires independently of consumed consent and cannot continue metadata discovery', async () => {
  const f = fixture(),
    clock = Date.now;
  try {
    const authorization = await f.granted();
    f.port().onEvent((event) => {
      if (event.method === 'fixture/catalogReady') Date.now = () => clock() + 61000;
    });
    assert.equal(((await f.vela('request', authorization.input)) as { state: string }).state, 'failed');
    assert.equal(f.events.filter((event) => event.method === 'fixture/catalogResult' && event.payload.success === true).length, 0);
    assert.equal(f.leases(), 0);
  } finally {
    Date.now = clock;
    await f.close();
  }
});

test('native consent refuses a changed effective catalog; a rejected experimental feature only falls back under a new explicit grant', async () => {
  const f = fixture();
  try {
    await f.core.command('capabilities', {});
    const preview = await f.core.command('velaRequestPreview', { intent: 'Synthetic exact catalog consent', resourceIds: [] });
    f.core.registerVelaNativeCapabilities({
      supportedActions: [],
      dispatch() {
        throw new Error('Unavailable');
      },
    });
    await assert.rejects(
      f.core.command('authorizeVelaRequest', { previewId: preview.id, signature: preview.signature }),
      /stale_capability_catalog/,
    );
    assert.equal(Object.keys((await f.core.command('snapshot', {})).executions).length, 0);
  } finally {
    await f.close();
  }
  const g = fixture('unsupported');
  try {
    const first = await g.granted();
    assert.equal(((await g.vela('request', first.input)) as { state: string }).state, 'failed');
    assert.equal(g.port().catalogDiscovery?.available, false);
    assert.equal(g.events.filter((e) => e.method === 'fixture/threadStart').length, 0, 'No fallback or additional turn runs under the consumed grant');
    const second = await g.granted();
    assert.equal(second.preview.discovery, undefined);
    assert.equal(((await g.vela('request', second.input)) as { state: string }).state, 'awaiting-review');
    assert.equal(g.events.filter((e) => e.method === 'fixture/threadStart').length, 1);
    assert(!Object.hasOwn(g.events.find((e) => e.method === 'fixture/threadStart')!.payload.params as object, 'dynamicTools'));
  } finally {
    await g.close();
  }
});
