import type {
  DesktopSnapshot,
  Project,
  Workspace,
} from "../../../application-contract/contracts.ts";
import type { MotionCoordinator } from "./motion.ts";

type Mutation = Promise<DesktopSnapshot | void>;
export interface EnvironmentNavigatorOptions {
  snapshot: DesktopSnapshot;
  motion: MotionCoordinator;
  wake(): void;
  openWorkspace(id: string): Promise<void>;
  openProject(id: string): Promise<void>;
  createProject(title: string): Mutation;
  createWorkspace(input: { title: string; projectId: string | null }): Mutation;
  templates(projectId: string | null): Promise<void>;
  askVela(projectId: string | null): Promise<void>;
  renameWorkspace(input: {
    id: string;
    expectedVersion: number;
    title: string;
  }): Mutation;
  archiveWorkspace(input: {
    id: string;
    expectedVersion: number;
    archived: boolean;
  }): Mutation;
  renameProject?(input: {
    id: string;
    expectedVersion: number;
    title: string;
  }): Mutation;
  newConversation(): Promise<void>;
  conversations?(): Promise<void>;
  resources(): Promise<void>;
}
export interface EnvironmentNavigatorController {
  update(snapshot: DesktopSnapshot): void;
  /** The application's existing frame owns advancing the shared coordinator. */
  frame(): void;
  focusSearch(): void;
  dispose(): void;
}
type Group = {
  root: HTMLElement;
  row: HTMLElement;
  toggle: HTMLButtonElement;
  open: HTMLButtonElement;
  count: HTMLElement;
  children: HTMLElement;
  motionId: string;
  expanded: boolean;
  reveal: string;
};
type WorkspaceRow = {
  root: HTMLElement;
  open: HTMLButtonElement;
  title: HTMLElement;
  current: HTMLElement;
  more: HTMLButtonElement;
  archived: boolean;
};
type Editor =
  | { kind: "project-create" }
  | { kind: "workspace-create" }
  | {
      kind:
        | "workspace-rename"
        | "workspace-archive"
        | "workspace-restore"
        | "project-rename";
      id: string;
      version: number;
    };
let serial = 0;

/** A metadata-only navigation projection. Local disclosure/form state never
 * grants access or owns projects, workspaces, resources, or execution state. */
