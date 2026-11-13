import assert from 'node:assert/strict';
import test from 'node:test';
import { componentDocument, named, until } from '../../../conversation-product/test/component-dom.mts';
import { createPersonalMemoryView } from '../src/personal-memory-view.ts';

test('the inspector turns off Vela memory without changing ChatGPT consent or removing saved records', async () => {
  const f = componentDocument(), restore = f.install(), calls = [];
  const policy = { version: 3, ordinaryEnabled: true, velaEnabled: true };
  const record = { id: 'fact-1', scope: { kind: 'project' }, state: 'active' };
  try {
    const view = createPersonalMemoryView(async request => {
      calls.push(request);
      if (request.type === 'list') return { records: [record], next: null, policy };
      return { ...policy, version: 4, velaEnabled: false };
    });
    const disable = named(view, 'Turn off Vela memory');
    assert.equal(disable.hidden, true);
    named(view, 'Load saved memories').fire('click');
    await until(() => !disable.hidden);
    disable.fire('click');
    await until(() => disable.hidden);
    assert.deepEqual(calls[1], { type: 'disableProviderMemory', assistant: 'vela', version: 3 });
    assert.match(view.textContent, /ChatGPT memory: Enabled for reviewed sends.*Vela memory: Off/);
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

test('opening a saved memory source rechecks the record and opens its exact message', async () => {
  const f = componentDocument(), restore = f.install();
  const opened = [];
  const record = { id: 'fact-1', version: 3, scope: { kind: 'project', id: 'project' }, state: 'active' };
  const fact = { ...record, text: 'Synthetic decision', provenance: { kind: 'conversation-message', conversationId: 'chat', messageId: 'message' } };
  let current = fact;
  try {
    const view = createPersonalMemoryView(async request => {
      if (request.type === 'list') return { records: [record], next: null, policy: { version: 1 } };
      if (!current) throw Error('conversation_source_unavailable');
      return current;
    }, async source => { opened.push(source); });
    named(view, 'Load saved memories').fire('click');
    await until(() => !!named(view, 'Memory fact-1 · project · active'));
    named(view, 'Memory fact-1 · project · active').fire('click');
    await until(() => !!named(view, 'Open original message'));
    const button = named(view, 'Open original message');
    current = { ...fact, version: 4 };
    button.fire('click');
    await until(() => !button.disabled);
    assert.deepEqual(opened, []);
    assert.match(view.textContent, /Memory has changed/);
    current = fact;
    button.fire('click');
    await until(() => !button.disabled);
    assert.deepEqual(opened, [{ conversationId: 'chat', messageId: 'message' }]);
    current = null;
    button.fire('click');
    await until(() => !button.disabled);
    assert.equal(opened.length, 1);
  } finally { restore(); }
});
