import type { VelaRequest, VelaState } from '../../vela-core/src/contracts.ts';
import type { Execution } from '../src/contracts.mts';
import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BackendCore} from '../src/core.mts';
test('Vela projects memory acknowledgement only for the matching readable request input', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aerynth-memory-projection-'));
  const core = new BackendCore({ path: join(root, 'profile.sqlite'), provider: 'fixture', contentPolicy: 'synthetic-only' });
  try {
    const opened = await core.command('vela', { name: 'open', input: {} }) as VelaState;
    const conversationId = opened.conversation!.resourceId;
    const message = await core.command('addMessage', { resourceId: conversationId, role: 'user',
      content: 'Synthetic reviewed request', expectedRevision: opened.conversation!.revision });
    const owner = core as unknown as { vela: { state(): VelaState }; state: { executions: Record<string, Execution> } };
    const actual = owner.vela.state.bind(owner.vela);
    const request = { id: 'memory-request', conversationId, inputMessageId: message.id, reviewedMemory: true } as VelaRequest;
    owner.vela.state = () => ({ ...actual(), requests: [{ ...request }] });
    const receipt = { state: 'simulated' as const, manifestDigest: 'a'.repeat(64) };
    const execution = { id: 'memory-execution', resourceId: conversationId, providerId: 'openai-api-vela',
      commandId: 'vela-api:' + request.id, inputMessageId: message.id, memoryDisclosure: receipt } as Execution;
    const projected = async () => ((await core.command('vela', { name: 'state', input: {} })) as VelaState).requests[0].memoryDisclosure;
    assert.equal(await projected(), undefined);
    owner.state.executions[execution.id] = execution;
    assert.equal(await projected(), undefined);
    execution.responseId = 'synthetic-provider-response';
    assert.deepEqual(await projected(), receipt);
    execution.inputMessageId = 'foreign-message';
    assert.equal(await projected(), undefined);
    execution.inputMessageId = message.id;
    request.conversationId = 'foreign-conversation';
    assert.equal(await projected(), undefined);
    request.conversationId = conversationId;
    execution.providerId = 'foreign-provider';
    assert.equal(await projected(), undefined);
    execution.providerId = 'openai-api-vela';
    request.reviewedMemory = undefined;
    assert.equal(await projected(), undefined);
    request.reviewedMemory = true;
    assert.deepEqual(await projected(), receipt);
    const accessOwner = core as unknown as { conversationReadAccess(id:string,message:string):boolean };
    assert.deepEqual((await core.command('conversationActivity',{resourceIds:[conversationId]})).executions[0].memoryDisclosure,receipt);
    const storage = core as unknown as { db: import('node:sqlite').DatabaseSync; kernel: import('../../workspace-kernel/kernel.mts').WorkspaceKernel };
    const version = () => Number(storage.db.prepare('SELECT version FROM resources WHERE id=?').get(conversationId)!.version);
    storage.kernel.setResourceArchived(conversationId, true, version());
    // Archived input reads can remain allowed, but acknowledgement projection must retain the active-resource gate.
    assert.equal(accessOwner.conversationReadAccess(conversationId, message.id), true);
    assert.equal((await core.command('conversationActivity',{resourceIds:[conversationId]})).executions[0].memoryDisclosure,undefined);
    await assert.rejects(projected(), /canonical_conversation_not_authorized/);
    storage.kernel.setResourceArchived(conversationId, false, version());
    assert.deepEqual((await core.command('conversationActivity',{resourceIds:[conversationId]})).executions[0].memoryDisclosure,receipt);
    const originalInputAccess = accessOwner.conversationReadAccess.bind(core);
    accessOwner.conversationReadAccess = () => false;
    assert.equal(await projected(), undefined);
    assert.equal((await core.command('conversationActivity',{resourceIds:[conversationId]})).executions[0].memoryDisclosure,undefined);
    accessOwner.conversationReadAccess = originalInputAccess;
    const graphOwner = core as unknown as { graph: { markUnavailable(messageId:string):void } };
    graphOwner.graph.markUnavailable(message.id);
    assert.equal(originalInputAccess(conversationId, message.id), false);
    assert.equal(await projected(), undefined);
    assert.equal((await core.command('conversationActivity',{resourceIds:[conversationId]})).executions[0].memoryDisclosure,undefined);

  } finally {
    await core.command('close', {});
    rmSync(root, { recursive: true, force: true });
  }
});
