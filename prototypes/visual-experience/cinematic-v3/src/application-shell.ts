import type { DesktopSnapshot } from "../../../application-contract/contracts.ts";

type WorkspaceChrome = {
  workspace: HTMLElement;
  undo: HTMLButtonElement;
  undoLabel: HTMLElement;
  layoutLabel: HTMLElement;
};

export function refreshWorkspaceChrome(
  controls: WorkspaceChrome,
  snapshot: Pick<
    DesktopSnapshot,
    "activeWorkspaceId" | "workspaces" | "canUndo" | "organization"
  >,
) {
  const title =
    snapshot.workspaces.find(
      (workspace) => workspace.id === snapshot.activeWorkspaceId,
    )?.title ?? "Workspaces";
  const workspace = `${title} ↗`;
  const mode = snapshot.organization?.mode;
  const layout = mode ? mode[0].toUpperCase() + mode.slice(1) : "Layout";
  if (controls.workspace.textContent !== workspace)
    controls.workspace.textContent = workspace;
  const undoDisabled = !snapshot.canUndo;
  if (controls.undo.disabled !== undoDisabled)
    controls.undo.disabled = undoDisabled;
  if (controls.undoLabel.textContent !== "Undo layout")
    controls.undoLabel.textContent = "Undo layout";
  if (controls.layoutLabel.textContent !== layout)
    controls.layoutLabel.textContent = layout;
}

/** Mounts connected shell chrome into the existing renderer document. */
export function mountApplicationShell(document: Document) {
  const el = <T extends HTMLElement = HTMLElement>(selector: string) =>
    document.querySelector<T>(selector)!;
  const dialog = document.createElement("dialog");
  dialog.id = "command-surface";
  dialog.className = "command-surface";
  dialog.setAttribute("aria-label", "Aerynth commands");
  document.body.append(dialog);
  const universe = document.createElement("section");
  universe.id = "constellation-view";
  universe.className = "constellation-host";
  universe.hidden = true;
  universe.setAttribute("aria-label", "Constellation navigation");
  // Share the existing isolated application stack with scene controls and Vela.
  el("#app").append(universe);
  el(".brand small").textContent = "LIQUID INTELLIGENCE / WORKING REVIEW";
  el(".brand img").setAttribute("alt", "Aerynth");
  el("#settings-button").setAttribute("aria-label", "Scene controls");
  el("#settings-button").setAttribute("title", "Scene controls");
  el(".provenance").textContent = "LOCAL DATA · Codex connects only on request";
  el(".study-caption small").textContent = "Your resources. Your space.";
  el("#vela-state").textContent = "Idle · no background execution";
  el("#vela-dialog").setAttribute("aria-hidden", "true");
  el("#vela-expression")
    .closest("section")!
    .querySelector('label[for="vela-expression"]')!.textContent =
    "Visual expression preview (synthetic)";
  el("#demo").hidden = true;
  el("#status").textContent = "Ready.";
  const place = el(".place");
  place.innerHTML =
    '<button id="workspace-manager" title="Projects and workspaces (Ctrl+K)">Workspaces ↗</button><button id="application-new-chat">＋ Chat</button><button id="application-agents" data-aerynth-motion-control="true">Agents</button><button id="application-resources" data-aerynth-motion-control="true">Resources</button><button id="application-stream" data-aerynth-motion-control="true" aria-label="Intelligence Stream" aria-expanded="false" title="Intelligence Stream"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.6"><path d="M3 12h4l3-6 4 12 3-6h4"/></svg></button><button id="application-connections" aria-label="Connections" title="Connections">⌁</button>';
  const dock = el(".dock");
  dock.insertAdjacentHTML(
    "afterbegin",
    '<button id="add-block">＋ <span>Add</span></button><button id="resource-picker">◌ <span>Resources</span></button><button id="layout-manager">▣ <span>Layout</span></button><button id="zoom-out">⤢ <span>Constellation</span></button><button id="nav-back">↶ <span>Back</span></button>',
  );
  dock.insertAdjacentHTML(
    "beforeend",
    '<button id="connections">⌁ <span>Connections</span></button>',
  );
  const layoutButton = el("#layout-manager");
  layoutButton.title = "Organization mode, layout history and block access";
  const controls = {
    workspace: el("#workspace-manager"),
    undo: el<HTMLButtonElement>("#undo"),
    undoLabel: el("#undo span"),
    layoutLabel: el("#layout-manager span"),
  };
  return {
    dialog,
    universe,
    place,
    refresh(snapshot: DesktopSnapshot) {
      refreshWorkspaceChrome(controls, snapshot);
      universe.hidden = false;
      const overview = snapshot.navigation.kind === "constellation";
      document.body.classList.toggle("constellation-overview", overview);
      universe.classList.toggle("overview", overview);
    },
  };
}
