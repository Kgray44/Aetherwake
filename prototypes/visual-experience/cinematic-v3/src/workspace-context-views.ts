import {
  mountEventExperience,
  type EventWindow,
} from "../../../block-library/event-view.ts";

export type ContextualResource = Readonly<{
  id: string;
  title: string;
  kind: string;
  visible?: boolean;
  available?: boolean;
  canAttach?: boolean;
}>;
export type ContextualResourceSnapshot = Readonly<{
  resources: readonly ContextualResource[];
  workspaceId: string | null;
}>;
export interface ContextualResourcesPort {
  snapshot(): ContextualResourceSnapshot;
  open(id: string): void | Promise<void>;
  attach(id: string): void | Promise<void>;
  actions?: readonly Readonly<{
    id: string;
    label: string;
    run(): void | Promise<void>;
  }>[];
}

const PAGE_SIZE = 24;
const kindLabel = (kind: string) =>
  kind.replace(/[_.-]+/g, " ").replace(/^./, (letter) => letter.toUpperCase());

/** This is a display projection. The host owns identity, eligibility and writes. */
export function contextualResourcePage(
  snapshot: ContextualResourceSnapshot,
  query: string,
  page: number,
) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = snapshot.resources.filter((resource) => {
    if (resource.visible === false) return false;
    const searchable = [resource.title, resource.kind, kindLabel(resource.kind)]
      .join(" ")
      .toLocaleLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
  const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const index = Math.max(
    0,
    Math.min(pages - 1, Number.isFinite(page) ? Math.trunc(page) : 0),
  );
  return {
    items: matches.slice(index * PAGE_SIZE, (index + 1) * PAGE_SIZE),
    total: matches.length,
    page: index,
    pages,
  };
}

const canAttach = (
  snapshot: ContextualResourceSnapshot,
  resource: ContextualResource,
) =>
  !!snapshot.workspaceId &&
  resource.visible !== false &&
  resource.available !== false &&
  resource.canAttach === true;

function createNodes(root: HTMLElement) {
  function node<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className = "",
    text = "",
  ) {
    const element = root.ownerDocument.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  }
  const motionControl = (element: HTMLElement) => {
    element.dataset.aerynthMotionControl = "true";
  };
  const button = (label: string, run: () => void) => {
    const element = node("button", "aw-context-control", label);
    element.type = "button";
    motionControl(element);
    element.onclick = run;
    return element;
  };
  const surface = (element: HTMLElement) => {
    element.classList.add("aw-optical-controls");
    element.dataset.awOptics = "workspace";
  };
  return { node, button, surface, motionControl };
}

