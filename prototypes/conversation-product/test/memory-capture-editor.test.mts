import assert from 'node:assert/strict';
import test from 'node:test';
import { componentDocument, named, until } from './component-dom.mts';
import { createMemoryCaptureEditor } from '../src/memory-capture-editor.ts';

test('the editor sends edited text and explicit scope only after review is requested', async () => {
  const f = componentDocument();
  const restore = f.install();
  const submissions: unknown[] = [];
  try {
    const editor = createMemoryCaptureEditor({
      content: 'Original user text', conversationId: 'chat', messageId: 'message', projectId: 'project',
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
      expectedProjectId: 'project', expectedSourceText: 'Original user text',
      scope: 'project', category: 'decisions', keywords: ['relay', 'circuit'] }]);
    assert(named(editor, 'Review memory'));
  } finally { restore(); }
});
