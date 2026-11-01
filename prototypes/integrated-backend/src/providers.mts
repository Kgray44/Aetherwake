import { randomUUID } from 'node:crypto';
import { CodexAdapter, type EventEnvelope } from '../../codex-bridge/src/adapter.ts';
import type { Options, ProviderPort } from './contracts.mts';

/** Thin wrapper deliberately leaves native identity, base instructions, developer
 * instructions, model defaults and configuration loading to installed Codex. */
export function nativeProvider(options: Options): ProviderPort {
  const bridge = new CodexAdapter(options.codexExecutable, options.codexArgs);
  const mock = options.provider === 'bridge-fixture';
  const id = mock ? 'codex-app-server-fixture' : 'codex-app-server';
  let connected = false;
  return {
    id, mock,
    instanceId: options.instanceId ?? 'local-codex', accountScope: options.accountScope ?? 'local-configured-account',
    async connect() { if (!connected) { await bridge.connect(); connected = true; } },
    async capabilities() { const c = await bridge.capabilities(); return { providerId: id, mock, authentication: c.authentication, models: c.models.map(m => m.id), catalogOnly: true, nativeFork: false, chatgptHistory: false }; },
    open: () => bridge.newThread({ cwd: options.cwd ?? process.cwd(), sandbox: 'read-only', approvalPolicy: 'never', serviceName: 'aerynth_integration_prototype' }),
    resume: threadId => bridge.resumeThread({ threadId }),
    read: threadId => bridge.readThread(threadId),
    items: (threadId, turnId) => bridge.readItems(threadId, turnId),
    turn: (threadId, text, model) => bridge.beginTurn({ threadId, input: [{ type: 'text', text, text_elements: [] }], ...(model ? { model } : {}) }),
    terminal: (threadId, turnId) => bridge.waitForTerminal(threadId, turnId, 60000),
    interrupt: (threadId, turnId) => bridge.interrupt({ threadId, turnId }),
    onEvent(listener) { bridge.on('event', listener); return () => bridge.off('event', listener); },
    close() { bridge.close(); connected = false; }
  };
}

/** Routine CI uses precisely the same async port, with unambiguous simulated provenance. */
export function fixtureProvider(mode = 'normal'): ProviderPort {
  let seq = 0;
  const listeners = new Set<(e: EventEnvelope) => void>();
  const terminals = new Map<string, EventEnvelope>();
  let finish: (() => void) | undefined;
  const emit = (threadId: string, turnId: string, method: string, status: string | null = null, delta?: string) => {
    const e: EventEnvelope = { schemaVersion: 1, eventId: randomUUID(), sequence: ++seq, provider: 'codex-app-server', providerThreadId: threadId, providerTurnId: turnId, method, observedAt: new Date().toISOString(), observedAtSource: 'bridge-clock', providerTime: null, providerTimeSource: null, evidence: 'observed', terminalStatus: status, payload: delta ? { delta } : {} };
    for (const l of listeners) l(e);
    if (mode === 'duplicate') for (const l of listeners) l(e);
    if (status) terminals.set(turnId, e);
    return e;
  };
  return {
    id: 'fixture-codex', mock: true, instanceId: 'fixture', accountScope: 'synthetic',
    async connect() { if (mode === 'unavailable') throw new Error('provider_unavailable'); },
    async capabilities() { return { providerId: 'fixture-codex', mock: true, authentication: mode === 'no-auth' ? 'required' : 'available', models: ['fixture-model'], catalogOnly: true, nativeFork: false, chatgptHistory: false }; },
    async open() { return 'fixture-thread-' + randomUUID(); },
    async resume(t) { if (mode === 'missing-thread') throw new Error('missing_thread'); return t; },
    async read(t) { if (mode === 'missing-thread') throw new Error('missing_thread'); return { thread: { id: t, status: { type: 'idle' } } }; },
    async items() { return { data: [{ item: { type: 'userMessage' } }, { item: { type: 'agentMessage', text: 'INTEGRATION_OK' } }], nextCursor: null }; },
    async turn(t) {
      if (mode === 'unknown-outcome') throw new Error('timeout_unknown_outcome');
      if (mode === 'invalid-response') return '';
      const turn = 'fixture-turn-' + randomUUID();
      emit(t, turn, 'turn/started');
      if (mode === 'gap') seq += 2;
      emit(t, turn, 'item/agentMessage/delta', null, 'INTEGRATION_OK');
      finish = () => { emit(t, turn, 'turn/completed', mode === 'interrupted' || mode === 'wait-interrupt' ? 'interrupted' : 'completed'); };
      if (mode !== 'wait-interrupt') finish();
      return turn;
    },
    async terminal(t, turn) {
      if (mode === 'wait-interrupt' && !terminals.has(turn)) return new Promise(resolve => {
        const l = (e: EventEnvelope) => { if (e.providerTurnId === turn && e.terminalStatus) { listeners.delete(l); resolve(e); } }; listeners.add(l);
      });
      return terminals.get(turn)!;
    },
    async interrupt() { finish?.(); },
    onEvent(l) { listeners.add(l); return () => { listeners.delete(l); }; },
    close() { listeners.clear(); }
  };
}
