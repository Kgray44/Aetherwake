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
      if (request.type === 'read') return { ...record, text: 'Synthetic decision', keywords: ['decision'], provenance: { kind: 'conversation-message', conversationId: 'chat', messageId: 'message' } };
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
    view.querySelector('input').value = 'replacement, decision';
    named(view, 'Review correction').fire('click');
    await until(() => calls.length === 4);
    assert.deepEqual(calls[2], { type: 'manage', action: 'correct', id: 'fact-1', version: 3, text: 'Corrected decision', keywords: ['replacement', 'decision'] });
  } finally { restore(); }
});

test('the inspector sends only the selected fact revision and refreshes after confirmed source revocation', async () => {
  const f = componentDocument(), restore = f.install(), calls = [];
  const record = { id: 'fact-1', version: 3, scope: { kind: 'project' }, state: 'active' };
  const fact = { ...record, text: 'Synthetic decision', keywords: ['decision'], provenance: {
    kind: 'conversation-message', conversationId: 'chat', messageId: 'message',
  } };
  let outcome = 'cancelled';
  try {
    const view = createPersonalMemoryView(async request => {
      calls.push(request);
      if (request.type === 'list') return { records: outcome === 'applied' ? [] : [record], next: null, policy: { version: 1 } };
      if (request.type === 'read') return fact;
      return { status: outcome };
    });
    named(view, 'Load saved memories').fire('click');
    await until(() => !!named(view, 'Memory fact-1 · project · active'));
    named(view, 'Memory fact-1 · project · active').fire('click');
    await until(() => !!named(view, 'Revoke original message'));
    const revoke = named(view, 'Revoke original message');
    revoke.fire('click');
    await until(() => !revoke.disabled);
    const expected = { type: 'revokeSource', id: 'fact-1', version: 3 };
    assert.deepEqual(calls.slice(2), [expected]);
    assert.match(view.textContent, /Synthetic decision/);
    outcome = 'applied';
    revoke.fire('click');
    await until(() => view.textContent.includes('Original message revoked'));
    assert.deepEqual(calls.slice(3), [expected, { type: 'list', after: null }]);
    assert.equal(named(view, 'Revoke original message'), undefined);
    assert.doesNotMatch(view.textContent, /Synthetic decision/);
  } finally { restore(); }
});

test('opening a saved memory source rechecks the record and opens its exact message', async () => {
  const f = componentDocument(), restore = f.install();
  const opened = [];
  const record = { id: 'fact-1', version: 3, scope: { kind: 'project', id: 'project' }, state: 'active' };
  const fact = { ...record, text: 'Synthetic decision', keywords: ['decision'], provenance: { kind: 'conversation-message', conversationId: 'chat', messageId: 'message' } };
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
    assert.doesNotMatch(view.textContent, /Synthetic decision/);
    assert.equal(named(view, 'Open original message'), undefined);
    assert.equal(named(view, 'Export'), undefined);
    assert.ok(named(view, 'Delete'));
  } finally { restore(); }
});

test('superseded memory opens its replacement through a fresh authorized read', async () => {
  const f = componentDocument(), restore = f.install(), reads = [];
  const old = { id: 'old', version: 2, scope: { kind: 'project', id: 'project' }, state: 'superseded',
    text: 'Old preference', certainty: 'user-preference', provenance: { kind: 'user-statement' },
    supersededBy: 'new', keywords: ['preference'] };
  const replacement = { ...old, id: 'new', state: 'active', version: 1, text: 'Current preference', supersededBy: null };
  let canReadReplacement = false;
  try {
    const view = createPersonalMemoryView(async request => {
      if (request.type === 'list') return { records: [old], next: null, policy: { version: 1 } };
      reads.push(request.id);
      if (request.id === old.id) return old;
      if (!canReadReplacement) throw Error('Memory unavailable');
      return replacement;
    });
    named(view, 'Load saved memories').fire('click');
    await until(() => !!named(view, 'Memory old · project · superseded'));
    const original = named(view, 'Memory old · project · superseded');
    original.fire('click');
    await until(() => !!named(view, 'Open replacement memory'));
    assert.match(view.textContent, /Superseded · This project · User preference/);
    assert.match(view.textContent, /Excluded from future recall/);
    assert.equal(named(view, 'Review correction'), undefined);
    named(view, 'Open replacement memory').fire('click');
    await until(() => view.textContent.includes('Memory unavailable'));
    assert.doesNotMatch(view.textContent, /Current preference/);
    canReadReplacement = true;
    original.fire('click');
    await until(() => !!named(view, 'Open replacement memory'));
    named(view, 'Open replacement memory').fire('click');
    await until(() => view.textContent.includes('Current preference'));
    assert.match(view.textContent, /Eligible for recall/);
    assert.doesNotMatch(view.textContent, /Old preference/);
    assert.deepEqual(reads, ['old', 'new', 'old', 'new']);
  } finally { restore(); }
});

test('a listed memory whose source cannot be opened can still be deleted', async () => {
  const f = componentDocument(), restore = f.install(), changes = [];
  const record = { id: 'old', version: 2, scope: { kind: 'project', id: 'project' }, state: 'revoked' };
  try {
    const view = createPersonalMemoryView(async request => {
      if (request.type === 'list') return { records: [record], next: null, policy: { version: 1 } };
      if (request.type === 'read') throw Error('Memory unavailable');
      changes.push(request);
      return { status: 'applied' };
    });
    named(view, 'Load saved memories').fire('click');
    await until(() => !!named(view, 'Memory old · project · revoked'));
    named(view, 'Memory old · project · revoked').fire('click');
    await until(() => !!named(view, 'Delete'));
    assert.equal(named(view, 'Export'), undefined);
    named(view, 'Delete').fire('click');
    await until(() => changes.length === 1);
    assert.deepEqual(changes, [{ type: 'manage', action: 'delete', id: 'old', version: 2 }]);
  } finally { restore(); }
});
