import type { NonResourceSubjectRef } from "../workspace-kernel/subjects.ts";
import type {
  BrowseResourcesPage,
  ResourceCandidate,
  SubjectExperiencePort,
  BlockKind,
} from "./contracts.ts";
import { BUILTIN_BLOCKS } from "./registry.ts";
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
    sequence = 0,
    cursor: string | null = null;
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
    const filters = node("div", "", "aw-subject-filters");
    filters.append(search, kind, field("No visible placements", unplaced));
    body.append(filters);
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
    search.oninput = () => {
      void load(false);
    };
    kind.onchange = () => {
      void load(false);
    };
    unplaced.onchange = () => {
      void load(false);
    };
  }
  const fail = (error: unknown) => {
    if (!disposed)
      status.textContent =
        error instanceof Error
          ? error.message.replaceAll("_", " ")
          : "This canonical view is unavailable.";
  };
  const appendResources = (page: BrowseResourcesPage, append: boolean) => {
    if (!append) results.replaceChildren();
    results.querySelector(".aw-subject-empty")?.remove();
    for (const resource of page.resources) {
      const row = node("li"),
        title = node("strong", resource.title),
        metadata = node(
          "small",
          resource.kind +
            " · " +
            resource.id +
            " · " +
            resource.placementCount +
            (resource.placementCountComplete ? "" : "+") +
            " visible placements",
        ),
        actions = node("div", "", "aw-subject-actions");
      row.append(title, metadata, actions);
      if (options.openResource)
        actions.append(
          button("Open", () => options.openResource!(resource.id)),
        );
      if (options.attachResource) {
        const attach = button("Attach to workspace", () => {
          attach.disabled = true;
          void options.attachResource!(resource)
            .then(() => {
              if (!disposed)
                status.textContent = "Attached the same canonical resource.";
            })
            .catch(fail)
            .finally(() => {
              if (!disposed) attach.disabled = false;
            });
        });
        actions.append(attach);
      }
      results.append(row);
    }
    if (!results.children.length)
      results.append(
        node("li", "No matching resources on this page.", "aw-subject-empty"),
      );
    cursor = page.nextCursor;
    more.hidden = !cursor;
    status.textContent = cursor
      ? "This page is bounded. Load more to continue searching authorized resources."
      : "Canonical local resources. No external files or providers were searched.";
  };
  async function load(append: boolean) {
    if (!active || disposed) {
      if (!disposed)
        status.textContent = "Open this block to inspect canonical local data.";
      return;
    }
    const request = ++sequence;
    section.setAttribute("aria-busy", "true");
    status.textContent = "Reading canonical local data…";
    try {
      if (subject.kind === "project") {
        const overview = await port.projectOverview(subject.projectId),
          resourcePage = await port.browseResources({ subject, limit: 10 });
        if (disposed || !active || request !== sequence) return;
        body.replaceChildren();
        body.append(
          node("h3", overview.project.title),
          node(
            "p",
            overview.tasks.open +
              " open tasks · " +
              overview.tasks.done +
              " completed locally",
          ),
          node(
            "p",
            Object.entries(overview.resourcesByKind)
              .map(([kind, count]) => count + " " + kind)
              .join(" · ") ||
              "No accessible registered resources in this project.",
          ),
        );
        if (!overview.resourceCountsComplete)
          body.append(
            node("p", "Resource counts are partial.", "aw-subject-hint"),
          );
        body.append(node("h4", "Workspaces"));
        const workspaces = node("ul");
        for (const workspace of overview.workspaces) {
          const row = node("li");
          row.append(
            options.openWorkspace
              ? button(workspace.title, () =>
                  options.openWorkspace!(workspace.id),
                )
              : node("span", workspace.title),
          );
          workspaces.append(row);
        }
        if (!workspaces.children.length)
          workspaces.append(node("li", "No accessible active workspaces."));
        body.append(workspaces);
        if (!overview.workspaceListComplete)
          body.append(
            node("p", "Workspace list is bounded.", "aw-subject-hint"),
          );
        body.append(node("h4", "Recent recorded local changes"));
        const events = node("ol");
        for (const event of overview.recentEvents) {
          const row = node("li", event.type),
            time = node("small", event.occurredAt + " · " + event.entityKind);
          row.append(time);
          events.append(row);
        }
        if (!events.children.length)
          events.append(
            node("li", "No recent recorded changes in this bounded view."),
          );
        body.append(events, node("h4", "Project resources"), results);
        appendResources(resourcePage, false);
        if (resourcePage.nextCursor)
          body.append(
            node(
              "p",
              "Showing the first accessible resource page. Use a Resource Browser for full discovery.",
              "aw-subject-hint",
            ),
          );
        status.textContent =
          "Counts describe canonical local state. Task completion is separate from verified execution.";
      } else {
        const page = await port.browseResources({
          subject,
          query: search.value,
          ...(kind.value ? { kind: kind.value as BlockKind } : {}),
          unplacedOnly: unplaced.checked,
          ...(append && cursor ? { afterId: cursor } : {}),
        });
        if (disposed || !active || request !== sequence) return;
        appendResources(page, append);
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
    setActive(value: boolean) {
      if (active === value) return;
      active = value;
      sequence++;
      section.removeAttribute("aria-busy");
      if (active) void load(false);
    },
    dispose() {
      disposed = true;
      sequence++;
      section.remove();
    },
  };
}
