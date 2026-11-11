import type { MissionEvent, MissionProjection } from './mission-contracts.mts';
import type { MissionReportTiming, StreamEvent } from './contracts.mts';
import type { ReportedUsage } from '../../openai-provider/contracts.mts';
import type { TurnEvent } from '../../openai-provider/contracts.mts';

/** Bodyless milestones measured relative to the caller's monotonic start. */
export function observeProviderStream(started: number) {
  let responseCreatedMs: number | null = null, firstTextDeltaMs: number | null = null;
  return {
    observe(type: TurnEvent['type']) {
      if (type === 'provider/response-created') responseCreatedMs ??= performance.now() - started;
      if (type === 'provider/text-delta') firstTextDeltaMs ??= performance.now() - started;
    },
    read: () => ({ responseCreatedMs, firstTextDeltaMs }),
  };
}

function boundary(event: MissionEvent) {
  return { eventSeq: event.seq, utc: event.time, clock: event.timing?.domain ?? null,
    monotonicMs: event.timing?.monotonicMs ?? null };
}

type AttemptBoundary = ReturnType<typeof boundary>;
type Interval = { id: string; clock: string; start: number; end: number };
type Path = { durationMs: number; attemptIds: string[] };
export type ReportPublication = Pick<StreamEvent, 'eventId' | 'cursor' | 'receivedAt'> & {
  timing: MissionReportTiming | null;
};

function timeToReportStaging(timing: MissionReportTiming | null | undefined,
  start: Pick<AttemptBoundary, 'clock' | 'monotonicMs'> | null) {
  if (!timing || start?.clock !== timing.clock || start.monotonicMs === null ||
    timing.compositionStartedMs < start.monotonicMs) return null;
  return timing.stagedMs - start.monotonicMs;
}

function reportedUsage(usage?: ReportedUsage): ReportedUsage | null {
  const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  if (usage?.source !== 'provider-reported') return null;
  const { inputTokens, outputTokens, totalTokens, cachedInputTokens, cacheWriteInputTokens, reasoningOutputTokens } = usage;
  if (!count(inputTokens) || !count(outputTokens) || !count(totalTokens)) return null;
  return { source: usage.source, inputTokens, outputTokens, totalTokens,
    ...(count(cachedInputTokens) ? { cachedInputTokens } : {}),
    ...(count(cacheWriteInputTokens) ? { cacheWriteInputTokens } : {}),
    ...(count(reasoningOutputTokens) ? { reasoningOutputTokens } : {}) };
}

function interval(id: string, start: AttemptBoundary, end: AttemptBoundary | null): Interval | null {
  if (!start.clock || start.clock !== end?.clock || start.monotonicMs === null ||
    end.monotonicMs === null || end.monotonicMs < start.monotonicMs) return null;
  return { id, clock: start.clock, start: start.monotonicMs, end: end.monotonicMs };
}

function occupancy(intervals: Interval[]) {
  const edges = intervals.flatMap(({ start, end }) => start === end ? [] :
    [{ time: start, delta: 1 }, { time: end, delta: -1 }])
    .sort((a, b) => a.time - b.time || a.delta - b.delta);
  let workers = 0, workerMs = 0, activeMs = 0, overlapMs = 0, peakWorkers = 0;
  let previous = edges[0]?.time ?? 0;
  for (const { time, delta } of edges) {
    const elapsed = time - previous;
    workerMs += workers * elapsed;
    if (workers > 0) activeMs += elapsed;
    if (workers > 1) overlapMs += elapsed;
    workers += delta;
    peakWorkers = Math.max(peakWorkers, workers);
    previous = time;
  }
  return { workerMs, activeMs, overlapMs, peakWorkers };
}

function criticalPath(attempts: { id: string; predecessors: string[] | null; interval: Interval | null }[]): Path | null {
  const paths = new Map<string, Path & { end: number }>();
  let longest: Path | null = null;
  for (const attempt of attempts) {
    if (!attempt.interval || !attempt.predecessors) return null;
    const { start, end } = attempt.interval;
    let prior: Path = { durationMs: 0, attemptIds: [] };
    for (const predecessor of attempt.predecessors) {
      const path = paths.get(predecessor);
      if (!path || path.end > start) return null;
      if (path.durationMs >= prior.durationMs) prior = path;
    }
    const path = { durationMs: prior.durationMs + end - start, attemptIds: [...prior.attemptIds, attempt.id] };
    paths.set(attempt.id, { ...path, end });
    if (!longest || path.durationMs > longest.durationMs) longest = path;
  }
  return longest;
}

