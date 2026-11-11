import type { MissionAdmission, MissionAdmissionReason, MissionAttemptPhaseTiming, MissionEvent, MissionProjection } from './mission-contracts.mts';
import type { ConversationProviderTiming, MissionReportTiming, ProviderStreamTiming, StreamEvent, VelaRouteTiming } from './contracts.mts';
import type { ReportedUsage } from '../../openai-provider/contracts.mts';
import type { TurnEvent, TurnTransportTiming } from '../../openai-provider/contracts.mts';

/** Bodyless milestones measured relative to the caller's monotonic start. */
export function observeProviderStream(started: number) {
  let responseCreatedMs: number | null = null, firstTextDeltaMs: number | null = null;
  let transport: TurnTransportTiming | undefined;
  return {
    observe(type: TurnEvent['type']) {
      if (type === 'provider/response-created') responseCreatedMs ??= performance.now() - started;
      if (type === 'provider/text-delta') firstTextDeltaMs ??= performance.now() - started;
    },
    observeTransport(timing: TurnTransportTiming) { transport ??= timing; },
    read: (): ProviderStreamTiming => ({ responseCreatedMs, firstTextDeltaMs, ...(transport ? { transport } : {}) }),
  };
}
export type ProviderStreamObserver = Pick<ReturnType<typeof observeProviderStream>, 'observe' | 'observeTransport'>;

export function observeConversationProvider(origin: ConversationProviderTiming['origin'], simulated: boolean,
  parentRequestId: string | null, started = performance.now(),
  correlation?: { domain: string | null; preview: { id: string; clock?: VelaRouteTiming['previewClock'] } }) {
  const stream = observeProviderStream(started);
  const elapsed = (observedAt = performance.now()) => observedAt - started;
  const clock = correlation?.preview.clock;
  const previewOrigin = correlation && clock && correlation.domain === clock.domain &&
    clock.startedMs <= clock.readyMs && clock.readyMs <= started
    ? { id: correlation.preview.id, toAdapterMs: started - clock.startedMs }
    : undefined;
  let resultObservedMs: number | null = null;
  let firstNonblankOutput: NonNullable<ConversationProviderTiming['firstNonblankOutput']> | null = null;
  return {
    observe(event: TurnEvent) {
      stream.observe(event.type);
      if (firstNonblankOutput === null &&
        (event.type === 'provider/text-delta' || event.type === 'provider/refusal-delta') && /\S/u.test(event.delta)) {
        firstNonblankOutput = { kind: event.type === 'provider/text-delta' ? 'text' : 'refusal', elapsedMs: elapsed() };
      }
    },
    elapsed,
    previewOrigin,
    observeTransport: stream.observeTransport,
    observeResult() { resultObservedMs ??= elapsed(); },
    settlement(outputStagedMs: number | null = null): ConversationProviderTiming {
      return { ...stream.read(), source: simulated ? 'simulated' : 'observed', origin, parentRequestId,
        firstNonblankOutput, resultObservedMs, outputStagedMs, settlementStagedMs: elapsed(),
        ...(previewOrigin ? { fromPreview: { ...previewOrigin,
          toFirstNonblankOutputMs: firstNonblankOutput === null ? null :
            previewOrigin.toAdapterMs + firstNonblankOutput.elapsedMs } } : {}) };
    },
  };
}

function boundary(event: MissionEvent) {
  return { eventSeq: event.seq, utc: event.time, clock: event.timing?.domain ?? null,
    monotonicMs: event.timing?.monotonicMs ?? null };
}

function projectResourceAdmission(admission: MissionAdmission | undefined) {
  if (!admission) return null;
  const { cpuPercent, availableMemoryBytes, gpuEnginePercent, diskQueueLength } = admission.readings;
  return { workerLimit: admission.workerLimit, reasons: [...admission.reasons],
    cpuPercent: cpuPercent?.value ?? null, availableMemoryBytes: availableMemoryBytes?.value ?? null,
    gpuEnginePercent: gpuEnginePercent?.value ?? null, diskQueueLength: diskQueueLength?.value ?? null,
    observedAt: { cpuPercent: cpuPercent?.observedAt ?? null, availableMemoryBytes: availableMemoryBytes?.observedAt ?? null,
      gpuEnginePercent: gpuEnginePercent?.observedAt ?? null, diskQueueLength: diskQueueLength?.observedAt ?? null } };
}

