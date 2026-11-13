import { setTimeout as delay } from 'node:timers/promises';
import { ensure } from './contracts.mts';
import { nativeTrialAssignment, nativeTrialCount, nativeTrialRequestId, type NativeExperimentLedger } from './aep-native-experiment.mts';
import { nativeTrialPlan } from './aep-native-trial.mts';
import type { MissionScope } from './mission-contracts.mts';
import type { MissionService } from './mission-service.mts';

export async function runNativeExperiment(missions: MissionService, ledger: NativeExperimentLedger, scope: MissionScope,
  id: string, checkAdmission: () => void) {
  let record = ledger.read(scope, id);
  if (record.result) return record;
  for (let index = record.trials.length; index < nativeTrialCount; index++) {
    checkAdmission();
    const { partition, arm } = nativeTrialAssignment(index);
    const plan = nativeTrialPlan(scope, partition);
    const concurrency = arm === 'baseline' ? 1 : 2;
    if (arm === 'candidate' && record.candidate === 'omit-backend') {
      plan.tasks = plan.tasks.filter(task => task.id !== 'backend');
      plan.criteria = plan.criteria.filter(criterion => criterion !== 'backend');
      const report = plan.tasks.at(-1)!;
      report.dependencies = report.dependencies.filter(id => id !== 'backend');
      // The negative control still runs real probes. It cannot pretend the reduced report was verified.
      if (report.dependencies.length < 2) {
        plan.tasks.pop();
        plan.criteria.pop();
      }
    }
    let mission = missions.create(nativeTrialRequestId(id, index), plan, undefined, undefined, concurrency);
    const deadline = performance.now() + 10_000;
    while (mission.outcome === 'queued' || mission.outcome === 'running') {
      await delay(10);
      mission = missions.read(mission.id, scope);
      if (performance.now() >= deadline && ['queued', 'running'].includes(mission.outcome)) {
        missions.control(mission.id, scope, mission.revision, { type: 'cancel' });
        throw Error('aep_trial_deadline');
      }
    }
    checkAdmission();
    ensure(mission.outcome !== 'paused' && mission.outcome !== 'cancelling', 'aep_trial_interrupted');
    record = ledger.recordTrial(scope, id, record.experiment.revision, mission.id);
  }
  checkAdmission();
  return ledger.evaluate(scope, id, record.experiment.revision);
}
