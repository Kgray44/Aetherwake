import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationDraftSession, flushConversationDraftSessions, type ConversationDraftPort, type ConversationDraftRecord } from '../src/draft-session.ts';

function deferred<T = void>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
async function until(check: () => boolean) { for (let i = 0; i < 50 && !check(); i++) await new Promise(resolve => setImmediate(resolve)); assert.ok(check()); }
/** Synthetic canonical command port only; no database, browser, native window, provider or network. */
function fixture(initial: Partial<ConversationDraftRecord> = {}) {
  let record: ConversationDraftRecord = { resourceId: 'chat:synthetic', version: 0, content: '', updatedAt: null, ...initial };
  const writes: { resourceId: string; expectedVersion: number; content: string }[] = [];
  let readGate: Promise<void> | null = null, responseGate: Promise<void> | null = null, lostResponse: string | undefined, denied = false, active = 0, maximumActive = 0, readCount = 0;
  const port: ConversationDraftPort = { async command(name: string, input: any) {
    if (denied) throw new Error('source_unavailable');
    if (name === 'readDraft') { readCount++; const result = { ...record }; await readGate; return result; }
    active++; maximumActive = Math.max(maximumActive, active); writes.push({ ...input });
    try {
      if (record.version !== input.expectedVersion) throw new Error('stale_draft_version');
      record = { ...record, version: record.version + 1, content: input.content, updatedAt: '2026-11-02T00:00:00Z',
        ...(input.documents === undefined ? {} : { documents: input.documents }) };
      const result = { ...record }; await responseGate; if (lostResponse) { const error = lostResponse; lostResponse = undefined; throw new Error(error); } return result;
    } finally { active--; }
  } };
  const create = (initialContent?: string) => new ConversationDraftSession({ port, resourceId: record.resourceId, debounceMs: 10000, ...(initialContent !== undefined ? { initialContent } : {}) });
  return { port, create, writes, get record() { return { ...record }; }, get maximumActive() { return maximumActive; }, get readCount() { return readCount; },
    setReadGate: (gate: Promise<void> | null) => { readGate = gate; }, setResponseGate: (gate: Promise<void> | null) => { responseGate = gate; }, loseResponse: (error = 'synthetic_response_lost') => { lostResponse = error; }, deny: (value: boolean) => { denied = value; },
    external: (content: string) => { record = { ...record, version: record.version + 1, content, updatedAt: '2026-11-02T00:00:01Z' }; } };
}

test('canonical recovery loads on the same ID and reopening reads durable text without writing or sending', async () => {
  const f = fixture({ version: 7, content: 'Synthetic durable unsent text' }), session = f.create(); await session.ready;
  assert.equal(session.snapshot().content, f.record.content); assert.equal(session.snapshot().version, 7); assert.equal(session.snapshot().phase, 'clean'); assert.deepEqual(f.writes, []); await session.dispose();
  const reopened = f.create(); await reopened.ready; assert.equal(reopened.snapshot().content, 'Synthetic durable unsent text'); await reopened.dispose();
});

test('attachment-only conflicts preserve both selections and an accepted checkpoint clears the selected draft', async () => {
  const f = fixture({ content: 'Same text in both editors' });
  const first = f.create(), second = f.create();
  await Promise.all([first.ready, second.ready]);
  const saved = { id: 'file:first', version: 2, title: 'First document' };
  const competing = { id: 'file:second', version: 1, title: 'Second document' };
  first.updateDocuments([saved]);
  await first.flush();
  second.updateDocuments([competing]);
  await assert.rejects(second.flush(), /stale_draft_version/);
  assert.deepEqual(second.snapshot().documents, [competing]);
  assert.deepEqual(second.snapshot().remote?.documents, [saved]);
  await second.resolve('use-stored', f.record.version);
  const checkpoint = await second.checkpoint();
  assert.deepEqual(checkpoint.record.documents, [saved]);
  assert.equal(await second.acknowledgeSent(checkpoint), true);
  assert.deepEqual(f.record.documents, []);
  assert.equal(f.record.content, '');
  await Promise.all([first.dispose(), second.dispose()]);
});

