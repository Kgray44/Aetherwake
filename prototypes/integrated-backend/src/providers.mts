import { randomUUID } from 'node:crypto';
import { CodexAdapter, type EventEnvelope } from '../../codex-bridge/src/adapter.ts';
import { BridgeError } from '../../codex-bridge/src/transport.ts';
import type { Options, ProviderPort } from './contracts.mts';
import { capabilitySchemaTool, capabilityToolFailure } from '../../vela-core/src/capability-catalog.mts';
import type { CapabilityNativeCall, CapabilityToolReply } from '../../vela-core/src/capability-catalog.mts';
import { windowsCodexLaunch } from './codex-launch.mts';

/** Thin wrapper deliberately leaves native identity, base instructions, developer
 * instructions, model defaults and configuration loading to installed Codex. */
export function nativeProvider(options: Options): ProviderPort {
  const windowsDefault = process.platform === 'win32' && !options.codexExecutable;
  const args = options.codexArgs ?? ['app-server', '--listen', 'stdio://'];
  const launch = windowsDefault ? windowsCodexLaunch(
    Object.entries(process.env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? '', process.execPath, args,
  ) : undefined;
  const bridge = new CodexAdapter(launch?.executable ?? options.codexExecutable, launch?.args ?? args,{experimentalApi:options.velaCatalogDiscovery===true});
  const mock = options.provider === 'bridge-fixture';
  const id = mock ? 'codex-app-server-fixture' : 'codex-app-server';
  let connection: Promise<void> | undefined;
  let catalogAvailable=options.velaCatalogDiscovery===true;
  const catalogHandlers=new Map<string,(call:CapabilityNativeCall)=>Promise<CapabilityToolReply>>();
  // Losing the child invalidates the session, not the installed account.
  // A later caller may reconnect without replaying any provider operation.
  bridge.on('failure', () => {
    connection = undefined;
    catalogHandlers.clear();
  });
  if(options.velaCatalogDiscovery===true)bridge.setDynamicToolHandler(async call=>catalogHandlers.get(call.threadId)?.(call)??capabilityToolFailure('capability_discovery_not_authorized'));
  return {
    id, mock,
    instanceId: options.instanceId ?? 'local-codex', accountScope: options.accountScope ?? 'local-configured-account',
    async connect() {
      if (windowsDefault && !launch) throw new BridgeError('missing-executable','Codex CLI is not on the installed PATH');
      if (connection) return connection;
      const attempt = bridge.connect().then(() => {});
      connection = attempt;
      try { await attempt; }
      catch (error) {
        if (connection === attempt) connection = undefined;
        throw error;
      }
    },
    async capabilities() {
      const c = await bridge.capabilities();
      const models = c.models.filter(model => !model.hidden), preferred = models.find(model => model.isDefault);
      return { providerId: id, mock, authentication: c.authentication, models: c.models.map(m => m.id),
        selectableModels: models.map(model => model.id),
        ...(preferred ? { defaultModel: preferred.id } : {}),
        modelEfforts: Object.fromEntries(models.filter(model => model.efforts?.length).map(model => [model.id, model.efforts!])),
        defaultModelEfforts: Object.fromEntries(models.flatMap(model => model.defaultEffort ? [[model.id, model.defaultEffort]] : [])),
        catalogOnly: true, nativeFork: false, chatgptHistory: false };
    },
    open: target => bridge.newThread({ cwd: target?.cwd ?? options.cwd ?? process.cwd(), ...(target?.model ? { model: target.model } : {}),
      sandbox: 'read-only', approvalPolicy: 'never', serviceName: 'aerynth_integration_prototype' }),
    resume: threadId => bridge.resumeThread({ threadId }),
    read: threadId => bridge.readThread(threadId),
    recentTurns: async threadId => (await bridge.listTurns({ threadId, limit: 20, itemsView: 'notLoaded' })).data,
    items: async (threadId, turnId) => { const page = await bridge.readItems(threadId, turnId); return { data: page.data, nextCursor: page.nextCursor, backwardsCursor: page.backwardsCursor }; },
    turn: (threadId, text, model, inspection) => bridge.beginTurn({
      threadId, input: [{ type: 'text', text, text_elements: [] }], ...(model ? { model } : {}),
      ...(inspection ? { approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly', networkAccess: false },
        ...(inspection.effort ? { effort: inspection.effort } : {}) } : {}),
    }),
    terminal: (threadId, turnId) => bridge.waitForTerminal(threadId, turnId, 60000),
    interrupt: (threadId, turnId) => bridge.interrupt({ threadId, turnId }),
    ...(!mock && process.platform === 'win32' ? { projectChecks: {
      ready: () => bridge.windowsSandboxReady(),
      execute: (command: string[], cwd: string) => bridge.execReadOnly({ command, cwd, timeoutMs: 20000, env: {
        NODE_OPTIONS: null, NODE_PATH: null, NODE_V8_COVERAGE: null, NODE_COMPILE_CACHE: null,
        NODE_TEST_CONTEXT: null, NODE_DISABLE_COMPILE_CACHE: '1', FORCE_COLOR: '0',
      } }),
    } } : {}),
    onEvent(listener) { bridge.on('event', listener); return () => bridge.off('event', listener); },
    ...(options.velaCatalogDiscovery===true?{catalogDiscovery:{
      get available(){return catalogAvailable;},
      async open(projection,onCall){
        if(!catalogAvailable)throw new BridgeError('catalog-discovery-unavailable','Catalog discovery is unavailable');if(catalogHandlers.size)throw new Error('catalog_discovery_busy');
        let threadId:string;try{threadId=await bridge.startDynamicToolThread({cwd:options.cwd??process.cwd(),sandbox:'read-only',approvalPolicy:'never',serviceName:'aerynth_integration_prototype'},capabilitySchemaTool(projection));}
        catch(error){if(error instanceof BridgeError&&(error.kind==='unsupported'||error.code===-32602&&/dynamictools|experimentalapi/i.test(error.message))){catalogAvailable=false;throw new BridgeError('catalog-discovery-unavailable','Installed provider rejected catalog discovery');}throw error;}
        catalogHandlers.set(threadId,onCall);return threadId;
      },release(threadId){catalogHandlers.delete(threadId);}
    } satisfies NonNullable<ProviderPort['catalogDiscovery']>} :{}),
    close() { catalogHandlers.clear();bridge.close(); connection = undefined; }
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
