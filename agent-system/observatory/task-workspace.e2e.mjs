import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { promisify } from 'node:util';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { chromium } from 'playwright';
import { createWorker } from './sites/worker.mjs';
import { sha256 } from './sites/task-telemetry.mjs';

const read = (path, type = 'utf8') => readFileSync(new URL(path, import.meta.url), type);
const namespace = 'c0cf1399-8a73-4f08-9b10-997063853638';
const taskTitle = 'Worker-backed workspace verification';
const editTitle = 'Worker-backed editor verification';
const owner = 'isolated-browser-test';
const githubToken = 'isolated-github-fixture';

test('Merge Workspace sends exact owner rerun controls and renders sanitized step evidence', {timeout:120_000}, async t => {
  const {origin} = await start(t);
  const browser = await chromium.launch({headless:true,
    ...(process.env.OBSERVATORY_BROWSER_EXECUTABLE ? {executablePath:process.env.OBSERVATORY_BROWSER_EXECUTABLE} : {})});
  t.after(()=>browser.close());
  const page = await browser.newPage({reducedMotion:'reduce',viewport:{width:1080,height:780}});
  const head = 'a'.repeat(40), base = 'b'.repeat(40);
  const run = {id:'00000000-0000-4000-8000-000000000041',version:1,head_sha:head,pr_number:41,
    state:'blocked',policy:{repair_limit:3},evidence:{state:'blocked',reason:'ci_infrastructure',base_sha:base}};
  const access = {ci_enabled:true};
  const operations = [];
  await page.route('**/api/integrations/v1**', async route => {
    const request = route.request();
    if (request.method()==='POST') {
      const body = request.postDataJSON();
      operations.push(body);
      if (body.op==='arm_ci_reruns') run.policy.auto_ci_reruns={status:'armed'};
      if (body.op==='disarm_ci_reruns') run.policy.auto_ci_reruns={status:'disarmed'};
      if (body.op==='refresh') run.evidence.reason='ci_failure';
      if (body.op==='inspect_logs') run.log_diagnostics={head_sha:head,jobs:[
        {workflow_id:12,run_id:110,run_attempt:3,job_id:152,steps:[{number:4,log:{status:'observed',
          facts:[{kind:'source_location',path:'src/example.mjs',line:12,column:4},{kind:'test_ordinal',code:13}]}}]},
      ]};
      run.version++;
      return route.fulfill({json:{run,access}});
    }
    return route.fulfill({json:new URL(request.url()).searchParams.has('id') ?
      {run,access,events:[]} : {runs:[run],access}});
  });
  await page.goto(origin+'/#merge');
  await page.getByRole('button',{name:/PR #41/}).click();
  const arm = page.getByRole('button',{name:'Authorize automatic infrastructure reruns for this head'});
  await arm.focus();
  await arm.press('Enter');
  const disarm = page.getByRole('button',{name:'Disarm automatic CI reruns'});
  await disarm.click();
  assert.deepEqual(operations.map(({op})=>op),['arm_ci_reruns','disarm_ci_reruns']);
  assert.equal(operations[0].head_sha,head);
  assert.equal(operations[0].base_sha,base);
  assert.equal(operations[1].expected_version,2);
  await page.getByRole('button',{name:'Refresh GitHub evidence'}).click();
  await page.getByRole('button',{name:'Read sanitized failed-step diagnostics'}).click();
  await page.getByRole('heading',{name:'Sanitized failed-step diagnostics'}).waitFor();
  await page.getByText('Workflow 12 · run 110 · attempt 3',{exact:true}).waitFor();
  await page.getByText('Job 152 · step 4',{exact:true}).waitFor();
  await page.getByText('src/example.mjs:12:4',{exact:true}).waitFor();
  await page.getByText('Failing TAP test 13',{exact:true}).waitFor();
  assert.deepEqual(operations.map(({op})=>op),['arm_ci_reruns','disarm_ci_reruns','refresh','inspect_logs']);
});

async function start(t, { canonical = false, revision = 'a'.repeat(40) } = {}) {
  const sql = new DatabaseSync(':memory:');
  t.after(() => sql.close());
  for (const name of readdirSync(new URL('./sites/drizzle/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
    sql.exec(read('./sites/drizzle/' + name));
  }
  const DB = {
    prepare(statement) {
      const row = sql.prepare(statement);
      return { bind: (...args) => ({
        first: async () => row.get(...args) ?? null,
        all: async () => ({ results: row.all(...args) }),
        run: async () => ({ meta: row.run(...args) }),
      }) };
    },
  };
  const ajv = addFormats(new Ajv2020({ strict: false }));
  const validate = ajv.compile(JSON.parse(read('../contracts/v1.schema.json')));
  const validateEvent = ajv.compile(JSON.parse(read('../contracts/trace-v1.schema.json')));
  const index = read('./dist/index.html');
  const assets = { '/': { content: index, type: 'text/html; charset=utf-8' } };
  for (const name of readdirSync(new URL('./dist/assets/', import.meta.url))) {
    const path = '/assets/' + name;
    assets[path] = { content: read('./dist' + path), type: path.endsWith('.css') ? 'text/css' : 'application/javascript' };
  }
  const worker = createWorker({
    assets, validate, validateEvent, sourceRevision: revision,
    fetcher: async url => {
      const path = new URL(url).pathname;
      if (path === '/api/docs/models/gpt-6.2-sol.md') return new Response([
        '# Model', 'Model ID: `gpt-6.2-sol`', '## Pricing', '### Text tokens',
        '| Input | $2 | 1M tokens |', '| Cached input | $0.1 | 1M tokens |', '| Output | $10 | 1M tokens |',
      ].join('\n'),{headers:{'content-type':'text/markdown'}});
      if (path.endsWith('/git/ref/heads/main')) return Response.json({ ref: 'refs/heads/main', object: { sha: revision } });
      if (path.endsWith('/actions/runs')) return Response.json({ total_count: 0, workflow_runs: [] });
      return Response.json([]);
    },
  });
  let origin;
  const server = createServer(async (req, res) => {
    const headers = new Headers(req.headers);
    headers.set('oai-authenticated-user-id', owner);
    const method = req.method;
    const request = new Request(new URL(req.url, origin), {
      method, headers, ...(method === 'POST' ? { body: Readable.toWeb(req), duplex: 'half' } : {}),
    });
    const response = !canonical && new URL(request.url).pathname === '/api/task-engine/v1'
      ? new Response(null, { status: 404 })
      : await worker.fetch(request, { DB, OBSERVATORY_TASK_ENGINE_OWNER_ID: owner, ...(canonical?{GITHUB_READ_TOKEN:githubToken}:{}) });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  async function executor(body) {
    const { taskOperation } = await import('./sites/task-engine.mjs');
    const result = await taskOperation({ db: DB, owner, namespace: 'verification:' + namespace,
      body, access: 'worker', validate, revision: () => revision });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body;
  }
  async function seedGithubDetail(key, detail, observed_at) {
    const credential = await sha256(githubToken);
    sql.prepare("INSERT INTO github_details(cache_key,credential_key,retry_at,stored_at,payload,validators) VALUES(?,?,?,?,?,'{}')")
      .run(key,credential,Date.now()+600_000,Date.now(),JSON.stringify({detail,observed_at,status:'available'}));
  }
  return { origin, executor, seedGithubDetail };
}

test('keyboard, reduced motion, versioned edits, dependency admission and reload in the real workspace', { timeout: 120_000 }, async t => {
  const { origin } = await start(t);
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.OBSERVATORY_BROWSER_EXECUTABLE ? { executablePath: process.env.OBSERVATORY_BROWSER_EXECUTABLE } : {}),
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ reducedMotion: 'reduce', viewport: { width: 1280, height: 850 } });
  await page.clock.install();
  const pageErrors = [];
  const loadedScripts = [];
  page.on('request', request => { if (request.resourceType() === 'script') loadedScripts.push(request.url()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  const url = origin + '/?verification=' + namespace;
  await page.goto(url + '#tasks');
  await page.getByRole('heading', { name: 'Task explorer' }).waitFor();
  assert.equal(loadedScripts.some(url => /engineering-analytics-page|github-activity-pages/.test(url)), false);
  assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
  assert.equal(await page.locator('canvas.ambient-canvas').evaluate(node => node.width), 300);

  await page.getByRole('button', { name: 'Create proposal' }).click();
  await page.getByLabel('Task title').fill(taskTitle);
  await page.getByLabel('Tangible objective').fill('Exercise persisted creation and editing against the isolated Worker.');
  await page.getByLabel('Prerequisite task IDs').fill('unknown-prerequisite');
  await page.getByLabel('Acceptance criteria').fill('Reload the editor and check the saved title.');
  await page.getByLabel('Requirements',{exact:false}).fill('document | https://example.test/design');
  await page.getByLabel('Input artifacts').fill('private-artifact:current-output');
  await page.getByLabel('Planned deliverables').fill('Verified implementation and a summary');
  await page.getByText('unverified', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Create proposed task' }).click();
  await page.getByRole('heading', { name: 'Task editor' }).waitFor();
  const detailUrl = page.url();
  const id = new URL(detailUrl).hash.split('/').at(-1);
  const editor = page.getByRole('form', { name: 'Edit proposed task' });
  await editor.getByLabel('Prerequisite Task IDs').fill(id);
  await page.getByText('A Task cannot be its own prerequisite.').waitFor();
  assert.equal(await editor.getByRole('button', { name: 'Save proposal' }).isDisabled(), true);
  await editor.getByLabel('Prerequisite Task IDs').fill('unknown-prerequisite');
  await editor.getByLabel('Task title').fill(editTitle);
  await editor.getByLabel('Priority').selectOption('urgent');
  await editor.getByLabel('Planned deliverables').fill('Implementation PR with checked output');
  await editor.getByRole('button', { name: 'Save proposal' }).click();
  await page.getByText('Proposal saved.', { exact: true }).waitFor();

  await page.reload();
  await page.getByRole('heading', { name: editTitle, level: 1 }).waitFor();
  assert.equal(await editor.getByLabel('Task title').inputValue(), editTitle);
  assert.equal(await editor.getByLabel('Priority').inputValue(), 'urgent');
  assert.equal(await editor.getByLabel('Input artifacts').inputValue(),'private-artifact:current-output');
  assert.equal(await editor.getByLabel('Planned deliverables').inputValue(),'Implementation PR with checked output');
  await page.getByRole('heading', { name: 'Dependency graph' }).waitFor();
  await page.getByRole('heading', { name: 'Task Timeline', exact: true }).waitFor();
  await page.getByText('Change history', { exact: true }).click();
  await page.getByText(/Version 2 · edit/).waitFor();

  const stateForm = page.getByRole('form', { name: 'Change proposal state' });
  await stateForm.getByLabel('New state').selectOption('cancelled');
  await stateForm.getByLabel('Reason').fill('Testing confirmation without applying cancellation');
  await stateForm.getByRole('button', { name: 'Apply state change' }).click();
  await page.getByText(/Cancel this proposal\\?/).waitFor();
  await stateForm.getByRole('button', { name: 'Keep proposal' }).click();
  await stateForm.getByRole('button', { name: 'Apply state change' }).waitFor();

  await page.getByRole('button', { name: 'Back to Task Control Center' }).click();
  await page.getByLabel('Search', { exact: true }).fill('worker-backed editor');
  await page.getByLabel('Group', { exact: true }).selectOption('state');
  await page.getByLabel('Sort', { exact: true }).selectOption('priority');
  const row = page.getByRole('link', { name: /Worker-backed editor verification.*Manage/i });
  await row.focus();
  await page.keyboard.press('Enter');
  await page.waitForURL(detailUrl);
  await editor.getByLabel('Task title').fill('Unsaved local draft');
  const update = await fetch(origin + '/api/tasks/' + id + '/control', {
    method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-observatory-verification': namespace },
    body: JSON.stringify({ type: 'transition', state: 'blocked', reason: 'Waiting on an upstream contract',
      operation_id: crypto.randomUUID(), expected_version: 2 }),
  });
  assert.equal(update.status, 200);
  await page.clock.fastForward(31_000);
  await page.getByText(/Version 3 is available/).waitFor();
  assert.equal(await editor.getByLabel('Task title').inputValue(), 'Unsaved local draft');
  assert.equal(await editor.getByRole('button', { name: 'Save proposal' }).isDisabled(), true);
  await page.getByRole('button', { name: 'Load latest version' }).click();
  await editor.waitFor({ state: 'hidden' });
  await Promise.all([
    page.waitForResponse(response => response.url().includes('engineering-analytics-page') && response.ok()),
    page.getByRole('button', { name: 'Engineering analytics', exact:true }).click(),
  ]);
  await page.getByRole('heading',{name:'Engineering activity',exact:true}).waitFor();
  await Promise.all([
    page.waitForResponse(response => response.url().includes('github-activity-pages') && response.ok()),
    page.getByRole('navigation').getByRole('button', { name: 'Pull requests', exact:true }).click(),
  ]);
  assert.deepEqual(pageErrors, []);
});

test('owner schedules an engine Task, observes blockers and controls the queue', {
  timeout: 120_000, skip: !process.env.OBSERVATORY_ENGINE_E2E,
}, async t => {
  const { runClaim } = await import('../../scripts/agent/observatory-task-worker.mjs');
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'aads-workspace-e2e-')));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const runFile = promisify(execFile);
  const git = async (...args) => (await runFile('git', args, { cwd: workspace, windowsHide: true })).stdout.trim();
  await git('init', '--initial-branch=codex/aads-task-browser-test');
  await git('remote', 'add', 'origin', 'https://github.com/Kgray44/Aetherwake.git');
  await git('config', 'user.name', 'Workspace test');
  await git('config', 'user.email', 'workspace@example.test');
  await git('-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'Verification baseline');
  const baseline = await git('rev-parse', 'HEAD');
  const { origin, executor, seedGithubDetail } = await start(t, { canonical: true, revision: baseline });
  const benchmark = process.env.OBSERVATORY_MATCHED_BENCHMARK_RECEIPT
    ? JSON.parse(readFileSync(process.env.OBSERVATORY_MATCHED_BENCHMARK_RECEIPT,'utf8')).matched_benchmark
    : {
      source_revision:'e'.repeat(40), artifact_path:'verification/report.md', artifact_sha256:'c'.repeat(64),
      provider:'test-provider', model:'test-model',
      standard:{receipt_sha256:'a'.repeat(64),input_tokens:100,cached_input_tokens:20,output_tokens:5,total_tokens:105,commands:2,turn_ms:1000},
      compact:{receipt_sha256:'b'.repeat(64),input_tokens:150,cached_input_tokens:40,output_tokens:10,total_tokens:160,commands:4,turn_ms:2000},
    };
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.OBSERVATORY_BROWSER_EXECUTABLE ? { executablePath: process.env.OBSERVATORY_BROWSER_EXECUTABLE } : {}),
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  await page.clock.install();
  const send = async body => {
    const response = await fetch(origin + '/api/task-engine/v1', {
      method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-observatory-verification': namespace },
      body: JSON.stringify(body),
    });
    assert.equal(response.ok, true);
    return response.json();
  };
  const prerequisite = await send({ op: 'register', operation_id: crypto.randomUUID(), fields: {
    title: 'Canonical prerequisite', objective: 'Supply an explicit unresolved prerequisite during the initial schedule.',
    primary: 'integration', profile_id: 'integration', criteria: ['Supply an approved result'],
  } });
  let releaseOverview;
  const overviewGate = new Promise(resolve => { releaseOverview = resolve; });
  await page.route(url=>url.pathname==='/api/overview', async route => {
    await overviewGate;
    await route.continue();
  });
  try {
    await page.goto(origin + '/?verification=' + namespace + '#tasks');
    const registryEntry = page.getByRole('link', { name: /Canonical prerequisite.*Inspect/ });
    await registryEntry.waitFor({timeout:8_000});
    assert.equal(await page.getByRole('link', { name: /Canonical prerequisite.*Manage/ }).count(), 0);
  } finally {
    releaseOverview();
  }
  await page.getByRole('link', { name: /Canonical prerequisite.*Manage/ }).waitFor();
  await page.unroute(url=>url.pathname==='/api/overview');
  let releaseRepository;
  const repoGate=new Promise(resolve=>{releaseRepository=resolve;});
  let repositoryWaiting;
  const repositoryStarted=new Promise(resolve=>{repositoryWaiting=resolve;});
  await page.route(url=>url.pathname==='/api/overview',async route=>{
    if(new URL(route.request().url()).searchParams.get('prefer')==='cached'){
      const reply=await route.fetch();
      await route.fulfill({response:reply,json:{...await reply.json(),github_refresh_pending:true}});
    }else{
      repositoryWaiting();
      await repoGate;
      await route.continue();
    }
  });
  try{
    await page.reload();
    await repositoryStarted;
    await page.getByRole('link',{name:/Canonical prerequisite.*Manage/}).click({timeout:8000});
    await page.getByRole('heading',{name:'Task Timeline',exact:true}).waitFor({timeout:8000});
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(button=>button.textContent.trim()==='Export PDF'&&!button.disabled),{},{timeout:8000});
  }finally{
    releaseRepository();
    await page.unroute(url=>url.pathname==='/api/overview');
  }
  await page.getByRole('button',{name:'Back to Task Control Center',exact:true}).click();
  await page.getByRole('button', { name: 'Create proposal' }).click();
  await page.getByLabel('Task title').fill('Canonical schedule verification');
  await page.getByLabel('Tangible objective').fill('Use the existing engine API to register, schedule and control a genuine isolated Task.');
  await page.getByLabel('Prerequisite task IDs').fill(prerequisite.task.id);
  await page.getByLabel('Required capabilities').fill('Scoped verification workspace');
  await page.getByLabel('Acceptance criteria').fill('Observe the canonical schedule and audit receipts.');
  await page.getByLabel('Input artifacts').fill('private-artifact:scope-input');
  await page.getByLabel('Planned deliverables').fill('Schedule verification receipt');
  await page.getByRole('button', { name: 'Create Task', exact: true }).click();
  const editor = page.getByRole('form', { name: 'Edit proposed task' });
  await editor.getByLabel('Task title').fill('Canonical schedule edited');
  await editor.getByRole('button', { name: 'Save proposal' }).click();
  await page.getByText('Task saved.', { exact: true }).waitFor();

  await page.getByRole('button', { name: 'Admit to Codex queue', exact: true }).click();
  const admission = page.getByRole('form', { name: 'Admit to Codex queue' });
  await admission.getByText('You can queue this Task now. Execution also requires Codex worker access.').waitFor();
  await admission.getByLabel('Start at').fill('2050-01-01T13:00');
  await admission.getByLabel('Maximum minutes per attempt').fill('7');
  await admission.getByRole('list',{name:'Prerequisite checks'}).getByText('unverified',{exact:true}).waitFor();
  await admission.getByRole('checkbox',{name:'Attest Scoped verification workspace on admission'}).check();
  await admission.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.getByRole('list', { name: 'Admission blockers' }).getByText(/Canonical prerequisite/).waitFor();
  const capability=page.getByRole('list',{name:'Required capabilities'});
  await capability.getByText(/Owner attested/).waitFor();
  await capability.getByText('satisfied',{exact:true}).waitFor();
  const id = new URL(page.url()).hash.split('/').at(-1);
  let detail = await send({ op: 'get', task_id: id });
  assert.deepEqual(detail.task.requirements,[{kind:'artifact',uri:'private-artifact:scope-input'}]);
  assert.deepEqual(detail.task.deliverables,['Schedule verification receipt']);
  assert.equal(detail.lifecycle.stored_state, 'admitted');
  assert.equal(detail.lifecycle.state, 'blocked');
  assert.equal(detail.lifecycle.executor, 'codex');
  assert.equal(detail.lifecycle.max_attempt_minutes,7);
  assert.equal(detail.lifecycle.start_at, await page.evaluate(() => new Date('2050-01-01T13:00').getTime()));

  const admittedEditor = page.getByRole('form', { name: 'Edit Task specification' });
  await admittedEditor.getByLabel('Task title').fill('Canonical schedule amended after admission');
  await admittedEditor.getByRole('button', { name: 'Save Task revision' }).click();
  await admittedEditor.getByText('Task saved.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Add owner instructions', exact: true }).click();
  const addendum = page.getByRole('form', { name: 'Add owner instructions' });
  await addendum.getByLabel('Supplemental instructions').fill('Keep the schedule receipt with the candidate.');
  await addendum.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.getByRole('region', { name: 'Owner addendum delivery' }).getByText('pending', { exact: true }).waitFor();
  detail = await send({ op: 'get', task_id: id });
  assert.equal(detail.task.title, 'Canonical schedule amended after admission');
  assert.equal(detail.lifecycle.addenda[0].target, 'next_attempt');
  assert.deepEqual(detail.attempts, []);

  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByText(/Stored state paused/).waitFor();
  await page.getByRole('button',{name:'Edit execution settings',exact:true}).click();
  const settings=page.getByRole('form',{name:'Edit execution settings'});
  assert.equal(await settings.getByLabel('Start at').inputValue(),'2050-01-01T13:00');
  await settings.getByLabel('Start at').fill('2050-01-02T13:00');
  await settings.getByLabel('Maximum minutes per attempt').fill('9');
  await settings.getByRole('button',{name:'Confirm',exact:true}).click();
  await page.getByText('9 min',{exact:true}).waitFor();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.getByText(/Stored state queued/).waitFor();
  await page.getByRole('button', { name: 'Cancel Task', exact: true }).click();
  const cancel = page.getByRole('form', { name: 'Cancel Task' });
  await cancel.getByRole('button', { name: 'Confirm' }).click();
  await page.getByText(/Stored state cancelled/).waitFor();
  await page.reload();
  await page.getByText(/Stored state cancelled/).waitFor();
  await page.getByText('9 min',{exact:true}).waitFor();
  detail = await send({ op: 'get', task_id: id });
  assert.deepEqual(detail.events.map(event => event.kind), ['register', 'edit', 'admit', 'edit', 'addendum', 'pause', 'configure_execution', 'resume', 'cancel']);
  assert.equal(detail.task.owner_acceptance, 'not_reviewed');

  const execution = await send({ op: 'register', operation_id: crypto.randomUUID(), fields: {
    title: 'Candidate review verification', objective: 'Verify real worker lifecycle transitions and owner review from the front end.',
    primary: 'integration', profile_id: 'integration', criteria: ['Review the candidate result'],
  } });
  await page.goto(origin + '/?verification=' + namespace + '#tasks/' + execution.task.id);
  await page.reload();
  await page.getByRole('button', { name: 'Admit to Codex queue', exact: true }).click();
  await page.getByRole('form', { name: 'Admit to Codex queue' }).getByRole('button', { name: 'Confirm' }).click();
  await page.getByText(/Stored state admitted/).waitFor();
  await page.getByText('Waiting for Codex worker access',{exact:true}).waitFor();
  await page.getByRole('status').filter({hasText:'Configure Codex worker access'}).waitFor();
  const overviewRoute=url=>url.pathname==='/api/overview';
  let unblockFeed;
  const heldFeed=new Promise(resolve=>{unblockFeed=resolve;});
  await page.route(overviewRoute,async route=>{await heldFeed;await route.continue();});
  let candidate;
  const conversationId='10000000-0000-4000-8000-000000000001';
  try {
    const {claim}=await executor({op:'claim',operation_id:crypto.randomUUID(),task_ids:[execution.task.id]});
    assert.equal(claim.task.id,execution.task.id);
    await page.clock.fastForward(6_000);
    await page.getByText(/Stored state running/).waitFor({timeout:8_000});
    await executor({op:'report',task_id:execution.task.id,operation_id:crypto.randomUUID(),
      attempt_id:claim.attempt.id,lease:claim.lease,report:{type:'heartbeat'}});
    await page.clock.fastForward(6_000);
    const heartbeat=page.getByRole('group',{name:'Executor heartbeat'});
    await heartbeat.getByText('Heartbeat received',{exact:true}).waitFor({timeout:8_000});
    assert.equal(await page.getByRole('region',{name:'Task timeline'}).getByRole('button',{name:/Executor heartbeat/}).count(),0);
    await runClaim({
      claim, workspace, send: executor, verificationNamespace: namespace,
      signal: AbortSignal.timeout(15_000),
      admitStorage: async () => {},
      onTelemetryStart: () => {},
      // Only the provider boundary is replaced. The worker checkpoints and reports the real Git result.
      execute: async ({ cwd, task, signal, onSession }) => {
        await onSession(conversationId);
        await executor({op:'report',task_id:task.id,operation_id:crypto.randomUUID(),attempt_id:claim.attempt.id,lease:claim.lease,
          report:{type:'heartbeat',session_id:conversationId,execution_identity:{provider:'openai',model:'gpt-6.2-sol',source:'codex_app_server_thread_start'}}});
        assert.equal((await send({op:'get',task_id:task.id})).attempts[0].session_id,conversationId);
        await runFile(process.execPath, ['-e',
          'require("node:fs").writeFileSync("artifact.txt", process.argv[1])', task.id,
        ], { cwd, signal, windowsHide: true });
        return { ok: true };
      },
    });
    const result = await send({ op: 'get', task_id: execution.task.id });
    assert.equal(result.lifecycle.state, 'verifying');
    assert.equal(result.attempts[0].revision, baseline);
    candidate = result.attempts[0].candidate_revision;
    assert.notEqual(candidate, baseline);
    assert.equal(await git('rev-parse', candidate + '^'), baseline);
    assert.equal(await git('show', candidate + ':artifact.txt'), execution.task.id);
    assert.equal(await git('status', '--porcelain'), '');
    await page.clock.fastForward(6_000);
    await page.getByRole('button',{name:'Record owner acceptance',exact:true}).waitFor({timeout:8_000});
  } finally {
    unblockFeed();
    await page.unroute(overviewRoute);
  }
  await page.getByRole('button',{name:'Record owner acceptance',exact:true}).click();
  const review = page.getByRole('form', { name: 'Record owner acceptance' });
  await review.getByText('Mark this task as owner accepted?').waitFor();
  assert.equal(await review.getByRole('textbox').count(),1);
  assert.deepEqual(await review.getByRole('button').allTextContents(),['Yes','No']);
  const before = await send({op:'get',task_id:execution.task.id});
  const notes = 'Checked the candidate. https://example.test/reviewed-artifact';
  await review.getByRole('textbox').fill(notes);
  await review.getByRole('button',{name:'No',exact:true}).click();
  assert.equal(await review.getByLabel('Notes for the next round').inputValue(),notes);
  assert.deepEqual(await review.getByRole('button').allTextContents(),['Run again','Close']);
  await review.getByRole('button',{name:'Close',exact:true}).click();
  await review.waitFor({state:'hidden'});
  assert.equal((await send({op:'get',task_id:execution.task.id})).version,before.version);
  await page.getByRole('button',{name:'Record owner acceptance',exact:true}).click();
  await review.getByRole('textbox').fill(notes);
  await review.getByRole('button',{name:'Yes',exact:true}).click();
  await page.getByText(/Stored state completed/).waitFor();
  detail = await send({ op: 'get', task_id: execution.task.id });
  assert.equal(detail.task.owner_acceptance, 'accepted');
  assert.equal(detail.lifecycle.evidence[0].revision, candidate);
  assert.equal(detail.lifecycle.review_notes,notes);
  const { sha256 } = await import('./sites/task-telemetry.mjs');
  const observed_at = new Date().toISOString();
  const benchmarkRecord = {
    schema_version:1,record_type:'evidence',id:'evidence_matched_benchmark',created_at:observed_at,
    repository:execution.task.repository,revision:candidate,task_id:execution.task.id,attempt_id:detail.attempts[0].id,
    criterion_id:execution.task.acceptance.criteria[0].id,kind:'benchmark',result:'inconclusive',synthetic:false,
    observed_at,artifact:{kind:'artifact',uri:'private-artifact:evidence_matched_benchmark'},matched_benchmark:benchmark,
  };
  const mismatchedDigest='f'.repeat(64);
  const mismatchedBenchmark={
    ...benchmarkRecord,id:'evidence_mismatched_benchmark',revision:'e'.repeat(40),
    matched_benchmark:{...benchmark,artifact_sha256:mismatchedDigest,artifact_path:'private-fixture/rejected.md'},
  };
  const synced = await fetch(origin+'/api/task-telemetry/'+execution.task.id,{
    method:'POST',headers:{origin,'content-type':'application/json','x-observatory-verification':namespace,
      'x-observatory-sync-scope':await sha256(JSON.stringify(['observatory-telemetry-v1',owner,'verification:'+namespace]))},
    body:JSON.stringify({base:null,generated_at:observed_at,events:[],records:[
      {...execution.task,state:'proposed',owner_acceptance:'not_reviewed'},benchmarkRecord,mismatchedBenchmark,
    ]}),
  });
  assert.ok(synced.ok,synced.ok?'':await synced.text());
  const evidence = page.getByRole('region', { name: 'Execution and delivery evidence' });
  const attemptPanel=page.locator('#task-attempts');
  await attemptPanel.getByText('Candidate revision',{exact:true}).waitFor();
  await attemptPanel.getByText('Last lease deadline',{exact:true}).waitFor();
  await attemptPanel.getByText('Last successful lease renewal',{exact:true}).waitFor();
  const reviewed = evidence.getByText('Review the candidate result',{exact:true});
  await reviewed.waitFor();
  assert.equal(await evidence.getByText(candidate,{exact:true}).count(),1);
  assert.equal(await attemptPanel.getByText(candidate,{exact:true}).count(),1);
  await attemptPanel.getByText('Candidate submitted for review',{exact:true}).waitFor();
  await attemptPanel.getByText('Owner accepted result',{exact:true}).waitFor();
  const ownerNotes=page.getByRole('region',{name:'Owner review receipts'});
  await ownerNotes.getByText('Checked the candidate.',{exact:false}).waitFor();
  assert.equal(await ownerNotes.getByRole('link',{name:'https://example.test/reviewed-artifact'}).getAttribute('href'),'https://example.test/reviewed-artifact');
  await page.getByText('Implementation complete',{exact:true}).waitFor();
  await page.getByText('Merge not requested',{exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Open in Codex',exact:true}).getAttribute('href'),'codex://threads/'+conversationId);
  const matrix=page.getByRole('region',{name:'Task acceptance criteria'});
  await matrix.getByText('owner accepted',{exact:true}).waitFor();
  assert.equal(await matrix.getByRole('link',{name:'Open evidence artifact'}).count(),0);
  assert.equal(await page.evaluate(()=>Boolean(document.querySelector('#task-controls')?.compareDocumentPosition(
    document.querySelector('#task-timeline'))&Node.DOCUMENT_POSITION_FOLLOWING)),true);
  const sessionId = '10000000-0000-4000-8000-000000000002';
  await page.getByRole('button',{name:'Attach evidence link'}).click();
  const sessionLink = page.getByRole('form',{name:'Attach evidence link'});
  await sessionLink.getByLabel('Reference type').selectOption('executor_session');
  await sessionLink.getByLabel('Evidence URL').fill('https://chatgpt.com/c/' + sessionId);
  await sessionLink.getByLabel('Revision').fill(candidate);
  await sessionLink.getByRole('button',{name:'Confirm'}).click();
  await evidence.getByRole('link',{name:'executor session',exact:true}).waitFor();
  const telemetryHeaders = { 'x-observatory-verification': namespace };
  const overview = await page.request.get(origin + '/api/overview', { headers: telemetryHeaders });
  const { telemetry_scope: scope } = await overview.json();
  const {digest:telemetryBaseline} = await synced.json();
  const firstAttempt = detail.attempts[0];
  const operationId = 'e'.repeat(64);
  const timedEvent = (phase, kind, offset) => ({
    trace_version:1,event_id:phase+'-'+kind,task_id:execution.task.id,attempt_id:firstAttempt.id,
    trace_id:'timing-window',span_id:phase,repository:execution.task.repository,revision:firstAttempt.revision,
    occurred_at:new Date(Date.parse(firstAttempt.started_at)+offset).toISOString(),kind,phase,measurements:[],
  });
  const received = await page.request.post(origin + '/api/task-telemetry/' + execution.task.id, {
    headers: { ...telemetryHeaders, origin, 'x-observatory-sync-scope': scope },
    data: {
      base: telemetryBaseline, generated_at: new Date().toISOString(), records: [],
      events: [{
        trace_version:1,event_id:'activity_'+operationId+'_result',task_id:execution.task.id,
        trace_id:operationId,span_id:operationId,repository:execution.task.repository,revision:candidate,
        occurred_at:'2026-01-02T00:00:00.000Z',kind:'engineering_activity',phase:'verification',measurements:[],
        activity:{kind:'deployment_validation',source:'sites',operation_id:operationId,outcome:'succeeded'},
      },timedEvent('implementation','span_start',100),timedEvent('integration','span_start',200),
        timedEvent('integration','span_end',350),timedEvent('implementation','span_end',300),{
        ...timedEvent('implementation','measurement',280),
        measurements:[['total',90],['input',80],['cached_input',60],['output',10],['cache_write_input',0]].map(([key,value])=>({
          name:'provider_'+key+'_tokens',value,unit:'tokens',availability:'observed',
          source:'codex_app_server_token_usage_updated',method:'fresh_thread_total',
        })),
      },{
        trace_version: 1, event_id: 'fixture-delayed-trace', task_id: execution.task.id,
        trace_id: 'fixture-receipt-trace', span_id: 'fixture-receipt-span', repository: execution.task.repository,
        revision: candidate, occurred_at: '2026-01-01T08:00:00.000Z', session_id: sessionId,
        kind: 'measurement', phase: 'verification', measurements: [{
          name:'desktop_total_tokens',value:137,unit:'tokens',availability:'observed',
          source:'codex_desktop_session_usage',method:'task_dedicated_session_total',
        }],
      }],
    },
  });
  assert.equal(received.status(), 200, await received.text());
  const { received_at: traceReceivedAt } = await received.json();
  const lateRefreshes=[];
  const rememberRefresh=request=>{
    const url=new URL(request.url());
    if(url.pathname==='/api/overview') lateRefreshes.push(url.searchParams.get('prefer'));
  };
  const staleGitHub=async route=>{
    const response=await route.fetch();
    await route.fulfill({response,json:{...await response.json(),github_refresh_pending:true}});
  };
  await page.route(overviewRoute,staleGitHub);
  page.on('request',rememberRefresh);
  await page.clock.fastForward(31_000);
  const jump=page.getByRole('navigation',{name:'Jump to Task section'});
  await jump.getByRole('button',{name:'Timeline',exact:true}).click();
  await page.waitForFunction(()=>document.activeElement?.textContent==='Task Timeline');
  const timeline=page.getByRole('region',{name:'Task timeline'});
  await timeline.getByText('Formal Task Engine attempts',{exact:true}).waitFor();
  await timeline.getByText('Known executor sessions',{exact:true}).waitFor();
  const search=timeline.getByRole('searchbox',{name:'Search timeline'});
  const filterToggle=timeline.getByRole('button',{name:'Filters',exact:true});
  assert.equal(await timeline.getByLabel('Outcome',{exact:true}).isVisible(),false);
  await filterToggle.click();
  await timeline.getByLabel('Through',{exact:true}).fill('2025-12-31');
  await timeline.getByText('No events match these filters.').waitFor();
  await timeline.getByRole('button',{name:'Filters (1)',exact:true}).click();
  await timeline.getByRole('button',{name:'Clear filters'}).click();
  await timeline.getByRole('button',{name:/Task marked complete/}).waitFor();
  const originalViewport = page.viewportSize();
  await page.setViewportSize({width:360,height:820});
  await filterToggle.click();
  const inputBounds = await search.boundingBox();
  const filterBounds = await filterToggle.boundingBox();
  assert.ok(inputBounds.x>=0 && inputBounds.width>=90 && filterBounds.x+filterBounds.width<=360);
  assert.ok(await timeline.locator('#timeline-filter-fields').evaluate(element=>element.scrollWidth<=element.clientWidth+1));
  await filterToggle.click();
  await page.setViewportSize(originalViewport);
  await search.fill('no such timeline event');
  await timeline.getByText('No events match these filters.').waitFor();
  await search.fill('fixture-receipt-trace');
  await timeline.getByRole('button',{name:/verification · measurement/}).click();
  const receiptDetail = timeline.getByRole('complementary',{name:'Selected timeline event'});
  await receiptDetail.getByText('Observatory first received',{exact:true}).waitFor();
  assert.equal(await receiptDetail.getByText(traceReceivedAt,{exact:true}).count(), 1);
  assert.equal(await receiptDetail.locator('time').getAttribute('datetime'), '2026-01-01T08:00:00.000Z');
  await timeline.getByText(/First-receipt timestamps are available for 7 of 7 journal events/).waitFor();
  const reportedEvidence=page.locator('#task-evidence').getByRole('region',{name:'Reported verification activity'});
  await reportedEvidence.getByText(/Reported deployment validation · succeeded/).click();
  await reportedEvidence.getByText('Reported by the source journal',{exact:true}).waitFor();
  await reportedEvidence.getByText(traceReceivedAt,{exact:true}).waitFor();
  page.off('request',rememberRefresh);
  await page.unroute(overviewRoute,staleGitHub);
  assert.ok(lateRefreshes.length>0);
  assert.ok(lateRefreshes.every(preference=>preference==='cached'));
  await search.clear();
  await timeline.getByRole('button',{name:/Task marked complete/}).waitFor();
  const earlier = timeline.getByRole('button',{name:'Show earlier events'});
  if (await earlier.count()) await earlier.click();
  await timeline.getByRole('button',{name:/Task created/}).waitFor();
  await timeline.getByRole('button',{name:/Task submitted/}).waitFor();
  await timeline.getByRole('button',{name:'Attempt',exact:true}).click();
  await timeline.getByRole('button',{name:/Attempt 1 started/}).click();
  const selected=timeline.getByRole('complementary',{name:'Selected timeline event'});
  await page.waitForFunction(()=>document.activeElement?.textContent==='Attempt 1 started');
  assert.ok((await selected.innerText()).includes('Attempt ID'));
  await selected.getByRole('button',{name:'Open attempt details'}).click();
  await page.waitForFunction(()=>document.activeElement?.textContent==='Attempt 1');
  await page.getByRole('button',{name:'Attach evidence link'}).click();
  const association=page.getByRole('form',{name:'Attach evidence link'});
  const observedAt = new Date().toISOString();
  const mergeCommit = 'c'.repeat(40);
  const pullCommit = 'd'.repeat(40);
  await seedGithubDetail('pulls:319',{
    kind:'pull',number:319,title:'Review fixture',state:'closed',created_at:observedAt,
    merged_at:observedAt,merge_commit_sha:mergeCommit,
    head:{sha:pullCommit},commit_items:[{revision:pullCommit,committed_at:observedAt}],
    commits_observed_at:observedAt,commits_status:'available',
    reviews:[{id:81,state:'APPROVED',submitted_at:observedAt}],reviews_observed_at:observedAt,reviews_status:'available',
  },observedAt);
  await association.getByLabel('Reference type').selectOption('pull_request');
  await association.getByLabel('Evidence URL').fill('https://github.com/Kgray44/Aetherwake/pull/319');
  await association.getByRole('button',{name:'Confirm'}).click();
  const pull=evidence.getByRole('link',{name:'pull request',exact:true});
  await pull.waitFor();
  assert.equal(await pull.getAttribute('href'),'#pull-requests/319');
  assert.equal(await pull.getAttribute('target'),null);
  await page.getByRole('button',{name:'Attach evidence link'}).click();
  await seedGithubDetail('runs:5321',{
    kind:'run',id:5321,title:'Engineering validation',head:{sha:candidate},attempt:2,
    created_at:observedAt,started_at:observedAt,status:'completed',conclusion:'success',
    jobs:[{id:91,name:'Observatory browser tests',status:'completed',conclusion:'success',completed_at:observedAt}],
    jobs_observed_at:observedAt,
  },observedAt);
  await association.getByLabel('Reference type').selectOption('ci_run');
  await association.getByLabel('Evidence URL').fill('https://github.com/Kgray44/Aetherwake/actions/runs/5321');
  await association.getByRole('button',{name:'Confirm'}).click();
  const run=evidence.getByRole('link',{name:'ci run',exact:true});
  await run.waitFor();
  assert.equal(await run.getAttribute('href'),'#ci-runs/5321');
  await timeline.getByRole('button',{name:'Engineering',exact:true}).click();
  await timeline.getByRole('button',{name:/Review submitted on pull request #319/}).waitFor();
  await timeline.getByRole('button',{name:/Pull request #319 merged/}).click();
  assert.equal(await selected.getByRole('link',{name:mergeCommit,exact:true}).getAttribute('href'),
    'https://github.com/Kgray44/Aetherwake/commit/'+mergeCommit);
  await timeline.getByRole('button',{name:new RegExp('Commit '+pullCommit.slice(0,10))}).click();
  await selected.getByText('Git commit committer time',{exact:true}).waitFor();
  assert.equal(await selected.getByRole('link',{name:'Open linked activity'}).getAttribute('href'),
    'https://github.com/Kgray44/Aetherwake/commit/'+pullCommit);
  await timeline.getByRole('button',{name:/Reported deployment validation · succeeded/}).click();
  await timeline.getByText('Reported by the source journal',{exact:true}).waitFor();
  await timeline.getByRole('button',{name:/CI job finished.*Observatory browser tests/}).click();
  await timeline.getByText('Job ID',{exact:true}).waitFor();
  await timeline.getByRole('button',{name:'All',exact:true}).click();
  const actionCard = page.getByRole('button',{name:'Attach evidence link'});
  await actionCard.hover();
  assert.equal(await actionCard.evaluate(el => getComputedStyle(el).transform), 'none');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.reload();
  await page.getByRole('heading',{name:'Execution controls',exact:true}).hover();
  await actionCard.hover();
  await page.waitForFunction(() => {
    const node = document.querySelector('.task-command-button:hover');
    return node && Math.abs(new DOMMatrix(getComputedStyle(node).transform).m42 + 1) < .05;
  });
  await page.setViewportSize({width:1440,height:660});
  const hoverRow=timeline.getByRole('button',{name:/Task created/});
  if (!(await hoverRow.count())) await timeline.getByRole('button',{name:'Show earlier events'}).click();
  await hoverRow.hover();
  await page.waitForFunction(()=>{
    const label=document.querySelector('.task-timeline-event:hover .task-timeline-label');
    return label&&Math.abs(new DOMMatrix(getComputedStyle(label).transform).m42+1)<.06;
  });
  await page.getByRole('heading',{name:'Task Timeline',exact:true}).hover();
  await page.waitForFunction(()=>{
    const row=[...document.querySelectorAll('.task-timeline-event')].find(node=>node.textContent.includes('Task created'));
    return row&&getComputedStyle(row.querySelector('.task-timeline-label')).transform==='none';
  });
  const sticky=await page.evaluate(()=>{
    const grid=document.querySelector('.task-timeline-grid');
    const rail=document.querySelector('#task-timeline-details');
    const originalTop=grid.getBoundingClientRect().top+window.scrollY;
    window.scrollTo({top:originalTop+56,behavior:'instant'});
    return {top:rail.getBoundingClientRect().top,position:getComputedStyle(rail).position,
      record:getComputedStyle(document.querySelector('.detail-right')).position};
  });
  assert.deepEqual({position:sticky.position,record:sticky.record},{position:'sticky',record:'sticky'});
  assert.ok(Math.abs(sticky.top-16)<3);
  await page.setViewportSize({width:820,height:620});
  assert.equal(await page.locator('#task-timeline-details').evaluate(node=>getComputedStyle(node).position),'static');
  const telemetry = page.getByRole('region',{name:'Task telemetry'});
  await telemetry.getByRole('heading',{name:'Time by phase'}).waitFor();
  await telemetry.getByRole('heading',{name:'Observed Task token usage'}).waitFor();
  const dataCoverage=telemetry.getByRole('region',{name:'Data coverage'});
  await dataCoverage.getByRole('row',{name:/Telemetry arrival Observed/}).waitFor();
  await dataCoverage.getByRole('row',{name:/Owner review Verified/}).waitFor();
  await dataCoverage.getByRole('row',{name:/Billing Unavailable/}).waitFor();
  const billing = telemetry.locator('dl').filter({has:page.getByText('Actual billing',{exact:true})});
  await billing.getByText('Unknown',{exact:true}).waitFor();
  await telemetry.getByRole('table',{name:/OpenAI API reference estimates for 1 of 1 attempts/})
    .getByRole('cell',{name:'$0.000146',exact:true}).waitFor();
  const usageTable = telemetry.getByRole('table',{name:'Token usage by executor session'});
  await usageTable.getByRole('cell',{name:'137',exact:true}).waitFor();
  await usageTable.getByText('Source event fixture-delayed-trace').waitFor();
  const timing = page.getByRole('region',{name:'Execution timing'});
  await timing.getByText('Time with overlapping spans').waitFor();
  await timing.getByRole('button',{name:/Admission to claim.*Lifecycle interval/}).click();
  await timing.getByRole('region',{name:'Selected timing details'}).getByText('Task Engine audit receipts',{exact:true}).waitFor();
  await timing.getByText('100 ms',{exact:true}).waitFor();
  await timing.getByRole('button',{name:/implementation.*Trace span/}).click();
  const timingDetails = timing.getByRole('region',{name:'Selected timing details'});
  await timingDetails.getByText('Matched journal span',{exact:true}).waitFor();
  await timingDetails.getByRole('button',{name:'Open attempt details'}).waitFor();
  await telemetry.getByText('90 tokens',{exact:true}).first().waitFor();
  const comparison = telemetry.getByRole('region',{name:'Standard vs compact benchmark'});
  const expectedTokens = new Intl.NumberFormat('en-US').format(benchmark.standard.total_tokens);
  await comparison.getByRole('row',{name:new RegExp('Total tokens '+expectedTokens)}).waitFor();
  assert.equal(await comparison.count(),1);
  await comparison.getByText(/Reported artifact byte identity is unverified/).waitFor();
  await comparison.getByText('Inconclusive',{exact:true}).waitFor();
  assert.equal(await comparison.getByText('Unknown',{exact:true}).count(),3);
  assert.equal(await telemetry.getByText(mismatchedDigest,{exact:true}).count(),0);
  assert.equal(await comparison.getByText('Verified artifact',{exact:true}).count(),0);
  for(const digest of [benchmark.standard.receipt_sha256,benchmark.compact.receipt_sha256,benchmark.artifact_sha256]){
    await comparison.getByText(digest,{exact:true}).waitFor();
  }
  await page.locator('footer').scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.locator('footer').evaluate(footer => footer.getBoundingClientRect().bottom <= innerHeight + 2), true);
  await page.evaluate(()=>{
    Object.defineProperty(window,'showSaveFilePicker',{configurable:true,value:async options=>{
      window.savedReportName=options.suggestedName;
      return {createWritable:async()=>({
        write:async blob=>{window.savedReportSignature=await blob.slice(0,5).text();},
        close:async()=>{window.savedReportClosed=true;},
      })};
    }});
  });
  await page.getByRole('button',{name:'Export PDF'}).click();
  await page.getByText('Task report saved.',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>[window.savedReportName,window.savedReportSignature,window.savedReportClosed]),
    [execution.task.id+'-report.pdf','%PDF-',true]);
  await page.evaluate(()=>Object.defineProperty(window,'showSaveFilePicker',{configurable:true,value:async()=>{
    throw new DOMException('Save cancelled','AbortError');
  }}));
  await page.getByRole('button',{name:'Export PDF'}).click();
  await page.getByText('Save As closed. Use Download PDF to save through your browser.').waitFor();
  const [download]=await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button',{name:'Download PDF',exact:true}).click(),
  ]);
  assert.equal(download.suggestedFilename(),execution.task.id+'-report.pdf');
  if (process.env.OBSERVATORY_REPORT_RECEIPT) await download.saveAs(process.env.OBSERVATORY_REPORT_RECEIPT);
  const pdf=await download.createReadStream();
  const chunks=[];
  for await (const chunk of pdf) chunks.push(chunk);
  const report=Buffer.concat(chunks);
  assert.equal(report.subarray(0,5).toString(),'%PDF-');
  assert.match(report.toString('latin1'),/\/Outlines\s+\d+\s+0\s+R/);
  await page.getByRole('button',{name:'Archive Task'}).click();
  await page.getByRole('form',{name:'Archive Task'}).getByRole('button',{name:'Confirm'}).click();
  await page.getByText(/Task archived · Owner accepted/).waitFor();
  await matrix.getByText('owner accepted',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Reopen with feedback'}).click();
  const feedback=page.getByRole('form',{name:'Reopen with feedback'});
  await feedback.getByLabel('Feedback for the next attempt').fill('Include the second verification result.');
  await feedback.getByRole('button',{name:'Confirm'}).click();
  await page.getByText(/Stored state queued/).waitFor();
  await matrix.getByText('unverified',{exact:true}).waitFor();
  await timeline.getByRole('button',{name:'Audit',exact:true}).click();
  await timeline.getByRole('button',{name:/Task reopened with feedback/}).click();
  await selected.getByText('Include the second verification result.').waitFor();
  await pull.click();
  await page.waitForURL(url => url.hash === '#pull-requests/319');
  await page.getByRole('heading',{name:'Pull request',exact:true}).waitFor();
  await page.goBack();
  await run.click();
  await page.waitForURL(url=>url.hash==='#ci-runs/5321');
  await page.getByRole('heading',{name:'CI run',exact:true}).waitFor();
  await page.getByRole('button',{name:'Overview',exact:true}).click();
  const overviewCard = page.locator('.metric').filter({hasText:'Registered tasks'});
  await overviewCard.hover();
  await page.waitForFunction(() => {
    const node = document.querySelector('.metric:hover');
    return node && Math.abs(new DOMMatrix(getComputedStyle(node).transform).m42 + 1) < .05;
  });
  await page.getByRole('link',{name:/queued, scheduled, or paused Tasks/}).click();
  await page.waitForURL(url=>url.hash==='#tasks?work=waiting');
  const workViews=page.getByRole('navigation',{name:'Task activity views'});
  const waitingView=workViews.getByRole('link',{name:/Queued or paused/});
  assert.equal(await waitingView.getAttribute('aria-current'),'page');
  await page.getByRole('link',{name:/Candidate review verification.*Manage/}).waitFor();
  assert.equal(await page.getByRole('link',{name:/Canonical prerequisite.*Manage/}).count(),0);
  await page.reload();
  await waitingView.waitFor();
  assert.equal(await waitingView.getAttribute('aria-current'),'page');
  await page.getByRole('link',{name:/Candidate review verification.*Manage/}).waitFor();
  await page.getByRole('button',{name:'Engineering analytics',exact:true}).click();
  await page.getByRole('heading',{name:'Codex token accounting',exact:true}).waitFor();
  const attemptTotal=page.locator('.analytics-counts > div').filter({hasText:'Input and output from final receipts'});
  await attemptTotal.getByText('90',{exact:true}).waitFor();
  await page.locator('.analytics-counts > div').filter({hasText:'App Server receipts'}).getByText('1',{exact:true}).waitFor();
  await page.getByText('Attempt breakdown',{exact:true}).click();
  await page.getByRole('link',{name:'$0.000146',exact:true}).waitFor();
  await page.locator('.analytics-counts > div').filter({hasText:'Observed session-only tokens'}).getByText('137',{exact:true}).waitFor();
});
