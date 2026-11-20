import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { chromium } from 'playwright';
import { createWorker } from './sites/worker.mjs';

const read = (path, type = 'utf8') => readFileSync(new URL(path, import.meta.url), type);
const revision = 'a'.repeat(40);
const namespace = 'c0cf1399-8a73-4f08-9b10-997063853638';
const taskTitle = 'Worker-backed workspace verification';
const editTitle = 'Worker-backed editor verification';
const owner = 'isolated-browser-test';

async function start(t, { canonical = false } = {}) {
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
      : await worker.fetch(request, { DB, OBSERVATORY_TASK_ENGINE_OWNER_ID: owner });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function executor(body) {
    const { taskOperation } = await import('./sites/task-engine.mjs');
    const result = await taskOperation({ db: DB, owner, namespace: 'verification:' + namespace,
      body, access: 'worker', validate, revision: () => revision });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body;
  }
  return { origin, executor };
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
  await editor.getByRole('button', { name: 'Save proposal' }).click();
  await page.getByText('Proposal saved.', { exact: true }).waitFor();

  await page.reload();
  await page.getByRole('heading', { name: editTitle, level: 1 }).waitFor();
  assert.equal(await editor.getByLabel('Task title').inputValue(), editTitle);
  assert.equal(await editor.getByLabel('Priority').inputValue(), 'urgent');
  await page.getByRole('heading', { name: 'Dependency graph' }).waitFor();
  await page.getByRole('heading', { name: 'Execution timeline' }).waitFor();
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
  const { origin, executor } = await start(t, { canonical: true });
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
  await page.route('**/api/overview', async route => {
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
  await page.getByRole('button', { name: 'Create proposal' }).click();
  await page.getByLabel('Task title').fill('Canonical schedule verification');
  await page.getByLabel('Tangible objective').fill('Use the existing engine API to register, schedule and control a genuine isolated Task.');
  await page.getByLabel('Prerequisite task IDs').fill(prerequisite.task.id);
  await page.getByLabel('Acceptance criteria').fill('Observe the canonical schedule and audit receipts.');
  await page.getByRole('button', { name: 'Create Task', exact: true }).click();
  const editor = page.getByRole('form', { name: 'Edit proposed task' });
  await editor.getByLabel('Task title').fill('Canonical schedule edited');
  await editor.getByRole('button', { name: 'Save proposal' }).click();
  await page.getByText('Task saved.', { exact: true }).waitFor();

  await page.getByRole('button', { name: 'Admit to Codex queue', exact: true }).click();
  const admission = page.getByRole('form', { name: 'Admit to Codex queue' });
  await admission.getByLabel('Start at').fill('2050-01-01T13:00');
  await admission.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.getByRole('list', { name: 'Admission blockers' }).getByText(/Canonical prerequisite/).waitFor();
  const id = new URL(page.url()).hash.split('/').at(-1);
  let detail = await send({ op: 'get', task_id: id });
  assert.equal(detail.lifecycle.stored_state, 'admitted');
  assert.equal(detail.lifecycle.state, 'blocked');
  assert.equal(detail.lifecycle.executor, 'codex');
  assert.equal(detail.lifecycle.start_at, await page.evaluate(() => new Date('2050-01-01T13:00').getTime()));

  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByText(/Stored state paused/).waitFor();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.getByText(/Stored state queued/).waitFor();
  await page.getByRole('button', { name: 'Cancel Task', exact: true }).click();
  const cancel = page.getByRole('form', { name: 'Cancel Task' });
  await cancel.getByRole('button', { name: 'Confirm' }).click();
  await page.getByText(/Stored state cancelled/).waitFor();
  await page.reload();
  await page.getByText(/Stored state cancelled/).waitFor();
  detail = await send({ op: 'get', task_id: id });
  assert.deepEqual(detail.events.map(event => event.kind), ['register', 'edit', 'admit', 'pause', 'resume', 'cancel']);
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
  const { claim } = await executor({ op: 'claim', operation_id: crypto.randomUUID(), task_ids: [execution.task.id] });
  assert.equal(claim.task.id, execution.task.id);
  await page.clock.fastForward(31_000);
  await page.getByText(/Stored state running/).waitFor();
  const candidate = 'b'.repeat(40);
  await executor({ op: 'report', task_id: execution.task.id, operation_id: crypto.randomUUID(),
    attempt_id: claim.attempt.id, lease: claim.lease, report: { type: 'finished', result: 'candidate', revision: candidate } });
  await page.clock.fastForward(31_000);
  await page.getByRole('button', { name: 'Record owner acceptance', exact: true }).click();
  const review = page.getByRole('form', { name: 'Record owner acceptance' });
  await review.getByLabel('Review the candidate result').fill('https://example.test/reviewed-artifact');
  await review.getByRole('button', { name: 'Confirm' }).click();
  await page.getByText(/Stored state completed/).waitFor();
  detail = await send({ op: 'get', task_id: execution.task.id });
  assert.equal(detail.task.owner_acceptance, 'accepted');
  assert.equal(detail.lifecycle.evidence[0].revision, candidate);
  const evidence = page.getByRole('region', { name: 'Execution and delivery evidence' });
  await evidence.getByText('Candidate revision', { exact: false }).waitFor();
  const reviewed = evidence.getByRole('link', { name: 'Review the candidate result' });
  assert.equal(await reviewed.getAttribute('href'), 'https://example.test/reviewed-artifact');
  assert.equal(await evidence.getByText(candidate, { exact: true }).count(), 2);
  await page.getByRole('region',{name:'Owner review receipts'}).getByRole('link',{name:'Open evidence artifact'}).waitFor();
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
  await page.setViewportSize({width:820,height:620});
  const telemetry = page.getByRole('region',{name:'Task telemetry'});
  await telemetry.getByRole('heading',{name:'Time by phase'}).waitFor();
  await telemetry.getByText('No linked receipts supply total token counts for this Task.').waitFor();
  await page.locator('footer').scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.locator('footer').evaluate(footer => footer.getBoundingClientRect().bottom <= innerHeight + 2), true);
  await page.getByRole('button',{name:'Overview',exact:true}).click();
  const overviewCard = page.locator('.metric').filter({hasText:'Registered tasks'});
  await overviewCard.hover();
  await page.waitForFunction(() => {
    const node = document.querySelector('.metric:hover');
    return node && Math.abs(new DOMMatrix(getComputedStyle(node).transform).m42 + 1) < .05;
  });
});
