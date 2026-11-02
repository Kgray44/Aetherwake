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
    attachResource?(resource: ResourceCandidate): Promise<void>;
  },
) {
  const section = node("section", "", "aw-subject-view"),
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
        ? "Collection browser"
        : "Resource browser",
  );
  section.append(refresh, status, body);
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
  search.placeholder = "Search resource titles and IDs";
  search.setAttribute("aria-label", "Search canonical resources");
  kind.setAttribute("aria-label", "Resource kind");
  unplaced.type = "checkbox";
  if (subject.kind !== "project") {
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
      resource: ResourceCandidate;
    }
  >();
  const workspaceRows = new Map<
    string,
    { row: HTMLLIElement; title: HTMLElement; workspaceId: string }
  >();
  const projectSummary = node("p", "", "aw-project-summary"),
    projectCounts = node("p", "", "aw-project-counts"),
    projectHint = node("p", "", "aw-subject-hint"),
    workspaces = node("ul", "", "aw-project-workspaces"),
    projectMore = node("details", "", "aw-project-details"),
    events = node("ol"),
    scopeTitle = node("p", "", "aw-subject-scope");
  if (subject.kind === "project") {
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
      if (subject.kind === "project") {
        workspaceRows.clear();
        workspaces.replaceChildren();
        events.replaceChildren();
        projectSummary.textContent = "Project unavailable";
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
          address = node("code"),
          details = node("details", "", "aw-subject-resource-details"),
          actions = node("div", "", "aw-subject-actions");
        title.className = "aw-subject-resource-title";
        row.dataset.resourceId = resource.id;
        details.append(node("summary", "Details"), address);
        row.append(title, metadata, actions, details);
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
        }
        item = { row, title, metadata, address, resource };
        rows.set(resource.id, item);
      }
      item.resource = resource;
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
        projectSummary.textContent =
          overview.tasks.open +
          " open · " +
          overview.tasks.done +
          " done" +
          (overview.resourceCountsComplete ? "" : " · partial counts");
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
