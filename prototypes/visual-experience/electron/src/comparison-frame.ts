import { percentiles } from "./benchmark";

export interface ComparisonFrameTrace {
  scenario: string;
  clock: "renderer-performance-time-origin";
  timeOriginUnixMs: number;
  startedAtMs: number;
  stoppedAtMs: number;
  startedWallUtc: string;
  stoppedWallUtc: string;
  refreshHz: number;
  refreshIntervalMs: number;
  stutterThresholdMs: number;
  missedRefreshEstimate: number;
  visibleAtStart: boolean;
  visibleAtStop: boolean;
  samplesDroppedByCap: number;
  intervalsMs: number[];
  summary: ReturnType<typeof percentiles> & { stutterCount: number };
}

export class ComparisonFrameRecorder {
  private active: {
    scenario: string;
    refreshHz: number;
    startedAtMs: number;
    startedWallUtc: string;
    visibleAtStart: boolean;
    previousFrame: number;
    intervals: number[];
    dropped: number;
    handle: number;
  } | null = null;

  start(scenario: string, refreshHz: number) {
    if (this.active)
      throw new Error(`Frame capture already active: ${this.active.scenario}`);
    const session = {
      scenario,
      refreshHz,
      startedAtMs: performance.now(),
      startedWallUtc: new Date().toISOString(),
      visibleAtStart: !document.hidden,
      previousFrame: 0,
      intervals: [] as number[],
      dropped: 0,
      handle: 0,
    };
    const frame = (now: number) => {
      if (this.active !== session) return;
      if (session.previousFrame) {
        if (session.intervals.length < 100_000)
          session.intervals.push(now - session.previousFrame);
        else session.dropped++;
      }
      session.previousFrame = now;
      session.handle = requestAnimationFrame(frame);
    };
    this.active = session;
    session.handle = requestAnimationFrame(frame);
    return {
      scenario,
      startedAtMs: session.startedAtMs,
      timeOriginUnixMs: performance.timeOrigin,
      startedWallUtc: session.startedWallUtc,
    };
  }

  stop(): ComparisonFrameTrace {
    const session = this.active;
    if (!session) throw new Error("No frame capture is active");
    this.active = null;
    cancelAnimationFrame(session.handle);
    const stoppedAtMs = performance.now();
    const refreshIntervalMs = 1000 / session.refreshHz;
    const stutterThresholdMs = refreshIntervalMs * 2;
    const missedRefreshEstimate = session.intervals.reduce(
      (sum, interval) =>
        sum + Math.max(0, Math.round(interval / refreshIntervalMs) - 1),
      0,
    );
    const summary = {
      ...percentiles(session.intervals, stoppedAtMs - session.startedAtMs),
      stutterCount: session.intervals.filter(
        (value) => value > stutterThresholdMs,
      ).length,
    };
    return {
      scenario: session.scenario,
      clock: "renderer-performance-time-origin",
      timeOriginUnixMs: performance.timeOrigin,
      startedAtMs: session.startedAtMs,
      stoppedAtMs,
      startedWallUtc: session.startedWallUtc,
      stoppedWallUtc: new Date().toISOString(),
      refreshHz: session.refreshHz,
      refreshIntervalMs,
      stutterThresholdMs,
      missedRefreshEstimate,
      visibleAtStart: session.visibleAtStart,
      visibleAtStop: !document.hidden,
      samplesDroppedByCap: session.dropped,
      intervalsMs: session.intervals,
      summary,
    };
  }

  get activeScenario() {
    return this.active?.scenario ?? null;
  }
  dispose() {
    if (this.active) cancelAnimationFrame(this.active.handle);
    this.active = null;
  }
}
