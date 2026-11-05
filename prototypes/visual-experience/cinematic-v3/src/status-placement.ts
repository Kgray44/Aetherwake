export interface StatusObstacle {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Reuse the renderer's screen-space bounds; a notice never moves saved cards. */
export function placeStatus(options: {
  width: number;
  height: number;
  desiredWidth: number;
  obstacles: readonly StatusObstacle[];
}) {
  const { width, height } = options;
  if (
    ![width, height, options.desiredWidth].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0
  )
    throw new Error("invalid_status_viewport");
  const margin = Math.min(24, width / 8),
    bottom = 14,
    noticeHeight = 32;
  let free = [{ left: margin, right: width - margin }];
  const top = height - bottom - noticeHeight;
  for (const obstacle of options.obstacles) {
    if (
      ![obstacle.left, obstacle.top, obstacle.right, obstacle.bottom].every(
        Number.isFinite,
      )
    )
      continue;
    if (obstacle.bottom <= top - 4 || obstacle.top >= height - bottom + 4)
      continue;
    const left = obstacle.left - 8,
      right = obstacle.right + 8;
    free = free.flatMap((interval) => {
      if (left >= interval.right || right <= interval.left) return [interval];
      return [
        { left: interval.left, right: Math.min(interval.right, left) },
        { left: Math.max(interval.left, right), right: interval.right },
      ].filter((part) => part.right > part.left);
    });
  }
  const desired = Math.min(512, Math.max(128, options.desiredWidth));
  const choices = free
    .filter(
      (interval) =>
        interval.right - interval.left >= Math.min(128, width - 2 * margin),
    )
    .map((interval) => {
      const span = Math.min(desired, interval.right - interval.left);
      const left = Math.max(
        interval.left,
        Math.min(width / 2 - span / 2, interval.right - span),
      );
      return {
        left,
        width: span,
        distance: Math.abs(left + span / 2 - width / 2),
      };
    })
    .sort(
      (a, b) => a.distance - b.distance || b.width - a.width || a.left - b.left,
    );
  if (choices[0])
    return {
      left: choices[0].left,
      width: choices[0].width,
      bottom,
      placement: "footer" as const,
    };
  // Native title buttons retain their right-hand region. The decorative title
  // caption can yield this reserved strip; resource content never occupies it.
  const available = Math.max(1, width - margin - Math.min(160, width / 3));
  const span = Math.min(desired, available);
  return {
    left: Math.max(margin, (width - 160 - span) / 2),
    width: span,
    bottom: Math.max(0, height - 8 - noticeHeight),
    placement: "chrome" as const,
  };
}
