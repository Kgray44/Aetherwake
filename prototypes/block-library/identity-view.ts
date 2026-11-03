import type { BlockIdentityModel, IdentityRow } from "./identity-model.ts";
import { cardInteractionTarget } from './direct-manipulation.ts';
import { blockComposition, blockApproachTarget, type BlockComposition, type BlockFootprint, type BlockApproachTarget } from './presentation-policy.ts';
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
const setAccessibleName = (node: HTMLElement, value: string) => {
  if (node.getAttribute('aria-label') !== value) node.setAttribute('aria-label', value);
};
const glyphs: Record<BlockIdentityModel["layout"], string> = {
  chat: "M4 4h16v12H9l-5 4zM8 8h8M8 12h5",
  execution: "M4 5h16v14H4zM7 9l3 3-3 3M12 15h5",
  document: "M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h6",
  task: "M4 4h16v16H4zM8 12l3 3 6-7",
  checklist: "M3 5l2 2 3-4M11 5h10M3 12l2 2 3-4M11 12h10M3 19h5M11 19h10",
  ledger: 'M5 3h14v18H5zM8 7h2v2H8zM13 8h3M8 12h2v2H8zM13 13h3M8 17h2v2H8zM13 18h3',
  agent: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M4 21v-3a8 8 0 0 1 16 0v3M8 17h8',
  chronology: 'M3 12h18M6 8v8M12 5v14M18 8v8M4 4h4M16 20h4',
  objective: 'M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5M12 12l8-8M16 4h4v4',
  timeline: "M6 3v18M3 6h6M3 12h6M3 18h6M12 6h9M12 12h6M12 18h8",
  project: "M12 3l8 5v9l-8 4-8-4V8zM4 8l8 5 8-5M12 13v8",
  table: "M3 5h18v15H3zM3 10h18M8 5v15M3 15h18",
  collection: "M3 4h14v13H3zM7 8h14v13H7M6 7h7M6 11h7",
  research: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14M15 15l6 6M7 10h6M10 7v6",
  reference: "M6 3h12v18l-6-4-6 4zM9 7h6M9 11h6",
};
export type BlockMinimizedPresentation = Readonly<{
  canonicalMinimized: boolean;
  effectiveMinimized: boolean;
  deferredReason: 'composition' | 'uninitialized' | 'loading' | 'unavailable' | null;
}>;
type Actions = {
  approach?(target: BlockApproachTarget): void | Promise<void>;
  restore?(): Promise<void>;
  /** Host wakes its existing presentation coordinator on an actual transition.
   * Physical shrink must follow effectiveMinimized, not the persisted flag. */
  onMinimizedPresentationChange?(state: BlockMinimizedPresentation): void;
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
  // Overlay the retained working wrapper. Its full children keep their layout
  // and controller identity; overview never shrinks the host's observed body.
  const overview = element('section', 'aw-block-overview'),
    overviewContent = element('div', 'aw-block-overview-content'),
    approach = element('button', 'aw-block-approach', 'Approach'),
    restore = element('button', 'aw-block-restore', 'Restore'),
    approachStatus = element('p', 'aw-block-approach-status');
  overview.hidden = true;
  approach.hidden = true;
  restore.hidden = true;
  overview.setAttribute('data-no-card-drag', '');
  approach.type = 'button';
  restore.type = 'button';
  approachStatus.setAttribute('role', 'status');
  overview.append(overviewContent, approachStatus);
  working.append(overview);
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
  (openActions ?? overview).append(approach);
  (openActions ?? overview).append(restore);
  const openControl = article.querySelector<HTMLButtonElement>('.unfold');
  let heldOpenName: { previous: string | null; assigned: string } | undefined;
  const releaseOpenName = () => {
    if (openControl && heldOpenName && openControl.getAttribute('aria-label') === heldOpenName.assigned) {
      if (heldOpenName.previous === null) openControl.removeAttribute('aria-label');
      else openControl.setAttribute('aria-label', heldOpenName.previous);
    }
    heldOpenName = undefined;
  };
  let model: BlockIdentityModel | null = null,
    fingerprint = "",
    disposed = false;
  let footprint: BlockFootprint | undefined, composition: BlockComposition = 'working', composing = false, approaching = false;
  // This is a projection of the existing canonical placement flag, not a store.
  let canonicalMinimized = false, restoring = false, compositionEpoch = 0, minimizedEpoch = 0;
  let minimizedPresentation: BlockMinimizedPresentation = Object.freeze({ canonicalMinimized: false, effectiveMinimized: false, deferredReason: null });
  const observeMinimized = (): BlockMinimizedPresentation => {
    const deferredReason = !canonicalMinimized ? null : composing ? 'composition' : !model ? 'uninitialized' : model.phase === 'loading' ? 'loading' : model.phase !== 'ready' ? 'unavailable' : null;
    return Object.freeze({ canonicalMinimized, effectiveMinimized: canonicalMinimized && deferredReason === null, deferredReason });
  };
  const heldInert = new Map<HTMLElement, boolean>();
  const releaseWorking = () => {
    for (const [child, alreadyInert] of heldInert) if (!alreadyInert) child.removeAttribute('inert');
    heldInert.clear();
  };
  const hasWorkingFocus = () => {
    const active = document.activeElement;
    return active instanceof HTMLElement && working.contains(active) && !overview.contains(active)
      && ['input', 'textarea', 'button', 'select', 'summary', 'a[href]', '[contenteditable="true"]'].some(selector => active.matches(selector) || !!active.closest('[contenteditable="true"]'));
  };
  const reconcileComposition = () => {
    if (disposed) return;
    const observation = observeMinimized(), next = observation.effectiveMinimized ? 'overview'
      : model && model.phase === 'ready' && footprint && actions.approach && !article.classList.contains('expanded')
        ? blockComposition(model.kind, footprint, composition, composing || hasWorkingFocus()) : 'working';
    composition = next;
    if (article.dataset.blockComposition !== next) article.dataset.blockComposition = next;
    if (overview.parentElement !== working) working.append(overview);
    // Footprint updates can arrive every frame. Only write reflected attributes
    // when the controls or their semantics actually change.
    const overviewHidden = next !== 'overview';
    const approachHidden = overviewHidden || observation.effectiveMinimized;
    const restoreHidden = !observation.effectiveMinimized;
    const restoreDisabled = restoring || !actions.restore;
    const restoreTitle = actions.restore ? 'Restore this card' : 'Restore is unavailable';
    const minimized = String(observation.effectiveMinimized);
    if (overview.hidden !== overviewHidden) overview.hidden = overviewHidden;
    if (approach.hidden !== approachHidden) approach.hidden = approachHidden;
    if (restore.hidden !== restoreHidden) restore.hidden = restoreHidden;
    if (restore.disabled !== restoreDisabled) restore.disabled = restoreDisabled;
    setAccessibleName(restore, 'Restore ' + (model?.label.toLowerCase() ?? 'block'));
    if (restore.title !== restoreTitle) restore.title = restoreTitle;
    if (article.dataset.blockMinimized !== minimized) article.dataset.blockMinimized = minimized;
    if (next === 'overview') {
      if (openControl && !heldOpenName) {
        heldOpenName = { previous: openControl.getAttribute('aria-label'), assigned: 'Open ' + model!.label.toLowerCase() + ' in focused view' };
        openControl.setAttribute('aria-label', heldOpenName.assigned);
      }
      for (const child of Array.from(working.children)) if (child instanceof HTMLElement && child !== overview && !heldInert.has(child)) {
        heldInert.set(child, child.hasAttribute('inert'));
        child.setAttribute('inert', '');
      }
    } else { releaseWorking(); releaseOpenName(); }
    if (observation.canonicalMinimized !== minimizedPresentation.canonicalMinimized || observation.effectiveMinimized !== minimizedPresentation.effectiveMinimized || observation.deferredReason !== minimizedPresentation.deferredReason) {
      minimizedPresentation = observation;
      actions.onMinimizedPresentationChange?.(observation);
    }
  };
  const focusChanged = () => queueMicrotask(() => reconcileComposition());
  const compositionStarted = (event: Event) => {
    if (event.target instanceof HTMLElement && working.contains(event.target) && !overview.contains(event.target)) { compositionEpoch++; composing = true; reconcileComposition(); }
  };
  const compositionEnded = (event: Event) => {
    if (!(event.target instanceof HTMLElement) || !working.contains(event.target) || overview.contains(event.target)) return;
    const epoch = ++compositionEpoch;
    const finish = () => { if (!disposed && epoch === compositionEpoch) { composing = false; reconcileComposition(); } };
    // Let the final native input following compositionend settle before the
    // host observes permission to shrink. No timer or polling/frame loop.
    if (canonicalMinimized) queueMicrotask(finish); else finish();
  };
  article.addEventListener('focusin', focusChanged);
  article.addEventListener('focusout', focusChanged);
  article.addEventListener('compositionstart', compositionStarted, true);
  article.addEventListener('compositionend', compositionEnded, true);
  const approachCard = () => {
    if (approaching || model?.phase !== 'ready' || !actions.approach || disposed) return;
    approaching = true;
    approach.disabled = true;
    text(approachStatus, '');
    const target = blockApproachTarget(model.kind, footprint?.textScale);
    void Promise.resolve().then(() => { if (!disposed) return actions.approach!(target); })
      .catch(() => { if (!disposed) text(approachStatus, 'Could not approach this card.'); })
      .finally(() => { if (!disposed) { approaching = false; approach.disabled = false; } });
  };
  approach.onclick = approachCard;
  const doubleClick = (event: MouseEvent) => {
    if (!actions.approach || event.button !== 0 || event.defaultPrevented ||
        article.classList.contains('expanded') || article.classList.contains('receded') ||
        !(event.target instanceof Element) || event.target.closest(cardInteractionTarget)) return;
    event.preventDefault();
    event.stopPropagation();
    approachCard();
  };
  article.addEventListener('dblclick', doubleClick);
  restore.onclick = () => {
    if (disposed || restoring || !minimizedPresentation.effectiveMinimized || !actions.restore) return;
    const epoch = minimizedEpoch;
    restoring = true; restore.disabled = true; text(approachStatus, '');
    void Promise.resolve().then(() => { if (!disposed && canonicalMinimized && minimizedPresentation.effectiveMinimized && epoch === minimizedEpoch) return actions.restore!(); })
      .catch(() => { if (!disposed) text(approachStatus, 'Could not restore this card. Your data is retained.'); })
      .finally(() => { if (!disposed) { restoring = false; reconcileComposition(); } });
  };
  function renderOverview(value: BlockIdentityModel) {
    if (overview.dataset.layout !== value.layout) overview.dataset.layout = value.layout;
    setAccessibleName(overview, value.label + ' overview');
    const approachName = 'Approach ' + value.label.toLowerCase();
    setAccessibleName(approach, approachName);
    if (approach.title !== approachName) approach.title = approachName;
    const content: HTMLElement[] = [], paragraph = (text: string, className = '') => { if (text) content.push(element('p', className, text)); };
    if (value.phase !== 'ready') paragraph(value.empty || value.subtitle);
    else if (value.kind === 'conversation') {
      const latest = value.rows.at(-1);
      paragraph(latest?.title ?? value.label, 'aw-overview-speaker');
      paragraph(latest?.detail ?? value.empty, 'aw-overview-excerpt');
      for (const metric of value.metrics.slice(0, 1)) paragraph(metric.value, 'aw-overview-state');
    } else if (value.kind === 'task') {
      paragraph(value.rows[0]?.detail ?? value.empty, 'aw-overview-state');
      paragraph(value.paragraphs[0] ?? '', 'aw-overview-excerpt');
    } else if (value.kind === 'task_objective') {
      paragraph(value.paragraphs[0] ?? value.empty, 'aw-overview-objective');
      paragraph(value.subtitle, 'aw-overview-state');
      paragraph(value.metrics.map(metric => metric.value + ' ' + metric.label.toLowerCase()).join(' · '), 'aw-overview-meta');
    } else if (value.kind === 'task_group') {
      paragraph(value.subtitle, 'aw-overview-state');
      for (const row of value.rows.slice(0, 2)) paragraph((row.checked ? '✓ ' : '○ ') + row.title, 'aw-overview-task');
    } else if (value.kind === 'stream') {
      const latest = value.rows[0];
      paragraph(latest?.title ?? value.empty, 'aw-overview-event');
      paragraph(latest ? [latest.detail, latest.time].filter(Boolean).join(' · ') : value.subtitle, 'aw-overview-meta');
    } else if (value.kind === 'project_overview') {
      const metrics = element('dl', 'aw-overview-metrics');
      for (const metric of value.metrics) { const item = element('div'); item.append(element('dt', '', metric.label), element('dd', '', metric.value)); metrics.append(item); }
      content.push(metrics);
    } else if (value.kind === 'resource_browser' || value.kind === 'collection_browser') {
      for (const row of value.rows.slice(0, 2)) { const item = element('div', 'aw-overview-resource'); item.append(element('span', '', row.title), element('small', '', row.detail)); content.push(item); }
      if (!value.rows.length) paragraph(value.empty, 'aw-overview-excerpt');
    } else {
      if (value.kind === 'reference' && value.links[0]) paragraph(value.links[0].domain, 'aw-overview-source');
      paragraph(value.heading || value.paragraphs[0] || value.empty, 'aw-overview-excerpt');
      if (value.kind === 'research') paragraph(value.links.map(link => link.domain).join(' · '), 'aw-overview-source');
      if (value.kind === 'note') paragraph(value.subtitle, 'aw-overview-meta');
    }
    overviewContent.replaceChildren(...content);
  }
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
          if (layout === "timeline" || layout === 'chronology') {
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
    reconcileComposition();
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
    const openTitle = "Open " + value.label.toLowerCase();
    if (open && open.title !== openTitle) open.title = openTitle;
    const next = JSON.stringify(value);
    if (next === fingerprint) return;
    renderOverview(value);
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
    if (value.layout === 'objective') {
      body.replaceChildren(); rowNodes.clear();
      body.append(element('p', 'aw-identity-objective', value.paragraphs[0] ?? value.empty), element('small', 'aw-identity-objective-state', value.subtitle));
      const requirements = element('ol', 'aw-identity-objective-requirements');
      for (const item of value.rows) requirements.append(element('li', '', item.title));
      if (value.rows.length) body.append(requirements);
    } else if (value.layout === 'agent') {
      body.replaceChildren(); rowNodes.clear();
      const hero = element('div', 'aw-identity-agent-profile'), monogram = element('span', 'aw-identity-agent-monogram', Array.from(value.heading.trim())[0]?.toUpperCase() ?? 'A');
      hero.append(monogram, element('h3', '', value.heading)); body.append(hero);
      for (const paragraph of value.paragraphs) body.append(element('p', 'aw-identity-paragraph', paragraph));
      if (value.empty) body.append(element('small', 'aw-identity-agent-specialties', value.empty));
    } else if (
      [
        "chat",
        "execution",
        "task",
        "checklist",
        'ledger',
        'chronology',
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
    setFootprint(value: BlockFootprint) { footprint = value; reconcileComposition(); return composition; },
    setMinimized(value: boolean) {
      if (typeof value !== 'boolean') throw new TypeError('invalid_canonical_minimized_flag');
      if (!disposed) { if (canonicalMinimized !== value) minimizedEpoch++; canonicalMinimized = value; reconcileComposition(); }
      return minimizedPresentation;
    },
    minimizedPresentation() { return minimizedPresentation; },
    search: query,
    dispose() {
      disposed = true;
      article.removeEventListener('focusin', focusChanged);
      article.removeEventListener('focusout', focusChanged);
      article.removeEventListener('compositionstart', compositionStarted, true);
      article.removeEventListener('compositionend', compositionEnded, true);
      releaseWorking();
      releaseOpenName();
      article.removeEventListener('dblclick', doubleClick);
      overview.remove();
      approach.remove();
      restore.remove();
      delete article.dataset.blockComposition;
      delete article.dataset.blockMinimized;
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
