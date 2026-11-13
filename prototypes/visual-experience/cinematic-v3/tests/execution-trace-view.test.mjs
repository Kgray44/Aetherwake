import test from 'node:test';
import assert from 'node:assert/strict';
import { blockDocument } from '../../../block-library/tests/component-dom.mts';
import { mountExecutionTrace, projectTraceClocks } from '../src/execution-trace-view.ts';

const attempt = (id, clock, start, end) => ({
  id, taskId: 'task-' + id, state: 'verified', executor: 'local.cpu',
  interval: clock ? { id, clock, start, end } : null,
  start: { eventSeq: 7, utc: '2026-11-12T00:00:00Z' },
  end: { eventSeq: 8, utc: '2026-11-12T00:00:01Z' },
  verifiedEvidenceIds: ['test-evidence-' + id], predecessors: [],
});
const attempts = [attempt('first', 'one', 100, 300), attempt('second', 'one', 200, 500),
  attempt('other-clock', 'two', 5, 25), attempt('unknown', null)];
const profile = { missionId: 'test-mission', attempts, work: { criticalPath: { attemptIds: ['second'] } } };

test('trace normalizes spans within their own clock and leaves missing intervals unmeasured', () => {
  const clocks = projectTraceClocks(attempts);
  assert.deepEqual(clocks.map(clock => [clock.clock, clock.start, clock.duration]), [['one', 100, 400], ['two', 5, 20]]);
  assert.deepEqual(clocks[0].attempts.map(span => [span.attempt.id, span.offset, span.duration]), [['first', 0, 200], ['second', 100, 300]]);
  assert(!clocks.flatMap(clock => clock.attempts).some(span => span.attempt.id === 'unknown'));
});

test('attempt controls retain canonical identity during refresh and clear on access withdrawal', () => {
  const { doc, root } = blockDocument();
  const view = mountExecutionTrace(doc);
  root.append(view.element);
  view.update(profile);
  const control = root.querySelector('[data-trace-attempt="second"]');
  assert.equal(control.dataset.criticalPath, 'true');
  control.onclick();
  assert.match(root.textContent, /test-evidence-second/);
  assert.match(root.textContent, /Start event7/);
  view.update(null);
  assert.doesNotMatch(root.textContent, /test-evidence-second/);
  view.update(profile);
  assert.match(root.textContent, /test-evidence-second/);
  view.update(null, true);
  view.update(profile);
  assert.doesNotMatch(root.textContent, /test-evidence-second/);
});
