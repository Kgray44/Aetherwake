/** Bounded direct-child resource sampling. Coverage is explicit per counter. */
import {readFile} from 'node:fs/promises';
import {execFileSync, spawn} from 'node:child_process';
import {win32} from 'node:path';

const WINDOWS_START_DELAY_MS = 25_000;
const WINDOWS_MIN_INTERVAL_MS = 2_000;
const MAX_TIMEOUT_MS = 2_147_483_647;
const elapsedMs = started => Number(process.hrtime.bigint() - started) / 1e6;
const max = (previous, value) => Number.isFinite(value) ? Math.max(previous ?? 0, value) : previous;

function sampledDelta() {
  let first, previous, count = 0, reset = false;
  return {
    add(value) {
      if (!Number.isFinite(value) || value < 0) return;
      if (previous !== undefined && value < previous) reset = true;
      first ??= value;
      previous = value;
      count++;
    },
    value() {
      return count >= 2 && !reset ? previous - first : null;
    }
  };
}

function observeLinux(pid, intervalMs, record, addElapsed) {
  const setup = process.hrtime.bigint();
  let ticks;
  try {
    ticks = Number(execFileSync('getconf', ['CLK_TCK'], {encoding:'utf8', stdio:['ignore','pipe','ignore']}));
  } catch {}
  addElapsed(elapsedMs(setup));
  const root = '/proc/' + pid;
  let pending, identity;
  async function sample() {
    const started = process.hrtime.bigint();
    try {
      const [status, stat, io] = await Promise.all([
        readFile(root + '/status', 'utf8'),
        readFile(root + '/stat', 'utf8'),
        readFile(root + '/io', 'utf8').catch(() => null)
      ]);
      const number = (text, key) => Number(text?.match(new RegExp('^' + key + ':\\s+(\\d+)', 'm'))?.[1]);
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      if (!fields[19] || (identity && fields[19] !== identity)) return;
      identity = fields[19];
      const cpu = Number(fields[11]) + Number(fields[12]);
      record({
        rss: number(status, 'VmRSS') * 1024,
        highWater: number(status, 'VmHWM') * 1024,
        cpu: ticks > 0 ? 1000 * cpu / ticks : undefined,
        read: number(io, 'read_bytes'),
        write: number(io, 'write_bytes')
      });
    } catch {
      // The child may exit before a proc snapshot completes.
    } finally {
      addElapsed(elapsedMs(started));
    }
  }
  const collect = () => {
    pending ??= sample().finally(() => { pending = undefined; });
  };
  const timer = setInterval(collect, intervalMs);
  timer.unref();
  collect();
  return async () => {
    clearInterval(timer);
    await pending;
  };
}

function observeWindows(pid, intervalMs, startDelayMs, record, addElapsed, recordHelperCpu) {
  // Only validated integers enter this fixed script. A creation-time bound
  // prevents a child that exited before startup from being mistaken for a new PID owner.
  const lastPossibleStart = Date.now() + 1;
  const script = [
    '$ErrorActionPreference = "Stop"',
    'try {',
    '  $owner = [Diagnostics.Process]::GetProcessById(' + process.pid + ')',
    '  $child = [Diagnostics.Process]::GetProcessById(' + pid + ')',
    '  $latest = [DateTimeOffset]::FromUnixTimeMilliseconds(' + lastPossibleStart + ').UtcDateTime',
    '  if ($child.StartTime.ToUniversalTime() -gt $latest) { exit }',
    '  $helper = [Diagnostics.Process]::GetCurrentProcess()',
    '  $timer = New-Object Diagnostics.Stopwatch',
    '  while (!$owner.HasExited -and !$child.HasExited) {',
    '    $timer.Restart()',
    '    $child.Refresh()',
    '    $rss = $child.WorkingSet64',
    '    $peak = $child.PeakWorkingSet64',
    '    $cpu = $child.TotalProcessorTime.Ticks',
    '    $helperCpu = $helper.TotalProcessorTime.Ticks',
    '    $timer.Stop()',
    '    [Console]::WriteLine("{0}|{1}|{2}|{3}|{4}", $rss, $peak, $cpu, $timer.Elapsed.Ticks, $helperCpu)',
    '    [Threading.Thread]::Sleep(' + intervalMs + ')',
    '  }',
    '} catch { exit }'
  ].join('\n');

  let helper, remainder = '';
  const timer = setTimeout(() => {
    if (!process.env.SystemRoot) return;
    const executable = win32.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    helper = spawn(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64')], {
      shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
    });
    helper.on('error', () => {}); // Resource observation must not fail the engineering command.
    helper.stdout.setEncoding('utf8');
    helper.stdout.on('data', chunk => {
      const lines = (remainder + chunk).split('\n');
      remainder = lines.pop();
      if (remainder.length > 128) {
        helper.kill();
        helper.stdout.destroy();
        return;
      }
      for (const line of lines) {
        if (!/^\d{1,16}(\|\d{1,16}){4}\r?$/.test(line)) continue;
        const [rss, highWater, cpu, queryTime, helperCpu] = line.split('|').map(Number);
        record({rss, highWater, cpu:cpu / 10_000});
        addElapsed(queryTime / 10_000);
        recordHelperCpu(helperCpu / 10_000);
      }
    });
    helper.unref();
  }, startDelayMs);
  timer.unref();
  return () => {
    clearTimeout(timer);
    if (helper) {
      helper.kill();
      helper.stdout.destroy();
    }
  };
}

