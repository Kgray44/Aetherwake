import {
  resourceLinks,
  removableResourceLink,
  confirmsResourceLinkChange,
  USER_LINK_KINDS,
  type ResourceLinksSnapshot,
  type ResourceLinksPort,
  type ResourceLinkAction,
  type UserLinkKind,
} from "./resource-links.ts";
const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = "",
  className = "",
) => {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
};
const button = (label: string, run: () => void) => {
  const node = element("button", label);
  node.type = "button";
  node.onclick = run;
  return node;
};
const labels: Record<UserLinkKind, string> = {
  references: "References",
  depends_on: "Depends on",
  related_to: "Related to",
};

/** Contextual local relationship view. The existing host owns all policy,
 * persistence and navigation; no new database, provider, timer or renderer. */
export function mountResourceLinks(
  root: HTMLElement,
  resourceId: string,
  port: ResourceLinksPort,
) {
  const section = element("section", "", "aw-resource-links"),
    header = element("header", "", "aw-resource-links-header"),
    heading = element("h3", "Related resources"),
    help = element("details", "", "aw-resource-links-help"),
    helpSummary = element("summary", "About links"),
    description = element(
      "p",
      "Links connect saved resources without copying content or changing permissions.",
    ),
    search = element("input"),
    status = element("p", "", "aw-resource-links-status"),
    capacity = element("p", "", "aw-resource-links-capacity"),
    list = element("ul", "", "aw-resource-links-list"),
    creation = element("details", "", "aw-resource-links-create-toggle"),
    createSummary = element("summary", "Add link"),
    form = element("form", "", "aw-resource-links-create"),
    target = element("select"),
    kind = element("select"),
    add = element("button", "Add link"),
    refreshButton = button("Refresh", () => {
      void refresh();
    });
  section.setAttribute("aria-label", "Related resources");
  section.dataset.resourceId = resourceId;
  section.setAttribute("data-no-card-drag", "");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  search.type = "search";
  search.maxLength = 500;
  search.placeholder = "Find linked resources or a resource to add…";
  search.setAttribute("aria-label", "Find related resources");
  refreshButton.className = "aw-resource-links-refresh";
  target.setAttribute("aria-label", "Resource to link");
  target.required = true;
  kind.setAttribute("aria-label", "Relationship type");
  for (const value of USER_LINK_KINDS) {
    const option = element("option", labels[value]);
    option.value = value;
    kind.append(option);
  }
  kind.value = "related_to";
  add.type = "submit";
  form.append(target, kind, add);
  creation.append(createSummary, form);
  help.append(helpSummary, description);
  header.append(heading, refreshButton);
  section.append(
    header,
    search,
    status,
    list,
    capacity,
    creation,
    help,
  );
  root.append(section);
  let snapshot: ResourceLinksSnapshot | null = null,
    sequence = 0,
    disposed = false,
    pending = false,
    uncertain = false,
    composing = false,
    query = "",
    interactionRevision = 0;
  type Status = "idle" | "progress" | "success" | "notice" | "uncertain" | "error";
  const message = (text: string, state: Status = "notice") => {
    if (disposed) return;
    status.dataset.state = state;
    status.textContent = text;
  };
  // Only move changed children. Refreshing metadata must not detach a focused row
  // or replace a select/input being used by the owner.
  const reconcile = (parent: HTMLElement, children: HTMLElement[]) => {
    const keep = new Set(children);
    for (const child of Array.from(parent.children))
      if (!keep.has(child as HTMLElement)) child.remove();
    children.forEach((child, index) => {
      if (parent.children[index] !== child)
        parent.insertBefore(child, parent.children[index] ?? null);
    });
  };
  const rows = new Map<string, {
    row: HTMLLIElement;
    title: HTMLElement;
    detail: HTMLElement;
    remove?: HTMLButtonElement;
  }>();
  const options = new Map<string, HTMLOptionElement>(),
    placeholder = element("option", "Choose a resource"),
    empty = element("li", "No matching links in the current view.", "aw-resource-links-empty");
  placeholder.value = "";
  target.append(placeholder);
  const controls = () => {
    const source = snapshot && resourceLinks(snapshot, resourceId).source;
    target.disabled = kind.disabled =
      pending ||
      uncertain ||
      !source ||
      !port.change ||
      !port.capabilities.relate;
    // Keep the submitting button's native focus while a request is pending.
    // The mutation guard also rejects repeat input; aria-disabled reports that
    // state without forcing focus onto the document body.
    add.disabled = uncertain || !source || !port.change ||
      !port.capabilities.relate || !target.value;
    add.setAttribute("aria-disabled", String(pending || add.disabled));
    refreshButton.disabled = pending;
    for (const control of list.querySelectorAll<HTMLButtonElement>(
      "[data-remove-link]",
    )) {
      control.disabled = uncertain;
      control.setAttribute("aria-disabled", String(pending || uncertain));
    }
  };
  const render = () => {
    if (disposed) return;
    const projection = snapshot
      ? resourceLinks(snapshot, resourceId, query)
      : null;
    const chosen = target.value;
    if (!projection?.source) {
      heading.textContent = "Related resources";
      reconcile(list, []);
      reconcile(target, [placeholder]);
      rows.clear();
      options.clear();
      capacity.textContent = "";
      target.value = "";
      controls();
      if (snapshot)
        message("This resource is unavailable. Its saved links are retained.");
      return;
    }
    heading.textContent = projection.source.title;
    // Keep an authorized selection while the owner changes the search query.
    // A permission revocation still removes it through the same projection.
    const candidates = [...projection.candidates];
    const selected = chosen && snapshot
      ? resourceLinks(snapshot, resourceId, chosen).candidates.find(resource => resource.id === chosen)
      : undefined;
    if (selected && !candidates.some(resource => resource.id === chosen))
      candidates.push(selected);
    const nextOptions = candidates.map(resource => {
      let option = options.get(resource.id);
      if (!option) {
        option = element("option");
        option.value = resource.id;
        options.set(resource.id, option);
      }
      const label = resource.title + " · " + resource.kind.replaceAll("_", " ");
      if (option.textContent !== label) option.textContent = label;
      return option;
    });
    reconcile(target, [placeholder, ...nextOptions]);
    for (const id of options.keys()) {
      if (!candidates.some(resource => resource.id === id)) options.delete(id);
    }
    target.value = selected ? chosen : "";
    const nextRows: HTMLLIElement[] = [];
    for (const edge of projection.links) {
      let entry = rows.get(edge.id);
      if (!entry) {
        entry = {
          row: element("li"),
          title: port.openResource ? button("", () => {}) : element("strong"),
          detail: element("small"),
        };
        entry.title.className = "aw-resource-links-target";
        entry.row.dataset.relationshipId = edge.id;
        entry.row.append(entry.title, entry.detail);
        rows.set(edge.id, entry);
      }
      const { row, title, detail } = entry;
      if (title.textContent !== edge.resource.title) title.textContent = edge.resource.title;
      if (port.openResource)
        title.onclick = () => port.openResource!(edge.resource.id);
      const detailText =
          (edge.direction === "incoming" ? "Incoming · " : "Outgoing · ") +
            (USER_LINK_KINDS.includes(edge.kind as UserLinkKind)
              ? labels[edge.kind as UserLinkKind]
              : edge.kind.replaceAll("_", " ")) +
            " · " +
            edge.provenance;
      if (detail.textContent !== detailText) detail.textContent = detailText;
      if (edge.removable && port.change && port.capabilities.unrelate) {
        const remove = entry.remove ??= button("Remove link", () => {
          void change({ type: "unrelate", relationshipId: edge.id });
        });
        remove.className = "aw-resource-links-remove";
        remove.dataset.removeLink = edge.id;
        remove.setAttribute(
          "aria-label",
          "Remove " +
            edge.kind.replaceAll("_", " ") +
            " link to " +
            edge.resource.title,
        );
        if (remove.parentElement !== row) row.append(remove);
      } else {
        entry.remove?.remove();
        entry.remove = undefined;
      }
      nextRows.push(row);
    }
    reconcile(list, nextRows.length ? nextRows : [empty]);
    for (const id of rows.keys())
      if (!projection.links.some(edge => edge.id === id)) rows.delete(id);
    capacity.textContent = [
      projection.moreLinks ? "Showing the first 100 matching links. Search to narrow this view." : "",
      projection.moreCandidates ? "Showing the first 60 matching resources. Search to narrow the choices." : "",
    ].filter(Boolean).join(" ");
    controls();
  };
  async function refresh() {
    if (disposed || pending) return;
    const request = ++sequence;
    message("Reading saved links…", "progress");
    section.setAttribute("aria-busy", "true");
    try {
      const next = await port.read();
      if (disposed || request !== sequence) return;
      snapshot = next;
      uncertain = false;
      message("", "idle");
      render();
    } catch {
      if (!disposed && request === sequence) {
        snapshot = null;
        render();
        message(
          "Could not read these resources. Saved links are retained; refresh to retry.",
          "error",
        );
      }
    } finally {
      if (!disposed && request === sequence)
        section.removeAttribute("aria-busy");
    }
  }
  async function change(action: ResourceLinkAction) {
    if (disposed || pending || uncertain || !snapshot || !port.change) return;
    const projection = resourceLinks(snapshot, resourceId);
    if (!projection.source) return;
    if (action.type === "relate") {
      if (
        !port.capabilities.relate ||
        action.sourceId !== resourceId ||
        action.targetId === resourceId ||
        !snapshot.resources.some(
          (resource) =>
            resource.id === action.targetId &&
            resource.available !== false &&
            resource.visible !== false &&
            resource.state !== "archived",
        ) ||
        !USER_LINK_KINDS.includes(action.kind)
      )
        return;
      if (
        snapshot.relationships.some(
          (edge) =>
            edge.source_id === resourceId &&
            edge.target_id === action.targetId &&
            edge.kind === action.kind,
        )
      ) {
        message("That link already exists.");
        return;
      }
    } else {
      const edge = snapshot.relationships.find(
        (edge) => edge.id === action.relationshipId,
      );
      if (
        !port.capabilities.unrelate ||
        !edge ||
        !removableResourceLink(edge) ||
        (edge.source_id !== resourceId && edge.target_id !== resourceId)
      )
        return;
    }
    const before = snapshot,
      initiator = document.activeElement,
      initiatedInList = list.contains(initiator),
      revision = interactionRevision;
    sequence++;
    pending = true;
    section.setAttribute("aria-busy", "true");
    controls();
    message("Saving link change…", "progress");
    try {
      const next = await port.change(action);
      if (!disposed) {
        snapshot = next;
        uncertain = !confirmsResourceLinkChange(before, next, action);
        message(
          uncertain
            ? "The requested link change is not visible yet. Refresh before trying again; no change will be replayed."
            : "Link change saved.",
          uncertain ? "uncertain" : "success",
        );
        const settleFocus = !uncertain && !composing &&
          revision === interactionRevision && document.activeElement === initiator;
        render();
        if (settleFocus && action.type === "relate" && creation.open && form.contains(initiator)) {
          creation.open = false;
          createSummary.focus({ preventScroll: true });
        } else if (settleFocus && initiatedInList && action.type === "unrelate" && !section.contains(initiator)) {
          search.focus({ preventScroll: true });
        }
      }
    } catch {
      if (!disposed) {
        uncertain = true;
        message(
          "The link change could not be confirmed. Refresh before trying again. Your content is retained.",
          "uncertain",
        );
      }
    } finally {
      pending = false;
      if (!disposed) {
        section.removeAttribute("aria-busy");
        controls();
      }
    }
  }
  search.oninput = () => {
    interactionRevision++;
    if (!composing) query = search.value;
    render();
  };
  search.addEventListener("compositionstart", () => {
    composing = true;
    interactionRevision++;
  });
  search.addEventListener("compositionend", () => {
    composing = false;
    interactionRevision++;
    query = search.value;
    render();
  });
  section.addEventListener("focusin", () => { interactionRevision++; });
  creation.addEventListener("toggle", () => { interactionRevision++; });
  target.onchange = () => { interactionRevision++; controls(); };
  kind.onchange = () => { interactionRevision++; };
  form.onsubmit = (event) => {
    event.preventDefault();
    if (!target.value || !USER_LINK_KINDS.includes(kind.value as UserLinkKind))
      return;
    void change({
      type: "relate",
      sourceId: resourceId,
      targetId: target.value,
      kind: kind.value as UserLinkKind,
    });
  };
  form.hidden = !port.change || !port.capabilities.relate;
  creation.hidden = form.hidden;
  controls();
  const ready = refresh();
  return {
    ready,
    refresh,
    dispose() {
      disposed = true;
      sequence++;
      snapshot = null;
      section.remove();
    },
  };
}
