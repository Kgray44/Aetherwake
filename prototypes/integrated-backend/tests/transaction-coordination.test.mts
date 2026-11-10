import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { BackendCore } from '../src/core.mts';

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'aerynth-transaction-'));
  const path = join(dir, 'canonical.sqlite');
  const options = {path, provider: 'fixture', contentPolicy: 'synthetic-only'} as const;
  const delivered: string[] = [];
  let core: BackendCore | undefined;
  const open = () => core = new BackendCore(options, event => delivered.push(event.type));
  const close = async () => {
    if (!core) return;
    const closing = core;
    core = undefined;
    await closing.command('close', {});
  };
  t.after(async () => {
    try { await close(); }
    finally {
      const part = relative(resolve(tmpdir()), resolve(dir));
      assert(part.startsWith('aerynth-transaction-') && !isAbsolute(part));
      rmSync(dir, {recursive: true, force: true});
    }
  });
  return {core: open(), open, close, delivered, path};
}

test('desktop mutation and its event roll back together if the SQLite event insert fails', async t => {
  const {core, open, close, delivered} = fixture(t);
  const owner = core as any;
  const before = await core.command('snapshot', {});
  const replay = (await core.command('replay', {})).events;
  owner.db.exec(`
    CREATE TEMP TRIGGER a21_reject_observation BEFORE INSERT ON main.intelligence_events
    WHEN json_extract(NEW.json, '$.type') = 'application/createResource'
    BEGIN SELECT RAISE(ABORT, 'synthetic observation failure'); END
  `);
  await assert.rejects(core.command('desktop', {
    type: 'createResource', kind: 'conversation', provider: 'local',
    title: 'Synthetic aborted conversation', workspaceId: null,
  }), /synthetic observation failure/);
  assert.deepEqual(await core.command('snapshot', {}), before);
  assert.deepEqual((await core.command('replay', {})).events, replay);
  assert(!delivered.includes('application/createResource'));
  await close();
  const reopened = open();
  assert.deepEqual(await reopened.command('snapshot', {}), before);
  assert(!(await reopened.command('replay', {})).events.some(event => event.type === 'application/createResource'));
});

test('outer RELEASE failure restores graph, resource, writer fence and pending event before retry', async t => {
  const {core, open, close, delivered} = fixture(t);
  const owner = core as any;
  const {resourceId} = await core.command('createConversation', {
    title: 'Synthetic release check', providerId: 'local', commandId: 'synthetic-release-chat',
  });
  const readJson = () => owner.db.prepare('SELECT json FROM integration_state WHERE id=1').get().json;
  const baseline = readJson();
  const eventType = 'vela.synthetic.release';
  owner.db.exec(`
    CREATE TEMP TABLE a21_parent(id INTEGER PRIMARY KEY);
    CREATE TEMP TABLE a21_child(id INTEGER REFERENCES a21_parent(id) DEFERRABLE INITIALLY DEFERRED);
    CREATE TEMP TRIGGER a21_reject_release AFTER UPDATE ON main.integration_state
    BEGIN INSERT INTO a21_child VALUES(1); END
  `);
  let stagedResource: string | undefined;
  const mutate = () => owner.atomic(() => {
    stagedResource = owner.kernel.createGenericResource('Synthetic release resource').id;
    owner.graph.addMessage(owner.gid(resourceId), 'user', 'Synthetic release message');
    owner.state.revisions[resourceId]++;
    owner.record(eventType, 'observed', undefined, eventType);
    assert(!delivered.includes(eventType));
  });
  assert.throws(mutate, /FOREIGN KEY constraint failed/);
  assert.equal(readJson(), baseline);
  assert.equal(owner.storedJson, baseline);
  assert.equal(owner.state.revisions[resourceId], 1);
  assert.equal((await core.command('snapshot', {})).graph.messages.length, 0);
  assert.equal(owner.db.prepare('SELECT id FROM resources WHERE id=?').get(stagedResource), undefined);
  assert(!delivered.includes(eventType));
  assert(!(await core.command('replay', {})).events.some(event => event.type === eventType));
  owner.db.exec('DROP TRIGGER a21_reject_release');
  mutate();
  assert.equal(delivered.filter(type => type === eventType).length, 1);
  await close();
  const restored = open();
  const snapshot = await restored.command('snapshot', {});
  assert.equal(snapshot.conversations.find(item => item.resourceId === resourceId)?.revision, 2);
  assert.deepEqual(snapshot.graph.messages.map(message => message.content), ['Synthetic release message']);
  assert.equal((await restored.command('replay', {})).events.filter(event => event.type === eventType).length, 1);
});

