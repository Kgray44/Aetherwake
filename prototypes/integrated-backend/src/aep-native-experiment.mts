import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { ensure } from './contracts.mts';
import { AEP_EXPERIMENT_CONTRACT, AEP_FINDING_CONTRACT, readAepExperiment, readAepFinding,
  type AepExperimentRecord } from './aep-experience-contract.mts';
import { summarizePairedTrials } from './aep-controlled-trials.mts';
import { assessNativeTrial, minimumEffectMs, nativeTrialProtocol, pairsPerPartition,
  type TrialPartition } from './aep-native-trial.mts';
import type { MissionProjection, MissionScope } from './mission-contracts.mts';
import type { MissionExperiencePolicy } from './mission-experience-policy.mts';

export type NativeCandidate = 'parallel' | 'omit-backend';
type Arm = 'baseline' | 'candidate';
type TrialReference = { missionId: string; revision: number; partition: TrialPartition; pair: number; arm: Arm };
type Assessment = ReturnType<typeof assessNativeTrial>;
type AssessmentSummary = { trial: TrialReference; gates: Assessment['gates']; overhead: Overhead | null };
type Overhead = { projectionMs: number; processCpuMs: number; rssDeltaBytes: number };
type Decision = 'accepted' | 'rejected' | 'inconclusive';
type State = 'proposed' | 'tested' | Decision | 'promoted' | 'monitored' | 'superseded' | 'rolled-back';

const candidates = {
  parallel: { hypothesis: 'Overlap independent native probes while preserving the joined result.', workers: 2 },
  'omit-backend': { hypothesis: 'A shorter report may settle faster if it skips the backend probe.', workers: 2 },
};
const partitions = ['development', 'holdout'] as const;
const totalTrials = pairsPerPartition * partitions.length * 2;
const referenceId = (trial: TrialReference) => 'native-probe:' + trial.missionId;
const terminal = new Set(['verified', 'failed', 'blocked', 'cancelled', 'uncertain']);

function expectedTrial(index: number) {
  const partition = partitions[Math.floor(index / (pairsPerPartition * 2))];
  const pair = Math.floor(index / 2) % pairsPerPartition;
  const arm: Arm = index % 2 === pair % 2 ? 'baseline' : 'candidate';
  return { partition, pair, arm };
}

export function nativeTrialRequestId(experimentId: string, index: number) {
  return 'fi5:' + experimentId + ':' + index;
}

function resultFor(trials: { trial: TrialReference; assessment: Assessment }[]) {
  const passes = ({ assessment }: (typeof trials)[number]) => Object.values(assessment.gates).every(Boolean);
  const baselinePassed = trials.filter(({ trial }) => trial.arm === 'baseline').every(passes);
  const candidatePassed = trials.filter(({ trial }) => trial.arm === 'candidate').every(passes);
  const gatesPassed = baselinePassed && candidatePassed;
  const summary = (partition: TrialPartition) => {
    const rows = trials.filter(row => row.trial.partition === partition);
    return summarizePairedTrials(Array.from({ length: pairsPerPartition }, (_, pair) => {
      const baseline = rows.find(row => row.trial.pair === pair && row.trial.arm === 'baseline')?.assessment.metrics.elapsedMs;
      const candidate = rows.find(row => row.trial.pair === pair && row.trial.arm === 'candidate')?.assessment.metrics.elapsedMs;
      return baseline == null || candidate == null ? null : baseline - candidate;
    }));
  };
  const development = summary('development'), holdout = summary('holdout');
  const controlled = trials.every(({ trial, assessment }) => assessment.metrics.peakWorkers === (trial.arm === 'baseline' ? 1 : 2) &&
    Object.keys(assessment.metrics.resourcePolicy.attemptsByReason).length === 0);
  const qualified = controlled &&
    [development, holdout].every(row => row.interval !== null && row.interval.lower >= minimumEffectMs);
  const decision: Decision = !baselinePassed ? 'inconclusive' : !candidatePassed ? 'rejected' : qualified ? 'accepted' : 'inconclusive';
  return { decision, development, holdout, minimumEffectMs, gatesPassed, baselinePassed, candidatePassed, controlled,
    endpoint: 'admission-to-last-settlement-ms' as const,
    limits: ['same-host successive trials', 'two frozen native objective variants',
      'pair independence assumed; same-process autocorrelation not ruled out', 'local-only; billing and provider latency not applicable'] };
}

export interface NativeExperiment {
  contract: 'aerynth.aep.native-experiment@1';
  experiment: AepExperimentRecord;
  candidate: NativeCandidate;
  hypothesis: string;
  environment: TrialEnvironment | null;
  policyReceipts: { state: State; policy: MissionExperiencePolicy; monitorMissionId?: string }[];
  state: State;
  history: { state: State; revision: number; at: string }[];
  trials: AssessmentSummary[];
  result: ReturnType<typeof resultFor> | null;
}

export type TrialEnvironment = { hostCohort: string; governorVersion: number };

