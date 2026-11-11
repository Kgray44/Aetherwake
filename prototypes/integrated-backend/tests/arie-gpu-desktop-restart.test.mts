import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import type { CommandMap, StreamEvent } from '../src/contracts.mts';
import type { MissionProjection } from '../src/mission-contracts.mts';
import type { NativeSecretRequest } from '../src/native-host.mts';

function desktopHost(root: string, signal: AbortSignal) {
  const entry = fileURLToPath(new URL('../src/desktop-host.mts', import.meta.url));
  const child = spawn(process.execPath, [entry, join(root, 'profile.sqlite'), root, root, '--native-secrets'],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'] });
  const ended = once(child, 'close');
  const lines = createInterface({ input: child.stdout });
  const stream = lines[Symbol.asyncIterator]();
  const events: StreamEvent[] = [];
  const kill = () => { if (child.exitCode === null && !child.killed) child.kill(); };
  signal.addEventListener('abort', kill, { once: true });
  child.stdin.on('error', kill);
  let sequence = 0;
  const send = (message: unknown) => child.stdin.write(JSON.stringify(message) + '\n');

  async function receive() {
    const row = await stream.next();
    assert.ok(!row.done, 'desktop host ended before the expected receipt');
    const message = JSON.parse(row.value) as { id?: number; result?: unknown; error?: string; event?: StreamEvent } &
      Partial<NativeSecretRequest>;
    if (message.event) events.push(message.event);
    if (message.nativeHost) {
      const { id, version, purpose, operation } = message.nativeHost;
      send({ nativeHost: { id, version, purpose, operation, kind: 'response', error: 'native_secret_unavailable' } });
    }
    return message;
  }

  return {
    async call<K extends keyof CommandMap>(command: K, input: CommandMap[K]['input']): Promise<CommandMap[K]['output']> {
      const id = ++sequence;
      send({ id, command, input });
      for (;;) {
        const reply = await receive();
        if (reply.id !== id) continue;
        if (reply.error) throw Error(reply.error);
        return reply.result as CommandMap[K]['output'];
      }
    },
    async started(missionId: string) {
      for (;;) {
        const start = events.find(event => event.type === 'vela.mission/started' && event.mission?.id === missionId);
        if (start?.mission?.attemptId) return start.mission.attemptId;
        await receive();
      }
    },
    async stop() {
      kill();
      await ended;
      lines.close();
      signal.removeEventListener('abort', kill);
    },
  };
}

test('a private desktop host restart preserves an interrupted GPU attempt without replaying it', {
  skip: process.platform !== 'win32' || process.env.AERYNTH_VERIFY_GPU_PRODUCT !== '1', timeout: 55_000,
}, async t => {
  const root = mkdtempSync(join(tmpdir(), 'arie-gpu-desktop-restart-'));
  let host = desktopHost(root, t.signal);
  try {
    const desktop = await host.call('desktop', { type: 'createWorkspace', title: 'Synthetic GPU crash workspace', projectId: null });
    const workspaceId = desktop.workspaces[0].id;
    const target = { kind: 'workspace' as const, workspaceId };
    await host.call('desktop', { type: 'navigate', target });
    const initial = await host.call('resourcePolicyNative', { name: 'inspect' });
    const enabled = await host.call('resourcePolicyNative', { name: 'set-gpu-limit', limit: 1,
      expectedVersion: initial.configVersion });
    const review = await host.call('gpuReadbackNative', { name: 'preview' });
    assert.ok(review.kind === 'preview');
    const launched = await host.call('gpuReadbackNative', { name: 'start', reviewId: review.reviewId });
    assert.ok(launched.kind === 'started');
    const attemptId = await host.started(launched.missionId);
    await host.stop();

    host = desktopHost(root, t.signal);
    await host.call('desktop', { type: 'navigate', target });
    const restored = await host.call('resourcePolicyNative', { name: 'inspect' });
    assert.equal(restored.configVersion, enabled.configVersion);
    assert.equal(restored.limits.gpu, 1);
    assert.equal(restored.active.gpu, 0);
    assert.notEqual(restored.epoch, enabled.epoch);
    const mission = await host.call('missions', { name: 'read', input: { id: launched.missionId } }) as MissionProjection;
    assert.equal(mission.outcome, 'failed');
    const [task] = mission.tasks;
    assert.equal(task.detail, 'interrupted_by_restart');
    assert.equal(task.attempts.length, 1);
    const [attempt] = task.attempts;
    assert.equal(attempt.id, attemptId);
    assert.equal(attempt.resourceLease?.epoch, enabled.epoch);
    assert.equal(attempt.resourceLease.kind, 'gpu');
    const profile = await host.call('missions', { name: 'execution-profile', input: { id: launched.missionId } });
    assert.ok(profile && 'kind' in profile && profile.kind === 'execution-profile');
    const interrupted = profile.attempts.find(candidate => candidate.id === attemptId);
    assert.ok(interrupted?.interrupted && interrupted.resourceLease);
    assert.equal(interrupted.resourceLease.epoch, enabled.epoch);
    assert.equal(interrupted.resourceLease.leaseId, attempt.resourceLease.leaseId);
    assert.equal(interrupted.resourceLease.reservedVramBytes, attempt.resourceLease.reservedVramBytes);
    assert.equal(Object.hasOwn(interrupted.resourceLease, 'gpuContextId'), false);
    assert.equal(attempt.evidence, undefined);
    assert.equal(attempt.verification, undefined);
    assert.ok(mission.events.some(event => event.kind === 'recovered' && event.attemptId === attemptId));
    assert.equal(mission.profile.providerCalls, 0);
    await assert.rejects(host.call('gpuReadbackNative', { name: 'start', reviewId: review.reviewId }), /gpu_readback_review_changed/u);

    const fresh = await host.call('gpuReadbackNative', { name: 'preview' });
    assert.ok(fresh.kind === 'preview');
    const replacement = await host.call('gpuReadbackNative', { name: 'start', reviewId: fresh.reviewId });
    assert.ok(replacement.kind === 'started' && replacement.missionId !== launched.missionId);
    let result = await host.call('missions', { name: 'read', input: { id: replacement.missionId } }) as MissionProjection;
    while (result.outcome === 'queued' || result.outcome === 'running') {
      await wait(100, undefined, { signal: t.signal });
      result = await host.call('missions', { name: 'read', input: { id: replacement.missionId } }) as MissionProjection;
    }
    assert.equal(result.outcome, 'verified');
    assert.equal(result.tasks[0].attempts[0].resourceLease?.epoch, restored.epoch);
    assert.equal(result.tasks[0].attempts[0].verification?.passed, true);
    const replacementProfile = await host.call('missions', { name: 'execution-profile', input: { id: replacement.missionId } });
    assert.ok(replacementProfile && 'kind' in replacementProfile && replacementProfile.kind === 'execution-profile');
    const replacementLease = replacementProfile.attempts[0].resourceLease;
    assert.equal(replacementLease?.epoch, restored.epoch);
    assert.notEqual(replacementLease?.leaseId, interrupted.resourceLease.leaseId);
    assert.deepEqual(replacementProfile.resourcePolicy.leaseCoverage, { withReceipt: 1, withoutReceipt: 0, attemptsByKind: { gpu: 1 } });
    const original = await host.call('missions', { name: 'read', input: { id: launched.missionId } }) as MissionProjection;
    assert.equal(original.outcome, 'failed');
    assert.equal(original.tasks[0].attempts.length, 1);
    await host.call('close', {});
  } finally {
    await host.stop();
    const target = resolve(root), part = relative(resolve(tmpdir()), target);
    assert.ok(part.startsWith('arie-gpu-desktop-restart-') && !isAbsolute(part));
    rmSync(target, { recursive: true, force: true });
  }
});