type AttemptBoundary = ReturnType<typeof boundary>;
type Interval = { id: string; clock: string; start: number; end: number };
type Path = { durationMs: number; attemptIds: string[] };
export type ReportPublication = Pick<StreamEvent, 'eventId' | 'cursor' | 'receivedAt'> & {
  timing: MissionReportTiming | null;
};
export type ReportDelivery = import('../../application-contract/contracts.ts').RendererOutputPresentation & { messageId: string };

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

const attemptPhases = ['contextAssembly', 'dispatchValidation', 'execution', 'postExecutionContextValidation', 'verification'] as const;
type PhaseDurations = Partial<Record<typeof attemptPhases[number], number>>;

function observedReadyWait(phases: MissionAttemptPhaseTiming, gapStartedMs: number, assemblyStartedMs: number) {
  const firstObserved = phases.readyQueue?.firstObservedMs;
  return firstObserved !== undefined && firstObserved >= gapStartedMs && firstObserved <= assemblyStartedMs ?
    assemblyStartedMs - firstObserved : null;
}

/** Trace the final settlement back through the last finishing explicit prerequisite at each join. */
function dependencyReadinessPath(attempts: {
  id: string; taskId: string; interval: Interval | null; predecessors: string[] | null;
  phases: MissionAttemptPhaseTiming | null;
}[], admission: AttemptBoundary | null) {
  type Node = { attemptId: string; taskId: string; clock: string; assemblyStartedMs: number; settledMs: number;
    gapBeforeAssemblyMs: number | null; observedReadyWaitMs: number | null; unattributedGapMs: number | null;
    unattributedMs: number; phases: MissionAttemptPhaseTiming; previous: Node | null };
  const nodes = new Map<string, Node>();
  let tail: Node | null = null;
  for (const { id, taskId, interval, predecessors, phases } of attempts) {
    if (!interval || !predecessors || !phases || phases.clock !== interval.clock) return null;
    const [assemblyStartedMs, assemblyEndedMs] = phases.contextAssembly;
    if (assemblyEndedMs > interval.start) return null;
    let elapsedPhases = 0, lastEnd = interval.start;
    for (const phase of attemptPhases) {
      const bounds = phases[phase];
      if (!bounds) continue;
      const [start, end] = bounds;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start ||
        (phase !== 'contextAssembly' && (start < lastEnd || end > interval.end))) return null;
      elapsedPhases += end - start;
      lastEnd = Math.max(lastEnd, end);
    }
    let previous: Node | null = null;
    for (const predecessor of predecessors) {
      const node = nodes.get(predecessor);
      if (!node || node.clock !== interval.clock || node.settledMs > assemblyStartedMs) return null;
      if (!previous || node.settledMs > previous.settledMs) previous = node;
    }
    const gapBeforeAssemblyMs = previous ? assemblyStartedMs - previous.settledMs : null;
    const observedReadyWaitMs = previous ? observedReadyWait(phases, previous.settledMs, assemblyStartedMs) : null;
    const node: Node = { attemptId: id, taskId, clock: interval.clock, assemblyStartedMs, settledMs: interval.end,
      gapBeforeAssemblyMs, observedReadyWaitMs,
      unattributedGapMs: gapBeforeAssemblyMs === null ? null : gapBeforeAssemblyMs - (observedReadyWaitMs ?? 0),
      unattributedMs: Math.max(0, interval.end - assemblyStartedMs - elapsedPhases), phases, previous };
    nodes.set(id, node);
    if (!tail || node.settledMs >= tail.settledMs) tail = node;
  }
  if (!tail) return null;
  const chain: Node[] = [];
  for (let node: Node | null = tail; node; node = node.previous) chain.push(node);
  chain.reverse();
  const root = chain[0];
  const admittedMs = admission?.monotonicMs;
  let entry = null;
  if (admission?.clock === root.clock && admittedMs != null && admittedMs <= root.assemblyStartedMs) {
    const elapsedMs = root.assemblyStartedMs - admittedMs;
    const observedReadyWaitMs = observedReadyWait(root.phases, admittedMs, root.assemblyStartedMs);
    entry = { taskId: root.taskId, attemptId: root.attemptId, admissionEventSeq: admission.eventSeq,
      admittedMs, assemblyStartedMs: root.assemblyStartedMs, elapsedMs, observedReadyWaitMs,
      unattributedGapMs: elapsedMs - (observedReadyWaitMs ?? 0) };
  }
  const phaseMs: PhaseDurations = {};
  type SegmentKind = typeof attemptPhases[number] | 'observed-ready-wait';
  type Segment = { kind: SegmentKind; attemptId: string; taskId: string;
    startedMs: number; endedMs: number; durationMs: number };
  let largestMeasuredSegment: Segment | null = null;
  const considerSegment = ({ attemptId, taskId }: Node, kind: SegmentKind, startedMs: number, endedMs: number): Segment => {
    const durationMs = endedMs - startedMs;
    return largestMeasuredSegment && largestMeasuredSegment.durationMs >= durationMs ? largestMeasuredSegment :
      { kind, attemptId, taskId, startedMs, endedMs, durationMs };
  };
  for (const node of chain) {
    const ready = node.phases.readyQueue;
    const readyWait = node === root ? entry?.observedReadyWaitMs ?? null : node.observedReadyWaitMs;
    if (ready && readyWait !== null)
      largestMeasuredSegment = considerSegment(node, 'observed-ready-wait', ready.firstObservedMs, node.assemblyStartedMs);
    for (const phase of attemptPhases) {
      const bounds = node.phases[phase];
      if (!bounds) continue;
      const [startedMs, endedMs] = bounds;
      phaseMs[phase] = (phaseMs[phase] ?? 0) + (endedMs - startedMs);
      largestMeasuredSegment = considerSegment(node, phase, startedMs, endedMs);
    }
  }
  const observed = chain.flatMap(node => node.observedReadyWaitMs === null ? [] : [node.observedReadyWaitMs]);
  return { clock: tail.clock, elapsedMs: tail.settledMs - root.assemblyStartedMs, entry, phaseMs, largestMeasuredSegment,
    betweenAttemptsMs: chain.reduce((sum, node) => sum + (node.gapBeforeAssemblyMs ?? 0), 0),
    observedReadyBetweenAttemptsMs: observed.length ? observed.reduce((sum, duration) => sum + duration, 0) : null,
    unattributedBetweenAttemptsMs: chain.reduce((sum, node) => sum + (node.unattributedGapMs ?? 0), 0),
    readyQueueCoverage: { observedEdges: observed.length, totalEdges: chain.length - 1 },
    unattributedWithinAttemptsMs: chain.reduce((sum, node) => sum + node.unattributedMs, 0),
    attempts: chain.map(({ attemptId, taskId, assemblyStartedMs, settledMs, gapBeforeAssemblyMs, observedReadyWaitMs, unattributedGapMs }) =>
      ({ attemptId, taskId, assemblyStartedMs, settledMs, gapBeforeAssemblyMs, observedReadyWaitMs, unattributedGapMs })) };
}

