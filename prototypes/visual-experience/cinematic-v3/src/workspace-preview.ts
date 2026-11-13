import { previewLayout } from "../../../workspace-engine/organization.mts";
import type {
  LayoutState,
  LayoutPreview,
  LayoutPreviewRequest,
} from "../../../workspace-engine/contracts.mts";
import type { MotionCoordinator } from "./motion.ts";

/** Owns the transient gesture preview and its guide layer. The caller owns commits. */
export function mountWorkspacePreview({
  stage,
  motion,
  camera,
  layout,
  wake,
  failed,
  calculate = previewLayout,
}: {
  stage: HTMLElement;
  motion: MotionCoordinator;
  camera(): { zoom: number; offset: { x: number; y: number } };
  layout(): void;
  wake(): void;
  failed(error: unknown): void;
  calculate?: typeof previewLayout;
}) {
  let base: LayoutState | undefined;
  let current: LayoutPreview | undefined;
  let pending: LayoutPreviewRequest | undefined;
  let lastMarkup = "";
  const previewGuides = stage.ownerDocument.createElement("div");
  previewGuides.className = "layout-preview-guides";
  previewGuides.setAttribute("aria-hidden", "true");
  stage.append(previewGuides);
  const previewGuideId = "application:preview-guides";
  const previewGuidePose = {
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    lift: 0,
    yaw: 0,
    opacity: 0,
  };
  motion.add(previewGuideId, previewGuidePose);
  previewGuides.style.opacity = "0";
  function presentPreview(
    result: LayoutPreview,
    intent?: LayoutPreviewRequest["intent"],
  ) {
    current = result;
    const { zoom, offset } = camera();
    const gridOnly =
      result.organization.mode === "structured" &&
      ["mode", "move", "resize"].includes(intent ?? "");
    const guides = (gridOnly ? [] : result.guides).map(
      (g) =>
        `<i class="alignment-guide" style="left:${(g.axis === "x" ? g.position : g.from) * zoom + offset.x}px;top:${(g.axis === "y" ? g.position : g.from) * zoom + offset.y}px;width:${g.axis === "x" ? 1 : (g.to - g.from) * zoom}px;height:${g.axis === "y" ? 1 : (g.to - g.from) * zoom}px"></i>`,
    );
    const areas = result.placementAreas.map(
      (a) =>
        `<i class="placement-area" style="left:${a.x * zoom + offset.x}px;top:${a.y * zoom + offset.y}px;width:${a.width * zoom}px;height:${a.height * zoom}px"></i>`,
    );
    const markup = [...guides, ...areas].join("");
    if (markup !== lastMarkup) {
      previewGuides.innerHTML = markup;
      lastMarkup = markup;
    }
    motion.target(
      previewGuideId,
      { ...previewGuidePose, opacity: guides.length || areas.length ? 1 : 0 },
      "placement guide reveal",
    );
    stage.ownerDocument.body.dataset.layoutPreview = result.organization.mode;
    layout();
  }
  return {
    get revision() {
      return base?.revision;
    },
    get current() {
      return current;
    },
    queue(
      readBase: () => LayoutState | undefined,
      request: LayoutPreviewRequest,
      bounds: () => NonNullable<LayoutPreviewRequest["bounds"]>,
    ) {
      base ??= readBase();
      if (!base) return;
      pending = {
        ...request,
        expectedRevision: base.revision,
        bounds: request.bounds ?? bounds(),
      };
      wake();
    },
    paint() {
      if (!pending || !base) return;
      const request = pending;
      pending = undefined;
      try {
        presentPreview(calculate(base, request), request.intent);
      } catch (error) {
        failed(error);
      }
    },
    showReview(reviewBase: LayoutState, result: LayoutPreview) {
      base = reviewBase;
      presentPreview(result, "optimize");
    },
    cancel() {
      pending = undefined;
      current = undefined;
      base = undefined;
      motion.target(
        previewGuideId,
        previewGuidePose,
        "placement guide dismissal",
      );
      delete stage.ownerDocument.body.dataset.layoutPreview;
    },
    frame(snap: boolean) {
      const body = motion.bodies.get(previewGuideId)!;
      if (snap && body.transitioning) motion.snap(previewGuideId);
      const opacity = Math.max(0, Math.min(1, body.channels.opacity.value));
      const style = String(opacity);
      if (previewGuides.style.opacity !== style)
        previewGuides.style.opacity = style;
      if (!current && !pending && opacity === 0 && lastMarkup) {
        previewGuides.replaceChildren();
        lastMarkup = "";
      }
    },
    outline() {
      if (current?.placementAreas.length !== 1) return null;
      const area = previewGuides.querySelector<HTMLElement>(".placement-area");
      const opacity =
        area && area.getClientRects().length
          ? Number(getComputedStyle(previewGuides).opacity) *
            Number(getComputedStyle(area).opacity) *
            Number(getComputedStyle(stage).opacity)
          : 0;
      return { ...current!.placementAreas[0], opacity };
    },
  };
}
