/** Deliberately small Markdown subset. HTML and remote media are always literal text. */
type TableAlignment = 'start' | 'center' | 'end';
type MarkdownTable = { kind: 'table'; headers: string[]; alignments: TableAlignment[]; rows: string[][] };
export type MarkdownBlock = MarkdownTable | { kind: 'paragraph' | 'heading' | 'quote' | 'list' | 'code'; text: string; level?: number; language?: string; ordered?: boolean; start?: number; items?: string[] };

function tableCells(line: string): string[] | null {
  const cells: string[] = [];
  let start = 0, backslashes = 0;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '|' && backslashes % 2 === 0) {
      cells.push(line.slice(start, index).trim());
      start = index + 1;
    }
    backslashes = char === '\\' ? backslashes + 1 : 0;
  }
  if (!cells.length) return null;
  cells.push(line.slice(start).trim());
  if (line.trimStart().startsWith('|')) cells.shift();
  if (cells.at(-1) === '' && !line.slice(start).trim()) cells.pop();
  return cells.map(cell => cell.replace(/\\\|/g, '|'));
}

function tableHeader(line: string, delimiter: string | undefined): MarkdownTable | null {
  if (!delimiter || !/^[\s|:\-]+$/.test(delimiter)) return null;
  const headers = tableCells(line), rules = tableCells(delimiter);
  if (!headers?.length || rules?.length !== headers.length || !rules.every(rule => /^:?-{3,}:?$/.test(rule))) return null;
  const alignments = rules.map((rule): TableAlignment => rule.endsWith(':') ? rule.startsWith(':') ? 'center' : 'end' : 'start');
  return { kind: 'table', headers, alignments, rows: [] };
}
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
      const start = ordered ? Number(list[2]) : undefined;
      // HTML's start attribute is a signed 32-bit integer. Unsupported numbers remain literal.
      if (start !== undefined && (!Number.isSafeInteger(start) || start > 2147483647)) { blocks.push({kind:'paragraph',text:line});continue; }
      while (i < lines.length) { const match = pattern.exec(lines[i]); if (!match) break; items.push(match[1]); i++; }
      blocks.push({ kind: 'list', text: '', ordered, ...(ordered?{start}:{}), items }); continue;
    }
    const table = tableHeader(line, lines[i]);
    if (table) {
      i++;
      while (i < lines.length && !special(lines[i]) && !tableHeader(lines[i], lines[i + 1])) {
        const cells = tableCells(lines[i]);
        if (!cells || cells.length !== table.headers.length) break;
        table.rows.push(cells);
        i++;
      }
      blocks.push(table);
      continue;
    }
    const body = [line]; while (i < lines.length && !special(lines[i]) && !tableHeader(lines[i], lines[i + 1])) body.push(lines[i++]);
    blocks.push({ kind: 'paragraph', text: body.join('\n') });
  }
  return blocks;
}

/** Only http(s) and mailto links; no HTML parsing, script URLs, remote image requests or highlighting execution. */
export function appendInlineMarkdown(target: HTMLElement, text: string, citation?: (index: number) => HTMLElement | null) {
  const pattern = /(\uE000\d{1,2}\uE001|`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\([^\s)]+\))/g;
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    target.append(document.createTextNode(text.slice(start, match.index)));
    const original = match[0]; let node: HTMLElement;
    if (original.startsWith('\uE000')) {
      const source = citation?.(Number(original.slice(1, -1)));
      if (source) target.append(source);
      if (!citation) target.append(document.createTextNode(original));
      start = match.index! + original.length;
      continue;
    }
    const token = citation ? original.replace(/\uE000\d{1,2}\uE001/g, '') : original;
    if (token[0] === '`') { node = document.createElement('code'); node.textContent = token.slice(1, -1); }
    else if (token.startsWith('**')) { node = document.createElement('strong'); node.textContent = token.slice(2, -2); }
    else if (token[0] === '*') { node = document.createElement('em'); node.textContent = token.slice(1, -1); }
    else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)!;
      if (/^(https?:\/\/|mailto:)/i.test(link[2])) { const a = document.createElement('a'); a.href = link[2]; a.rel = 'noreferrer noopener'; a.target = '_blank'; a.textContent = link[1]; node = a; }
      else { node = document.createElement('span'); node.textContent = token; }
    }
    target.append(node);
    // Keep sources beside the formatted span, outside code and links.
    if (citation) for (const marker of original.matchAll(/\uE000(\d{1,2})\uE001/g)) {
      const source = citation(Number(marker[1]));
      if (source) target.append(source);
    }
    start = match.index! + original.length;
  }
  target.append(document.createTextNode(text.slice(start)));
}

