/** One outline contract for GPU geometry, DOM corners and projected occlusion.
 * Coordinates are centered, with Y up (the DOM adapter flips Y). */
export type SurfaceShape =
  | "rectangle"
  | "rounded"
  | "circle"
  | "pill"
  | "folio"
  | "lens";
export interface ContourPoint {
  x: number;
  y: number;
  nx: number;
  ny: number;
}
/** Shared by GPU silhouettes, DOM clipping and focused readers. */
export const CARD_CORNER_RADIUS = 18;
export function contourPoint(
  width: number,
  height: number,
  shape: SurfaceShape,
  unfold: number,
  phase: number,
  outset: number,
  result: ContourPoint,
) {
  const corner = Math.min(3, Math.floor((phase >= 1 ? 0 : phase) * 4));
  const angle = phase * Math.PI * 2;
  const halfW = Math.max(1, width * 0.5 + outset);
  const halfH = Math.max(1, height * 0.5 + outset);
  const reading = Math.max(0, Math.min(1, unfold));
  const radial = shape === "circle" || shape === "lens";
  const base = shape === "pill" ? Math.min(halfW, halfH) : CARD_CORNER_RADIUS;
  const radius = Math.max(
    0.5,
    Math.min(
      base * (1 - reading) + CARD_CORNER_RADIUS * reading + outset,
      halfW,
      halfH,
    ),
  );
  const rx = radial
    ? halfW * (1 - reading) +
      Math.min(CARD_CORNER_RADIUS + outset, halfW) * reading
    : radius;
  const ry = radial
    ? halfH * (1 - reading) +
      Math.min(CARD_CORNER_RADIUS + outset, halfH) * reading
    : radius;
  const c = Math.cos(angle),
    s = Math.sin(angle);
  result.x = (corner === 0 || corner === 3 ? 1 : -1) * (halfW - rx) + c * rx;
  result.y = (corner < 2 ? 1 : -1) * (halfH - ry) + s * ry;
  const nx = c / rx,
    ny = s / ry,
    inverse = 1 / Math.hypot(nx, ny);
  result.nx = nx * inverse;
  result.ny = ny * inverse;
  return result;
}
export function defaultSurfaceShape(kind?: string): SurfaceShape {
  return kind === "research" ? "lens" : "rounded";
}
export function surfaceBorderRadius(
  shape: SurfaceShape,
  w: number,
  h: number,
  unfold: number,
) {
  const radial = shape === "circle" || shape === "lens";
  if (radial) {
    const u = Math.max(0, Math.min(1, unfold));
    return `${w * 0.5 * (1 - u) + Math.min(CARD_CORNER_RADIUS, w / 2) * u}px / ${h * 0.5 * (1 - u) + Math.min(CARD_CORNER_RADIUS, h / 2) * u}px`;
  }
  const u = Math.max(0, Math.min(1, unfold));
  const base = shape === "pill" ? Math.min(w, h) * 0.5 : CARD_CORNER_RADIUS;
  const r = Math.min(w / 2, h / 2, base * (1 - u) + CARD_CORNER_RADIUS * u);
  return `${r}px`;
}
