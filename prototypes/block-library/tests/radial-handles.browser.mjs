import "../direct-manipulation.css";
import "../identity-view.css";
import { applyBlockPoseStyle } from "../pose-style.ts";
import { surfaceBorderRadius } from "../../visual-experience/cinematic-v3/src/surface-contour.ts";

/** Actual browser layout/hit testing of production interaction CSS and shared
 * contours. This is a hidden hardware-disabled component fixture, not native
 * input, a GPU render, a user profile, or artistic/performance acceptance. */
export async function run() {
  const base = document.createElement("style");
  base.textContent = `*{box-sizing:border-box}body{margin:0;padding:24px;overflow:auto;background:#101521;color:#eee;font:16px/1.5 system-ui}.folio{position:relative;margin:0}.resource-presentation{position:absolute;inset:0;container-type:size}.folio-inner{position:absolute;inset:0;display:flex;flex-direction:column;padding:24px}.folio-top{display:flex;min-height:26px}.folio-actions{margin-left:auto}.title-select{padding:0;border:0;background:none;color:inherit;text-align:left}.working-content{flex:1;min-height:0}.working-content textarea{display:block;min-width:0;width:100%;height:100%;min-height:0;resize:none;padding:2px;border:0;font:inherit}`;
  document.head.append(base);
  const checks = [];
  let handlePoints = 0,
    contentPoints = 0;
  // Hidden pages need not schedule frames or timers. This finite fixture uses
  // synchronous layout reads/hit testing, with no paint/scheduling claim.
  for (const shape of [
    "rectangle",
    "rounded",
    "folio",
    "lens",
    "circle",
    "pill",
  ])
    for (const [width, height] of [
      [128, 96],
      [420, 420],
      [560, 320],
      [900, 640],
    ])
      for (const unfold of [0, 0.4, 1]) {
        globalThis.__radialProgress = {
          stage: "fixture",
          shape,
          width,
          height,
          unfold,
          completed: checks.length,
          handlePoints,
          contentPoints,
        };
        const article = document.createElement("article"),
          presentation = document.createElement("div"),
          inner = document.createElement("div"),
          top = document.createElement("div"),
          title = document.createElement("button"),
          heading = document.createElement("h2"),
          body = document.createElement("div"),
          editor = document.createElement("textarea"),
          edges = document.createElement("div");
        article.className = "folio";
        article.dataset.blockKind = "note";
        article.dataset.shape = shape;
        article.dataset.workspacePresentation = "usable";
        presentation.className = "resource-presentation";
        inner.className = "folio-inner";
        top.className = "folio-top";
        top.textContent = "NOTE";
        title.className = "title-select";
        heading.textContent = "Synthetic source fixture";
        title.append(heading);
        body.className = "working-content";
        editor.setAttribute("aria-label", "Synthetic note text");
        editor.value = "Synthetic body for real DOM hit testing";
        body.append(editor);
        inner.append(top, title, body);
        presentation.append(inner);
        edges.className = "aw-card-edges";
        for (const handle of ["n", "ne", "e", "se", "s", "sw", "w", "nw"]) {
          const edge = document.createElement("span");
          edge.className = "aw-card-edge aw-card-edge--" + handle;
          edge.dataset.resizeEdge = handle;
          edges.append(edge);
        }
        article.append(presentation, edges);
        document.body.append(article);
        const radius = surfaceBorderRadius(shape, width, height, unfold);
        applyBlockPoseStyle(
          article.style,
          `position:relative;width:${width}px;height:${height}px;--unfold:${unfold};border-radius:${radius};clip-path:inset(0 round ${radius});`,
        );
        const failures = [];
        for (const edge of edges.children) {
          edge.scrollIntoView({ block: "center", inline: "center" });
          const r = edge.getBoundingClientRect(),
            x = Math.round(r.x + r.width / 2),
            y = Math.round(r.y + r.height / 2),
            hit = document.elementFromPoint(x, y);
          handlePoints++;
          if (hit !== edge && !edge.contains(hit))
            failures.push({
              handle: edge.dataset.resizeEdge,
              point: { x, y },
              hit: hit?.className ?? "none",
            });
        }
        // Reasonable working sizes must keep their actual text rectangle in
        // the mask. Tiny resize minima are covered by handles, not a claim
        // that all text/controls fit simultaneously in a 128×96 surface.
        if (width >= 300 && height >= 260 && width <= 560) {
          const r = editor.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0)
            failures.push({ content: "Collapsed editor rectangle" });
          else
            for (const [cx, cy] of [
              [r.left + 2, r.top + 2],
              [r.right - 2, r.top + 2],
              [r.right - 2, r.bottom - 2],
              [r.left + 2, r.bottom - 2],
            ]) {
              window.scrollBy(cx - innerWidth / 2, cy - innerHeight / 2);
              const moved = editor.getBoundingClientRect(),
                x = cx - r.left + moved.left,
                y = cy - r.top + moved.top,
                hit = document.elementFromPoint(Math.round(x), Math.round(y));
              contentPoints++;
              if (hit !== editor)
                failures.push({
                  content: "Editor clipped",
                  point: { x, y },
                  hit: hit?.className ?? "none",
                });
            }
        }
        checks.push({
          shape,
          width,
          height,
          unfold,
          radius,
          passed: failures.length === 0,
          failures,
        });
        article.remove();
      }
  base.remove();
  globalThis.__radialProgress = {
    stage: "complete",
    completed: checks.length,
    handlePoints,
    contentPoints,
  };
  return {
    contract: "aerynth.curved-card-dom@1",
    checks,
    handlePoints,
    contentPoints,
    nativeInput: false,
    gpuEvidence: false,
  };
}
