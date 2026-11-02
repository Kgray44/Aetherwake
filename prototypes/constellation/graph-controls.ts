import type { ConstellationController } from "./controller.ts";
import type { GraphAction } from "./spatial-types.ts";
import { edges } from "./spatial.ts";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = "") => {
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
};
const button = (text: string, fn: () => unknown) => {
  const b = el("button", text);
  b.type = "button";
  b.onclick = () =>
    void Promise.resolve()
      .then(fn)
      .catch(() => {});
  return b;
};
export function graphControls(
  root: HTMLElement,
  c: ConstellationController,
  onChange: () => void,
) {
  const dialog = el("dialog");
  dialog.className = "aw-graph-dialog";
  dialog.setAttribute("aria-label", "Organize canonical information");
  root.append(dialog);
  let trigger: HTMLElement | null = null;
  const close = () => dialog.close();
  dialog.addEventListener(
    "close",
    () => trigger?.isConnected && trigger.focus(),
  );
  function open(title: string) {
    trigger = document.activeElement as HTMLElement;
    dialog.replaceChildren(el("h2", title), button("Close", close));
    if (!dialog.open) dialog.showModal();
  }
  function input(
    form: HTMLFormElement,
    label: string,
    value = "",
    type = "text",
  ) {
    const l = el("label", label),
      i = el("input");
    i.type = type;
    i.value = value;
    i.required = true;
    l.append(i);
    form.append(l);
    return i;
  }
  function select(
    form: HTMLFormElement,
    label: string,
    items: { id: string; title: string }[],
    value?: string,
  ) {
    const l = el("label", label),
      s = el("select");
    for (const i of items) {
      const o = el("option", i.title);
      o.value = i.id;
      s.append(o);
    }
    if (value) s.value = value;
    l.append(s);
    form.append(l);
    return s;
  }
  function form(submit: (form: HTMLFormElement) => GraphAction) {
    const f = el("form"),
      error = el("p");
    error.setAttribute("role", "status");
    const save = el("button", "Apply canonical change");
    save.type = "submit";
    f.append(save, error);
    f.onsubmit = async (e) => {
      e.preventDefault();
      save.disabled = true;
      try {
        const action = submit(f);
        await c.act(action);
        close();
        onChange();
      } catch (e) {
        error.textContent = e instanceof Error ? e.message : "Change failed";
        save.disabled = false;
      }
    };
    dialog.append(f);
    return f;
  }
  const selected = () => c.nodes.get(c.selected ?? "");
  const projectId = () =>
    c.location.kind === "project"
      ? c.location.projectId
      : selected()?.workspaceId
        ? (c.snapshot.workspaces.find((w) => w.id === selected()?.workspaceId)
            ?.project_id ?? null)
        : null;
  function create() {
    open("Create information");
    const actions: [GraphAction["type"], string][] = [
      ["createProject", "Project"],
      ["createWorkspace", "Workspace"],
      ["createResource", "Resource"],
    ];
    for (const [type, label] of actions) {
      const b = button(label, () => creation(type));
      b.disabled = !c.can(type);
      dialog.append(b);
    }
    dialog.append(
      el(
        "p",
        "Objects are created by the application service. Spatial arrangement does not change ownership.",
      ),
    );
  }
  function creation(type: GraphAction["type"]) {
    open(
      "Create " +
        (type === "createProject"
          ? "project"
          : type === "createWorkspace"
            ? "workspace"
            : "resource"),
    );
    let name: HTMLInputElement,
      workspace: HTMLSelectElement,
      project: HTMLSelectElement,
      kind: HTMLSelectElement;
    const f = form(() =>
      type === "createProject"
        ? { type, title: name.value }
        : type === "createWorkspace"
          ? { type, title: name.value, projectId: project.value || null }
          : {
              type: "createResource",
              title: name.value,
              kind: kind.value,
              workspaceId: workspace.value,
              provider: "local",
            },
    );
    name = input(f, "Name");
    name.maxLength = 200;
    if (type === "createWorkspace")
      project = select(
        f,
        "Project",
        [
          { id: "", title: "Independent" },
          ...c.snapshot.projects.filter((p) => p.visible !== false),
        ],
        projectId() ?? "",
      );
    if (type === "createResource") {
      workspace = select(
        f,
        "Workspace",
        c.snapshot.workspaces.filter((w) => c.nodes.has("workspace:" + w.id)),
        selected()?.workspaceId,
      );
      kind = select(
        f,
        "Resource type",
        ["note", "conversation", "task", "research", "reference"].map((id) => ({
          id,
          title: id,
        })),
      );
      if (!c.snapshot.workspaces.length)
        f.querySelector("button")!.setAttribute("disabled", "");
    }
    name.focus();
  }
  function relate() {
    open("Create an explicit relationship");
    const allowed = new Set(
        [...c.nodes.values()]
          .filter((n) => n.kind === "resource" && n.available)
          .map((n) => n.id),
      ),
      items = c.snapshot.resources.filter((r) => allowed.has(r.id));
    let source: HTMLSelectElement,
      target: HTMLSelectElement,
      kind: HTMLSelectElement;
    const f = form(() => ({
      type: "relate",
      sourceId: source.value,
      targetId: target.value,
      kind: kind.value,
    }));
    source = select(f, "Source", items, selected()?.resourceId);
    target = select(f, "Destination", items);
    kind = select(
      f,
      "Relationship type",
      ["references", "depends_on", "related_to"].map((id) => ({
        id,
        title: id,
      })),
    );
    f.append(
      el(
        "p",
        "Direction and type are explicit. This does not transfer content or permissions.",
      ),
    );
  }
  function branch() {
    const n = selected(),
      r = c.snapshot.resources.find((r) => r.id === n?.resourceId);
    if (!n || !r) return;
    open("Create a reviewed conversation continuation");
    if (
      r.kind !== "conversation" ||
      r.provider === "codex" ||
      !r.messages?.length
    ) {
      dialog.append(
        el(
          "p",
          "A local ordinary conversation with a recorded source message is required. Native provider branching and Codex handoff execution are unavailable.",
        ),
      );
      return;
    }
    let name: HTMLInputElement,
      boundary: HTMLSelectElement,
      budget: HTMLInputElement;
    const choices = new Map<string, HTMLInputElement>();
    const f = form(() => ({
      type: "branch",
      resourceId: r.id,
      messageId: boundary.value,
      includeMessageIds: [...choices]
        .filter(([, i]) => i.checked && !i.disabled)
        .map(([id]) => id),
      title: name.value,
      providerId: "mock-ordinary",
      tokenBudget: Number(budget.value),
      workspaceId: n.workspaceId,
    }));
    f.append(
      el(
        "p",
        "Creates an app-level continuation with real ancestry. Only messages checked below are authorized for this handoff. No native fork or model response is claimed.",
      ),
    );
    name = input(f, "New conversation title", r.title + " · continuation");
    name.maxLength = 200;
    boundary = select(
      f,
      "Fork boundary",
      r.messages.map((m) => ({ id: m.id, title: `${m.role} · ${m.id}` })),
      r.messages.at(-1)?.id,
    );
    budget = input(f, "Context token budget", "1024", "number");
    budget.min = "1";
    budget.max = "16000";
    const group = el("fieldset");
    group.append(
      el(
        "legend",
        "Review and select source messages (none selected by default)",
      ),
    );
    for (const m of r.messages) {
      const label = el("label"),
        check = el("input");
      check.type = "checkbox";
      choices.set(m.id, check);
      label.append(
        check,
        document.createTextNode(
          `${m.role} · ${m.id}: ${(m.content ?? "Content unavailable in this projection").slice(0, 160)}`,
        ),
      );
      group.append(label);
    }
    f.append(group);
    boundary.onchange = () => {
      const at = r.messages!.findIndex((m) => m.id === boundary.value);
      r.messages!.forEach((m, i) => {
        const check = choices.get(m.id)!;
        check.disabled = i > at;
        if (check.disabled) check.checked = false;
      });
    };
  }
  function remove() {
    const n = selected();
    if (!n) return;
    open("Preview removal");
    let action: GraphAction;
    if (n.kind === "resource") {
      const block = c.snapshot.blocks.find((b) => "resource:" + b.id === n.key);
      if (!block) return;
      action = {
        type: "detach",
        blockId: block.id,
        expectedVersion: block.version ?? 1,
      };
      dialog.append(
        el(
          "p",
          `Remove the visual block “${n.title}” from this workspace. The canonical resource and other placements remain.`,
        ),
      );
    } else {
      const record =
        n.kind === "project"
          ? c.snapshot.projects.find((p) => p.id === n.id)
          : c.snapshot.workspaces.find((w) => w.id === n.id);
      action = {
        type: "archive",
        kind: n.kind,
        id: n.id,
        expectedVersion: record?.version ?? 1,
      };
      dialog.append(
        el(
          "p",
          `Archive “${n.title}”. Its availability in navigation will be reconciled by the application service.`,
        ),
      );
    }
    const f = form(() => action);
    if (!c.can(action.type))
      f.querySelector("button")!.setAttribute("disabled", "");
  }
  function inspectRelationships() {
    const n = selected();
    open("Relationships");
    for (const edge of edges(c).filter(
      (e) => !n || e.sourceId === n.id || e.targetId === n.id,
    )) {
      const row = el("section");
      const find = (id: string) =>
        [...c.nodes.values()].find((n) => n.id === id);
      row.append(
        el("strong", edge.kind),
        el(
          "p",
          `${find(edge.sourceId)?.title ?? edge.sourceId} → ${find(edge.targetId)?.title ?? edge.targetId}`,
        ),
        el(
          "p",
          `Provenance: ${edge.provenance} · ${edge.createdAt ?? "time unavailable"} · ${edge.freshness ?? "freshness unavailable"}`,
        ),
      );
      if (edge.sourceMessageId)
        row.append(el("p", "Fork boundary: " + edge.sourceMessageId));
      if (edge.evidenceRef)
        row.append(el("p", "Evidence: " + edge.evidenceRef));
      for (const [id, label] of [
        [edge.sourceId, "Locate source"],
        [edge.targetId, "Locate destination"],
      ]) {
        const target = find(id);
        if (target)
          row.append(
            button(label, async () => {
              close();
              if (target.kind === "resource")
                await c.spatial?.explore(target.key);
              else await c.locate(target.key);
            }),
          );
      }
      if (
        !edge.id.startsWith("lineage:") &&
        !edge.id.startsWith("membership:") &&
        c.can("unrelate")
      )
        row.append(
          button("Preview unlink", () => {
            open("Unlink relationship");
            dialog.append(
              el(
                "p",
                `Remove ${edge.kind} between these canonical resources. Resource contents are retained.`,
              ),
            );
            form(() => ({ type: "unrelate", relationshipId: edge.id }));
          }),
        );
      dialog.append(row);
    }
    if (!dialog.querySelector("section"))
      dialog.append(
        el("p", "No available canonical relationships in this scope."),
      );
  }
  function dispose() {
    dialog.remove();
  }
  return { create, relate, branch, remove, inspectRelationships, dispose };
}
