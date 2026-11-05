import assert from 'node:assert/strict';
import { Backend } from './service.mts';
import type { Options } from './contracts.mts';

/** All content is synthetic; returns only safe aggregate receipts. */
export async function journey(options: Options) {
  let backend = new Backend(options);
  let eventCount = 0;
  let unsubscribe = backend.subscribe(() => eventCount++);
  const start = performance.now();
  try {
    const cap = await backend.call('capabilities', {});
    const a = await backend.call('createConversation', { title: 'Synthetic idea A', commandId: 'create-a' });
    assert.equal(a.taskId, null); assert.equal(a.projectId, null);
    const m = await backend.call('addMessage', { resourceId: a.resourceId, role: 'user', content: 'Synthetic integration fixture: the marker is INTEGRATION_OK.', expectedRevision: 1, sensitivity: 'public' });
    const workspace = await backend.call('workspace', { title: 'Synthetic workspace', projectTitle: 'Synthetic project' });
    const block = await backend.call('place', { workspaceId: workspace.id, resourceId: a.resourceId });
    const block2 = await backend.call('place', { workspaceId: workspace.id, resourceId: a.resourceId });
    assert.notEqual(block.id, a.resourceId); assert.notEqual(block.id, block2.id);
    const b = await backend.call('branch', { resourceId: a.resourceId, messageId: m.id, includeMessageIds: [m.id], providerId: cap.providerId, title: 'Synthetic execution B', commandId: 'branch-b', tokenBudget: 8192 });
    assert.equal(b.mode, 'application_continuation');
    await backend.call('review', { handoffId: b.handoff.id, fingerprint: b.handoff.fingerprint, approve: true });
    const execution = await backend.call('execute', { resourceId: b.conversation.resourceId, handoffId: b.handoff.id, prompt: 'Reply with exactly INTEGRATION_OK. Do not use tools or inspect files.', commandId: 'execute-b', authorized: true });
    assert.equal(execution.state, 'provider_completed', execution.errorCode); assert.equal(execution.taskVerified, false);
    const state = await backend.call('snapshot', {});
    const result = state.graph.messages.find((m: any) => m.conversationId === state.resourceMap[b.conversation.resourceId] && m.role === 'assistant');
    assert.equal(result?.content.trim(), 'INTEGRATION_OK');
    const c = await backend.call('branch', { resourceId: b.conversation.resourceId, messageId: result.id, includeMessageIds: [result.id], providerId: 'mock-ordinary', title: 'Synthetic follow-up C', commandId: 'branch-c', tokenBudget: 8192 });
    await backend.call('review', { handoffId: c.handoff.id, fingerprint: c.handoff.fingerprint, approve: true });
    const followup = await backend.call('applyOrdinary', { handoffId: c.handoff.id, prompt: 'Discuss the synthetic result.', commandId: 'apply-c' });
    assert.equal(followup.classification, 'simulated');
    const history = await backend.call('replay', { limit: 1000 });
    assert.ok(history.events.some(e => e.type === 'turn/completed'));
    const before = await backend.call('snapshot', {});
    const layoutBefore = await backend.call('openWorkspace', { workspaceId: workspace.id });
    unsubscribe(); await backend.close();
    backend = new Backend(options); unsubscribe = () => {};
    const after = await backend.call('snapshot', {});
    assert.deepEqual(after.conversations, before.conversations);
    assert.deepEqual(after.graph, JSON.parse(JSON.stringify(before.graph)));
    assert.deepEqual(after.bindings, before.bindings);
    assert.deepEqual(after.handoffs, before.handoffs);
    assert.deepEqual(after.relationships, before.relationships);
    assert.deepEqual(after.messageEvidence, before.messageEvidence);
    assert.deepEqual(await backend.call('openWorkspace', { workspaceId: workspace.id }), layoutBefore);
    const replay = await backend.call('replay', { limit: 1000 });
    assert.deepEqual(replay.events.filter(e => e.cursor <= history.latest), history.events);
    const reconcile = await backend.call('reconcile', { resourceId: b.conversation.resourceId });
    assert.equal(reconcile.providerThreadAvailable, true);
    assert.equal(reconcile.syntheticTurnReceipt?.completePage, true);
    assert.equal(reconcile.syntheticTurnReceipt?.exactMarker, true);
    assert.ok(reconcile.syntheticTurnReceipt?.itemTypes.every(type => ['userMessage','agentMessage'].includes(type)));
    const capabilities = await backend.call('capabilities', {});
    assert.equal(capabilities.chatgptHistory, false); assert.equal(capabilities.nativeFork, false);
    return { contract: 'aerynth.integration@0.1', syntheticContent: true, provider: cap.providerId, simulatedProvider: cap.mock, providerCompleted: true, taskVerified: false, conversations: after.conversations.length, lineageEdges: after.graph.edges.length, recoveredMessages: after.graph.messages.length, journalEvents: history.events.length, streamedEvents: eventCount, restartIdentityPreserved: true, nativeThreadReconciled: true, persistedTurnItemTypes: reconcile.syntheticTurnReceipt!.itemTypes, exactMarker: true, elapsedMs: Math.round(performance.now() - start) };
  } finally { unsubscribe(); await backend.close(); }
}
