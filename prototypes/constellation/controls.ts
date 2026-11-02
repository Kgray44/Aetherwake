export type SpatialCommand = {
  id: string;
  title: string;
  hint: string;
  aliases?: string;
  enabled?: boolean;
  run: () => unknown;
};

/** Small, on-demand glass surfaces. Navigation remains direct manipulation. */
export function spatialControls(
  root: HTMLElement,
  options: {
    commands: () => SpatialCommand[];
    destinations: (query: string) => SpatialCommand[];
    history: () => SpatialCommand[];
    dirty: () => void;
    report: (error: unknown) => void;
    onOpen?: () => void;
    overview: () => boolean;
    afterRun?: () => void;
  },
) {
  const element = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text = "",
    className = "",
  ) => {
    const e = document.createElement(tag);
    e.textContent = text;
    e.className = className;
    return e;
  };
  const bar = element("nav", "", "aw-constellation-bar aw-glass"),
    breadcrumb = element("span", "", "aw-location");
  bar.setAttribute("aria-label", "Spatial navigation");
  breadcrumb.setAttribute("aria-live", "polite");
  const toggle = element("button", "⋯", "aw-quiet-control"),
    info = element("button", "i", "aw-quiet-control aw-info-control");
  toggle.type = info.type = "button";
  toggle.setAttribute("aria-label", "Commands and destinations");
  toggle.title = "Commands and destinations · Ctrl K";
  info.setAttribute("aria-label", "Navigation guide");
  info.title = "Navigation guide · F1";
  const drawer = element("aside", "", "aw-destinations aw-glass"),
    heading = element("h2", "Go somewhere. Do something."),
    search = element("input"),
    results = element("div", "", "aw-destination-results"),
    footer = element(
      "p",
      "↑ ↓ choose · Enter run · Esc close",
      "aw-panel-hint",
    );
  drawer.hidden = true;
  drawer.setAttribute("aria-label", "Commands and destinations");
  search.type = "search";
  search.placeholder = "Find a destination or command…";
  search.setAttribute("aria-label", "Search destinations and commands");
  search.setAttribute("role", "combobox");
  search.setAttribute("aria-autocomplete", "list");
  search.setAttribute("aria-expanded", "true");
  results.id = "aw-spatial-command-results";
  results.setAttribute("role", "listbox");
  search.setAttribute("aria-controls", results.id);
  drawer.append(heading, search, results, footer);
  const guide = element("aside", "", "aw-navigation-guide aw-glass");
  guide.hidden = true;
  guide.tabIndex = -1;
  guide.setAttribute("role", "dialog");
  guide.setAttribute("aria-modal", "false");
  guide.setAttribute("aria-label", "Navigation guide");
  guide.append(
    element("span", "MAKE YOURSELF AT HOME", "aw-panel-eyebrow"),
    element("h2", "Move naturally."),
    element(
      "p",
      "Explore with your mouse. Keep your place with the keyboard.",
      "aw-guide-intro",
    ),
  );
  const list = element("dl");
  const instructions = [
    ["Look around", "Drag empty space"],
    ["Pan", "Shift + drag · middle mouse drag"],
    ["Move closer / farther", "Scroll · + / −"],
    ["Enter a destination", "Scroll toward a body · double-click · Enter"],
    ["Move a body", "Alt + drag · release to pin"],
    ["Return / move out", "Backspace / Alt + ↑"],
    ["Focus / recenter", "F / Home"],
    ["Find anything", "Ctrl + K · right-click for commands"],
  ];
  for (const [title, gesture] of instructions) {
    const row = element("div");
    row.append(element("dt", title), element("dd", gesture));
    list.append(row);
  }
  guide.append(
    list,
    element(
      "p",
      "Arrow keys pan · Shift + arrows orbit · Alt + ← / → moves through history · I inspects selection. Escape stops movement and closes panels.",
      "aw-guide-footnote",
    ),
    element("p", "Esc to close", "aw-panel-hint"),
  );
  info.setAttribute("aria-controls", "aw-navigation-guide");
  guide.id = "aw-navigation-guide";
  toggle.setAttribute("aria-controls", "aw-spatial-commands");
  drawer.id = "aw-spatial-commands";
  bar.append(breadcrumb, toggle, info);
  root.append(bar, drawer, guide);
  let active = 0,
    entries: SpatialCommand[] = [],
    showingHistory = false,
    contextual = false,
    opener: HTMLElement | null = null;
  const sync = () => {
    toggle.setAttribute("aria-expanded", String(!drawer.hidden));
    info.setAttribute("aria-expanded", String(!guide.hidden));
    options.dirty();
  };
  function close(focus = false) {
    const wasOpen = !drawer.hidden || !guide.hidden;
    drawer.hidden = guide.hidden = true;
    sync();
    if (focus && wasOpen) {
      if (opener?.isConnected && opener.getClientRects().length) opener.focus();
      else
        (
          root.querySelector<HTMLElement>(".aw-spatial-field:not([hidden])") ??
          toggle
        ).focus();
    }
  }
  const select = (index: number) => {
    active = Math.max(0, Math.min(entries.length - 1, index));
    [...results.children].forEach((row, i) =>
      row.setAttribute("aria-selected", String(i === active)),
    );
    const row = results.children[active] as HTMLElement | undefined;
    if (row) {
      search.setAttribute("aria-activedescendant", row.id);
      row.scrollIntoView({ block: "nearest" });
    } else search.removeAttribute("aria-activedescendant");
  };
  async function run(entry: SpatialCommand) {
    if (entry.enabled === false) return;
    close(true);
    try {
      await entry.run();
      options.afterRun?.();
    } catch (error) {
      options.report(error);
    }
  }
  function refresh() {
    if (drawer.hidden) return;
    const query = search.value.trim().toLocaleLowerCase(),
      commands = options
        .commands()
        .filter(
          (c) =>
            c.enabled !== false &&
            `${c.title} ${c.aliases ?? ""}`.toLocaleLowerCase().includes(query),
        );
    const contextOrder = [
      "open",
      "explore",
      "inspect",
      "branch",
      "relationships",
      "create",
      "link",
    ];
    const contextCommands = commands.toSorted(
      (a, b) =>
        (contextOrder.indexOf(a.id) < 0 ? 99 : contextOrder.indexOf(a.id)) -
        (contextOrder.indexOf(b.id) < 0 ? 99 : contextOrder.indexOf(b.id)),
    );
    entries = (
      showingHistory
        ? options
            .history()
            .filter((entry) => entry.title.toLocaleLowerCase().includes(query))
        : query
          ? [...commands, ...options.destinations(query)]
          : contextual
            ? contextCommands.slice(0, 5)
            : [...options.destinations("").slice(0, 3), ...commands.slice(0, 2)]
    ).slice(0, 6);
    heading.textContent = showingHistory
      ? "Your recent places"
      : "Go somewhere. Do something.";
    results.replaceChildren();
    for (const [index, entry] of entries.entries()) {
      const row = element("button", "", "aw-command-row");
      row.type = "button";
      row.tabIndex = -1;
      row.id = `aw-spatial-option-${index}`;
      row.setAttribute("role", "option");
      row.dataset.command = entry.id;
      row.setAttribute("aria-label", entry.title);
      row.append(element("span", entry.title), element("small", entry.hint));
      row.onclick = () => void run(entry);
      results.append(row);
    }
    if (!entries.length)
      results.append(
        element(
          "p",
          "No matching destinations or commands.",
          "aw-empty-results",
        ),
      );
    select(0);
    options.dirty();
  }
  function openPalette(query?: string, context = false) {
    options.onOpen?.();
    opener = document.activeElement as HTMLElement;
    guide.hidden = true;
    drawer.hidden = false;
    showingHistory = false;
    contextual = context;
    if (query !== undefined) search.value = query;
    refresh();
    sync();
    search.focus();
    search.select();
  }
  function openGuide() {
    options.onOpen?.();
    const overview = options.overview();
    guide.dataset.scope = overview ? "constellation" : "workspace-entry";
    guide.querySelector("h2")!.textContent = overview
      ? "Move naturally."
      : "Explore Constellation.";
    guide.querySelector(".aw-guide-intro")!.textContent = overview
      ? "Explore with your mouse. Keep your place with the keyboard."
      : "Scroll out over empty workspace space to reveal its constellation. You can also choose Constellation from Workspace actions (⋯). The gestures below apply in the spatial view.";
    const opening = guide.hidden;
    opener = document.activeElement as HTMLElement;
    close();
    guide.hidden = !opening;
    sync();
    if (opening) guide.focus();
    else opener?.focus();
  }
  toggle.onclick = () => (drawer.hidden ? openPalette() : close(true));
  info.onclick = openGuide;
  search.oninput = () => {
    refresh();
  };
  search.onkeydown = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      select(active + (e.key === "ArrowDown" ? 1 : -1));
    }
    if (e.key === "Enter" && entries[active]) {
      e.preventDefault();
      void run(entries[active]);
    }
  };
  const keydown = (e: KeyboardEvent) => {
    if (e.defaultPrevented || root.ownerDocument.querySelector("dialog[open]"))
      return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      if (!options.overview() && drawer.hidden) {
        if (!guide.hidden) close(true);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      openPalette();
    } else if (e.key === "F1") {
      e.preventDefault();
      e.stopPropagation();
      openGuide();
    } else if (e.key === "Escape" && (!drawer.hidden || !guide.hidden)) {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    }
  };
  const outside = (e: PointerEvent) => {
    if (
      ![bar, drawer, guide].some((p) => p.contains(e.target as globalThis.Node))
    )
      close();
  };
  // Capture before the host's global bubble shortcuts. In working workspaces
  // those shortcuts remain with the application shell and its editors.
  root.ownerDocument.addEventListener("keydown", keydown, true);
  root.ownerDocument.addEventListener("pointerdown", outside);
  sync();
  return {
    bar,
    breadcrumb,
    toggle,
    info,
    drawer,
    guide,
    search,
    results,
    refresh,
    openPalette,
    openGuide,
    close,
    history() {
      openPalette("");
      showingHistory = true;
      refresh();
    },
    dispose() {
      root.ownerDocument.removeEventListener("keydown", keydown, true);
      root.ownerDocument.removeEventListener("pointerdown", outside);
      bar.remove();
      drawer.remove();
      guide.remove();
    },
  };
}
