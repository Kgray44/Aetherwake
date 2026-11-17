#!/usr/bin/env node
/** Project one private Task journal for the existing owner-private Observatory. */
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_SYNC_BYTES, validateProjection } from '../../agent-system/observatory/sites/sync.mjs';
import { canonical } from './evidence-trust.mjs';
import { readJournal } from './journal.mjs';
import { readRecordHistory, reduceAttempts } from './record-journal.mjs';
import { validateRecord, validateTraceEvent } from './validate-record.mjs';

const JOURNAL_LIMITS = {maxEvents: 10000, maxBytes: 32 * 1024 * 1024};
const recordTimes = ['created_at', 'started_at', 'finished_at', 'observed_at', 'generated_at'];
const validRecord = record => !validateRecord(record).length &&
  recordTimes.every(field => record[field] === undefined || validUtcTime(record[field]));
const validEvent = event => !validateTraceEvent(event).length && validUtcTime(event.occurred_at);

function validUtcTime(value) {
  return /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,19) === value.slice(0,19);
}

export async function projectJournal({ task, directory, cache, generatedAt }) {
  if (task?.record_type !== 'task' || !validRecord(task)) throw Error('Expected a valid v1 Task');
  const [events, history] = await Promise.all([
    readJournal(directory, { ...JOURNAL_LIMITS, immutableCache: cache?.events }),
    readRecordHistory(directory, { ...JOURNAL_LIMITS, taskId: task.id, immutableCache: cache?.records })
  ]);

  const unique = new Map([['task:' + task.id, task]]);
  for (const record of history) {
    if (!validRecord(record)) throw Error('Invalid v1 journal record');
    if (record.repository !== task.repository ||
        (record.task_id !== undefined && record.task_id !== task.id) ||
        (record.record_type === 'task' && record.id !== task.id)) {
      throw Error('Journal contains an unrelated record');
    }
    if (record.record_type === 'attempt') continue;
    const key = record.record_type + ':' + record.id;
    const prior = unique.get(key);
    if (prior && canonical(prior) !== canonical(record)) throw Error('Conflicting journal record identity');
    unique.set(key, record);
  }
  const attempts = reduceAttempts(history);
  const byId = new Map(attempts.map(attempt => [attempt.id, attempt]));
  for (const record of unique.values()) assertAttemptRevision(record);

  const spans = new Map();
  for (const event of events) {
    if (!validEvent(event)) throw Error('Invalid journal trace event');
    if (event.task_id !== task.id || event.repository !== task.repository) throw Error('Journal contains an unrelated trace event');
    assertAttemptRevision(event);
    if (event.kind !== 'span_start' && event.kind !== 'span_end') continue;
    const key = JSON.stringify([event.attempt_id, event.revision, event.trace_id, event.span_id]);
    const prior = spans.get(key);
    if (prior && (prior.kinds.has(event.kind) || prior.phase !== event.phase || prior.parent !== event.parent_span_id)) {
      throw Error('Conflicting journal span identity');
    }
    if (prior) prior.kinds.add(event.kind);
    else spans.set(key, { kinds:new Set([event.kind]), phase:event.phase, parent:event.parent_span_id });
  }

  const projection = validateProjection({
    export_version: 1,
    authority: 'local-task-records',
    repository: task.repository,
    generated_at: generatedAt ?? new Date().toISOString(),
    records: [...unique.values(), ...attempts],
    events
  }, validRecord, validEvent);
  const serialized = JSON.stringify(projection) + '\n';
  if (Buffer.byteLength(serialized) > MAX_SYNC_BYTES) throw Error('Sanitized projection exceeds the Sites upload limit');
  return serialized;

  function assertAttemptRevision(item) {
    // An absent Attempt may be an interrupted or separately retained observation.
    const attempt = byId.get(item.attempt_id);
    if (attempt && attempt.revision !== item.revision) throw Error('Journal Attempt revision mismatch');
  }
}

function options(args) {
  if (args.length !== 4 || !['--task', '--journal'].includes(args[0]) ||
      !['--task', '--journal'].includes(args[2]) || args[0] === args[2] || !args[1] || !args[3]) {
    throw Error('Usage: node scripts/agent/export-journal.mjs --task <task.json> --journal <journal-directory>');
  }
  return { [args[0]]:args[1], [args[2]]:args[3] };
}

export async function readTask(path) {
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_SYNC_BYTES) throw Error('Task input exceeds the read limit or is not a regular file');
    return JSON.parse(await file.readFile({encoding:'utf8'}));
  } catch (error) {
    if (error instanceof SyntaxError) throw Error('Task input is not valid JSON');
    throw error;
  } finally {
    await file.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const opts = options(process.argv.slice(2));
    process.stdout.write(await projectJournal({ task: await readTask(opts['--task']), directory: opts['--journal'] }));
  } catch (error) {
    // Native filesystem and parser errors can contain private paths or source text.
    const diagnosis = error.code ?? (error instanceof SyntaxError ? 'Invalid journal JSON' : error.message);
    process.stderr.write('Journal export: ' + diagnosis + '\n');
    process.exitCode = 1;
  }
}