test('writes serialize and coalesce later edits while an exact submission checkpoint retains its own version', async () => {
  const f = fixture(), session = f.create(), gate = deferred(); await session.ready; f.setResponseGate(gate.promise);
  session.update('Submitted A'); const checkpoint = session.checkpoint(); await until(() => f.writes.length === 1); session.update('Later B'); session.update('Latest C'); assert.equal(f.writes.length, 1);
  f.setResponseGate(null); gate.resolve(); const sent = await checkpoint; assert.equal(sent.record.content, 'Submitted A'); assert.equal(sent.record.version, 1); await session.flush();
  assert.deepEqual(f.writes.map(w => [w.expectedVersion, w.content]), [[0, 'Submitted A'], [1, 'Latest C']]); assert.equal(f.maximumActive, 1); assert.equal(f.record.content, 'Latest C'); assert.equal(await session.acknowledgeSent(sent), false); assert.equal(session.snapshot().content, 'Latest C'); await session.dispose();
});

test('typing during initial read and before checkpoint persistence never changes the captured submission or erases later text', async () => {
  const f = fixture(), gate = deferred(); f.setReadGate(gate.promise); const session = f.create(); session.update('Exact clicked submission'); const checkpoint = session.checkpoint(); session.update('Text typed after Send'); gate.resolve();
  const sent = await checkpoint; await session.flush(); assert.equal(sent.record.content, 'Exact clicked submission'); assert.equal(session.snapshot().content, 'Text typed after Send'); assert.equal(f.record.content, 'Text typed after Send'); assert.equal(await session.acknowledgeSent(sent), false); await session.dispose();
});

test('accepted submission clears only its exact saved version and preserves the monotonic empty tombstone', async () => {
  const f = fixture(), session = f.create(); await session.ready; session.update('Accepted canonical submission'); const sent = await session.checkpoint(); assert.equal(await session.acknowledgeSent(sent), true);
  assert.equal(session.snapshot().content, ''); assert.equal(f.record.version, sent.record.version + 1); assert.deepEqual(f.writes.at(-1), { resourceId: 'chat:synthetic', expectedVersion: sent.record.version, content: '' }); await session.dispose();
  const reopened = f.create(); await reopened.ready; assert.equal(reopened.snapshot().version, 2); assert.equal(reopened.snapshot().content, ''); await reopened.dispose();
});

test('typing while an acknowledged clear is awaiting its response survives and is subsequently persisted', async () => {
  const f = fixture(), session = f.create(); await session.ready; session.update('Accepted prior submission'); const sent = await session.checkpoint(), gate = deferred(); f.setResponseGate(gate.promise);
  const clearing = session.acknowledgeSent(sent); await until(() => f.writes.length === 2); session.update('New typing while clear is pending'); f.setResponseGate(null); gate.resolve();
  assert.equal(await clearing, false); await session.flush(); assert.equal(session.snapshot().content, 'New typing while clear is pending'); assert.equal(f.record.content, 'New typing while clear is pending'); assert.equal(f.record.version, 3); await session.dispose();
});

test('CAS conflicts retain both drafts and explicit keep-local resolution binds the displayed remote revision', async () => {
  const f = fixture(), a = f.create(), b = f.create(); await Promise.all([a.ready, b.ready]); a.update('Other editor A'); await a.flush(); b.update('This editor B'); await assert.rejects(b.flush(), /stale_draft_version/);
  assert.equal(b.snapshot().content, 'This editor B'); assert.equal(b.snapshot().remote?.content, 'Other editor A'); assert.equal(b.snapshot().phase, 'conflict'); f.external('Newer remote C'); await assert.rejects(b.resolve('keep-local', 1), /draft_resolution_stale/); assert.equal(f.record.content, 'Newer remote C');
  assert.equal(b.snapshot().remote?.version, 2); await b.resolve('keep-local', 2); assert.equal(f.record.content, 'This editor B'); assert.equal(f.record.version, 3); await a.reload(); assert.equal(a.snapshot().content, 'This editor B'); await Promise.all([a.dispose(), b.dispose()]);
});

