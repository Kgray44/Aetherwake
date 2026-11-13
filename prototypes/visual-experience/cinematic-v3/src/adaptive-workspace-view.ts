import type { MissionExecutionProfile } from '../../../integrated-backend/src/execution-profiler.mts';
import { intelligenceZones, projectIntelligence, type IntelligenceBinding, type IntelligenceRegion } from './adaptive-workspace.ts';
import type { MissionProjection } from '../../../integrated-backend/src/mission-contracts.mts';

/** Accessible read-only inspection inside the existing spatial workroom. No camera or task ownership. */
export function mountIntelligenceInspection(root: HTMLElement, viewId: string, readProfile?: (id: string) => Promise<MissionExecutionProfile | null>) {
  const doc = root.ownerDocument, details = doc.createElement('details'), summary = doc.createElement('summary');
  details.className = 'aw-mission-workroom-controls aw-intelligence-inspection';
  details.dataset.noCardDrag = 'true';
  details.hidden = true;
  summary.textContent = 'Inspect intelligence · read only';
  const status = doc.createElement('p'), tabs = doc.createElement('div'), panel = doc.createElement('section');
  status.setAttribute('role', 'status');
  tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Intelligence regions');
  panel.setAttribute('role', 'tabpanel'); panel.tabIndex = 0; panel.id = `${viewId}:intelligence-panel`;
  const heading = doc.createElement('h4'), limitation = doc.createElement('p'), readings = doc.createElement('dl');
  panel.append(heading, limitation, readings); details.append(summary, status, tabs, panel); root.append(details);
  let regions: IntelligenceRegion[] = [], selected = 0, binding: IntelligenceBinding | null = null, disposed = false;
  let profileEpoch = 0, requestProfile: (() => Promise<void>) | undefined;
  const buttons = intelligenceZones.map(([id, label], index) => {
    const button = doc.createElement('button'); button.type = 'button'; button.textContent = label;
    button.dataset.intelligenceZone = id; button.id = `${viewId}:intelligence:${id}`;
    button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', panel.id);
    button.onclick = () => { if (!disposed) { selected = index; render(); } };
    button.onkeydown = event => {
      let next = selected;
      if (event.key === 'ArrowRight') next = (index + 1) % intelligenceZones.length;
      else if (event.key === 'ArrowLeft') next = (index + intelligenceZones.length - 1) % intelligenceZones.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = intelligenceZones.length - 1;
      else return;
      event.preventDefault(); event.stopPropagation(); selected = next; render(); buttons[selected].focus({ preventScroll: true });
    };
    tabs.append(button); return button;
  });
  function render() {
    for (let i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-selected', String(i === selected)); buttons[i].tabIndex = i === selected ? 0 : -1;
    }
    panel.setAttribute('aria-labelledby', buttons[selected].id);
    const region = regions[selected]; heading.textContent = intelligenceZones[selected][1];
    limitation.textContent = region?.limitation ?? 'Unavailable: authorized mission evidence is not currently bound.';
    readings.replaceChildren();
    for (const reading of region?.readings ?? []) {
      const term = doc.createElement('dt'), value = doc.createElement('dd');
      term.textContent = reading.field;
      term.dataset.intelligenceField = reading.field;
      term.dataset.intelligenceSource = reading.sourceId;
      const provenance = doc.createElement('small');
      value.textContent = `${reading.value === null ? 'Unavailable' : reading.value}${reading.unit ? ` ${reading.unit}` : ''}`;
      provenance.textContent = `${reading.classification} · Source ${reading.sourceId} · ${reading.observedAt ?? 'Timestamp unavailable'}`;
      value.append(provenance);
      readings.append(term, value);
    }
  }
  details.onkeydown = event => {
    if (event.key !== 'Escape' || !details.open) return;
    event.preventDefault(); event.stopPropagation(); details.open = false; summary.focus({ preventScroll: true });
  };
  function invalidate(message: string, close = false) {
    profileEpoch++; requestProfile = undefined; regions = []; status.textContent = message;
    if (close) {
      const ownsFocus = details.contains(doc.activeElement);
      details.open = false; binding = null; selected = 0;
      if (ownsFocus && !details.hidden) summary.focus({ preventScroll: true });
    }
    render();
  }
  details.ontoggle = () => { if (details.open) void requestProfile?.(); };
  invalidate('Mission evidence unavailable.');
  return {
    update(mission: MissionProjection, expected: IntelligenceBinding) {
      if (disposed) return;
      const projected = projectIntelligence(mission, expected);
      if (!projected) { invalidate('Mission evidence unavailable.', true); return; }
      const same = binding && binding.missionId === expected.missionId && binding.workspaceId === expected.workspaceId && binding.projectId === expected.projectId;
      if (binding && !same) invalidate('Scope changed.', true);
      binding = { ...expected }; regions = projected;
      details.hidden = false;
      status.textContent = `Recorded mission ${mission.id} · Workspace ${expected.workspaceId} · Project ${expected.projectId ?? 'none'} · Plan v${mission.planRevision} · Journal v${mission.revision}. Snapshot, not live telemetry.`;
      render();
      if (!readProfile) return;
      const epoch = ++profileEpoch;
      let readingProfile = false;
      requestProfile = async () => {
        if (readingProfile) return;
        readingProfile = true;
        try {
          const profile = await readProfile(mission.id);
          if (disposed || epoch !== profileEpoch || !details.open) return;
          requestProfile = undefined;
          if (!profile || profile.contract !== 'aerynth.mission-execution-profile@1' ||
            profile.missionId !== mission.id || profile.revision !== mission.revision) {
            status.textContent = 'Execution profile unavailable for this mission revision. Showing mission summary.';
            return;
          }
          regions = projectIntelligence(mission, expected, profile) ?? [];
          render();
        } catch {
          if (epoch === profileEpoch && details.open) status.textContent = 'Full execution profile unavailable. Showing mission summary.';
        } finally {
          readingProfile = false;
        }
      };
      if (details.open) void requestProfile();
    },
    invalidate,
    dispose() { disposed = true; regions = []; binding = null; details.remove(); },
  };
}
