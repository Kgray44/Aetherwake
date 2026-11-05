import type { StreamEdge } from './stream-layout.ts';

/** Presentation only. Connected components retain declared topology; unrelated
 * nodes are packed beside one another without adding a single edge. */
export function compactFlowGeometry(ids: readonly string[], edges: readonly StreamEdge[], width = 190, height = 70) {
  const unique = [...new Set(ids)], known = new Set(unique), remaining = new Set(unique), result = new Map<string, { x: number; y: number; depth: number }>();
  const stepX = width + 36, stepY = height + 40, maxColumns = 4, maxWidth = stepX * maxColumns;
  let originX = 0, originY = 0, bandHeight = 0;
  for (const seed of unique) {
    if (!remaining.has(seed)) continue;
    const component = new Set([seed]); remaining.delete(seed);
    for (let pass = 0; pass < unique.length; pass++) {
      let changed = false;
      for (const edge of edges) if (known.has(edge.from) && known.has(edge.to) && (component.has(edge.from) || component.has(edge.to))) {
        for (const id of [edge.from, edge.to]) if (!component.has(id)) { component.add(id); remaining.delete(id); changed = true; }
      }
      if (!changed) break;
    }
    const ordered = unique.filter(id => component.has(id)), depths = new Map<string, number>();
    for (let pass = 0; pass < ordered.length; pass++) {
      let changed = false;
      for (const id of ordered) if (!depths.has(id)) {
        const parents = edges.filter(edge => edge.to === id && component.has(edge.from)).map(edge => edge.from);
        if (parents.every(parent => depths.has(parent))) { depths.set(id, parents.length ? Math.max(...parents.map(parent => depths.get(parent)!)) + 1 : 0); changed = true; }
      }
      if (!changed) break;
    }
    const levels = new Map<number, string[]>();
    for (const id of ordered) { const depth = depths.get(id) ?? 0; levels.set(depth, [...levels.get(depth) ?? [], id]); }
    const columns = Math.min(maxColumns, Math.max(...[...levels.values()].map(level => level.length))), boxWidth = columns * stepX;
    if (originX + boxWidth > maxWidth) { originX = 0; originY += bandHeight + 36; bandHeight = 0; }
    let levelY = 0;
    for (const [depth, level] of [...levels].sort(([a], [b]) => a - b)) {
      level.forEach((id, index) => {
        const row = Math.floor(index / maxColumns), rowSize = Math.min(maxColumns, level.length - row * maxColumns);
        const centered = (columns - rowSize) * stepX / 2;
        result.set(id, { x: originX + centered + index % maxColumns * stepX, y: originY + levelY + row * stepY, depth });
      });
      levelY += Math.ceil(level.length / maxColumns) * stepY;
    }
    bandHeight = Math.max(bandHeight, levelY); originX += boxWidth;
  }
  return result;
}

export function downwardFlowPath(from: { x: number; y: number }, to: { x: number; y: number }, width: number, height: number) {
  const ax = from.x + width / 2, ay = from.y + height, bx = to.x + width / 2, by = to.y, mid = (ay + by) / 2;
  return `M ${ax} ${ay} C ${ax} ${mid}, ${bx} ${mid}, ${bx} ${by} M ${bx - 4} ${by - 6} L ${bx} ${by} L ${bx + 4} ${by - 6}`;
}
