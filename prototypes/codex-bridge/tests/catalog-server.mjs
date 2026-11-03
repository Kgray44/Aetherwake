/** Explicit synthetic stdio protocol double. Never authenticates or contacts a provider. */
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
const fixtureSession = randomUUID();
const mode = process.argv[2] ?? 'normal',
  send = (message) => process.stdout.write(JSON.stringify(message) + '\n');
let experimental = false,
  interruptPending = false,
  threadCounter = 0,
  currentThread = null,
  currentTurn = null,
  turnRequest = null,
  task = null,
  calls = 0;
const pending = new Map();
const session = (id) => ({
  thread: { id, ephemeral: false },
  cwd: 'C:\\synthetic',
  model: 'fixture-model',
  modelProvider: 'openai',
  approvalPolicy: 'never',
  instructionSources: ['C:\\synthetic\\AGENTS.md'],
});
const readAction = mode === 'search' ? { type: 'search', query: 'calibration' }
  : mode === 'open' ? { type: 'openResource', query: 'Synthetic note 1' }
  : mode === 'clock' ? { type: 'readLocalFact', capabilityId: 'local.time' } : null;
const selectedAction = () => {
  if (mode === 'navigate') return { type: 'navigate', target: { kind: 'constellation', projectId: null } };
  if (mode === 'selected-note') {
    const resourceId = task.context?.activeResourceId;
    if (!resourceId || !task.context.discovered.some(ref => ref.kind === 'resource' && ref.id === resourceId) ||
        task.context.included.some(ref => ref.id === resourceId))
      throw Error('The synthetic turn requires the selected note metadata without its body');
    return { type: 'renameResource', resourceId, title: 'Synthetic renamed card' };
  }
  if (mode !== 'layout') return readAction;
  const workspaceId = task.context?.activeSurface?.workspaceId;
  if (!workspaceId || !task.context.discovered.some(ref => ref.kind === 'workspace' && ref.id === workspaceId))
    throw new Error('The synthetic protocol turn requires an authorized active workspace in its reviewed prompt');
  return { type: 'applyStructuredPreset', workspaceId, preset: 'balanced' };
};
const complete = (status = 'completed', items = []) => send({ method: 'turn/completed', params: { threadId: currentThread, turn: { id: currentTurn, status, items } } });
const delta = (text, itemId, turnId = currentTurn, threadId = currentThread) =>
  send({ method: 'item/agentMessage/delta', params: { threadId, turnId, itemId, delta: text } });
