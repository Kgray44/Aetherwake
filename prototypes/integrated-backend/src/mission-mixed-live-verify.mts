import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as wait } from 'node:timers/promises';
import type { MissionAttempt, MissionPreview, MissionProjection } from './mission-contracts.mts';
import type { NativeHostServices } from './native-host.mts';
import { Backend } from './service.mts';

const credential = process.env.OPENAI_API_KEY;
if (process.platform !== 'win32' || process.env.AERYNTH_VERIFY_LIVE_MIXED !== '1' || !credential)
  throw Error('Windows, AERYNTH_VERIFY_LIVE_MIXED=1 and OPENAI_API_KEY are required');
const serial = process.argv.includes('--serial');
const contention = process.argv.includes('--gpu-contention');
assert.ok(!serial || !contention, 'Choose one mixed verification mode');
delete process.env.OPENAI_API_KEY;

const root = mkdtempSync(join(tmpdir(), 'aerynth-arie-live-mixed-'));
const encryptionKey = randomBytes(32);
const native: NativeHostServices = { secrets: {
  available: async () => true,
  seal: async text => {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(text), cipher.final()]);
    return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]);
  },
  open: async bytes => {
    const data = Buffer.from(bytes), cipher = createDecipheriv('aes-256-gcm', encryptionKey, data.subarray(0, 12));
    cipher.setAuthTag(data.subarray(-16));
    return Buffer.concat([cipher.update(data.subarray(12, -16)), cipher.final()]).toString();
  },
} };

const provider = 'openai-api-vela';
const model = 'gpt-6.1-sol';
const effort = 'high';
const objective = 'Investigate Aerynth backend performance with two independent specialists';
const path = join(root, 'state.sqlite');

let gpuStarted!: (id: string) => void;
const gpuStart = new Promise<string>(resolve => { gpuStarted = resolve; });

async function until<T>(observe: () => Promise<T>, done: (value: T) => boolean, timeoutMs: number) {
  const deadline = performance.now() + timeoutMs;
  do {
    const value = await observe();
    if (done(value)) return value;
    await wait(30);
  } while (performance.now() < deadline);
  throw Error('mixed_mission_deadline');
}
const interval = (attempt: MissionAttempt) => [Date.parse(attempt.admittedAt), Date.parse(attempt.finishedAt!)] as const;