export function renderMarkdown(source: string, copy: (text: string) => Promise<void>, report: (message: string) => void, citations?: { offsets: readonly number[]; element(index: number): HTMLElement }): HTMLElement {
  const root = document.createElement('div'); root.className = 'cp-markdown';
  const shown = new Set<number>();
  const marker = citations ? (index: number) => {
    if (shown.has(index) || index >= citations.offsets.length) return null;
    shown.add(index);
    return citations.element(index);
  } : undefined;
  if (citations) {
    // Remove any provider-supplied marker characters before assigning our own.
    // Match UTF-16 offsets from the canonical answer before Markdown reflows it.
    source = source.replace(/[\uE000\uE001]/g, '\uFFFD');
    const fences = Array.from(source.matchAll(/^```[^\n]*(?:\n|$)/gm));
    const fenced: { start: number; end: number }[] = [];
    for (let index = 0; index < fences.length; index += 2) {
      const opening = fences[index], closing = fences[index + 1];
      fenced.push({ start: opening.index, end: closing ? closing.index + closing[0].length : source.length });
    }
    const placements = citations.offsets.map((offset, index) => ({ offset, index })).sort((a, b) => b.offset - a.offset || b.index - a.index);
    for (const { offset, index } of placements) {
      if (Number.isSafeInteger(offset) && offset > 0 && offset <= source.length && !fenced.some(range => offset >= range.start && offset <= range.end))
        source = source.slice(0, offset) + '\uE000' + index + '\uE001' + source.slice(offset);
    }
  }
  const clean = (value: string) => citations ? value.replace(/\uE000\d{1,2}\uE001/g, '') : value;
  for (const block of markdownBlocks(source)) {
    if (block.kind === 'code') {
      const section = document.createElement('div'), header = document.createElement('div'), language = document.createElement('span'), button = document.createElement('button'), pre = document.createElement('pre'), code = document.createElement('code');
      section.className = 'cp-code'; header.className = 'cp-code-header'; language.textContent = clean(block.language || 'Code'); button.type = 'button'; button.textContent = 'Copy code';
      button.dataset.nativeCopyControl='true';
      button.addEventListener('click', () => { void copy(clean(block.text)).then(() => report('Code copied'), error => report(String(error))); });
      code.textContent = clean(block.text); pre.append(code); header.append(language, button); section.append(header, pre); root.append(section);
    } else if (block.kind === 'table') {
      const wrapper = document.createElement('div'), table = document.createElement('table');
      wrapper.className = 'cp-markdown-table';
      wrapper.tabIndex = 0;
      wrapper.setAttribute('role', 'region');
      wrapper.setAttribute('aria-label', 'Table in response');
      const head = document.createElement('thead'), body = document.createElement('tbody');
      for (const [index, cells] of [block.headers, ...block.rows].entries()) {
        const row = document.createElement('tr'), header = index === 0;
        cells.forEach((value, column) => {
          const cell = document.createElement(header ? 'th' : 'td');
          if (header) cell.setAttribute('scope', 'col');
          cell.style.textAlign = block.alignments[column];
          appendInlineMarkdown(cell, value, marker);
          row.append(cell);
        });
        (header ? head : body).append(row);
      }
      table.append(head, body);
      wrapper.append(table);
      root.append(wrapper);
    } else if (block.kind === 'list') {
      const list = document.createElement(block.ordered ? 'ol' : 'ul');
      if(block.ordered)list.setAttribute('start',String(block.start));
      for (const item of block.items!) { const li = document.createElement('li'); appendInlineMarkdown(li, item, marker); list.append(li); } root.append(list);
    } else {
      const node = document.createElement(block.kind === 'heading' ? `h${Math.min(4, block.level! + 1)}` : block.kind === 'quote' ? 'blockquote' : 'p');
      appendInlineMarkdown(node, block.text, marker); root.append(node);
    }
  }
  // Markup such as fenced code can contain an annotated span. Its source
  // remains clickable after the answer instead of altering the code itself.
  if (citations) for (let i = 0; i < citations.offsets.length; i++) {
    const source = marker?.(i);
    if (source) root.append(source);
  }
  return root;
}
