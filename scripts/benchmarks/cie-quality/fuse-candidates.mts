/** Reciprocal rank fusion for two authorized discovery lists. */
export function fuseCandidates(lexical: readonly string[], fullText: readonly string[], exact: readonly string[]): string[] {
  const scores = new Map<string, number>();
  for (const channel of [lexical, fullText]) {
    [...new Set(channel)].forEach((id, rank) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (61 + rank));
    });
  }
  const exactIds = new Set(exact);
  for (const id of exactIds) scores.delete(id);
  const ranked = [...scores].sort(([, left], [, right]) => right - left);
  return [...exactIds, ...ranked.map(([id]) => id)].slice(0, 3);
}