export function observeResources(pid, {
  platform=process.platform,
  intervalMs=platform === 'win32' ? WINDOWS_MIN_INTERVAL_MS : 250,
  windowsStartDelayMs=WINDOWS_START_DELAY_MS
}={}) {
  if (!Number.isInteger(intervalMs) || intervalMs < 100 || intervalMs > MAX_TIMEOUT_MS) {
    throw Error('Sampling interval must be an integer between 100 and 2147483647 ms');
  }
  if (!Number.isInteger(windowsStartDelayMs) || windowsStartDelayMs < 0 || windowsStartDelayMs > MAX_TIMEOUT_MS) {
    throw Error('Windows sampling start delay must be an integer between 0 and 2147483647 ms');
  }
  const cpu = sampledDelta(), read = sampledDelta(), write = sampledDelta();
  let count = 0, peakRss = null, highWaterRss = null, samplingMs = 0, helperCpuMs = null;
  function record(sample) {
    peakRss = max(peakRss, sample.rss);
    highWaterRss = max(highWaterRss, sample.highWater);
    cpu.add(sample.cpu);
    read.add(sample.read);
    write.add(sample.write);
    count++;
  }
  const addElapsed = value => { samplingMs += value; };
  const source = {linux:'linux_proc', win32:'windows_process_api'}[platform] ?? 'local_observer';
  let stopSampling;
  if (Number.isInteger(pid) && pid > 0 && pid <= MAX_TIMEOUT_MS) {
    if (platform === 'linux') stopSampling = observeLinux(pid, intervalMs, record, addElapsed);
    if (platform === 'win32') {
      stopSampling = observeWindows(pid, Math.max(WINDOWS_MIN_INTERVAL_MS, intervalMs), windowsStartDelayMs, record, addElapsed, value => {
        helperCpuMs = max(helperCpuMs, value);
      });
    }
  }

  const metric = (name, value, unit, metricSource=source, method='sampled_direct_child_only') => ({
    name, availability:value === null ? 'unavailable' : 'observed',
    ...(value === null ? {} : {value}), unit, source:metricSource, method
  });
  let stopped;
  return {
    stop() {
      stopped ??= (async () => {
        await stopSampling?.();
        return [
          metric('child_sampled_peak_rss_bytes', peakRss, 'bytes'),
          metric('child_observed_high_water_rss_bytes', highWaterRss, 'bytes'),
          metric('child_sampled_cpu_ms', cpu.value(), 'ms'),
          metric('child_sampled_disk_read_bytes', read.value(), 'bytes'),
          metric('child_sampled_disk_write_bytes', write.value(), 'bytes'),
          platform === 'win32'
            ? metric('monitor_sampling_elapsed_ms', count ? samplingMs : null, 'ms', 'windows_stopwatch', 'sample_queries_only')
            : metric('monitor_sampling_elapsed_ms', stopSampling ? samplingMs : null, 'ms', 'local_monotonic_clock', 'sampling_including_io_wait'),
          ...(platform === 'win32' ? [
            metric('monitor_helper_observed_cpu_ms', helperCpuMs, 'ms', 'windows_process_api', 'helper_cpu_at_last_sample')
          ] : []),
          metric('resource_sample_count', count, 'count', 'local_observer', 'successful_samples')
        ];
      })();
      return stopped;
    }
  };
}
