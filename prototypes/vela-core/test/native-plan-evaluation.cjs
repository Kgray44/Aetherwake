const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdirSync, mkdtempSync, writeFileSync, appendFileSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { velaCommand } = require('../../visual-experience/cinematic-v3/native/vela-broker.cjs');

const providerId = 'chatgpt-plan-responses';
const initialQuestion = 'What is the capital of Finland? Answer with just the city name.';
const deepQuestion = 'Derive the formula for the sum of the first n odd numbers. Include the formula and one reason it holds.';
const cases = [
  ['Put these names in alphabetical order: Maya, Eli, Jo. Answer with just the three names separated by commas.', 'eli,jo,maya'],
  ['What word is the opposite of empty? One word.', 'full'],
  ['Write the initials of Ada Lovelace. Use two letters.', 'al'],
  ['Which is larger, 0.09 or 0.9? Answer with only the number.', '0.9'],
  ['What month comes after September? One word.', 'october'],
  ['Turn 150 centimeters into meters. Answer with the number only.', '1.5'],
  ['What is the chemical symbol for gold? Just the symbol.', 'au'],
  ['Which day is two days after Thursday? Give just the weekday.', 'saturday'],
  ['For a list of red, green, and blue, give the middle color.', 'green'],
  ['Write the book is blue in uppercase. Keep the same four words.', 'thebookisblue'],
  ['The meeting moved from 2 PM to 4 PM. What is the new time? Answer with just the time.', '4pm'],
  ['Which is a mammal, a trout or a bat? One word.', 'bat'],
];
const clean = value => value.toLowerCase().trim().replace(/["'`*\s]/gu, '').replace(/[.!?]+$/u, '');
const allowed = new Set([initialQuestion, deepQuestion, ...cases.map(([question]) => question)]);
const mixedIntent = 'Read the log note, explain why the screen stuttered, then edit sample.json so the count is two and run the benchmark';
const mixedNext = 'edit sample.json so the count is two and run the benchmark';

async function runMixed({ win, app, privateRoot, call }) {
  const directory = join(privateRoot, 'air-plan-evaluation');
  const output = join(directory, 'mixed.jsonl');
  const record = value => appendFileSync(output, JSON.stringify(value) + '\n');
  const intent = mixedIntent;
  const log = 'Synthetic frame 41 took 80 ms when count was 1. The known stable value is 2.';
  const before = '{"count":1}\n';
  let passed = false;
  try {
    const start = await call('vela', { name: 'state', input: {} });
    assert(start.requests.length === 26 && start.requests.every(request => allowed.has(request.intent)), 'Complete the synthetic comparison before the mixed test');
    assert.equal((await call('ordinaryProviderStatus', {})).state, 'ready');
    writeFileSync(output, JSON.stringify({ type: 'begin', contract: 'aerynth.air-live-mixed@1' }) + '\n', { flag: 'wx' });
    const fixtureRoot = resolve(__dirname, '../../integrated-backend/.runtime');
    mkdirSync(fixtureRoot, { recursive: true });
    const checkout = mkdtempSync(join(fixtureRoot, 'vela-air-live-mixed-'));
    const editFile = join(checkout, 'sample.json'), benchmarkFile = join(checkout, 'sample.bench.mjs');
    writeFileSync(editFile, before, { flag: 'wx' });
    writeFileSync(benchmarkFile, `import { readFileSync } from 'node:fs';
const times = Array.from({ length: 12 }, () => {
  const start = performance.now();
  if (JSON.parse(readFileSync('sample.json', 'utf8')).count !== 2) throw Error('The edit is missing');
  return performance.now() - start;
}).sort((a, b) => a - b);
console.log(JSON.stringify({ samples: times.length, medianMs: times[5], p95Ms: times[11] }));
`, { flag: 'wx' });
    const git = (...args) => execFileSync('git.exe', ['-C', checkout, '-c', 'core.hooksPath=NUL', ...args],
      { windowsHide: true, timeout: 6000, stdio: 'pipe', maxBuffer: 8192 });
    git('init', '--quiet', '--template=');
    git('add', '--', 'sample.json', 'sample.bench.mjs');
    git('-c', 'user.name=AIR synthetic acceptance', '-c', 'user.email=air-test@example.invalid', 'commit', '--quiet', '-m', 'Synthetic mixed workflow inputs');
    const workspace = await call('desktop', { type: 'createWorkspace', title: 'Synthetic mixed workflow', projectId: null });
    const notes = await call('desktop', { type: 'createResource', title: 'Synthetic frame log', kind: 'note', workspaceId: workspace.activeWorkspaceId });
    const note = notes.resources.find(resource => resource.title === 'Synthetic frame log');
    assert(note);
    await call('desktop', { type: 'content', resourceId: note.id, expectedVersion: note.version, content: log });
    const stages = [];
    const dialog = {
      async showOpenDialog(parent, options) {
        assert.equal(parent, win);
        const benchmark = options.title.includes('.bench');
        if (!benchmark) assert.match(options.title, /tracked files/u);
        return { canceled: false, filePaths: [benchmark ? benchmarkFile : editFile] };
      },
      async showMessageBox(parent, options) {
        assert.equal(parent, win);
        assert.match(options.detail, /sample\.bench\.mjs/u);
        assert.match(options.detail, /read-only sandbox/u);
        stages.push('benchmark review');
        return { response: 0 };
      },
    };
    const request = await velaCommand({ win, call, dialog, directMessageSend: true, offerPlanningByDefault: true,
      input: { name: 'request', input: { intent, resourceIds: [note.id], authorizeProvider: true } },
      async reviewProvider({ review }) {
        const payload = JSON.parse(review.prompt.split('\n').at(-1));
        if (review.providerId === providerId) {
          assert.equal(review.route.nativeLog, true);
          assert.deepEqual(review.context.included.map(source => [source.id, source.content]), [[note.id, log]]);
          assert.equal(payload.intent, 'explain why the screen stuttered');
          stages.push('synthetic log analysis review');
        } else {
          assert.equal(review.providerId, 'codex-app-server');
          assert.equal(review.handoff.sourceProviderId, providerId);
          assert.equal(review.history.messages.length, 2);
          assert.deepEqual(review.editPaths, [editFile]);
          assert.deepEqual(payload.files, [{ path: 'sample.json', operation: 'replace', content: before }]);
          assert.equal(review.context.included.length, 0);
          stages.push('Codex handoff and proposal review');
        }
        return true;
      },
    });
    assert.equal(request.state, 'responded', request.errorCode);
    assert.equal(request.route.followUpCheck, 'node-benchmark');
    assert(request.handoff.taskId && request.handoff.taskId !== request.id);
    assert.equal(readFileSync(editFile, 'utf8'), before);
    const result = await velaCommand({ win, call, dialog, input: { name: 'applyFileEdit', input: { requestId: request.id } },
      async reviewProvider({ review, experience }) {
        assert.equal(experience, 'file-edit');
        assert.equal(review.files.length, 1);
        assert.equal(review.files[0].path, editFile);
        assert.equal(review.files[0].before, before);
        assert.deepEqual(JSON.parse(review.files[0].after), { count: 2 });
        stages.push('exact file change review');
        return true;
      },
    });
    assert.equal(result.state, 'applied');
    assert.deepEqual(JSON.parse(readFileSync(editFile, 'utf8')), { count: 2 });
    const benchmark = result.projectChecks.find(item => item.kind === 'node-benchmark');
    assert.equal(benchmark.state, 'passed');
    assert.equal(benchmark.benchmark.samples, 12);
    assert.equal((await call('providerActivity', {})).providerRequests, 2);
    assert.deepEqual(stages, ['synthetic log analysis review', 'Codex handoff and proposal review', 'exact file change review', 'benchmark review']);
    record({ type: 'complete', taskContinued: true, providers: [providerId, 'codex-app-server'], modelTurns: 2,
      reviews: stages, writesVerified: 1, benchmark: benchmark.benchmark });
    passed = true;
  } catch (error) {
    console.log(JSON.stringify({ type: 'failure', stage: 'mixed', reason: error instanceof Error ? error.message : 'Unknown error' }));
  } finally {
    console.log(JSON.stringify({ passed, stage: 'mixed', output }));
    process.exitCode = passed ? 0 : 1;
    app.quit();
  }
}

async function runHeldOut({ win, app, privateRoot, call }, batch) {
  const { cases: heldOut } = require('./air-held-out-live.cjs');
  const directory = join(privateRoot, 'air-plan-evaluation'), output = join(directory, `held-out-${batch}.jsonl`);
  const entry = row => appendFileSync(output, JSON.stringify(row) + '\n');
  let passed = false;
  try {
    assert(Number.isInteger(batch) && batch >= 1 && batch <= heldOut.length / 4, 'Explicit held-out batch number required');
    const start = await call('vela', { name: 'state', input: {} });
    const synthetic = new Set([...allowed, mixedIntent, mixedNext, ...heldOut.map(([, intent]) => intent)]);
    assert(start.requests.every(request => synthetic.has(request.intent)), 'Synthetic test profile only');
    assert.equal(start.routingSettings.calibration.mode, 'off');
    const ready = await call('ordinaryProviderStatus', {});
    assert(ready.state === 'ready' && ready.planUsageEnabled);
    const options = await call('vela', { name: 'routingOptions', input: { providerId } });
    const previous = [1, 2, 3].flatMap(number => {
      const receipt = readFileSync(join(directory, `batch-${number}.jsonl`), 'utf8');
      assert(receipt.length <= 16000);
      return receipt.trimEnd().split('\n').map(line => JSON.parse(line))
        .filter(row => row.type === 'turn' && row.arm !== 'deep');
    });
    const first = previous.find(row => row.arm === 'baseline');
    assert.equal(previous.length, 24);
    assert(first && previous.every(row => row.state === 'provider_completed' && row.effort === first.effort));
    const { compareVelaCalibration } = await import('../src/routing-calibration.ts');
    const quick = compareVelaCalibration({ mode: 'adaptive', depth: 'quick', projectId: null, effort: first.effort,
      baseline: first.model, candidates: options.filter(model => model.reasoningEfforts?.includes(first.effort)).map(model => model.id),
      samples: previous.map((row, index) => ({ requestId: 'synthetic-prior-' + index, projectId: null, model: row.model,
        effort: row.effort, depth: 'quick', evidence: 'observed', completed: true, modelConfirmed: true,
        elapsedMs: row.elapsedMs, totalTokens: row.totalTokens, feedback: row.correct ? 'useful' : 'needs-correction' })),
    });
    assert(quick, 'Previously observed Quick candidate no longer qualifies against the current catalog');
    const source = resolve(__dirname, '../../..');
    const git = (...args) => execFileSync('git.exe', args, { cwd: source, encoding: 'utf8', windowsHide: true, timeout: 5000 }).trim();
    assert.equal(git('status', '--porcelain'), '', 'Live evaluation requires a clean source revision');
    writeFileSync(output, JSON.stringify({ type: 'begin', contract: 'aerynth.air-held-out-plan@1', batch,
      revision: git('rev-parse', 'HEAD'), qualification: 'prior paired evidence, replayed through the production ranker',
      upstreamCache: 'unknown', catalogBeforeFirstTurn: 'probed' }) + '\n', { flag: 'wx' });
    let indexInProcess = 0;
    for (let index = (batch - 1) * 4; index < batch * 4; index++) {
      const [suite, intent, grade] = heldOut[index];
      const preview = await call('velaRequestPreview', { intent, resourceIds: [], adaptive: true, overrideDefaults: true });
      assert(preview.route?.kind === 'conversational' && preview.providerId === providerId && preview.route.effort);
      const { depth, model: baseline, effort } = preview.route;
      const expectedDepth = suite === 'reasoning' ? 'deep' : 'quick';
      // Held-out observations do not feed back into the selection. Deep has no qualified prior alternative.
      const alternative = depth === 'quick' && baseline === quick.baseline.model && effort === first.effort ? quick.alternative.model : baseline;
      const arms = index % 2 === 0 ? ['baseline', 'adaptive'] : ['adaptive', 'baseline'];
      for (const arm of arms) {
        const condition = indexInProcess++ === 0 ? 'first-turn-in-process' : 'subsequent-turn';
        const selected = arm === 'baseline' ? baseline : alternative;
        const started = performance.now();
        let request, row;
        try {
          request = await velaCommand({ win, call, directMessageSend: true, offerPlanningByDefault: true,
            input: { name: 'request', input: { intent, resourceIds: [], authorizeProvider: true, overrideDefaults: true,
              providerId, model: selected, reasoningEffort: effort } },
            reviewProvider() { throw Error('Unexpected attached or private context in held-out evaluation'); },
          });
          const taskMs = performance.now() - started;
          const current = await call('vela', { name: 'state', input: {} });
          const response = current.conversation.messages.find(item => item.id === request.response?.messageId);
          const snapshot = await call('snapshot', {});
          const execution = snapshot.executions[response?.providerContribution?.executionId];
          const verified = request.state === 'responded' && execution?.state === 'provider_completed' &&
            execution.providerId === providerId && response.classification === 'reported' &&
            execution.reportedModel === selected && execution.requestedReasoningEffort === effort;
          row = { state: request.state, requestId: request.id, executionId: execution?.id, errorCode: request.errorCode,
            taskMs, verified, correct: verified && grade(response.content),
            totalTokens: execution?.usage?.source === 'provider-reported' ? execution.usage.totalTokens : null };
        } catch (error) {
          row = { state: 'request-error', taskMs: performance.now() - started, verified: false, correct: false,
            errorCode: typeof error?.code === 'string' ? error.code : 'request_failed', totalTokens: null };
        }
        entry({ type: 'turn', caseNumber: index + 1, suite, arm, condition, model: selected, effort, depth,
          routeCorrect: depth === expectedDepth, escalationsRequested: 0, ...row });
      }
    }
    entry({ type: 'complete', batch });
    passed = true;
  } catch (error) {
    console.log(JSON.stringify({ type: 'failure', batch, reason: error instanceof Error ? error.message : 'Unknown error' }));
  } finally {
    console.log(JSON.stringify({ passed, batch, output }));
    process.exitCode = passed ? 0 : 1;
    app.quit();
  }
}

exports.run = async ({ win, app, privateRoot, call }) => {
  if (process.argv.includes('--air-plan-mixed')) return runMixed({ win, app, privateRoot, call });
  const heldOut = process.argv.find(value => value.startsWith('--air-plan-held-out='));
  if (heldOut) return runHeldOut({ win, app, privateRoot, call }, Number(heldOut.slice('--air-plan-held-out='.length)));
  const argument = process.argv.find(value => value.startsWith('--air-plan-batch='));
  const batch = Number(argument?.slice('--air-plan-batch='.length));
  assert([1, 2, 3].includes(batch), 'Explicit live batch number 1, 2, or 3 required');
  const directory = join(privateRoot, 'air-plan-evaluation');
  mkdirSync(directory, { recursive: true });
  const output = join(directory, `batch-${batch}.jsonl`);
  const entry = value => appendFileSync(output, JSON.stringify(value) + '\n');
  let passed = false;
  try {
    const state = await call('vela', { name: 'state', input: {} });
    assert(state.requests.some(request => request.intent === initialQuestion && request.state === 'responded'), 'Run the visible synthetic smoke check first');
    assert(state.requests.every(request => allowed.has(request.intent)), 'Synthetic test profile only');
    assert(state.routingSettings.calibration.mode === 'off', 'Keep operational calibration preferences separate from this controlled comparison');
    const status = await call('ordinaryProviderStatus', {});
    assert(status.state === 'ready' && status.planUsageEnabled, 'ChatGPT-plan authorization is unavailable');
    const options = await call('vela', { name: 'routingOptions', input: { providerId } });
    const preview = await call('velaRequestPreview', { intent: cases[0][0], resourceIds: [], adaptive: true, overrideDefaults: true });
    const baseline = preview.route?.model, effort = preview.route?.effort;
    assert(preview.route?.kind === 'conversational' && preview.providerId === providerId && baseline && effort);
    const eligible = options.filter(option => option.id !== baseline && option.reasoningEfforts?.includes(effort));
    const alternative = (eligible.find(option => /luna/u.test(option.id)) ?? eligible[0])?.id;
    assert(alternative, 'A second model with the same supported effort is required');
    // A dispatch marker is exclusive. An interrupted batch cannot be replayed automatically.
    writeFileSync(output, JSON.stringify({ type: 'begin', contract: 'aerynth.air-plan-evaluation@1', batch, baseline, alternative, effort }) + '\n', { flag: 'wx' });
    const send = async (intent, selection, grade, caseNumber, arm) => {
      const before = performance.now();
      const request = await velaCommand({ win, call, directMessageSend: true, offerPlanningByDefault: true,
        input: { name: 'request', input: { intent, resourceIds: [], authorizeProvider: true, overrideDefaults: true, ...selection } },
        reviewProvider() { throw Error('Unexpected attached or private context in a synthetic evaluation request'); },
      });
      const elapsedMs = Math.round(performance.now() - before);
      if (request.state !== 'responded') {
        entry({ type: 'turn', caseNumber, arm, state: request.state, errorCode: request.errorCode, elapsedMs });
        throw Error('Live provider did not return a usable result');
      }
      const current = await call('vela', { name: 'state', input: {} });
      const message = current.conversation.messages.find(item => item.id === request.response?.messageId);
      const snapshot = await call('snapshot', {});
      const execution = snapshot.executions[message?.providerContribution?.executionId];
      assert(execution?.state === 'provider_completed' && execution.providerId === providerId && message.classification === 'reported');
      assert(execution.reportedModel === request.route.model && execution.requestedReasoningEffort === request.route.effort);
      assert(execution.usage?.source === 'provider-reported');
      const row = { type: 'turn', caseNumber, arm, state: execution.state, correct: grade(message.content), elapsedMs,
        model: execution.reportedModel, effort: execution.requestedReasoningEffort, totalTokens: execution.usage.totalTokens };
      entry(row);
      console.log(JSON.stringify(row));
      return row;
    };
    if (batch === 1) {
      const deep = await send(deepQuestion, { mode: 'deep' }, content => /n\s*(?:\^\s*\{?2|²)/iu.test(content), 0, 'deep');
      assert(deep.correct && ['high', 'xhigh', 'max', 'medium'].includes(deep.effort), 'The deep answer or its reasoning control did not pass');
    }
    for (let index = (batch - 1) * 4; index < batch * 4; index++) {
      const [question, expected] = cases[index];
      const order = index % 2 ? [['alternative', alternative], ['baseline', baseline]] : [['baseline', baseline], ['alternative', alternative]];
      for (const [arm, model] of order)
        await send(question, { model, reasoningEffort: effort, providerId }, content => clean(content) === expected, index + 1, arm);
    }
    entry({ type: 'complete', batch });
    passed = true;
  } catch (error) {
    console.log(JSON.stringify({ type: 'failure', batch, reason: error instanceof Error ? error.message : 'Unknown error' }));
  } finally {
    console.log(JSON.stringify({ passed, batch, output }));
    process.exitCode = passed ? 0 : 1;
    app.quit();
  }
};
