import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Backend } from './service.mts';
const path = process.argv[2];
if (!path || !existsSync(path)) throw new Error('Usage: node src/reopen.mts EXISTING_SYNTHETIC_DATABASE [--live]');
const backend = new Backend({ path: resolve(path), provider: process.argv.includes('--live') ? 'codex' : 'fixture', contentPolicy: 'synthetic-only', codexExecutable: process.env.AERYNTH_CODEX_EXE });
try {
  const snapshot = await backend.call('snapshot', {});
  const completed = Object.values(snapshot.executions).findLast(e => e.state === 'provider_completed');
  assert.ok(completed);
  const r = await backend.call('reconcile', { resourceId: completed.resourceId });
  assert.equal(r.providerThreadAvailable, true); assert.equal(r.syntheticTurnReceipt?.exactMarker, true);
  assert.ok(r.syntheticTurnReceipt?.itemTypes.every(t => ['userMessage','agentMessage'].includes(t)));
  const history = await backend.call('replay', { limit: 1000 });
  console.log(JSON.stringify({ syntheticContent: true, inferenceSubmitted: false, conversations: snapshot.conversations.length, lineageEdges: snapshot.graph.edges.length, messages: snapshot.graph.messages.length, completedExecutions: Object.values(snapshot.executions).filter(e => e.state === 'provider_completed').length, journalRecords: history.events.length, providerThreadAvailable: r.providerThreadAvailable, persistedTurnItemTypes: r.syntheticTurnReceipt?.itemTypes, exactMarker: r.syntheticTurnReceipt?.exactMarker, taskVerified: completed.taskVerified }, null, 2));
} finally { await backend.close(); }