export function mountContextualResources(
  root: HTMLElement,
  port: ContextualResourcesPort,
) {
  const { node, button, surface, motionControl } = createNodes(root);
  const section = node("section", "aw-contextual-resources"),
    toolbar = node("div", "aw-context-toolbar"),
    query = node("input", "aw-context-search"),
    create = node("details", "aw-context-create"),
    createMenu = node("div", "aw-context-create-menu"),
    status = node("p", "aw-context-count"),
    failure = node("p", "aw-context-error"),
    list = node("ul", "aw-context-resource-list"),
    empty = node("p", "aw-context-empty", "No matching resources."),
    navigation = node("nav", "aw-context-pages"),
    position = node("span");
  surface(section);
  section.setAttribute("aria-label", "Resource browser");
  query.type = "search";
  query.placeholder = "Search resources";
  query.maxLength = 500;
  query.setAttribute("aria-label", "Search resources by title or type");
  motionControl(query);
  status.setAttribute("role", "status");
  failure.setAttribute("role", "alert");
  failure.hidden = true;
  list.setAttribute("aria-label", "Matching resources");
  navigation.setAttribute("aria-label", "Resource results pages");
  const createSummary = node("summary", "aw-context-control", "Create");
  motionControl(createSummary);
  createMenu.setAttribute("role", "group");
  createMenu.setAttribute("aria-label", "Create a standalone resource");
  create.append(createSummary, createMenu);
  create.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !create.open) return;
    event.preventDefault();
    event.stopPropagation();
    create.open = false;
    createSummary.focus();
  });
  section.addEventListener("pointerdown", (event) => {
    if (create.open && !event.composedPath().includes(create))
      create.open = false;
  });
  const actions = (port.actions ?? []).map((action) => {
    const item = button(action.label, () => {
      void run("Could not create the resource.", () => action.run());
    });
    item.dataset.resourceAction = action.id;
    createMenu.append(item);
    return item;
  });
  toolbar.append(query);
  if (actions.length) toolbar.append(create);
  const previous = button("Previous", () => {
    if (!active || disposed || page === 0) return;
    page--;
    update();
  });
  const next = button("Next", () => {
    if (!active || disposed || next.getAttribute("aria-disabled") === "true")
      return;
    page++;
    update();
  });
  navigation.append(previous, position, next);
  section.append(toolbar, status, failure, list, empty, navigation);
  root.append(section);

  type Row = {
    element: HTMLLIElement;
    open: HTMLButtonElement;
    attach: HTMLButtonElement;
    title: HTMLSpanElement;
    kind: HTMLElement;
  };
  const rows = new Map<string, Row>();
  let page = 0,
    committedQuery = "",
    composing = false;
  let active = true,
    pending = false,
    disposed = false;

  function current(id: string) {
    if (!active || disposed || pending) return null;
    const snapshot = port.snapshot();
    const item = snapshot.resources.find(
      (resource) => resource.id === id && resource.visible !== false,
    );
    return item ? { snapshot, item } : null;
  }
  async function run(errorText: string, work: () => void | Promise<void>) {
    if (!active || disposed || pending) return;
    pending = true;
    failure.hidden = true;
    update();
    try {
      await work();
    } catch {
      if (active && !disposed) {
        failure.textContent = errorText;
        failure.hidden = false;
      }
    } finally {
      pending = false;
      update();
    }
  }
  function makeRow(id: string): Row {
    const element = node("li", "aw-context-resource"),
      title = node("span", "aw-context-resource-title"),
      kind = node("small", "aw-context-resource-kind");
    const open = button("", () => {
      if (!current(id)) return;
      void run("Could not open the resource.", () => port.open(id));
    });
    open.classList.add("aw-context-resource-open");
    open.dataset.openResource = id;
    open.append(title, kind);
    const attach = button("Add", () => {
      const entry = current(id);
      if (!entry || !canAttach(entry.snapshot, entry.item)) return;
      void run("Could not add the resource to this workspace.", () =>
        port.attach(id),
      );
    });
    attach.classList.add("aw-context-resource-attach");
    attach.dataset.attach = id;
    element.append(open, attach);
    return { element, title, kind, open, attach };
  }
  function update() {
    if (!active || disposed) return;
    const snapshot = port.snapshot();
    const result = contextualResourcePage(snapshot, committedQuery, page);
    page = result.page;
    const ids = new Set(result.items.map((item) => item.id));
    const focus = root.ownerDocument.activeElement;
    let focusRetired = false;
    let focusFallback: HTMLButtonElement | undefined;
    for (const [id, row] of rows) {
      if (ids.has(id)) continue;
      focusRetired ||= row.element.contains(focus);
      row.element.remove();
      rows.delete(id);
    }
    result.items.forEach((resource, index) => {
      let row = rows.get(resource.id);
      if (!row) {
        row = makeRow(resource.id);
        rows.set(resource.id, row);
      }
      const title = resource.title || "Untitled resource";
      if (row.title.textContent !== title) row.title.textContent = title;
      const kind =
        kindLabel(resource.kind) +
        (resource.available === false ? " · Unavailable" : "");
      if (row.kind.textContent !== kind) row.kind.textContent = kind;
      const attachable = canAttach(snapshot, resource);
      if (!attachable && focus === row.attach) focusFallback = row.open;
      row.attach.hidden = !snapshot.workspaceId;
      row.attach.disabled = !attachable;
      row.attach.setAttribute(
        "aria-label",
        "Add " + title + " to this workspace",
      );
      row.attach.title = attachable
        ? "Add to this workspace"
        : "Workspace placement unavailable";
      row.open.setAttribute("aria-disabled", String(pending));
      row.attach.setAttribute("aria-disabled", String(pending || !attachable));
      const reference = list.children[index] ?? null;
      if (reference !== row.element) list.insertBefore(row.element, reference);
    });
    for (const item of actions)
      item.setAttribute("aria-disabled", String(pending));
    section.setAttribute("aria-busy", String(pending));
    const count =
      result.total === 1 ? "1 resource" : result.total + " resources";
    if (status.textContent !== count) status.textContent = count;
    empty.hidden = result.total !== 0;
    navigation.hidden = result.pages === 1;
    previous.setAttribute("aria-disabled", String(page === 0));
    next.setAttribute("aria-disabled", String(page + 1 >= result.pages));
    position.textContent = page + 1 + " / " + result.pages;
    if (focusRetired || (navigation.hidden && navigation.contains(focus)))
      query.focus({ preventScroll: true });
    else if (focusFallback) focusFallback.focus({ preventScroll: true });
    else if (
      section.contains(focus) &&
      root.ownerDocument.activeElement === root.ownerDocument.body
    )
      (focus as HTMLElement).focus({ preventScroll: true });
  }
  function commitQuery() {
    if (composing || committedQuery === query.value) return;
    committedQuery = query.value;
    page = 0;
    update();
  }
  query.addEventListener("compositionstart", () => {
    composing = true;
  });
  query.addEventListener("compositionend", () => {
    composing = false;
    commitQuery();
  });
  query.addEventListener("input", commitQuery);
  update();
  return {
    update,
    setActive(value: boolean) {
      if (disposed || value === active) return;
      active = value;
      section.inert = !active;
      if (active) update();
      else {
        create.open = false;
        if (composing) {
          composing = false;
          query.value = committedQuery;
        }
      }
    },
    focusSearch() {
      if (active && !disposed) query.focus({ preventScroll: true });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      rows.clear();
      section.remove();
    },
  };
}

