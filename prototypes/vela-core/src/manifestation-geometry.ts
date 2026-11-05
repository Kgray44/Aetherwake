/** Screen-space CSS pixels, before conversion to an SVG's local coordinates. */
export type ManifestationRect = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;
export type ManifestationPoint = Readonly<{ x: number; y: number }>;
export type ManifestationGeometryInput = Readonly<{
  actualVelaRect: ManifestationRect;
  hostRect: ManifestationRect;
  viewport: Readonly<{ width: number; height: number }>;
}>;
export type ManifestationBridgeGeometry = Readonly<{
  /** SVG bounds in viewport CSS pixels; every path/control point is inside. */
  bounds: ManifestationRect;
  /** SVG left/top relative to hostRect, for an absolutely positioned sibling. */
  offset: ManifestationPoint;
  /** Closed optical ribbon and optional fine centerline, both bounds-local. */
  path: string;
  spine: string;
  /** Actual sculpture attachment and response attachment, both bounds-local. */
  origin: ManifestationPoint;
  target: ManifestationPoint;
  side: "top" | "right" | "bottom" | "left";
}>;

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));
const point = (x: number, y: number): ManifestationPoint => ({ x, y });
const add = (
  p: ManifestationPoint,
  direction: ManifestationPoint,
  distance: number,
) => point(p.x + direction.x * distance, p.y + direction.y * distance);

function validRect(rect: ManifestationRect): boolean {
  return (
    [
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      rect.x + rect.width,
      rect.y + rect.height,
    ].every(Number.isFinite) &&
    rect.width >= 2 &&
    rect.height >= 2
  );
}

/**
 * Pure geometry only. The existing host/Motion Coordinator supplies its current
 * transformed sculpture and response bounds, and owns the SVG and all motion.
 * No saved layout, DOM reads, animation state, timers or semantic classification.
 * Invalid, invisible, overlapping or subpixel attachments need no bridge.
 */
