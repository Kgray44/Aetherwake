import type { BlockIdentityModel, IdentityRow } from "./identity-model.ts";
const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = "",
) => {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
};
const text = (node: Element | null, value: string) => {
  if (node && node.textContent !== value) node.textContent = value;
};
const glyphs: Record<BlockIdentityModel["layout"], string> = {
  chat: "M4 4h16v12H9l-5 4zM8 8h8M8 12h5",
  execution: "M4 5h16v14H4zM7 9l3 3-3 3M12 15h5",
  document: "M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h6",
  task: "M4 4h16v16H4zM8 12l3 3 6-7",
  checklist: "M3 5l2 2 3-4M11 5h10M3 12l2 2 3-4M11 12h10M3 19h5M11 19h10",
  timeline: "M6 3v18M3 6h6M3 12h6M3 18h6M12 6h9M12 12h6M12 18h8",
  project: "M12 3l8 5v9l-8 4-8-4V8zM4 8l8 5 8-5M12 13v8",
  table: "M3 5h18v15H3zM3 10h18M8 5v15M3 15h18",
  collection: "M3 4h14v13H3zM7 8h14v13H7M6 7h7M6 11h7",
  research: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14M15 15l6 6M7 10h6M10 7v6",
  reference: "M6 3h12v18l-6-4-6 4zM9 7h6M9 11h6",
};
type Actions = {
  toggleTask?(id: string, done: boolean): Promise<void>;
  openResource?(id: string): void;
  openWorkspace?(id: string): void;
  attachResource?(id: string): Promise<void>;
  search?(query: string): void;
  copy?(value: string): Promise<void>;
};
/** Per-kind compact composition and header. All data/actions remain supplied by
 * the existing canonical controllers. No store, provider, fetch or frame loop. */