test('legacy in-memory recovery cannot overwrite a stored draft without an explicit use-stored or keep-local choice', async () => {
  const f = fixture({ version: 4, content: 'Stored canonical draft' }), session = f.create('Legacy in-memory text'); await session.ready; assert.equal(session.snapshot().content, 'Legacy in-memory text'); assert.equal(session.snapshot().remote?.content, 'Stored canonical draft'); await assert.rejects(session.flush(), /stale_draft_version/); assert.equal(f.writes.length, 0);
  await session.reload(); assert.equal(session.snapshot().phase, 'conflict'); await assert.rejects(session.flush(), /stale_draft_version/);
  await session.resolve('use-stored', 4); assert.equal(session.snapshot().content, 'Stored canonical draft'); assert.equal(f.writes.length, 0); await session.dispose();
});

test('typing during explicit remote resolution invalidates that decision instead of replacing newer editor text', async () => {
  const f = fixture({ version: 3, content: 'Stored draft' }), session = f.create('Local draft'); await session.ready; const gate = deferred(); f.setReadGate(gate.promise);
  const resolution = session.resolve('use-stored', 3); await new Promise(resolve => setImmediate(resolve)); session.update('New text typed during resolution'); gate.resolve(); await assert.rejects(resolution, /draft_resolution_stale/); assert.equal(session.snapshot().content, 'New text typed during resolution'); assert.equal(f.writes.length, 0); f.setReadGate(null); await session.resolve('keep-local', 3); await session.dispose();
});

test('an edit generation is retained even when later typing returns to identical submitted text', async () => {
  const f = fixture(), session = f.create(); await session.ready; session.update('Submitted text'); const sent = await session.checkpoint(); session.update('Later typing'); session.update('Submitted text'); assert.equal(await session.acknowledgeSent(sent), false); assert.equal(session.snapshot().content, 'Submitted text'); await session.dispose();
});

for (const laterEdit of [undefined, 'A later draft', 'Accepted draft']) test('recovery of a committed accepted-draft clear preserves later edits ('+String(laterEdit)+')', async () => {
  const f = fixture({content:'Accepted draft',version:1,documents:[{id:'note:example',title:'Synthetic note',version:1}]}), session = f.create();
  await session.ready;
  const checkpoint = await session.checkpoint();
  f.loseResponse('backend_disconnected');
  await assert.rejects(session.acknowledgeSent(checkpoint), /backend_disconnected/);
  if (laterEdit !== undefined) {
    session.update('Intermediate edit');
    session.update(laterEdit);
  }
  await session.reload();
  await session.flush();
  assert.equal(session.snapshot().phase, 'clean');
  assert.equal(session.snapshot().content, laterEdit ?? '');
  assert.equal(session.snapshot().documents.length, laterEdit === undefined ? 0 : 1);
  assert.equal(f.writes.length, laterEdit === undefined ? 2 : 3);
  await session.dispose();
});

test('lost draft response and access denial preserve text; explicit reload reconciles actual saved recovery without replay', async () => {
  const f = fixture(), session = f.create(); await session.ready; f.loseResponse(); session.update('Recovery whose response was lost'); await assert.rejects(session.flush(), /synthetic_response_lost/); assert.equal(session.snapshot().content, 'Recovery whose response was lost'); assert.equal(session.snapshot().phase, 'error');
  await session.reload(); await session.flush(); assert.equal(f.writes.length, 1); assert.equal(session.snapshot().phase, 'clean'); f.deny(true); await assert.rejects(session.reload(), /source_unavailable/); assert.equal(session.snapshot().content, 'Recovery whose response was lost'); f.deny(false); await session.reload(); await session.dispose();
});

