/** The rail groups only the presentation order. Cards keep their canonical IDs
 * and their relative order within each type. The host lays out these groups in
 * its existing focus transition and Motion Coordinator. */
export function groupFocusedSideCards<T>(cards: readonly T[], identity: (card: T) => { kind: string; label: string }) {
  const groups = new Map<string, { kind: string; label: string; cards: T[] }>();
  for (const card of cards) {
    const type = identity(card);
    let group = groups.get(type.kind);
    if (!group) {
      group = { ...type, cards: [] };
      groups.set(type.kind, group);
    }
    group.cards.push(card);
  }
  return [...groups.values()];
}
