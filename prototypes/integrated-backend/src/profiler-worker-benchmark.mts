import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Backend } from './service.mts';
import type { MissionPreview } from './mission-contracts.mts';

const root = realpathSync(tmpdir());
const scratch = mkdtempSync(join(root, 'aerynth-profiler-worker-'));
const backend = new Backend({ path: join(scratch, 'state.sqlite'), contentPolicy: 'synthetic-only' });
const objective = 'Measure CPU and RAM';
const pollIntervalMs = 25;
const settledPolls = 6;

async function sample(index: number) {
  const preview = await backend.call('missions', { name: 'preview', input: { objective } }) as MissionPreview;
  const mission = await backend.call('missions', { name: 'start', input: {
    objective, fingerprint: preview.fingerprint, requestId: randomUUID(),
  } });
  assert.ok(mission && 'id' in mission);
  const id = mission.id;
  const read = async (name: 'read' | 'execution-profile') => {
    const startedAt = performance.now();
    const result = await backend.call('missions', { name, input: { id } });
    const elapsedMs = performance.now() - startedAt;
    assert.ok(result && 'outcome' in result);
    return { result, elapsedMs };
  };
  const pairs = [];
  const deadline = performance.now() + 7000;
  let sawLiveAttempt = false;
  let verifiedPolls = 0;
  for (let i = 0; performance.now() < deadline; i++) {
    const readFirst = (index + i) % 2 === 0;
    const first = await read(readFirst ? 'read' : 'execution-profile');
    const second = await read(readFirst ? 'execution-profile' : 'read');
    const [missionRead, profileRead] = readFirst ? [first, second] : [second, first];
    const raw = missionRead.result;
    const profile = profileRead.result;
    assert.ok('tasks' in raw && 'kind' in profile && profile.kind === 'execution-profile');
    assert.equal(profile.missionId, id);
    assert.equal(raw.id, id);
    sawLiveAttempt ||= Boolean(profile.work.live?.attempts.length);
    const sameState = raw.outcome === profile.outcome && raw.revision === profile.revision;
    pairs.push({ readFirst, missionState: raw.outcome, profileState: profile.outcome, sameState,
      afterFirstVerifiedPair: verifiedPolls > 0, reportPublished: profile.reportPublication !== null,
      missionReadMs: missionRead.elapsedMs, profileReadMs: profileRead.elapsedMs,
      deltaMs: sameState ? profileRead.elapsedMs - missionRead.elapsedMs : null });
    if (raw.outcome === 'verified' && profile.outcome === 'verified') {
      assert.ok(sawLiveAttempt, 'worker benchmark missed the live native attempt');
      assert.equal(profile.quality.objectiveVerified, true);
      assert.equal(profile.economics.providerCalls, 0);
      assert.deepEqual(raw.tasks.map(task => [task.id, task.attempts.at(-1)?.evidence?.source]), [
        ['cpu', 'node:os.cpus'], ['ram', 'node:os.totalmem+freemem'], ['report', 'aerynth.mission.journal'],
      ]);
      assert.deepEqual(profile.verifiedTaskMilestones.last?.evidenceIds, raw.tasks.at(-1)?.attempts.at(-1)?.verification?.evidenceIds);
      if (++verifiedPolls > settledPolls) {
        assert.ok(profile.reportPublication?.eventId, 'worker benchmark missed report publication');
        return { pairs };
      }
    }
    await delay(pollIntervalMs);
  }
  throw new Error('worker profiler benchmark deadline');
}

try {
  const workspace = (await backend.call('desktop', {
    type: 'createWorkspace', title: 'Synthetic profiler benchmark workspace', projectId: null,
  })).workspaces[0];
  await backend.call('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId: workspace.id } });
  await sample(0);
  const samples = [];
  for (let i = 1; i <= 9; i++) samples.push(await sample(i));
  const activity = await backend.call('providerActivity', {});
  assert.equal(activity.providerRequests, 0);
  assert.equal(activity.codexConnections, 0);
  console.log(JSON.stringify({ contract: 'aerynth.profiler-worker-benchmark@1', node: process.version, platform: process.platform,
    pollIntervalMs, settledPolls, warmups: 1, samples, activity,
    boundary: 'Default full profiler and file-backed SQLite on a Node worker thread. Both reads include backend work, messaging and payload cloning. Pair deltas exclude revisions or outcomes changed between calls. Native execution uses actual CPU and RAM reads. Electron IPC, physical disk latency, renderer and provider overhead are unmeasured.' }));
} finally {
  await backend.close();
  const owned = realpathSync(scratch);
  assert.equal(dirname(owned), root);
  assert.match(basename(owned), /^aerynth-profiler-worker-/);
  rmSync(owned, { recursive: true, force: true });
}
