import { mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { Backend } from './service.mts';
const root = resolve('runtime', 'benchmark-' + Date.now()); mkdirSync(root, { recursive: true });
const path = resolve(root, 'backend.sqlite');
const options = { path, contentPolicy: 'synthetic-only' as const };
let b = new Backend(options);
const startup = performance.now(); await b.call('snapshot', {});
const startupMs = performance.now() - startup;
const samples: number[] = [];
try {
  const c = await b.call('createConversation', { title: 'Synthetic latency sample', commandId: 'benchmark-create' });
  for (let i = 0; i < 100; i++) {
    const start = performance.now();
    await b.call('addMessage', { resourceId: c.resourceId, role: 'user', content: 'Synthetic benchmark content. '.repeat(32), expectedRevision: i + 1 });
    samples.push(performance.now() - start);
  }
  await b.close();
  const reopen = performance.now(); b = new Backend(options); const s = await b.call('snapshot', {});
  const reopenMs = performance.now() - reopen;
  samples.sort((a, b) => a - b);
  console.log(JSON.stringify({ syntheticOnly: true, samples: samples.length, messageBytesEach: Buffer.byteLength('Synthetic benchmark content. '.repeat(32)), recoveredMessages: s.graph.messages.length, startupMs: +startupMs.toFixed(2), reopenMs: +reopenMs.toFixed(2), appendP50Ms: +samples[49].toFixed(2), appendP95Ms: +samples[94].toFixed(2), databaseBytes: statSync(path).size, processRssBytes: process.memoryUsage().rss, note: 'Single Windows run; RSS includes host and worker. Not sustained-load or acceptance thresholds.' }, null, 2));
} finally { await b.close(); }
