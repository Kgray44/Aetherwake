import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { Backend } from '../src/service.mts';
import { createResourcePolicy, type ResourcePolicyNativeRequest } from '../src/resource-policy.mts';
import { createResourcePolicyStore } from '../src/resource-policy-store.mts';

test('trusted owner profile and one-step rollback survive separate backend processes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aerynth-arie-settings-'));
  const options = { path: join(root, 'state.sqlite'), privateRoot: root, contentPolicy: 'local-private' as const };
  const host = { secrets: { available: async () => false, seal: async () => { throw Error(); },
    open: async () => { throw Error(); } } };
  let backend = new Backend(options, host);
  const command = (input: ResourcePolicyNativeRequest) => backend.call('resourcePolicyNative', input);
  try {
    const first = await command({ name: 'inspect' });
    assert.equal(first.mode, 'balanced');
    assert.equal(first.externalActivityProtection, false);
    const chosen = await command({ name: 'set-mode', mode: 'gaming_focus', expectedVersion: first.configVersion });
    assert.equal(chosen.origin, 'user');
    assert.equal(chosen.effective.build, 0);
    assert.equal(chosen.effective.remote, first.effective.remote);
    await assert.rejects(command({ name: 'rollback', expectedVersion: first.configVersion }), /stale_resource_policy/u);
    await backend.close();
    backend = new Backend(options, host);
    const restored = await command({ name: 'inspect' });
    assert.equal(restored.mode, 'gaming_focus');
    assert.equal(restored.configVersion, chosen.configVersion);
    assert.ok(restored.appliedAtUtc);
    assert.equal(restored.appliedAtUtc, chosen.appliedAtUtc);
    assert.equal(restored.previousMode, 'balanced');
    assert.notEqual(restored.epoch, chosen.epoch);
    assert.equal(restored.canRollback, true);
    const previous = await command({ name: 'rollback', expectedVersion: restored.configVersion });
    assert.equal(previous.mode, 'balanced');
    assert.equal(previous.origin, 'default');
    assert.equal(previous.canRollback, false);
    const limited = await command({ name: 'set-cpu-limit', limit: 0, expectedVersion: previous.configVersion });
    const disabled = await command({ name: 'set-windows-monitoring', enabled: false, expectedVersion: limited.configVersion });
    const activity = await command({ name: 'set-external-activity-protection', enabled: true, expectedVersion: disabled.configVersion });
    assert.equal(activity.externalActivityProtection, true);
    await assert.rejects(command({ name: 'set-cpu-limit', limit: disabled.maxCpuWorkers + 1,
      expectedVersion: activity.configVersion }), /invalid_resource_policy_request/u);
    backend.observeMissionHostSignal({ storageAdmitted: false });
    await command({ name: 'inspect' });
    await assert.rejects(command({ name: 'restore-defaults', expectedVersion: activity.configVersion }), /storage_reserve_admission_denied/u);
    await backend.close();
    backend = new Backend(options, host);
    const saved = await command({ name: 'inspect' });
    assert.equal(saved.limits.cpu, 0);
    assert.equal(saved.windowsMonitoring, false);
    assert.equal(saved.configVersion, activity.configVersion);
    assert.equal(saved.externalActivityProtection, true);
    const defaults = await command({ name: 'restore-defaults', expectedVersion: saved.configVersion });
    assert.equal(defaults.limits.cpu, defaults.maxCpuWorkers);
    assert.equal(defaults.windowsMonitoring, true);
    assert.equal(defaults.externalActivityProtection, false);
    await backend.close();

    const db = new DatabaseSync(options.path);
    try { db.prepare('UPDATE platform_resource_preferences SET json=? WHERE id=1').run('invalid'); }
    finally { db.close(); }
    backend = new Backend(options, host);
    const recovered = await command({ name: 'inspect' });
    assert.equal(recovered.configurationHealth, 'fallback');
    assert.equal(recovered.mode, 'balanced');
    assert.equal(recovered.windowsMonitoring, false);
    assert.equal(recovered.configVersion, defaults.configVersion);
    const repaired = await command({ name: 'restore-defaults', expectedVersion: recovered.configVersion });
    assert.equal(repaired.configurationHealth, 'valid');
    await backend.close();

    backend = new Backend(options);
    await assert.rejects(command({ name: 'inspect' }), /native_resource_policy_required/u);
    await backend.close();

    backend = new Backend({ ...options, path: join(root, 'preset.sqlite') }, {
      ...host, resourcePolicy: { mode: 'max_throughput', limits: defaults.limits, monitorWindows: false },
    });
    const preset = await command({ name: 'inspect' });
    assert.equal(preset.origin, 'host');
    assert.equal(preset.mode, 'max_throughput');
    assert.equal(preset.windowsMonitoring, false);
  } finally {
    await backend.close();
    const target = resolve(root), suffix = relative(resolve(tmpdir()), target);
    assert.ok(suffix.startsWith('aerynth-arie-settings-') && !isAbsolute(suffix));
    rmSync(target, { recursive: true, force: true });
  }
});

test('a lost compare-and-set cannot change live admission', () => {
  const db = new DatabaseSync(':memory:');
  const store = createResourcePolicyStore(db);
  const first = createResourcePolicy(3, 0, () => 0, Date.now, undefined, store);
  const second = createResourcePolicy(3, 0, () => 0, Date.now, undefined, store);
  try {
    const before = second.inspect();
    first.configure(before.configVersion, { mode: 'gaming_focus', limits: before.limits });
    assert.throws(() => second.configure(before.configVersion, { mode: 'max_throughput', limits: before.limits }),
      /stale_resource_policy/u);
    assert.deepEqual(second.inspect(), before);
    const lease = first.tryLease({ missionId: 'mission', taskId: 'remote', attemptId: 'attempt', kind: 'remote', timeoutMs: 1000 });
    assert.equal(lease?.receipt.configVersion, first.inspect().configVersion);
    lease?.release();
  } finally { first.dispose(); second.dispose(); db.close(); }
});
