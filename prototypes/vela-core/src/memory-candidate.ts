/** Suggest one verbatim, explicit statement from a user-selected message. The
 * caller retains the message identity and must obtain native save approval. */
export function suggestMemoryFromMessage(content: string) {
  if (content.length > 4096 || /```|~~~|\b(?:password|passphrase|secret|credentials?|api[ -]?key|access[ -]?token|private[ -]?key|example|hypothetical|pretend|role[ -]?play)\b/iu.test(content)) return null;

  const candidates = [];
  for (const line of content.split(/\r?\n/u)) {
    if (/^(?: {4}|\t)/u.test(line)) continue;
    const text = line.trim();
    // Leave compound, hedged, quoted, and conditional statements for manual review.
    if (text.length > 240 || /[?;"“”<>`]|\b(?:maybe|might|possibly|probably|unless|if|hypothetical|example|ignore|instruction)\b/iu.test(text)) continue;
    const preference = /^I prefer (.+?)\.$/iu.exec(text);
    const decision = /^(?:I decided to|We decided to) (.+?)\.$/iu.exec(text);
    const match = preference ?? decision;
    if (!match || /[.!]/u.test(match[1])) continue;
    const keywords = [...new Set(match[1].toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]{3,64}/gu) ?? [])]
      .filter(term => !['the', 'for', 'and', 'with', 'that', 'this'].includes(term)).slice(0, 8);
    if (keywords.length) candidates.push({ text, category: preference ? 'preferences' as const : 'decisions' as const, keywords });
  }
  return candidates.length === 1 ? candidates[0] : null;
}
