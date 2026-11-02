import type { BlockInstanceKind } from './contracts.ts';

/** Projected CSS pixels, after the host's existing camera/contour projection.
 * Body measurements describe the retained working wrapper, not its scroll area. */
export type BlockFootprint = {
  width: number;
  height: number;
  bodyWidth: number;
  bodyHeight: number;
  textScale: number;
};
export type BlockComposition = 'working' | 'overview';
export type BlockApproachTarget = { minimumBodyWidth: number; minimumBodyHeight: number };

/** Engineering calibration, not canonical geometry, minimum resize limits or an
 * editing/authorization gate. Native visual qualification remains necessary. */
export const readableBody = Object.freeze({
  conversation: Object.freeze({ width: 240, height: 96 }),
  note: Object.freeze({ width: 192, height: 80 }),
  task: Object.freeze({ width: 160, height: 48 }),
  task_group: Object.freeze({ width: 224, height: 112 }),
  stream: Object.freeze({ width: 240, height: 112 }),
  project_overview: Object.freeze({ width: 256, height: 112 }),
  resource_browser: Object.freeze({ width: 256, height: 120 }),
  collection_browser: Object.freeze({ width: 224, height: 120 }),
  research: Object.freeze({ width: 192, height: 80 }),
  reference: Object.freeze({ width: 176, height: 72 }),
} satisfies Record<BlockInstanceKind, { width: number; height: number }>);
const widthMargin = 16, heightMargin = 12;
const scale = (value: number) => Number.isFinite(value) && value > 0 ? value : 1;

export function blockApproachTarget(kind: BlockInstanceKind, textScale = 1): BlockApproachTarget {
  const minimum = readableBody[kind], factor = scale(textScale);
  return {
    minimumBodyWidth: minimum.width * factor + widthMargin,
    minimumBodyHeight: minimum.height * factor + heightMargin,
  };
}

/** No viewport containment test: a partially visible card can still be used.
 * Missing/hidden card measurements retain the prior mode. A real observation
 * of zero remaining body space on a visible card needs its header Approach. */
export function blockComposition(kind: BlockInstanceKind, footprint: BlockFootprint, previous: BlockComposition = 'working', inputActive = false): BlockComposition {
  if (inputActive) return 'working';
  if (![footprint.width, footprint.height, footprint.textScale].every(value => Number.isFinite(value) && value > 0)
    || ![footprint.bodyWidth, footprint.bodyHeight].every(value => Number.isFinite(value) && value >= 0)) return previous;
  const minimum = readableBody[kind], factor = scale(footprint.textScale),
    width = Math.min(footprint.width, footprint.bodyWidth),
    height = Math.min(footprint.height, footprint.bodyHeight);
  if (previous === 'working') return width < minimum.width * factor - widthMargin || height < minimum.height * factor - heightMargin ? 'overview' : 'working';
  return width >= minimum.width * factor + widthMargin && height >= minimum.height * factor + heightMargin ? 'working' : 'overview';
}
