import assert from 'node:assert/strict';
import test from 'node:test';
import { componentDocument, named, until } from '../../../conversation-product/test/component-dom.mts';
import { createPersonalMemoryView } from '../src/personal-memory-view.ts';

test('the inspector turns off ChatGPT memory without removing saved records', async () => {
  const f = componentDocument(), restore = f.install(), calls = [];
  const policy = { version: 3, ordinaryEnabled: true, velaEnabled: false };
  const record = { id: 'fact-1', scope: { kind: 'project' }, state: 'active' };
  try {
    const view = createPersonalMemoryView(async request => {
      calls.push(request);
      if (request.type === 'list') return { records: [record], next: null, policy };
      return { ...policy, version: 4, ordinaryEnabled: false };
    });
    const disable = named(view, 'Turn off ChatGPT memory');
    assert.equal(disable.hidden, true);
    named(view, 'Load saved memories').fire('click');
    await until(() => !disable.hidden);
    disable.fire('click');
    await until(() => disable.hidden);
    assert.deepEqual(calls[1], { type: 'disableChatGPT', version: 3 });
    assert.match(view.textContent, /ChatGPT memory: Off/);
    assert.ok(named(view, 'Memory fact-1 · project · active'));
  } finally { restore(); }
});

test('the inspector loads only on request and sends a version-bound correction', async () => {
  const f = componentDocument(), restore = f.install(), calls = [];
  const record = { id: 'fact-1', version: 3, scope: { kind: 'project', id: 'project' }, state: 'active' };
  try {
    const view = createPersonalMemoryView(async request => {
      calls.push(request);
      if (request.type === 'list') return { records: [record], next: null, policy: { ordinaryEnabled: false, velaEnabled: false } };
      if (request.type === 'read') return { ...record, text: 'Synthetic decision', provenance: { kind: 'conversation-message', conversationId: 'chat', messageId: 'message' } };
      return { status: 'applied' };
    });
    f.root.append(view);
    assert.deepEqual(calls, []);
    named(view, 'Load saved memories').fire('click');
    await until(() => !!named(view, 'Memory fact-1 · project · active'));
    named(view, 'Memory fact-1 · project · active').fire('click');
    await until(() => !!view.querySelector('textarea'));
    assert.match(view.textContent, /Source message message · conversation chat/);
    view.querySelector('textarea').value = 'Corrected decision';
    named(view, 'Review correction').fire('click');
    await until(() => calls.length === 4);
    assert.deepEqual(calls[2], { type: 'manage', action: 'correct', id: 'fact-1', version: 3, text: 'Corrected decision' });
  } finally { restore(); }
});
