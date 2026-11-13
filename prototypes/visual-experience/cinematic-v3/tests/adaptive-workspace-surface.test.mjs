import test from 'node:test';
import assert from 'node:assert/strict';
import { blockDocument } from '../../../block-library/tests/component-dom.mts';
import { mountAdaptiveWorkspace } from '../src/adaptive-workspace-surface.ts';

const mission = { id: 'test-mission', revision: 2, planRevision: 1, outcome: 'verified',
  contract: 'aerynth.vela-mission@1', scope: { workspaceId: 'test-workspace', projectId: null },
  objective: 'Inspect retained evidence', profile: {}, tasks: [], events: [] };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('the workspace keeps the requested mission and erases late reads after its access fence closes', async () => {
  const { doc, root } = blockDocument();
  let resolve, reads = [];
  const view = mountAdaptiveWorkspace(root, {
    viewId: 'test-aiw', scope: mission.scope, initialMissionId: mission.id,
    list: async () => [mission],
    readMission: id => { reads.push(id); return new Promise(done => { resolve = done; }); },
  });
  await tick();
  assert.deepEqual(reads, [mission.id]);
  view.dispose();
  resolve(mission);
  await tick();
  assert.equal(root.querySelector('.aw-intelligence-inspection'), null);
});

test('the workspace rejects a mismatched mission response before mounting evidence', async () => {
  const { root } = blockDocument();
  const view = mountAdaptiveWorkspace(root, {
    viewId: 'test-aiw', scope: mission.scope, initialMissionId: mission.id,
    list: async () => [mission],
    readMission: async () => ({ ...mission, id: 'different-mission' }),
  });
  await tick();
  assert.match(root.textContent, /Mission evidence unavailable/);
  assert.equal(root.querySelector('.aw-intelligence-inspection').hidden, true);
  view.dispose();
});

test('the workspace rejects a same-id mission from a different workspace or project', async () => {
  for (const scope of [{ ...mission.scope, workspaceId: 'other' }, { ...mission.scope, projectId: 'other' }]) {
    const { root } = blockDocument();
    const view = mountAdaptiveWorkspace(root, {
      viewId: 'test-aiw', scope: mission.scope, initialMissionId: mission.id,
      list: async () => [mission],
      readMission: async () => ({ ...mission, scope }),
    });
    await tick();
    assert.match(root.textContent, /Mission evidence unavailable/);
    assert.equal(root.querySelector('.aw-intelligence-inspection').hidden, true);
    view.dispose();
  }
});
