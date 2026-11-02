import type { BlockInstanceKind } from "./contracts.ts";

/** Deterministic, inert examples. No canonical data, provider calls, timers or live-event claims. */
export function blockPreview(kind: BlockInstanceKind): HTMLElement {
  const root = document.createElement("figure");
  root.className = "aw-library__sample";
  root.dataset.kind = kind;
  const caption = document.createElement("figcaption");
  caption.textContent = "Example preview · synthetic content";
  root.append(caption);
  const line = (tag: string, text: string, style = "") => {
    const element = document.createElement(tag);
    element.textContent = text;
    element.className = style;
    root.append(element);
    return element;
  };
  if (kind === 'agent') {
    line('small', 'SAVED AGENT · EXAMPLE');
    line('h4', 'Researcher');
    line('p', 'Investigate a question and compare sources.');
    line('p', 'Purpose · Specialties · Effective configuration');
    line('div', 'Open agent', 'aw-library__sample-input');
    line('p', 'A saved profile is not a running execution.', 'aw-library__hint');
  } else if (kind === "project_overview") {
    line("small", "PROJECT OVERVIEW · EXAMPLE");
    line("h4", "A project and its work");
    line("p", "Workspaces → Development · Research");
    line("p", "Local tasks → 2 open · 1 done");
    line(
      "div",
      "Open canonical workspaces and resources",
      "aw-library__sample-input",
    );
  } else if (kind === "resource_browser" || kind === "collection_browser") {
    line(
      "small",
      kind === "resource_browser"
        ? "RESOURCE EXPLORER · RESOURCE SCOPE · EXAMPLE"
        : "RESOURCE EXPLORER · COLLECTION SCOPE · EXAMPLE",
    );
    line("div", "Search authorized resources…", "aw-library__sample-input");
    line(
      "p",
      "▤ Working notes    · note\n○ Review milestone · task\n≋ Planning chat    · conversation",
    );
    line(
      "p",
      "Open or attach an existing canonical subject.",
      "aw-library__hint",
    );
  } else if (kind === "conversation") {
    line("small", "CONVERSATION · LOCAL HISTORY");
    line("p", "What should we work on?", "aw-library__bubble");
    line(
      "p",
      "Your messages persist here. Connect a supported provider for model responses.",
      "aw-library__bubble aw-library__bubble--reply",
    );
    line("div", "Write a message…", "aw-library__sample-input");
  } else if (kind === "task") {
    line("small", "MANUAL TASK · OPEN");
    line("h4", "Review the next milestone");
    line(
      "p",
      "Capture a description, then mark the task done when you choose.",
    );
    line("div", "○ Open    →    ✓ Done", "aw-library__sample-input");
  } else if (kind === 'checklist') {
    line('small', 'CHECKLIST · MANUAL ITEMS · EXAMPLE');
    line('h4', 'Keep the next steps clear');
    line('p', 'Preparation\n○ Review source material · High · Due Nov 8\n✓ Record questions · Checked manually');
    line('div', 'Add an item…', 'aw-library__sample-input');
    line('p', 'Group items and link their sources. No provider is required.', 'aw-library__hint');
  } else if (kind === "task_group") {
    line("small", "MANUAL TASK GROUP · 2 EXAMPLE MEMBERS");
    line("p", "○ Review implementation");
    line("p", "✓ Record decisions");
    line("div", "Manage canonical task references", "aw-library__sample-input");
  } else if (kind === "stream") {
    line("small", "RECORDED ACTIVITY · EXAMPLE");
    line("p", "10:24  workspace.saved · local host");
    line("p", "10:25  provider.disconnected · observed");
    line("p", "Source and classification stay visible.", "aw-library__hint");
  } else if (kind === "research") {
    line("small", "RESEARCH NOTEBOOK");
    line("h4", "A question worth exploring");
    line(
      "p",
      "Findings\n• Record what a source supports\n• Link the original reference",
    );
    line("p", "Record findings, sources and unresolved questions.", "aw-library__hint");
  } else if (kind === "reference") {
    line("small", "REFERENCE");
    line("h4", "A source and its context");
    line("p", "Keep a link, a description, and related resource references.");
    line(
      "div",
      "External content is not fetched automatically.",
      "aw-library__hint",
    );
  } else {
    line("small", "NOTE · MARKDOWN TEXT");
    line("h4", "A place for a clear thought");
    line(
      "p",
      "# Working notes\n\nKeep the next idea close.\nYour text belongs to the canonical note.",
    );
    line("div", "Persistent local editor", "aw-library__sample-input");
  }
  return root;
}
