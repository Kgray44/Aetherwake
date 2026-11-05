import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { TimerClockReading } from '../../timer-product/contracts.ts';

/** Fixed read-only native query. No paths, arguments, user text or environment values are interpolated. */
export const WINDOWS_TIMER_CLOCK_SCRIPT = `$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AerynthElapsedClock {
  [DllImport("kernel32.dll")]
  public static extern UInt64 GetTickCount64();
}
'@
[Console]::Out.Write([AerynthElapsedClock]::GetTickCount64().ToString([Globalization.CultureInfo]::InvariantCulture))`;

export interface TimerClockStatus {
  state: 'cold' | 'warming' | 'ready' | 'unavailable' | 'disposed';
  source: 'windows-get-tick-count-64' | 'injected-trusted-elapsed' | 'unsupported';
  includesSuspend: boolean;
  calibrationDurationMs: number | null;
  errorCode?: string;
}
export interface TrustedTimerClockPort {
  ready(): Promise<void>;
  read(): TimerClockReading;
  onResume(): Promise<void>;
  status(): TimerClockStatus;
  dispose(): void;
}
export class TimerClockError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = 'TimerClockError'; this.code = code; }
}
const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;

export function sampleWindowsTimerClock(signal?: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_TIMER_CLOCK_SCRIPT], {
      windowsHide: true, timeout: 5000, maxBuffer: 1024, encoding: 'utf8', signal,
    }, (error, stdout) => {
      if (error || !/^\d{1,16}$/u.test(stdout.trim())) { reject(new TimerClockError('timer_elapsed_sample_failed')); return; }
      const ticks = Number(stdout.trim());
      if (!Number.isSafeInteger(ticks) || ticks < 0) reject(new TimerClockError('timer_elapsed_sample_failed'));
      else resolve(ticks);
    });
  });
}

export interface TrustedTimerClockOptions {
  platform?: NodeJS.Platform;
  /** Explicit contract: samples are trusted, comparable elapsed milliseconds including suspended time. */
  sampleElapsed?(signal: AbortSignal): Promise<number>;
  performanceNow?(): number;
  wallNow?(): number;
  locale?(): string;
  timeZone?(): string;
}

/** Windows elapsed samples at warmup/resume, calibrated to cheap high-resolution reads between samples.
 * Default non-Windows hosts are unavailable: no wall/performance fallback is called suspend-aware.
 * Each instance has a fresh process-session identity; restart recovery remains explicitly uncertain. */
export function createTrustedTimerClock(options: TrustedTimerClockOptions = {}): TrustedTimerClockPort {
  const platform = options.platform ?? process.platform;
  const supported = !!options.sampleElapsed || platform === 'win32';
  const sample = options.sampleElapsed ?? sampleWindowsTimerClock;
  const performanceNow = options.performanceNow ?? (() => performance.now()), wallNow = options.wallNow ?? Date.now;
  const source: TimerClockStatus['source'] = options.sampleElapsed ? 'injected-trusted-elapsed' : supported ? 'windows-get-tick-count-64' : 'unsupported';
  let state: TimerClockStatus['state'] = 'cold', sessionId = 'timer-clock:' + randomUUID();
  let nativeAtSample = 0, performanceAtSample = 0, lastElapsed = 0, calibrated = false, calibrationDurationMs: number | null = null;
  let errorCode: string | undefined, pending: Promise<void> | null = null, controller: AbortController | null = null;
  const isDisposed = () => state === 'disposed';
  function calibrate(): Promise<void> {
    if (state === 'disposed') return Promise.reject(new TimerClockError('timer_clock_disposed'));
    if (pending) return pending;
    if (!supported) { state = 'unavailable'; errorCode = 'timer_elapsed_clock_unsupported'; return Promise.reject(new TimerClockError(errorCode)); }
    state = 'warming'; errorCode = undefined; controller = new AbortController(); const signal = controller.signal;
    const before = performanceNow();
    const work = (async () => {
      try {
        if (!valid(before)) throw new TimerClockError('invalid_timer_performance_clock');
        const ticks = await sample(signal), after = performanceNow();
        if (signal.aborted || isDisposed()) throw new TimerClockError('timer_clock_disposed');
        if (!Number.isSafeInteger(ticks) || ticks < 0 || !valid(after) || after < before) throw new TimerClockError('invalid_timer_elapsed_sample');
        // A native origin moving backwards by more than sampling jitter is incomparable.
        if (calibrated && ticks < nativeAtSample - 1000) { sessionId = 'timer-clock:' + randomUUID(); lastElapsed = 0; }
        nativeAtSample = Math.max(ticks, lastElapsed); performanceAtSample = after; lastElapsed = nativeAtSample;
        calibrated = true; calibrationDurationMs = after - before; state = 'ready';
      } catch (error) {
        if (!isDisposed()) { state = 'unavailable'; errorCode = error instanceof TimerClockError ? error.code : 'timer_elapsed_sample_failed'; }
        throw isDisposed() ? new TimerClockError('timer_clock_disposed') : new TimerClockError(errorCode!);
      }
    })();
    pending = work;
    void work.finally(() => { if (pending === work) pending = null; controller = null; }).catch(() => {});
    return work;
  }
  return {
    ready() {
      if (state === 'ready') return Promise.resolve();
      if (state === 'unavailable') return Promise.reject(new TimerClockError(errorCode ?? 'timer_clock_unavailable'));
      return calibrate();
    },
    read() {
      if (state !== 'ready') throw new TimerClockError(state === 'disposed' ? 'timer_clock_disposed' : errorCode ?? 'timer_clock_not_ready');
      const highResolution = performanceNow(), epochMs = wallNow();
      if (!valid(highResolution) || highResolution < performanceAtSample || !Number.isSafeInteger(epochMs) || Math.abs(epochMs) > 8.64e15) {
        state = 'unavailable'; errorCode = 'invalid_timer_clock_reading'; throw new TimerClockError(errorCode);
      }
      const elapsed = Math.max(lastElapsed, nativeAtSample + highResolution - performanceAtSample);
      if (!valid(elapsed)) throw new TimerClockError('invalid_timer_clock_reading');
      lastElapsed = elapsed;
      const defaults = new Intl.DateTimeFormat().resolvedOptions();
      return { epochMs, monotonicMs: elapsed, sessionId, timeZone: options.timeZone?.() ?? defaults.timeZone,
        locale: options.locale?.() ?? defaults.locale };
    },
    onResume: calibrate,
    status: () => ({ state, source, includesSuspend: state === 'ready' && supported && calibrated, calibrationDurationMs, ...(errorCode ? { errorCode } : {}) }),
    dispose() { state = 'disposed'; controller?.abort(); },
  };
}
