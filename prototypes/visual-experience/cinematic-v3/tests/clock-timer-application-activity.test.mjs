import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

test('a newly visible canonical clock card mounts its product view on the application activity transition', () => {
  const source = readFileSync(new URL('../src/application.ts', import.meta.url), 'utf8');
  const start = source.indexOf('  function syncBlockActivity(id: string) {');
  const end = source.indexOf('  function frameBlockViews(', start);
  assert(start >= 0 && end > start);
  const activeBlocks = new Map(), blockPresentations = new Map([['clock-block', { usable: false }]]);
  const clockTimerViews = new Map(), activity = [], mounts = [], article = {};
  const context = {
    state: { blocks: [{ id: 'clock-block', resource_id: 'canonical-clock' }], resources: [{ id: 'canonical-clock', kind: 'clock_timer' }] },
    activeBlocks, blockPresentations, clockTimerViews, unavailableBlocks: new Set(), identityViews: new Map(), focusedBlocks: new Map(),
    missionWorkroomCardIds: new Set(), ensureNoteView() {}, blockPresentation: () => 'workspace',
    document: { querySelector(selector) { assert.equal(selector, '[data-block="clock-block"]'); return article; } },
    decorate(node, id) {
      assert.equal(node, article); mounts.push(id);
      clockTimerViews.set(id, { view: { setPresentation() {}, setActive(value) { activity.push(value); } } });
    },
  };
  for (const name of ['chatViews', 'noteViews', 'missionDashboardViews', 'subjectViews', 'eventViews', 'groupViews', 'checklistViews',
    'agentBlockViews', 'timelineViews', 'taskTrackerViews', 'mediaViews', 'folderViews']) context[name] = new Map();
  vm.createContext(context);
  vm.runInContext(ts.transpile(source.slice(start, end)), context);
  vm.runInContext('syncBlockActivity("clock-block")', context);
  assert.deepEqual(mounts, [], 'offscreen cards do not start reading or scheduling renderer work');
  blockPresentations.set('clock-block', { usable: true });
  vm.runInContext('syncBlockActivity("clock-block")', context);
  assert.deepEqual(mounts, ['clock-block']); assert.deepEqual(activity, [true]);
  vm.runInContext('syncBlockActivity("clock-block")', context);
  assert.deepEqual(mounts, ['clock-block'], 'stable visibility reuses the mounted canonical view');
  blockPresentations.set('clock-block', { usable: false });
  vm.runInContext('syncBlockActivity("clock-block")', context);
  assert.deepEqual(activity, [true, true, false]);
});
