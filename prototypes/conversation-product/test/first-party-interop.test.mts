import assert from 'node:assert/strict';
import test from 'node:test';
import { createFirstPartyChatInterop, prepareLocalCodexChatOpen, type FirstPartyChatNavigationHost } from '../src/first-party-interop.ts';

const subject = { kind: 'resource' as const, resourceId: 'canonical-chat-a' };
const binding = { providerId: 'codex-app-server', nativeThreadId: '019ca111-2222-7333-8444-555555555555', installation: 'same-local' as const };

test('official existing local chat route preserves separate canonical and native identities', () => {
  const result = prepareLocalCodexChatOpen(subject, binding);
  assert.equal(result.status, 'supported');
  if (result.status !== 'supported') return;
  assert.deepEqual(result.target, { kind: 'open-local-codex-chat', subject, nativeThreadId: binding.nativeThreadId, url: `codex://threads/${binding.nativeThreadId}` });
  assert.ok(Object.isFrozen(result.target));
  assert.ok(Object.isFrozen(result.target.subject));
  subject.resourceId = 'canonical-chat-b';
  assert.equal(result.target.subject.resourceId, 'canonical-chat-a');
  subject.resourceId = 'canonical-chat-a';
});

test('only canonical resource references, not cloud URLs or projects, can prepare a route', () => {
  for (const value of [null, 'https://chatgpt.com/c/cloud-id', { kind: 'project', projectId: 'p' }, { ...subject, url: 'codex://threads/new' }, { kind: 'resource', resourceId: '' }]) {
    assert.deepEqual(prepareLocalCodexChatOpen(value, binding), { status: 'unavailable', reason: 'invalid_subject' });
  }
});

test('local recording, legacy aliases and other providers never become native Codex', () => {
  for (const providerId of ['local', 'mock-ordinary', 'chatgpt', 'responses', 'codex', '']) {
    assert.deepEqual(prepareLocalCodexChatOpen(subject, { ...binding, providerId }), { status: 'unavailable', reason: 'unsupported_provider' });
  }
});

test('remote or unverified installation cannot promise an existing first-party chat', () => {
  for (const installation of ['different', 'unverified'] as const) {
    assert.deepEqual(prepareLocalCodexChatOpen(subject, { ...binding, installation }), { status: 'unavailable', reason: 'installation_unverified' });
  }
});

test('thread path cannot inject new-chat, query, fragment, scheme or nested route', () => {
  for (const nativeThreadId of ['', 'new', 'NEW', '../new', 'a/b', 'a?prompt=send', 'a#fragment', '%6eew', 'https://example.test', 'a\n', 'a'.repeat(201)]) {
    assert.deepEqual(prepareLocalCodexChatOpen(subject, { ...binding, nativeThreadId }), { status: 'unavailable', reason: 'invalid_thread_id' });
  }
});

test('no discovery/open occurs on construction or invalid input; unavailable bindings do not launch', async () => {
  let resolves = 0; let opens = 0;
  const interop = createFirstPartyChatInterop({ resolveLocalCodexThread: async () => { resolves++; return null; }, requestOpen: async () => { opens++; return { status: 'requested' }; } });
  assert.equal(resolves, 0); assert.equal(opens, 0);
  assert.deepEqual(await interop.open({ kind: 'resource', resourceId: '' }), { status: 'unavailable', reason: 'invalid_subject' });
  assert.equal(resolves, 0);
  assert.deepEqual(await interop.open(subject), { status: 'unavailable', reason: 'unavailable' });
  assert.equal(resolves, 1); assert.equal(opens, 0);
});

test('one explicit Open requests only the resolved canonical local target; no inference or replay', async () => {
  const resolved: unknown[] = []; const opened: unknown[] = [];
  const host: FirstPartyChatNavigationHost = { resolveLocalCodexThread: async ref => { resolved.push(ref); return binding; }, requestOpen: async target => { opened.push(target); return { status: 'requested' }; } };
  const result = await createFirstPartyChatInterop(host).open(subject);
  assert.deepEqual(result, { status: 'requested' });
  assert.deepEqual(resolved, [subject]); assert.equal(opened.length, 1);
  assert.equal(Object.keys(result).length, 1, 'OS acknowledgement adds no opened/continued/synced claim');
});

test('dispatch host can deny a revoked binding after resolution; unknown remains unknown without retry', async () => {
  for (const receipt of [{ status: 'unavailable', reason: 'unavailable' }, { status: 'unknown' }] as const) {
    let opens = 0;
    const interop = createFirstPartyChatInterop({ resolveLocalCodexThread: async () => binding, requestOpen: async () => { opens++; return receipt; } });
    assert.deepEqual(await interop.open(subject), receipt);
    assert.equal(opens, 1);
  }
});

test('unexpected host failure propagates and is never silently retried or converted to success', async () => {
  let opens = 0;
  const interop = createFirstPartyChatInterop({ resolveLocalCodexThread: async () => binding, requestOpen: async () => { opens++; throw new Error('host-disconnected'); } });
  await assert.rejects(interop.open(subject), /host-disconnected/);
  assert.equal(opens, 1);
});