function transition(record: NativeExperiment, state: State) {
  record.state = state;
  record.history.push({ state, revision: record.experiment.revision, at: new Date().toISOString() });
}

/** AEP owns hypotheses, enrollment and conclusions. Live mission proof is resolved by the canonical MissionService host. */
export class NativeExperimentLedger {
  private readonly db: DatabaseSync;
  private readonly authorized: (scope: MissionScope) => boolean;
  private readonly resolve?: (id: string, scope: MissionScope) => MissionProjection;

  constructor(db: DatabaseSync, authorized: (scope: MissionScope) => boolean,
    resolve?: (id: string, scope: MissionScope) => MissionProjection) {
    this.db = db;
    this.authorized = authorized;
    this.resolve = resolve;
    db.exec(`CREATE TABLE IF NOT EXISTS aep_native_experiments (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT, revision INTEGER NOT NULL,
      json TEXT NOT NULL CHECK(length(json)<=65536)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS aep_native_experiments_scope ON aep_native_experiments(workspace_id,project_id);`);
  }

  propose(scope: MissionScope, candidate: NativeCandidate, environment: TrialEnvironment | null = null): NativeExperiment {
    ensure(this.authorized(scope), 'aep_scope_denied');
    ensure(Object.hasOwn(candidates, candidate), 'aep_candidate_unsupported');
    const id = randomUUID();
    const experiment = readAepExperiment({
      contract: AEP_EXPERIMENT_CONTRACT, id, revision: 1, scope, owner: 'mission',
      hypothesisRef: id, baselinePolicyRef: 'native-probe-serial@1', candidatePolicyRef: candidate + '@1',
      cohortRef: nativeTrialProtocol, holdoutRef: 'native-probe-cpu-ram-backend@1', methodology: 'paired',
      metricRefs: ['admission-to-last-settlement-ms', 'critical-path-ms', 'resource-coverage'],
      guardrailRefs: ['native-probe-objective-oracle@1'], state: 'planned', conclusion: 'pending',
      qualityGate: 'unknown', baselineTraceRefs: [], candidateTraceRefs: [], evaluationRefs: [],
    });
    const record: NativeExperiment = { contract: 'aerynth.aep.native-experiment@1', experiment, candidate,
      hypothesis: candidates[candidate].hypothesis, environment, policyReceipts: [], state: 'proposed', history: [], trials: [], result: null };
    transition(record, 'proposed');
    const inserted = this.db.prepare(`INSERT INTO aep_native_experiments
      SELECT ?,?,?,?,? WHERE (SELECT count(*) FROM aep_native_experiments) < 64`)
      .run(id, scope.workspaceId, scope.projectId, 1, JSON.stringify(record));
    ensure(inserted.changes === 1, 'aep_experiment_store_full');
    return record;
  }

  list(scope: MissionScope) {
    ensure(this.authorized(scope), 'aep_scope_denied');
    return this.db.prepare('SELECT id,json FROM aep_native_experiments WHERE workspace_id=? AND project_id IS ? ORDER BY rowid DESC')
      .all(scope.workspaceId, scope.projectId).map(row => {
        const record = JSON.parse(String(row.json)) as NativeExperiment;
        return { id: String(row.id), revision: record.experiment.revision, state: record.state, candidate: record.candidate,
          cohort: record.experiment.cohortRef };
      });
  }

  read(scope: MissionScope, id: string): NativeExperiment {
    ensure(this.authorized(scope), 'aep_scope_denied');
    ensure(typeof id === 'string' && /^[a-f0-9-]{36}$/u.test(id), 'aep_experiment_unavailable');
    const row = this.db.prepare('SELECT json FROM aep_native_experiments WHERE id=? AND workspace_id=? AND project_id IS ?')
      .get(id, scope.workspaceId, scope.projectId);
    ensure(row, 'aep_experiment_unavailable');
    const record = JSON.parse(String(row.json)) as NativeExperiment;
    ensure(record.contract === 'aerynth.aep.native-experiment@1', 'aep_experiment_version');
    readAepExperiment(record.experiment);
    return record;
  }

  private save(record: NativeExperiment, expected: number) {
    readAepExperiment(record.experiment);
    const written = this.db.prepare('UPDATE aep_native_experiments SET revision=?,json=? WHERE id=? AND revision=?')
      .run(record.experiment.revision, JSON.stringify(record), record.experiment.id, expected);
    ensure(written.changes === 1, 'aep_experiment_revision_changed');
    return record;
  }

  private resolveTrial(scope: MissionScope, experimentId: string, index: number, missionId: string, revision?: number) {
    ensure(this.resolve, 'aep_trial_source_unavailable');
    const mission = this.resolve(missionId, scope);
    ensure(mission.scope.workspaceId === scope.workspaceId && mission.scope.projectId === scope.projectId &&
      mission.requestId === nativeTrialRequestId(experimentId, index) && terminal.has(mission.outcome) &&
      (revision === undefined || revision === mission.revision), 'aep_trial_source_changed');
    return mission;
  }

