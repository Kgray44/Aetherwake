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
  root.replaceChildren();
  let code: HTMLElement | null = null,
    list: HTMLOListElement | HTMLUListElement | null = null;
  const lines = content.split("\n");
  for (const line of lines.slice(0, 1500)) {
    if (/^\s*```/.test(line)) {
      if (code) code = null;
      else {
        const pre = element("pre");
        code = element("code");
        pre.append(code);
        root.append(pre);
      }
      list = null;
      continue;
    }
    if (code) {
      code.append(document.createTextNode(line + "\n"));
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line),
      item = /^\s*(?:([-*+])|\d+\.)\s+(.+)$/.exec(line);
    if (item) {
      const type = item[1] ? "ul" : "ol";
      if (!list || list.tagName.toLowerCase() !== type) {
        list = element(type);
        root.append(list);
      }
      list.append(element("li", item[2]));
      continue;
    }
    list = null;
    if (heading)
      root.append(element(("h" + heading[1].length) as "h1", heading[2]));
    else if (/^>\s?/.test(line))
      root.append(element("blockquote", line.replace(/^>\s?/, "")));
    else if (line.trim()) root.append(element("p", line));
  }
  if (lines.length > 1500)
    root.append(
      element(
        "p",
        "Reading preview is limited to 1,500 lines. Write mode retains the complete text.",
      ),
    );
}

export function sourceLinks(content: string): string[] {
  const values: string[] = [];
  for (const match of content.matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
    try {
      const url = new URL(match[0].replace(/[),.;!?\]}]+$/, ""));
      if (
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !values.includes(url.href)
      )
        values.push(url.href);
    } catch {
      /* A malformed source remains plain note text. */
    }
    if (values.length === 50) break;
  }
  return values;
}

/** Adds controls around the existing textarea. Its node, selection and input listener are retained. */
export function mountNoteExperience(
  root: HTMLElement,
  editor: HTMLTextAreaElement,
  session: NoteSession,
  port: NoteExperiencePort,
  options: {
    kind: string;
    active?: boolean;
    openExternal?(url: string): Promise<void>;
  },
) {
  const tools = element("div", "", "aw-note-tools"),
    status = element("p", "", "aw-note-status"),
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
  menuSummary.title = "Find, rename and document actions";
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
    mode: "write" | "read" = "write",
    text = "",
    rendered = "",
    pending = false;
  status.setAttribute("role", "status");
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
    rendered = text;
    sources.replaceChildren();
    if (!["research", "reference"].includes(options.kind)) return;
    sources.append(
      element("h3", "Sources in this document"),
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
        action("Copy link", () =>
          run(async () => {
            await navigator.clipboard.writeText(url);
            status.textContent = "Source link copied.";
          }),
        ),
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
  const submit = element("button", "Save title");
  submit.type = "submit";
  rename.append(title, submit);
  rename.hidden = true;
  rename.onsubmit = (event) => {
    event.preventDefault();
    if (!rename.reportValidity() || !port.renameNote) return;
    run(async () => {
      await session.flush();
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
  root.append(tools, rename, status, recovery, reading, sources);
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
      saved: "Saved in local SQLite.",
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
  };
  const unsubscribe = session.subscribe((value) => {
    latest = value;
    if (active) paint(value);
  });
  return {
    setActive(value: boolean) {
      active = value;
      if (active) paint(latest);
      else menu.open = false;
    },
    dispose() {
      disposed = true;
      unsubscribe();
      delete root.dataset.noteState;
      document.removeEventListener("pointerdown", dismissMenu);
      tools.remove();
      rename.remove();
      status.remove();
      recovery.remove();
      reading.remove();
      sources.remove();
      editor.hidden = false;
      if (editorLabel) editorLabel.hidden = false;
    },
  };
}
