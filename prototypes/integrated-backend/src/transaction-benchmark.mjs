import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { arch, availableParallelism, cpus, platform, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { BackendCore } from './core.mts';
import { nativeMissionPlan } from './mission-native.mts';

const warmups = 4;
const samples = 24;
const allocationIntervalBytes = 32 * 1024;
const allocationSamples = 8;
const profiles = [
  ['almost-empty', 0, 0, 0, 0],
  ['small', 24, 256, 8, 24],
  ['moderate', 72, 1024, 40, 120],
  ['conversation-heavy', 512, 4096, 8, 24],
  ['workspace-heavy', 24, 256, 180, 120],
  ['event-heavy', 24, 256, 8, 512],
  ['near-snapshot-limit', 120, 58000, 40, 120],
];

function summarize(rows) {
  return Object.fromEntries(Object.keys(rows[0]).map(key => {
    const values = rows.map(row => row[key]).sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    return [key, {
      median: (values[middle] + values[Math.ceil(values.length / 2) - 1]) / 2,
      p95: values[Math.ceil(values.length * 0.95) - 1],
      max: values.at(-1),
    }];
  }));
}

async function sampleHeapAllocations(session, work) {
  await session.post('HeapProfiler.startSampling', {
    samplingInterval: allocationIntervalBytes,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  });
  let allocations;
  try {
    await work();
  } finally {
    const { profile } = await session.post('HeapProfiler.stopSampling');
    allocations = profile.samples;
  }
  return {
    sampledBytes: allocations.reduce((sum, sample) => sum + sample.size, 0),
    sampleCount: allocations.length,
  };
}

function probes(core) {
  const graph = Object.getPrototypeOf(core.graph);
  const { snapshot } = graph;
  const { save } = core;
  const { exec } = core.db;
  const { stringify } = JSON;
  const { structuredClone: clone } = globalThis;
  let row;
  function measure(key, work) {
    if (!row) return work();
    const start = performance.now();
    try { return work(); }
    finally { row[key] += performance.now() - start; }
  }
  graph.snapshot = function () {
    return measure('graphSnapshotMs', () => snapshot.call(this));
  };
  core.save = function () {
    return measure('saveMs', () => save.call(this));
  };
  core.db.exec = function (sql) {
    if (!row || !sql.startsWith('RELEASE kernel_')) return exec.call(this, sql);
    const start = performance.now();
    const result = exec.call(this, sql);
    if (!this.isTransaction) row.outerReleaseMs += performance.now() - start;
    return result;
  };
  JSON.stringify = function (value, ...args) {
    if (value === core.state) return measure('integrationStringifyMs', () => stringify(value, ...args));
    return stringify(value, ...args);
  };
  globalThis.structuredClone = function (value, ...args) {
    if (value?.revisions === core.state.revisions) {
      return measure('integrationCloneMs', () => clone(value, ...args));
    }
    return clone(value, ...args);
  };
  const writes = core.db.prepare('SELECT total_changes() AS count');
  return {
    async run(work) {
      const before = Number(writes.get().count);
      row = { operationMs: 0, integrationCloneMs: 0, graphSnapshotMs: 0, integrationStringifyMs: 0,
        saveMs: 0, outerReleaseMs: 0, logicalSqlChanges: 0 };
      const start = performance.now();
      try {
        await work();
        row.operationMs = performance.now() - start;
        row.logicalSqlChanges = Number(writes.get().count) - before;
        return row;
      } finally { row = undefined; }
    },
    restore() {
      graph.snapshot = snapshot;
      delete core.save;
      delete core.db.exec;
      JSON.stringify = stringify;
      globalThis.structuredClone = clone;
    },
  };
}

async function run([name, messages, bytes, resources, events], measureAllocations) {
  const folder = mkdtempSync(join(tmpdir(), 'aerynth-a21-bench-'));
  const path = join(folder, 'canonical.sqlite');
  const options = { path, provider: 'fixture', contentPolicy: 'synthetic-only' };
  let core;
  let second;
  let probe;
  let delivered = 0;
  const open = () => new BackendCore(options, () => { delivered++; });
  try {
    core = open();
    const call = (command, input) => core.command(command, input);
    const { resourceId } = await call('createConversation', {
      title: 'Synthetic benchmark conversation', commandId: 'bench-chat', providerId: 'local',
    });
    let revision = 1;
    async function append(content) {
      const message = await call('addMessage', { resourceId, role: 'user', content, expectedRevision: revision });
      assert.equal(message.revision, ++revision);
      return message.id;
    }
    const workspace = await call('workspace', { title: 'Synthetic benchmark workspace', projectTitle: 'Synthetic benchmark project' });
    for (let i = 0; i < messages; i++) await append(String(i % 10).repeat(bytes));
    for (let i = 0; i < resources; i++) core.kernel.createGenericResource(`Synthetic resource ${i}`);
    const record = index => core.record('vela.synthetic.benchmark', 'observed', undefined, `bench-event-${index}`,
      { providerId: 'aerynth-native', detached: true });
    for (let i = 0; i < events; i++) record(i);
    const scope = { workspaceId: workspace.id, projectId: workspace.project_id };
    const plan = nativeMissionPlan('Measure CPU and RAM in parallel', scope);
    assert(plan);
    if (name === 'event-heavy') {
      for (let i = 0; i < 6; i++) {
        const mission = core.missions.create('bench-seed-mission-' + i, plan);
        core.missions.control(mission.id, scope, mission.revision, { type: 'cancel' });
      }
      core.flushMissionPublication();
    }
    const integration = core.db.prepare('SELECT length(CAST(json AS BLOB)) AS bytes FROM integration_state WHERE id=1');
    const eventRows = core.db.prepare('SELECT count(*) AS count FROM intelligence_events');
    const sizes = () => ({
      integrationBytes: Number(integration.get().bytes),
      databaseBytes: statSync(path).size,
      eventCount: Number(eventRows.get().count),
    });
    const before = sizes();
    const operations = {};
    probe = probes(core);
    async function repeat(operation, work) {
      const rows = [];
      for (let i = 0; i < warmups + samples; i++) {
        const row = await probe.run(() => work(i));
        if (i >= warmups) rows.push(row);
      }
      operations[operation] = summarize(rows);
    }
    await repeat('smallMutation', i => call('workspace', { title: `Synthetic timed workspace ${i}` }));
    await repeat('conversationAppend', i => append(String(i % 10).repeat(1024)));
    await repeat('workspaceMutation', async i => {
      const target = await call('workspace', { title: `Synthetic placement workspace ${i}` });
      return call('place', { workspaceId: target.id, resourceId });
    });
    await repeat('resourceCreation', i => core.atomic(() => core.kernel.createGenericResource(`Synthetic timed resource ${i}`)));
    const liveBefore = delivered;
    await repeat('eventAppend', i => assert(record(events + i)));
    assert.equal(delivered - liveBefore, warmups + samples);
    await repeat('journalReplay', async () => {
      const page = await call('rendererEventPage', { recent: true, limit: 250 });
      assert(page.events.some(event => event.type === 'vela.synthetic.benchmark'));
      assert.equal(page.scannedThrough, page.latest);
    });
    await repeat('indexedResourceRead', () => assert.equal(core.kernel.getResource(resourceId).resource.id, resourceId));
    await repeat('snapshotRead', async () => assert.equal((await call('snapshot', {})).graph.messages.length, revision - 1));
    const rollback = Error('synthetic transaction rollback');
    const beforeRollback = { ...sizes(), delivered };
    await repeat('rollback', i => assert.throws(() => core.atomic(() => {
      core.kernel.createGenericResource('Synthetic rollback resource');
      record(-1 - i);
      throw rollback;
    }), error => error === rollback));
    assert.deepEqual({ ...sizes(), delivered }, beforeRollback);
    const missionRows = [];
    let missionId;
    for (let i = 0; i < warmups + samples; i++) {
      const mission = core.missions.create('bench-mission-' + i, plan);
      const row = await probe.run(() => {
        const paused = core.missions.control(mission.id, scope, mission.revision, { type: 'pause' });
        assert.equal(paused.disposition, 'paused');
        assert.equal(paused.profile.attempts, 0);
      });
      const paused = core.missions.read(mission.id, scope);
      core.missions.control(paused.id, scope, paused.revision, { type: 'cancel' });
      missionId = mission.id;
      if (i >= warmups) missionRows.push(row);
    }
    operations.missionPause = summarize(missionRows);
    core.flushMissionPublication();
    await repeat('unchangedIntegrationSave', () => core.atomic(() => {}));
    let messageId;
    await repeat('substantialSave', async i => { messageId = await append(String(i % 10).repeat(32768)); });
    const expectedGraph = JSON.parse(JSON.stringify((await call('snapshot', {})).graph));
    const after = sizes();
    assert(after.integrationBytes < 8 * 1024 * 1024);
    assert(after.databaseBytes <= 128 * 1024 * 1024);
    probe.restore();
    probe = undefined;
    const reopens = [];
    for (let i = 0; i < warmups + samples; i++) {
      await call('close', {});
      core = undefined;
      const start = performance.now();
      core = open();
      const hydrated = performance.now();
      const restored = await call('snapshot', {});
      const operationMs = performance.now() - start;
      assert.deepEqual(restored.graph, expectedGraph);
      assert.equal(restored.graph.messages.at(-1).id, messageId);
      assert.equal((await call('openWorkspace', { workspaceId: workspace.id })).workspace.id, workspace.id);
      assert.equal(core.missions.read(missionId, scope).disposition, 'cancelled');
      if (i >= warmups) reopens.push({ operationMs, hydrationMs: hydrated - start, firstSnapshotMs: operationMs - (hydrated - start) });
    }
    operations.reopenAndSnapshot = summarize(reopens);
    let heapAllocations;
    if (measureAllocations) {
      const session = new Session();
      session.connect();
      try {
        const startup = [], firstSnapshot = [], replay = [];
        for (let i = 0; i < allocationSamples; i++) {
          await call('close', {});
          core = undefined;
          startup.push(await sampleHeapAllocations(session, () => { core = open(); }));
          let restored;
          firstSnapshot.push(await sampleHeapAllocations(session, async () => { restored = await call('snapshot', {}); }));
          assert.deepEqual(restored.graph, expectedGraph);
          let page;
          replay.push(await sampleHeapAllocations(session, async () => { page = await call('rendererEventPage', { recent: true, limit: 250 }); }));
          assert.equal(page.scannedThrough, page.latest);
        }
        heapAllocations = { samplingIntervalBytes: allocationIntervalBytes, samplesPerPhase: allocationSamples,
          startup: summarize(startup), firstSnapshot: summarize(firstSnapshot), replay: summarize(replay) };
      } finally { session.disconnect(); }
    }
    second = new BackendCore(options);
    await append('Synthetic winning concurrent-writer mutation');
    const conflicts = [];
    for (let i = 0; i < warmups + samples; i++) {
      const start = performance.now();
      await assert.rejects(second.command('workspace', { title: 'Synthetic losing writer' }), /concurrent_backend_writer/);
      if (i >= warmups) conflicts.push({ operationMs: performance.now() - start });
    }
    operations.staleWriterReject = summarize(conflicts);
    return { name, messages, bytes, resources, events, before, after, operations, heapAllocations,
      processMaxRssKiB: process.resourceUsage().maxRSS };
  } finally {
    probe?.restore();
    try { if (second) await second.command('close', {}); }
    finally {
      try { if (core) await core.command('close', {}); }
      finally {
        const target = realpathSync(folder);
        assert.equal(dirname(target), realpathSync(tmpdir()));
        assert(basename(target).startsWith('aerynth-a21-bench-'));
        rmSync(target, { recursive: true, force: true });
      }
    }
  }
}

console.log(JSON.stringify({ node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model,
  logicalCpuCount: availableParallelism(), warmups, samples,
  note: 'Disk-backed synthetic BackendCore. RSS is cumulative process peak. Logical SQL changes include rolled-back work. Stage timings are inclusive and can overlap.' }));
const args = process.argv.slice(2);
const measureAllocations = args.includes('--sample-allocations');
const [profileName, ...extraArguments] = args.filter(argument => argument !== '--sample-allocations');
const selected = profileName ? profiles.filter(([name]) => name === profileName) : profiles;
assert(selected.length && !extraArguments.length && args.length - (profileName ? 1 : 0) <= 1,
  'Pass one listed profile name or omit it to run all profiles. Optionally pass --sample-allocations.');
for (const profile of selected) console.log(JSON.stringify(await run(profile, measureAllocations)));
