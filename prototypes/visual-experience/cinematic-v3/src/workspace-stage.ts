import type { MotionCoordinator, Pose } from "./motion.ts";

type Point = { x: number; y: number };
type NavigationChange = {
  overview: boolean;
  leaving: boolean;
  arriving: boolean;
  navigated: boolean;
  quiet: boolean;
  center: Point;
  velaOccludes?: () => boolean;
};

const id = "application:arrival";
const settled: Pose = { x: 1, y: 0, w: 0, h: 0, lift: 0, yaw: 0, opacity: 1 };
const hiddenOpacity = 0.003;

/** Presents canonical navigation on the existing stage and shared motion body. */
export function createWorkspaceStage(
  element: HTMLElement,
  motion: MotionCoordinator,
  wake: () => void,
  initialOrigin: Point,
) {
  let origin = initialOrigin;
  let departing = false;
  let waiting = false;
  motion.add(id, settled);
  const body = motion.bodies.get(id)!;

  function setOrigin(point: Point) {
    origin = point;
    const value = `${point.x}px ${point.y}px`;
    if (element.style.transformOrigin !== value)
      element.style.transformOrigin = value;
  }

  function show(visible: boolean) {
    const value = visible ? "" : "hidden";
    if (element.style.visibility !== value) element.style.visibility = value;
  }

  function stageVisible(overview: boolean) {
    return (
      !overview || (departing && body.channels.opacity.value > hiddenOpacity)
    );
  }

  return {
    get waiting() {
      return waiting;
    },
    reconcile({
      overview,
      leaving,
      arriving,
      navigated,
      quiet,
      center,
      velaOccludes,
    }: NavigationChange) {
      if (navigated) {
        waiting =
          arriving &&
          body.channels.opacity.value <= hiddenOpacity &&
          !motion.reduced &&
          !quiet &&
          (velaOccludes?.() ?? false);
      }
      const inert = overview || waiting;
      if (element.inert !== inert) element.inert = inert;
      if (leaving) {
        departing = true;
        setOrigin(center);
        motion.target(
          id,
          { ...settled, x: 0.78, opacity: 0 },
          "workspace departure to celestial overview",
        );
        if (motion.reduced || quiet) motion.snap(id);
      } else if (!overview) {
        departing = false;
        if (arriving) {
          motion.target(
            id,
            waiting ? { ...settled, opacity: 0 } : settled,
            "canonical workspace arrival",
            true,
          );
          wake();
        }
      }
      show(!overview || departing);
    },
    approach(point: Point, quiet: boolean) {
      setOrigin(point);
      if (waiting) return;
      if (!body.transitioning && !motion.reduced && !quiet) {
        body.channels.x.value = 0.92;
        body.channels.opacity.value = 0.45;
      }
      motion.target(
        id,
        settled,
        "workspace arrival from canonical anchor",
        true,
      );
      wake();
    },
    reveal() {
      waiting = false;
      element.inert = false;
      motion.target(id, settled, "Vela cleared the workspace arrival");
      wake();
    },
    frame(overview: boolean, snap: boolean) {
      if (snap && body.transitioning) motion.snap(id);
      show(stageVisible(overview));
      const transform = `scale(${body.channels.x.value})`;
      const opacity = String(body.channels.opacity.value);
      if (element.style.transform !== transform)
        element.style.transform = transform;
      if (element.style.opacity !== opacity) element.style.opacity = opacity;
    },
    surfacesVisible(overview: boolean) {
      return !waiting && stageVisible(overview);
    },
    view() {
      return {
        scale: body.channels.x.value,
        opacity: body.channels.opacity.value,
        originX: origin.x,
        originY: origin.y,
      };
    },
  };
}
