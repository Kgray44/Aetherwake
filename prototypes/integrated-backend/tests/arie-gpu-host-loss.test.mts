import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';

const childHost = `
  import { parentPort } from 'node:worker_threads';
  import { createMissionAdmission } from ${JSON.stringify(new URL('../src/mission-admission.mts', import.meta.url).href)};
  import { openWindowsGpuReadback, gpuReadbackReservationBytes, gpuReadbackRamReservationBytes }
    from ${JSON.stringify(new URL('../src/windows-gpu-readback.mts', import.meta.url).href)};
  const governor = createMissionAdmission({ maxWorkers: 2, readWindowsPressure: null,
    resourcePolicy: { mode: 'balanced', limits: { cpu: 2, build: 1, gpu: 1, host_io: 2, remote: 2 } } });
  const worker = openWindowsGpuReadback();
  const budget = await worker.budget;
  governor.read(true);
  if (!governor.noteGpuBudget(budget)) throw Error('gpu_budget_unavailable');
  const lease = governor.tryLease({ missionId: 'host-loss', taskId: 'gpu', attemptId: 'first', kind: 'gpu',
    gpuContextId: budget.contextId, estimatedRamBytes: gpuReadbackRamReservationBytes,
    estimatedVramBytes: gpuReadbackReservationBytes, timeoutMs: 10_000 });
  if (!lease) throw Error('gpu_lease_unavailable');
  const port = parentPort ?? process;
  const send = parentPort ? parentPort.postMessage.bind(parentPort) : process.send.bind(process);
  port.once('message', async () => {
    const pending = worker.run(lease, new AbortController().signal);
    void pending.catch(() => {});
    send({ started: await worker.started });
    await pending;
  });
  send({ processId: worker.processId });
`;
const threadHost = `
  import { Worker } from 'node:worker_threads';
  const worker = new Worker(new URL(${JSON.stringify('data:text/javascript,' + encodeURIComponent(childHost))}));
  worker.on('message', message => process.send(message));
  process.on('message', async message => {
    if (message === 'terminate-thread') {
      await worker.terminate();
      process.send({ terminated: true });
    } else worker.postMessage(message);
  });
`;

const options = {
  skip: process.platform !== 'win32' || process.env.AERYNTH_VERIFY_GPU_HOST_LOSS !== '1', timeout: 30_000,
};
for (const threadOnly of [false, true]) test(`the admitted Windows GPU child exits after ${threadOnly ? 'backend thread' : 'host process'} loss`, options, async t => {
  const host = spawn(process.execPath, ['--input-type=module', '--eval', threadOnly ? threadHost : childHost],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  const hostClosed = once(host, 'exit');
  const deadline = AbortSignal.any([t.signal, AbortSignal.timeout(23_000)]);
  try {
    const [{ processId }] = await once(host, 'message', { signal: deadline });
    assert.ok(Number.isSafeInteger(processId) && processId > 0);
    const powerShell = join(process.env.SystemRoot!, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    // Take a handle to this exact owned GPU child before dispatch, so PID reuse cannot affect the result.
    const watcher = spawn(powerShell, ['-NoProfile', '-NonInteractive', '-Command',
      `$ErrorActionPreference = 'Stop'; $worker = Get-Process -Id ${processId}; $null = $worker.Handle; ` +
      `Write-Output 'watching'; if (!$worker.WaitForExit(12000)) { exit 2 }; Write-Output $worker.ExitCode`],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'] });
    const watcherClosed = once(watcher, 'exit');
    try {
      const lines = createInterface({ input: watcher.stdout });
      assert.deepEqual(await once(lines, 'line', { signal: deadline }), ['watching']);
      const receipt = once(lines, 'line', { signal: deadline });
      void receipt.catch(() => {});
      const started = once(host, 'message', { signal: deadline });
      host.send('dispatch');
      assert.deepEqual((await started)[0], { started: true });
      const killedAt = performance.now();
      if (threadOnly) {
        const terminated = once(host, 'message', { signal: deadline });
        host.send('terminate-thread');
        assert.deepEqual((await terminated)[0], { terminated: true });
        assert.equal(host.exitCode, null);
      } else {
        assert.equal(host.kill(), true);
        await hostClosed;
      }
      const childExit = await receipt;
      t.diagnostic(`GPU child exit ${childExit[0]} followed host termination by ${Math.round(performance.now() - killedAt)} ms`);
      if (threadOnly) assert.deepEqual(childExit, ['74']);
      else assert.ok(['0', '74'].includes(childExit[0]));
      assert.deepEqual(await watcherClosed, [0, null]);
    } finally { if (watcher.exitCode === null && !watcher.killed) watcher.kill(); }
  } finally {
    if (host.exitCode === null && !host.killed) host.kill();
    await hostClosed;
  }
});