export function mountBlockIdentity(article: HTMLElement, actions: Actions) {
  const inner = article.querySelector<HTMLElement>(".folio-inner")!,
    working = article.querySelector<HTMLElement>(".working-content")!,
    top = article.querySelector<HTMLElement>(".folio-top")!;
  const root = element("section", "aw-block-compact"),
    query = element("input", "aw-identity-search"),
    body = element("div", "aw-identity-body"),
    status = element("p", "aw-identity-status");
  root.setAttribute("data-no-card-drag", "");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  query.type = "search";
  query.maxLength = 500;
  query.placeholder = "Find a resource…";
  query.setAttribute("aria-label", "Search this resource view");
  query.hidden = true;
  query.oninput = () => actions.search?.(query.value);
  root.append(query, body, status);
  inner.insertBefore(root, working);
  const mark = document.createElementNS("http://www.w3.org/2000/svg", "svg"),
    path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  mark.classList.add("aw-block-mark");
  mark.setAttribute("viewBox", "0 0 24 24");
  mark.setAttribute("aria-hidden", "true");
  mark.append(path);
  const anchor = article.querySelector(".resource-anchor"),
    anchorGlyph = anchor?.querySelector(".anchor-glyph"),
    anchorMark = document.createElementNS("http://www.w3.org/2000/svg", "svg"),
    anchorPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  anchorMark.classList.add("aw-block-mark");
  anchorMark.setAttribute("viewBox", "0 0 24 24");
  anchorMark.setAttribute("aria-hidden", "true");
  anchorMark.append(anchorPath);
  anchorGlyph?.replaceChildren(anchorMark);
  const label = article.querySelector(".grip")!;
  label.insertBefore(mark, label.firstChild);
  const openActions = article.querySelector(".folio-actions"),
    originalActionsParent = openActions?.parentElement;
  if (openActions) top.append(openActions);
  let model: BlockIdentityModel | null = null,
    fingerprint = "",
    disposed = false;
  const pending = new Set<string>();
  const run = (id: string, work: () => Promise<void> | undefined) => {
    if (pending.has(id)) return;
    pending.add(id);
    text(status, "Saving…");
    void Promise.resolve()
      .then(work)
      .then(() => {
        if (!disposed) text(status, "");
      })
      .catch(() => {
        if (!disposed)
          text(status, "Could not confirm this change. Your data is retained.");
      })
      .finally(() => {
        pending.delete(id);
        if (!disposed && model) {
          fingerprint = "";
          update(model);
        }
      });
  };
  const rowNodes = new Map<
    string,
    {
      node: HTMLElement;
      title: HTMLElement;
      detail: HTMLElement;
      check?: HTMLInputElement;
      attach?: HTMLButtonElement;
      time?: HTMLElement;
    }
  >();
  function rows(items: IdentityRow[], layout: BlockIdentityModel["layout"]) {
    const live = new Set(items.map((item) => item.id));
    for (const [id, row] of rowNodes)
      if (!live.has(id)) {
        row.node.remove();
        rowNodes.delete(id);
      }
    for (const [index, item] of items.entries()) {
      let row = rowNodes.get(item.id);
      if (!row) {
        const node = element("div", "aw-identity-row"),
          title = element("span", "aw-identity-row-title"),
          detail = element("small", "aw-identity-row-detail");
        node.dataset.identityRow = item.id;
        if (layout === "task" || layout === "checklist") {
          const check = element("input", "aw-identity-check");
          check.type = "checkbox";
          const label = element("label", "aw-identity-task-label");
          label.append(check, title);
          node.append(label, detail);
          check.onchange = () => {
            check.disabled = true;
            const wanted = check.checked;
            run(item.id, () => actions.toggleTask?.(item.id, wanted));
          };
          row = { node, title, detail, check };
        } else {
          if (item.target === "resource" || item.target === "workspace") {
            const open = element("button", "aw-identity-open");
            open.type = "button";
            open.append(title, detail);
            open.onclick = () =>
              item.target === "workspace"
                ? actions.openWorkspace?.(item.id)
                : actions.openResource?.(item.id);
            node.append(open);
          } else node.append(title, detail);
          row = { node, title, detail };
          if (layout === "timeline") {
            const time = element("time", "aw-identity-time");
            node.prepend(time);
            row.time = time;
          }
          if (item.canAttach && actions.attachResource) {
            const attach = element("button", "aw-identity-attach", "+");
            attach.type = "button";
            attach.setAttribute(
              "aria-label",
              "Attach " + item.title + " to this workspace",
            );
            attach.onclick = () => {
              attach.disabled = true;
              run(item.id, () => actions.attachResource?.(item.id));
            };
            node.append(attach);
            row.attach = attach;
          }
        }
        rowNodes.set(item.id, row);
      }
      text(row.title, item.title);
      text(row.detail, item.detail);
      if (item.target === "resource" || item.target === "task")
        row.node.dataset.resource = item.id;
      if (row.check) {
        row.check.checked = item.checked ?? false;
        row.check.disabled =
          item.checked === undefined ||
          !actions.toggleTask ||
          pending.has(item.id);
        row.check.setAttribute(
          "aria-label",
          item.title + " · completed locally",
        );
      }
      if (row.attach) {
        row.attach.disabled = pending.has(item.id);
        row.attach.setAttribute(
          "aria-label",
          "Attach " + item.title + " to this workspace",
        );
      }
      row.node.dataset.checked = String(item.checked ?? false);
      if (row.time) {
        const date = item.time ? new Date(item.time) : null;
        text(
          row.time,
          date && Number.isFinite(date.getTime())
            ? date.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })
            : "—",
        );
        row.time.title = item.time ?? "Time unavailable";
      }
      if (body.children[index] !== row.node)
        body.insertBefore(row.node, body.children[index] ?? null);
    }
  }
  function update(value: BlockIdentityModel) {
    model = value;
    article.dataset.blockKind = value.kind;
    article.dataset.blockVariant = value.layout;
    article.dataset.resourceAvailability =
      value.phase === "unavailable" ? "unavailable" : "available";
    text(article.querySelector(".grip span"), value.label.toUpperCase());
    text(article.querySelector(".folio-subtitle"), value.subtitle);
    path.setAttribute("d", glyphs[value.layout]);
    anchorPath.setAttribute("d", glyphs[value.layout]);
    text(anchor?.querySelector(".anchor-label small") ?? null, value.label);
    const canonicalTitle = article.querySelector("h2")?.textContent?.trim();
    const anchorName =
      value.label + (canonicalTitle ? " · " + canonicalTitle : "");
    anchor?.setAttribute("aria-label", "Open " + anchorName);
    anchor?.setAttribute("title", anchorName);
    const open = article.querySelector<HTMLButtonElement>(".unfold");
    if (open)
      open.title = article.classList.contains("expanded")
        ? "Return to workspace"
        : "Open " + value.label.toLowerCase();
    const next = JSON.stringify(value);
    if (next === fingerprint) return;
    const changedLayout = root.dataset.layout !== value.layout;
    fingerprint = next;
    root.dataset.layout = value.layout;
    root.setAttribute("aria-label", value.label + " workspace view");
    root.setAttribute("aria-busy", String(value.phase === "loading"));
    const searchable =
      value.layout === "table" || value.layout === "collection";
    query.hidden = !searchable;
    if (
      document.activeElement !== query &&
      value.query !== undefined &&
      query.value !== value.query
    )
      query.value = value.query;
    if (changedLayout) {
      body.replaceChildren();
      rowNodes.clear();
    }
    if (value.phase !== "ready") {
      body.replaceChildren(
        element("p", "aw-identity-empty", value.empty || value.subtitle),
      );
      rowNodes.clear();
      return;
    }
    if (
      [
        "chat",
        "execution",
        "task",
        "checklist",
        "timeline",
        "table",
        "collection",
        "project",
      ].includes(value.layout)
    ) {
      if (value.rows.length) {
        body.querySelector(".aw-identity-empty")?.remove();
        rows(value.rows, value.layout);
      } else {
        body.replaceChildren(element("p", "aw-identity-empty", value.empty));
        rowNodes.clear();
      }
      body.querySelector(".aw-identity-metrics")?.remove();
      body.querySelector(".aw-identity-caption")?.remove();
      body.querySelector(".aw-identity-description")?.remove();
      if (value.metrics.length) {
        const metrics = element("div", "aw-identity-metrics");
        for (const metric of value.metrics) {
          const cell = element("div");
          cell.append(
            element("strong", "", metric.value),
            element("small", "", metric.label),
          );
          metrics.append(cell);
        }
        body.prepend(metrics);
      }
      if (
        value.heading &&
        value.heading !== article.querySelector("h2")?.textContent &&
        ["project", "table", "collection"].includes(value.layout)
      )
        body.prepend(element("h3", "aw-identity-caption", value.heading));
      if (value.layout === "task" && value.paragraphs.length)
        body.append(
          element("p", "aw-identity-description", value.paragraphs.join(" ")),
        );
    } else {
      body.replaceChildren();
      rowNodes.clear();
      if (value.heading)
        body.append(
          element("h3", "aw-identity-document-heading", value.heading),
        );
      for (const paragraph of value.paragraphs)
        body.append(element("p", "aw-identity-paragraph", paragraph));
      if (!value.heading && !value.paragraphs.length)
        body.append(element("p", "aw-identity-empty", value.empty));
      if (value.links.length) {
        const sources = element("div", "aw-identity-sources");
        for (const link of value.links) {
          const row = element("div", "aw-identity-source"),
            domain = element("span", "", link.domain);
          domain.title = link.url;
          row.append(domain);
          if (actions.copy) {
            const copy = element("button", "", "Copy link");
            copy.type = "button";
            copy.onclick = () => {
              void actions.copy!(link.url)
                .then(() => text(status, "Link copied"))
                .catch(() => text(status, "Could not copy the link"));
            };
            row.append(copy);
          }
          sources.append(row);
        }
        body.append(sources);
      }
    }
  }
  return {
    update,
    search: query,
    dispose() {
      disposed = true;
      root.remove();
      mark.remove();
      if (openActions && originalActionsParent?.isConnected)
        originalActionsParent.append(openActions);
      delete article.dataset.blockKind;
      delete article.dataset.blockVariant;
      delete article.dataset.resourceAvailability;
    },
  };
}
