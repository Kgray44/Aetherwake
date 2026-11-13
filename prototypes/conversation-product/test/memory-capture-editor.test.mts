import assert from 'node:assert/strict';
import test from 'node:test';
import { componentDocument, named, until } from './component-dom.mts';
import { createMemoryCaptureEditor, type MemoryCaptureRequest } from '../src/memory-capture-editor.ts';

test('the editor sends edited text and explicit scope only after review is requested', async () => {
  const f = componentDocument();
  const restore = f.install();
  const submissions: unknown[] = [];
  try {
    const editor = createMemoryCaptureEditor({
      content: 'Original user text', conversationId: 'chat', messageId: 'message', projectAvailable: true,
      async review(request) { submissions.push(request); return true; },
      report() {},
    });
    f.root.append(editor);
    assert.deepEqual(submissions, []);
    editor.querySelector('textarea')!.value = 'Use a relay';
    const [scope, category] = editor.querySelectorAll('select');
    scope.value = 'project';
    category.value = 'decisions';
    editor.querySelector('input')!.value = 'relay, circuit, relay';
    (editor as any).fire('submit');
    await until(() => !f.root.contains(editor));
    assert.deepEqual(submissions, [{ conversationId: 'chat', messageId: 'message', text: 'Use a relay',
      scope: 'project', category: 'decisions', keywords: ['relay', 'circuit'] }]);
    assert(named(editor, 'Review memory'));
  } finally { restore(); }
});

test('a single explicitly marked statement drafts a verbatim candidate for review', async () => {
  const f = componentDocument(), restore = f.install();
  const requests: MemoryCaptureRequest[] = [];
  try {
    const create = (content: string) => createMemoryCaptureEditor({
      content, conversationId: 'chat', messageId: 'source-message', projectAvailable: true,
      async review(request) { requests.push(request); return false; },
      report() {},
    });
    const editor = create('Unrelated deployment discussion.\nRemember: Use the Quartz relay.\nOther text.');
    assert.equal(editor.querySelector('textarea')!.value, 'Use the Quartz relay.');
    assert.doesNotMatch(editor.querySelector('input')!.value, /deployment|other/i);
    assert.deepEqual(requests, []);
    (editor as any).fire('submit');
    await until(() => requests.length === 1);
    assert.equal(requests[0].messageId, 'source-message');
    assert.equal(requests[0].scope, 'conversation');
    assert.equal(requests[0].text, 'Use the Quartz relay.');
    for (const content of ['Remember: Use quartz.\nRemember: Use slate.', '> Remember: Use slate.', 'We might use slate.']) {
      assert.equal(create(content).querySelector('textarea')!.value, content);
    }
  } finally { restore(); }
});

test('only a non-project preference can be submitted for all ordinary chats', async () => {
  const f = componentDocument();
  const restore = f.install();
  const requests: MemoryCaptureRequest[] = [];
  try {
    const options = { content: 'I prefer synthetic relays.', conversationId: 'chat', messageId: 'message',
      projectAvailable: false, async review(request: MemoryCaptureRequest) { requests.push(request); return false; }, report() {} };
    const editor = createMemoryCaptureEditor(options);
    const [scope, category] = editor.querySelectorAll('select');
    assert.ok(Array.from(scope.options).some(option => option.value === 'assistant.ordinary'));
    const projectEditor = createMemoryCaptureEditor({ ...options, projectAvailable: true });
    assert.ok(!Array.from(projectEditor.querySelector('select')!.options).some(option => option.value === 'assistant.ordinary'));
    assert.equal(category.value, 'preferences');
    assert.equal(scope.value, 'conversation');
    scope.value = 'assistant.ordinary';
    category.value = 'technical';
    (editor as any).fire('submit');
    assert.deepEqual(requests, []);
    category.value = 'preferences';
    (editor as any).fire('submit');
    await until(() => requests.length === 1);
    assert.equal(requests[0].scope, 'assistant.ordinary');
  } finally { restore(); }
});

test('preference drafting leaves tentative, quoted, and formatted material for manual review', () => {
  const f = componentDocument(), restore = f.install();
  try {
    const draft = (content: string) => createMemoryCaptureEditor({ content, conversationId: 'chat', messageId: 'message',
      projectAvailable: false, async review() { throw Error('unexpected review'); }, report() {} });
    for (const text of ['I prefer quartz for now.', '> I prefer quartz.', 'I prefer quartz if slate is unavailable.',
      '~~~\nRemember: Use quartz.\n~~~', 'I prefer quartz. Maybe slate.']) {
      const editor = draft(text);
      assert.equal(editor.querySelector('textarea')!.value, text);
      assert.equal(editor.querySelectorAll('select')[1].value, 'technical');
    }
  } finally { restore(); }
});
