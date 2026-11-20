/** Private immutable event journal. One atomically linked file per event; no daemon. */
import { mkdir, open, readFile, readdir, link, unlink, lstat, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
const digest = v => createHash('sha256').update(v).digest('hex');
export async function withJournalLock(directory, action) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (process.platform !== 'win32' && (info.mode & 0o077))) throw Error('Journal must be private directory');
  const recovery=join(directory,'.recovery-lock');
  try {await lstat(recovery);throw Error('Journal recovery in progress');}catch(e){if(e.code!=='ENOENT')throw e;}
  const lock = join(directory,'.writer-lock');
  // Ordinary concurrent writers can drain without invoking recovery. A
  // stalled lock is still left in place for explicit owner/liveness checks.
  let deadline;
  while (true) {
    try {
      await mkdir(lock, { mode: 0o700 });
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const now = performance.now();
      deadline ??= now + 2000;
      if (now >= deadline) throw Error('Journal busy or interrupted writer; inspect lock before recovery');
      await delay(Math.min(deadline - now, randomInt(8, 25)));
    }
  }
  try {await lstat(recovery);await rmdir(lock);throw Error('Journal recovery in progress');}catch(e){if(e.code!=='ENOENT')throw e;}
  const owner = await open(join(lock,'owner.json'),'wx',0o600);
  try { await owner.writeFile(JSON.stringify({pid:process.pid,host:hostname(),created_at:new Date().toISOString()}));await owner.sync(); } finally {await owner.close();}
  try { return await action(); } finally { await unlink(join(lock,'owner.json')); await rmdir(lock); }
}
export async function appendEvent(directory, event, options = {}) {
  return withJournalLock(directory,()=>appendEventLocked(directory,event,options));
}
export async function appendEventLocked(directory, event, { maxEvents = 10000, maxBytes = 32 * 1024 * 1024 } = {}) {
  if (!event.event_id || !event.task_id || !event.occurred_at) throw Error('Missing event identity');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (process.platform !== 'win32' && (info.mode & 0o077))) throw Error('Journal must be private directory');
  const body = JSON.stringify(event) + '\n';
  const destination = join(directory, digest(event.event_id) + '.json');
  try { const previous = await readFile(destination, 'utf8'); if (previous !== body) throw Error('Conflicting event identity'); return false; } catch(e) { if(e.code !== 'ENOENT') throw e; }
  const names = (await readdir(directory)).filter(n => n.endsWith('.json') || n.startsWith('.pending-'));
  // Fail closed instead of deleting historical evidence automatically.
  const limitMessage = 'Journal retention limit: explicitly archive before continuing';
  if (names.length >= maxEvents) throw Error(limitMessage);
  let bytes = Buffer.byteLength(body);
  if (bytes > maxBytes) throw Error(limitMessage);
  // Bound outstanding filesystem work while avoiding one event-loop round trip per file.
  const batchSize = 16;
  for (let offset = 0; offset < names.length; offset += batchSize) {
    const files = await Promise.all(names.slice(offset, offset + batchSize).map(name => lstat(join(directory, name))));
    for (const file of files) bytes += file.size;
    if (bytes > maxBytes) throw Error(limitMessage);
  }
  const temporary = join(directory, '.pending-' + randomUUID());
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(body); await handle.sync(); } finally { await handle.close(); }
  try { await link(temporary, destination); } catch(e) {
    if(e.code !== 'EEXIST' || await readFile(destination,'utf8') !== body) throw e;
  } finally { await unlink(temporary); }
  // POSIX directory sync closes the rename/link durability gap. Windows support varies.
  if(process.platform !== 'win32') {const dir=await open(directory,'r');try{await dir.sync();}finally{await dir.close();}}
  return true;
}
/** Explicit recovery only; stale owner must match and be provably dead on this host. */
export async function recoverInterruptedWriter(directory,{expectedPid,expectedCreatedAt}) {
 const recovery=join(directory,'.recovery-lock');
 try{await mkdir(recovery,{mode:0o700});}catch(e){if(e.code==='EEXIST')throw Error('Another recovery is active or interrupted');throw e;}
 try {
 const lock=join(directory,'.writer-lock');
 const owner=JSON.parse(await readFile(join(lock,'owner.json'),'utf8'));
 if(owner.pid!==expectedPid||owner.created_at!==expectedCreatedAt||owner.host!==hostname()||!Number.isInteger(owner.pid)||owner.pid<=0) throw Error('Recovery owner mismatch');
 try {process.kill(owner.pid,0);throw Error('Writer still alive; recovery refused');}catch(e){if(e.code!=='ESRCH')throw e;}
 // Missing/corrupt metadata and permission-unknown process state require manual diagnosis.
 const again=JSON.parse(await readFile(join(lock,'owner.json'),'utf8'));
 if(JSON.stringify(again)!==JSON.stringify(owner))throw Error('Writer changed during recovery');
 await unlink(join(lock,'owner.json'));await rmdir(lock);
 return {recovered:true,events_preserved:true};
 } finally {await rmdir(recovery);}
}
export async function readJournal(directory, { maxEvents, maxBytes, missingOk = false, immutableCache } = {}) {
  let entries;
  try { entries = await readdir(directory); }
  catch (error) { if (missingOk && error.code === 'ENOENT' && !immutableCache?.size) return []; throw error; }
  const names = entries.filter(n => /^[a-f0-9]{64}\.json$/.test(n));
  if (immutableCache?.size) {
    const present = new Set(names);
    for (const name of immutableCache.keys()) if (!present.has(name)) throw Error('Committed journal entry disappeared');
  }
  if (maxEvents !== undefined && names.length > maxEvents) throw Error('Journal read exceeds event limit');
  const events = [];
  let bytes = 0;
  for (const name of names) {
    const path = join(directory, name);
    let fingerprint;
    if (immutableCache) {
      const info = await lstat(path, { bigint: true });
      if (!info.isFile()) throw Error('Journal entries must be regular files');
      bytes += Number(info.size);
      if (maxBytes !== undefined && bytes > maxBytes) throw Error('Journal read exceeds byte limit');
      fingerprint = [info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':');
      const known = immutableCache.get(name);
      if (known) {
        if (known.fingerprint !== fingerprint) throw Error('Committed journal entry changed');
        events.push(known.event);
        continue;
      }
    } else if (maxBytes !== undefined) {
      const info = await lstat(path);
      if (!info.isFile()) throw Error('Journal entries must be regular files');
      bytes += info.size;
      if (bytes > maxBytes) throw Error('Journal read exceeds byte limit');
    }
    const event = JSON.parse(await readFile(path, 'utf8'));
    if (typeof event?.event_id !== 'string' || digest(event.event_id) + '.json' !== name) throw Error('Journal identity corruption');
    if (immutableCache) immutableCache.set(name, { fingerprint, event });
    events.push(event);
  }
  return events.sort((a,b)=>a.occurred_at.localeCompare(b.occurred_at)||a.event_id.localeCompare(b.event_id));
}
const phases = new Set(['queue','waiting','context','investigation','implementation','verification','integration','review','recovery','other']);
const states = new Set(['created','ready','assigned','started','blocked','verifying','integrated','completed','accepted','failed','interrupted','cancelled','restarted','resumed']);
export function traceEvent({task, attemptId, sessionId, traceId, spanId, parentSpanId, kind, phase='other', state, measurements=[], eventId=randomUUID(), occurredAt=new Date().toISOString()}) {
  if (!task?.id || !['lifecycle','span_start','span_end','measurement','development_note'].includes(kind) || !phases.has(phase) || state && !states.has(state)) throw Error('Invalid trace event');
  return {trace_version:1,event_id:eventId,task_id:task.id,...attemptId?{attempt_id:attemptId}:{},...sessionId?{session_id:sessionId}:{},trace_id:traceId||task.id,span_id:spanId||eventId,...parentSpanId?{parent_span_id:parentSpanId}:{},repository:task.repository,revision:task.revision,occurred_at:occurredAt,kind,phase,...state?{state}:{},measurements};
}
export function summarize(events) {
  const starts = new Map(), phaseMs = {}, incomplete = new Set();
  for(const e of events) {
    const key = e.task_id + ':' + e.trace_id + ':' + e.span_id;
    if(e.kind === 'span_start') { starts.set(key,e); incomplete.add(key); }
    if(e.kind === 'span_end' && starts.has(key) && incomplete.has(key)) { const s=starts.get(key), ms=Date.parse(e.occurred_at)-Date.parse(s.occurred_at); if(ms>=0) phaseMs[e.phase]=(phaseMs[e.phase]||0)+ms; incomplete.delete(key); }
  }
  return {phase_ms:phaseMs, incomplete_spans:incomplete.size, coverage:'instrumented spans only; overlapping durations are not wall-clock critical path', efficiency_comparison:'unavailable: no controlled baseline'};
}
