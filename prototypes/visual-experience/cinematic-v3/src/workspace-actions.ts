import type {
  DesktopSnapshot,
  Geometry,
  OrganizationMode,
  OrganizationUpdate,
  StructuredPreset,
} from "../../../application-contract/contracts.ts";
import type { MotionCoordinator, Pose } from "./motion.ts";

export type WorkspaceAction =
  | "checkpoint"
  | "restore"
  | "undo"
  | "redo"
  | "resolve"
  | "bring-all";
export interface WorkspaceOptimizationReview {
  workspaceId: string;
  layoutRevision: number;
  bounds: Omit<Geometry, "z">;
  cards: { blockId: string; from: Pick<Geometry, "x" | "y">; to: Pick<Geometry, "x" | "y"> }[];
  unresolvedPlacementIds: string[];
}
export interface WorkspaceActionsOptions {
  snapshot: DesktopSnapshot;
  motion: MotionCoordinator;
  wake(): void;
  act(action: WorkspaceAction): Promise<DesktopSnapshot | void>;
  changeMode(mode: OrganizationMode): Promise<DesktopSnapshot | void>;
  locateBlock(id: string): Promise<void>;
  locateVela(): Promise<void>;
  lockVela(input: {
    expectedVersion: number;
    locked: boolean;
  }): Promise<DesktopSnapshot | void>;
  resources(): Promise<void>;
  constellation(): Promise<void>;
  stream(): Promise<void>;
  connections(): Promise<void>;
  configureOrganization?(input: {
    organization: OrganizationUpdate;
    expectedRevision: number;
  }): Promise<DesktopSnapshot | void>;
  previewOrganization?(update: OrganizationUpdate): void;
  cancelOrganizationPreview?(): void;
  applyStructuredPreset?(
    preset: StructuredPreset,
  ): Promise<DesktopSnapshot | void>;
  previewStructuredPreset?(preset: StructuredPreset): void;
  optimization?: {
    limit: number;
    preview(ids: string[]): WorkspaceOptimizationReview;
    apply(review: WorkspaceOptimizationReview): Promise<DesktopSnapshot | void>;
    cancel(): void;
  };
}
const neutral: Pose = { x: 0, y: 0, w: 0, h: 0, lift: 0, yaw: 0, opacity: 1 };
let sequence = 0;

/** Content only. The host owns its contextual shell and opening/closing motion.
 * Call frame() after the SAME MotionCoordinator.step(); this owns no scheduler,
 * canonical state, action policy, layout calculation or application-wide lock. */
