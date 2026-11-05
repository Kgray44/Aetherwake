import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptedConversationSubmission } from '../src/ui.ts';

test('canonical submission acceptance is separate from execution completion and needs matching command/resource/message evidence', () => {
  const input = { resourceId: 'chat:synthetic', providerId: 'synthetic-planner', content: 'Exact user submission', commandId: 'command:synthetic', revision: 5, priorMessageIds: ['message:old'] };
  const message = { id: 'message:new', resourceId: input.resourceId, inherited: false, role: 'user', content: input.content };
  const after = { conversation: { resourceId: input.resourceId, revision: 6 }, messages: { items: [message] } };
  const execution = { id: 'execution:synthetic', resourceId: input.resourceId, providerId: input.providerId, commandId: input.commandId, state: 'running', taskVerified: false };
  assert.equal(acceptedConversationSubmission(input, execution, after), true, 'A matching running execution plus exact durable authored message can acknowledge Send');
  assert.equal(acceptedConversationSubmission(input, execution), false, 'Execution alone carries no exact prompt/message evidence');
  for (const state of ['unknown', 'failed', 'interrupted', 'dispatching']) assert.equal(acceptedConversationSubmission(input, { ...execution, state }, after), false);
  assert.equal(acceptedConversationSubmission(input, { ...execution, commandId: 'other:command' }, after), false);
  assert.equal(acceptedConversationSubmission(input, { ...execution, providerId: 'other:provider' }, after), false);
  assert.equal(acceptedConversationSubmission(input, execution, { ...after, messages: { items: [{ ...message, inherited: true }] } }), false);
  assert.equal(acceptedConversationSubmission(input, execution, { ...after, messages: { items: [{ ...message, id: 'message:old' }] } }), false);
  assert.equal(acceptedConversationSubmission(input, execution, { ...after, messages: { items: [{ ...message, content: 'Different text' }] } }), false);
  assert.equal(acceptedConversationSubmission(input, { ...message, revision: 6 }), true, 'A canonical local user-message receipt directly confirms submission');
  assert.equal(acceptedConversationSubmission(input, { ...message, revision: 5 }), false);
});

// Mounted behavior is exercised by chat.test.mts, without invoking the native acceptance helper.
