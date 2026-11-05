/** Mammoth output is parsed as inert XML, then rebuilt as semantic elements.
 * No source element/attribute is adopted, no remote content is fetched, and no
 * returned HTML is inserted into the live document. */
export function mountSafeDocument(root: HTMLElement, html: string, parser = new DOMParser()) {
  const parsed = parser.parseFromString('<document>' + html.replaceAll('&nbsp;', '&#160;') + '</document>', 'application/xml');
  if (parsed.getElementsByTagName('parsererror').length) throw new Error('The converted document could not be read safely.');
  const doc = root.ownerDocument;
  const allowed = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'u', 's', 'sup', 'sub', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'br', 'hr']);
  const drop = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'form', 'input', 'button', 'video', 'audio', 'link', 'meta']);
  let count = 0;
  const append = (source: Node, parent: HTMLElement, depth: number) => {
    if (++count > 100000 || depth > 100) throw new Error('The converted document exceeds its structural limit.');
    if (source.nodeType === 3) { parent.append(doc.createTextNode(source.textContent ?? '')); return; }
    if (source.nodeType !== 1) return;
    const original = source as Element, tag = original.tagName.toLowerCase();
    if (drop.has(tag)) return;
    if (tag === 'img') {
      const src = original.getAttribute('src') ?? '';
      if (!/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(src) || src.length > 12 * 1024 * 1024) return;
      const image = doc.createElement('img'); image.src = src; image.alt = original.getAttribute('alt') ?? 'Document image';
      image.loading = 'lazy'; parent.append(image); return;
    }
    const element = doc.createElement(allowed.has(tag) ? tag : 'span');
    if (tag === 'a') { element.className = 'aw-document-link'; element.title = 'Link in source document'; }
    if (tag === 'td' || tag === 'th') for (const name of ['colspan', 'rowspan']) {
      const value = Number(original.getAttribute(name)); if (Number.isInteger(value) && value >= 1 && value <= 32) element.setAttribute(name, String(value));
    }
    for (const child of Array.from(source.childNodes)) append(child, element, depth + 1);
    parent.append(element);
  };
  const content = doc.createElement('article'); content.className = 'aw-media-document';
  for (const child of Array.from(parsed.documentElement.childNodes)) append(child, content, 0);
  root.replaceChildren(content); return content;
}

/** Search touches only authored text nodes in this rebuilt document. */
export function highlightDocument(root: HTMLElement, query: string) {
  const doc = root.ownerDocument;
  for (const mark of root.querySelectorAll('mark')) mark.replaceWith(doc.createTextNode(mark.textContent ?? ''));
  root.normalize();
  if (!query.trim()) return { count: 0, first: null as HTMLElement | null };
  const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  const walker = doc.createTreeWalker(root, 4), nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  let count = 0, first: HTMLElement | null = null;
  for (const text of nodes) {
    const source = text.data; expression.lastIndex = 0; let from = 0, match = expression.exec(source);
    if (!match) continue;
    const fragment = doc.createDocumentFragment();
    while (match && count < 1000) {
      const at = match.index;
      fragment.append(doc.createTextNode(source.slice(from, at)));
      const mark = doc.createElement('mark'); mark.textContent = match[0]; fragment.append(mark);
      first ??= mark; count++; from = at + match[0].length; match = expression.exec(source);
    }
    fragment.append(doc.createTextNode(source.slice(from))); text.replaceWith(fragment);
    if (count >= 1000) break;
  }
  return { count, first };
}
