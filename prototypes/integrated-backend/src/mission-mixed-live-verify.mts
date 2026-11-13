import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as wait } from 'node:timers/promises';
import type { MissionAttempt, MissionPreview, MissionProjection } from './mission-contracts.mts';
import type { MissionExecutionProfile } from './execution-profiler.mts';
import type { NativeHostServices } from './native-host.mts';
import { Backend } from './service.mts';

const credential = process.env.OPENAI_API_KEY;
if (process.platform !== 'win32' || process.env.AERYNTH_VERIFY_LIVE_MIXED !== '1' || !credential)
  throw Error('Windows, AERYNTH_VERIFY_LIVE_MIXED=1 and OPENAI_API_KEY are required');
const serial = process.argv.includes('--serial');
const sequential = process.argv.includes('--sequential');
const contention = process.argv.includes('--gpu-contention');
const skipGpu = process.argv.includes('--cpu-remote-only');
const codexTestPath = process.env.AERYNTH_MIXED_CODEX_TEST;
assert.ok(Number(serial) + Number(sequential) + Number(contention) <= 1, 'Choose one mixed verification mode');
assert.ok(!skipGpu || !serial && !contention, 'CPU and remote mode cannot test GPU admission');
assert.ok(!codexTestPath || skipGpu && isAbsolute(codexTestPath), 'Codex mode requires CPU/remote-only and an absolute reviewed test path');
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
const objective = codexTestPath ? 'Run selected Node tests and measure CPU and RAM with two independent specialists' :
  'Investigate Aerynth backend performance with two independent specialists';
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
    contentPolicy: 'local-private', provider: codexTestPath ? 'codex' : 'fixture',
    ...(codexTestPath ? { cwd: dirname(codexTestPath) } : {}) }, native);
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
  const codexSelection = codexTestPath ? await backend.call('missionCheckReview', { paths: [codexTestPath] }) : undefined;
  const gpuReview = skipGpu ? undefined : await backend.call('gpuReadbackNative', { name: 'preview' });
  if (gpuReview) assert.equal(gpuReview.kind, 'preview');
  const cpuStart = process.cpuUsage();
  const start = performance.now();
  const gpu = gpuReview ? await backend.call('gpuReadbackNative', { name: 'start', reviewId: gpuReview.reviewId }) : undefined;
  if (gpu) assert.equal(gpu.kind, 'started');
  let contentionEntryPercent: number | undefined;
  if (gpu && ownerHold) {
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
  } else if (gpu && (serial || sequential)) {
    const result = await settled(gpu.missionId);
    assert.equal(result.outcome, 'verified', JSON.stringify({ gpu: result.outcome, detail: result.tasks[0].detail,
      attempt: result.tasks[0].attempts[0]?.evidence?.value }));
  } else if (gpu) {
    const started = await Promise.race([gpuStart, wait(35_000, null, { ref: false })]);
    assert.equal(started, gpu.missionId, 'GPU task did not enter its authorized lease');
  }
  // Establish the sequential limit before any specialist can enter the transport.
  if (sequential) await backend.call('missionHostSignal', { storageAdmitted: false });
  const mission = await backend.call('missionStartReviewed', { objective, fingerprint: preview.fingerprint,
    requestId: randomUUID(), ...(codexSelection && codexTestPath ? {
      approvedProjectCheck: { paths: [codexTestPath], digest: codexSelection.digest },
    } : {}) }) as MissionProjection;
  if (sequential) {
    const controlled = await backend.call('missions', { name: 'control', input: { id: mission.id, revision: mission.revision,
      control: { type: 'concurrency', concurrency: 1 } } }) as MissionProjection;
    assert.ok(controlled.tasks.every(task => task.attempts.length === 0));
    await backend.call('missionHostSignal', { storageAdmitted: true });
  }
  let contentionAtMixedSettlement = false;
  const mixedSettlement = settled(mission.id).then(async result => {
    if (gpu && contention) {
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
  const [gpuResult, mixed] = await Promise.all([gpu ? settled(gpu.missionId) : undefined, mixedSettlement]);
  const totalMs = Math.round(performance.now() - start);
  const processCpu = process.cpuUsage(cpuStart);
  const outcome = (result: MissionProjection) => ({ outcome: result.outcome,
    tasks: result.tasks.map(task => ({ id: task.id, state: task.state, reason: task.detail,
      providerStatus: (task.attempts[0]?.evidence?.value as { errorCode?: string } | undefined)?.errorCode })) });
  if (gpuResult) assert.equal(gpuResult.outcome, 'verified', JSON.stringify(outcome(gpuResult)));
  assert.equal(mixed.outcome, 'verified', JSON.stringify(outcome(mixed)));
  const gpuAttempt = gpuResult?.tasks[0].attempts[0];
  const cpu = mixed.tasks.find(task => task.executor === (codexTestPath ? 'sample.cpu' : 'inspect.backend-source'))!.attempts[0];
  const check = mixed.tasks.find(task => task.executor === 'codex.project-check')?.attempts[0];
  const remote = mixed.tasks.filter(task => task.executor === 'api.specialist');
  if (gpuResult) assert.equal(gpuAttempt?.resourceLease?.kind, 'gpu');
  assert.equal(cpu.resourceLease?.kind, codexTestPath ? 'host_io' : 'cpu');
  if (codexTestPath) {
    assert.equal(check?.resourceLease?.kind, 'build');
    assert.equal(check?.evidence?.source, 'codex-app-server:read-only-command');
    assert.equal(check?.verification?.passed, true);
  }
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
  const gpuInterval = gpuAttempt ? interval(gpuAttempt) : null;
  const [cpuFrom, cpuTo] = interval(cpu);
  const remoteIntervals = remote.map(({ id, attempts: [attempt] }) => {
    const [from, to] = interval(attempt);
    const dispatched = dispatchedAt.get(id);
    assert.ok(dispatched !== undefined && dispatched >= from && dispatched <= to);
    return [dispatched, to] as const;
  });
  const tripleOverlapMs = gpuInterval ? Math.max(0, ...remoteIntervals.map(([from, to]) =>
    Math.min(gpuInterval[1], cpuTo, to) - Math.max(gpuInterval[0], cpuFrom, from))) : null;
  const cpuRemoteOverlapMs = Math.max(0, ...remoteIntervals.map(([from, to]) => Math.min(cpuTo, to) - Math.max(cpuFrom, from)));
  const specialistOverlapMs = Math.max(0, Math.min(...remoteIntervals.map(([, end]) => end)) -
    Math.max(...remoteIntervals.map(([from]) => from)));
  const profile = await backend.call('missions', { name: 'execution-profile', input: { id: mixed.id } }) as MissionExecutionProfile;
  assert.equal(profile.work.intervalCoverage.measured, profile.work.intervalCoverage.attempts);
  assert.ok(profile.work.criticalPath && profile.work.dependencyReadinessPath);
  const join = mixed.tasks.find(task => task.id === 'report')!;
  const joined = join.attempts.at(-1)!;
  assert.equal(joined.verification?.passed, true);
  assert.deepEqual(joined.evidence?.value, join.dependencies.map(id => {
    const evidence = mixed.tasks.find(task => task.id === id)!.attempts.at(-1)!.evidence!;
    return { id: evidence.id, source: evidence.source, attemptId: evidence.attemptId };
  }));
  const summary = (attempt: MissionAttempt) => ({ kind: attempt.resourceLease?.kind, timing: attempt.timing,
    verified: attempt.verification?.passed, usage: attempt.telemetry?.usage,
    reservedRamBytes: attempt.resourceLease?.reservedRamBytes, reservedVramBytes: attempt.resourceLease?.reservedVramBytes });
  if (contention && gpuInterval) assert.ok(remoteIntervals.every(([, until]) => until <= gpuInterval[0]), 'GPU started before remote work settled');
  if (gpuInterval && (serial || sequential || contention)) assert.equal(tripleOverlapMs, 0);
  if (sequential) {
    assert.equal(profile.work.peakWorkers, 1);
    assert.equal(profile.work.overlapMs, 0);
    assert.equal(specialistOverlapMs, 0);
  }
  if (!serial && !sequential && !contention) assert.ok(specialistOverlapMs > 0, 'Live specialist transports did not overlap');
  console.log(JSON.stringify({ mode: contention ? 'gpu-contention' : sequential ? 'sequential' : serial ? 'serial-gpu' : 'overlap',
    model, effort, verified: true, totalMs, processCpu, tripleOverlapMs, cpuRemoteOverlapMs, specialistOverlapMs,
    gpu: gpuAttempt ? summary(gpuAttempt) : null, cpu: summary(cpu), aep: { criticalPath: profile.work.criticalPath,
      workerMs: profile.work.workerMs, overlapMs: profile.work.overlapMs, peakWorkers: profile.work.peakWorkers,
      firstVerifiedMs: profile.admissionToFirstVerifiedTaskMs, cost: profile.economics.cost, costCoverage: profile.economics.costCoverage },
    verifiedJoin: true, specialistClaimVerification: 'report-structure-and-attribution',
    ...(check ? { codex: summary(check), codexResult: check.evidence?.value } : {}),
    ...(contention ? { contentionEntryPercent, contentionAtMixedSettlement, cpuIntervalUtcMs: [cpuFrom, cpuTo],
      remoteIntervalsUtcMs: remoteIntervals, gpuAdmittedUtcMs: gpuInterval?.[0] } : {}),
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
