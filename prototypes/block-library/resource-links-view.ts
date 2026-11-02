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
    heading = element("h3", "Related resources"),
    description = element(
      "p",
      "Links connect saved resources without copying content or changing permissions.",
    ),
    search = element("input"),
    status = element("p", "", "aw-resource-links-status"),
    list = element("ul", "", "aw-resource-links-list"),
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
  section.append(
    heading,
    description,
    refreshButton,
    search,
    status,
    list,
    form,
  );
  root.append(section);
  let snapshot: ResourceLinksSnapshot | null = null,
    sequence = 0,
    disposed = false,
    pending = false,
    uncertain = false;
  const message = (text: string) => {
    if (!disposed) status.textContent = text;
  };
  const controls = () => {
    const source = snapshot && resourceLinks(snapshot, resourceId).source;
    target.disabled = kind.disabled =
      pending ||
      uncertain ||
      !source ||
      !port.change ||
      !port.capabilities.relate;
    add.disabled = target.disabled || !target.value;
    refreshButton.disabled = pending;
    for (const control of list.querySelectorAll<HTMLButtonElement>(
      "[data-remove-link]",
    ))
      control.disabled = pending || uncertain;
  };
  const render = () => {
    if (disposed) return;
    list.replaceChildren();
    const projection = snapshot
      ? resourceLinks(snapshot, resourceId, search.value)
      : null;
    const chosen = target.value,
      placeholder = element("option", "Choose a resource");
    placeholder.value = "";
    target.replaceChildren(placeholder);
    if (!projection?.source) {
      heading.textContent = "Related resources";
      target.value = "";
      controls();
      if (snapshot)
        message("This resource is unavailable. Its saved links are retained.");
      return;
    }
    heading.textContent = "Related to " + projection.source.title;
    for (const resource of projection.candidates) {
      const option = element(
        "option",
        resource.title + " · " + resource.kind.replaceAll("_", " "),
      );
      option.value = resource.id;
      target.append(option);
    }
    target.value = projection.candidates.some(
      (resource) => resource.id === chosen,
    )
      ? chosen
      : "";
    for (const edge of projection.links) {
      const row = element("li"),
        title = port.openResource
          ? button(edge.resource.title, () =>
              port.openResource!(edge.resource.id),
            )
          : element("strong", edge.resource.title),
        detail = element(
          "small",
          (edge.direction === "incoming" ? "Incoming · " : "Outgoing · ") +
            (USER_LINK_KINDS.includes(edge.kind as UserLinkKind)
              ? labels[edge.kind as UserLinkKind]
              : edge.kind.replaceAll("_", " ")) +
            " · " +
            edge.provenance,
        );
      row.dataset.relationshipId = edge.id;
      row.append(title, detail);
      if (edge.removable && port.change && port.capabilities.unrelate) {
        const remove = button("Remove link", () => {
          void change({ type: "unrelate", relationshipId: edge.id });
        });
        remove.dataset.removeLink = edge.id;
        remove.setAttribute(
          "aria-label",
          "Remove " +
            edge.kind.replaceAll("_", " ") +
            " link to " +
            edge.resource.title,
        );
        row.append(remove);
      }
      list.append(row);
    }
    if (!projection.links.length)
      list.append(element("li", "No matching links in the current view."));
    if (projection.moreLinks)
      list.append(
        element(
          "li",
          "Showing the first 100 matching links. Search to narrow this view.",
        ),
      );
    if (projection.moreCandidates && !pending && !uncertain)
      message(
        "Showing the first 60 matching resources. Search to narrow the choices.",
      );
    controls();
  };
  async function refresh() {
    if (disposed || pending) return;
    const request = ++sequence;
    message("Reading saved links…");
    section.setAttribute("aria-busy", "true");
    try {
      const next = await port.read();
      if (disposed || request !== sequence) return;
      snapshot = next;
      uncertain = false;
      message("");
      render();
    } catch {
      if (!disposed && request === sequence) {
        snapshot = null;
        render();
        message(
          "Could not read these resources. Saved links are retained; refresh to retry.",
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
    const before = snapshot;
    sequence++;
    pending = true;
    section.setAttribute("aria-busy", "true");
    controls();
    message("Saving link change…");
    try {
      const next = await port.change(action);
      if (!disposed) {
        snapshot = next;
        uncertain = !confirmsResourceLinkChange(before, next, action);
        message(
          uncertain
            ? "The requested link change is not visible yet. Refresh before trying again; no change will be replayed."
            : "Link change saved.",
        );
        render();
      }
    } catch {
      if (!disposed) {
        uncertain = true;
        message(
          "The link change could not be confirmed. Refresh before trying again. Your content is retained.",
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
    render();
  };
  target.onchange = controls;
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
