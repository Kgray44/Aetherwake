import { sourceLinks } from "./source-links.ts";
import type { NoteExperiencePort } from "./note-contracts.ts";
import { NoteSession } from "./note-session.ts";

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
const action = (label: string, run: () => void) => {
  const node = element("button", label);
  node.type = "button";
  node.onclick = run;
  return node;
};

/** Safe basic Markdown rendering. User text is always a text node, never executable HTML. */
export function renderNoteReading(root: HTMLElement, content: string) {
  // Disclosure is presentation state held by this mounted DOM, never note content.
  const disclosures = new Map(
    Array.from(root.querySelectorAll<HTMLDetailsElement>(".aw-note-section"))
      .map(section => [section.dataset.noteSectionKey!, section.open] as const),
  );
  root.replaceChildren();
  const sections: { level: number; key: string; body: HTMLElement }[] = [];
  const occurrences = new Map<string, number>();
  const target = () => sections.at(-1)?.body ?? root;
  let code: HTMLElement | null = null,
    list: HTMLOListElement | HTMLUListElement | null = null;
  const lines = content.split("\n");
  for (const [index, line] of lines.slice(0, 1500).entries()) {
    if (/^\s*```/.test(line)) {
      if (code) code = null;
      else {
        const pre = element("pre");
        code = element("code");
        pre.append(code);
        target().append(pre);
      }
      list = null;
      continue;
    }
    if (code) {
      code.append(document.createTextNode(line + (index < lines.length - 1 ? "\n" : '')));
      continue;
    }
    // Interpret Markdown line endings without altering fenced source bytes.
    const syntaxLine = line.endsWith("\r") ? line.slice(0, -1) : line;
    const heading = /^(#{1,6})\s+(.+)$/.exec(syntaxLine),
      item = /^\s*(?:([-*+])|\d+\.)\s+(.+)$/.exec(syntaxLine);
    if (item) {
      const type = item[1] ? "ul" : "ol";
      if (!list || list.tagName.toLowerCase() !== type) {
        list = element(type);
        target().append(list);
      }
      list.append(element("li", item[2]));
      continue;
    }
    list = null;
    if (heading) {
      const level = heading[1].length;
      while (sections.length && sections.at(-1)!.level >= level) sections.pop();
      const identity = `${sections.at(-1)?.key ?? "root"}/${level}:${heading[2]}`;
      const occurrence = (occurrences.get(identity) ?? 0) + 1;
      occurrences.set(identity, occurrence);
      const key = `${identity}:${occurrence}`;
      const section = element("details", "", "aw-note-section"),
        summary = element("summary", "", "aw-note-section-heading"),
        body = element("div", "", "aw-note-section-body");
      section.dataset.noteSectionKey = key;
      section.dataset.headingLevel = String(level);
      section.open = disclosures.get(key) ?? true;
      summary.append(element(("h" + level) as "h1", heading[2]));
      section.append(summary, body);
      target().append(section);
      sections.push({ level, key, body });
    } else if (/^>\s?/.test(line))
      target().append(element("blockquote", line.replace(/^>\s?/, "")));
    else if (line.trim()) target().append(element("p", line));
  }
  if (lines.length > 1500)
    root.append(
      element(
        "p",
        "Reading preview is limited to 1,500 lines. Write mode retains the complete text.",
      ),
    );
}

export { sourceLinks } from "./source-links.ts";

const fencedCode = (content: string) => {
  const lines = content.split('\n'), values: string[] = [];
  let current: string[] | null = null;
  for (const [index, line] of lines.entries()) {
    if (/^\s*```/.test(line)) {
      if (current) { values.push(current.join('')); current = null; }
      else current = [];
    } else if (current) current.push(line + (index < lines.length - 1 ? '\n' : ''));
  }
  if (current) values.push(current.join(''));
  return values;
};

