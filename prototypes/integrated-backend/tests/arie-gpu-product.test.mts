import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { setTimeout as wait } from 'node:timers/promises';
import type { MissionProjection } from '../src/mission-contracts.mts';
import { Backend } from '../src/service.mts';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'arie-product-gpu-'));
  const backend = new Backend({ path: join(root, 'profile.sqlite'), privateRoot: root, contentPolicy: 'local-private' }, {
    secrets: { available: async () => false, seal: async () => { throw Error('unavailable'); },
      open: async () => { throw Error('unavailable'); } },
  });
  return {
    backend,
    async workspace(title: string) {
      const desktop = await backend.call('desktop', { type: 'createWorkspace', title, projectId: null });
      const workspace = desktop.workspaces.find(item => item.title === title)!;
      await backend.call('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId: workspace.id } });
      return workspace.id;
    },
    async close() {
      await backend.close();
      const target = resolve(root), part = relative(resolve(tmpdir()), target);
      assert.ok(part.startsWith('arie-product-gpu-') && !isAbsolute(part));
      rmSync(target, { recursive: true, force: true });
    },
  };
}

test('the private GPU diagnostic defaults closed and a review is bound to its workspace and policy', async () => {
  const f = fixture();
  const { backend } = f;
  try {
    await assert.rejects(backend.call('gpuReadbackNative', { name: 'preview' }), /gpu_readback_disabled/u);
    if (process.platform !== 'win32') return;
    const policy = await backend.call('resourcePolicyNative', { name: 'inspect' });
    const enabled = await backend.call('resourcePolicyNative', { name: 'set-gpu-limit', limit: 1,
      expectedVersion: policy.configVersion });
    await assert.rejects(backend.call('gpuReadbackNative', { name: 'preview' }), /mission_workspace_required/u);
    await f.workspace('Synthetic GPU review origin');
    const preview = await backend.call('gpuReadbackNative', { name: 'preview' });
    assert.ok(preview.kind === 'preview');
    await f.workspace('Synthetic GPU review sibling');
    await assert.rejects(backend.call('gpuReadbackNative', { name: 'start', reviewId: preview.reviewId }), /gpu_readback_review_changed/u);
    const changed = await backend.call('gpuReadbackNative', { name: 'preview' });
    assert.ok(changed.kind === 'preview');
    await backend.call('resourcePolicyNative', { name: 'set-mode', mode: 'gaming_focus', expectedVersion: enabled.configVersion });
    await assert.rejects(backend.call('gpuReadbackNative', { name: 'start', reviewId: changed.reviewId }), /gpu_readback_review_changed/u);
  } finally { await f.close(); }
});

test('opt-in Windows product diagnostic verifies through the real worker and canonical mission receipt',
  { skip: process.platform !== 'win32' || process.env.AERYNTH_VERIFY_GPU_PRODUCT !== '1' }, async () => {
    const f = fixture();
    const { backend } = f;
    try {
      await f.workspace('Synthetic GPU product workspace');
      const initial = await backend.call('resourcePolicyNative', { name: 'inspect' });
      await backend.call('resourcePolicyNative', { name: 'set-gpu-limit', limit: 1, expectedVersion: initial.configVersion });
      const preview = await backend.call('gpuReadbackNative', { name: 'preview' });
      assert.ok(preview.kind === 'preview');
      const started = await backend.call('gpuReadbackNative', { name: 'start', reviewId: preview.reviewId });
      assert.ok(started.kind === 'started');
      await assert.rejects(backend.call('gpuReadbackNative', { name: 'start', reviewId: preview.reviewId }), /gpu_readback_review_changed/u);
      const deadline = performance.now() + 35_000;
      let result: MissionProjection;
      do {
        result = await backend.call('missions', { name: 'read', input: { id: started.missionId } }) as MissionProjection;
        if (!['queued', 'running'].includes(result.outcome)) break;
        await wait(40);
      } while (performance.now() < deadline);
      assert.equal(result.outcome, 'verified', JSON.stringify({ waits: result.waits,
        tasks: result.tasks.map(task => [task.state, task.detail]) }));
      const attempt = result.tasks[0].attempts[0];
      assert.equal(attempt.resourceLease?.kind, 'gpu');
      assert.equal(attempt.resourceLease.reservedVramBytes, preview.vramBytes);
      assert.equal(attempt.resourceLease.reservedRamBytes, preview.ramBytes);
      assert.equal(attempt.verification?.passed, true);
      assert.equal((attempt.evidence?.value as { verifiedBuffers?: number }).verifiedBuffers, 8);
      assert.equal(result.profile.providerCalls, 0);
      console.log(JSON.stringify({ productGpuVerified: true, queueMs: attempt.timing?.queueMs,
        executionMs: attempt.timing?.executionMs, reservedVramBytes: attempt.resourceLease.reservedVramBytes,
        budgetBytes: attempt.resourceLease.gpuBudgetBytes }));
    } finally { await f.close(); }
  });
