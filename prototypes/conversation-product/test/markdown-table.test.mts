import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownBlocks, renderMarkdown } from '../src/markdown.ts';
import { componentDocument } from './component-dom.mts';

test('comparison answers expose table headers, escaped pipes and inline citations', () => {
  const fixture = componentDocument(), restore = fixture.install();
  try {
    const source = 'Here are the options.\n\n| Plan | Cost |\n| --- | ---: |\n| **Basic** | $5 |\n| A \\| B | <img src=x> |';
    const root = renderMarkdown(source, async () => {}, () => {}, {
      offsets: [source.indexOf('$5') + 2],
      element: () => fixture.doc.createElement('button'),
    });
    assert.deepEqual(markdownBlocks(source).map(block => block.kind), ['paragraph', 'table']);
    const table = root.querySelector('table');
    assert.ok(table);
    assert.deepEqual(table.querySelectorAll('th').map(node => [node.textContent, node.getAttribute('scope')]), [['Plan', 'col'], ['Cost', 'col']]);
    const cells = table.querySelectorAll('td');
    assert.deepEqual(cells.map(node => node.textContent), ['Basic', '$5', 'A | B', '<img src=x>']);
    assert.equal(cells[0].querySelector('strong')?.textContent, 'Basic');
    assert.ok(cells[1].querySelector('button'));
    assert.equal(cells[3].querySelectorAll('img').length, 0);
  } finally { restore(); }
});

test('table recognition preserves malformed headers, code fences and prose after a table', () => {
  assert.deepEqual(markdownBlocks('A | B\n---\nC | D').map(block => block.kind), ['paragraph']);
  assert.deepEqual(markdownBlocks('```text\n| A | B |\n| --- | --- |\n```').map(block => block.kind), ['code']);
  assert.deepEqual(markdownBlocks('A | B\n--- | ---\nC | D\nOrdinary prose').map(block => block.kind), ['table', 'paragraph']);
});
