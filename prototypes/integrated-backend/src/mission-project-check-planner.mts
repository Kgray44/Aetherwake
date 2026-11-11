import { parentPort, Worker, workerData } from 'node:worker_threads';
import { planVelaProjectCheck } from './vela-project-check.mts';

type ProjectCheckPlan = ReturnType<typeof planVelaProjectCheck>;
const protocol = 'aerynth.mission.project-check-planner@1';

/** Runs the existing bounded planner under the caller's build lease. */
export function planMissionProjectCheck(paths: string[], privateRoot?: string): Promise<ProjectCheckPlan> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { protocol, paths, privateRoot }, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 32 },
    });
    let plan: ProjectCheckPlan | null | undefined;
    worker.once('message', (value: ProjectCheckPlan | null) => { plan = value; });
    worker.on('error', () => { plan = null; });
    // The caller holds its reservation until the worker and its bounded Git calls have ended.
    worker.once('exit', code => {
      if (code === 0 && plan) resolve(plan);
      else reject(Error('mission_project_check_planning_failed'));
    });
  });
}

if (parentPort && workerData?.protocol === protocol) {
  try { parentPort.postMessage(planVelaProjectCheck(undefined, 'node-test', workerData.paths, workerData.privateRoot)); }
  catch { parentPort.postMessage(null); }
}
