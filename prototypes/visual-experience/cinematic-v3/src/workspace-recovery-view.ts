import type { WorkspaceRecoveryPreview, WorkspaceRecoveryReceipt, WorkspaceRecoveryRequest,
  WorkspaceRecoveryResponse } from "../../../application-contract/workspace-recovery.ts";

/** Reviewed visibility changes. No content replacement, model request or automatic retry. */
export function mountWorkspaceRecovery(root: HTMLElement, workspaceId: string,
  command: (request: WorkspaceRecoveryRequest) => Promise<WorkspaceRecoveryResponse>, close: () => void) {
  const doc = root.ownerDocument, status = doc.createElement("p"), summary = doc.createElement("div"),
    actions = doc.createElement("div");
  status.setAttribute("role", "status");
  actions.className = "layout-actions";
  root.dataset.workspaceRecovery = workspaceId;
  root.replaceChildren(summary, status, actions);
  let disposed = false, generation = 0, pending = false, error = false;
  let preview: WorkspaceRecoveryPreview | null = null, receipt: WorkspaceRecoveryReceipt | null = null;
  let commandId: string | null = null;
  const text = (parent: HTMLElement, value: string) => {
    const p = doc.createElement("p"); p.textContent = value; parent.append(p);
  };
  const button = (label: string, action: string, run: () => void, disabled = false) => {
    const node = doc.createElement("button");
    node.type = "button"; node.textContent = label; node.dataset.recoveryAction = action; node.disabled = disabled;
    node.onclick = () => { if (!disposed && !node.disabled && actions.contains(node)) run(); };
    return node;
  };
  function render() {
    if (disposed) return;
    root.setAttribute("aria-busy", String(pending));
    root.dataset.state = pending ? "pending" : error ? "error" : receipt ? "applied" : "review";
    summary.replaceChildren(); actions.replaceChildren();
    if (preview) {
      text(summary, preview.title);
      text(summary, preview.action === "undo-creation" ? "Archive this workspace. Keep all current resources, layouts and history."
        : "Restore this workspace with its current resources, layout and history.");
      text(summary, `${preview.placementCount} blocks · ${preview.resourceCount} referenced resources`);
      text(summary, "Mission results and histories are kept. Manage execution through mission controls.");
      const details = doc.createElement("details"), title = doc.createElement("summary");
      title.textContent = "Creation record"; details.append(title);
      text(details, `Created ${preview.createdAt} · ${preview.creationEventId}`);
      text(details, `Workspace v${preview.version} · layout v${preview.layoutVersion} · review expires ${preview.expiresAt}`);
      summary.append(details);
      const reviewed = preview;
      actions.append(button(error ? "Retry reviewed action" : preview.action === "undo-creation" ? "Undo creation" : "Restore workspace",
        "apply", () => { if (preview?.previewId === reviewed.previewId) void apply(); }, pending));
    }
    if (!pending) actions.append(button(receipt ? "Review current state" : "Review again", "review", () => { void prepare(); }));
    actions.append(button(receipt ? "Close" : "Cancel", "close", () => { dispose(); close(); }));
  }
  async function prepare() {
    const run = ++generation;
    pending = true; error = false; preview = null; receipt = null; commandId = null;
    status.textContent = "Reviewing workspace…"; render();
    try {
      const state = await command({ name: "state", input: { workspaceId } });
      if (disposed || run !== generation) return;
      if (state.kind !== "state" || state.workspaceId !== workspaceId) throw Error("workspace_recovery_unavailable");
      if (!state.available) {
        status.textContent = "Creation recovery is unavailable. Existing Workspaces controls remain available.";
        return;
      }
      const review = await command({ name: "preview", input: { workspaceId, action: state.action,
        creationEventId: state.creationEventId, expectedVersion: state.version, expectedLayoutVersion: state.layoutVersion } });
      if (disposed || run !== generation) return;
      if (review.kind !== "preview" || review.workspaceId !== workspaceId || review.action !== state.action)
        throw Error("workspace_recovery_unavailable");
      preview = review; commandId = crypto.randomUUID(); status.textContent = "Review the scope before applying.";
    } catch {
      if (!disposed && run === generation) { error = true; status.textContent = "The workspace could not be reviewed. Try again."; }
    } finally {
      if (!disposed && run === generation) { pending = false; render(); }
    }
  }
  async function apply() {
    if (disposed || pending || !preview || !commandId) return;
    const reviewed = preview, run = generation, request = { previewId: preview.previewId, fingerprint: preview.fingerprint, commandId };
    pending = true; error = false; status.textContent = "Applying reviewed action…"; render();
    try {
      const result = await command({ name: "apply", input: request });
      if (disposed || run !== generation) return;
      if (result.kind !== "receipt" || result.workspaceId !== workspaceId || result.action !== reviewed.action || result.commandId !== request.commandId)
        throw Error("workspace_recovery_unavailable");
      receipt = result; preview = null; commandId = null;
      status.textContent = result.replayed ? "This action was already recorded. Review current state to continue."
        : result.action === "undo-creation" ? "Workspace archived. Content and history retained."
          : "Workspace restored. Content and history retained.";
    } catch {
      if (!disposed && run === generation) {
        error = true;
        status.textContent = "The result is unavailable. Retry the same reviewed action, or review current state again.";
      }
    } finally {
      if (!disposed && run === generation) { pending = false; render(); }
    }
  }
  function dispose() {
    if (disposed) return;
    disposed = true; generation++; preview = null; receipt = null; commandId = null; root.replaceChildren();
  }
  const ready = prepare();
  return { ready, dispose };
}
