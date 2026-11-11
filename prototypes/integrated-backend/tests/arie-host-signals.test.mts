import assert from 'node:assert/strict';
import test from 'node:test';
import { createMissionAdmission } from '../src/mission-admission.mts';
import { isResourceSignal } from '../src/resource-signals.mts';

test('renderer pressure needs sustained focused samples and leaves remote admission independent', () => {
  let time = 0;
  const governor = createMissionAdmission({ maxWorkers: 3, now: () => time,
    availableMemory: () => 1024 ** 3, readWindowsPressure: null });
  const note = governor.noteResourceSignal;
  try {
    const slow = { rendererTiming: { frameP95Ms: 40, budgetRatioP95: 2.4, samples: 24, windowMs: 2000 } };
    note({ aerynthFocused: true });
    governor.read(true);
    note(slow);
    assert.ok(governor.canLease('build'));
    time += 2000;
    governor.read(true);
    note(slow);
    assert.equal(governor.canLease('build'), false);
    assert.equal(governor.canLease('remote'), true);
    assert.equal(governor.telemetry().metrics.frameTime.value, 40);
    note({ aerynthFocused: false });
    assert.equal(governor.telemetry().metrics.frameTime.value, null);
    assert.equal(governor.canLease('build'), true);
  } finally { governor.dispose(); }
});

test('sleep closes local admission and resume requires a fresh RAM observation', () => {
  const governor = createMissionAdmission({ maxWorkers: 3, availableMemory: () => 1024 ** 3, readWindowsPressure: null });
  const note = governor.noteResourceSignal;
  const power = (suspended: boolean) => ({ hostPower: { suspended, battery: false, idleSeconds: 0, speedLimitPercent: null } });
  try {
    governor.read(true);
    assert.equal(governor.canLease('host_io'), true);
    note(power(true));
    governor.read(true);
    assert.equal(governor.canLease('host_io'), false);
    assert.equal(governor.canLease('remote'), true);
    note(power(false));
    assert.equal(governor.canLease('host_io'), false);
    governor.read(true);
    assert.equal(governor.canLease('host_io'), true);
  } finally { governor.dispose(); }
});

test('the private transport validates bounded source summaries', () => {
  assert.equal(isResourceSignal({ aerynthFocused: true, storageAdmitted: true }), false);
  assert.equal(isResourceSignal({ rendererTiming: { frameP95Ms: 30, budgetRatioP95: 2, samples: 10, windowMs: 2000 } }), false);
  assert.equal(isResourceSignal({ hostPower: { battery: null, idleSeconds: null, speedLimitPercent: 101, suspended: false } }), false);
  assert.equal(isResourceSignal({ rendererTiming: { frameP95Ms: 30, budgetRatioP95: 2, samples: 24, windowMs: 2000 } }), true);
});

test('throughput requires measured idle headroom and backs off on battery', () => {
  let time = 0;
  const governor = createMissionAdmission({ maxWorkers: 3, now: () => time,
    availableMemory: () => 1024 ** 3, cpuCounters: () => ({ logicalCpus: 4, total: time * 4, idle: time * 3 }),
    readWindowsPressure: null });
  const power = (idleSeconds: number, battery = false) => ({ hostPower: { idleSeconds, battery,
    suspended: false, speedLimitPercent: null } });
  try {
    const initial = governor.inspectPolicy();
    governor.configurePolicy(initial.configVersion, { mode: 'max_throughput', limits: initial.limits });
    governor.noteResourceSignal(power(0));
    governor.read(true);
    time = 3500;
    governor.read(true);
    assert.equal(governor.inspectPolicy().effective.cpu, 2);
    governor.noteResourceSignal(power(20));
    assert.equal(governor.inspectPolicy().effective.cpu, 3);
    governor.noteResourceSignal(power(20, true));
    assert.equal(governor.inspectPolicy().effective.cpu, 1);
    assert.equal(governor.inspectPolicy().effective.remote, initial.effective.remote);
  } finally { governor.dispose(); }
});

test('external desktop protection requires opt-in, recent input and measured pressure', () => {
  let time = 0;
  const governor = createMissionAdmission({ maxWorkers: 3, now: () => time,
    availableMemory: () => 1024 ** 3, cpuCounters: () => ({ logicalCpus: 4, total: time * 4, idle: time * 0.6 }),
    readWindowsPressure: null });
  const power = (idleSeconds: number | null) => ({ hostPower: { idleSeconds, battery: false,
    suspended: false, speedLimitPercent: null } });
  try {
    governor.noteResourceSignal({ aerynthFocused: false });
    governor.noteResourceSignal(power(0));
    governor.read(true);
    time = 3500;
    const initial = governor.read(true);
    assert.equal(initial.readings.cpuPercent?.value, 85);
    assert.equal(governor.telemetry().metrics.externalDesktopActivity.availability, 'disabled');
    assert.equal(governor.canLease('build'), true);
    const settings = governor.inspectPolicy();
    governor.configurePolicy(settings.configVersion, { mode: settings.mode, limits: settings.limits, protectExternalActivity: true });
    assert.equal(governor.telemetry().metrics.externalDesktopActivity.value, 1);
    assert.ok(governor.read(true).reasons.includes('external-desktop-activity'));
    assert.equal(governor.inspectPolicy().reason, 'external_desktop_activity');
    assert.equal(governor.canLease('build'), false);
    assert.equal(governor.canLease('remote'), true);
    governor.noteResourceSignal({ aerynthFocused: true });
    assert.equal(governor.telemetry().metrics.externalDesktopActivity.value, 0);
    assert.equal(governor.canLease('build'), true);
    governor.noteResourceSignal({ aerynthFocused: false });
    time = 7000;
    assert.equal(governor.telemetry().metrics.externalDesktopActivity.availability, 'stale');
    assert.equal(governor.read(true).reasons.includes('external-desktop-activity'), false);
    governor.noteResourceSignal(power(null));
    assert.equal(governor.telemetry().metrics.externalDesktopActivity.value, null);
    governor.noteResourceSignal(power(20));
    assert.equal(governor.telemetry().metrics.externalDesktopActivity.value, 0);
  } finally { governor.dispose(); }
});