for (const [competing,later] of [[false,'Later local edit'],[false,''],[true,'Later local edit'],[true,'']] as const)
test('lost draft save response with later typing (competing edit: '+competing+', cleared: '+!later+')', async () => {
  const f = fixture(), session = f.create();
  await session.ready;
  f.loseResponse('backend_disconnected');
  session.update('First local edit');
  await assert.rejects(session.flush(), /backend_disconnected/);
  session.update(later);
  if (competing) f.external('Competing stored edit');
  await session.reload();
  assert.equal(session.snapshot().content, later);
  if (competing) {
    assert.equal(session.snapshot().remote?.content, 'Competing stored edit');
    assert.equal(f.writes.length, 1);
    await session.resolve('use-stored', f.record.version);
  } else {
    await session.flush();
    assert.equal(f.record.content, later);
    assert.deepEqual(f.writes.map(write => write.expectedVersion), [0, 1]);
  }
  await session.dispose();
});

test('over-limit input remains local and visible until corrected; it is never truncated or sent', async () => {
  const f = fixture(), session = f.create(); await session.ready; const text = 'x'.repeat(16385); session.update(text); await assert.rejects(session.flush(), /draft_limit_exceeded/); assert.equal(session.snapshot().content, text); assert.equal(f.writes.length, 0); session.update('Corrected local recovery'); await session.flush(); assert.equal(f.record.content, 'Corrected local recovery'); await session.dispose();
});

test('a delayed reload response cannot roll back a newer acknowledged editor save or canonical version', async () => {
  const f = fixture(), session = f.create(); await session.ready; const gate = deferred(); f.setReadGate(gate.promise); const reload = session.reload(); await until(() => f.readCount === 2);
  session.update('New text saved while the older read response is pending'); await session.flush(); assert.equal(session.snapshot().version, 1); gate.resolve(); await reload;
  assert.equal(session.snapshot().version, 1); assert.equal(session.snapshot().content, f.record.content); assert.equal(session.snapshot().phase, 'clean'); f.setReadGate(null); await session.dispose();
});

test('a newer competing draft read preserves text typed during that read and requires explicit conflict resolution', async () => {
  const f = fixture(), session = f.create(); await session.ready; f.external('A genuine competing writer'); const gate = deferred(); f.setReadGate(gate.promise); const reload = session.reload(); await until(() => f.readCount === 2);
  session.update('This editor typed during the read'); gate.resolve(); await reload; assert.equal(session.snapshot().content, 'This editor typed during the read'); assert.equal(session.snapshot().phase, 'conflict'); assert.equal(session.snapshot().remote?.content, 'A genuine competing writer'); await assert.rejects(session.flush(), /stale_draft_version/);
  f.setReadGate(null); await session.resolve('keep-local', 1); assert.equal(f.record.content, 'This editor typed during the read'); await session.dispose();
});

test('retrying an initial failed read cannot discard local recovery when a stored draft becomes available', async () => {
  const f = fixture(); f.deny(true); const session = f.create(); await session.ready; session.update('Text retained while the first read was denied'); f.deny(false); f.external('Stored competing recovery'); await session.reload();
  assert.equal(session.snapshot().content, 'Text retained while the first read was denied'); assert.equal(session.snapshot().phase, 'conflict'); assert.equal(session.snapshot().remote?.content, 'Stored competing recovery'); await session.resolve('keep-local', 1); await session.dispose();
});

test('manager-wide draining rechecks an earlier composer after awaiting another composer save', async () => {
  const a = fixture({ resourceId: 'chat:a' }), b = fixture({ resourceId: 'chat:b' }), first = a.create(), second = b.create(); await Promise.all([first.ready, second.ready]); const gate = deferred(); b.setResponseGate(gate.promise); second.update('Slow second composer write');
  const flush = flushConversationDraftSessions(() => [first, second]); await until(() => b.writes.length === 1); first.update('Input arriving while another composer is saving'); b.setResponseGate(null); gate.resolve(); await flush;
  assert.equal(a.record.content, 'Input arriving while another composer is saving'); assert.equal(first.snapshot().phase, 'clean'); assert.equal(second.snapshot().phase, 'clean'); await Promise.all([first.dispose(), second.dispose()]);
});
