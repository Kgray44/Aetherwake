import type { NonResourceSubjectRef } from "../workspace-kernel/subjects.ts";
import type {
  BrowseResourcesPage,
  ResourceCandidate,
  SubjectExperiencePort,
  BlockKind,
} from "./contracts.ts";
import { BUILTIN_BLOCKS } from "./registry.ts";
import type { SubjectIdentity } from "./identity-model.ts";
const node = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = "",
  className = "",
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  element.textContent = text;
  element.className = className;
  return element;
};
const button = (label: string, run: () => void) => {
  const element = node("button", label, "aw-subject-action");
  element.type = "button";
  element.onclick = run;
  return element;
};
const field = (label: string, input: HTMLElement) => {
  const element = node("label", label);
  element.append(input);
  return element;
};

/** Actual project/collection/query projections. No independent store, provider, renderer or timer loop. */
export function mountSubjectExperience(
  root: HTMLElement,
  subject: NonResourceSubjectRef,
  port: SubjectExperiencePort,
  options: {
    active?: boolean;
    visible?: boolean;
    presentation?: "workspace" | "focused";
    onProjection?(projection: SubjectIdentity): void;
    openWorkspace?(workspaceId: string): void;
    openResource?(resourceId: string): void;
    openRelated?(resourceId: string, anchor: HTMLElement): void | Promise<void>;
    attachResource?(resource: ResourceCandidate): Promise<void>;
  },
) {
  const section = node("section", "", "aw-subject-view"),
    route = node('h3', subject.kind === 'project' ? 'Project hub' : subject.kind === 'collection' ? 'Collection shelf' : 'Resource index', 'aw-subject-route'),
    inventory = node('p', '', 'aw-subject-inventory'),
    facets = node('nav', '', 'aw-subject-kind-navigation'),
    status = node("p", "", "aw-subject-status"),
    body = node("div"),
    refresh = button("Refresh", () => {
      void load(false);
    });
  section.dataset.presentation = options.presentation ?? "focused";
  section.dataset.subjectKind = subject.kind;
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  section.setAttribute(
    "aria-label",
    subject.kind === "project"
      ? "Project overview"
      : subject.kind === "collection"
        ? "Resource Explorer — Collection"
        : "Resource Explorer — Resources",
  );
  facets.setAttribute('aria-label', subject.kind === 'project' ? 'Project resource structure' : 'Resource kinds in loaded results');
  section.append(route, refresh, inventory, facets, status, body);
  root.append(section);
  let disposed = false,
    active = options.active ?? true,
    visible = options.visible ?? false,
    sequence = 0,
    cursor: string | null = null;
  let latestPage: BrowseResourcesPage | null = null;
  let queryTimer: ReturnType<typeof setTimeout> | undefined;
  const search = node("input"),
    kind = node("select"),
    unplaced = node("input"),
    results = node("ul", "", "aw-subject-resources"),
    more = button("Load more", () => {
      void load(true);
    });
  search.type = "search";
  search.maxLength = 500;
  search.placeholder = "Search resources";
  search.setAttribute("aria-label", "Search resources");
  kind.setAttribute("aria-label", "Resource kind");
  unplaced.type = "checkbox";
  if (subject.kind !== "project") {
    const scope = subject.kind === 'collection' ? 'Collection membership'
      : subject.collectionId ? 'Saved search within a collection'
      : subject.projectId ? 'Project resources' : 'All authorized resources';
    section.dataset.explorerScope = subject.kind === 'collection' ? 'collection' : subject.collectionId ? 'collection-query' : subject.projectId ? 'project' : 'all';
    body.append(node('p', scope, 'aw-subject-hint'));
    const all = node("option", "All resource kinds");
    all.value = "";
    kind.append(all);
    for (const definition of BUILTIN_BLOCKS) {
      const option = node("option", definition.title);
      option.value = definition.kind;
      kind.append(option);
    }
    const tools = node("div", "", "aw-subject-tools"),
      filters = node("details", "", "aw-subject-filter-menu"),
      filterBody = node("div", "", "aw-subject-filters");
    filters.append(node("summary", "Filters"), filterBody);
    filterBody.append(kind, field("No visible placements", unplaced));
    tools.append(search, filters);
    body.append(tools);
    if (
      subject.kind === "resource-query" &&
      (subject.query || subject.kinds?.length)
    )
      body.append(
        node(
          "p",
          "Saved scope: " +
            (subject.query || "all titles") +
            (subject.kinds?.length ? " · " + subject.kinds.join(", ") : ""),
          "aw-subject-hint",
        ),
      );
    body.append(results, more);
    more.hidden = true;
    search.oninput = () => scheduleSearch();
    kind.onchange = () => {
      void load(false);
    };
    unplaced.onchange = () => {
      void load(false);
    };
  }
  const rows = new Map<
    string,
    {
      row: HTMLLIElement;
      title: HTMLElement;
      metadata: HTMLElement;
      address: HTMLElement;
      kind: HTMLElement;
      resource: BrowseResourcesPage['resources'][number];
      attach?: HTMLButtonElement;
      related?: HTMLButtonElement;
    }
  >();
  const workspaceRows = new Map<
    string,
    { row: HTMLLIElement; title: HTMLElement; workspaceId: string }
  >();
  const facetNodes = new Map<string, HTMLElement>();
  const allKinds = button('All kinds', () => { if (active && !disposed) { kind.value = ''; void load(false); } });
  allKinds.className += ' aw-subject-facet';
  const paintFacets = (counts: [string, number][], project = false) => {
    if (!project && allKinds.parentElement !== facets) facets.prepend(allKinds);
    allKinds.setAttribute('aria-pressed', String(!kind.value));
    const live = new Set(counts.map(([key]) => key));
    for (const [key, element] of facetNodes) if (!live.has(key)) { element.remove(); facetNodes.delete(key); }
    for (const [key, count] of counts) {
      let element = facetNodes.get(key);
      if (!element) {
        element = project ? node('span', '', 'aw-subject-facet') : button('', () => { if (active && !disposed) { kind.value = key; void load(false); } });
        element.className = 'aw-subject-action aw-subject-facet'; element.dataset.facetKind = key; facetNodes.set(key, element); facets.append(element);
      }
      element.textContent = (BUILTIN_BLOCKS.find(definition => definition.kind === key)?.title ?? key) + ' · ' + count;
      if (!project) element.setAttribute('aria-pressed', String(kind.value === key));
    }
  };
  const projectMetrics = node("dl", "", "aw-project-metrics"),
    workspaceCount = node("dd"), resourceCount = node("dd"),
    projectSummary = node("p", "", "aw-project-summary"),
    projectCounts = node("p", "", "aw-project-counts"),
    projectHint = node("p", "", "aw-subject-hint"),
    workspaces = node("ul", "", "aw-project-workspaces"),
    projectMore = node("details", "", "aw-project-details"),
    events = node("ol"),
    scopeTitle = node("p", "", "aw-subject-scope");
  if (subject.kind === "project") {
    for (const [title, value] of [["Workspaces", workspaceCount], ["Resources", resourceCount]] as const) {
      const metric = node("div");
      metric.append(node("dt", title), value);
      projectMetrics.append(metric);
    }
    projectMetrics.hidden = true;
    projectMore.append(
      node("summary", "Resources and recent changes"),
      projectCounts,
      projectHint,
      node("h4", "Recent changes"),
      events,
      node("h4", "Resources"),
      results,
    );
    body.append(
      projectMetrics,
      projectSummary,
      node("h4", "Workspaces"),
      workspaces,
      projectMore,
    );
  } else body.insertBefore(scopeTitle, body.firstChild);
  function scheduleSearch() {
    clearTimeout(queryTimer);
    if (active || visible)
      queryTimer = setTimeout(() => {
        void load(false);
      }, 160);
  }
  const fail = (error: unknown) => {
    if (!disposed) {
      latestPage = null;
      rows.clear();
      results.replaceChildren();
      inventory.textContent = ''; facets.replaceChildren(); facetNodes.clear();
      if (subject.kind === "project") {
        workspaceRows.clear();
        workspaces.replaceChildren();
        events.replaceChildren();
        projectSummary.textContent = "Project unavailable";
        projectMetrics.hidden = true;
        workspaceCount.textContent = resourceCount.textContent = "";
        projectCounts.textContent = "";
        projectHint.textContent = "";
      }
      status.textContent =
        error instanceof Error
          ? error.message.replaceAll("_", " ")
          : "This canonical view is unavailable.";
      options.onProjection?.({
        phase: "unavailable",
        message: "This canonical view could not be read. Open it to retry.",
      });
    }
  };
  const appendResources = (page: BrowseResourcesPage, append: boolean) => {
    const ids = new Set(page.resources.map((resource) => resource.id));
    if (!append)
      for (const [id, item] of rows)
        if (!ids.has(id)) {
          item.row.remove();
          rows.delete(id);
        }
    results.querySelector(".aw-subject-empty")?.remove();
    for (const resource of page.resources) {
      let item = rows.get(resource.id);
      if (!item) {
        const row = node("li"),
          title = options.openResource
            ? button(resource.title, () => {
                if (active && !disposed && rows.has(resource.id))
                  options.openResource!(resource.id);
              })
            : node("strong", resource.title),
          metadata = node("small"),
          kind = node("span", "", "aw-subject-kind"),
          address = node("code"),
          details = node("details", "", "aw-subject-resource-details"),
          actions = node("div", "", "aw-subject-actions");
        title.className = "aw-subject-resource-title";
        row.dataset.resourceId = resource.id;
        details.append(node("summary", "Details"), address);
        kind.setAttribute("aria-hidden", "true");
        row.append(kind, title, metadata, actions, details);
        item = { row, title, metadata, address, kind, resource };
        rows.set(resource.id, item);
        if (options.attachResource) {
          const attach = button("Attach", () => {
            const current = rows.get(resource.id)?.resource;
            if (!current || !active || disposed || attach.disabled) return;
            attach.disabled = true;
            void options.attachResource!(current)
              .then(() => {
                if (!disposed && active)
                  status.textContent = "Attached to workspace.";
              })
              .catch(fail)
              .finally(() => {
                if (!disposed) attach.disabled = false;
              });
          });
          attach.setAttribute(
            "aria-label",
            "Attach " + resource.title + " to workspace",
          );
          actions.append(attach);
          item.attach = attach;
        }
        if (options.openRelated) {
          const related = button("Related resources", () => {
            const current = rows.get(resource.id);
            if (!current || !active || disposed || related.disabled) return;
            related.disabled = true;
            void Promise.resolve()
              .then(() => {
                if (!disposed && active && rows.get(resource.id)?.related === related)
                  return options.openRelated!(current.resource.id, related);
              })
              .catch(() => {
                if (!disposed && active && rows.get(resource.id)?.related === related)
                  status.textContent = "Related resources could not be opened. Your current view is retained.";
              })
              .finally(() => {
                if (!disposed && rows.get(resource.id)?.related === related)
                  related.disabled = false;
              });
          });
          related.classList.add("aw-subject-related");
          details.append(related);
          item.related = related;
        }
      }
      item.resource = resource;
      item.row.dataset.resourceKind = resource.kind;
      item.kind.textContent = ({ timeline: 'TIMELINE', task_objective: 'OBJECTIVE', clock_timer: 'CLOCK & TIMER', agent: 'AGENT', conversation: "CHAT", note: "NOTE", task: "MANUAL", task_group: "MANUAL GROUP", checklist: 'CHECKLIST', stream: "FEED", research: "NOTEBOOK", reference: "REF", file: 'FILE', folder:'FOLDER', link: 'LINK' } as const)[resource.kind];
      item.kind.setAttribute('aria-label', BUILTIN_BLOCKS.find(definition => definition.kind === resource.kind)?.title ?? resource.kind);
      item.title.textContent = resource.title;
      if (options.openResource)
        item.title.setAttribute("aria-label", "Open " + resource.title);
      item.metadata.textContent =
        resource.kind.replaceAll("_", " ") +
        " · " +
        resource.placementCount +
        (resource.placementCountComplete ? "" : "+") +
        " placements";
      item.address.textContent = resource.id;
      item.attach?.setAttribute("aria-label", "Attach " + resource.title + " to workspace");
      item.related?.setAttribute("aria-label", "Related resources for " + resource.title);
    }
    // Keep unchanged rows mounted (including an open Details disclosure and focus).
    const ordered = append
      ? [...rows.keys()]
      : page.resources.map((resource) => resource.id);
    ordered.forEach((id, index) => {
      const row = rows.get(id)!.row,
        current = results.children[index];
      if (current !== row) results.insertBefore(row, current ?? null);
    });
    if (!rows.size)
      results.append(node("li", "No matching resources.", "aw-subject-empty"));
    scopeTitle.textContent = page.scopeTitle ?? "";
    if (subject.kind !== 'project') {
      const resources = [...rows.values()].map(row => row.resource), counts = new Map<string, number>();
      for (const resource of resources) counts.set(resource.kind, (counts.get(resource.kind) ?? 0) + 1);
      paintFacets([...counts]);
      inventory.textContent = resources.length + (subject.kind === 'collection' ? ' loaded members' : ' loaded resources') +
        ' · ' + resources.filter(resource => resource.placementCount === 0 && resource.placementCountComplete).length + ' with no visible placements' +
        (page.nextCursor ? ' · more available' : '') + (resources.some(resource => !resource.placementCountComplete) ? ' · some placement counts are bounded' : '');
    }
    cursor = page.nextCursor;
    more.hidden = !cursor;
    status.textContent = cursor
      ? "More resources available."
      : rows.size + " resources shown.";
  };
  async function load(append: boolean) {
    if ((!active && !visible) || disposed) {
      if (!disposed)
        status.textContent = "Open this block to inspect canonical local data.";
      return;
    }
    const request = ++sequence;
    options.onProjection?.({ phase: "loading" });
    section.setAttribute("aria-busy", "true");
    status.textContent = "Reading canonical local data…";
    try {
      if (subject.kind === "project") {
        const overview = await port.projectOverview(subject.projectId),
          resourcePage =
            active && !disposed && request === sequence
              ? await port.browseResources({ subject, limit: 10 })
              : null;
        if (disposed || (!active && !visible) || request !== sequence) return;
        options.onProjection?.({ phase: "ready", kind: "project", overview });
        if (!active) return;
        projectMetrics.hidden = false;
        workspaceCount.textContent = String(overview.workspaces.length) + (overview.workspaceListComplete ? "" : "+");
        resourceCount.textContent = String(Object.values(overview.resourcesByKind).reduce((sum, value) => sum + (value ?? 0), 0)) + (overview.resourceCountsComplete ? "" : "+");
        workspaceCount.setAttribute("aria-label", `${overview.workspaces.length}${overview.workspaceListComplete ? "" : " or more"} accessible workspaces`);
        resourceCount.setAttribute("aria-label", `${resourceCount.textContent!.replace("+", " or more")} accessible resources`);
        projectSummary.textContent =
          overview.tasks.open +
          " open · " +
          overview.tasks.done +
          " done" +
          (overview.resourceCountsComplete ? "" : " · partial counts");
        inventory.textContent = 'Project → ' + overview.workspaces.length + (overview.workspaceListComplete ? '' : '+') + ' accessible workspaces → resources. Task counts are manual states.';
        paintFacets(Object.entries(overview.resourcesByKind).map(([key, count]) => [key, count ?? 0]), true);
        projectCounts.textContent =
          Object.entries(overview.resourcesByKind)
            .map(([kind, count]) => count + " " + kind.replaceAll("_", " "))
            .join(" · ") || "No accessible resources.";
        projectHint.textContent = [
          !overview.resourceCountsComplete
            ? "Resource counts are partial."
            : "",
          !overview.workspaceListComplete ? "Workspace list is bounded." : "",
          resourcePage?.nextCursor
            ? "Showing the first resource page. Use a Resource Browser for more."
            : "",
        ]
          .filter(Boolean)
          .join(" ");
        const ids = new Set(
          overview.workspaces.map((workspace) => workspace.id),
        );
        for (const [id, item] of workspaceRows)
          if (!ids.has(id)) {
            item.row.remove();
            workspaceRows.delete(id);
          }
        workspaces.querySelector(".aw-subject-empty")?.remove();
        overview.workspaces.forEach((workspace, index) => {
          let item = workspaceRows.get(workspace.id);
          if (!item) {
            const row = node("li"),
              title = options.openWorkspace
                ? button(workspace.title, () => {
                    if (active && !disposed && workspaceRows.has(workspace.id))
                      options.openWorkspace!(workspace.id);
                  })
                : node("span", workspace.title);
            row.dataset.workspaceId = workspace.id;
            row.append(title);
            item = { row, title, workspaceId: workspace.id };
            workspaceRows.set(workspace.id, item);
          }
          item.title.textContent = workspace.title;
          const current = workspaces.children[index];
          if (current !== item.row)
            workspaces.insertBefore(item.row, current ?? null);
        });
        if (!workspaceRows.size)
          workspaces.append(
            node("li", "No accessible workspaces.", "aw-subject-empty"),
          );
        events.replaceChildren();
        for (const event of overview.recentEvents) {
          const row = node("li", event.type);
          row.append(
            node("small", event.occurredAt + " · " + event.entityKind),
          );
          events.append(row);
        }
        if (!events.children.length)
          events.append(node("li", "No recent recorded changes."));
        if (resourcePage) {
          latestPage = resourcePage;
          appendResources(resourcePage, false);
        }
        status.textContent = overview.workspaces.length + " workspaces shown.";
      } else {
        const requestedQuery = search.value;
        const page = await port.browseResources({
          subject,
          query: requestedQuery,
          ...(kind.value ? { kind: kind.value as BlockKind } : {}),
          unplacedOnly: unplaced.checked,
          limit: active ? 30 : 4,
          ...(append && cursor ? { afterId: cursor } : {}),
        });
        if (disposed || (!active && !visible) || request !== sequence) return;
        latestPage = page;
        options.onProjection?.({
          phase: "ready",
          kind: "browser",
          page,
          query: requestedQuery,
        });
        if (active) appendResources(page, append);
      }
    } catch (error) {
      if (request === sequence) fail(error);
    } finally {
      if (!disposed && request === sequence)
        section.removeAttribute("aria-busy");
    }
  }
  void load(false);
  return {
    refresh: () => load(false),
    setPresentation(value: "workspace" | "focused") {
      section.dataset.presentation = value;
    },
    setActive(value: boolean) {
      if (active === value) return;
      active = value;
      sequence++;
      section.removeAttribute("aria-busy");
      if (active || visible) void load(false);
    },
    setVisible(value: boolean) {
      if (visible === value) return;
      visible = value;
      if (visible && !active) void load(false);
      else if (!active) {
        sequence++;
        clearTimeout(queryTimer);
        section.removeAttribute("aria-busy");
      }
    },
    search(query: string) {
      search.value = query.slice(0, 500);
      scheduleSearch();
    },
    async attach(resourceId: string) {
      const resource = latestPage?.resources.find(
        (resource) => resource.id === resourceId,
      );
      if (!resource || !options.attachResource)
        throw new Error("resource_attachment_unavailable");
      await options.attachResource(resource);
    },
    dispose() {
      disposed = true;
      clearTimeout(queryTimer);
      sequence++;
      section.remove();
    },
  };
}
