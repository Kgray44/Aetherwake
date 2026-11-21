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


test('drafted search terms keep the distinctive term after a long conversational lead-in', () => {
  const f = componentDocument(), restore = f.install();
  try {
    const editor = createMemoryCaptureEditor({
      content: 'Remember: After all that we have said about what we should use, the quartz relay is the decision.',
      conversationId: 'chat', messageId: 'message', projectId: 'project',
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
      content, conversationId: 'chat', messageId: 'decision-source', projectId: 'project',
      async review(request) { submitted.push(request); return false; }, report() {},
    });
    const content = 'Earlier options are still in the transcript.\nRemember decision: Use quartz for the relay.';
    const editor = draft(content);
    assert.equal(editor.querySelector('textarea')!.value, 'Use quartz for the relay.');
    assert.equal(editor.querySelectorAll('select')[0].value, 'conversation');
    assert.equal(editor.querySelectorAll('select')[1].value, 'decisions');
    assert.equal(submitted.length, 0);
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


test('selective drafting retains source snapshot and conversation-only default without a project', async () => {
 const f=componentDocument(),restore=f.install(); const submitted:MemoryCaptureRequest[]=[];
 try {
  const content='Context line\nRemember decision: Use quartz for the relay.';
  const editor=createMemoryCaptureEditor({content,conversationId:'chat',messageId:'msg',projectId:null,async review(r){submitted.push(r);return false;},report(){}});
  assert.equal(editor.querySelectorAll('select')[0].children.length,1);
  (editor as any).fire('submit');await until(()=>submitted.length===1);
  assert.equal(submitted[0].scope,'conversation');assert.equal(submitted[0].expectedProjectId,null);
  assert.equal(submitted[0].expectedSourceText,content);
  assert.equal(submitted[0].text,'Use quartz for the relay.');
 } finally {restore();}
});
