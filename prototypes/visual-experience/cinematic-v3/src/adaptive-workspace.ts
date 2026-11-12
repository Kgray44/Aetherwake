import type { MissionExecutionProfile } from '../../../integrated-backend/src/execution-profiler.mts';
import type { MissionProjection, MissionScope } from '../../../integrated-backend/src/mission-contracts.mts';

/** FI-6 read-only inspection seam. No executor, policy writer, event bus or renderer state. */
export const intelligenceZones = [
  ['decision', 'Decision Observatory'], ['resource', 'Resource Intelligence'],
  ['profiler', 'Execution Profiler'], ['learning', 'Learning Observatory'],
  ['experiment', 'Experiment Laboratory'], ['timeline', 'Adaptation Timeline'],
] as const;
export type IntelligenceZone = typeof intelligenceZones[number][0];
export type IntelligenceBinding = MissionScope & { missionId: string };
export interface IntelligenceReading {
  sourceId: string;
  field: string;
  value: string | number | null;
  classification: 'actual' | 'derived' | 'reported' | 'simulated' | 'missing';
  observedAt: string | null;
  unit: string | null;
}
export interface IntelligenceRegion {
  id: IntelligenceZone;
  label: string;
  readings: IntelligenceReading[];
  limitation: string;
}
const matches = (m: MissionProjection, b: IntelligenceBinding) => m.id === b.missionId &&
  m.scope.workspaceId === b.workspaceId && m.scope.projectId === b.projectId;
const finite = (n: number | null | undefined) => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;