const completedItem = (item) => send({ method: 'item/completed', params: { threadId: currentThread, turnId: currentTurn, item } });
const finish = () => {
  const response = ['answer', 'answer-catalog'].includes(mode)
    ? { schemaVersion: 2, kind: 'answer', content: 'Synthetic observed protocol answer.' }
    : {
        schemaVersion: 2,
        kind: 'plan',
        summary: mode === 'layout' ? 'Synthetic arrangement proposal.' : mode === 'navigate' ? 'Synthetic navigation proposal.' : mode === 'selected-note' ? 'Synthetic selected note proposal.' : readAction ? 'Synthetic local lookup.' : 'Synthetic folder proposal.',
        steps: [
          {
            id: 'create',
            explanation: 'Explicit protocol regression, not live model qualification.',
            action: selectedAction() ?? { type: 'createCollection', title: 'Synthetic proposed folder', projectId: null },
          },
        ],
      };
  if (mode === 'layout') {
    delta('Post-bind foreign turn text.', 'foreign-item', 'foreign:turn');
    delta('Foreign thread text.', 'foreign-item', currentTurn, 'foreign:thread');
    completedItem({ type: 'agentMessage', id: 'commentary', phase: 'commentary', text: 'Checking the workspace.' });
    const item = { type: 'agentMessage', id: 'final', phase: 'final_answer', text: JSON.stringify(response) };
    // Exercise independent final delivery paths. Repeated completion of
    // the same item must still persist exactly one final response.
    if (experimental) {
      completedItem(item);
      completedItem(item);
      complete();
    } else {
      complete('completed', [item]);
    }
    return;
  }
  delta(JSON.stringify(response), 'response');
  complete();
};
const requestTool = (patch = {}) => {
  calls++;
  const requestId = 900 + calls;
  const params = {
    threadId: currentThread,
    turnId: currentTurn,
    callId: 'catalog-call:1',
    namespace: null,
    tool: 'aerynth_capability_schemas',
    arguments: { catalogDigest: task.capabilityCatalog?.digest ?? '0'.repeat(64), ids: [selectedAction()?.type ?? 'createCollection'] },
    ...patch,
  };
  pending.set(requestId, params);
  send({ id: requestId, method: 'item/tool/call', params });
};
createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (pending.has(message.id) && !message.method) {
    const call = pending.get(message.id);
    pending.delete(message.id);
    send({
      method: 'fixture/catalogResult',
      params: {
        threadId: currentThread,
        turnId: currentTurn,
        success: message.result?.success === true,
        callId: call.callId,
        errorCode: message.result?.success ? null : (message.result?.contentItems?.[0]?.text ?? message.error?.message ?? null),
      },
    });
    if (mode === 'duplicate' && calls === 1) {
      requestTool();
      return;
    }
    if (mode === 'duplicate' && calls === 2) {
      requestTool({ arguments: { catalogDigest: task.capabilityCatalog.digest, ids: ['createWorkspace'] } });
      return;
    }
    if (mode === 'cancel') {
      if (interruptPending) complete('interrupted');
      return;
    }
    if (mode === 'transport-loss') {
      process.exit(17);
      return;
    }
    finish();
    return;
  }
  const reply = (result) => send({ id: message.id, result });
  if (message.method === 'initialize') {
    experimental = message.params.capabilities?.experimentalApi === true;
    reply({ platformFamily: 'synthetic', receivedExperimental: experimental });
    return;
  }
  if (message.method === 'initialized') return;
  if (message.method === 'account/read') {
    reply({ account: { type: 'chatgpt' }, requiresOpenaiAuth: true });
    return;
  }
  if (message.method === 'model/list') {
    reply({ data: [{ id: 'fixture-model', displayName: 'Synthetic protocol model' }], nextCursor: null });
    return;
  }
  if (message.method === 'thread/start') {
    if (message.params.dynamicTools && (!experimental || mode === 'unsupported')) {
      send({ id: message.id, error: { code: -32602, message: 'dynamicTools unsupported by synthetic protocol mode' } });
      return;
    }
    currentThread = 'fixture-catalog-thread:' + fixtureSession + ':' + ++threadCounter;
    send({ method: 'fixture/threadStart', params: { threadId: currentThread, params: message.params, experimental } });
    reply(session(currentThread));
    return;
  }
  if (message.method === 'thread/resume') {
    reply(session(message.params.threadId));
    return;
  }
  if (message.method === 'thread/read') {
    reply({ thread: { id: message.params.threadId, turns: [] } });
    return;
  }
  if (message.method === 'turn/start') {
    currentThread = message.params.threadId;
    currentTurn = 'fixture-catalog-turn:' + fixtureSession + ':' + threadCounter;
    turnRequest = message.id;
    try {
      task = JSON.parse(message.params.input[0].text.split('\n').at(-1));
    } catch {
      task = {};
    }
    if (mode === 'early-call') requestTool();
    if (mode === 'layout') {
      delta('Pre-bind foreign turn text.', 'foreign-item', 'foreign:turn');
      delta('Checking the workspace.', 'commentary');
    }
    reply({ turn: { id: currentTurn } });
    send({ method: 'turn/started', params: { threadId: currentThread, turn: { id: currentTurn, status: 'inProgress' } } });
    send({ method: 'fixture/catalogReady', params: { threadId: currentThread, turnId: currentTurn } });
    if (mode === 'early-call') return;
    if (!task.capabilityDiscovery || mode === 'no-fetch' || mode === 'answer') {
      if (mode === 'layout') setTimeout(finish, 30);
      else finish();
      return;
    }
    if (mode === 'wrong-turn') requestTool({ turnId: 'foreign:turn' });
    else if (mode === 'unknown-id') requestTool({ arguments: { catalogDigest: task.capabilityCatalog.digest, ids: ['unsupported:action'] } });
    else if (mode === 'wrong-digest') requestTool({ arguments: { catalogDigest: '0'.repeat(64), ids: ['createCollection'] } });
    else if (mode === 'content-tool') requestTool({ tool: 'content', arguments: { resourceId: 'private:resource' } });
    else requestTool();
    return;
  }
  if (message.method === 'turn/interrupt') {
    reply({});
    if (mode === 'cancel') {
      interruptPending = true;
      requestTool({ callId: 'catalog-after-cancel' });
      return;
    }
    complete('interrupted');
    return;
  }
  send({ id: message.id, error: { code: -32601, message: 'Unsupported synthetic method' } });
});
