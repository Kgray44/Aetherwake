import type { TimelineExperience } from "../../../block-library/timeline-view.ts";
import type { MissionWorkroomResource } from "../../../integrated-backend/src/mission-contracts.mts";
import { missionEventLabel, missionStateLabel } from "./vela-missions.ts";

export interface MissionWorkroomView extends TimelineExperience {
  setScope(scope: string | null): void;
  observe(accessChanged?: boolean): void;
}

/** Resolves the canonical card binding before mounting either presentation. */
export function mountMissionWorkroomView(
  root: HTMLElement,
  kind: "checklist" | "timeline",
  initialScope: string | null,
  read: () => Promise<MissionWorkroomResource | null>,
  mountManual: (container: HTMLElement) => TimelineExperience,
  openMission: (id: string) => void,
): MissionWorkroomView {
  const doc = root.ownerDocument;
  const section = doc.createElement("section");
  section.className = "aw-mission-workroom";
  section.dataset.noCardDrag = "true";
  const heading = doc.createElement("h3");
  heading.textContent = kind === "checklist" ? "Mission checklist" : "Observed mission timeline";
  const status = doc.createElement("p");
  status.setAttribute("role", "status");
  const list = doc.createElement("ol");
  const open = doc.createElement("button");
  open.type = "button";
  open.textContent = "Open mission evidence";
  open.dataset.aerynthMotionControl = "true";
  section.append(heading, status, open, list);
  const manualDetails = doc.createElement("details");
  manualDetails.className = "aw-mission-workroom-controls";
  manualDetails.dataset.noCardDrag = "true";
  const manualSummary = doc.createElement("summary");
  manualSummary.textContent = kind === "checklist" ? "Manual checklist" : "Timeline settings and activity";
  const manualHost = doc.createElement("div");
  manualHost.style.display = "contents";
  manualDetails.append(manualSummary);

  let scope = initialScope, generation = 0, active = true, disposed = false;
  let presentation: "workspace" | "focused" = "workspace";
  let manual: TimelineExperience | undefined, resolvedManual = false;
  let projection: MissionWorkroomResource | null = null;
  let projectionStamp: string | null = null;
  let pending: Promise<void> | null = null, queued = false;

  const statusOnly = (message: string) => {
    projection = null;
    projectionStamp = null;
    delete section.dataset.missionWorkroomCard;
    delete section.dataset.missionId;
    delete section.dataset.missionRevision;
    status.textContent = message;
    open.hidden = true;
    list.replaceChildren();
    if (section.parentElement !== root) {
      if (manual) root.prepend(section);
      else root.replaceChildren(section);
    }
  };
  const syncManual = () => {
    const show = active && (resolvedManual || (projection !== null && manualDetails.open));
    if (show && !manual) {
      manual = mountManual(manualHost);
      manual.setPresentation(presentation);
    }
    manual?.setActive(show);
  };
  manualDetails.addEventListener("toggle", syncManual);
  const render = (value: MissionWorkroomResource) => {
    const stamp = JSON.stringify(value);
    if (projectionStamp === stamp) return;
    projection = value;
    projectionStamp = stamp;
    section.dataset.missionWorkroomCard = kind;
    section.dataset.missionId = value.missionId;
    section.dataset.missionRevision = String(value.revision);
    open.hidden = false;
    const coverage = value.checklist
      ? `${value.checklist.filter((task) => task.state === "verified").length} of ${value.checklist.length} tasks verified`
      : `${value.timeline.length} recorded events`;
    status.textContent = `${missionStateLabel[value.outcome]} · ${coverage} · Journal revision ${value.revision}`;
    const rows: HTMLLIElement[] = [];
    for (const task of value.checklist ?? []) {
      const row = doc.createElement("li");
      const taskStatus = doc.createElement("small");
      taskStatus.textContent = missionStateLabel[task.state];
      row.dataset.missionTask = task.taskId;
      row.dataset.taskState = task.state;
      row.append(doc.createTextNode(task.title), taskStatus);
      rows.push(row);
    }
    for (const event of value.timeline ?? []) {
      const row = doc.createElement("li");
      row.dataset.missionSequence = String(event.seq);
      const timestamp = doc.createElement("time");
      timestamp.dateTime = event.time;
      timestamp.textContent = event.time;
      const summary = [`#${event.seq} ${missionEventLabel[event.kind]}`, event.taskId, event.detail].filter(Boolean).join(" · ");
      row.append(doc.createTextNode(summary), timestamp);
      rows.push(row);
    }
    list.replaceChildren(...rows);
    if (manualDetails.parentElement !== root) {
      manualDetails.append(manualHost);
      root.replaceChildren(section, manualDetails);
    }
    syncManual();
  };
  open.onclick = () => {
    if (active && projection && !disposed) openMission(projection.missionId);
  };

  function refreshProjection() {
    if (!active || disposed || doc.hidden) return Promise.resolve();
    queued = true;
    if (pending) return pending;
    pending = (async () => {
      while (queued && active && !disposed && !doc.hidden) {
        queued = false;
        const stamp = generation;
        try {
          const value = scope ? await read() : null;
          if (stamp !== generation || disposed || !active || doc.hidden) continue;
          if (value === null) {
            projection = null;
            projectionStamp = null;
            resolvedManual = true;
            if (manualHost.parentElement !== root) root.replaceChildren(manualHost);
            syncManual();
          } else {
            if (!Array.isArray(value[kind])) throw new Error("mission_workroom_card_kind_changed");
            render(value);
          }
        } catch {
          if (stamp === generation && active && !disposed)
            statusOnly("The mission card could not be refreshed.");
        }
      }
    })().finally(() => { pending = null; });
    return pending;
  }
  statusOnly("Checking the mission card…");
  void refreshProjection();
  return {
    setScope(next) {
      if (scope === next) return;
      scope = next;
      generation++;
      resolvedManual = false;
      manual?.setActive(false);
      statusOnly("Checking the mission card…");
      void refreshProjection();
    },
    observe(accessChanged) {
      if (resolvedManual) return;
      if (accessChanged) {
        generation++;
        statusOnly("Checking mission card access…");
        syncManual();
      }
      void refreshProjection();
    },
    setActive(next) {
      if (active === next) return;
      active = next;
      section.inert = !next;
      manualDetails.inert = !next;
      syncManual();
      if (next && !resolvedManual) void refreshProjection();
    },
    setPresentation(next) {
      presentation = next;
      manual?.setPresentation(next);
    },
    async refresh() {
      if (!resolvedManual) await refreshProjection();
      if (active && (resolvedManual || manualDetails.open)) await manual?.refresh();
    },
    async flush() { await manual?.flush(); },
    frame() { manual?.frame(); },
    reflow() { manual?.reflow(); },
    dispose() {
      disposed = true;
      manual?.dispose();
      section.remove();
      manualDetails.remove();
      manualHost.remove();
    },
  };
}
