import {
  mountEventExperience,
  type EventWindow,
} from "../../../block-library/event-view.ts";
import type { ExperienceMotionPort } from '../../../application-contract/motion.ts';

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
  workspaceResourceIds?: readonly string[];
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
const categories = [
  { label: "Conversations", kinds: ["conversation"] },
  { label: "Knowledge", kinds: ["note", "research", "reference", "link"] },
  { label: "Files", kinds: ["document", "file", "video", "audio", "image"] },
  { label: "Folders", kinds: ["folder", "directory"] },
  { label: "Planning", kinds: ["checklist", "task_objective", "task", "task_group", "timeline", "workflow"] },
  { label: "Intelligence", kinds: ["agent", "stream"] },
  { label: "Other resources", kinds: [] },
] as const;
const categoryIndex = (kind: string) => {
  const index = categories.findIndex((category) =>
    category.kinds.some((candidate) => candidate === kind),
  );
  return index === -1 ? categories.length - 1 : index;
};
const kindNames: Readonly<Partial<Record<string, string>>> = {
  research: "Research Notebook",
  task: "Manual task",
  task_group: "Manual task group",
  stream: "Intelligence Stream",
};
const kindLabel = (kind: string) => kindNames[kind] ??
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
    const searchable = [resource.title, resource.kind, kindLabel(resource.kind), categories[categoryIndex(resource.kind)].label]
      .join(" ")
      .toLocaleLowerCase();
    return terms.every((term) => searchable.includes(term));
  }).sort((left, right) => categoryIndex(left.kind) - categoryIndex(right.kind));
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
    list = node("div", "aw-context-resource-list"),
    empty = node("p", "aw-context-empty", "No matching resources."),
    navigation = node("nav", "aw-context-pages"),
    position = node("span");
  const sourceScope=node('nav','aw-context-source-scope');sourceScope.setAttribute('aria-label','Source scope');
  let showingWorkspace=!!port.snapshot().workspaceId&&port.snapshot().workspaceResourceIds!==undefined;
  const thisWorkspace=button('Workspace sources',()=>{showingWorkspace=true;page=0;update();});
  const allSources=button('All sources',()=>{showingWorkspace=false;page=0;update();});
  sourceScope.append(thisWorkspace,allSources);
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
  list.setAttribute("role", "group");
  list.setAttribute("aria-label", "Resources by category");
  const groups = categories.map(({ label }) => {
    const disclosure = node("details", "aw-context-resource-group");
    const summary = node("summary", "aw-context-group-heading");
    const heading = node("span", "", label);
    const count = node("span", "aw-context-group-count");
    const items = node("ul", "aw-context-group-items");
    motionControl(summary);
    disclosure.open = true;
    summary.append(heading, count);
    disclosure.append(summary, items);
    list.append(disclosure);
    return { disclosure, summary, count, items };
  });
  navigation.setAttribute("aria-label", "Resource results pages");
  const createSummary = node("summary", "aw-context-control", "+");
  createSummary.setAttribute('aria-label','Add sources');createSummary.title='Add sources';
  create.dataset.resourcesAdd='true';surface(create);
  motionControl(createSummary);
  createMenu.setAttribute("role", "group");
  createMenu.setAttribute("aria-label", "Add sources");
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
      create.open=false;
      void run("Could not create the resource.", () => action.run());
    });
    item.dataset.resourceAction = action.id;
    createMenu.append(item);
    return item;
  });
  toolbar.append(query);
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
  section.append(sourceScope,toolbar, status, failure, list, empty, navigation);
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
    const supportsWorkspace=!!snapshot.workspaceId&&snapshot.workspaceResourceIds!==undefined;
    sourceScope.hidden=!supportsWorkspace;if(!supportsWorkspace)showingWorkspace=false;
    thisWorkspace.setAttribute('aria-pressed',String(showingWorkspace));allSources.setAttribute('aria-pressed',String(!showingWorkspace));
    const included=new Set(snapshot.workspaceResourceIds??[]);
    const scoped=showingWorkspace?{...snapshot,resources:snapshot.resources.filter(resource=>included.has(resource.id))}:snapshot;
    const result = contextualResourcePage(scoped, committedQuery, page);
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
    const counts = groups.map(() => 0);
    result.items.forEach((resource) => {
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
      const alreadyAdded=included.has(resource.id);row.attach.disabled = !attachable||alreadyAdded;
      row.attach.textContent=alreadyAdded?'Added':'Add';
      row.attach.setAttribute(
        "aria-label",
        "Add " + title + " to this workspace",
      );
      row.attach.title = attachable
        ? "Add to this workspace"
        : "Workspace placement unavailable";
      row.open.setAttribute("aria-disabled", String(pending));
      row.attach.setAttribute("aria-disabled", String(pending || !attachable||alreadyAdded));
      const category = categoryIndex(resource.kind);
      const items = groups[category].items;
      const reference = items.children[counts[category]++] ?? null;
      if (reference !== row.element) items.insertBefore(row.element, reference);
    });
    groups.forEach((group, index) => {
      const count = counts[index];
      if (!count && group.disclosure.contains(focus)) focusRetired = true;
      const sourceCategory=categories[index].label==='Files'||categories[index].label==='Folders';
      group.disclosure.hidden = count === 0 && (!sourceCategory || !!committedQuery.trim());
      if (group.count.textContent !== String(count)) group.count.textContent = String(count);
    });
    for (const item of actions)
      item.setAttribute("aria-disabled", String(pending));
    section.setAttribute("aria-busy", String(pending));
    const count = showingWorkspace ? result.total+' '+(result.total===1?'source':'sources')+' in this workspace' : result.total === 1 ? "1 resource" : result.total + " resources";
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
    const startSearch = !committedQuery.trim() && !!query.value.trim();
    committedQuery = query.value;
    if (startSearch) for (const group of groups) group.disclosure.open = true;
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
    addMenu: actions.length?create:undefined,
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
    focusSearch(all=false) {
      if(all){showingWorkspace=false;page=0;update();}
      if (active && !disposed) query.focus({ preventScroll: true });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      rows.clear();
      create.remove();
      section.remove();
    },
  };
}

export interface ContextualStreamPort {
  snapshot(): EventWindow;
  refresh(): Promise<void>;
  openResource?(id: string): void;
  openMission?(id: string): void;
}

/** The same event view as a workspace block, with contextual optics and an
 * explicit retained-only notice. No parallel filtering, replay or event store. */
export function mountContextualStream(
  root: HTMLElement,
  port: ContextualStreamPort,
  options: { active?: boolean; motion?: ExperienceMotionPort; viewId?: string } = {},
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
      ...(port.openMission ? { openMission: (id: string) => port.openMission!(id) } : {}),
    },
    { active: options.active, presentation: "focused", motion: options.motion, viewId: options.viewId },
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
    frame() { view.frame(); },
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
