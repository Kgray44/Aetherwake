export interface MaterialSurface {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  lift: number;
  yaw: number;
  opacity: number;
}

interface ProjectedBounds {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Match perspective(1500px) translateZ(lift) rotateY(yaw), centered on the
 * resource. A projected rectangle's AABB conservatively includes round lenses
 * and is derived from coordinator poses, never synchronous DOM layout reads. */
function projectedBounds(surface: MaterialSurface): ProjectedBounds | null {
  if (
    surface.opacity <= 0.05 ||
    ![
      surface.x,
      surface.y,
      surface.w,
      surface.h,
      surface.lift,
      surface.yaw,
      surface.opacity,
    ].every(Number.isFinite) ||
    surface.w <= 0 ||
    surface.h <= 0
  )
    return null;
  const perspective = 1500;
  const angle = (surface.yaw * Math.PI) / 180;
  const cosine = Math.cos(angle),
    sine = Math.sin(angle);
  const cx = surface.x + surface.w / 2,
    cy = surface.y + surface.h / 2;
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const dx of [-surface.w / 2, surface.w / 2]) {
    const denominator = perspective - surface.lift + dx * sine;
    // Crossing the CSS perspective plane has no finite conservative AABB.
    // Keep the material opaque against every other visible resource instead.
    if (denominator <= 0)
      return {
        id: surface.id,
        left: -Infinity,
        top: -Infinity,
        right: Infinity,
        bottom: Infinity,
      };
    const scale = perspective / denominator;
    const x = cx + dx * cosine * scale;
    for (const dy of [-surface.h / 2, surface.h / 2]) {
      const y = cy + dy * scale;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return { id: surface.id, left, top, right, bottom };
}

/** Every visible member of an overlapping pair needs an opaque DOM veil:
 * opaque GPU faces cannot occlude a different resource's DOM text above canvas.
 * This changes presentation clarity only; identities and input poses stay intact. */
export function overlappingSurfaceIds(
  surfaces: readonly MaterialSurface[],
): Set<string> {
  const bounds = surfaces
    .map(projectedBounds)
    .filter((box): box is ProjectedBounds => box !== null);
  const overlapping = new Set<string>();
  for (let i = 0; i < bounds.length; i++) {
    for (let j = i + 1; j < bounds.length; j++) {
      const a = bounds[i],
        b = bounds[j];
      if (
        Math.max(a.left, b.left) < Math.min(a.right, b.right) &&
        Math.max(a.top, b.top) < Math.min(a.bottom, b.bottom)
      ) {
        overlapping.add(a.id);
        overlapping.add(b.id);
      }
    }
  }
  return overlapping;
}