export function mountEnvironmentNavigator(
  container: HTMLElement,
  options: EnvironmentNavigatorOptions,
): EnvironmentNavigatorController {
  const doc = container.ownerDocument;
  const prefix = `environment-nav:${++serial}:`,
    neutral = { x: 0, y: 0, w: 0, h: 0, lift: 0, yaw: 0, opacity: 1 },
    interactive = new Map<
      HTMLElement,
      {
        id: string;
        hover: boolean;
        focus: boolean;
        selected: boolean;
        pressed: boolean;
        painted: string;
        target: string;
      }
    >();
  let controlSerial = 0,
    disposed = false;
  function animateControl(node: HTMLElement) {
    const state = {
      id: prefix + "control:" + ++controlSerial,
      hover: false,
      focus: false,
      selected: false,
      pressed: false,
      painted: "",
      target: "0,0,0,0,0",
    };
    interactive.set(node, state);
    options.motion.add(state.id, neutral);
    const change = (key: "hover" | "focus" | "pressed", value: boolean) => {
      if (disposed) return;
      state[key] = value;
      if (key === "hover" && !value) state.pressed = false;
      targetControl(node);
    };
    node.addEventListener("pointerenter", () => change("hover", true));
    node.addEventListener("pointerleave", () => change("hover", false));
    node.addEventListener("focus", () => change("focus", true));
    node.addEventListener("blur", () => change("focus", false));
    node.addEventListener("pointerdown", () => change("pressed", true));
    node.addEventListener("pointerup", () => change("pressed", false));
    node.addEventListener("pointercancel", () => change("pressed", false));
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") change("pressed", true);
    });
    node.addEventListener("keyup", () => change("pressed", false));
  }
  function targetControl(node: HTMLElement, selected?: boolean) {
    const s = interactive.get(node);
    if (!s || disposed) return;
    if (selected !== undefined) s.selected = selected;
    const disabled = +("disabled" in node && node.disabled === true);
    const target = [+s.hover, +s.focus, +s.selected, +s.pressed, disabled].join(
      ",",
    );
    if (target === s.target) return;
    s.target = target;
    options.motion.target(
      s.id,
      {
        ...neutral,
        x: +s.hover,
        y: +s.focus,
        w: +s.selected,
        h: +s.pressed,
        lift: disabled,
      },
      "environment control interaction",
    );
    options.wake();
  }
  function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    cls = "",
    text = "",
  ): HTMLElementTagNameMap[K] {
    const node = doc.createElement(tag);
    node.className = cls;
    if (text) node.textContent = text;
    return node;
  }
  function button(label: string, action: () => void, cls = "en-control") {
    const node = el("button", cls, label);
    node.type = "button";
    node.addEventListener("click", action);
    animateControl(node);
    const identity: Record<string, string> = {
      "New chat": "new-chat",
      Resources: "resources",
      Conversations: "conversations",
      Project: "create-project",
      Workspace: "create-workspace",
      "From template": "workspace-template",
      "Ask Vela": "workspace-vela",
      Cancel: "cancel-editor",
      Rename: "rename-workspace",
      "Archive…": "review-archive",
      Done: "close-actions",
    };
    if (identity[label]) node.dataset.action = identity[label];
    return node;
  }
  const root = el("section", "en-navigator"),
    toolbar = el("div", "en-toolbar"),
    searchBox = el("div", "en-search"),
    search = el("input"),
    clear = button(
      "×",
      () => {
        search.value = "";
        render();
        search.focus();
      },
      "en-search-clear",
    );
  root.setAttribute("aria-label", "Projects and workspaces");
  search.type = "search";
  search.placeholder = "Find a project or workspace";
  search.maxLength = 200;
  search.setAttribute("aria-label", "Find a project or workspace");
  clear.setAttribute("aria-label", "Clear environment search");
  searchBox.append(search, clear);
  search.name = "query";
  search.dataset.action = "search";
  clear.dataset.action = "clear-search";
  const quick = el("nav", "en-quick");
  quick.setAttribute("aria-label", "Quick actions");
  quick.append(
    button(
      "New chat",
      () => {
        void perform(options.newConversation);
      },
      "en-control en-primary",
    ),
    button("Resources", () => {
      void perform(options.resources);
    }),
  );
  if (options.conversations)
    quick.insertBefore(
      button("Conversations", () => {
        void perform(options.conversations!);
      }),
      quick.children[1],
    );
  const create = el("details", "en-create"),
    createSummary = el("summary", "en-control", "Create"),
    createChoices = el("div", "en-create-choices");
  create.append(createSummary, createChoices);
  quick.append(create);
  createSummary.dataset.action = "toggle-create";
  createChoices.append(
    button("Project", () => begin({ kind: "project-create" })),
    button("Workspace", () => begin({ kind: "workspace-create" })),
  );
  toolbar.append(searchBox, quick);
  const tree = el("div", "en-tree");
  tree.setAttribute("role", "tree");
  tree.setAttribute("aria-label", "Environment hierarchy");
  const empty = el("p", "en-empty"),
    archive = el("details", "en-archive"),
    archiveSummary = el("summary", "", "Archived workspaces"),
    archiveList = el("div", "en-archive-list");
  archive.append(archiveSummary, archiveList);
  archiveSummary.dataset.action = "toggle-archive";
  const editor = el("section", "en-editor"),
    heading = el("h3"),
    form = el("form"),
    nameLabel = el("label", "en-field", "Name"),
    name = el("input"),
    projectLabel = el("label", "en-field", "Project"),
    project = el("select"),
    explanation = el("p", "en-explanation"),
    choices = el("div", "en-start-choices"),
    submit = el("button", "en-control en-primary"),
    cancel = button("Cancel", closeEditor);
  name.maxLength = 200;
  name.setAttribute("aria-label", "Environment name");
  name.required = true;
  project.setAttribute("aria-label", "Workspace project");
  nameLabel.append(name);
  projectLabel.append(project);
  submit.type = "submit";
  name.name = "title";
  project.name = "projectId";
  const templates = button("From template", () => {
      const id = chosenProject();
      if (id !== undefined) void perform(() => options.templates(id));
    }),
    vela = button("Ask Vela", () => {
      const id = chosenProject();
      if (id !== undefined) void perform(() => options.askVela(id));
    });
  choices.append(templates, vela);
  const formActions = el("div", "en-form-actions");
  formActions.append(submit, cancel);
  form.append(nameLabel, projectLabel, explanation, choices, formActions);
  editor.append(heading, form);
  editor.hidden = true;
  const status = el("p", "en-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.hidden = true;
  root.append(toolbar, tree, empty, archive, editor, status);
  container.append(root);
  for (const node of [
    search,
    createSummary,
    name,
    project,
    submit,
    archiveSummary,
  ])
    animateControl(node);
  const disclosureId = prefix + "disclosures";
  options.motion.add(disclosureId, neutral);
  const groups = new Map<string, Group>(),
    rows = new Map<string, WorkspaceRow>(),
    expanded = new Set<string>();
  let snapshot = options.snapshot,
    pending = false,
    editing: Editor | null = null,
    focusKey: string | null = null,
    actionWorkspaceId: string | null = null,
    createExpanded = false,
    archiveExpanded = false,
    disclosurePainted = "";
  function disclosure() {
    if (disposed) return;
    options.motion.target(
      disclosureId,
      {
        ...neutral,
        x: +createExpanded,
        y: +(actionWorkspaceId !== null),
        w: +(editing !== null),
        h: +archiveExpanded,
      },
      "environment contextual disclosure",
    );
    targetControl(createSummary, createExpanded);
    targetControl(archiveSummary, archiveExpanded);
    createSummary.setAttribute("aria-expanded", String(createExpanded));
    archiveSummary.setAttribute("aria-expanded", String(archiveExpanded));
    frame();
    options.wake();
  }
  // Native summary activation (pointer or keyboard) still owns the action.
  // Keep UA details content rendered through closing instead of removing its
  // open attribute before the shared coordinator can present that closing.
  createSummary.addEventListener("click", (event) => {
    event.preventDefault();
    createExpanded = !createExpanded;
    disclosure();
  });
  archiveSummary.addEventListener("click", (event) => {
    event.preventDefault();
    archiveExpanded = !archiveExpanded;
    disclosure();
  });
  const currentWorkspace = () =>
    snapshot.navigation.kind === "workspace"
      ? snapshot.navigation.workspaceId
      : null;
  const workspace = (id: string, archived = false) =>
    (archived ? (snapshot.archivedWorkspaces ?? []) : snapshot.workspaces).find(
      (w) =>
        w.id === id &&
        (w.project_id === null ||
          snapshot.projects.some((p) => p.id === w.project_id)),
    );
  const projectRecord = (id: string) =>
    snapshot.projects.find((p) => p.id === id);
  function message(text: string, error = false) {
    status.textContent = text;
    status.hidden = !text;
    status.dataset.state = error ? "error" : "notice";
  }
  async function perform(action: () => Mutation): Promise<void> {
    if (disposed || pending) return;
    pending = true;
    root.setAttribute("aria-busy", "true");
    controls();
    message("");
    try {
      const next = await action();
      if (!disposed) {
        if (next) update(next);
        else render();
      }
    } catch (error) {
      if (!disposed)
        message(
          error instanceof Error
            ? error.message.slice(0, 240)
            : "This action could not be completed.",
          true,
        );
    } finally {
      pending = false;
      if (!disposed) {
        root.setAttribute("aria-busy", "false");
        controls();
        options.wake();
      }
    }
  }
  function ensureAvailable(ok: unknown): asserts ok {
    if (!ok)
      throw new Error(
        "This environment is no longer available. Your unfinished text is retained.",
      );
  }
  function chosenProject(): string | null | undefined {
    const id = project.value || null;
    if (id && !projectRecord(id)) {
      message(
        "The selected project is no longer available. Choose another project.",
        true,
      );
      return undefined;
    }
    return id;
  }
  function closeEditor() {
    editing = null;
    message("");
    disclosure();
  }
  function begin(next: Editor) {
    if (pending || disposed) return;
    createExpanded = false;
    actionWorkspaceId = null;
    editing = next;
    message("");
    editor.dataset.mode = next.kind;
    editor.dataset.subjectId = "id" in next ? next.id : "";
    submit.dataset.action = "submit-" + next.kind;
    const ws =
        "id" in next
          ? workspace(next.id, next.kind === "workspace-restore")
          : undefined,
      p = "id" in next ? projectRecord(next.id) : undefined;
    const creatingWorkspace = next.kind === "workspace-create",
      removing = next.kind === "workspace-archive",
      restoring = next.kind === "workspace-restore";
    heading.textContent =
      next.kind === "project-create"
        ? "New project"
        : creatingWorkspace
          ? "New workspace"
          : removing
            ? "Archive workspace?"
            : restoring
              ? "Restore workspace"
              : "Rename " +
                (next.kind === "project-rename" ? "project" : "workspace");
    name.value =
      "id" in next
        ? ((next.kind === "project-rename" ? p?.title : ws?.title) ?? "")
        : "";
    nameLabel.hidden = removing || restoring;
    name.required = !nameLabel.hidden;
    projectLabel.hidden = !creatingWorkspace;
    choices.hidden = !creatingWorkspace;
    explanation.hidden = !removing && !restoring;
    explanation.textContent = removing
      ? "The layout and its resources are retained. Restore it from Archived workspaces."
      : restoring
        ? "Restore this saved workspace and its existing layout."
        : "";
    submit.textContent = removing
      ? "Archive workspace"
      : restoring
        ? "Restore workspace"
        : next.kind === "project-create"
          ? "Create project"
          : creatingWorkspace
            ? "Start blank"
            : "Save name";
    if (creatingWorkspace) {
      const active = snapshot.workspaces.find(
        (w) => w.id === currentWorkspace(),
      );
      project.value =
        snapshot.navigation.kind === "constellation"
          ? (snapshot.navigation.projectId ?? "")
          : (active?.project_id ?? "");
    }
    controls();
    disclosure();
    (nameLabel.hidden ? submit : name).focus();
  }
  function controls() {
    for (const node of root.querySelectorAll<HTMLButtonElement>("button"))
      node.disabled = pending;
    if (editing && "id" in editing)
      submit.disabled =
        pending ||
        !(editing.kind === "project-rename"
          ? projectRecord(editing.id)
          : workspace(editing.id, editing.kind === "workspace-restore"));
    for (const node of root.querySelectorAll<HTMLButtonElement>("button"))
      targetControl(node);
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const captured = editing;
    if (!captured || pending) return;
    const rawTitle = name.value,
      title = rawTitle.trim();
    if (name.required && !title) {
      name.focus();
      return;
    }
    const selected = chosenProject();
    if (captured.kind === "workspace-create" && selected === undefined) return;
    void perform(async () => {
      let result: DesktopSnapshot | void;
      if (captured.kind === "project-create")
        result = await options.createProject(title);
      else if (captured.kind === "workspace-create")
        result = await options.createWorkspace({ title, projectId: selected! });
      else if (captured.kind === "project-rename") {
        ensureAvailable(projectRecord(captured.id) && options.renameProject);
        result = await options.renameProject({
          id: captured.id,
          expectedVersion: captured.version,
          title,
        });
      } else {
        ensureAvailable(
          workspace(captured.id, captured.kind === "workspace-restore"),
        );
        result =
          captured.kind === "workspace-rename"
            ? await options.renameWorkspace({
                id: captured.id,
                expectedVersion: captured.version,
                title,
              })
            : await options.archiveWorkspace({
                id: captured.id,
                expectedVersion: captured.version,
                archived: captured.kind === "workspace-archive",
              });
      }
      if (
        !disposed &&
        editing === captured &&
        name.value === rawTitle &&
        (!projectLabel.hidden ? project.value === (selected ?? "") : true)
      )
        closeEditor();
      return result;
    });
  });
  function group(key: string, title: string, p?: Project): Group {
    let g = groups.get(key);
    if (g) return g;
    const node = el("section", "en-group"),
      row = el("div", "en-project-row"),
      count = el("span", "en-count"),
      children = el("div", "en-workspaces"),
      toggle = button(
        "›",
        () => {
          if (expanded.has(key)) expanded.delete(key);
          else expanded.add(key);
          render();
        },
        "en-expand",
      ),
      open = button(
        title,
        () => {
          if (p)
            void perform(async () => {
              ensureAvailable(projectRecord(p.id));
              await options.openProject(p.id);
            });
          else {
            if (expanded.has(key)) expanded.delete(key);
            else expanded.add(key);
            render();
          }
        },
        "en-project-name",
      );
    node.dataset.projectId = p?.id ?? "";
    open.dataset.navKey = key;
    open.dataset.action = p ? "open-project" : "toggle-independent";
    toggle.dataset.action = "toggle-project";
    open.setAttribute("role", "treeitem");
    open.setAttribute("aria-level", "1");
    toggle.tabIndex = -1;
    count.setAttribute("aria-hidden", "true");
    children.setAttribute("role", "group");
    children.id = prefix + key + ":children";
    open.setAttribute("aria-owns", children.id);
    toggle.setAttribute("aria-controls", children.id);
    row.append(toggle, open, count);
    node.append(row, children);
    if (p && options.renameProject) {
      const more = button(
        "···",
        () => {
          const actual = projectRecord(p.id);
          if (actual)
            begin({
              kind: "project-rename",
              id: actual.id,
              version: actual.version,
            });
        },
        "en-more",
      );
      more.setAttribute("aria-label", `Rename project ${title}`);
      row.append(more);
    }
    const motionId = prefix + key;
    options.motion.add(motionId, {
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      lift: 0,
      yaw: 0,
      opacity: 1,
    });
    g = {
      root: node,
      row,
      toggle,
      open,
      count,
      children,
      motionId,
      expanded: false,
      reveal: "",
    };
    groups.set(key, g);
    return g;
  }
  function row(w: Workspace, archived: boolean): WorkspaceRow {
    const key = (archived ? "archive:" : "workspace:") + w.id;
    let r = rows.get(key);
    if (r) return r;
    const node = el("div", "en-workspace-row"),
      title = el("span", "en-name"),
      current = el("span", "en-current", "Current"),
      open = button(
        "",
        () => {
          if (archived) {
            const actual = workspace(w.id, true);
            if (actual)
              begin({
                kind: "workspace-restore",
                id: actual.id,
                version: actual.version,
              });
          } else
            void perform(async () => {
              ensureAvailable(workspace(w.id));
              await options.openWorkspace(w.id);
            });
        },
        "en-workspace-name",
      );
    node.dataset.workspaceId = w.id;
    open.dataset.navKey = key;
    open.dataset.action = archived ? "review-restore" : "open-workspace";
    if (!archived) {
      open.setAttribute("role", "treeitem");
      open.setAttribute("aria-level", "2");
    }
    open.append(title, current);
    const more = button(
      archived ? "Restore" : "···",
      () => {
        const actual = workspace(w.id, archived);
        if (!actual || pending) return;
        if (archived)
          begin({
            kind: "workspace-restore",
            id: actual.id,
            version: actual.version,
          });
        else showWorkspaceActions(actual);
      },
      "en-more",
    );
    more.dataset.action = archived ? "review-restore" : "workspace-more";
    more.setAttribute(
      "aria-label",
      `${archived ? "Restore" : "More options for"} ${w.title}`,
    );
    node.append(open, more);
    r = { root: node, open, title, current, more, archived };
    rows.set(key, r);
    return r;
  }
  const workspaceActions = el("div", "en-workspace-actions");
  workspaceActions.hidden = true;
  root.insertBefore(workspaceActions, editor);
  function showWorkspaceActions(w: Workspace) {
    if (actionWorkspaceId === w.id) {
      actionWorkspaceId = null;
      render();
      return;
    }
    closeEditor();
    actionWorkspaceId = w.id;
    workspaceActions.dataset.workspaceId = w.id;
    workspaceActions.setAttribute("role", "group");
    workspaceActions.setAttribute("aria-label", `Actions for ${w.title}`);
    workspaceActions.replaceChildren(
      el("span", "en-action-name", w.title),
      button("Rename", () =>
        begin({ kind: "workspace-rename", id: w.id, version: w.version }),
      ),
      button("Archive…", () =>
        begin({ kind: "workspace-archive", id: w.id, version: w.version }),
      ),
      button("Done", () => {
        actionWorkspaceId = null;
        render();
      }),
    );
    render();
    options.wake();
    workspaceActions.querySelector<HTMLButtonElement>("button")?.focus();
  }
  function visibleItems() {
    return [
      ...tree.querySelectorAll<HTMLButtonElement>("[data-nav-key]"),
    ].filter((node) => {
      for (
        let p: HTMLElement | null = node;
        p && p !== tree;
        p = p.parentElement
      )
        if (p.hidden || p.inert || p.getAttribute("aria-hidden") === "true")
          return false;
      return true;
    });
  }
  function focusItem(node: HTMLButtonElement | undefined) {
    if (!node) return;
    focusKey = node.dataset.navKey!;
    for (const item of visibleItems()) item.tabIndex = item === node ? 0 : -1;
    node.focus();
  }
  tree.addEventListener("focusin", (event) => {
    const node = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-nav-key]",
    );
    if (node) focusKey = node.dataset.navKey!;
  });
  tree.addEventListener("keydown", (event) => {
    const node = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-nav-key]",
    );
    if (!node) return;
    const items = visibleItems(),
      i = items.indexOf(node),
      g = groups.get(node.dataset.navKey!),
      ws = node.closest<HTMLElement>("[data-workspace-id]");
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      focusItem(
        items[
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : Math.max(
                  0,
                  Math.min(
                    items.length - 1,
                    i + (event.key === "ArrowDown" ? 1 : -1),
                  ),
                )
        ],
      );
    } else if (event.key === "ArrowRight" && g) {
      event.preventDefault();
      expanded.add(node.dataset.navKey!);
      render();
      focusItem(
        g.children.querySelector<HTMLButtonElement>("[data-nav-key]") ?? node,
      );
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (g) {
        expanded.delete(node.dataset.navKey!);
        render();
      } else if (ws)
        focusItem(
          ws
            .closest(".en-group")
            ?.querySelector<HTMLButtonElement>(".en-project-name") ?? undefined,
        );
    } else if (event.key === " " && g) {
      event.preventDefault();
      if (expanded.has(node.dataset.navKey!))
        expanded.delete(node.dataset.navKey!);
      else expanded.add(node.dataset.navKey!);
      render();
    }
  });
  search.addEventListener("input", () => render());
  search.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusItem(visibleItems()[0]);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const matches = [...rows.values()].filter(
        (r) => !r.archived && !r.root.hidden && tree.contains(r.root),
      );
      if (matches.length === 1) matches[0].open.click();
      else focusItem(visibleItems()[0]);
    } else if (event.key === "Escape" && search.value) {
      event.preventDefault();
      event.stopPropagation();
      search.value = "";
      render();
    }
  });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && (editing || actionWorkspaceId !== null)) {
      event.preventDefault();
      event.stopPropagation();
      closeEditor();
      actionWorkspaceId = null;
      disclosure();
      search.focus();
    }
  });
  function render() {
    if (disposed) return;
    const scroll = tree.scrollTop,
      focused = doc.activeElement as HTMLElement | null,
      wasTreeFocus = !!focused && tree.contains(focused),
      needle = search.value.trim().toLocaleLowerCase(),
      current = currentWorkspace(),
      active = snapshot.workspaces.find((w) => w.id === current),
      liveKeys = new Set<string>(),
      liveRows = new Set<string>();
    let count = 0,
      groupIndex = 0;
    const place = (parent: HTMLElement, node: HTMLElement, index: number) => {
      if (parent.children[index] !== node)
        parent.insertBefore(node, parent.children[index] ?? null);
    };
    clear.hidden = !search.value;
    for (const p of [...snapshot.projects, null]) {
      const key = p ? "project:" + p.id : "independent",
        title = p?.title ?? "Independent workspaces",
        all = snapshot.workspaces.filter(
          (w) => w.project_id === (p?.id ?? null),
        ),
        projectMatch = title.toLocaleLowerCase().includes(needle),
        matching = all.filter(
          (w) =>
            !needle ||
            projectMatch ||
            w.title.toLocaleLowerCase().includes(needle),
        );
      if ((needle && !projectMatch && !matching.length) || (!p && !all.length))
        continue;
      const g = group(key, title, p ?? undefined);
      liveKeys.add(key);
      place(tree, g.root, groupIndex++);
      if (g.open.textContent !== title) g.open.textContent = title;
      g.toggle.setAttribute(
        "aria-label",
        `${expanded.has(key) ? "Collapse" : "Expand"} ${title}`,
      );
      g.count.textContent = String(matching.length);
      const selected = p
        ? snapshot.navigation.kind === "constellation" &&
          snapshot.navigation.projectId === p.id
        : false;
      g.open.setAttribute("aria-current", selected ? "page" : "false");
      targetControl(g.open, selected);
      g.root.dataset.current = String(
        p
          ? active?.project_id === p.id || selected
          : active?.project_id === null,
      );
      const open = !!needle || expanded.has(key);
      g.children.inert = !open;
      g.children.setAttribute("aria-hidden", String(!open));
      g.open.setAttribute("aria-expanded", String(open));
      g.toggle.setAttribute("aria-expanded", String(open));
      g.toggle.textContent = open ? "⌄" : "›";
      targetControl(g.toggle, open);
      if (g.expanded !== open) {
        g.expanded = open;
        options.motion.target(
          g.motionId,
          { x: open ? 1 : 0, y: 0, w: 0, h: 0, lift: 0, yaw: 0, opacity: 1 },
          "environment group disclosure",
        );
        options.wake();
      }
      let workspaceIndex = 0;
      for (const w of matching) {
        const r = row(w, false);
        liveRows.add("workspace:" + w.id);
        place(g.children, r.root, workspaceIndex++);
        if (r.title.textContent !== w.title) r.title.textContent = w.title;
        r.more.setAttribute("aria-label", `More options for ${w.title}`);
        r.more.setAttribute(
          "aria-expanded",
          String(actionWorkspaceId === w.id),
        );
        r.current.hidden = w.id !== current;
        r.open.setAttribute(
          "aria-current",
          w.id === current ? "page" : "false",
        );
        r.root.dataset.current = String(w.id === current);
        targetControl(r.open, w.id === current);
        targetControl(r.more, actionWorkspaceId === w.id);
        count++;
      }
    }
    for (const [key, g] of groups) if (!liveKeys.has(key)) g.root.remove();
    for (const [key, r] of rows)
      if (!liveRows.has(key) && !r.archived) r.root.remove();
    const archived = (snapshot.archivedWorkspaces ?? []).filter(
      (w) =>
        (w.project_id === null || projectRecord(w.project_id)) &&
        (!needle ||
          w.title.toLocaleLowerCase().includes(needle) ||
          projectRecord(w.project_id ?? "")
            ?.title.toLocaleLowerCase()
            .includes(needle)),
    );
    archive.hidden = !archived.length;
    archiveSummary.textContent = `Archived workspaces · ${archived.length}`;
    let archiveIndex = 0;
    for (const w of archived) {
      const r = row(w, true);
      liveRows.add("archive:" + w.id);
      place(archiveList, r.root, archiveIndex++);
      r.title.textContent = w.title;
      r.current.hidden = true;
    }
    for (const [key, r] of rows)
      if (r.archived && !liveRows.has(key)) r.root.remove();
    empty.hidden = !!liveKeys.size;
    empty.textContent = needle
      ? "No matching projects or workspaces."
      : "Start with a chat, or create your first project or workspace.";
    const selected = project.value;
    project.replaceChildren();
    for (const p of [
      { id: "", title: "Independent workspace" },
      ...snapshot.projects,
    ]) {
      const o = el("option", "", p.title);
      o.value = p.id;
      project.append(o);
    }
    if (selected && !projectRecord(selected)) {
      const o = el("option", "", "Selected project · unavailable");
      o.value = selected;
      o.disabled = true;
      project.append(o);
    }
    project.value = selected;
    const items = visibleItems(),
      preferred =
        items.find((n) => n.dataset.navKey === focusKey) ??
        items.find((n) => n.getAttribute("aria-current") === "page") ??
        items[0];
    for (const n of items) n.tabIndex = n === preferred ? 0 : -1;
    if (
      actionWorkspaceId &&
      (!workspace(actionWorkspaceId) ||
        !liveRows.has("workspace:" + actionWorkspaceId))
    ) {
      actionWorkspaceId = null;
      workspaceActions.hidden = true;
      workspaceActions.replaceChildren();
    }
    const canonicalGroups = new Set([
      "independent",
      ...snapshot.projects.map((p) => "project:" + p.id),
    ]);
    for (const [key, g] of groups)
      if (!canonicalGroups.has(key)) {
        g.root.remove();
        options.motion.bodies.delete(g.motionId);
        groups.delete(key);
        expanded.delete(key);
      }
    for (const [key, r] of rows)
      if (!workspace(r.root.dataset.workspaceId!, r.archived)) {
        r.root.remove();
        rows.delete(key);
      }
    const retained = new Set<HTMLElement>([
      root,
      ...[...groups.values()].map((g) => g.root),
      ...[...rows.values()].map((r) => r.root),
    ]);
    for (const [node, state] of interactive) {
      let parent: HTMLElement | null = node;
      while (parent && !retained.has(parent)) parent = parent.parentElement;
      if (!parent) {
        options.motion.bodies.delete(state.id);
        interactive.delete(node);
      }
    }
    if (focused && tree.contains(focused) && doc.activeElement !== focused)
      focused.focus();
    else if (wasTreeFocus && focused && !tree.contains(focused)) {
      if (preferred) focusItem(preferred);
      else search.focus();
    }
    tree.scrollTop = scroll;
    root.dataset.results = String(count);
    controls();
    disclosure();
    frame();
  }
  function frame() {
    if (disposed) return;
    const present = (panel: HTMLElement, open: boolean, progress: number) => {
      const value = Math.max(0, Math.min(1, progress));
      if (panel.dataset.open !== String(open))
        panel.dataset.open = String(open);
      if (panel.inert !== !open) panel.inert = !open;
      if (panel.getAttribute("aria-hidden") !== String(!open))
        panel.setAttribute("aria-hidden", String(!open));
      const hidden = !open && value === 0;
      if (panel.hidden !== hidden) panel.hidden = hidden;
      const opacity = value.toFixed(3);
      if (panel.style.opacity !== opacity) panel.style.opacity = opacity;
    };
    for (const g of groups.values()) {
      const progress = options.motion.pose(g.motionId).x,
        value = progress.toFixed(3);
      present(g.children, g.expanded, progress);
      if (g.reveal !== value) {
        g.root.style.setProperty("--en-reveal", value);
        g.reveal = value;
      }
    }
    for (const [node, state] of interactive) {
      const p = options.motion.pose(state.id),
        values = [p.x, p.y, p.w, p.h, p.lift].map((v) => v.toFixed(3)),
        painted = values.join(",");
      if (painted !== state.painted) {
        ["hover", "focus", "selected", "pressed", "disabled"].forEach(
          (key, i) => node.style.setProperty("--en-" + key, values[i]),
        );
        state.painted = painted;
      }
    }
    const p = options.motion.pose(disclosureId),
      values = [p.x, p.y, p.w, p.h].map((v) => v.toFixed(3)),
      painted = values.join(",");
    if (painted !== disclosurePainted) {
      ["create", "actions", "editor", "archive"].forEach((key, i) =>
        root.style.setProperty("--en-" + key + "-reveal", values[i]),
      );
      disclosurePainted = painted;
    }
    present(createChoices, createExpanded, p.x);
    present(workspaceActions, actionWorkspaceId !== null, p.y);
    present(editor, editing !== null, p.w);
    present(archiveList, archiveExpanded, p.h);
    const createMounted = createExpanded || p.x > 0,
      archiveMounted = archiveExpanded || p.h > 0;
    if (create.open !== createMounted) create.open = createMounted;
    if (archive.open !== archiveMounted) archive.open = archiveMounted;
    root.dataset.createOpen = String(createExpanded);
    root.dataset.actionsOpen = String(actionWorkspaceId !== null);
    root.dataset.editorOpen = String(editing !== null);
    root.dataset.archiveOpen = String(archiveExpanded);
  }
  function update(next: DesktopSnapshot) {
    if (disposed) return;
    snapshot = next;
    render();
  }
  const initial = snapshot.workspaces.find((w) => w.id === currentWorkspace());
  if (initial)
    expanded.add(
      initial.project_id ? "project:" + initial.project_id : "independent",
    );
  if (
    snapshot.navigation.kind === "constellation" &&
    snapshot.navigation.projectId
  )
    expanded.add("project:" + snapshot.navigation.projectId);
  render();
  return {
    update,
    frame,
    focusSearch: () => {
      if (!disposed) search.focus();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const g of groups.values()) options.motion.bodies.delete(g.motionId);
      for (const state of interactive.values())
        options.motion.bodies.delete(state.id);
      options.motion.bodies.delete(disclosureId);
      interactive.clear();
      groups.clear();
      rows.clear();
      root.remove();
    },
  };
}
