/** Presentation bounds only. The canonical placement remains the collision and
 * restoration authority, including while IME defers a requested minimize. */
export function minimizedCardSize(
  block: { width: number; height: number; shape: string },
  effectiveMinimized: boolean,
) {
  if (!effectiveMinimized) return { width: block.width, height: block.height };
  if (block.shape === "circle") {
    const side = Math.min(208, block.width, block.height);
    return { width: side, height: side };
  }
  return {
    width: Math.min(320, block.width),
    height: Math.min(176, block.height),
  };
}