/** Adds controls around the existing textarea. Its node, selection and input listener are retained. */
export function mountNoteExperience(
  root: HTMLElement,
  editor: HTMLTextAreaElement,
  session: NoteSession,
  port: NoteExperiencePort,
  options: {
    kind: string;
    active?: boolean;
    initialMode?: "write" | "read";
    presentation?: "workspace" | "focused";
    openExternal?(url: string): Promise<void>;
    /** Explicit user copy only. Root injects trusted native clipboard writing;
     * absence never falls back to the browser Clipboard API. */
    copyText?(text: string): Promise<void>;
    openRelated?(resourceId: string, anchor: HTMLElement): void | Promise<void>;
  },
) {
  const tools = element("div", "", "aw-note-tools"),
    status = element("p", "", "aw-note-status"),
    copyStatus = element('p', '', 'aw-note-copy-status'),
    reading = element("div", "", "aw-note-reading"),
    recovery = element("div", "", "aw-note-recovery"),
    sources = element("section", "", "aw-note-sources"),
    title = element("input"),
    search = element("input"),
    details = element("details"),
    canonical = element("pre"),
    otherDraft = element("pre"),
    rename = element("form", "", "aw-note-rename"),
    menu = element("details", "", "aw-note-actions"),
    menuSummary = element("summary", "⋯"),
    menuPanel = element("div", "", "aw-note-actions-panel");
  menuSummary.setAttribute("aria-label", "Document actions");
  menuSummary.title = "Find, rename, copy and document actions";
  menu.append(menuSummary, menuPanel);
  const editorLabel = editor.closest("label");
  const dismissMenu = (event: PointerEvent) => {
    if (active && menu.open && !menu.contains(event.target as Node))
      menu.open = false;
  };
  document.addEventListener("pointerdown", dismissMenu);
  menu.onkeydown = (event) => {
    if (event.key === "Escape" && menu.open) {
      event.preventDefault();
      event.stopPropagation();
      menu.open = false;
      menuSummary.focus();
    }
  };
  let active = options.active ?? true,
    disposed = false,
    mode: "write" | "read" = options.initialMode ?? "write",
    text = "",
    rendered = "",
    pending = false,
    copyPending = false,
    copyEpoch = 0,
    pointerSelection = '';
  const copyButtons = new Map<HTMLButtonElement, () => boolean>();
  copyStatus.setAttribute('role', 'status'); copyStatus.setAttribute('aria-live', 'polite');
  const selectedText = () => {
    const selection = window.getSelection?.();
    if (mode === 'read' && selection && selection.rangeCount > 0 && !selection.isCollapsed && selection.anchorNode && selection.focusNode
      && ((reading.contains(selection.anchorNode) && reading.contains(selection.focusNode))
        || (sources.contains(selection.anchorNode) && sources.contains(selection.focusNode)))) return selection.toString();
    return mode === 'write' && editor.selectionEnd > editor.selectionStart
      ? editor.value.slice(editor.selectionStart, editor.selectionEnd) : '';
  };
  const refreshCopy = () => {
    for (const [button, enabled] of copyButtons) {
      if (!root.contains(button)) { copyButtons.delete(button); continue; }
      button.disabled = !active || !options.copyText || copyPending || !enabled();
    }
  };
  const copy = async (value: string, success: string, failure: string) => {
    if (disposed || !active || copyPending) return;
    if (!options.copyText) { copyStatus.textContent = 'Native copying is unavailable in this surface.'; return; }
    if (!value) { copyStatus.textContent = 'There is no text to copy.'; return; }
    const epoch = copyEpoch; copyPending = true; copyStatus.textContent = 'Copying…'; refreshCopy();
    try {
      await options.copyText(value);
      if (!disposed && active && epoch === copyEpoch) copyStatus.textContent = success;
    } catch {
      if (!disposed && active && epoch === copyEpoch) copyStatus.textContent = failure;
    } finally { copyPending = false; if (!disposed) refreshCopy(); }
  };
  const copyAction = (label: string, value: () => string, success: string, failure: string, enabled = () => !!value()) => {
    const button = action(label, () => { void copy(value(), success, failure); });
    button.dataset.nativeCopyControl = 'true';
    copyButtons.set(button, enabled);
    button.disabled = !active || !options.copyText || copyPending || !enabled();
    if (!options.copyText) { button.title = 'Native copying is unavailable in this surface.'; button.setAttribute('aria-label', label + ' — native copying unavailable'); }
    return button;
  };
  status.setAttribute("role", "status");
  root.dataset.documentKind = options.kind;
  root.dataset.documentPresentation = options.presentation ?? "focused";
  status.setAttribute("aria-live", "polite");
  search.type = "search";
  search.maxLength = 500;
  search.placeholder = "Find in this text";
  search.setAttribute("aria-label", "Find in this text");
  title.maxLength = 200;
  title.required = true;
  title.setAttribute("aria-label", "Resource title");
  const error = (error: unknown) => {
    if (!disposed)
      status.textContent =
        (error instanceof Error ? error.message : "Save failed").replaceAll(
          "_",
          " ",
        ) + ". Your text remains in this editor.";
  };
  const run = (work: () => Promise<unknown>) => {
    if (pending) return;
    pending = true;
    void work()
      .catch(error)
      .finally(() => {
        pending = false;
      });
  };
  const modeButton = action("Read", () => {
    mode = mode === "write" ? "read" : "write";
    rendered = "";
    updateReading();
    pointerSelection = ''; refreshCopy();
    if (mode === "write") editor.focus();
  });
  const updateReading = () => {
    modeButton.textContent = mode === "write" ? "Read" : "Edit";
    modeButton.setAttribute(
      "aria-label",
      mode === "write" ? "Read document" : "Edit document",
    );
    reading.hidden = mode !== "read";
    if (editorLabel) editorLabel.hidden = mode === "read";
    editor.hidden = mode === "read";
    sources.hidden =
      mode !== "read" || !["research", "reference"].includes(options.kind);
    if (!active || mode !== "read" || rendered === text) return;
    renderNoteReading(reading, text);
    const code = fencedCode(text);
    reading.querySelectorAll<HTMLElement>('pre code').forEach((node, index) => {
      const body = code[index] ?? node.textContent ?? '';
      node.parentElement?.classList.add('aw-note-code-block');
      const button = copyAction('Copy code', () => body, 'Code copied.', 'Could not copy code. Please try again.');
      button.className = 'aw-note-copy-code'; node.parentElement?.append(button);
    });
    rendered = text;
    sources.replaceChildren();
    if (!["research", "reference"].includes(options.kind)) return;
    sources.append(
      element("h3", options.kind === "reference" ? "Source links" : "Sources"),
      element(
        "p",
        "User-provided links. Aerynth has not fetched or verified these sources.",
      ),
    );
    const links = sourceLinks(text),
      list = element("ul");
    for (const url of links) {
      const row = element("li"),
        address = element("code", url);
      row.append(
        address,
        copyAction('Copy link', () => url, 'Source link copied.', 'Could not copy source link. Please try again.'),
      );
      if (options.openExternal)
        row.append(
          action("Open source", () => run(() => options.openExternal!(url))),
        );
      list.append(row);
    }
    sources.append(list);
    if (!links.length)
      sources.append(
        element("p", "No HTTP or HTTPS source links in this document."),
      );
    if (links.length === 50)
      sources.append(element("p", "Showing up to 50 source links."));
  };
  const find = (backward: boolean) => {
    if (!search.value) return;
    const haystack = editor.value.toLocaleLowerCase(),
      needle = search.value.toLocaleLowerCase(),
      from = backward ? editor.selectionStart - 1 : editor.selectionEnd,
      index = backward
        ? haystack.lastIndexOf(needle, from)
        : haystack.indexOf(needle, from),
      match =
        index < 0
          ? backward
            ? haystack.lastIndexOf(needle)
            : haystack.indexOf(needle)
          : index;
    if (match < 0) {
      status.textContent = "No matching text.";
      return;
    }
    mode = "write";
    updateReading();
    editor.focus();
    editor.setSelectionRange(match, match + needle.length);
    refreshCopy();
  };
  search.onkeydown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      find(event.shiftKey);
    }
  };
  menuPanel.append(
    search,
    action("Previous match", () => find(true)),
    action("Next match", () => find(false)),
  );
  const copySelection = copyAction('Copy selection', selectedText, 'Selected text copied.', 'Could not copy selected text. Please try again.', () => !!pointerSelection || !!selectedText());
  copySelection.onpointerdown = () => { pointerSelection = selectedText(); refreshCopy(); };
  copySelection.onpointercancel = () => { pointerSelection = ''; refreshCopy(); };
  copySelection.onclick = event => {
    const value = event?.detail ? pointerSelection : selectedText(); pointerSelection = '';
    void copy(value, 'Selected text copied.', 'Could not copy selected text. Please try again.'); refreshCopy();
  };
  menuPanel.append(
    copyAction('Copy text', () => editor.value, 'Text copied.', 'Could not copy text. Please try again.'),
    copySelection,
    copyAction('Copy resource information', () => {
      const resource = session.snapshot().document?.resource;
      return resource ? `Title: ${resource.title}\nType: ${resource.kind}\nResource ID: ${resource.id}\nVersion: ${resource.version}\nProject ID: ${resource.project_id ?? 'Unassigned'}` : '';
    }, 'Resource information copied.', 'Could not copy resource information. Please try again.'),
  );
  if (!options.copyText) menuPanel.append(element('small', 'Native copying is unavailable in this surface.'));
  document.addEventListener('selectionchange', refreshCopy);
  editor.addEventListener('select', refreshCopy); editor.addEventListener('input', refreshCopy);
  tools.append(modeButton, menu);
  const showRename = action("Rename", () => {
    menu.open = false;
    rename.hidden = !rename.hidden;
    if (!rename.hidden) {
      title.value = session.snapshot().document?.resource.title ?? "";
      title.focus();
    }
  });
  menuPanel.append(showRename);
  if (options.openRelated) {
    const related = action("Related resources", () => {
      menu.open = false;
      run(async () => {
        await options.openRelated!(session.resourceId, related);
      });
    });
    menuPanel.append(related);
  }
  const submit = element("button", "Save title");
  submit.type = "submit";
  rename.append(title, submit);
  rename.hidden = true;
  rename.onsubmit = (event) => {
    event.preventDefault();
    if (!rename.reportValidity() || !port.renameNote) return;
    run(async () => {
      await session.flushEdits();
      const doc = session.snapshot().document!;
      await port.renameNote!({
        resourceId: session.resourceId,
        expectedResourceVersion: doc.resource.version,
        title: title.value,
      });
      await session.refresh();
      rename.hidden = true;
    });
  };
  const save = action("Save draft", () => run(() => session.flush())),
    local = action("Replace saved version with my text", () =>
      run(() => session.keepLocal()),
    ),
    saved = action("Use saved version", () => run(() => session.useSaved()));
  details.append(
    element("summary", "Review saved revisions"),
    element("h4", "Canonical saved text"),
    canonical,
    element("h4", "Saved recovery draft"),
    otherDraft,
  );
  recovery.append(save, local, saved, details);
  reading.hidden = true;
  root.append(tools, rename, status, copyStatus, recovery);
  // Reference cards lead with their citation; research leads with findings.
  root.append(
    ...(options.kind === "reference" ? [sources, reading] : [reading, sources]),
  );
  let latest = session.snapshot();
  const paint = (value: ReturnType<NoteSession["snapshot"]>) => {
    text = value.content;
    if (editor.value !== text) {
      const start = editor.selectionStart,
        end = editor.selectionEnd;
      editor.value = text;
      editor.setSelectionRange(
        Math.min(start, text.length),
        Math.min(end, text.length),
      );
    }
    editor.disabled = value.phase === "loading";
    root.dataset.noteState = value.phase;
    showRename.hidden = !value.document?.canRename || !port.renameNote;
    const messages = {
      loading: "Opening local document…",
      ready: "Saved locally.",
      recovered: "Recovered an unsaved draft. Review or save it.",
      saving: "Saving recovery draft…",
      saved: "Saved locally.",
      conflict:
        "Revision conflict. Your text is retained here. Review both versions before choosing.",
      error:
        "Save failed. Your text is retained here; retry when storage is available.",
    };
    status.textContent = messages[value.phase];
    recovery.hidden = !["recovered", "conflict", "error"].includes(value.phase);
    local.hidden = value.phase !== "conflict";
    save.hidden = value.phase === "conflict";
    canonical.textContent = value.document?.resource.content ?? "Unavailable";
    otherDraft.textContent =
      value.document?.draft?.content ?? "No saved recovery draft";
    updateReading();
    refreshCopy();
  };
  const unsubscribe = session.subscribe((value) => {
    latest = value;
    if (active) paint(value);
  });
  return {
    setPresentation(value: "workspace" | "focused") {
      if (disposed) return;
      root.dataset.documentPresentation = value;
    },
    setActive(value: boolean) {
      if (disposed) return;
      if (!value) { copyEpoch++; pointerSelection = ''; copyStatus.textContent = ''; }
      active = value;
      if (active) paint(latest);
      else menu.open = false;
      refreshCopy();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      copyEpoch++; copyButtons.clear();
      unsubscribe();
      delete root.dataset.noteState;
      delete root.dataset.documentKind;
      delete root.dataset.documentPresentation;
      document.removeEventListener("pointerdown", dismissMenu);
      document.removeEventListener('selectionchange', refreshCopy);
      editor.removeEventListener('select', refreshCopy); editor.removeEventListener('input', refreshCopy);
      tools.remove();
      rename.remove();
      status.remove();
      copyStatus.remove();
      recovery.remove();
      reading.remove();
      sources.remove();
      editor.hidden = false;
      if (editorLabel) editorLabel.hidden = false;
    },
  };
}
