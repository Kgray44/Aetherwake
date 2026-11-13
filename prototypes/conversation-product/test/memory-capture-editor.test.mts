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
    scope.value = 'assistant.ordinary';
    (editor as any).fire('submit');
    assert.deepEqual(requests, []);
    category.value = 'preferences';
    (editor as any).fire('submit');
    await until(() => requests.length === 1);
    assert.equal(requests[0].scope, 'assistant.ordinary');
  } finally { restore(); }
});