  /** Enrollment order, sample size and arms are frozen before the first mission. No arbitrary trace imports. */
  recordTrial(scope: MissionScope, id: string, expected: number, missionId: string) {
    const record = this.read(scope, id);
    const index = record.trials.length;
    ensure(record.experiment.revision === expected && record.state === 'proposed' && index < totalTrials,
      'aep_experiment_revision_changed');
    const { partition, pair, arm } = expectedTrial(index);
    const mission = this.resolveTrial(scope, id, index, missionId);
    ensure(mission.concurrency === (arm === 'baseline' ? 1 : candidates[record.candidate].workers) &&
      mission.events.every(event => event.kind !== 'control' && event.kind !== 'recovered'), 'aep_trial_protocol_changed');
    const trial = { partition, pair, arm, missionId, revision: mission.revision };
    const cpuStart = process.cpuUsage(), rssBefore = process.memoryUsage.rss(), started = performance.now();
    const assessment = assessNativeTrial(mission, partition);
    const cpu = process.cpuUsage(cpuStart);
    const overhead = { projectionMs: performance.now() - started, processCpuMs: (cpu.user + cpu.system) / 1000,
      rssDeltaBytes: process.memoryUsage.rss() - rssBefore };
    record.trials.push({ trial, gates: assessment.gates, overhead });
    record.experiment.revision++;
    record.experiment.state = 'running';
    (arm === 'baseline' ? record.experiment.baselineTraceRefs : record.experiment.candidateTraceRefs).push(missionId);
    if (index + 1 === totalTrials) transition(record, 'tested');
    return this.save(record, expected);
  }

  /** Resolve sources live, so stale or revoked evidence never becomes a current learning projection. */
  evidence(scope: MissionScope, id: string) {
    const record = this.read(scope, id);
    const trials = record.trials.map(({ trial, overhead }, index) => ({
      trial, overhead, assessment: assessNativeTrial(this.resolveTrial(scope, id, index, trial.missionId, trial.revision), trial.partition),
    }));
    return { kind: 'aep-experiment-evidence' as const, record, trials };
  }

  evaluate(scope: MissionScope, id: string, expected: number) {
    const { record, trials } = this.evidence(scope, id);
    ensure(record.experiment.revision === expected && record.state === 'tested', 'aep_experiment_revision_changed');
    const result = resultFor(trials);
    record.result = result;
    record.experiment.revision++;
    record.experiment.state = 'evaluated';
    record.experiment.qualityGate = !result.baselinePassed ? 'unknown' : result.candidatePassed ? 'pass' : 'fail';
    record.experiment.conclusion = result.decision === 'accepted' ? 'benefit' :
      result.decision === 'rejected' ? 'harm' : 'inconclusive';
    record.experiment.evaluationRefs = record.trials.map(({ trial }) => referenceId(trial));
    transition(record, result.decision);
    return this.save(record, expected);
  }

  recordPolicy(scope: MissionScope, id: string, state: 'promoted' | 'monitored' | 'superseded' | 'rolled-back',
    policy: MissionExperiencePolicy, monitorMissionId?: string) {
    const record = this.read(scope, id);
    const allowed = state === 'promoted' ? record.state === 'accepted' :
      state === 'monitored' ? record.state === 'promoted' || record.state === 'monitored' :
        record.state === 'promoted' || record.state === 'monitored';
    ensure(allowed && record.policyReceipts.length < 16, 'aep_policy_transition_unavailable');
    if (state === 'monitored' && record.policyReceipts.length >= 14) return record;
    const expected = record.experiment.revision++;
    record.policyReceipts.push({ state, policy, ...(monitorMissionId ? { monitorMissionId } : {}) });
    transition(record, state);
    return this.save(record, expected);
  }

  /** Advisory, exact-scope projection. Source bodies stay with MissionService. */
  finding(scope: MissionScope, id: string, cohort: string, environment: TrialEnvironment | null = null) {
    if (cohort !== nativeTrialProtocol) return null;
    const record = this.read(scope, id);
    if (!record.result || record.environment && (record.environment.hostCohort !== environment?.hostCohort ||
      record.environment.governorVersion !== environment.governorVersion)) return null;
    record.trials.forEach(({ trial }, index) => {
      this.resolveTrial(scope, id, index, trial.missionId, trial.revision);
    });
    const { experiment, result } = record;
    return { ...readAepFinding({
      contract: AEP_FINDING_CONTRACT, id: 'finding:' + experiment.id, revision: experiment.revision,
      scope, experimentId: experiment.id, experimentRevision: experiment.revision,
      disposition: result.decision === 'accepted' && !['superseded', 'rolled-back'].includes(record.state) ? 'recommend-candidate' :
        result.decision === 'rejected' || result.decision === 'accepted' ? 'retain-baseline' : 'insufficient-evidence',
    }, experiment), cohort, result, lifecycle: record.state, policyAuthority: 'advisory' as const };
  }
}

export { expectedTrial as nativeTrialAssignment, totalTrials as nativeTrialCount };
