import type { ExperienceEvidencePort } from './experience-evidence-view.ts';
import type { MissionProjection, MissionScope, MissionSummary } from '../../../integrated-backend/src/mission-contracts.mts';
import type { MissionExecutionProfile } from '../../../integrated-backend/src/execution-profiler.mts';
import { mountIntelligenceInspection } from './adaptive-workspace-view.ts';
import type { ResourcePolicyPort } from './resource-policy-view.ts';
import { missionStateLabel } from './vela-missions.ts';

type Options = {
  viewId: string;
  scope: MissionScope;
  initialMissionId?: string;
  list(): Promise<MissionSummary[]>;
  readMission(id: string): Promise<MissionProjection | null>;
  readProfile?(id: string): Promise<MissionExecutionProfile | null>;
  resourcePolicy?: ResourcePolicyPort;
  experience?: ExperienceEvidencePort;
};

export function mountAdaptiveWorkspace(root: HTMLElement, options: Options) {
  const doc = root.ownerDocument;
  const label = doc.createElement('label');
  label.textContent = 'Mission';
  const picker = doc.createElement('select');
  picker.setAttribute('aria-label', 'Mission');
  label.append(picker);
  const status = doc.createElement('p');
  status.setAttribute('role', 'status');
  status.tabIndex = -1;
  root.classList.add('aw-adaptive-workspace');
  root.append(label, status);
  const inspection = mountIntelligenceInspection(root, options.viewId, options.readProfile, options.resourcePolicy, true, options.experience);
  let selected = options.initialMissionId ?? '';
  let available = new Map<string, MissionSummary>();
  let epoch = 0, disposed = false, pending: Promise<void> | undefined, queued = false;
  function resetChoices() {
    available.clear();
    picker.replaceChildren();
    picker.disabled = true;
  }
  async function select() {
    const token = ++epoch, id = selected;
    const summary = available.get(id);
    inspection.invalidate('Checking authorized mission evidence…');
    if (!summary) {
      status.textContent = available.size ? 'Choose a mission to inspect.' : 'No missions are available in this workspace.';
      return;
    }
    status.textContent = 'Reading mission evidence…';
    try {
      const mission = await options.readMission(id);
      if (disposed || token !== epoch) return;
      if (!mission || mission.id !== id || mission.revision < summary.revision ||
          mission.scope.workspaceId !== options.scope.workspaceId || mission.scope.projectId !== options.scope.projectId)
        throw Error('mission_projection_unavailable');
      inspection.update(mission, { ...options.scope, missionId: id });
      status.textContent = mission.objective + ' · ' + missionStateLabel[mission.outcome];
    } catch {
      if (token === epoch) status.textContent = 'Mission evidence unavailable.';
    }
  }
  picker.onchange = () => { selected = picker.value; void select(); };
  function refresh(accessChanged = false) {
    if (disposed) return;
    if (!accessChanged) inspection.refreshExperience();
    if (accessChanged) {
      epoch++;
      resetChoices();
      inspection.invalidate('Checking workspace access…', true);
      status.textContent = 'Checking workspace access…';
    }
    queued = true;
    pending ??= (async () => {
      while (queued && !disposed) {
        queued = false;
        const token = epoch;
        try {
          const summaries = await options.list();
          if (disposed || token !== epoch) continue;
          available = new Map(summaries.map(summary => [summary.id, summary]));
          if (!available.has(selected)) selected = '';
          const blank = doc.createElement('option');
          blank.value = '';
          blank.textContent = 'Choose a mission';
          picker.replaceChildren(blank);
          for (const summary of available.values()) {
            const option = doc.createElement('option');
            option.value = summary.id;
            option.textContent = summary.objective + ' · ' + missionStateLabel[summary.outcome];
            picker.append(option);
          }
          picker.value = selected;
          picker.disabled = !available.size;
          await select();
        } catch {
          if (disposed || token !== epoch) continue;
          resetChoices();
          inspection.invalidate('Mission evidence unavailable.', true);
          status.textContent = 'Mission evidence unavailable.';
        }
      }
    })().finally(() => { pending = undefined; if (queued && !disposed) refresh(); });
  }
  refresh(true);
  return {
    focus: status,
    refresh,
    dispose() {
      disposed = true;
      epoch++;
      resetChoices();
      inspection.dispose();
      root.replaceChildren();
    },
  };
}
