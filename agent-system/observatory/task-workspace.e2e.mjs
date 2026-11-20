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

async function start(t) {
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
  for (const [, path] of index.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) {
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
    const response = await worker.fetch(request, { DB });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  t.after(() => new Promise(resolve => server.close(resolve)));
  return origin;
}

test('keyboard, reduced motion, versioned edits, dependency admission and reload in the real workspace', { timeout: 120_000 }, async t => {
  const origin = await start(t);
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.OBSERVATORY_BROWSER_EXECUTABLE ? { executablePath: process.env.OBSERVATORY_BROWSER_EXECUTABLE } : {}),
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ reducedMotion: 'reduce', viewport: { width: 1280, height: 850 } });
  await page.clock.install();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const url = origin + '/?verification=' + namespace;
  await page.goto(url + '#tasks');
  await page.getByRole('heading', { name: 'Task explorer' }).waitFor();
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
  assert.deepEqual(pageErrors, []);
});
