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
import { spatialControls, type SpatialCommand } from "./controls.ts";

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
  field = el("div", "", "aw-spatial-field");
  field.tabIndex = 0;
  field.setAttribute("role", "region");
  field.setAttribute(
    "aria-label",
    "Spatial overview. Drag to orbit; Shift-drag or middle-drag to pan. Alt-drag moves and pins a body. Scroll to zoom. Double-click to enter. Ctrl K finds destinations and commands. F1 opens navigation guide.",
  );
  const world = el("div", "", "aw-spatial-world"),
    lines = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  lines.classList.add("aw-connections");
  lines.setAttribute("aria-hidden", "true");
  field.append(lines, world);
  const detail = el("aside", "", "aw-spatial-detail aw-glass");
  detail.hidden = true;
  detail.setAttribute("aria-label", "Selection information");
  detail.setAttribute("aria-live", "polite");
  const status = el("p", "", "aw-spatial-status");
  status.setAttribute("role", "status");
  root.append(field, detail, status);
  container.append(root);
  let disposed = false,
    lastFrame = -Infinity,
    dirty = true,
    lastDetailKey = "",
    lastExclusionKey = "",
    inspectorOpen = false,
    pendingViewSave = false;
  const invalidate = () => {
    dirty = true;
    options.onDirty?.();
  };
  const queueViewSave = () => {
    pendingViewSave = true;
    invalidate();
  };
  const spatial = new SpatialNavigator(controller, invalidate);
  controller.spatial = spatial;
  const uiExclusions = () => {
    const bounds = field.getBoundingClientRect();
    return [
      bar,
      detail,
      status,
      drawer,
      controls.guide,
      ...root.querySelectorAll<HTMLElement>(".aw-graph-dialog[open]"),
      ...root.ownerDocument.querySelectorAll<HTMLElement>(
        "#vela, #vela .vela-label, #vela .vela-grip, dialog.aw-contextual-surface[open], #command-surface[open], .floating-dialog:not([hidden])",
      ),
    ]
      .filter(
        (e) =>
          !e.hidden &&
          e.getClientRects().length > 0 &&
          getComputedStyle(e).visibility === "visible",
      )
      .map((e) => e.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({
        left: r.left - bounds.left,
        top: r.top - bounds.top,
        right: r.right - bounds.left,
        bottom: r.bottom - bounds.top,
      }));
  };
  layer = new ConstellationScene(
    controller,
    spatial,
    () => field.getBoundingClientRect(),
    invalidate,
    uiExclusions,
  );
  const graph = graphControls(root, controller, () => {
    lastDetailKey = "";
    invalidate();
  });
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
    options.onDirty?.();
  });
  const invoke = async (fn: () => unknown) => {
    try {
      await fn();
    } catch (e) {
      report(e);
    }
  };
  const inspect = () => {
    inspectorOpen = !inspectorOpen;
    controls.close();
    lastDetailKey = "";
    invalidate();
  };
  const commands = (): SpatialCommand[] => {
    const n = controller.nodes.get(controller.selected ?? ""),
      resource = n?.kind === "resource";
    return [
      {
        id: "create",
        title: "Create",
        hint: "New project, workspace or resource",
        run: () => graph.create(),
        enabled: (
          ["createProject", "createWorkspace", "createResource"] as const
        ).some((type) => controller.can(type)),
      },
      {
        id: "link",
        title: "Link resources",
        hint: "Review a typed connection",
        run: () => graph.relate(),
        enabled: controller.can("relate"),
      },
      {
        id: "inspect",
        title: "Inspect selection",
        hint: "Position and information · I",
        run: inspect,
        enabled: !!n,
      },
      {
        id: "open",
        title: "Open destination",
        hint: "Enter · double-click",
        run: () => controller.approach(),
        enabled:
          !!n && n.available && (n.kind !== "resource" || !!n.workspaceId),
      },
      {
        id: "explore",
        title: "Explore neighborhood",
        hint: "Connections around this resource",
        run: () => spatial.explore(n!.key),
        enabled: resource,
      },
      {
        id: "relationships",
        title: "Inspect relationships",
        hint: "Connection type and provenance",
        run: () => graph.inspectRelationships(),
        enabled: resource || !!layer.selectedEdge,
      },
      {
        id: "branch",
        title: "Branch conversation",
        hint: "Review source context first",
        run: () => graph.branch(),
        enabled:
          resource &&
          controller.snapshot.resources.find((r) => r.id === n.id)?.kind ===
            "conversation" &&
          controller.can("branch"),
      },
      {
        id: "place",
        title: "Place in workspace",
        hint: "Attach this canonical resource",
        run: () => graph.place(),
        enabled: resource && !n.workspaceId && controller.can("attach"),
      },
      {
        id: "remove",
        title:
          resource && n.workspaceId
            ? "Remove visual block"
            : resource
              ? "Archive resource"
              : "Archive destination",
        hint: "Review before applying",
        run: () => graph.remove(),
        enabled:
          !!n &&
          controller.can(resource && n.workspaceId ? "detach" : "archive"),
      },
      {
        id: "arrange",
        title: "Arrange",
        hint: "Preview a new layout",
        run: () => graph.arrange(),
      },
      {
        id: "undo",
        title: "Undo position",
        hint: "Ctrl Z",
        run: () => spatial.undoPosition(),
      },
      {
        id: "out",
        title: "Zoom out",
        hint: "Alt ↑ · move to the parent",
        run: () => controller.zoomOut(),
        enabled: controller.location.kind !== "universe",
      },
      {
        id: "universe",
        title: "Universe",
        hint: "All your projects",
        run: () => controller.go({ kind: "universe" }),
      },
      {
        id: "back",
        title: "Back",
        hint: "Backspace · Alt ←",
        run: () => controller.back(),
        enabled: controller.state.history.length > 0,
      },
      {
        id: "fit",
        title: "Fit selection",
        hint: "F",
        run: () => controller.fit(),
        enabled: !!n,
      },
      {
        id: "home",
        title: "Recenter",
        hint: "Home",
        run: () => controller.recenter(),
      },
      {
        id: "history",
        title: "History",
        hint: "Return to a previous place",
        run: () => controls.history(),
      },
      {
        id: "list",
        title: "3D / List",
        hint: "Accessible destination view",
        run: () => {
          spatial.presentation =
            spatial.presentation === "spatial" ? "list" : "spatial";
          invalidate();
          void controller.persist();
        },
      },
      {
        id: "camera",
        title: "Camera preferences",
        hint: "Pointer mode and sensitivity",
        run: () => {
          inspectorOpen = true;
          controller.selected = null;
          lastDetailKey = "";
          invalidate();
        },
      },
      {
        id: "help",
        title: "Navigation guide",
        hint: "F1 · ?",
        run: () => controls.openGuide(),
      },
    ];
  };
  const controls = spatialControls(root, {
    commands,
    destinations: (query) =>
      controller.search(query, 6).map((n) => ({
        id: n.key,
        title: n.title,
        hint: `${n.resourceKind ?? n.kind}${n.available ? "" : " · unavailable"} · locate`,
        run: () => controller.locate(n.key),
      })),
    history: () =>
      controller.state.history
        .map((h, index) => ({
          id: `history:${index}`,
          title:
            (h.bookmark.selected
              ? controller.nodes.get(h.bookmark.selected)?.title
              : null) ??
            (h.location.kind === "project"
              ? controller.nodes.get("project:" + h.location.projectId)?.title
              : h.location.kind === "workspace" || h.location.kind === "surface"
                ? controller.nodes.get("workspace:" + h.location.workspaceId)
                    ?.title
                : "Universe") ??
            "Unavailable destination",
          hint: "Return with saved camera",
          run: () => controller.returnHistory(index),
        }))
        .reverse(),
    dirty: invalidate,
    report,
    onOpen: () => {
      inspectorOpen = false;
      detail.hidden = true;
    },
    overview: () => ["project", "universe"].includes(controller.location.kind),
    afterRun: queueViewSave,
  });
  const { bar, breadcrumb, drawer } = controls;
  const paintDetail = () => {
    if (!inspectorOpen) return;
    const n = controller.nodes.get(controller.selected ?? "");
    const position = n ? spatial.position(n.key) : null;
    const key = `${n?.key}:${controller.snapshot.relationships.length}:${controller.snapshot.conversationBranches?.length}:${n?.title}:${JSON.stringify(position)}:${layer.selectedEdge}`;
    if (key === lastDetailKey) return;
    lastDetailKey = key;
    detail.replaceChildren();
    const close = button("×", () => {
      inspectorOpen = false;
      detail.hidden = true;
      field.focus();
      invalidate();
    });
    close.className = "aw-quiet-control";
    close.setAttribute("aria-label", "Close information");
    detail.append(close);
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
      detail.append(el("h2", "Camera preferences"));
      const mode = el("select"),
        sensitivity = el("input"),
        modeLabel = el("label", "Drag mode"),
        sensitivityLabel = el("label", "Sensitivity");
      for (const value of ["orbit", "pan"]) {
        const option = el("option", value);
        option.value = value;
        mode.append(option);
      }
      mode.value = spatial.mode;
      mode.onchange = () => {
        spatial.mode = mode.value as "orbit" | "pan";
        void controller.persist();
      };
      sensitivity.type = "range";
      sensitivity.min = ".1";
      sensitivity.max = "3";
      sensitivity.step = ".1";
      sensitivity.value = String(spatial.sensitivity);
      sensitivity.oninput = () => {
        spatial.sensitivity = Number(sensitivity.value);
      };
      sensitivity.onchange = () => void controller.persist();
      modeLabel.append(mode);
      sensitivityLabel.append(sensitivity);
      detail.append(modeLabel, sensitivityLabel);
      return;
    }
    detail.append(
      el("strong", n.title),
      el("span", ` ${n.kind} · ${n.available ? "available" : "unavailable"}`),
    );
    detail.append(
      el(
        "p",
        "Alt-drag to move. Use exact coordinates when you need them.",
        "aw-panel-hint",
      ),
    );
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
      const coordinates = el("div", "", "aw-coordinates");
      for (const [name, input] of [
        ["X", x],
        ["Y", y],
        ["Z", z],
      ] as const) {
        const label = el("label", name);
        label.append(input);
        coordinates.append(label);
      }
      const pinLabel = el("label", "Keep position pinned");
      pinLabel.append(pinned);
      detail.append(
        coordinates,
        pinLabel,
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
        .slice(0, 3);
      for (const e of edges)
        detail.append(
          el(
            "p",
            `${e.kind}: ${controller.snapshot.resources.find((r) => r.id === e.source_id)?.title} → ${controller.snapshot.resources.find((r) => r.id === e.target_id)?.title} · ${e.provenance === "inferred" ? "inferred suggestion" : e.provenance}`,
          ),
        );
    }
  };
  function paint() {
    const l = controller.location,
      working = l.kind === "workspace" || l.kind === "surface";
    root.classList.toggle("aw-working", working);
    const spatialMode =
      spatial.presentation === "spatial" && controller.policy.graphicsAvailable;
    root.classList.toggle("aw-spatial-mode", spatialMode);
    layer.enabled = spatialMode;
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
    breadcrumb.title = breadcrumb.textContent;
    status.textContent =
      controller.error ||
      spatial.notice ||
      (controller.pending
        ? "Opening destination…"
        : controller.nodes.size === 0
          ? "No projects yet. Create one in the application."
          : !controller.policy.graphicsAvailable
            ? "Graphics unavailable. Direct navigation remains available."
            : "");
    field.hidden = working;
    detail.hidden = working || !inspectorOpen;
    paintDetail();
    // Use the host's real foreground panels; keep informational hints whole.
    status.classList.remove("aw-status-away", "aw-status-quiet");
    if (!working && status.textContent) {
      const panels = [
        ...root.ownerDocument.querySelectorAll<HTMLElement>(
          "dialog.aw-contextual-surface[open], #command-surface[open], .floating-dialog:not([hidden]), .aw-navigation-guide:not([hidden]), .aw-destinations:not([hidden]), .aw-spatial-detail:not([hidden])",
        ),
      ]
        .filter(
          (e) =>
            e.getClientRects().length &&
            getComputedStyle(e).visibility === "visible",
        )
        .map((e) => e.getBoundingClientRect());
      const intersects = () => {
        const r = status.getBoundingClientRect();
        return panels.some(
          (p) =>
            p.width > 0 &&
            p.height > 0 &&
            r.left < p.right &&
            r.right > p.left &&
            r.top < p.bottom &&
            r.bottom > p.top,
        );
      };
      if (intersects()) {
        status.classList.add("aw-status-away");
        if (!controller.error && !controller.pending && intersects())
          status.classList.add("aw-status-quiet");
      }
    }
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
            y: labelMap.get(n.key)?.y ?? 0,
          }
        : {
            x: width / 2 + (n.point.x - c.x) * c.zoom,
            y: height / 2 + (n.point.y - c.y) * c.zoom,
          };
    for (const n of nodes) {
      let v = views.get(n.key);
      if (!v) {
        v = button("", () => {
          layer.selectedEdge = null;
          controller.select(n.key);
          queueViewSave();
        });
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
      const obscured =
        spatialMode && labelMap.get(n.key)?.bodyVisible === false;
      v.querySelector("small")!.textContent =
        (n.resourceKind ?? n.kind).replaceAll("_", " ") +
        (obscured ? " · obscured" : "");
      v.setAttribute(
        "aria-label",
        `${n.title}, ${n.kind}${n.available ? "" : ", unavailable"}${obscured ? ", body obscured; select to reveal" : ""}`,
      );
      v.setAttribute("aria-pressed", String(controller.selected === n.key));
      v.classList.toggle("aw-selected", controller.selected === n.key);
      v.classList.toggle("aw-unavailable", !n.available);
      v.classList.toggle("aw-spatial-label", spatialMode);
      const s = screen(n);
      v.style.transform = `translate(${s.x}px,${s.y}px) translate(-50%,-50%)`;
    }
    lines.replaceChildren();
    lines.style.display = "";
    lines.setAttribute("viewBox", `0 0 ${width} ${height}`);
    if (spatialMode)
      for (const p of labels) {
        const line = document.createElementNS(lines.namespaceURI, "line");
        for (const [key, value] of Object.entries({
          x1: p.anchorX,
          y1: p.anchorY,
          x2: p.x,
          y2: p.y - 15,
        }))
          line.setAttribute(key, String(value));
        line.setAttribute("opacity", ".25");
        lines.append(line);
      }
    // Only canonical relationships between currently visible resources. No proximity links.
    const byResource = new Map(
      nodes.filter((n) => n.kind === "resource").map((n) => [n.id, n]),
    );
    let count = 0;
    for (const edge of spatialMode ? [] : controller.snapshot.relationships) {
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
  for (const node of [
    container,
    bar,
    detail,
    drawer,
    controls.guide,
    ...root.querySelectorAll(".aw-graph-dialog"),
  ])
    resize.observe(node);
  let pointer: {
    x: number;
    y: number;
    id: number;
    pan: boolean;
    key?: string;
    before?: Vector3;
    grabOffset?: Vector3;
    preview?: Vector3;
  } | null = null;
  field.onpointerdown = (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    const label = (e.target as HTMLElement).closest<HTMLElement>(".aw-anchor");
    if (
      e.target !== field &&
      e.target !== world &&
      !(label && (e.altKey || e.button === 1))
    )
      return;
    inspectorOpen = false;
    if (e.button === 1 || e.altKey) e.preventDefault();
    controller.interrupt();
    field.focus();
    const rect = field.getBoundingClientRect(),
      hit = label?.dataset.key
        ? { key: label.dataset.key }
        : layer.enabled
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
      const edge = edges(controller).find((e) => e.id === hit.edge),
        source = edge
          ? [...controller.nodes.values()].find(
              (n) => n.key === edge.sourceKey || n.id === edge.sourceId,
            )
          : undefined;
      if (source) controller.select(source.key);
      layer.selectedEdge = hit.edge;
      lastDetailKey = "";
      invalidate();
    }
    const grab =
        e.altKey && hit?.key
          ? layer.dragPosition(
              e.clientX - rect.left,
              e.clientY - rect.top,
              rect.width,
              rect.height,
              hit.key,
            )
          : null,
      before = e.altKey && hit?.key ? spatial.position(hit.key) : null;
    pointer = {
      x: e.clientX,
      y: e.clientY,
      id: e.pointerId,
      pan: e.button === 1 || e.shiftKey || spatial.mode === "pan",
      ...(e.altKey && hit?.key
        ? {
            key: hit.key,
            before: { ...before! },
            ...(grab
              ? {
                  grabOffset: {
                    x: before!.x - grab.x,
                    y: before!.y - grab.y,
                    z: before!.z - grab.z,
                  },
                }
              : {}),
          }
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
        const offset = pointer.grabOffset ?? { x: 0, y: 0, z: 0 };
        pointer.preview = spatial.previewMove(pointer.key, {
          x: p.x + offset.x,
          y: p.y + offset.y,
          z: p.z + offset.z,
        });
        invalidate();
      }
    } else if (layer.enabled) {
      if (pointer.pan)
        spatial.pan(
          pointer.x - e.clientX,
          e.clientY - pointer.y,
          field.clientHeight,
        );
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
        spatial.cancelLayout();
        controller.state.anchors[p.key!].spatial = p.before;
        if (p.preview) void spatial.place(p.key!, p.preview, true);
      }
      pointer = null;
      void controller.persist();
    }
  };
  field.onpointerup = end;
  const cancel = () => {
    spatial.cancelLayout();
    if (pointer?.key && pointer.before && controller.nodes.has(pointer.key))
      controller.state.anchors[pointer.key].spatial = pointer.before;
    pointer = null;
    invalidate();
  };
  field.onpointercancel = cancel;
  field.oncontextmenu = (e) => {
    e.preventDefault();
    cancel();
    const label = (e.target as HTMLElement).closest<HTMLElement>(".aw-anchor"),
      rect = field.getBoundingClientRect(),
      key =
        label?.dataset.key ??
        layer.pick(
          e.clientX - rect.left,
          e.clientY - rect.top,
          rect.width,
          rect.height,
        )?.key;
    if (key) controller.select(key);
    controls.openPalette("", true);
  };
  field.ondblclick = (e) => {
    if (e.target !== field && e.target !== world) return;
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
      const unit =
          e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? field.clientHeight : 1,
        dx = e.deltaX * unit,
        dy = e.deltaY * unit;
      if (e.shiftKey && !e.ctrlKey)
        spatial.pan(dx || dy, dx ? dy : 0, field.clientHeight);
      else
        controller.zoom(
          Math.exp(
            -Math.max(-150, Math.min(150, dy)) * (e.ctrlKey ? 0.008 : 0.003),
          ),
        );
    },
    { passive: false },
  );
  field.addEventListener("wheel", queueViewSave, { passive: true });
  field.onkeydown = (e) => {
    if (
      e.defaultPrevented ||
      (e.target !== field && !(e.target as HTMLElement).closest(".aw-anchor"))
    )
      return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      void invoke(() => spatial.undoPosition());
      return;
    }
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowLeft")) {
      e.preventDefault();
      void invoke(() =>
        e.key === "ArrowUp" ? controller.zoomOut() : controller.back(),
      );
      return;
    }
    const pan = (x: number, y: number) =>
      layer.enabled
        ? spatial.pan(x, y, field.clientHeight)
        : controller.pan(
            x / controller.camera.zoom,
            -y / controller.camera.zoom,
          );
    const actions: Record<string, () => unknown> = {
      ArrowLeft: () => (e.shiftKey ? spatial.orbit(-40, 0) : pan(-70, 0)),
      ArrowRight: () => (e.shiftKey ? spatial.orbit(40, 0) : pan(70, 0)),
      ArrowUp: () => (e.shiftKey ? spatial.orbit(0, -40) : pan(0, 70)),
      ArrowDown: () => (e.shiftKey ? spatial.orbit(0, 40) : pan(0, -70)),
      "+": () => controller.zoom(1.3),
      "=": () => controller.zoom(1.3),
      "-": () => controller.zoom(1 / 1.3),
      Home: () => controller.recenter(),
      Escape: () => {
        cancel();
        inspectorOpen = false;
        controller.interrupt();
      },
      Enter: () => controller.approach(),
      Backspace: () => controller.back(),
      f: () => controller.fit(),
      F: () => controller.fit(),
      i: inspect,
      I: inspect,
      "?": () => controls.openGuide(),
    };
    if (actions[e.key]) {
      e.preventDefault();
      void invoke(actions[e.key]);
      queueViewSave();
    }
  };
  const closeInformation = (e: KeyboardEvent) => {
    if (e.key === "Escape" && inspectorOpen) {
      inspectorOpen = false;
      invalidate();
      field.focus();
      e.preventDefault();
    }
  };
  root.addEventListener("keydown", closeInformation);
  const media = matchMedia("(prefers-reduced-motion: reduce)"),
    mediaChange = () =>
      controller.setPolicy({
        reduced: media.matches || options.policy?.reduced === true,
      });
  media.addEventListener("change", mediaChange);
  mediaChange();
  const visibility = () => {
    controller.setPolicy({ hidden: document.hidden });
    if (document.hidden && pendingViewSave) {
      pendingViewSave = false;
      void controller.persist();
    }
  };
  document.addEventListener("visibilitychange", visibility);
  function frame(now = performance.now()) {
    if (disposed || controller.policy.hidden) return;
    if (
      layer.enabled &&
      ["project", "universe"].includes(controller.location.kind)
    ) {
      // The host moves Vela through this same scheduler; position changes do not
      // trigger ResizeObserver, so keep label exclusions current on host frames.
      const key = JSON.stringify(uiExclusions());
      if (key !== lastExclusionKey) {
        lastExclusionKey = key;
        dirty = true;
      }
    }
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
    if (pendingViewSave && !moving && !pointer && !controller.pending) {
      pendingViewSave = false;
      void controller.persist();
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
      controls.refresh();
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
      controls.dispose();
      graph.dispose();
      root.remove();
    },
  };
}