/** Read model of already-authorized mission receipts. No independent journal or content retention. */
export function projectMissionExecution(mission: MissionProjection, reportPublication: ReportPublication | null = null) {
  const events = [...new Map(mission.events.map(event => [event.seq, event])).values()].sort((a, b) => a.seq - b.seq);
  const byAttempt = new Map([...mission.tasks, ...(mission.retiredTasks ?? [])].flatMap(task =>
    task.attempts.map((attempt, i) => [attempt.id, { task, attempt, previous: task.attempts[i - 1]?.id }] as const)));
  const starts = new Map<string, MissionEvent>();
  const terminals = new Map<string, MissionEvent>();
  for (const event of events) {
    const id = event.attemptId;
    if (!id || byAttempt.get(id)?.task.id !== event.taskId) continue;
    if (event.kind === 'started' && !starts.has(id)) starts.set(id, event);
    if ((event.kind === 'settled' || event.kind === 'recovered') && starts.has(id) && !terminals.has(id))
      terminals.set(id, event);
  }
  const attempts = Array.from(starts, ([id, event]) => {
    const { task, attempt, previous } = byAttempt.get(id)!;
    const matched = terminals.get(id);
    const start = boundary(event), end = matched ? boundary(matched) : null;
    const dependencies = attempt.context?.dependencies;
    const predecessors = dependencies ? [...new Set([
      ...(previous ? [previous] : []), ...dependencies.map(dependency => dependency.attemptId),
    ])] : null;
    const measured = matched?.kind === 'settled' ? interval(id, start, end) : null;
    const readings = attempt.admission?.readings;
    return {
      id, taskId: task.id, planRevision: event.timing?.planRevision ?? attempt.context?.binding.revision ?? null, start, end, predecessors,
      executor: attempt.executor, state: attempt.outcome ?? 'running', interrupted: matched?.kind === 'recovered',
      agentProfileId: task.teamMember?.profileId ?? task.specialist?.profile?.id ?? null,
      providerSelection: task.specialist ? {
        provider: task.specialist.provider, model: task.specialist.model, effort: task.specialist.effort ?? null,
      } : null,
      interval: measured, contextPreparationMs: attempt.timing?.contextPreparationMs ?? null,
      executionMs: attempt.timing?.executionMs ?? null, verificationMs: attempt.timing?.verificationMs ?? null,
      queueWallClockMs: attempt.timing?.queueMs ?? null,
      resourceAdmission: attempt.admission && readings ? {
        workerLimit: attempt.admission.workerLimit,
        cpuPercent: readings.cpuPercent ?? null,
        gpuEnginePercent: readings.gpuEnginePercent ?? null,
        availableMemoryBytes: readings.availableMemoryBytes ?? null,
        diskQueueLength: readings.diskQueueLength ?? null,
      } : null,
      providerCalls: attempt.telemetry?.providerCalls ?? null,
      providerEvidence: attempt.telemetry?.providerEvidence ?? null,
      providerAdapterMs: attempt.telemetry?.providerCalls ? attempt.telemetry.durationMs : null,
      providerStream: attempt.telemetry?.providerStream ? { ...attempt.telemetry.providerStream } : null,
      reportedModel: attempt.telemetry?.reportedModel ?? null,
      usage: reportedUsage(attempt.telemetry?.usage),
      verifiedEvidenceIds: attempt.verification?.passed && attempt.outcome === 'verified' ?
        [...attempt.verification.evidenceIds] : [],
    };
  });
  const segments = new Map<string, Interval[]>();
  for (const { interval: measured } of attempts) {
    if (!measured) continue;
    const group = segments.get(measured.clock) ?? [];
    group.push(measured);
    segments.set(measured.clock, group);
  }
  const clockSegments = Array.from(segments, ([clock, intervals]) => ({
    clock, attemptIds: intervals.map(item => item.id), ...occupancy(intervals),
  }));
  const complete = attempts.length > 0 && attempts.length === byAttempt.size &&
    attempts.every(attempt => attempt.interval !== null) && clockSegments.length === 1;
  const total = complete ? clockSegments[0] : null;
  const created = events.find(event => event.kind === 'created');
  const initial = created ? boundary(created) : null;
  const intakeMs = created?.timing?.intakeMonotonicMs;
  const intake = initial?.clock && intakeMs !== undefined ?
    { source: 'mission-start-command' as const, eventSeq: initial.eventSeq, clock: initial.clock, monotonicMs: intakeMs } : null;
  const firstVerified = attempts.filter(attempt => attempt.verifiedEvidenceIds.length && attempt.end)
    .sort((a, b) => a.end!.eventSeq - b.end!.eventSeq)[0]?.end ?? null;
  const lastSettlement = attempts.flatMap(attempt => attempt.interval && attempt.end ? [attempt.end] : [])
    .sort((a, b) => b.eventSeq - a.eventSeq)[0] ?? null;
  const plan = mission.planning;
  const active = ['queued', 'running', 'cancelling', 'paused'].includes(mission.outcome);
  const profile = mission.profile;
  const planningUsage = reportedUsage(plan?.usage);
  const usage = attempts.flatMap(attempt => attempt.usage ? [{ tokens: attempt.usage.totalTokens, source: attempt.providerEvidence }] : []);
  if (planningUsage) usage.push({ tokens: planningUsage.totalTokens, source: plan?.providerEvidence ?? null });
  const tokenTotal = (source: 'reported' | 'simulated' | null) => {
    const readings = usage.filter(reading => reading.source === source);
    return readings.length ? readings.reduce((sum, reading) => sum + reading.tokens, 0) : null;
  };
  const timeToVerified = initial ? interval(mission.id, initial, firstVerified) : null;
  const timeToSettlement = complete && !active && initial ? interval(mission.id, initial, lastSettlement) : null;
  const path = complete && !active ? criticalPath(attempts) : null;
  const pathIds = new Set(path?.attemptIds);
  const longestOnPath = attempts.filter(attempt => pathIds.has(attempt.id) && attempt.interval)
    .sort((a, b) => (b.interval!.end - b.interval!.start) - (a.interval!.end - a.interval!.start))[0];
  return {
    contract: 'aerynth.mission-execution-profile@1' as const,
    kind: 'execution-profile' as const, missionId: mission.id, revision: mission.revision, outcome: mission.outcome,
    admission: initial, firstVerifiedTask: firstVerified, lastSettlement, reportPublication,
    settlementToReportStagedMs: complete ? timeToReportStaging(reportPublication?.timing, lastSettlement) : null,
    intakeToReportStagedMs: timeToReportStaging(reportPublication?.timing, intake),
    requestIntake: intake, firstMeaningfulOutput: null, userDelivery: null,
    intakeToAdmissionMs: intake && initial?.monotonicMs != null ? initial.monotonicMs - intake.monotonicMs : null,
    admissionToFirstVerifiedTaskMs: timeToVerified ? timeToVerified.end - timeToVerified.start : null,
    admissionToLastSettlementMs: timeToSettlement ? timeToSettlement.end - timeToSettlement.start : null,
    // Planning starts before mission admission. Its independent receipt has no monotonic linkage.
    planning: plan ? { durationMs: plan.durationMs, provider: plan.provider, model: plan.model,
      executionId: plan.executionId ?? null, timing: plan.timing ? { ...plan.timing } : null,
      providerEvidence: plan.providerEvidence ?? null, usage: planningUsage } : null,
    attempts, waits: mission.waits,
    work: {
      causalBoundary: 'attempt-dependencies-and-retries' as const,
      openAttempts: attempts.filter(attempt => attempt.state === 'running' && !attempt.end).map(attempt => attempt.id),
      clockSegments, workerMs: total?.workerMs ?? null, activeMs: total?.activeMs ?? null,
      overlapMs: total?.overlapMs ?? null, peakWorkers: total?.peakWorkers ?? null,
      intervalCoverage: { measured: clockSegments.reduce((count, segment) => count + segment.attemptIds.length, 0),
        attempts: byAttempt.size },
      // Measures occupied work on explicit dependency/retry edges. Queue gaps are separate.
      criticalPath: path,
      longestOccupiedAttemptOnPath: longestOnPath ? { attemptId: longestOnPath.id, taskId: longestOnPath.taskId,
        durationMs: longestOnPath.interval!.end - longestOnPath.interval!.start,
        eventSeqs: [longestOnPath.start.eventSeq, longestOnPath.end!.eventSeq] } : null,
    },
    economics: {
      providerCalls: profile.providerCalls, reportedTotalTokens: tokenTotal('reported'),
      simulatedTotalTokens: tokenTotal('simulated'), unattributedTotalTokens: tokenTotal(null),
      usageCoverage: usage.length === 0 ? profile.providerCalls === 0 ? 'not-applicable' as const : 'missing' as const :
        usage.length === profile.providerCalls ? 'complete' as const : 'partial' as const,
      cost: null,
    },
    quality: {
      taskOutcomes: mission.tasks.map(task => ({ taskId: task.id, state: task.state })),
      partialObjectiveCoverage: mission.coverage?.status === 'partial',
      independentComparison: null,
    },
    experiment: { state: 'baseline-observation' as const, blockers: [
      ...(path ? [] : ['incomplete-causal-timing']),
      'no-matched-comparison', 'no-independent-quality-evaluation',
    ] },
  };
}

export type MissionExecutionProfile = ReturnType<typeof projectMissionExecution>;
