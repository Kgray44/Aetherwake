import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';

// Fixture-owned directory only. Never retry a timed-out Git write.
export function initializeTrackedFixture(dir: string, execute: typeof execFileSync = execFileSync, remove: typeof rmSync = rmSync) {
  const commands: [string, string[]][] = [
    ['init', ['init', '-q']],
    ['add', ['add', '--', 'source.mjs', 'source.test.mjs']],
    ['commit', ['-c', 'user.name=Synthetic Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Synthetic selected-file fixture']],
  ];
  for (const [phase, args] of commands) {
    const started = performance.now();
    try {
      execute(process.platform === 'win32' ? 'git.exe' : 'git', ['-C', dir, ...args],
        { windowsHide: true, timeout: 5000, maxBuffer: 32768, stdio: 'pipe' });
    } catch (error) {
      let cleanup = 'removed';
      try { remove(dir, { recursive: true, force: true }); } catch { cleanup = 'failed'; }
      // Do not attach the original error: spawnargs, stdout and stderr may contain paths.
      throw Error('synthetic Git fixture setup failed ' + JSON.stringify({ phase,
        elapsedMs: Math.round(performance.now() - started), deadlineMs: 5000,
        timedOut: typeof error === 'object' && error !== null && 'code' in error && error.code === 'ETIMEDOUT', cleanup }));
    }
  }
}
