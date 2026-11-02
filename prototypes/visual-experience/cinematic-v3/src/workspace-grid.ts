import { STRUCTURED_GRID_SIZE } from "../../../workspace-engine/structured-grid.mts";
import type { MotionCoordinator } from "./motion.ts";
import type { Policy } from "../../../constellation/types.ts";

let sequence = 0;
const neutral = { x: 0, y: 0, w: 0, h: 0, lift: 0, yaw: 0, opacity: 0 };
const modulo = (value: number, interval: number) =>
  ((value % interval) + interval) % interval;

/** Paint-only LOD: every line is a multiple of the unchanged canonical grid.
 * Adjacent powers blend continuously, including through LOD boundaries. */
export function projectWorkspaceGrid(
  zoom: number,
  offset: { x: number; y: number },
) {
  if (
    !Number.isFinite(zoom) ||
    zoom <= 0 ||
    !Number.isFinite(offset.x) ||
    !Number.isFinite(offset.y)
  )
    return null;
  if (
    !Number.isFinite(STRUCTURED_GRID_SIZE * zoom) ||
    !Number.isFinite(128 / (STRUCTURED_GRID_SIZE * zoom))
  )
    return null;
  const level = Math.max(0, Math.log2(128 / (STRUCTURED_GRID_SIZE * zoom))),
    integer = Math.floor(level),
    blend = level - integer,
    worldStep = STRUCTURED_GRID_SIZE * 2 ** integer;
  if (!Number.isFinite(worldStep) || worldStep <= 0) return null;
  return [1 - blend, blend].map((weight, index) => {
    const spacing = worldStep * 2 ** index * zoom;
    return {
      spacing,
      x: modulo(offset.x, spacing),
      y: modulo(offset.y, spacing),
      weight,
      worldStep: worldStep * 2 ** index,
    };
  });
}

/** One transient body in the existing MC, no scheduler, geometry or persistence. */
export function createWorkspaceGrid(options: {
  root: HTMLElement;
  motion: MotionCoordinator;
  wake(): void;
}) {
  const key = "workspace-grid:" + ++sequence;
  const layers = [0, 1].map(() => {
    const layer = options.root.ownerDocument.createElement("div");
    layer.className = "workspace-grid";
    layer.setAttribute("aria-hidden", "true");
    options.root.append(layer);
    return layer;
  });
  options.root.setAttribute("aria-hidden", "true");
  options.root.style.cssText =
    "position:absolute;inset:0;pointer-events:none;z-index:-1";
  options.motion.add(key, neutral);
  let projection = projectWorkspaceGrid(1, { x: 0, y: 0 }),
    visible = false,
    signature = "",
    disposed = false;
  return {
    update(input: {
      visible: boolean;
      zoom: number;
      offset: { x: number; y: number };
    }) {
      if (disposed) return;
      const next = projectWorkspaceGrid(input.zoom, input.offset);
      // Preserve the last world anchoring throughout disappearance.
      if (input.visible && next) projection = next;
      const target = input.visible && !!next;
      if (target !== visible) {
        visible = target;
        if (visible) options.root.hidden = false;
        options.motion.target(
          key,
          { ...neutral, opacity: visible ? 1 : 0 },
          "workspace grid visibility",
        );
        options.wake();
      }
    },
    frame(policy: Policy) {
      if (disposed) return;
      if (
        policy.reduced ||
        policy.quiet ||
        policy.hidden ||
        !policy.graphicsAvailable
      )
        options.motion.snap(key);
      const reveal = Math.max(0, Math.min(1, options.motion.pose(key).opacity)),
        next = JSON.stringify([projection, reveal]);
      if (next === signature) return;
      signature = next;
      projection?.forEach((value, index) => {
        const style = layers[index].style;
        style.setProperty("--workspace-grid-spacing", value.spacing + "px");
        style.setProperty("--workspace-grid-x", value.x + "px");
        style.setProperty("--workspace-grid-y", value.y + "px");
        style.setProperty(
          "--workspace-grid-reveal",
          String(reveal * value.weight),
        );
      });
      options.root.hidden = !visible && reveal === 0;
    },
    diagnostics: () => ({
      visible,
      reveal: options.motion.pose(key).opacity,
      projection,
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      options.motion.bodies.delete(key);
      options.root.remove();
    },
  };
}
