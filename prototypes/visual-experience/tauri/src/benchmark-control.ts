/** Local renderer instrumentation. These timestamps are software proxies, never display presents. */
export type ActionTrace = {
  id: string;
  surface: string;
  source: 'scripted-renderer' | 'ui-event';
  intendedOffsetMs: number | null;
  actualOffsetMs: number | null;
  scheduleSlipMs: number | null;
  wallUtc: string;
  timeOriginMs: number;
  dispatchMs: number;
  handlerStartMs: number;
  stateCommitMs: number | null;
  nextFrameMs: number | null;
  frameGapReason: string | null;
  status: 'started' | 'committed' | 'failed';
  note: string | null;
};

export class BenchmarkLedger {
  private records: ActionTrace[] = [];
  readonly surface: string;

  constructor(surface: string) { this.surface = surface; }

  clear() { this.records = []; }

  snapshot() {
    return {
      schema: 'aerynth-renderer-actions-v1',
      surface: this.surface,
      capturedUtc: new Date().toISOString(),
      clock: 'performance.now() monotonic milliseconds in this renderer; timeOriginMs + offset is only a cross-process wall-clock approximation',
      limits: ['Script dispatch is not physical input time.', 'Next requestAnimationFrame is not an OS display present.', 'Window and renderer clocks have not been synchronized.'],
      records: this.records.map(record => ({ ...record })),
    };
  }

  begin(id: string, source: ActionTrace['source'] = 'scripted-renderer', intendedOffsetMs: number | null = null, scheduledOriginMs: number | null = null, event?: Event) {
    const dispatchMs = event?.timeStamp ?? performance.now();
    const handlerStartMs = performance.now();
    const actualOffsetMs = scheduledOriginMs === null ? null : dispatchMs - scheduledOriginMs;
    const record: ActionTrace = {
      id, surface: this.surface, source, intendedOffsetMs,
      actualOffsetMs, scheduleSlipMs: actualOffsetMs === null || intendedOffsetMs === null ? null : actualOffsetMs - intendedOffsetMs,
      wallUtc: new Date().toISOString(), timeOriginMs: performance.timeOrigin,
      dispatchMs, handlerStartMs,
      stateCommitMs: null, nextFrameMs: null, frameGapReason: null,
      status: 'started', note: null,
    };
    this.records.push(record);
    if (this.records.length > 1200) this.records.shift();
    return {
      commit: (note?: string) => {
        record.stateCommitMs = performance.now();
        record.status = 'committed';
        record.note = note ?? null;
        const timeout = window.setTimeout(() => {
          if (record.nextFrameMs === null) record.frameGapReason = 'No requestAnimationFrame callback within 1500 ms';
        }, 1500);
        requestAnimationFrame(now => { record.nextFrameMs = now; record.frameGapReason = null; clearTimeout(timeout); });
      },
      fail: (error: unknown) => { record.status = 'failed'; record.note = String(error); },
    };
  }

  async step(id: string, operation: () => void | Promise<void>, intendedOffsetMs: number | null = null, scheduledOriginMs: number | null = null) {
    const trace = this.begin(id, 'scripted-renderer', intendedOffsetMs, scheduledOriginMs);
    try { await operation(); trace.commit(); }
    catch (error) { trace.fail(error); throw error; }
  }
}

export async function atOffset(startMs: number, offsetMs: number) {
  const remaining = startMs + offsetMs - performance.now();
  if (remaining > 0) await new Promise<void>(resolve => setTimeout(resolve, remaining));
}
