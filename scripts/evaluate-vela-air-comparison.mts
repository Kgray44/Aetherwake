import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { planningDigest } from '../prototypes/vela-core/src/codex-planning-adapter.mts';
import { compareVelaCalibration, type VelaRoutingSample } from '../prototypes/vela-core/src/routing-calibration.ts';

const profile = process.argv[2]?.slice('--profile='.length);
assert(process.argv.length === 3 && process.argv[2].startsWith('--profile=') && profile && isAbsolute(profile) &&
  /^review-vela-air-plan-\d+$/u.test(basename(profile)), 'Select the dedicated AIR test profile');
const runs = [1, 2, 3].map(batch => {
  const path = join(profile, 'air-plan-evaluation', `batch-${batch}.jsonl`);
  assert(statSync(path).size <= 16 * 1024, 'Oversized evaluation receipt');
  const lines = readFileSync(path, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  const [start, ...rest] = lines;
  assert(start.type === 'begin' && start.contract === 'aerynth.air-plan-evaluation@1' && start.batch === batch);
  assert.deepEqual(rest.pop(), { type: 'complete', batch });
  assert.equal(rest.length, batch === 1 ? 9 : 8);
  return { start, turns: rest };
});
const { baseline, alternative, effort } = runs[0].start;
assert(baseline !== alternative && typeof baseline === 'string' && typeof alternative === 'string');
for (const run of runs) assert.deepEqual([run.start.baseline, run.start.alternative, run.start.effort], [baseline, alternative, effort]);
const turns = runs.flatMap(run => run.turns);
assert.equal(turns[0].arm, 'deep');
assert.equal(turns[0].correct, true);
const cases = turns.slice(1);
for (let number = 1; number <= 12; number++) {
  const pair = cases.filter(turn => turn.caseNumber === number);
  assert.equal(pair.length, 2);
  assert.deepEqual(pair.map(turn => turn.arm).sort(), ['alternative', 'baseline']);
}

const db = new DatabaseSync(join(profile, 'aerynth.sqlite'), { readOnly: true });
const samples: VelaRoutingSample[] = [];
try {
  const requests = db.prepare(`SELECT json_extract(value,'$.id') AS id, json_extract(value,'$.state') AS state,
    json_extract(value,'$.route.model') AS model FROM vela_state s, json_each(s.json,'$.requests') ORDER BY CAST(key AS INTEGER)`).all();
  assert(requests.length >= turns.length + 1, 'The evaluation profile is missing requests');
  const executions = db.prepare(`SELECT json_extract(value,'$.id') AS id, json_extract(value,'$.startedAt') AS startedAt,
    json_extract(value,'$.reportedModel') AS model, json_extract(value,'$.usage.totalTokens') AS tokens
    FROM integration_state s, json_each(s.json,'$.executions') WHERE json_extract(value,'$.commandId')=?`);
  const first = db.prepare(`SELECT json_extract(json,'$.receivedAt') AS receivedAt FROM intelligence_events
    WHERE json_extract(json,'$.executionId')=? AND json_extract(json,'$.type')='item/agentMessage/delta'
    AND json_extract(json,'$.payload.textBytes')>0 ORDER BY cursor LIMIT 1`);
  cases.forEach((turn, index) => {
    const request = requests[index + 2], requestId = String(request.id);
    assert.equal(request.state, 'responded');
    assert.equal(turn.state, 'provider_completed');
    assert.equal(request.model, turn.arm === 'baseline' ? baseline : alternative);
    assert.equal(turn.model, request.model);
    assert.equal(turn.effort, effort);
    assert(Number.isSafeInteger(turn.elapsedMs) && turn.elapsedMs >= 0 && Number.isSafeInteger(turn.totalTokens) && turn.totalTokens > 0 && typeof turn.correct === 'boolean');
    const execution = executions.get(`vela-plan:${planningDigest(requestId).slice(0, 32)}:execute`);
    assert(execution && execution.model === turn.model && execution.tokens === turn.totalTokens);
    const firstAt = first.get(String(execution.id))?.receivedAt;
    const firstOutputMs = firstAt ? Date.parse(String(firstAt)) - Date.parse(String(execution.startedAt)) : NaN;
    samples.push({ requestId, projectId: null, model: turn.model, effort, depth: 'quick', evidence: 'observed',
      completed: true, modelConfirmed: true, elapsedMs: turn.elapsedMs, totalTokens: turn.totalTokens,
      ...(Number.isFinite(firstOutputMs) && firstOutputMs >= 0 ? { firstOutputMs } : {}),
      // This is synthetic answer scoring. Nothing is written into user routing preferences or feedback.
      feedback: turn.correct ? 'useful' : 'needs-correction' });
  });
} finally { db.close(); }

const percent = (values: number[], fraction: number) => values.sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
const summary = (model: string) => {
  const runs = samples.filter(sample => sample.model === model);
  const first = runs.flatMap(sample => sample.firstOutputMs === undefined ? [] : [sample.firstOutputMs]);
  return { model, attempts: runs.length, correct: runs.filter(sample => sample.feedback === 'useful').length,
    p50Ms: percent(runs.map(sample => sample.elapsedMs), 0.5), p95Ms: percent(runs.map(sample => sample.elapsedMs), 0.95),
    firstOutputSamples: first.length, p50FirstOutputMs: percent(first, 0.5), p95FirstOutputMs: percent(first, 0.95),
    medianReportedTokens: percent(runs.map(sample => sample.totalTokens!), 0.5) };
};
const shadow = compareVelaCalibration({ mode: 'shadow', projectId: null, depth: 'quick', effort, baseline, candidates: [alternative], samples });
console.log(JSON.stringify({ contract: 'aerynth.air-plan-comparison@1', effort, syntheticCases: 12, deep: turns[0],
  baseline: summary(baseline), alternative: summary(alternative), shadowEligible: !!shadow,
  operationalPreferencesChanged: false }, null, 2));