/** Read model of already-authorized mission receipts. No independent journal or content retention. */
export function projectMissionExecution(mission: MissionProjection, reportPublication: ReportPublication | null = null,
  userDelivery: ReportDelivery | null = null) {
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
    const phases = attempt.timing?.phases;
    const readyQueueMs = phases?.readyQueue ? phases.contextAssembly[0] - phases.readyQueue.firstObservedMs : NaN;
    return {
      id, taskId: task.id, planRevision: event.timing?.planRevision ?? attempt.context?.binding.revision ?? null, start, end, predecessors,
      executor: attempt.executor, state: attempt.outcome ?? 'running', interrupted: matched?.kind === 'recovered',
      agentProfileId: task.teamMember?.profileId ?? task.specialist?.profile?.id ?? null,
      providerSelection: task.specialist ? {
        provider: task.specialist.provider, model: task.specialist.model, effort: task.specialist.effort ?? null,
      } : null,
      interval: measured, contextPreparationMs: attempt.timing?.contextPreparationMs ?? null,
      phases: phases ? structuredClone(phases) : null,
      readyQueueMs: Number.isFinite(readyQueueMs) && readyQueueMs >= 0 ? readyQueueMs : null,
      executionMs: attempt.timing?.executionMs ?? null, verificationMs: attempt.timing?.verificationMs ?? null,
      queueWallClockMs: attempt.timing?.queueMs ?? null,
      resourceAdmission: projectResourceAdmission(attempt.admission),
      providerCalls: attempt.telemetry?.providerCalls ?? null,
      providerEvidence: attempt.telemetry?.providerEvidence ?? null,
      providerExecutionId: attempt.telemetry?.providerExecutionId ?? null,
      providerAdapterMs: attempt.telemetry?.providerCalls ? attempt.telemetry.durationMs : null,
      providerStream: attempt.telemetry?.providerStream ? structuredClone(attempt.telemetry.providerStream) : null,
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
  const verifiedAttempts = attempts.filter(attempt => attempt.verifiedEvidenceIds.length && attempt.end)
    .sort((a, b) => a.end!.eventSeq - b.end!.eventSeq);
  const firstVerified = verifiedAttempts[0]?.end ?? null;
  const currentVerifiedIds = new Set(mission.tasks.flatMap(task =>
    task.state === 'verified' && task.attempts.length ? [task.attempts.at(-1)!.id] : []));
  const verifiedMilestones = verifiedAttempts.flatMap(({ id, taskId, planRevision, end, interrupted, verifiedEvidenceIds }) => {
    const source = byAttempt.get(id)?.attempt;
    if (!currentVerifiedIds.has(id) || interrupted || !end || !source?.verification || !source.evidence ||
      !verifiedEvidenceIds.includes(source.evidence.id)) return [];
    const elapsed = intake && initial ? interval(id, { ...initial, monotonicMs: intake.monotonicMs }, end) : null;
    return [{ taskId, attemptId: id, planRevision, criterion: source.verification.criterion,
      evidenceIds: verifiedEvidenceIds, settlement: end, intakeToSettlementMs: elapsed ? elapsed.end - elapsed.start : null }];
  });
  const lastSettlement = attempts.flatMap(attempt => attempt.interval && attempt.end ? [attempt.end] : [])
    .sort((a, b) => b.eventSeq - a.eventSeq)[0] ?? null;
  const plan = mission.planning;
  const planningClock = plan?.timing?.lifecycleClock;
  const planningLifecycle = planningClock && intake && initial?.monotonicMs != null && planningClock.domain === intake.clock &&
    planningClock.commandStartedMs <= planningClock.validatedMs && planningClock.validatedMs <= intake.monotonicMs &&
    intake.monotonicMs <= initial.monotonicMs ? {
      validatedToStartCommandMs: intake.monotonicMs - planningClock.validatedMs,
      planningCommandToAdmissionMs: initial.monotonicMs - planningClock.commandStartedMs,
    } : null;
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
  const intakeToReportStagedMs = timeToReportStaging(reportPublication?.timing, intake);
  const attemptsByReason: Partial<Record<MissionAdmissionReason, number>> = {};
  let admittedAttemptsWithSample = 0, admittedAttemptsWithReasons = 0;
  for (const { attempt } of byAttempt.values()) {
    if (!attempt.admission) continue;
    admittedAttemptsWithSample++;
    if (attempt.admission.reasons.length) admittedAttemptsWithReasons++;
    for (const reason of new Set(attempt.admission.reasons)) attemptsByReason[reason] = (attemptsByReason[reason] ?? 0) + 1;
  }
  return {
    contract: 'aerynth.mission-execution-profile@1' as const,
    kind: 'execution-profile' as const, missionId: mission.id, revision: mission.revision, outcome: mission.outcome,
    admission: initial, firstVerifiedTask: firstVerified, lastSettlement, reportPublication,
    verifiedTaskMilestones: { first: verifiedMilestones[0] ?? null, last: verifiedMilestones.at(-1) ?? null },
    resourcePolicy: { currentAdmission: projectResourceAdmission(mission.admission), admittedAttemptsWithSample,
      admittedAttemptsWithoutSample: byAttempt.size - admittedAttemptsWithSample, admittedAttemptsWithReasons, attemptsByReason },
    settlementToReportStagedMs: complete ? timeToReportStaging(reportPublication?.timing, lastSettlement) : null,
    intakeToReportStagedMs,
    requestIntake: intake, firstMeaningfulOutput: null, userDelivery,
    intakeToUserDeliveryMs: intakeToReportStagedMs !== null && userDelivery?.stagingToReceiptMs != null ?
      intakeToReportStagedMs + userDelivery.stagingToReceiptMs : null,
    intakeToAdmissionMs: intake && initial?.monotonicMs != null ? initial.monotonicMs - intake.monotonicMs : null,
    admissionToFirstVerifiedTaskMs: timeToVerified ? timeToVerified.end - timeToVerified.start : null,
    admissionToLastSettlementMs: timeToSettlement ? timeToSettlement.end - timeToSettlement.start : null,
    planning: plan ? { durationMs: plan.durationMs, provider: plan.provider, model: plan.model,
      executionId: plan.executionId ?? null, timing: plan.timing ? structuredClone(plan.timing) : null,
      lifecycle: planningLifecycle, providerEvidence: plan.providerEvidence ?? null, usage: planningUsage } : null,
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
      dependencyReadinessPath: complete && !active ? dependencyReadinessPath(attempts, initial) : null,
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
