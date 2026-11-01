import type { StreamEvent, Execution, Capability } from '../src/contracts.mts';
const resourceId = '00000000-0000-4000-8000-000000000001';
const executionId = '00000000-0000-4000-8000-000000000002';
const event = (cursor: number, type: string, classification: StreamEvent['classification'], status: string | null): StreamEvent => ({
  schemaVersion: 1, eventId: `synthetic-event-${cursor}`, cursor, resourceId, executionId,
  providerId: 'fixture-codex', providerInstanceId: 'fixture', connectionId: 'synthetic-connection',
  nativeEventId: null, nativeSequence: cursor, threadId: 'synthetic-thread', turnId: 'synthetic-turn',
  correlationId: 'synthetic-command', causationId: executionId,
  receivedAt: `2026-01-01T00:00:0${cursor}.000Z`, providerTime: null, providerTimeSource: null,
  type, classification, status, payload: { redacted: true }
});
const execution: Execution = { id: executionId, resourceId, providerId: 'fixture-codex',
  state: 'provider_completed', binding: { providerId: 'fixture-codex', instanceId: 'fixture', accountScope: 'synthetic', nativeThreadId: 'synthetic-thread', nativeSessionId: null },
  turnId: 'synthetic-turn', commandId: 'synthetic-command', startedAt: '2026-01-01T00:00:01.000Z', endedAt: '2026-01-01T00:00:04.000Z', taskVerified: false };
const capabilities: Capability = { providerId: 'fixture-codex', mock: true, authentication: 'available', models: ['fixture-model'], catalogOnly: true, nativeFork: false, chatgptHistory: false };
export const visualFixture = {
  contract: 'aerynth.integration@0.1', synthetic: true,
  label: 'SIMULATED rendering fixture — no real provider execution',
  resource: { resourceId, title: 'Synthetic conversation', taskId: null },
  blocks: [
    { id: 'synthetic-block-a', resource_id: resourceId, workspace_id: 'synthetic-workspace-a' },
    { id: 'synthetic-block-b', resource_id: resourceId, workspace_id: 'synthetic-workspace-b' }
  ], capabilities, execution,
  alternateStates: ['dispatching','running','interrupted','failed','unknown'].map(state => ({ ...execution, state, endedAt: null, taskVerified: false })),
  events: [event(1, 'turn/started', 'simulated', null), event(2, 'item/agentMessage/delta', 'simulated', null), event(3, 'stream/gap-or-reorder', 'inferred', null), event(4, 'turn/completed', 'simulated', 'completed')]
};
