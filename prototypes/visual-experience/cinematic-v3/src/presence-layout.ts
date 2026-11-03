import { intersects } from "../../../workspace-engine/collisions.mts";
import type { Geometry } from "../../../workspace-engine/contracts.mts";

export type PresenceRect = { x: number; y: number; w: number; h: number };
/** Only top chrome crossing Vela's own column reserves vertical space. */
export function overviewChromeBottom(
  width: number,
  height: number,
  chrome: { left: number; right: number; top: number; bottom: number },
) {
  const right = width - 28;
  const left = right - Math.min(208, width * 0.18);
  return chrome.right > left && chrome.left < right && chrome.top < height / 2
    ? chrome.bottom
    : 104;
}
/** Symmetric UI reserves keep the sculpture and full card centers identical. */
export function sculptureRegion(card: PresenceRect): PresenceRect {
  const inset = 28 * Math.min(1, card.w / 208, card.h / 260);
  return { x: card.x, y: card.y + inset, w: card.w, h: card.h - inset * 2 };
}
/** A conservative remaining path, including the stage's concurrent scale.
 * Existing destination overlaps cannot be solved by delaying presentation. */
export function presenceTravelOccludes(
  current: PresenceRect,
  destination: PresenceRect,
  card: Geometry,
  stage: { scale: number; originX: number; originY: number },
) {
  if (current.x === destination.x && current.y === destination.y &&
      current.w === destination.w && current.h === destination.h) return false;
  const end = { x: destination.x, y: destination.y, width: destination.w, height: destination.h };
  if (intersects(end, card, 0)) return false;
  const x = Math.min(current.x, end.x), y = Math.min(current.y, end.y);
  const sweep = {
    x, y,
    width: Math.max(current.x + current.w, end.x + end.width) - x,
    height: Math.max(current.y + current.h, end.y + end.height) - y,
  };
  const scaledX = stage.originX + (card.x - stage.originX) * stage.scale;
  const scaledY = stage.originY + (card.y - stage.originY) * stage.scale;
  const left = Math.min(card.x, scaledX), top = Math.min(card.y, scaledY);
  return intersects(sweep, {
    x: left, y: top,
    width: Math.max(card.x + card.width, scaledX + card.width * stage.scale) - left,
    height: Math.max(card.y + card.height, scaledY + card.height * stage.scale) - top,
  }, 0);
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
