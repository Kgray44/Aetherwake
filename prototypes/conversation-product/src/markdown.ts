/** Deliberately small Markdown subset. HTML and remote media are always literal text. */
export type MarkdownBlock = { kind: 'paragraph' | 'heading' | 'quote' | 'list' | 'code'; text: string; level?: number; language?: string; ordered?: boolean; items?: string[] };
export function markdownBlocks(source: string): MarkdownBlock[] {
  const lines = source.replaceAll('\r\n', '\n').split('\n'), blocks: MarkdownBlock[] = [];
  let i = 0;
  const special = (line: string) => /^(?:\s*$|```|#{1,4} |>[ ]?|[-*] |\d+\. )/.test(line);
  while (i < lines.length) {
    const line = lines[i++]; if (!line.trim()) continue;
    if (line.startsWith('```')) {
      const language = line.slice(3).trim().slice(0, 40), body: string[] = [];
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push({ kind: 'code', text: body.join('\n'), language }); continue;
    }
    const heading = /^(#{1,4}) (.*)$/.exec(line);
    if (heading) { blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] }); continue; }
    if (/^> ?/.test(line)) {
      const body = [line.replace(/^> ?/, '')]; while (i < lines.length && /^> ?/.test(lines[i])) body.push(lines[i++].replace(/^> ?/, ''));
      blocks.push({ kind: 'quote', text: body.join('\n') }); continue;
    }
    const list = /^(?:([-*]) |(\d+)\. )(.*)$/.exec(line);
    if (list) {
      const ordered = !!list[2], items = [list[3]], pattern = ordered ? /^\d+\. (.*)$/ : /^[-*] (.*)$/;
      while (i < lines.length) { const match = pattern.exec(lines[i]); if (!match) break; items.push(match[1]); i++; }
      blocks.push({ kind: 'list', text: '', ordered, items }); continue;
    }
    const body = [line]; while (i < lines.length && !special(lines[i])) body.push(lines[i++]);
    blocks.push({ kind: 'paragraph', text: body.join('\n') });
  }
  return blocks;
}

/** Only http(s) and mailto links; no HTML parsing, script URLs, remote image requests or highlighting execution. */
export function appendInlineMarkdown(target: HTMLElement, text: string) {
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\([^\s)]+\))/g;
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    target.append(document.createTextNode(text.slice(start, match.index)));
    const token = match[0]; let node: HTMLElement;
    if (token[0] === '`') { node = document.createElement('code'); node.textContent = token.slice(1, -1); }
    else if (token.startsWith('**')) { node = document.createElement('strong'); node.textContent = token.slice(2, -2); }
    else if (token[0] === '*') { node = document.createElement('em'); node.textContent = token.slice(1, -1); }
    else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)!;
      if (/^(https?:\/\/|mailto:)/i.test(link[2])) { const a = document.createElement('a'); a.href = link[2]; a.rel = 'noreferrer noopener'; a.target = '_blank'; a.textContent = link[1]; node = a; }
      else { node = document.createElement('span'); node.textContent = token; }
    }
    target.append(node); start = match.index! + token.length;
  }
  target.append(document.createTextNode(text.slice(start)));
}

export function renderMarkdown(source: string, copy: (text: string) => Promise<void>, report: (message: string) => void): HTMLElement {
  const root = document.createElement('div'); root.className = 'cp-markdown';
  for (const block of markdownBlocks(source)) {
    if (block.kind === 'code') {
      const section = document.createElement('div'), header = document.createElement('div'), language = document.createElement('span'), button = document.createElement('button'), pre = document.createElement('pre'), code = document.createElement('code');
      section.className = 'cp-code'; header.className = 'cp-code-header'; language.textContent = block.language || 'Code'; button.type = 'button'; button.textContent = 'Copy code';
      button.addEventListener('click', () => { void copy(block.text).then(() => report('Code copied'), error => report(String(error))); });
      code.textContent = block.text; pre.append(code); header.append(language, button); section.append(header, pre); root.append(section);
    } else if (block.kind === 'list') {
      const list = document.createElement(block.ordered ? 'ol' : 'ul');
      for (const item of block.items!) { const li = document.createElement('li'); appendInlineMarkdown(li, item); list.append(li); } root.append(list);
    } else {
      const node = document.createElement(block.kind === 'heading' ? `h${Math.min(4, block.level! + 1)}` : block.kind === 'quote' ? 'blockquote' : 'p');
      appendInlineMarkdown(node, block.text); root.append(node);
    }
  }
  return root;
}
