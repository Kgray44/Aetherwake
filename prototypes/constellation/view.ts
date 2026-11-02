import {
  ConstellationController,
  type ControllerOptions,
} from "./controller.ts";
import { keyOf } from "./projection.ts";
import type { Node, Policy, Snapshot } from "./types.ts";
import { SpatialNavigator, edges } from "./spatial.ts";
import { ConstellationScene } from "./renderer3d.ts";
import { graphControls } from "./graph-controls.ts";
import type { Vector3 } from "./spatial-types.ts";

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = "",
  className = "",
) => {
  const n = document.createElement(tag);
  n.textContent = text;
  n.className = className;
  return n;
};
const button = (text: string, fn: () => unknown) => {
  const b = el("button", text);
  b.type = "button";
  b.onclick = () => {
    Promise.resolve()
      .then(fn)
      .catch(() => {});
  };
  return b;
};

/** Transparent navigation layer. Host keeps V3.5 environment, Vela and editors. */
export function mountConstellation(
  container: HTMLElement,
  options: ControllerOptions,
) {
  let field: HTMLDivElement;
  let layer: ConstellationScene;
  const controller = new ConstellationController({
    ...options,
    onTransition: (transition) => {
      const n =
        transition.to.kind === "project"
          ? controller.nodes.get("project:" + transition.to.projectId)
          : transition.to.kind === "workspace"
            ? controller.nodes.get("workspace:" + transition.to.workspaceId)
            : transition.to.kind === "surface"
              ? controller.nodes.get("resource:" + transition.to.blockId)
              : undefined;
      const bounds = field?.getBoundingClientRect();
      const p =
        n && bounds && layer
          ? layer.project(n.key, bounds.width, bounds.height)
          : null;
      options.onTransition?.({
        ...transition,
        ...(p && bounds
          ? { screenOrigin: { x: bounds.left + p.x, y: bounds.top + p.y } }
          : {}),
      });
    },
  });
  const root = el("section", "", "aw-constellation");
  root.setAttribute("aria-label", "Constellation navigation");
  const bar = el("nav", "", "aw-constellation-bar");
  bar.setAttribute("aria-label", "Project and workspace navigation");
  const back = button("← Back", () => controller.back()),
    out = button("Zoom out", () => controller.zoomOut()),
    universe = button("Universe", () => controller.go({ kind: "universe" }));
  const breadcrumb = el("span", "", "aw-location");
  breadcrumb.setAttribute("aria-live", "polite");
  const toggle = button("Destinations", () => {
    drawer.hidden = !drawer.hidden;
    if (!drawer.hidden) search.focus();
  });
  toggle.setAttribute("aria-expanded", "false");
  bar.append(back, out, universe, breadcrumb, toggle);
  field = el("div", "", "aw-spatial-field");
  field.tabIndex = 0;
  field.setAttribute("role", "region");
  field.setAttribute(
    "aria-label",
    "Spatial overview. Drag empty space or use arrow keys to pan. Plus and minus zoom. Escape stops camera.",
  );
  const world = el("div", "", "aw-spatial-world"),
    lines = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  lines.classList.add("aw-connections");
  lines.setAttribute("aria-hidden", "true");
  field.append(lines, world);
  const tools = el("div", "", "aw-camera-tools");
  tools.append(
    button("+", () => controller.zoom(1.3)),
    button("−", () => controller.zoom(1 / 1.3)),
    button("Recenter", () => controller.recenter()),
    button("Fit selection", () => controller.fit()),
    button("Approach", () => controller.approach()),
    button("Save view", () => controller.persist()),
  );
  const detail = el("div", "", "aw-spatial-detail");
  detail.setAttribute("aria-live", "polite");
  const status = el("p", "", "aw-spatial-status");
  status.setAttribute("role", "status");
  const drawer = el("aside", "", "aw-destinations");
  drawer.hidden = true;
  drawer.setAttribute("aria-label", "Direct destinations");
  const search = el("input");
  search.type = "search";
  search.placeholder = "Find project, workspace, or resource";
  search.setAttribute("aria-label", "Search destinations");
  const results = el("div", "", "aw-destination-results");
  drawer.append(
    el("h2", "Destinations"),
    search,
    results,
    button("Close destinations", () => {
      drawer.hidden = true;
      toggle.focus();
    }),
  );
  root.append(bar, field, tools, detail, status, drawer);
  container.append(root);
  let disposed = false,
    lastFrame = -Infinity,
    dirty = true,
    lastResultKey = "",
    lastDetailKey = "";
  const invalidate = () => {
    dirty = true;
    options.onDirty?.();
  };
  const spatial = new SpatialNavigator(controller, invalidate);
  controller.spatial = spatial;
  layer = new ConstellationScene(controller, spatial, () =>
    field.getBoundingClientRect(),
  );
  const graph = graphControls(root, controller, () => {
    lastDetailKey = "";
    invalidate();
  });
  const mode = el("select");
  mode.setAttribute("aria-label", "Spatial pointer mode");
  for (const value of ["orbit", "pan"]) {
    const o = el("option", value);
    o.value = value;
    mode.append(o);
  }
  mode.onchange = () => {
    spatial.mode = mode.value as "orbit" | "pan";
    void controller.persist();
  };
  const sensitivity = el("input");
  sensitivity.type = "range";
  sensitivity.min = ".1";
  sensitivity.max = "3";
  sensitivity.step = ".1";
  sensitivity.value = "1";
  sensitivity.setAttribute("aria-label", "Orbit sensitivity");
  sensitivity.oninput = () => {
    spatial.sensitivity = Number(sensitivity.value);
  };
  sensitivity.onchange = () => void controller.persist();
  tools.append(
    mode,
    sensitivity,
    button("Orbit left", () => spatial.orbit(-70, 0)),
    button("Orbit right", () => spatial.orbit(70, 0)),
    button("Orbit up", () => spatial.orbit(0, -60)),
    button("Orbit down", () => spatial.orbit(0, 60)),
    button("Undo position", () => spatial.undoPosition()),
    button("3D / List", () => {
      spatial.presentation =
        spatial.presentation === "spatial" ? "list" : "spatial";
      drawer.hidden = spatial.presentation !== "list";
      if (!drawer.hidden) search.focus();
      invalidate();
      void controller.persist();
    }),
  );
  bar.append(
    button("Create", () => graph.create()),
    button("Link resources", () => graph.relate()),
  );
  const views = new Map<string, HTMLButtonElement>();
  const report = (error: unknown) => {
    controller.error =
      error instanceof Error ? error.message : "Navigation failed";
    dirty = true;
    options.onDirty?.();
  };
  // Report rejected UI actions without exposing backend details in DOM markup.
  root.addEventListener("click", () => {
    dirty = true;
  });
  const invoke = async (fn: () => unknown) => {
    try {
      await fn();
    } catch (e) {
      report(e);
    }
  };
  const paintResults = () => {
    const nodes = controller.search(search.value, 40),
      key =
        nodes.map((n) => `${n.key}:${n.title}:${n.available}`).join("|") +
        search.value;
    if (key === lastResultKey) return;
    lastResultKey = key;
    results.replaceChildren();
    if (!nodes.length) results.append(el("p", "No accessible destinations."));
    for (const n of nodes) {
      const row = el("div", "", "aw-destination-row"),
        label = el(
          "span",
          `${n.title} · ${n.kind}${n.available ? "" : " · unavailable"}`,
        );
      const open = button("Open", () =>
        invoke(() => controller.approach(n.key)),
      );
      open.disabled = !n.available;
      open.setAttribute("aria-label", `Open ${n.title}`);
      const locate = button("Locate", () =>
        invoke(() => controller.locate(n.key)),
      );
      locate.setAttribute("aria-label", `Locate ${n.title}`);
      row.append(label, open, locate);
      results.append(row);
    }
  };
  search.oninput = () => {
    lastResultKey = "";
    paintResults();
  };
  search.onkeydown = (e) => {
    if (e.key === "Enter") {
      const n = controller.search(search.value, 1)[0];
      if (n) void invoke(() => controller.approach(n.key));
    }
    if (e.key === "Escape") {
      drawer.hidden = true;
      toggle.focus();
    }
  };
  const paintDetail = () => {
    const n = controller.nodes.get(controller.selected ?? "");
    const position = n ? spatial.position(n.key) : null;
    const key = `${n?.key}:${controller.snapshot.relationships.length}:${controller.snapshot.conversationBranches?.length}:${n?.title}:${JSON.stringify(position)}:${layer.selectedEdge}`;
    if (key === lastDetailKey) return;
    lastDetailKey = key;
    detail.replaceChildren();
    if (layer.selectedEdge) {
      const edge = edges(controller).find((e) => e.id === layer.selectedEdge);
      if (edge) {
        detail.append(
          el("strong", edge.kind),
          el("p", `${edge.sourceId} → ${edge.targetId} · ${edge.provenance}`),
          button("Inspect connection", () => graph.inspectRelationships()),
        );
        return;
      }
      layer.selectedEdge = null;
    }
    if (!n) {
      detail.append(
        el("p", "Select a destination. Enter or double-click to approach."),
      );
      return;
    }
    detail.append(
      el("strong", n.title),
      el("span", ` ${n.kind} · ${n.available ? "available" : "unavailable"}`),
    );
    const open = button("Open destination", () =>
      invoke(() => controller.approach(n.key)),
    );
    open.disabled = !n.available;
    detail.append(open);
    {
      const x = el("input"),
        y = el("input"),
        z = el("input");
      x.type = y.type = z.type = "number";
      x.value = String(Math.round(position!.x));
      y.value = String(Math.round(position!.y));
      z.value = String(Math.round(position!.z));
      x.setAttribute("aria-label", "Anchor X position");
      y.setAttribute("aria-label", "Anchor Y position");
      z.setAttribute("aria-label", "Anchor Z position");
      x.className = y.className = z.className = "aw-position";
      const pinned = el("input");
      pinned.type = "checkbox";
      pinned.checked = controller.state.anchors[n.key]?.pinned === true;
      pinned.setAttribute("aria-label", "Pin spatial position");
      detail.append(
        x,
        y,
        z,
        pinned,
        el("span", "Pin"),
        button("Save position", () =>
          invoke(() =>
            spatial.place(
              n.key,
              { x: Number(x.value), y: Number(y.value), z: Number(z.value) },
              pinned.checked,
            ),
          ),
        ),
      );
    }
    if (n.kind === "resource") {
      detail.append(
        button("Explore neighborhood", () => spatial.explore(n.key)),
        button("Inspect relationships", () => graph.inspectRelationships()),
      );
      const r = controller.snapshot.resources.find((r) => r.id === n.id);
      if (r?.kind === "conversation") {
        const branch = button("Branch conversation", () => graph.branch());
        branch.disabled = !controller.can("branch");
        detail.append(branch);
      }
      const allowed = new Set(
        [...controller.nodes.values()]
          .filter((x) => x.kind === "resource")
          .map((x) => x.id),
      );
      const edges = controller.snapshot.relationships
        .filter(
          (e) =>
            e.visible !== false &&
            allowed.has(e.source_id) &&
            allowed.has(e.target_id) &&
            (e.source_id === n.id || e.target_id === n.id),
        )
        .slice(0, 12);
      for (const e of edges)
        detail.append(
          el(
            "p",
            `${e.kind}: ${controller.snapshot.resources.find((r) => r.id === e.source_id)?.title} → ${controller.snapshot.resources.find((r) => r.id === e.target_id)?.title} · ${e.provenance === "inferred" ? "inferred suggestion" : e.provenance}`,
          ),
        );
    }
    const remove = button(
      n.kind === "resource" ? "Remove visual block" : "Archive destination",
      () => graph.remove(),
    );
    remove.disabled = !controller.can(
      n.kind === "resource" ? "detach" : "archive",
    );
    detail.append(remove);
  };
  function paint() {
    const l = controller.location,
      working = l.kind === "workspace" || l.kind === "surface";
    root.classList.toggle("aw-working", working);
    const spatialMode =
      spatial.presentation === "spatial" && controller.policy.graphicsAvailable;
    root.classList.toggle("aw-spatial-mode", spatialMode);
    layer.enabled = spatialMode;
    mode.value = spatial.mode;
    sensitivity.value = String(spatial.sensitivity);
    root.classList.toggle(
      "aw-efficient",
      controller.policy.tier === "efficient",
    );
    root.classList.toggle("aw-reduced", controller.policy.reduced);
    root.classList.toggle(
      "aw-graphics-fallback",
      !controller.policy.graphicsAvailable,
    );
    const w =
      l.kind === "workspace" || l.kind === "surface"
        ? controller.snapshot.workspaces.find((w) => w.id === l.workspaceId)
        : null;
    const p =
      l.kind === "project"
        ? controller.snapshot.projects.find((p) => p.id === l.projectId)
        : w
          ? controller.snapshot.projects.find((p) => p.id === w.project_id)
          : null;
    breadcrumb.textContent = working
      ? `${p?.title ?? "Standalone"} / ${w?.title ?? "Unavailable"}${l.kind === "surface" ? " / Resource" : ""}`
      : l.kind === "project"
        ? `${p?.title ?? "Project"} / ${spatial.neighborhood ? "Resource neighborhood" : "Constellation"}`
        : "Universe / Projects";
    back.disabled = controller.state.history.length === 0;
    out.disabled = l.kind === "universe";
    toggle.setAttribute("aria-expanded", String(!drawer.hidden));
    status.textContent =
      controller.error ||
      (controller.pending
        ? "Opening destination…"
        : controller.nodes.size === 0
          ? "No projects yet. Create one in the application."
          : !controller.policy.graphicsAvailable
            ? "Graphics unavailable. Direct navigation remains available."
            : "");
    field.hidden = working;
    tools.hidden = working;
    detail.hidden = working;
    if (!drawer.hidden) paintResults();
    paintDetail();
    const { width, height } = field.getBoundingClientRect(),
      c = controller.camera;
    const labels = spatialMode && !working ? layer.labels(width, height) : [];
    const labelMap = new Map(labels.map((p) => [p.node.key, p]));
    const nodes = working
        ? []
        : spatialMode
          ? labels.map((p) => p.node)
          : controller.visible(width, height),
      present = new Set(nodes.map((n) => n.key));
    for (const [key, v] of views)
      if (!present.has(key)) {
        v.remove();
        views.delete(key);
      }
    const screen = (n: Node) =>
      spatialMode
        ? {
            x: labelMap.get(n.key)?.x ?? 0,
            y:
              (labelMap.get(n.key)?.y ?? 0) +
              (n.kind === "project" ? 65 : n.kind === "workspace" ? 38 : 24),
          }
        : {
            x: width / 2 + (n.point.x - c.x) * c.zoom,
            y: height / 2 + (n.point.y - c.y) * c.zoom,
          };
    for (const n of nodes) {
      let v = views.get(n.key);
      if (!v) {
        v = button("", () => controller.select(n.key));
        v.className = `aw-anchor aw-${n.kind}`;
        v.dataset.key = n.key;
        v.append(
          el("span", "", "aw-anchor-sculpture"),
          el("strong", n.title),
          el("small", n.kind),
        );
        v.ondblclick = () => {
          void invoke(() => controller.approach(n.key));
        };
        v.onkeydown = (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void invoke(() => controller.approach(n.key));
          }
        };
        world.append(v);
        views.set(n.key, v);
      }
      v.querySelector("strong")!.textContent = n.title;
      v.setAttribute(
        "aria-label",
        `${n.title}, ${n.kind}${n.available ? "" : ", unavailable"}`,
      );
      v.setAttribute("aria-pressed", String(controller.selected === n.key));
      v.classList.toggle("aw-selected", controller.selected === n.key);
      v.classList.toggle("aw-unavailable", !n.available);
      v.classList.toggle("aw-spatial-label", spatialMode);
      const s = screen(n);
      v.style.transform = `translate(${s.x}px,${s.y}px) translate(-50%,-50%)`;
    }
    lines.replaceChildren();
    lines.style.display = spatialMode ? "none" : "";
    lines.setAttribute("viewBox", `0 0 ${width} ${height}`);
    // Only canonical relationships between currently visible resources. No proximity links.
    const byResource = new Map(
      nodes.filter((n) => n.kind === "resource").map((n) => [n.id, n]),
    );
    let count = 0;
    for (const edge of controller.snapshot.relationships) {
      const a = byResource.get(edge.source_id),
        b = byResource.get(edge.target_id);
      if (
        edge.visible === false ||
        !a ||
        !b ||
        (a.key !== controller.selected && b.key !== controller.selected)
      )
        continue;
      if (++count > 24) break;
      const line = document.createElementNS(lines.namespaceURI, "line");
      const ap = screen(a),
        bp = screen(b);
      for (const [k, v] of Object.entries({
        x1: ap.x,
        y1: ap.y,
        x2: bp.x,
        y2: bp.y,
      }))
        line.setAttribute(k, String(v));
      if (edge.provenance === "inferred")
        line.setAttribute("stroke-dasharray", "5 6");
      lines.append(line);
    }
    dirty = false;
  }
  const unsub = controller.subscribe(() => {
    dirty = true;
    options.onDirty?.();
  });
  const resize = new ResizeObserver(() => {
    dirty = true;
    options.onDirty?.();
  });
  resize.observe(container);
  let pointer: {
    x: number;
    y: number;
    id: number;
    pan: boolean;
    key?: string;
    before?: Vector3;
    preview?: Vector3;
  } | null = null;
  field.onpointerdown = (e) => {
    if (e.target !== field && e.target !== world) return;
    controller.interrupt();
    field.focus();
    const rect = field.getBoundingClientRect(),
      hit = layer.enabled
        ? layer.pick(
            e.clientX - rect.left,
            e.clientY - rect.top,
            rect.width,
            rect.height,
          )
        : null;
    if (hit?.key) {
      controller.select(hit.key);
      layer.selectedEdge = null;
    } else if (hit?.edge) {
      layer.selectedEdge = hit.edge;
      lastDetailKey = "";
      invalidate();
    }
    pointer = {
      x: e.clientX,
      y: e.clientY,
      id: e.pointerId,
      pan: e.shiftKey || spatial.mode === "pan",
      ...(e.altKey && hit?.key
        ? { key: hit.key, before: { ...spatial.position(hit.key) } }
        : {}),
    };
    field.setPointerCapture(e.pointerId);
  };
  field.onpointermove = (e) => {
    if (!pointer) return;
    if (pointer.key) {
      const rect = field.getBoundingClientRect(),
        p = layer.dragPosition(
          e.clientX - rect.left,
          e.clientY - rect.top,
          rect.width,
          rect.height,
          pointer.key,
        );
      if (p) {
        pointer.preview = p;
        controller.state.anchors[pointer.key].spatial = p;
        invalidate();
      }
    } else if (layer.enabled) {
      if (pointer.pan)
        spatial.pan(pointer.x - e.clientX, e.clientY - pointer.y);
      else spatial.orbit(e.clientX - pointer.x, e.clientY - pointer.y);
    } else
      controller.pan(
        (pointer.x - e.clientX) / controller.camera.zoom,
        (pointer.y - e.clientY) / controller.camera.zoom,
      );
    pointer.x = e.clientX;
    pointer.y = e.clientY;
  };
  const end = () => {
    if (pointer) {
      if (pointer.key && pointer.before && controller.nodes.has(pointer.key)) {
        const p = pointer;
        controller.state.anchors[p.key!].spatial = p.before;
        if (p.preview) void spatial.place(p.key!, p.preview, true);
      }
      pointer = null;
      void controller.persist();
    }
  };
  field.onpointerup = end;
  const cancel = () => {
    if (pointer?.key && pointer.before && controller.nodes.has(pointer.key))
      controller.state.anchors[pointer.key].spatial = pointer.before;
    pointer = null;
    invalidate();
  };
  field.onpointercancel = cancel;
  field.ondblclick = (e) => {
    const rect = field.getBoundingClientRect(),
      hit = layer.pick(
        e.clientX - rect.left,
        e.clientY - rect.top,
        rect.width,
        rect.height,
      );
    if (hit?.key) void invoke(() => controller.approach(hit.key));
  };
  field.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      controller.zoom(
        Math.exp(-Math.max(-150, Math.min(150, e.deltaY)) * 0.003),
      );
    },
    { passive: false },
  );
  field.onkeydown = (e) => {
    if (e.target !== field) return;
    const d = 70 / controller.camera.zoom;
    const actions: Record<string, () => unknown> = {
      ArrowLeft: () => controller.pan(-d, 0),
      ArrowRight: () => controller.pan(d, 0),
      ArrowUp: () => controller.pan(0, -d),
      ArrowDown: () => controller.pan(0, d),
      "+": () => controller.zoom(1.3),
      "=": () => controller.zoom(1.3),
      "-": () => controller.zoom(1 / 1.3),
      Home: () => controller.recenter(),
      Escape: () => {
        cancel();
        controller.interrupt();
      },
      Enter: () => controller.approach(),
      Backspace: () => controller.back(),
    };
    if (actions[e.key]) {
      e.preventDefault();
      void invoke(actions[e.key]);
    }
  };
  const media = matchMedia("(prefers-reduced-motion: reduce)"),
    mediaChange = () =>
      controller.setPolicy({
        reduced: media.matches || options.policy?.reduced === true,
      });
  media.addEventListener("change", mediaChange);
  mediaChange();
  const visibility = () => controller.setPolicy({ hidden: document.hidden });
  document.addEventListener("visibilitychange", visibility);
  function frame(now = performance.now()) {
    if (disposed || controller.policy.hidden) return;
    const moving =
      (controller.motion.bodies.get(controller.motionId)?.transitioning ??
        false) ||
      (controller.motion.bodies.get(spatial.id)?.transitioning ?? false);
    const cadence =
      controller.policy.tier === "efficient"
        ? 1000 / 15
        : controller.policy.tier === "balanced"
          ? 1000 / 60
          : 0;
    if (dirty || (moving && now - lastFrame >= cadence)) {
      paint();
      lastFrame = now;
    }
  }
  paint();
  return {
    controller,
    layer,
    ready: controller.restore(),
    frame,
    update(snapshot: Snapshot) {
      controller.update(snapshot);
      lastResultKey = "";
      lastDetailKey = "";
    },
    setPolicy(policy: Partial<Policy>) {
      controller.setPolicy(policy);
    },
    async dispose() {
      await controller.persist();
      disposed = true;
      unsub();
      resize.disconnect();
      media.removeEventListener("change", mediaChange);
      document.removeEventListener("visibilitychange", visibility);
      controller.dispose();
      layer.dispose();
      graph.dispose();
      root.remove();
    },
  };
}