test('nested save and rollback preserve live graph and its prior persisted projection independently', async t => {
  const {core} = fixture(t);
  const owner = core as any;
  const {resourceId} = await core.command('createConversation', {
    title: 'Synthetic nested check', providerId: 'local', commandId: 'synthetic-nested-chat',
  });
  const content = (graph: {messages: {content: string}[]}) => graph.messages.map(message => message.content);
  const append = (message: string) => {
    owner.graph.addMessage(owner.gid(resourceId), 'user', message);
    owner.state.revisions[resourceId]++;
  };
  const original = await core.command('snapshot', {});
  assert.throws(() => owner.atomic(() => {
    append('Unsaved outer graph');
    assert.throws(() => owner.atomic(() => {
      append('Rolled back inner graph');
      throw Error('inner rollback');
    }), /inner rollback/);
    assert.deepEqual(content(owner.graph.snapshot()), ['Unsaved outer graph']);
    assert.deepEqual(content(owner.state.graph), []);
    owner.atomic(() => append('Released inner graph'));
    assert.deepEqual(content(owner.state.graph), ['Unsaved outer graph', 'Released inner graph']);
    throw Error('outer rollback');
  }), /outer rollback/);
  assert.deepEqual(await core.command('snapshot', {}), original);
  assert.deepEqual(content(owner.state.graph), []);
});

test('serialization and the UTF-8 snapshot ceiling reject changes without durable rows or delivery', async t => {
  const {core, delivered} = fixture(t);
  const owner = core as any;
  const {resourceId} = await core.command('createConversation', {
    title: 'Synthetic snapshot ceiling', providerId: 'local', commandId: 'synthetic-limit-chat',
  });
  const count = () => Number(owner.db.prepare('SELECT count(*) AS count FROM resources').get().count);
  const before = count();
  const eventType = 'vela.synthetic.oversize';
  function stage() {
    owner.kernel.createGenericResource('Synthetic abandoned resource');
    owner.record(eventType, 'observed', undefined, eventType);
  }
  assert.throws(() => owner.atomic(() => {
    stage();
    const cycle: {self?: unknown} = {};
    cycle.self = cycle;
    owner.state.receipts.synthetic = cycle;
  }), /circular structure/i);
  assert.throws(() => owner.atomic(() => {
    stage();
    const content = 'é'.repeat(32768);
    for (let i = 0; i < 128; i++) owner.graph.addMessage(owner.gid(resourceId), 'user', content);
  }), /state_capacity_reached/);
  assert.equal(count(), before);
  assert.equal((await core.command('snapshot', {})).graph.messages.length, 0);
  assert(!delivered.includes(eventType));
  assert(!(await core.command('replay', {})).events.some(event => event.type === eventType));
});

const interruptionProgram = `
  import { writeSync } from 'node:fs';
  import { BackendCore } from ${JSON.stringify(new URL('../src/core.mts', import.meta.url).href)};
  const [path, phase] = process.argv.slice(1);
  const type = 'vela.synthetic.interruption';
  function interrupt() {
    writeSync(1, phase + '\\n');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  }
  const owner = new BackendCore({path, provider: 'fixture', contentPolicy: 'synthetic-only'}, event => {
    if (phase === 'after-release' && event.type === type) interrupt();
  });
  if (phase === 'before-release') {
    const save = owner.save;
    owner.save = function () { save.call(this); interrupt(); };
  }
  owner.atomic(() => {
    owner.create('Synthetic interrupted conversation', 'local');
    owner.record(type, 'observed', undefined, type);
  });
`;

