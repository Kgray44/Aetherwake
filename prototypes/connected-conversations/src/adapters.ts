import type { Conversation, ProviderAdapter, ProviderSnapshot, SessionRequest } from './graph.ts';

function capability(supported: boolean) {
  return { supported, authorized: supported, availability: supported ? 'available' as const : 'unsupported' as const };
}
/** Durable ordinary conversation recording. It has no model or generated reply. */
export function localConversationAdapter(): ProviderAdapter {
  return {
    snapshot: {
      id: 'local', label: 'Local conversation · no model response', version: '1',
      mock: false, availability: 'available', chat: capability(true), nativeFork: capability(false),
      models: [], usage: 'unknown', observedAt: new Date().toISOString(),
    },
    open() { return { providerSessionId: null }; },
  };
}
export function mockOrdinaryAdapter(): ProviderAdapter {
  const snapshot: ProviderSnapshot = {
    id: 'mock-ordinary', label: 'Deterministic ordinary chat (MOCK)', version: '1',
    mock: true, availability: 'available', chat: capability(true), nativeFork: capability(false),
    models: [{ id: 'mock-conversation-v1', availability: 'available', usage: 'unknown' }],
    usage: 'unknown', observedAt: '2026-01-01T00:00:00.000Z'
  };
  return {
    snapshot,
    open(request: SessionRequest) { return { providerSessionId: 'ordinary-session:' + request.conversationId }; },
    respond(_conversation: Conversation, prompt: string) {
      return '[MOCK ordinary response] Discussion recorded: ' + prompt;
    }
  };
}
export function mockCodexAdapter(): ProviderAdapter {
  const snapshot: ProviderSnapshot = {
    id: 'mock-codex', label: 'Deterministic Codex execution (MOCK)', version: '1',
    mock: true, availability: 'available', chat: capability(true), nativeFork: capability(true),
    models: [{ id: 'mock-codex-v1', availability: 'available', usage: 'unknown' }],
    usage: 'unknown', observedAt: '2026-01-01T00:00:00.000Z'
  };
  return {
    snapshot,
    open(request: SessionRequest) { return { providerSessionId: 'codex-session:' + request.conversationId }; },
    fork(request: SessionRequest) { return { providerSessionId: 'codex-native-fork:' + request.conversationId }; },
    respond(_conversation: Conversation, prompt: string) {
      return '[MOCK Codex artifact] Deterministic build plan for: ' + prompt;
    }
  };
}
export const mockAdapters = () => [mockOrdinaryAdapter(), mockCodexAdapter()];
