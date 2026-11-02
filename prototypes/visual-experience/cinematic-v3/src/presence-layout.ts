export type PresenceRect = { x: number; y: number; w: number; h: number };
/** Symmetric UI reserves keep the sculpture and full card centers identical. */
export function sculptureRegion(card: PresenceRect): PresenceRect {
  const inset = 28 * Math.min(1, card.w / 208, card.h / 260);
  return { x: card.x, y: card.y + inset, w: card.w, h: card.h - inset * 2 };
}
/** Screen-space overview pose; never changes a saved workspace placement. */
export function overviewPresence(
  width: number,
  height: number,
  barBottom = 201,
): PresenceRect {
  const w = Math.min(208, width * 0.18),
    h = (w * 260) / 208;
  return {
    x: Math.max(16, width - w - 28),
    y: Math.max(104, Math.min(Math.max(180, barBottom + 18), height - h - 145)),
    w,
    h,
  };
}