for (const phase of ['before-release', 'after-release']) {
  test('process interruption ' + phase + ' recovers only committed rows and cursors', async t => {
    const {core: contender, path, close, open} = fixture(t);
    if (phase === 'after-release') await close();
    const child = spawn(process.execPath, ['--input-type=module', '--eval', interruptionProgram, path, phase],
      {stdio: ['ignore', 'pipe', 'pipe']});
    const exited = once(child, 'exit');
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', text => { stderr += text; });
    try {
      const observed = await Promise.race([
        once(child.stdout, 'data', {signal: AbortSignal.timeout(10_000)}).then(([chunk]) => String(chunk).trim()),
        exited.then(([code, signal]) => 'child exited ' + (code ?? signal) + ': ' + stderr),
      ]);
      assert.equal(observed, phase);
      if (phase === 'before-release') {
        await assert.rejects(contender.command('workspace', {title: 'Synthetic blocked writer'}), /database is locked/i);
      }
    } finally {
      child.kill('SIGKILL');
      await exited;
    }
    await close();
    const restored = open();
    const snapshot = await restored.command('snapshot', {});
    const eventCount = (await restored.command('replay', {})).events.filter(event => event.type === 'vela.synthetic.interruption').length;
    const expected = phase === 'after-release' ? 1 : 0;
    assert.equal(snapshot.conversations.filter(item => item.title === 'Synthetic interrupted conversation').length, expected);
    assert.equal(eventCount, expected);
    const desktop = await restored.command('desktop', {type: 'snapshot'});
    assert(!desktop.workspaces.some(workspace => workspace.title === 'Synthetic blocked writer'));
  });
}

test('an unchanged local snapshot still checks the durable concurrent writer fence', async t => {
  const {core, path} = fixture(t);
  const second = new BackendCore({path, provider: 'fixture', contentPolicy: 'synthetic-only'});
  try {
    const stale = second as any;
    const before = stale.storedJson;
    const winner = await core.command('createConversation', {
      title: 'Synthetic winning writer', providerId: 'local', commandId: 'synthetic-writer-win',
    });
    assert.throws(() => stale.atomic(() => {}), /concurrent_backend_writer/);
    assert.equal(stale.storedJson, before);
    assert((await core.command('snapshot', {})).conversations.some(item => item.resourceId === winner.resourceId));
  } finally {
    await second.command('close', {});
  }
});

test('a failing post-commit publisher keeps the writer fence and delivers the rest of the batch', async t => {
  const {core, delivered} = fixture(t);
  const owner = core as any;
  const skipped = 'vela.synthetic.delivery-fault';
  const next = 'vela.synthetic.delivery-next';
  const publish = owner.publishRecordedEvent.bind(owner);
  owner.publishRecordedEvent = (event: {type: string}) => {
    if (event.type === skipped) throw Error('synthetic publication failure');
    publish(event);
  };
  const created = owner.atomic(() => {
    const conversation = owner.create('Synthetic committed conversation', 'local');
    owner.record(skipped, 'observed', undefined, skipped);
    owner.record(next, 'observed', undefined, next);
    return conversation;
  });
  assert(!delivered.includes(skipped));
  assert(delivered.includes(next));
  const replay = (await core.command('replay', {})).events.filter(event => [skipped, next].includes(event.type));
  assert.deepEqual(replay.map(event => event.type), [skipped, next]);
  const message = await core.command('addMessage', {
    resourceId: created.resourceId, content: 'Synthetic follow-up', expectedRevision: 1, role: 'user',
  });
  assert.equal(message.revision, 2);
});
