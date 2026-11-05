import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const argument = process.argv[2];
assert(process.argv.length === 3 && argument?.startsWith('--profile='), 'Select the isolated evaluation profile');
const profile = argument.slice('--profile='.length);
assert(isAbsolute(profile) && /^review-vela-air-plan-\d+$/u.test(basename(profile)), 'Select the isolated evaluation profile');
const receipts = Array.from({ length: 6 }, (_, index) => {
  const batch = index + 1, path = join(profile, 'air-plan-evaluation', `held-out-${batch}.jsonl`);
  assert(statSync(path).size <= 16 * 1024);
  const [start, ...rows] = readFileSync(path, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  assert(start.type === 'begin' && start.contract === 'aerynth.air-held-out-plan@1' && start.batch === batch);
  assert.deepEqual(rows.pop(), { type: 'complete', batch });
  assert.equal(rows.length, 8);
  assert.equal(rows.filter(row => row.condition === 'first-turn-in-process').length, 1);
  assert.match(start.revision, /^[a-f0-9]{40}$/u);
  return { start, rows };
});
const revision = receipts[0].start.revision;
assert(receipts.every(receipt => receipt.start.revision === revision), 'Source revisions changed within the evaluation');
const turns = receipts.flatMap(receipt => receipt.rows);
for (let caseNumber = 1; caseNumber <= 24; caseNumber++) {
  const pair = turns.filter(row => row.caseNumber === caseNumber);
  assert.deepEqual(pair.map(row => row.arm), caseNumber % 2 === 1 ? ['baseline', 'adaptive'] : ['adaptive', 'baseline']);
  assert(pair.every(row => row.type === 'turn' && Number.isFinite(row.taskMs) && row.taskMs >= 0 &&
    typeof row.correct === 'boolean' && typeof row.verified === 'boolean' && typeof row.routeCorrect === 'boolean'));
}

const db = new DatabaseSync(join(profile, 'aerynth.sqlite'), { readOnly: true, timeout: 4000 });
const optionalNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const rows = [];
try {
  const execution = db.prepare(`SELECT json_extract(value,'$.state') state, json_extract(value,'$.providerId') providerId,
    json_extract(value,'$.startedAt') startedAt, json_extract(value,'$.endedAt') endedAt,
    json_extract(value,'$.reportedModel') model, json_extract(value,'$.requestedReasoningEffort') effort,
    json_extract(value,'$.usage.totalTokens') tokens
    FROM integration_state s, json_each(s.json,'$.executions') WHERE json_extract(value,'$.id')=?`);
  const output = db.prepare(`SELECT json_extract(json,'$.receivedAt') receivedAt FROM intelligence_events
    WHERE json_extract(json,'$.executionId')=? AND json_extract(json,'$.type')='item/agentMessage/delta'
    AND json_extract(json,'$.payload.textBytes')>0 ORDER BY cursor LIMIT 1`);
  const timing = db.prepare(`SELECT json_extract(json,'$.payload.timing') timing FROM intelligence_events
    WHERE json_extract(json,'$.correlationId')=? AND json_extract(json,'$.type')='vela.routing.stage_started' ORDER BY cursor LIMIT 1`);
  for (const row of turns) {
    const run = row.executionId ? execution.get(row.executionId) : undefined;
    if (row.verified) {
      assert(run?.state === 'provider_completed' && run.providerId === 'chatgpt-plan-responses');
      assert(run.model === row.model && run.effort === row.effort);
      if (row.totalTokens !== null) assert.equal(run.tokens, row.totalTokens);
    }
    const start = run?.startedAt ? Date.parse(String(run.startedAt)) : NaN;
    const first = row.executionId ? output.get(row.executionId)?.receivedAt : undefined;
    const firstOutputMs = first ? optionalNumber(Date.parse(String(first)) - start) : null;
    const executionMs = run?.endedAt ? optionalNumber(Date.parse(String(run.endedAt)) - start) : null;
    const stored = row.requestId ? timing.get(row.requestId)?.timing : undefined;
    const stage = typeof stored === 'string' ? JSON.parse(stored) : undefined;
    const { requestId: _request, executionId: _execution, type: _type, ...safe } = row;
    rows.push({ ...safe, firstOutputMs, executionMs, timing: {
      routingMs: optionalNumber(stage?.routingMs), capabilityMs: optionalNumber(stage?.capabilityMs),
      contextMs: optionalNumber(stage?.contextMs), previewMs: optionalNumber(stage?.previewMs),
    } });
  }
} finally { db.close(); }

const quantiles = (samples: (number | null)[]) => {
  const ordered = samples.flatMap(value => value === null ? [] : [value]).sort((a, b) => a - b);
  const at = (fraction: number) => ordered[Math.ceil(ordered.length * fraction) - 1] ?? null;
  return { count: ordered.length, p50: at(0.5), p95: at(0.95) };
};
function summarize(samples: typeof rows) {
  const complete = samples.filter(row => row.verified);
  return {
    attempts: samples.length, models: [...new Set(samples.map(row => row.model))], completed: complete.length,
    routeCorrect: samples.filter(row => row.routeCorrect).length, rubricPassed: complete.filter(row => row.correct).length,
    providerFailures: samples.length - complete.length, escalationsRequested: samples.reduce((sum, row) => sum + row.escalationsRequested, 0),
    taskMs: quantiles(complete.map(row => row.taskMs)), executionMs: quantiles(complete.map(row => row.executionMs)),
    firstOutputMs: quantiles(complete.map(row => row.firstOutputMs)), reportedTokens: quantiles(complete.map(row => row.totalTokens)),
    routingMs: quantiles(complete.map(row => row.timing.routingMs)), capabilityMs: quantiles(complete.map(row => row.timing.capabilityMs)),
    contextMs: quantiles(complete.map(row => row.timing.contextMs)), previewMs: quantiles(complete.map(row => row.timing.previewMs)),
  };
}
const suites = Object.fromEntries(['everyday', 'technical', 'reasoning'].map(suite =>
  [suite, Object.fromEntries(['baseline', 'adaptive'].map(arm => [arm, summarize(rows.filter(row => row.suite === suite && row.arm === arm))]))]));
console.log(JSON.stringify({
  contract: 'aerynth.air-held-out-plan-report@1', revision, cases: turns.length / 2, suites,
  processConditions: Object.fromEntries(['first-turn-in-process', 'subsequent-turn'].map(condition =>
    [condition, summarize(rows.filter(row => row.condition === condition))])),
  upstreamCache: 'unknown', catalogBeforeFirstTurn: 'probed', monetaryCost: 'unavailable', rows,
}, null, 2));
