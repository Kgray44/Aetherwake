import { createHash, randomUUID } from 'node:crypto';
import { arch, cpus, hostname, platform, release, totalmem } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { retrieveExperientialContext } from '../../vela-core/src/experiential-context.mts';
import { ensure, ServiceError } from './contracts.mts';
import { NativeExperimentLedger, type NativeCandidate, type TrialEnvironment } from './aep-native-experiment.mts';
import { runNativeExperiment } from './aep-native-runner.mts';
import { assessNativeTrial, nativeTrialPlan, nativeTrialProtocol } from './aep-native-trial.mts';
import type { DatabaseSync } from 'node:sqlite';
import type { MissionService } from './mission-service.mts';
import type { MissionScope } from './mission-contracts.mts';

export type AepNativeRequest =
  | { name: 'propose'; candidate: NativeCandidate }
  | { name: 'test' | 'evidence'; id: string }
  | { name: 'promote'; id: string; revision: number; policyVersion: number }
  | { name: 'inspect-policy' | 'start-probe' }
  | { name: 'rollback'; policyVersion: number };

const fields = {
  propose: ['candidate'], test: ['id'], evidence: ['id'], promote: ['id', 'revision', 'policyVersion'],
  'inspect-policy': [], 'start-probe': [], rollback: ['policyVersion'],
} as const;
const validVersion = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;

export function createAepNativeHost(db: DatabaseSync, missions: MissionService, host: {
  atomic<T>(operation: () => T): T;
  authorized(scope: MissionScope): boolean;
  governorVersion(): number;
  admit(scope: MissionScope): void;
}) {
  const hardware = cpus();
  const hostCohort = createHash('sha256').update(JSON.stringify([
    hostname(), platform(), arch(), release(), hardware[0]?.model ?? null, hardware.length, totalmem(), process.version,
  ])).digest('hex');
  const environment = (): TrialEnvironment => ({ hostCohort, governorVersion: host.governorVersion() });
  const ledger = new NativeExperimentLedger(db, host.authorized, (id, scope) => missions.read(id, scope));
  const owner = missions.experiencePolicy;
  let running = false;
  const sameEnvironment = (value: TrialEnvironment | null) => value?.hostCohort === hostCohort &&
    value.governorVersion === host.governorVersion();

  function resolveFinding(scope: MissionScope, id: string, cohort: string) {
    let learned;
    try { learned = ledger.finding(scope, id, cohort, environment()); }
    catch (error) {
      if (error instanceof ServiceError && ['mission_not_found', 'aep_trial_source_changed'].includes(error.code)) return null;
      throw error;
    }
    if (!learned) return null;
    const policy = owner.read(scope);
    const effective = policy.experimentId === id && policy.hostCohort === hostCohort && policy.governorVersion === host.governorVersion() &&
      policy.expiresAtMs !== null && policy.expiresAtMs > Date.now();
    const inactive = ['promoted', 'monitored'].includes(learned.lifecycle) && !effective;
    return { ...learned, ...(inactive ? { disposition: 'retain-baseline' as const } : {}),
      policy: effective ? policy : null, applicability: inactive ? 'revalidation-required' as const : 'matched' as const };
  }


  const source = { cohort: nativeTrialProtocol, resolve: resolveFinding };
  const finding = (scope: MissionScope, id: string, cohort: string) =>
    retrieveExperientialContext({ scope, experimentId: id, cohort }, source);

  async function command(scope: MissionScope, request: AepNativeRequest) {
    ensure(request && typeof request === 'object' && Object.hasOwn(fields, request.name) &&
      Object.keys(request).length === fields[request.name].length + 1 &&
      fields[request.name].every(key => Object.hasOwn(request, key)), 'aep_invalid_native_request');
    ensure(host.authorized(scope), 'aep_scope_denied');
    if (request.name === 'evidence') return ledger.evidence(scope, request.id);
    if (request.name === 'inspect-policy') {
      const policy = owner.read(scope);
      return { ...policy, effective: policy.experimentId !== null && !!finding(scope, policy.experimentId, nativeTrialProtocol)?.policy };
    }
    host.admit(scope);
    switch (request.name) {
      case 'propose': return ledger.propose(scope, request.candidate, environment());
      case 'test': {
        const record = ledger.read(scope, request.id);
        const admit = () => {
          host.admit(scope);
          ensure(sameEnvironment(record.environment), 'aep_trial_environment_changed');
        };
        ensure(!running, 'aep_trial_in_progress');
        running = true;
        try { return await runNativeExperiment(missions, ledger, scope, request.id, admit); }
        finally { running = false; }
      }
      case 'promote': {
        ensure(validVersion(request.revision) && validVersion(request.policyVersion), 'aep_invalid_native_request');
        return host.atomic(() => {
          const { record } = ledger.evidence(scope, request.id);
          ensure(record.experiment.revision === request.revision && record.state === 'accepted' &&
            record.candidate === 'parallel' && sameEnvironment(record.environment), 'aep_promotion_unqualified');
          const previous = owner.read(scope), live = environment();
          const policy = owner.promote(scope, request.policyVersion, request.id, live.hostCohort, live.governorVersion, Date.now());
          if (previous.experimentId) ledger.recordPolicy(scope, previous.experimentId, 'superseded', policy);
          ledger.recordPolicy(scope, request.id, 'promoted', policy);
          return policy;
        });
      }
      case 'rollback':
        ensure(validVersion(request.policyVersion), 'aep_invalid_native_request');
        return host.atomic(() => rollbackInTransaction(scope, request.policyVersion));
      case 'start-probe': {
        ensure(!running, 'aep_trial_in_progress');
        running = true;
        try {
          const policy = owner.read(scope);
          const learning = policy.experimentId ? finding(scope, policy.experimentId, nativeTrialProtocol) : null;
          const active = learning?.policy;
          let mission = missions.create('fi5-probe:' + randomUUID(), nativeTrialPlan(scope, 'holdout'),
            undefined, undefined, active ? 2 : 1);
          const deadline = performance.now() + 10_000;
          while (mission.outcome === 'running' || mission.outcome === 'queued') {
            await delay(10);
            mission = missions.read(mission.id, scope);
            if (performance.now() >= deadline && ['queued', 'running'].includes(mission.outcome)) {
              missions.control(mission.id, scope, mission.revision, { type: 'cancel' });
              throw Error('aep_trial_deadline');
            }
          }
          host.admit(scope);
          const assessment = assessNativeTrial(mission, 'holdout');
          const current = owner.read(scope);
          if (active?.experimentId && active.version === current.version &&
              active.governorVersion === host.governorVersion()) {
            host.atomic(() => {
              ledger.recordPolicy(scope, active.experimentId!, 'monitored', active, mission.id);
              if (Object.values(assessment.gates).includes(false)) rollbackInTransaction(scope, active.version);
            });
          }
          return { kind: 'aep-probe' as const, missionId: mission.id, concurrency: mission.concurrency, assessment,
            appliedPolicy: active ?? null, currentPolicy: owner.read(scope) };
        } finally { running = false; }
      }
    }
  }

  function rollbackInTransaction(scope: MissionScope, version: number) {
    const current = owner.read(scope);
    const reverted = owner.rollback(scope, version);
    ledger.recordPolicy(scope, current.experimentId!, 'rolled-back', reverted);
    return reverted;
  }
  return { command, finding, evidence: (scope: MissionScope, id: string) => ledger.evidence(scope, id),
    list: (scope: MissionScope) => ledger.list(scope) };
}