let ownedBackend: Backend | undefined;
try {
  const backend = ownedBackend = new Backend({ path, privateRoot: root,
    contentPolicy: 'local-private', provider: 'fixture' }, native);
  backend.subscribe(event => {
    if (event.type === 'vela.mission/started' && event.payload.taskId === 'gpu-readback' && event.mission?.id)
      gpuStarted(event.mission.id);
  });
  const read = (id: string) => backend.call('missions', { name: 'read', input: { id } }) as Promise<MissionProjection>;
  const settled = (id: string) => until(() => read(id), result => !['queued', 'running', 'cancelling'].includes(result.outcome), 75_000);
  const inspect = () => backend.call('resourcePolicyNative', { name: 'inspect' });
  const config = await backend.call('velaApiConfigure', { credential: { configurationId: 'vela-primary', apiKey: credential }, expectedVersion: null });
  assert.ok(config.version !== null);
  await backend.call('velaApiUsageAuthorize', { expectedVersion: config.version, enabled: true });
  const options = await backend.call('vela', { name: 'routingOptions', input: { providerId: provider } }) as
    { id: string; reasoningEfforts?: string[] }[];
  assert.ok(options.some(option => option.id === model && option.reasoningEfforts?.includes(effort)), 'approved model and effort unavailable');
  await backend.call('vela', { name: 'saveRoutingSettings', input: { scope: 'global', id: null, expectedVersion: 0,
    defaults: { providerId: provider, model, reasoningEffort: effort } } });
  const desktop = await backend.call('desktop', { type: 'createWorkspace', title: 'Synthetic live resource acceptance', projectId: null });
  await backend.call('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId: desktop.workspaces[0].id } });
  const policy = await inspect();
  const gpuEnabled = await backend.call('resourcePolicyNative', { name: 'set-gpu-limit', limit: 1, expectedVersion: policy.configVersion });
  const ownerHold = contention ? await backend.call('resourcePolicyNative', { name: 'set-mode', mode: 'gaming_focus',
    expectedVersion: gpuEnabled.configVersion }) : undefined;
  const preview = await backend.call('missions', { name: 'preview', input: { objective } }) as MissionPreview;
  assert.equal(preview.externalReview?.calls, 2);
  assert.ok(preview.executors.every(executor => executor.available));
  const reviewedSpecialists = preview.plan.tasks.filter(task => task.executor === 'api.specialist');
  assert.equal(reviewedSpecialists.length, 2);
  assert.ok(reviewedSpecialists.every(task => task.specialist?.provider === provider && task.specialist.model === model &&
    task.specialist.effort === effort && !task.specialist.webSearch && task.dependencies.length === 0));
  const gpuReview = await backend.call('gpuReadbackNative', { name: 'preview' });
  assert.ok(gpuReview.kind === 'preview');
  const start = performance.now();
  const gpu = await backend.call('gpuReadbackNative', { name: 'start', reviewId: gpuReview.reviewId });
  assert.ok(gpu.kind === 'started');
  let contentionEntryPercent: number | undefined;
  if (ownerHold) {
    // An external hardware workload supplies the actual pressure. The initial owner hold keeps the probe demanded.
    const queued = await until(() => read(gpu.missionId), result => result.admission?.reasons.includes('gpu-load') === true, 65_000);
    assert.equal(queued.outcome, 'queued');
    assert.equal(queued.tasks[0].attempts.length, 0);
    contentionEntryPercent = queued.admission?.readings.gpuEnginePercent?.value;
    assert.ok(contentionEntryPercent !== undefined && contentionEntryPercent >= 95);
    await backend.call('resourcePolicyNative', { name: 'set-mode', mode: 'balanced', expectedVersion: ownerHold.configVersion });
    const held = await until(inspect, state => state.reason === 'gpu_contention', 8_000);
    assert.ok(held.effective.remote >= 2);
    assert.equal(held.active.gpu, 0);
  } else if (serial) await settled(gpu.missionId);
  else {
    const started = await Promise.race([gpuStart, wait(35_000, null, { ref: false })]);
    assert.equal(started, gpu.missionId, 'GPU task did not enter its authorized lease');
  }
  const mission = await backend.call('missionStartReviewed', { objective, fingerprint: preview.fingerprint,
    requestId: randomUUID() }) as MissionProjection;
  let contentionAtMixedSettlement = false;
  const mixedSettlement = settled(mission.id).then(async result => {
    if (contention) {
      const state = await inspect();
      const queued = await read(gpu.missionId);
      assert.equal(state.reason, 'gpu_contention');
      assert.ok(state.effective.remote >= 2);
      assert.equal(queued.outcome, 'queued');
      assert.equal(queued.tasks[0].attempts.length, 0);
      contentionAtMixedSettlement = true;
    }
    return result;
  });
  const [gpuResult, mixed] = await Promise.all([settled(gpu.missionId), mixedSettlement]);
  const outcome = (result: MissionProjection) => ({ outcome: result.outcome,
    tasks: result.tasks.map(task => ({ id: task.id, state: task.state, reason: task.detail,
      providerStatus: (task.attempts[0]?.evidence?.value as { errorCode?: string } | undefined)?.errorCode })) });
  assert.equal(gpuResult.outcome, 'verified', JSON.stringify(outcome(gpuResult)));
  assert.equal(mixed.outcome, 'verified', JSON.stringify(outcome(mixed)));
  const gpuAttempt = gpuResult.tasks[0].attempts[0];
  const cpu = mixed.tasks.find(task => task.executor === 'inspect.backend-source')!.attempts[0];
  const remote = mixed.tasks.filter(task => task.executor === 'api.specialist');
  assert.equal(gpuAttempt.resourceLease?.kind, 'gpu');
  assert.equal(cpu.resourceLease?.kind, 'cpu');
  assert.equal(remote.length, 2);
  assert.ok(remote.every(({ attempts: [attempt] }) => attempt.resourceLease?.kind === 'remote' &&
    attempt.evidence?.source === 'openai-api-vela:reported' && attempt.verification?.passed));
  assert.equal(mixed.profile.providerCalls, 2);
  const receipts = new DatabaseSync(path, { readOnly: true });
  const dispatchedAt = new Map<string, number>();
  try {
    const events = receipts.prepare(`SELECT json_extract(json, '$.payload.taskId') AS taskId,
      json_extract(json, '$.receivedAt') AS observedAt FROM intelligence_events
      WHERE json_extract(json, '$.type') = 'vela.mission/api-dispatch'
        AND json_extract(json, '$.correlationId') = ? AND json_extract(json, '$.providerId') = ?`).all(mixed.id, provider);
    assert.equal(events.length, 2);
    for (const event of events) dispatchedAt.set(String(event.taskId), Date.parse(String(event.observedAt)));
    const receipt = receipts.prepare('SELECT state, response_id FROM vela_api_runs WHERE request_id = ?');
    for (const { attempts: [attempt] } of remote) {
      const row = receipt.get(attempt.id);
      assert.ok(row?.state === 'completed' && typeof row.response_id === 'string');
    }
  } finally { receipts.close(); }
  assert.equal(dispatchedAt.size, 2);
  const [gpuFrom, gpuTo] = interval(gpuAttempt), [cpuFrom, cpuTo] = interval(cpu);
  const remoteIntervals = remote.map(({ id, attempts: [attempt] }) => {
    const [from, to] = interval(attempt);
    const dispatched = dispatchedAt.get(id);
    assert.ok(dispatched !== undefined && dispatched >= from && dispatched <= to);
    return [dispatched, to] as const;
  });
  const tripleOverlapMs = Math.max(0, ...remoteIntervals.map(([from, to]) =>
    Math.min(gpuTo, cpuTo, to) - Math.max(gpuFrom, cpuFrom, from)));
  const cpuRemoteOverlapMs = Math.max(0, ...remoteIntervals.map(([from, to]) => Math.min(cpuTo, to) - Math.max(cpuFrom, from)));
  const summary = (attempt: MissionAttempt) => ({ kind: attempt.resourceLease?.kind, timing: attempt.timing,
    verified: attempt.verification?.passed, usage: attempt.telemetry?.usage });
  if (contention) assert.ok(remoteIntervals.every(([, until]) => until <= gpuFrom), 'GPU started before remote work settled');
  if (serial || contention) assert.equal(tripleOverlapMs, 0);
  else assert.ok(tripleOverlapMs > 0, 'CPU, GPU, and live transport did not overlap');
  console.log(JSON.stringify({ mode: contention ? 'gpu-contention' : serial ? 'serial-gpu' : 'overlap', model, effort, verified: true,
    totalMs: Math.round(performance.now() - start), tripleOverlapMs, cpuRemoteOverlapMs, gpu: summary(gpuAttempt), cpu: summary(cpu),
    ...(contention ? { contentionEntryPercent, contentionAtMixedSettlement, cpuIntervalUtcMs: [cpuFrom, cpuTo],
      remoteIntervalsUtcMs: remoteIntervals, gpuAdmittedUtcMs: gpuFrom } : {}),
    remote: remote.map(task => summary(task.attempts[0])), totalProviderCalls: dispatchedAt.size }));
} finally {
  try { await ownedBackend?.close(); }
  finally {
    encryptionKey.fill(0);
    const target = resolve(root), part = relative(resolve(tmpdir()), target);
    assert.ok(part.startsWith('aerynth-arie-live-mixed-') && !isAbsolute(part));
    rmSync(target, { recursive: true, force: true });
  }
}
