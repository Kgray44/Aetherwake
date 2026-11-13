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
      content: 'Original user text', conversationId: 'chat', messageId: 'message', projectAvailable: true, expectedProjectId: 'project',
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
      scope: 'project', expectedProjectId: 'project', category: 'decisions', keywords: ['relay', 'circuit'] }]);
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
    assert.ok(Array.from(scope.options).some(option => option.value === 'assistant.vela'));
    const projectEditor = createMemoryCaptureEditor({ ...options, projectAvailable: true });
    assert.ok(!Array.from(projectEditor.querySelector('select')!.options).some(option => option.value.startsWith('assistant.')));
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

test('drafted search terms keep the distinctive term after a long conversational lead-in', () => {
  const f = componentDocument(), restore = f.install();
  try {
    const editor = createMemoryCaptureEditor({
      content: 'Remember: After all that we have said about what we should use, the quartz relay is the decision.',
      conversationId: 'chat', messageId: 'message', projectAvailable: true,
      async review() { throw Error('unexpected review'); }, report() {},
    });
    const terms = editor.querySelector('input')!.value.split(', ');
    assert.ok(terms.includes('quartz'));
    assert.ok(terms.includes('relay'));
    assert.ok(!terms.includes('should'));
  } finally { restore(); }
});

test('an explicitly marked decision drafts a verbatim candidate without expanding its scope', async () => {
  const f = componentDocument(), restore = f.install();
  const submitted: MemoryCaptureRequest[] = [];
  try {
    const draft = (content: string) => createMemoryCaptureEditor({
      content, conversationId: 'chat', messageId: 'decision-source', projectAvailable: true, expectedProjectId: 'project',
      async review(request) { submitted.push(request); return false; }, report() {},
    });
    const content = 'Earlier options are still in the transcript.\nRemember decision: Use quartz for the relay.';
    const editor = draft(content);
    assert.equal(editor.querySelector('textarea')!.value, 'Use quartz for the relay.');
    assert.equal(editor.querySelectorAll('select')[0].value, 'conversation');
    assert.equal(editor.querySelectorAll('select')[1].value, 'decisions');
    assert.deepEqual(submitted, []);
    (editor as any).fire('submit');
    await until(() => submitted.length === 1);
    assert.equal(submitted[0].messageId, 'decision-source');
    assert.equal(submitted[0].category, 'decisions');
    assert.equal(submitted[0].scope, 'conversation');
    for (const ambiguous of [
      '> Remember decision: Use quartz.', 'Remember decision: Maybe use quartz.',
      'Remember decision: Use quartz.\nRemember: Keep slate.',
      '~~~\nRemember decision: Use quartz.\n~~~',
    ]) {
      const manual = draft(ambiguous);
      assert.equal(manual.querySelector('textarea')!.value, ambiguous);
      assert.equal(manual.querySelectorAll('select')[1].value, 'technical');
    }
  } finally { restore(); }
});
