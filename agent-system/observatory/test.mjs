import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

process.env.OBSERVATORY_NO_LISTEN = '1';
const { validateNewTask, handler } = await import('./server.mjs');

test('task intake validates objective, class, acceptance, and bounded inputs', () => {
  const valid = { title: 'GPU state transition', objective: 'Deliver a verified Vela reasoning animation', primary: 'visual', profile_id: 'visual-gpu', dependencies: ['task-1'], criteria: ['Visual result passes review'] };
  const task = validateNewTask(valid);
  assert.equal(task.primary, 'visual');
  assert.equal(task.accept.length, 1);
  assert.deepEqual(task.ids, ['task-1']);
  assert.throws(() => validateNewTask({ ...valid, primary: 'mission-11' }), /classification/);
  assert.throws(() => validateNewTask({ ...valid, criteria: [] }), /criterion/);
  assert.throws(() => validateNewTask({ ...valid, objective: '' }), /required/);
});

test('client demo generator is bounded and never returns more than three attached records per task', async () => {
  const source = await readFile(join(dirname(fileURLToPath(import.meta.url)), 'app.js'), 'utf8');
  const from = source.indexOf('const makeDemo=');
  const to = source.indexOf('\nconst records=', from);
  assert.ok(from >= 0 && to > from);
  const extract = source.slice(from, to);
  // Fixture isolation only: evaluate the checked-in own source, without DOM or network.
  const fn = new Function(extract + '\nreturn makeDemo;')();
  const data = fn();
  const tasks = data.filter(x => x.record_type === 'task');
  assert.equal(tasks.length, 7);
  assert.ok(data.length <= 7 * 4);
  assert.ok(data.filter(x => x.record_type === 'evidence').every(x => x.synthetic));
});

test('API is read-only by default, requires JSON for intake, and rejects foreign origins', async () => {
  const server = http.createServer((req, res) => handler(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const root = 'http://127.0.0.1:' + port;
    const overview = await fetch(root + '/api/overview');
    assert.equal(overview.status, 200);
    const body = await overview.json();
    assert.equal(body.schema_version, 1);
    assert.ok(Array.isArray(body.records));
    const foreign = await fetch(root + '/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://attacker.example' }, body: '{}' });
    assert.equal(foreign.status, 403);
    const unsupported = await fetch(root + '/api/tasks', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
    assert.equal(unsupported.status, 415);
  } finally { server.close(); }
});