/** Input must already be authorized by the source owner. Scope checks are defense in depth. */
export function projectIntelligence(mission: MissionProjection, binding: IntelligenceBinding, profile?: MissionExecutionProfile | null): IntelligenceRegion[] | null {
  if (mission.contract !== 'aerynth.vela-mission@1' || !matches(mission, binding)) return null;
  const regions: IntelligenceRegion[] = intelligenceZones.map(([id, label]) => ({ id, label, readings: [], limitation: '' }));
  const region = (id: IntelligenceZone) => regions.find(r => r.id === id)!;
  const add = (zone: IntelligenceZone, sourceId: string, field: string, value: IntelligenceReading['value'],
    classification: IntelligenceReading['classification'], observedAt: string | null = null, unit: string | null = null) => {
    region(zone).readings.push({ sourceId, field, value, classification: value === null ? 'missing' : classification, observedAt, unit });
  };
  const plan = mission.planning;
  if (plan) {
    add('decision', plan.responseId, 'model', plan.model, plan.providerEvidence === 'simulated' ? 'simulated' : 'reported', plan.startedAt);
    add('decision', mission.id, 'planRevision', mission.planRevision, 'actual');
  }
  region('decision').limitation = 'Recorded planner selection only; rationale, alternatives and validator details are unavailable here. No private reasoning.';
  const admission = mission.admission;
  if (admission) {
    add('resource', mission.id, 'admittedWorkerLimit', finite(admission.workerLimit), 'actual', null, 'workers');
    const units = { cpuPercent: '%', availableMemoryBytes: 'bytes', windowsLowMemory: 'flag',
      windowsCommitHeadroomBytes: 'bytes', gpuEnginePercent: '%', diskQueueLength: 'queue length', rendererFrameP95Ms: 'ms' };
    for (const key of Object.keys(units) as (keyof typeof units)[]) {
      const reading = admission.readings[key];
      add('resource', mission.id, `admission.readings.${key}`, finite(reading?.value), 'actual', reading?.observedAt ?? null, units[key]);
    }
  }
  region('resource').limitation = 'Admission snapshot only; not current machine load. Applied policy epoch and unavailable sensors are not inferred.';
  for (const [field, unit, classification] of [
    ['elapsedMs', 'ms', 'actual'], ['peakWorkers', 'workers', 'actual'], ['attempts', 'attempts', 'actual'],
    ['retries', 'retries', 'actual'], ['reportedTotalTokens', 'tokens', 'reported'],
  ] as const) add('profiler', mission.id, `profile.${field}`, finite(mission.profile[field]), classification);
  region('profiler').limitation = 'Existing MissionService summary only; no new critical-path, cost, percentile or quality estimate.';
  if (profile?.contract === 'aerynth.mission-execution-profile@1' &&
    profile.missionId === mission.id && profile.revision === mission.revision) {
    const { work, economics, wallTime, quality } = profile;
    region('profiler').readings = [];
    region('profiler').limitation = 'AEP uses compatible measured clocks. Occupied worker time can include overlap. Billing and cross-run percentiles are unavailable here.';
    for (const [label, duration] of [
      ['Execution wall time', wallTime?.elapsedMs], ['Occupied worker time', work.workerMs],
      ['Active time', work.activeMs], ['Measured overlap', work.overlapMs],
      ['Occupied critical path', work.criticalPath?.durationMs],
      ['Admission to first verified task', profile.admissionToFirstVerifiedTaskMs],
      ['Intake to report receipt', profile.firstMeaningfulOutput?.intakeToReceiptMs],
    ] as const) add('profiler', mission.id, label, finite(duration), 'derived', null, 'ms');
    if (wallTime) add('profiler', mission.id, 'Wall time boundaries', [wallTime.from, wallTime.through].join(' → '), 'actual');
    add('profiler', mission.id, 'Measured attempts', [work.intervalCoverage.measured, work.intervalCoverage.attempts].join(' / '), 'derived');
    add('profiler', mission.id, 'Critical path attempts', work.criticalPath?.attemptIds.join(' → ') ?? null, 'derived');
    add('profiler', mission.id, 'Provider-reported tokens', economics.reportedTotalTokens, 'reported', null, 'tokens');
    if (economics.simulatedTotalTokens != null)
      add('profiler', mission.id, 'Simulated tokens', economics.simulatedTotalTokens, 'simulated', null, 'tokens');
    add('profiler', mission.id, 'Usage coverage', economics.usageCoverage, 'derived');
    add('profiler', mission.id, 'Provider cost', economics.cost, 'reported');
    add('profiler', mission.id, 'Objective verification', quality.objectiveVerified ? 'Verified' : 'Unconfirmed', 'derived');

    region('resource').limitation = 'Admission snapshots and historical lease receipts. Reservations describe admission. Current activity and consumption are unconfirmed. See Performance for current policy and overrides.';
    region('decision').limitation = 'Recorded model requests, executor choices and transport outcomes. Rationale and alternatives are unavailable here.';
    for (const attempt of profile.attempts) {
      const observedAt = attempt.start.utc;
      add('profiler', attempt.id, 'Attempt · ' + attempt.taskId, attempt.state, 'actual', attempt.end?.utc ?? observedAt);
      const span = attempt.interval;
      if (span) add('profiler', attempt.id, 'Measured attempt duration', span.end - span.start, 'derived', observedAt, 'ms');
      add('decision', attempt.id, 'Executor · ' + attempt.taskId, attempt.executor, 'actual', observedAt);
      if (attempt.providerSelection) {
        add('decision', attempt.id, 'Requested model', attempt.providerSelection.model, 'actual', observedAt);
        add('decision', attempt.id, 'Requested provider', attempt.providerSelection.provider, 'actual', observedAt);
      }
      if (attempt.reportedModel) add('decision', attempt.providerExecutionId ?? attempt.id, 'Reported model',
        attempt.reportedModel, attempt.providerEvidence === 'simulated' ? 'simulated' : 'reported', attempt.end?.utc ?? null);
      const lease = attempt.resourceLease;
      if (!lease) continue;
      add('resource', lease.leaseId, 'Lease · ' + attempt.id, lease.kind, 'actual', observedAt);
      add('resource', lease.leaseId, 'Policy epoch', lease.epoch, 'actual', observedAt);
      add('resource', lease.leaseId, 'Policy revision', lease.policyRevision, 'actual', observedAt);
      add('resource', lease.leaseId, 'Configuration version', lease.configVersion, 'actual', observedAt);
      add('resource', lease.leaseId, 'Reserved RAM', lease.reservedRamBytes, 'actual', observedAt, 'bytes');
      add('resource', lease.leaseId, 'Reserved VRAM', lease.reservedVramBytes, 'actual', observedAt, 'bytes');
      add('resource', lease.leaseId, 'Scheduled expiry', lease.expiresAt, 'actual', observedAt);
    }
    for (const run of profile.cognition?.runs ?? []) {
      const classification = run.providerEvidence === 'simulated' ? 'simulated' : 'actual';
      add('decision', run.executionId, 'Cognitive stage', run.attribution.stage, classification);
      add('decision', run.executionId, 'Requested model', run.requestedModel, classification);
      add('decision', run.executionId, 'Transport outcome', run.outcome, classification);
    }
  }
  region('learning').limitation = 'Unavailable: no authorized learning-record projection is bound. Mission success is not learned policy.';
  region('experiment').limitation = 'Unavailable: no authorized experiment projection is bound. No experiment is started by inspection.';
  region('timeline').limitation = 'Retained mission journal only; not policy adaptation history. Missing or retained-away events are not reconstructed.';
  for (const event of mission.events) add('timeline', mission.id, `events.${event.seq}.kind`, event.kind, 'actual', event.time);
  return regions;
}