export function mountWorkspaceActions(
  container: HTMLElement,
  options: WorkspaceActionsOptions,
) {
  const doc = container.ownerDocument,
    prefix = `workspace-actions:${++sequence}:`;
  let snapshot = options.snapshot,
    disposed = false,
    errorText = "",
    lastStatus = "";
  const pending = new Set<string>(),
    listeners = new Map<HTMLElement, (() => void)[]>(),
    keys = new Set<string>();
  const controls = new Map<
    HTMLElement,
    {
      key: string;
      hover: boolean;
      focus: boolean;
      pressed: boolean;
      selected: boolean;
      disabled: boolean;
      busy: boolean;
      signature: string;
    }
  >();
  const rows = new Map<
    string,
    {
      button: HTMLButtonElement;
      title: HTMLElement;
      kind: HTMLElement;
      label: string;
    }
  >();
  const node = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className = "",
    text = "",
  ) => {
    const n = doc.createElement(tag);
    n.className = className;
    n.textContent = text;
    return n;
  };
  const listen = (n: HTMLElement, type: string, fn: (e: Event) => void) => {
    n.addEventListener(type, fn);
    listeners.set(n, [
      ...(listeners.get(n) ?? []),
      () => n.removeEventListener(type, fn),
    ]);
  };
  const write = (n: HTMLElement, name: string, value: string) => {
    if (n.style.getPropertyValue(name) !== value)
      n.style.setProperty(name, value);
  };
  const addBody = (name: string, pose: Pose) => {
    const key = prefix + name;
    options.motion.add(key, pose);
    keys.add(key);
    return key;
  };
  const shell = node("section", "aw-workspace-actions");
  shell.setAttribute("aria-label", "Workspace actions");
  const name = node("p", "aw-wa-name"),
    modeGroup = node("div", "aw-wa-modes"),
    essentials = node("div", "aw-wa-essentials");
  modeGroup.setAttribute("role", "group");
  modeGroup.setAttribute("aria-label", "Workspace organization");
  const status = node("p", "aw-wa-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.hidden = true;

  function material(n: HTMLElement, cause = "state") {
    const c = controls.get(n)!;
    const p = {
      ...neutral,
      x: Number(c.hover),
      y: Number(c.focus),
      w: Number(c.selected),
      h: Number(c.pressed && !c.disabled),
      lift: Number(c.disabled),
      yaw: Number(c.busy),
    };
    const signature = [p.x, p.y, p.w, p.h, p.lift, p.yaw].join(":");
    if (c.signature === signature) return;
    c.signature = signature;
    options.motion.target(c.key, p, `workspace control ${cause}`);
    options.wake();
  }
  function register(n: HTMLElement, action: string) {
    n.dataset.action = action;
    controls.set(n, {
      key: addBody(action, neutral),
      hover: false,
      focus: false,
      pressed: false,
      selected: false,
      disabled: false,
      busy: false,
      signature: "",
    });
    const event = (type: string, change: () => void) =>
      listen(n, type, () => {
        if (disposed) return;
        change();
        material(n, type);
      });
    event("pointerenter", () => {
      controls.get(n)!.hover = true;
    });
    event("pointerleave", () => {
      const c = controls.get(n)!;
      c.hover = c.pressed = false;
    });
    event("pointerdown", () => {
      controls.get(n)!.pressed = true;
    });
    event("pointerup", () => {
      controls.get(n)!.pressed = false;
    });
    event("pointercancel", () => {
      controls.get(n)!.pressed = false;
    });
    event("focus", () => {
      controls.get(n)!.focus = true;
    });
    event("blur", () => {
      const c = controls.get(n)!;
      c.focus = c.pressed = false;
    });
    listen(n, "keydown", (e) => {
      if ([" ", "Enter"].includes((e as KeyboardEvent).key)) {
        controls.get(n)!.pressed = true;
        material(n, "key press");
      }
    });
    listen(n, "keyup", () => {
      controls.get(n)!.pressed = false;
      material(n, "key release");
    });
    return n;
  }
  function state(
    button: HTMLButtonElement,
    disabled: boolean,
    selected = false,
    busy = false,
  ) {
    button.disabled = disabled;
    button.setAttribute("aria-busy", String(busy));
    const c = controls.get(button)!;
    c.disabled = disabled;
    c.selected = selected;
    c.busy = busy;
    material(button);
  }
  const active = () =>
    snapshot.workspaces.find((w) => w.id === snapshot.activeWorkspaceId);
  const organizationBusy = () =>
    [...pending].some(
      (k) =>
        k.startsWith("mode-") || k.startsWith("preset-") || k === "grid-apply",
    );
  function showStatus() {
    const text = errorText || lastStatus;
    if (status.textContent !== text) status.textContent = text;
    status.hidden = !text;
    status.dataset.state = errorText ? "error" : "status";
    shell.dataset.state = !active()
      ? "unavailable"
      : pending.size
        ? "pending"
        : errorText
          ? "error"
          : "ready";
  }
  async function run(
    key: string,
    operation: () => Promise<DesktopSnapshot | void>,
    success = "",
  ) {
    if (disposed || pending.has(key)) return;
    pending.add(key);
    errorText = "";
    lastStatus = "";
    paint();
    try {
      const next = await operation();
      if (disposed) return;
      if (next) update(next);
      lastStatus = success;
    } catch (error) {
      if (!disposed) {
        errorText =
          error instanceof Error
            ? error.message.replaceAll("_", " ").slice(0, 240)
            : "This action could not be completed.";
        if (key === "grid-apply" && /stale|conflict|revision/i.test(errorText))
          gridRejected = true;
      }
    } finally {
      pending.delete(key);
      if (!disposed) {
        paint();
        frame();
      }
    }
  }
  function button(text: string, action: string, perform: () => void) {
    const b = register(
      node("button", "aw-wa-control", text),
      action,
    ) as HTMLButtonElement;
    b.type = "button";
    listen(b, "click", () => {
      if (!disposed && !b.disabled && !b.closest("[inert]")) perform();
    });
    return b;
  }
  const modes = (["fluid", "freeform", "structured"] as const).map((mode) => {
    const b = button(
      mode[0].toUpperCase() + mode.slice(1),
      "mode-" + mode,
      () => {
        if (snapshot.organization?.mode !== mode)
          void run("mode-" + mode, () => options.changeMode(mode));
      },
    );
    b.setAttribute("aria-pressed", "false");
    modeGroup.append(b);
    return { mode, button: b };
  });
  listen(modeGroup, "keydown", (e) => {
    const event = e as KeyboardEvent,
      i = modes.findIndex((m) => m.button === doc.activeElement);
    if (
      i < 0 ||
      !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
    )
      return;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? 2
          : (i + (event.key === "ArrowLeft" ? 2 : 1)) % 3;
    if (!modes[next].button.disabled) {
      event.preventDefault();
      modes[next].button.focus();
    }
  });
  const frameAll = button(
    "Frame all",
    "bring-all",
    () => void run("bring-all", () => options.act("bring-all")),
  );
  const resolve = button(
    "Make room",
    "resolve",
    () => void run("resolve", () => options.act("resolve")),
  );
  essentials.append(frameAll, resolve);

  function disclosure(
    title: string,
    id: string,
    onOpen?: () => void,
    onClose?: () => void,
  ) {
    let open = false;
    const wrap = node("section", "aw-wa-group"),
      toggle = button(title, id + "-toggle", () => set(!open));
    const mark = node("span", "aw-wa-chevron", "⌄");
    mark.setAttribute("aria-hidden", "true");
    toggle.append(mark);
    toggle.classList.add("aw-wa-disclosure-toggle");
    toggle.setAttribute("aria-expanded", "false");
    const body = node("div", "aw-workspace-actions-disclosure"),
      clip = node("div", "aw-wa-clip"),
      content = node("div", "aw-wa-disclosure-content");
    body.id = prefix + id;
    body.hidden = true;
    body.inert = true;
    body.setAttribute("aria-hidden", "true");
    body.setAttribute("role", "region");
    body.setAttribute("aria-label", title);
    toggle.setAttribute("aria-controls", body.id);
    clip.append(content);
    body.append(clip);
    wrap.append(toggle, body);
    const key = addBody(id + "-disclosure", { ...neutral, opacity: 0 });
    function set(value: boolean) {
      if (disposed || open === value) return;
      if (!value && body.contains(doc.activeElement)) toggle.focus();
      open = value;
      toggle.setAttribute("aria-expanded", String(open));
      body.inert = !open;
      body.setAttribute("aria-hidden", String(!open));
      if (open) {
        body.hidden = false;
        onOpen?.();
      } else onClose?.();
      controls.get(toggle)!.selected = open;
      material(toggle, "disclosure");
      options.motion.target(
        key,
        { ...neutral, opacity: open ? 1 : 0 },
        "workspace disclosure " + (open ? "open" : "close"),
      );
      options.wake();
      frame();
    }
    const paint = () => {
      const raw = options.motion.pose(key).opacity,
        progress = Math.max(0, Math.min(1, raw));
      write(body, "grid-template-rows", `${progress}fr`);
      write(body, "opacity", String(progress));
      write(mark, "transform", `rotate(${progress * 180}deg)`);
      if (
        !open &&
        raw === 0 &&
        options.motion.bodies.get(key)!.channels.opacity.velocity === 0
      )
        body.hidden = true;
    };
    return {
      wrap,
      toggle,
      body,
      content,
      set,
      paint,
      get open() {
        return open;
      },
    };
  }
  const history = disclosure("Layout history", "history");
  history.content.classList.add("aw-wa-history");
  const historyButtons = (
    [
      ["undo", "Undo"],
      ["redo", "Redo"],
      ["checkpoint", "Save checkpoint"],
      ["restore", "Restore checkpoint"],
    ] as const
  ).map(([action, title]) => {
    const b = button(title, action, () => {
      if (history.open)
        void run(
          action,
          () => options.act(action),
          action === "checkpoint" ? "Checkpoint saved." : "",
        );
    });
    history.content.append(b);
    return { action, button: b };
  });
  const find = disclosure("Find in workspace", "find", () => renderRows());
  const search = register(
    node("input", "aw-wa-search"),
    "find-search",
  ) as HTMLInputElement;
  search.type = "search";
  search.placeholder = "Find a block";
  search.setAttribute("aria-label", "Find a block in this workspace");
  const list = node("div", "aw-wa-find-list"),
    empty = node("p", "aw-wa-empty", "No matching blocks.");
  const vela = button("Vela", "find-vela", () => {
    if (find.open) void run("find-vela", options.locateVela);
  });
  const lock = button("Lock Vela placement", "lock-vela", () => {
    const p = snapshot.presence;
    if (find.open && p && p.workspaceId === snapshot.activeWorkspaceId)
      void run("lock-vela", () =>
        options.lockVela({ expectedVersion: p.version, locked: !p.locked }),
      );
  });
  lock.setAttribute("aria-pressed", "false");
  const presence = node("div", "aw-wa-presence");
  presence.append(vela, lock);
  find.content.append(search, presence, list, empty);
  listen(search, "input", () => renderRows());

  const grid =
    options.configureOrganization || options.applyStructuredPreset
      ? disclosure(
          "Grid and spacing",
          "grid",
          () => {
            if (gridWorkspace === null || (!gridDirty && !gridConflict))
              loadGrid();
            checkGrid();
          },
          () => cancelPreview(),
        )
      : null;
  const fields = new Map<string, HTMLInputElement>();
  let gridWorkspace: string | null = null,
    gridRevision: number | null = null,
    gridDirty = false,
    gridGeneration = 0,
    gridConflict = false,
    gridRejected = false,
    previewOwned = false,
    previewGeneration = 0;
  const gridForm = node("form", "aw-wa-grid-form"),
    gridNotice = node("p", "aw-wa-grid-notice");
  gridNotice.setAttribute("role", "status");
  const gridApply = button("Apply spacing", "grid-apply", () => {}),
    gridReload = button("Load current settings", "grid-reload", () =>
      loadGrid(),
    ),
    gridCancel = button("Cancel preview", "grid-cancel", () => {
      cancelPreview();
      showStatus();
    });
  gridApply.type = "submit";
  if (grid && options.configureOrganization) {
    const fieldGroup = node("div", "aw-wa-grid-fields");
    for (const [key, title, min, max] of [
      ["gap", "Minimum gap", 0, 256],
      ["columns", "Columns · auto if blank", 1, 12],
      ["rowHeight", "Row height", 32, 512],
      ["rowGap", "Row spacing", 0, 256],
      ["columnGap", "Column spacing", 0, 256],
      ["margin", "Margin", 0, 256],
    ] as const) {
      const label = node("label", "aw-wa-grid-field", title),
        input = register(node("input"), "grid-" + key) as HTMLInputElement;
      input.type = "number";
      input.min = String(min);
      input.max = String(max);
      input.step = "1";
      input.dataset.organizationField = key;
      if (key !== "columns") input.required = true;
      fields.set(key, input);
      label.append(input);
      fieldGroup.append(label);
      listen(input, "input", () => {
        if (!grid.open) return;
        gridDirty = true;
        gridGeneration++;
        checkGrid();
        const value = readGrid();
        if (value && !gridConflict) {
          try {
            if (options.previewOrganization) {
              previewOwned = true;
              previewGeneration++;
              options.previewOrganization(value);
              checkGrid();
            }
          } catch {
            errorText = "The preview is unavailable. Your edits are kept.";
            showStatus();
          }
        }
      });
    }
    const actions = node("div", "aw-wa-grid-actions");
    actions.append(gridApply, gridCancel, gridReload);
    gridForm.append(fieldGroup, gridNotice, actions);
    grid.content.append(gridForm);
    listen(gridForm, "submit", (event) => {
      event.preventDefault();
      const organization = readGrid(),
        expectedRevision = gridRevision,
        generation = gridGeneration;
      if (
        !grid.open ||
        !organization ||
        expectedRevision === null ||
        gridApply.disabled ||
        gridConflict
      )
        return;
      void run(
        "grid-apply",
        async () => {
          // The host owns any preview it creates internally while committing.
          const preview = previewGeneration;
          const next = await options.configureOrganization!({
            organization,
            expectedRevision,
          });
          if (preview === previewGeneration) previewOwned = false;
          if (
            !disposed &&
            next &&
            next.activeWorkspaceId === gridWorkspace &&
            next.organization &&
            (next.organization.revision === expectedRevision ||
              next.organization.revision === expectedRevision + 1) &&
            next.revision >= snapshot.revision
          ) {
            gridRevision = next.organization.revision;
            gridConflict = gridRejected = false;
            if (generation === gridGeneration) gridDirty = false;
          }
          return next;
        },
        "Spacing saved.",
      );
    });
  }
  const presets: { preset: StructuredPreset; button: HTMLButtonElement }[] = [];
  if (grid && options.applyStructuredPreset) {
    const group = node("div", "aw-wa-presets");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Structured arrangements");
    for (const [preset, title] of [
      ["balanced", "Balanced grid"],
      ["focus", "Focus and companions"],
      ["development", "Development"],
      ["research", "Research"],
    ] as const) {
      const b = button(title, "preset-" + preset, () => {
        if (grid.open)
          void run("preset-" + preset, async () => {
            let preview = previewGeneration;
            if (options.previewStructuredPreset) {
              preview = ++previewGeneration;
              previewOwned = true;
              options.previewStructuredPreset(preset);
            }
            const next = await options.applyStructuredPreset!(preset);
            if (preview === previewGeneration) previewOwned = false;
            return next;
          });
      });
      b.setAttribute("aria-pressed", "false");
      presets.push({ preset, button: b });
      group.append(b);
    }
    grid.content.append(group);
  }
  function cancelPreview() {
    if (!previewOwned) return true;
    try {
      options.cancelOrganizationPreview?.();
      previewOwned = false;
      previewGeneration++;
      return true;
    } catch {
      if (!disposed) {
        errorText = "The preview could not be cleared. Your edits are kept.";
        showStatus();
      }
      return false;
    }
  }
  function loadGrid() {
    const o = snapshot.organization;
    if (!o || !active()) return;
    const canceled = cancelPreview();
    gridWorkspace = snapshot.activeWorkspaceId;
    gridRevision = o.revision;
    gridDirty = gridConflict = gridRejected = false;
    gridGeneration++;
    for (const [key, input] of fields)
      input.value = String(
        key === "gap"
          ? o.gap
          : key === "columns"
            ? (o.structured.columnCount ?? "")
            : o.structured[
                key as "rowHeight" | "rowGap" | "columnGap" | "margin"
              ],
      );
    if (canceled) errorText = "";
    checkGrid();
    showStatus();
  }
  function readGrid(): OrganizationUpdate | null {
    if (!grid || gridWorkspace !== snapshot.activeWorkspaceId) return null;
    const values: Record<string, number> = {};
    for (const [key, input] of fields) {
      if (key === "columns" && !input.value.trim()) continue;
      const value = Number(input.value);
      if (
        !input.value.trim() ||
        !Number.isInteger(value) ||
        value < Number(input.min) ||
        value > Number(input.max)
      )
        return null;
      values[key] = value;
    }
    return {
      gap: values.gap,
      structured: {
        columnCount: values.columns ?? null,
        rowHeight: values.rowHeight,
        rowGap: values.rowGap,
        columnGap: values.columnGap,
        margin: values.margin,
      },
    };
  }
  function checkGrid() {
    if (!grid) return;
    if (gridWorkspace !== null)
      gridConflict =
        gridRejected ||
        gridWorkspace !== snapshot.activeWorkspaceId ||
        gridRevision !== snapshot.organization?.revision;
    const notice = gridConflict
      ? "Layout changed. Your edits are kept. Load current settings before applying."
      : gridDirty && !readGrid()
        ? "Check the spacing values."
        : "";
    if (gridNotice.textContent !== notice) gridNotice.textContent = notice;
    gridNotice.hidden = !gridNotice.textContent;
    gridReload.hidden = !gridConflict;
    state(
      gridApply,
      !active() ||
        !grid.open ||
        gridConflict ||
        !readGrid() ||
        organizationBusy(),
      false,
      pending.has("grid-apply"),
    );
    state(gridReload, !active() || pending.has("grid-apply"));
    state(gridCancel, organizationBusy());
    gridCancel.hidden = !previewOwned;
  }
  const optimization = options.optimization;
  const optimize = optimization ? disclosure("Optimize selected cards", "optimize", () => paintOptimization(), () => clearOptimization()) : null;
  const selectedCards = new Set<string>();
  const optimizationRows = new Map<string, { label: HTMLLabelElement; checkbox: HTMLInputElement; title: HTMLElement }>();
  let optimizationReview: WorkspaceOptimizationReview | null = null;
  let optimizationNotice = "";
  const optimizationChoices = node("div", "aw-wa-optimize-choices");
  optimizationChoices.setAttribute("role", "group");
  optimizationChoices.setAttribute("aria-label", "Cards to optimize");
  const optimizationStatus = node("p", "aw-wa-grid-notice");
  optimizationStatus.setAttribute("role", "status");
  const optimizationResult = node("section", "aw-wa-optimize-review");
  const optimizationBounds = node("p", "aw-wa-grid-notice");
  const optimizationMoves = node("ul", "aw-wa-optimize-moves");
  optimizationResult.append(optimizationBounds, optimizationMoves);
  const reviewOptimization = button("Preview optimization", "optimize-preview", () => {
    if (!optimization || !selectedCards.size) return;
    clearOptimization();
    try {
      optimizationReview = optimization.preview([...selectedCards]);
      optimizationNotice = optimizationReview.cards.some(({ from, to }) => from.x !== to.x || from.y !== to.y)
        ? "Review the proposed positions before applying."
        : optimizationReview.unresolvedPlacementIds.length
          ? "No selected card can move within the reviewed view."
          : "The selected cards already fit in the reviewed view.";
    } catch {
      optimizationNotice = "The selected arrangement could not be previewed. Check the current layout and try again.";
    }
    paintOptimization();
  });
  const applyOptimization = button("Apply optimization", "optimize-apply", () => {
    if (!optimization || !optimizationReview) return;
    const review = optimizationReview;
    const unresolved = review.unresolvedPlacementIds.length;
    void run("optimize-apply", async () => {
      try { return await optimization.apply(review); }
      finally { clearOptimization(); }
    }, unresolved
      ? `Optimization applied. ${unresolved} selected cards still need room. Undo is available in Layout history.`
      : "Optimization applied. Undo is available in Layout history.");
  });
  const cancelOptimization = button("Cancel optimization preview", "optimize-cancel", () => {
    clearOptimization();
    paintOptimization();
    reviewOptimization.focus();
  });
  if (optimize) {
    const actions = node("div", "aw-wa-grid-actions");
    actions.append(reviewOptimization, applyOptimization, cancelOptimization);
    optimize.content.append(optimizationChoices, optimizationStatus, optimizationResult, actions);
  }
  function clearOptimization(notice = "", releasePreview = true) {
    const reviewed = optimizationReview;
    optimizationReview = null;
    optimizationNotice = notice;
    if (reviewed && releasePreview) optimization?.cancel();
  }
  function paintOptimization() {
    if (!optimize || !optimization || !optimize.open) return;
    const busy = pending.has("optimize-apply");
    const movable = [...workspaceBlockRows()].filter(({ block }) => !block.locked && !block.minimized);
    const titles = new Map(movable.map(({ block, title }) => [block.id, title]));
    if ([...selectedCards].some((id) => !titles.has(id))) {
      for (const id of selectedCards) if (!titles.has(id)) selectedCards.delete(id);
      clearOptimization("Card availability changed. Preview the current selection.");
    }
    for (const [id, row] of optimizationRows) {
      if (titles.has(id)) continue;
      if (doc.activeElement === row.checkbox) optimize.toggle.focus();
      row.label.remove();
      optimizationRows.delete(id);
    }
    for (const [id, title] of titles) {
      let row = optimizationRows.get(id);
      if (!row) {
        const label = node("label", "aw-wa-optimize-card"), checkbox = node("input"), name = node("span");
        checkbox.type = "checkbox";
        checkbox.dataset.optimizeBlock = id;
        checkbox.addEventListener("change", () => {
          if (!optimize.open || checkbox.disabled) return;
          if (checkbox.checked) selectedCards.add(id);
          else selectedCards.delete(id);
          clearOptimization();
          paintOptimization();
        });
        label.append(checkbox, name);
        optimizationChoices.append(label);
        row = { label, checkbox, title: name };
        optimizationRows.set(id, row);
      }
      if (row.title.textContent !== title) row.title.textContent = title;
      row.checkbox.checked = selectedCards.has(id);
      row.checkbox.disabled = busy || (!row.checkbox.checked && selectedCards.size >= optimization.limit);
    }
    optimizationStatus.textContent = optimizationNotice || (movable.length
      ? `${selectedCards.size} selected · Choose up to ${optimization.limit} movable cards.`
      : "There are no movable cards in this workspace.");
    const review = optimizationReview;
    optimizationResult.hidden = !review;
    applyOptimization.hidden = cancelOptimization.hidden = !review;
    state(reviewOptimization, !active() || !selectedCards.size || pending.size > 0);
    state(applyOptimization, !review || pending.size > 0 || !review.cards.some(({ from, to }) => from.x !== to.x || from.y !== to.y), false, busy);
    state(cancelOptimization, busy);
    if (!review) return;
    const { x, y, width, height } = review.bounds;
    const coordinate = (value: number) => Number(value.toFixed(2));
    optimizationBounds.textContent = `Reviewed view · Origin (${coordinate(x)}, ${coordinate(y)}) · ${coordinate(width)} × ${coordinate(height)} workspace units`;
    optimizationMoves.replaceChildren(...review.cards.map(({ blockId, from, to }) => {
      const changed = from.x !== to.x || from.y !== to.y;
      const positions = changed ? `(${coordinate(from.x)}, ${coordinate(from.y)}) → (${coordinate(to.x)}, ${coordinate(to.y)})` : "Current position";
      const unresolved = review.unresolvedPlacementIds.includes(blockId) ? " · Needs room" : "";
      const row = node("li", "", `${titles.get(blockId) ?? blockId} · ${positions}${unresolved}`);
      row.dataset.optimizeReviewBlock = blockId;
      return row;
    }));
  }
  const destinations = node("nav", "aw-wa-destinations");
  destinations.setAttribute("aria-label", "Workspace destinations");
  for (const key of [
    "resources",
    "constellation",
    "stream",
    "connections",
  ] as const) {
    const title = {
      resources: "Resources",
      constellation: "Constellation",
      stream: "Activity",
      connections: "Connections",
    }[key];
    destinations.append(button(title, key, () => void run(key, options[key])));
  }
  shell.append(name, modeGroup, essentials, history.wrap, find.wrap);
  if (grid) shell.append(grid.wrap);
  if (optimize) shell.append(optimize.wrap);
  shell.append(destinations, status);
  container.append(shell);

  function* workspaceBlockRows() {
    for (const block of snapshot.blocks) {
      if (
        block.workspace_id !== snapshot.activeWorkspaceId ||
        block.subjectState === "archived" ||
        block.subjectState === "unavailable"
      )
        continue;
      const resource = block.resource_id
        ? snapshot.resources.find((r) => r.id === block.resource_id)
        : null;
      if (
        block.resource_id &&
        (!resource ||
          resource.available === false ||
          resource.visible === false ||
          resource.state === "archived")
      )
        continue;
      const subject = block.subject;
      const project =
        subject?.kind === "project"
          ? snapshot.projects.find((p) => p.id === subject.projectId)
          : null;
      const title =
        resource?.title ||
        project?.title ||
        (subject?.kind === "resource-query"
          ? subject.query || "Resources"
          : subject?.kind === "collection"
            ? "Collection · " + subject.collectionId.slice(0, 8)
            : "Untitled " + (resource?.kind ?? "view"));
      const kind =
        resource?.kind ??
        (subject?.kind === "resource-query"
          ? "Resource view"
          : (subject?.kind ?? "View"));
      yield { block, resource, title, kind };
    }
  }
  function renderRows() {
    if (!find.open && !rows.size) return;
    const wanted = new Set<string>(),
      query = search.value.trim().toLocaleLowerCase();
    for (const { block, resource, title, kind } of workspaceBlockRows()) {
      wanted.add(block.id);
      let row = rows.get(block.id);
      if (!row) {
        const b = button("", "find-block-" + block.id, () => {
          if (find.open && rows.has(block.id))
            void run("find-block-" + block.id, () =>
              options.locateBlock(block.id),
            );
        });
        b.dataset.action = "find-block";
        b.dataset.blockId = block.id;
        const titleNode = node("span", "aw-wa-block-title"),
          kindNode = node("small", "aw-wa-block-kind");
        b.append(titleNode, kindNode);
        list.append(b);
        row = { button: b, title: titleNode, kind: kindNode, label: "" };
        rows.set(block.id, row);
      }
      if (row.title.textContent !== title) row.title.textContent = title;
      if (row.kind.textContent !== kind) row.kind.textContent = kind;
      row.label = (title + " " + kind).toLocaleLowerCase();
      row.button.hidden = !!query && !row.label.includes(query);
      if (resource) row.button.dataset.resourceId = resource.id;
      else delete row.button.dataset.resourceId;
      state(
        row.button,
        pending.has("find-block-" + block.id),
        false,
        pending.has("find-block-" + block.id),
      );
    }
    for (const [id, row] of rows)
      if (!wanted.has(id)) {
        if (doc.activeElement === row.button && find.open) search.focus();
        for (const remove of listeners.get(row.button) ?? []) remove();
        listeners.delete(row.button);
        const c = controls.get(row.button)!;
        options.motion.bodies.delete(c.key);
        keys.delete(c.key);
        controls.delete(row.button);
        row.button.remove();
        rows.delete(id);
      }
    empty.hidden = [...rows.values()].some((row) => !row.button.hidden);
  }
  function paint() {
    if (disposed) return;
    const workspace = active(),
      unavailable = !workspace;
    shell.dataset.workspaceId = workspace?.id ?? "";
    shell.dataset.mode = snapshot.organization?.mode ?? "";
    const title = workspace?.title ?? "No active workspace";
    if (name.textContent !== title) name.textContent = title;
    for (const entry of modes) {
      const selected = snapshot.organization?.mode === entry.mode;
      entry.button.setAttribute("aria-pressed", String(selected));
      state(
        entry.button,
        unavailable || !snapshot.organization || organizationBusy(),
        selected,
        pending.has("mode-" + entry.mode),
      );
    }
    for (const entry of presets) {
      const selected =
        snapshot.organization?.mode === "structured" &&
        snapshot.organization.structured.preset === entry.preset;
      entry.button.setAttribute("aria-pressed", String(selected));
      state(
        entry.button,
        unavailable || organizationBusy(),
        selected,
        pending.has("preset-" + entry.preset),
      );
    }
    state(
      frameAll,
      unavailable || pending.has("bring-all"),
      false,
      pending.has("bring-all"),
    );
    state(
      resolve,
      unavailable || pending.has("resolve"),
      false,
      pending.has("resolve"),
    );
    for (const entry of historyButtons)
      state(
        entry.button,
        unavailable ||
          pending.has(entry.action) ||
          (entry.action === "undo" && !snapshot.canUndo) ||
          (entry.action === "redo" && !snapshot.canRedo) ||
          (entry.action === "restore" && !snapshot.hasCheckpoint),
        false,
        pending.has(entry.action),
      );
    const p = snapshot.presence,
      validPresence = !!workspace && p?.workspaceId === workspace.id;
    state(
      vela,
      !validPresence || pending.has("find-vela"),
      false,
      pending.has("find-vela"),
    );
    vela.hidden = !validPresence;
    lock.hidden = !validPresence;
    lock.setAttribute("aria-pressed", String(!!p?.locked));
    state(
      lock,
      !validPresence || pending.has("lock-vela"),
      !!p?.locked,
      pending.has("lock-vela"),
    );
    for (const n of destinations.querySelectorAll<HTMLButtonElement>("button"))
      state(
        n,
        pending.has(n.dataset.action!),
        false,
        pending.has(n.dataset.action!),
      );
    checkGrid();
    paintOptimization();
    renderRows();
    showStatus();
  }
  function update(next: DesktopSnapshot) {
    if (
      disposed ||
      next.revision < snapshot.revision ||
      (next.revision === snapshot.revision &&
        (next.graphRevision ?? 0) < (snapshot.graphRevision ?? 0)) ||
      (next.activeWorkspaceId === snapshot.activeWorkspaceId &&
        next.layoutVersion < snapshot.layoutVersion)
    )
      return;
    if (grid?.open && next.activeWorkspaceId !== snapshot.activeWorkspaceId)
      cancelPreview();
    if (next.activeWorkspaceId !== snapshot.activeWorkspaceId) {
      selectedCards.clear();
      clearOptimization();
    } else if (optimizationReview && (next.layoutVersion !== optimizationReview.layoutRevision ||
      next.viewport?.x !== snapshot.viewport?.x || next.viewport?.y !== snapshot.viewport?.y ||
      next.viewport?.zoom !== snapshot.viewport?.zoom)) {
      clearOptimization("The layout or view changed. Preview the selection again.");
    }
    snapshot = next;
    paint();
    frame();
  }
  function frame() {
    if (disposed) return;
    for (const [n, c] of controls) {
      const p = options.motion.pose(c.key);
      for (const [name, value] of [
        ["hover", p.x],
        ["focus", p.y],
        ["selected", p.w],
        ["pressed", p.h],
        ["disabled", p.lift],
        ["pending", p.yaw],
      ] as const)
        write(n, "--wa-" + name, String(Math.max(0, Math.min(1, value))));
    }
    history.paint();
    find.paint();
    grid?.paint();
    optimize?.paint();
  }
  listen(shell, "keydown", (event) => {
    if ((event as KeyboardEvent).key !== "Escape") return;
    const open = [optimize, grid, find, history].find((d) => d?.open);
    if (!open) return;
    event.preventDefault();
    event.stopPropagation();
    open.set(false);
  });
  paint();
  frame();
  return {
    update,
    frame,
    invalidateOptimization() {
      if (!optimizationReview) return;
      clearOptimization("The layout or view changed. Preview the selection again.", false);
      paintOptimization();
    },
    closeOptimization() {
      clearOptimization();
      paintOptimization();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (grid?.open) cancelPreview();
      clearOptimization();
      for (const group of listeners.values())
        for (const remove of group) remove();
      listeners.clear();
      for (const key of keys) options.motion.bodies.delete(key);
      controls.clear();
      rows.clear();
      shell.remove();
    },
  };
}
