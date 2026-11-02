export function sourceLinks(content: string): string[] {
  const values: string[] = [];
  for (const match of content.matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
    try {
      const url = new URL(match[0].replace(/[),.;!?\]}]+$/, ""));
      if (
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !values.includes(url.href)
      )
        values.push(url.href);
    } catch {
      /* A malformed source remains plain note text. */
    }
    if (values.length === 50) break;
  }
  return values;
}
