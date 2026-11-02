/** Presentation bounds only. The canonical placement remains the collision and
 * restoration authority, including while IME defers a requested minimize. */
export function minimizedCardSize(
  block: { width: number; height: number; shape: string },
  effectiveMinimized: boolean,
  zoom = 1,
) {
  if (!effectiveMinimized) return { width: block.width, height: block.height };
  // Retained header controls need physical room even at a distant camera.
  // Never enlarge beyond the original placement's projected footprint.
  const headerRoom = 128 / zoom;
  if (block.shape === "circle") {
    const side = Math.min(Math.max(208, headerRoom), block.width, block.height);
    return { width: side, height: side };
  }
  return {
    width: Math.min(Math.max(320, headerRoom), block.width),
    height: Math.min(Math.max(176, headerRoom), block.height),
  };
}