export interface ContextualStreamPort {
  snapshot(): EventWindow;
  refresh(): Promise<void>;
  openResource?(id: string): void;
}

/** The same event view as a workspace block, with contextual optics and an
 * explicit retained-only notice. No parallel filtering, replay or event store. */
export function mountContextualStream(
  root: HTMLElement,
  port: ContextualStreamPort,
  options: { active?: boolean } = {},
) {
  const { node, surface, motionControl } = createNodes(root);
  const section = node("div", "aw-contextual-stream"),
    notice = node(
      "p",
      "aw-context-notice",
      "Live connection unavailable · retained records",
    );
  surface(section);
  notice.setAttribute("role", "status");
  notice.hidden = true;
  section.append(notice);
  root.append(section);
  const view = mountEventExperience(
    section,
    {
      snapshot() {
        const window = port.snapshot();
        notice.hidden = !window.disconnected;
        return window;
      },
      refresh: () => port.refresh(),
      ...(port.openResource
        ? { openResource: (id: string) => port.openResource!(id) }
        : {}),
    },
    { active: options.active, presentation: "focused" },
  );
  // Bounded chrome only; recorded rows retain the shared view's native details.
  const search = section.querySelector<HTMLInputElement>(
    ".aw-event-tools > input",
  );
  if (search) search.placeholder = "Search events";
  for (const control of section.querySelectorAll<HTMLElement>(
    ".aw-event-tools > :is(input, button), .aw-event-advanced > summary, .aw-event-about > summary",
  ))
    motionControl(control);
  function present() {
    for (const label of section.querySelectorAll<HTMLElement>(".aw-event-type:not([data-recorded-type])")) {
      const type = label.textContent ?? "";
      const [domain, ...operation] = type.split(/[/.]/);
      const title = (value: string) => value
        .replace(/([a-z\d])([A-Z])/g, "$1 $2")
        .replace(/[-_]+/g, " ")
        .replace(/^./, (initial) => initial.toUpperCase());
      label.dataset.recordedType = type;
      label.title = type;
      if (operation.length) {
        const source = domain === "application" ? "Aerynth" : title(domain);
        label.textContent = title(operation.join(" ")) + " · " + source;
      }
    }
  }
  present();
  return {
    update() {
      view.update();
      present();
    },
    setActive(active: boolean) {
      view.setActive(active);
      if (active) present();
    },
    dispose() {
      view.dispose();
      section.remove();
    },
  };
}
