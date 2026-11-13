import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type Message = { phase: string; missionId: string; state: string; disposition?: string; attemptId?: string;
  effectId?: string; entries?: number; attempts?: number; evidenceId?: string; originalEvidenceId?: string; denial?: string | null };
const fixture = fileURLToPath(new URL('./fixtures/mission-source-process.mts', import.meta.url));
function launch(mode: 'capture' | 'recover', path: string, id?: string) {
  return fork(fixture, [mode, path, ...(id ? [id] : [])], { execArgv: [],
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { PATH: process.env.PATH ?? '', NODE_OPTIONS: '' } });
}
function message(child: ChildProcess, phase: string): Promise<Message> {
  return new Promise((resolve, reject) => {
    let diagnostic = '';
    const onData = (data: Buffer) => { diagnostic = (diagnostic + data.toString()).slice(-4096); };
    const cleanup = () => { clearTimeout(timer); child.off('message', onMessage); child.off('exit', exited); child.stderr?.off('data', onData); };
    const onMessage = (value: unknown) => {
      const result = value as Message;
      if (result?.phase !== phase && result?.phase !== 'error') return;
      cleanup();
      if (result.phase === 'error') reject(Error(JSON.stringify(result))); else resolve(result);
    };
    const exited = () => { cleanup(); reject(Error('source_process_exited_before_' + phase + ': ' + diagnostic)); };
    const timer = setTimeout(() => { cleanup(); reject(Error('source_process_timeout_' + phase + ': ' + diagnostic)); }, 12000);
    child.on('message', onMessage); child.once('exit', exited); child.stderr?.on('data', onData);
  });
}
async function exited(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await once(child, 'exit');
}
async function kill(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const end = exited(child); assert.equal(child.kill('SIGKILL'), true); await end;
}
for (const cancelled of [false, true]) test(`real host-process loss after producer capture preserves ${cancelled ? 'cancellation' : 'original-result recovery'}`, { timeout: 30000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aerynth-fi4-source-process-')), path = join(directory, 'state.sqlite');
  const children: ChildProcess[] = [];
  try {
    const original = launch('capture', path); children.push(original);
    const captured = await message(original, 'captured');
    assert.equal(captured.state, 'running'); assert.equal(captured.entries, 1); assert.ok(captured.effectId);
    if (cancelled) {
      const confirmation = message(original, 'cancelled'); original.send('cancel');
      const stopped = await confirmation; assert.equal(stopped.disposition, 'cancelled');
    }
    await kill(original); // Actual OS-observed exit, not an executor's claim that it stopped.
    const recovery = launch('recover', path, captured.missionId); children.push(recovery);
    const result = await message(recovery, 'recovered'); await exited(recovery);
    assert.equal(recovery.exitCode, 0);
    assert.equal(result.entries, 0, 'fresh host never redispatched the original worker');
    assert.equal(result.attempts, 1); assert.equal(result.attemptId, captured.attemptId); assert.equal(result.effectId, captured.effectId);
    if (cancelled) {
      assert.equal(result.disposition, 'cancelled'); assert.notEqual(result.state, 'verified');
      assert.match(result.denial ?? '', /mission_reconciliation_denied/);
    } else {
      assert.equal(result.state, 'verified'); assert.equal(result.denial, null);
      assert.equal(result.evidenceId, result.originalEvidenceId);
    }
  } finally {
    for (const child of children) await kill(child);
    assert.equal(dirname(directory), tmpdir()); assert.ok(basename(directory).startsWith('aerynth-fi4-source-process-'));
    rmSync(directory, { recursive: true, force: true });
  }
});
