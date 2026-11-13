import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { blockDocument } from '../../../block-library/tests/component-dom.mts';
import { Backend } from '../../../integrated-backend/src/service.mts';
import { mountAdaptiveWorkspace } from '../src/adaptive-workspace-surface.ts';
import { mountContextualStream } from '../src/workspace-context-views.ts';
import resourceBroker from '../native/resource-policy-inspection.cjs';
import experienceBroker from '../native/experience-policy-review.cjs';

test('Forensic entry presents canonical mission, governor and experiment evidence with verification writes fenced', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aerynth-aiw-checkpoint-'));
  const backend = new Backend({ path: join(directory, 'state.sqlite'), privateRoot: directory, contentPolicy: 'local-private' },
    { secrets: { available: async () => false, seal: async () => assert.fail(), open: async () => assert.fail() } });
  const dom = blockDocument();
  const restore = dom.install();
  let stream, aiw;
  const until = async check => {
    for (let i = 0; i < 100; i++) {
      if (check()) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(check(), 'Expected evidence did not render');
  };
  try {
    const desktop = await backend.call('desktop', { type: 'createWorkspace', title: 'Synthetic AIW checkpoint', projectId: null });
    const workspaceId = desktop.workspaces[0].id;
    const scope = { workspaceId, projectId: null };
    await backend.call('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId } });
    const call = (name, input) => backend.call(name, input);
    const read = (name, input) => call('missions', { name, input });
    const experiment = await call('aepExperimentNative', { name: 'propose', candidate: 'omit-backend' });
    const experimentId = experiment.experiment.id;
    const result = await call('aepExperimentNative', { name: 'test', id: experimentId });
    assert.equal(result.state, 'rejected');
    const evidence = await read('experience-evidence', { id: experimentId });
    assert.equal(evidence.trials.length, 24);
    const probe = await call('aepExperimentNative', { name: 'start-probe' });
    const page = await call('rendererEventPage', { recent: true, limit: 250 });
    const event = page.events.find(item => item.mission?.id === probe.missionId);
    assert.ok(event);

    // Evaluate only the source-bound gesture predicate. No Electron or window is created.
    const main = await readFile(new URL('../native/desktop-main.cjs', import.meta.url), 'utf8');
    const predicate = main.match(/const policyGesture = ([\s\S]*?\.catch\(\(\) => false\));/u)?.[1];
    assert.ok(predicate);
    assert.match(main, /resourcePolicyInspection\(\{[\s\S]*?hasGesture: policyGesture/u);
    assert.match(main, /experiencePolicyReview\(\{[\s\S]*?hasGesture: policyGesture/u);
    const hasGesture = vm.runInNewContext(predicate, { verify: true });
    const sender = { senderFrame: { executeJavaScript: () => assert.fail('Verification must short-circuit activation') } };
    const policy = await call('resourcePolicyNative', { name: 'inspect' });
    const denyWrite = () => assert.fail('Verification must not open a policy review or attempt a write');
    const resource = resourceBroker.resourcePolicyInspection({
      trusted: () => true, hasGesture, inspect: () => call('resourcePolicyNative', { name: 'inspect' }),
      reviewMode: denyWrite, reviewRollback: denyWrite,
    });
    const rollback = experienceBroker.experiencePolicyReview({
      trusted: () => true, hasGesture, call: denyWrite, show: denyWrite, canWrite: denyWrite,
    });
    const content = dom.doc.createElement('div');
    stream = mountContextualStream(dom.root, {
      snapshot: () => ({ ...scope, ...page, resources: [], workspaceResourceIds: [] }),
      refresh: async () => {},
      inspectMission(id, anchor) {
        assert.equal(id, probe.missionId);
        assert.equal(anchor.dataset.inspectMission, id);
        aiw = mountAdaptiveWorkspace(content, { viewId: 'headless-aiw', scope, initialMissionId: id,
          list: () => read('list', {}), readMission: id => read('read', { id }),
          resourcePolicy: action => resource(sender, action), experience: { scope, read } });
      },
    });
    const row = dom.root.querySelector('[data-stream-mission-id="' + probe.missionId + '"]');
    assert.ok(row);
    assert.equal(row.parentElement.hidden, true);
    [...dom.root.querySelectorAll('button')].find(button => button.textContent === 'Forensic').onclick();
    assert.equal(row.parentElement.hidden, false);
    const details = row.querySelector('details');
    details.open = true;
    details.fire('toggle');
    details.querySelector('[data-inspect-mission]').onclick();
    await until(() => content.querySelector('select')?.value === probe.missionId &&
      content.querySelector('.aw-intelligence-inspection')?.textContent.includes(probe.missionId));
    const tab = zone => content.querySelector('[data-intelligence-zone="' + zone + '"]').onclick();
    tab('resource');
    await until(() => content.textContent.includes('Policy epoch / revision' + policy.epoch + ' / ' + policy.revision));
    assert.ok(content.textContent.includes('Configuration version' + policy.configVersion));
    tab('experiment');
    await until(() => content.textContent.includes('Experiment' + evidence.record.experiment.id));
    assert.ok(content.textContent.includes('Lifecycle' + evidence.record.state));
    assert.ok(content.textContent.includes('Trial evidence (24)'));
    tab('learning');
    await until(() => content.textContent.includes('Dispositionretain baseline'));
    tab('timeline');
    await until(() => content.textContent.includes('experiment revision ' + evidence.record.experiment.revision));
    for (const action of ['mode', 'rollback'])
      await assert.rejects(resource(sender, action), /resource_policy_user_gesture_required/);
    await assert.rejects(rollback(sender, { ...scope, experimentId, policyVersion: 1 }),
      /experience_policy_user_gesture_required/);
    assert.equal((await call('resourcePolicyNative', { name: 'inspect' })).configVersion, policy.configVersion);
    assert.equal((await call('aepExperimentNative', { name: 'inspect-policy' })).version, 1);
    assert.equal((await call('providerActivity', {})).providerRequests, 0);
  } finally {
    aiw?.dispose();
    stream?.dispose();
    restore();
    try { await backend.close(); }
    finally {
      assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
      await rm(directory, { recursive: true, force: true });
    }
  }
});
