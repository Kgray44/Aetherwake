import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { windowsCodexLaunch } from '../src/codex-launch.mts';

test('Windows launches the installed npm CLI entry on a shim-only PATH without interpreting shell text', { skip: process.platform !== 'win32' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'aerynth-codex-path-'));
  try {
    const prefix = join(root, 'with spaces & punctuation');
    const cliDir = join(prefix, 'node_modules', '@openai', 'codex', 'bin');
    mkdirSync(cliDir, { recursive: true });
    writeFileSync(join(prefix, 'codex.cmd'), '@exit /b 73\r\n');
    const pathValue = `.;relative;"${prefix}"`;
    const args = ['app-server', '--listen', 'stdio://'];
    assert.equal(windowsCodexLaunch(pathValue, process.execPath, args), undefined, 'never runs a bare batch shim');
    writeFileSync(join(cliDir, 'codex.js'), 'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
    const launch = windowsCodexLaunch(pathValue, process.execPath, args);
    assert(launch);
    const child = spawn(launch.executable, launch.args, { windowsHide: true });
    let output = '';
    child.stdout.setEncoding('utf8').on('data', part => { output += part; });
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', code => code === 0 ? resolve() : reject(new Error(`CLI launch exit ${code}`)));
    });
    assert.deepEqual(JSON.parse(output), args);
    const standalone = join(prefix, 'codex.exe');
    writeFileSync(standalone, '');
    assert.deepEqual(windowsCodexLaunch(pathValue, process.execPath, args), { executable: standalone, args });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
