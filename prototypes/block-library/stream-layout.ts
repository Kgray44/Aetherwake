import type { StreamEvent } from "../integrated-backend/src/contracts.mts";
import { compactFlowGeometry } from './flow-geometry.ts';

export type StreamEdge = { from: string; to: string };
export type StreamLayout = {
  nodes: { event: StreamEvent; x: number; y: number; family: string }[];
  edges: StreamEdge[];
  omitted: number;
  unresolved: number;
};
/** A bounded projection, never an event store. Correlation is deliberately not an edge. */
export function layoutStream(events: readonly StreamEvent[], limit = 80): StreamLayout {
  const ordered = [...events].sort((a, b) => a.cursor - b.cursor || a.eventId.localeCompare(b.eventId));
  const cap = Number.isFinite(limit) ? Math.max(1, Math.min(120, Math.floor(limit))) : 80;
  const visible = ordered.slice(-cap);
  const ids = new Map(visible.map(e => [e.eventId, e]));
  const edges: StreamEdge[] = [];
  let unresolved = 0;
  for (const event of visible) {
    if (!event.causationId) continue;
    let parent = ids.get(event.causationId);
    if (!parent) {
      // Native identifiers are only meaningful within their actual provider connection.
      const matches = visible.filter(e => e.nativeEventId === event.causationId &&
        e.providerId === event.providerId && e.providerInstanceId === event.providerInstanceId &&
        e.connectionId === event.connectionId && e.threadId === event.threadId);
      if (matches.length === 1) parent = matches[0];
    }
    // Earlier cursors yield an acyclic layout. Conflicts remain inspectable, never guessed.
    if (parent && parent.cursor < event.cursor) edges.push({ from: parent.eventId, to: event.eventId });
    else unresolved++;
  }
  const positions = compactFlowGeometry(visible.map(event => event.eventId), edges, 176, 60);
  const nodes = visible.map(event => {
    return { event, ...positions.get(event.eventId)!, family: streamFamily(event) };
  });
  return { nodes, edges, omitted: Math.max(0, ordered.length - visible.length), unresolved };
}
export function streamFamily(event: StreamEvent): string {
  const value = `${event.type} ${event.status ?? ""}`.toLowerCase();
  if (/fail|error|cancel/.test(value)) return "failure";
  if (/unknown|uncertain|gap|reorder/.test(value)) return "uncertain";
  if (/wait|block|approval/.test(value)) return "gate";
  if (/verif/.test(value)) return "verification";
  if (/tool|exec/.test(value)) return "tool";
  if (/evidence|source|sample|inspect/.test(value)) return "evidence";
  if (/complet|settled|result|report/.test(value)) return "outcome";
  if (/retry|recover/.test(value)) return "recovery";
  return "activity";
}
export function streamPath(edges: readonly StreamEdge[], selected: string): Set<string> {
  const result = new Set([selected]);
  // Trace ancestors and descendants separately: siblings are not the chosen branch.
  for (const direction of ["up", "down"]) {
    const found = new Set([selected]);
    for (let pass = 0; pass <= edges.length; pass++) {
      let changed = false;
      for (const edge of edges) {
        const from = direction === "up" ? edge.to : edge.from;
        const to = direction === "up" ? edge.from : edge.to;
        if (found.has(from) && !found.has(to)) { found.add(to); result.add(to); changed = true; }
      }
      if (!changed) break;
    }
  }
  return result;
}