export interface IntelligenceInspection {
  status: 'unavailable' | 'loading' | 'ready' | 'disconnected';
  regions: IntelligenceRegion[];
  zone: IntelligenceZone;
  taskId: string | null;
  taskAvailable: boolean;
}

/** Host retains its camera/focus/selection anchors; this controller never moves or resets them.
 * Mount in the existing spatial inspection surface, not as a replacement screen.
 * Source access changes MUST call bind (even for the same binding) to invalidate pending reads.
 */
export function createIntelligenceInspection(read: (binding: IntelligenceBinding) => Promise<MissionProjection | null>) {
  let binding: IntelligenceBinding | null = null, epoch = 0, minimumRevision = 0;
  let mission: MissionProjection | null = null;
  let state: IntelligenceInspection = { status: 'unavailable', regions: [], zone: 'decision', taskId: null, taskAvailable: false };
  const clear = (status: IntelligenceInspection['status']) => { mission = null; state = { ...state, status, regions: [], taskAvailable: false }; };
  return {
    snapshot(): IntelligenceInspection { return structuredClone(state); },
    bind(next: IntelligenceBinding | null) {
      const same = binding && next && binding.missionId === next.missionId && binding.workspaceId === next.workspaceId && binding.projectId === next.projectId;
      binding = next ? { ...next } : null; epoch++; minimumRevision = 0;
      if (!same) state = { ...state, taskId: null };
      clear('unavailable');
    },
    selectTask(taskId: string | null) {
      if (taskId !== null && !mission?.tasks.some(t => t.id === taskId)) return false;
      state = { ...state, taskId, taskAvailable: taskId !== null }; return true;
    },
    navigate(zone: IntelligenceZone) {
      if (!intelligenceZones.some(([id]) => id === zone)) return false;
      state = { ...state, zone }; return true;
    },
    /** Keyboard and pointer invoke the same command; reduced motion needs no alternative authority. */
    key(key: string) {
      const i = intelligenceZones.findIndex(([id]) => id === state.zone);
      if (key === 'ArrowRight' || key === 'ArrowLeft') {
        state = { ...state, zone: intelligenceZones[(i + (key === 'ArrowRight' ? 1 : 5)) % 6][0] }; return true;
      }
      if (key === 'Home' || key === 'End') { state = { ...state, zone: intelligenceZones[key === 'Home' ? 0 : 5][0] }; return true; }
      return false;
    },
    async refresh() {
      const request = binding && { ...binding }, token = ++epoch;
      clear(request ? 'loading' : 'unavailable');
      if (!request) return;
      try {
        const next = await read(request);
        if (token !== epoch) return;
        const regions = next && next.revision >= minimumRevision ? projectIntelligence(next, request) : null;
        if (!next || !regions) { clear('unavailable'); return; }
        minimumRevision = next.revision; mission = next;
        state = { ...state, status: 'ready', regions, taskAvailable: !!next.tasks.some(t => t.id === state.taskId) };
      } catch { if (token === epoch) clear('disconnected'); }
    },
  };
}
