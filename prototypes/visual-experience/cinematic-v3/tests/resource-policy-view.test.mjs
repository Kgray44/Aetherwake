import test from 'node:test';
import assert from 'node:assert/strict';
import { blockDocument } from '../../../block-library/tests/component-dom.mts';
import { mountResourcePolicy } from '../src/resource-policy-view.ts';

test('governor readings distinguish configured, effective and reserved state and clear on scope exit', async () => {
  const { doc } = blockDocument();
  const amounts = { cpu: 2, gpu: 0, remote: 3, host_io: 1, build: 1 };
  const policy = { schemaVersion: 1, mode: 'gaming_focus', origin: 'user', reason: 'foreground_protection',
    epoch: 'test-epoch', revision: 3, configVersion: 4, configurationHealth: 'valid', remainingRamReservationBytes: null,
    limits: { ...amounts, cpu: 4 }, effective: amounts, active: { ...amounts, cpu: 1 }, canRollback: true, previousMode: 'balanced',
    windowsCountersSupported: true, windowsMonitoring: false, dedicatedVramEstimate: null, windowsCommitHeadroom: null,
    windowsLowMemory: null, nvidiaGpuThermals: null, externalActivityProtection: false };
  let resolve;
  const view = mountResourcePolicy(doc, () => new Promise(done => { resolve = done; }));
  view.setVisible(true);
  view.setVisible(false);
  resolve(policy);
  await Promise.resolve();
  assert.doesNotMatch(view.element.textContent, /test-epoch/);
  view.setVisible(true);
  resolve(policy);
  await Promise.resolve();
  assert.match(view.element.textContent, /Foreground \/ Gaming · user/);
  assert.match(view.element.textContent, /2 effective \/ 4 configured · 1 reserved/);
  assert.match(view.element.textContent, /Estimated dedicated VRAM headroomUnavailable/);
  view.setVisible(false);
  assert.doesNotMatch(view.element.textContent, /test-epoch/);
});
