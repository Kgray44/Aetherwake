import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

export type WindowsGpuThermals = { temperatureCelsius: number | null; slowdown: 0 | 1 | null };

export function parseNvidiaGpuThermals(output: string): WindowsGpuThermals {
  const rows = output.trim().split(/\r?\n/u);
  if (!output.trim() || rows.length > 64) throw Error('nvidia_thermal_output_invalid');
  let temperatureCelsius: number | null = null;
  let anyActive = false, allClear = true;
  for (const row of rows) {
    const fields = row.split(',').map(value => value.trim());
    if (fields.length !== 3) throw Error('nvidia_thermal_output_invalid');
    const [temperature, hardware, software] = fields;
    if (/^-?\d{1,3}(?:\.\d{1,3})?$/u.test(temperature)) {
      const celsius = Number(temperature);
      if (celsius >= -100 && celsius <= 200) temperatureCelsius = Math.max(temperatureCelsius ?? celsius, celsius);
    }
    anyActive ||= hardware === 'Active' || software === 'Active';
    allClear &&= hardware === 'Not Active' && software === 'Not Active';
  }
  return { temperatureCelsius, slowdown: anyActive ? 1 : allClear ? 0 : null };
}

export function createWindowsGpuThermalsProbe() {
  const root = process.env.SystemRoot;
  if (process.platform !== 'win32' || !root || !isAbsolute(root)) return undefined;
  const executable = join(root, 'System32', 'nvidia-smi.exe');
  if (!existsSync(executable)) return undefined;
  const execute = promisify(execFile);
  return async (signal: AbortSignal) => {
    const { stdout } = await execute(executable, [
      '--query-gpu=temperature.gpu,clocks_event_reasons.hw_thermal_slowdown,clocks_event_reasons.sw_thermal_slowdown',
      '--format=csv,noheader,nounits',
    ], { windowsHide: true, timeout: 1500, maxBuffer: 8192, encoding: 'utf8', signal });
    return parseNvidiaGpuThermals(stdout);
  };
}