export function manifestationGeometry({
  actualVelaRect: source,
  hostRect: host,
  viewport,
}: ManifestationGeometryInput): ManifestationBridgeGeometry | null {
  const { width, height } = viewport;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 2 ||
    height < 2 ||
    !validRect(source) ||
    !validRect(host)
  )
    return null;

  const visible = (rect: ManifestationRect) =>
    rect.x < width &&
    rect.y < height &&
    rect.x + rect.width > 0 &&
    rect.y + rect.height > 0;
  if (!visible(source) || !visible(host)) return null;
  if (
    source.x <= host.x + host.width &&
    source.x + source.width >= host.x &&
    source.y <= host.y + host.height &&
    source.y + source.height >= host.y
  )
    return null;

  const center = point(
    source.x + source.width / 2,
    source.y + source.height / 2,
  );
  // The nearest point on a rounded contour changes continuously around corners.
  // An inset join lets the host's skin cover the seam instead of outlining it.
  const radius = Math.min(32, host.width / 2, host.height / 2);
  const corner = point(
    clamp(center.x, host.x + radius, host.x + host.width - radius),
    clamp(center.y, host.y + radius, host.y + host.height - radius),
  );
  const nx = center.x - corner.x,
    ny = center.y - corner.y;
  const normalLength = Math.hypot(nx, ny);
  if (!Number.isFinite(normalLength) || normalLength < 1) return null;
  const outward = point(nx / normalLength, ny / normalLength);
  const target = add(corner, outward, radius - Math.min(4, radius / 4));
  const dx = target.x - center.x,
    dy = target.y - center.y;
  const rayLength = Math.hypot(dx, dy);
  const ellipseScale =
    1 / Math.hypot(dx / (source.width / 2), dy / (source.height / 2));
  if (
    !Number.isFinite(rayLength) ||
    !Number.isFinite(ellipseScale) ||
    rayLength < 1
  )
    return null;
  const direction = point(dx / rayLength, dy / rayLength);
  const origin = add(
    add(center, point(dx, dy), ellipseScale),
    direction,
    -Math.min(2, source.width * 0.03, source.height * 0.03),
  );
  const onScreen = (p: ManifestationPoint) =>
    p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height;
  // Never invent a new origin by clamping an offscreen sculpture to the screen.
  if (!onScreen(origin) || !onScreen(target)) return null;
  const distance = Math.hypot(target.x - origin.x, target.y - origin.y);
  if (!Number.isFinite(distance) || distance < 6) return null;

  const sourceTangent = point(-direction.y, direction.x);
  const targetTangent = point(outward.y, -outward.x);
  const halfWidth = (
    p: ManifestationPoint,
    tangent: ManifestationPoint,
    desired: number,
  ) =>
    Math.min(
      desired,
      Math.abs(tangent.x) > 1e-8
        ? Math.min(p.x, width - p.x) / Math.abs(tangent.x)
        : desired,
      Math.abs(tangent.y) > 1e-8
        ? Math.min(p.y, height - p.y) / Math.abs(tangent.y)
        : desired,
    );
  const sourceWidth = halfWidth(
    origin,
    sourceTangent,
    Math.min(4, source.width * 0.06, source.height * 0.06, distance * 0.05),
  );
  const targetWidth = halfWidth(
    target,
    targetTangent,
    Math.min(14, radius * 0.45, distance * 0.18),
  );
  if (sourceWidth < 0.5 || targetWidth < 0.5) return null;

  const handle = Math.min(80, distance * 0.42);
  const bounded = (p: ManifestationPoint) =>
    point(clamp(p.x, 0, width), clamp(p.y, 0, height));
  const c1 = bounded(add(origin, direction, handle));
  const c2 = bounded(add(target, outward, handle));
  const a = bounded(add(origin, sourceTangent, sourceWidth));
  const b = bounded(add(target, targetTangent, targetWidth));
  const c = bounded(add(target, targetTangent, -targetWidth));
  const d = bounded(add(origin, sourceTangent, -sourceWidth));
  const a1 = bounded(add(c1, sourceTangent, sourceWidth));
  const b1 = bounded(add(c2, targetTangent, targetWidth));
  const c1Back = bounded(add(c2, targetTangent, -targetWidth));
  const d1 = bounded(add(c1, sourceTangent, -sourceWidth));
  const points = [origin, target, c1, c2, a, b, c, d, a1, b1, c1Back, d1];
  const left = Math.max(0, Math.floor(Math.min(...points.map((p) => p.x)) - 2));
  const top = Math.max(0, Math.floor(Math.min(...points.map((p) => p.y)) - 2));
  const right = Math.min(
    width,
    Math.ceil(Math.max(...points.map((p) => p.x)) + 2),
  );
  const bottom = Math.min(
    height,
    Math.ceil(Math.max(...points.map((p) => p.y)) + 2),
  );
  const bounds = { x: left, y: top, width: right - left, height: bottom - top };
  const local = (p: ManifestationPoint) => point(p.x - left, p.y - top);
  const svg = (p: ManifestationPoint) => {
    const value = local(p);
    return `${+value.x.toFixed(3)} ${+value.y.toFixed(3)}`;
  };
  const side =
    Math.abs(outward.x) >= Math.abs(outward.y)
      ? outward.x < 0
        ? "left"
        : "right"
      : outward.y < 0
        ? "top"
        : "bottom";
  return {
    bounds,
    offset: point(left - host.x, top - host.y),
    path: `M ${svg(a)} C ${svg(a1)} ${svg(b1)} ${svg(b)} L ${svg(c)} C ${svg(c1Back)} ${svg(d1)} ${svg(d)} Z`,
    spine: `M ${svg(origin)} C ${svg(c1)} ${svg(c2)} ${svg(target)}`,
    origin: local(origin),
    target: local(target),
    side,
  };
}
