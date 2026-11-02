export type ScreenRectangle = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

/** Geometry only; the host retains control ownership and content. */
export function visibleUiRectangles(
  elements: readonly HTMLElement[],
  origin: { left: number; top: number },
  styleFor: (
    element: HTMLElement,
  ) => Pick<
    CSSStyleDeclaration,
    "visibility" | "display" | "opacity"
  > = getComputedStyle,
): ScreenRectangle[] {
  const result: ScreenRectangle[] = [];
  if (!Number.isFinite(origin.left) || !Number.isFinite(origin.top))
    return result;
  for (const element of elements) {
    if (element.hidden || !element.getClientRects().length) continue;
    const style = styleFor(element);
    if (
      style.visibility !== "visible" ||
      style.display === "none" ||
      style.opacity === "0"
    )
      continue;
    const r = element.getBoundingClientRect();
    if (
      ![r.left, r.top, r.right, r.bottom].every(Number.isFinite) ||
      r.right <= r.left ||
      r.bottom <= r.top
    )
      continue;
    result.push({
      left: r.left - origin.left,
      top: r.top - origin.top,
      right: r.right - origin.left,
      bottom: r.bottom - origin.top,
    });
  }
  return result;
}

export function pointInsideUi(
  x: number,
  y: number,
  rectangles: readonly ScreenRectangle[],
) {
  return rectangles.some(
    (r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom,
  );
}

/** Optional caption leaders yield to foreground UI without masking bodies. */
export function segmentCrossesUi(
  a: { x: number; y: number },
  b: { x: number; y: number },
  rectangles: readonly ScreenRectangle[],
) {
  if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return true;
  return rectangles.some((r) => {
    let low = 0,
      high = 1;
    for (const [start, delta, min, max] of [
      [a.x, b.x - a.x, r.left, r.right],
      [a.y, b.y - a.y, r.top, r.bottom],
    ]) {
      if (delta === 0) {
        if (start < min || start > max) return false;
        continue;
      }
      const u = (min - start) / delta,
        v = (max - start) / delta;
      low = Math.max(low, Math.min(u, v));
      high = Math.min(high, Math.max(u, v));
      if (low > high) return false;
    }
    return true;
  });
}
