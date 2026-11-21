import { applyTelemetryDelta, eventKey, recordKey } from '../telemetry-delta.mjs';
import { MAX_SYNC_BYTES, validateProjection } from './sync.mjs';
import { codexHistoryMetrics, codexHistorySource, independentCodexTurn } from '../codex-turn-observation.mjs';

const digestPattern = /^[a-f0-9]{64}$/;
const bytes = new TextEncoder();
const limit = 2 * MAX_SYNC_BYTES;
const maxLiveRows = 500;
const maxVerificationRows = 24;
const maxVerificationNamespaceRows = 8;

export async function sha256(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.encode(value))),
    b => b.toString(16).padStart(2, '0')).join('');
}

async function readTelemetry(db, owner, namespace, id) {
  const row = await db.prepare('SELECT digest, received_at, payload, event_receipt_batches FROM task_telemetry WHERE owner_id = ? AND namespace = ? AND task_id = ?')
    .bind(owner, namespace, id).first();
  return row ? { digest: row.digest, received_at: row.received_at, projection: JSON.parse(row.payload),
    eventReceiptBatches: JSON.parse(row.event_receipt_batches) } : null;
}

export async function telemetryBaseline(db, owner, namespace, id) {
  const baseline = await readTelemetry(db, owner, namespace, id);
  return baseline && { digest: baseline.digest, received_at: baseline.received_at, projection: baseline.projection };
}

const fail = (status, error) => ({ status, body: { error } });
async function verifyCodexTurns(db, owner, namespace, id, events) {
  const observed = events.filter(event=>event.activity?.kind==='codex_turn');
  if (!observed.length) return true;
  const row = await db.prepare('SELECT record, engine FROM proposals WHERE owner_id = ? AND namespace = ? AND task_id = ?')
    .bind(owner,namespace,id).first();
  if (!row?.engine) return false;
  const task = JSON.parse(row.record);
  const attempts = JSON.parse(row.engine).attempts ?? [];
  for (const event of observed) {
    if (event.attempt_id || event.kind!=='engineering_activity' || event.phase!=='other' ||
        event.activity.source!=='codex' || !['completed','failed','inconclusive'].includes(event.activity.outcome) ||
        event.development_note || event.state || event.parent_span_id || event.activity.artifact_digest ||
        event.revision!==task.revision || event.repository!==task.repository ||
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(event.span_id) ||
        event.trace_id!=='codex-history:'+event.session_id ||
        event.event_id!=='codex-turn:'+event.session_id+':'+event.span_id ||
        event.activity.operation_id!==await sha256(event.event_id)) return false;
    const names = new Set();
    for (const metric of event.measurements) {
      const unit = metric.name.endsWith('_seconds')?'seconds':metric.name.endsWith('_partial')?'boolean':'count';
      if (!codexHistoryMetrics.has(metric.name) || names.has(metric.name) || metric.source!==codexHistorySource ||
          metric.availability!=='observed' || !Number.isSafeInteger(metric.value) || metric.value<0 ||
          metric.unit!==unit || (unit==='boolean'&&metric.value>1) ||
          (unit==='count'&&metric.value>50) || Object.keys(metric).length!==5) return false;
      names.add(metric.name);
    }
    if (names.size!==codexHistoryMetrics.size) return false;
    const started = event.measurements.find(metric=>metric.name==='codex_turn_started_unix_seconds').value*1000;
    const completed = Date.parse(event.occurred_at);
    if (completed>Date.now()+1000 || !independentCodexTurn(task,attempts,event.session_id,started,completed)) return false;
  }
  return true;
}
export async function ingestTaskTelemetry({ db, owner, namespace, id, body, validate, validateEvent }) {
  if (!body || typeof body !== 'object' || Object.keys(body).some(key => !['base', 'generated_at', 'records', 'events'].includes(key)) ||
      !(body.base === null || (typeof body.base === 'string' && digestPattern.test(body.base))) ||
      !Array.isArray(body.records) || body.records.length > 750 || !Array.isArray(body.events) || body.events.length > 2000 ||
      !(body.records.length || body.events.length)) {
    return fail(400, 'Invalid telemetry update');
  }
  const existing = await readTelemetry(db, owner, namespace, id);
  let payload, projection;
  try {
    const incoming = validateProjection({
      export_version: 1, authority: 'local-task-records', repository: 'Kgray44/Aetherwake',
      generated_at: body.generated_at, records: body.records, events: body.events,
    }, validate, validateEvent);
    if (!(await verifyCodexTurns(db,owner,namespace,id,incoming.events))) {
      return fail(409, 'Codex history overlaps managed work or is not linked to this Task');
    }
    projection = validateProjection(applyTelemetryDelta(existing?.projection, incoming), validate, validateEvent);
    const tasks = projection.records.filter(record => record.record_type === 'task');
    if (tasks.length !== 1 || tasks[0].id !== id ||
        projection.records.some(record => record.task_id !== undefined && record.task_id !== id) ||
        projection.events.some(event => event.task_id !== id)) throw Error('Task identity mismatch');
    const attempts = new Map(projection.records.filter(record => record.record_type === 'attempt').map(record => [record.id, record]));
    if ([...projection.records, ...projection.events].some(record =>
      attempts.has(record.attempt_id) && attempts.get(record.attempt_id).revision !== record.revision)) {
      throw Error('Attempt revision mismatch');
    }
    payload = JSON.stringify(projection);
    if (bytes.encode(payload).byteLength > MAX_SYNC_BYTES) return fail(413, 'Task projection exceeds the storage limit');
  } catch {
    return fail(400, 'Telemetry records do not match the Task journal contract');
  }
  const digest = await sha256(payload);
  if (digest === existing?.digest) return { status: 200, body: receipt(existing) };
  if (body.base !== (existing?.digest ?? null) ||
      (existing && body.generated_at <= existing.projection.generated_at)) {
    return fail(409, 'Telemetry baseline changed or update is older');
  }
  const receivedAt = new Date().toISOString();
  const previousEventCount = existing?.projection.events.length ?? 0;
  const batches = existing?.eventReceiptBatches ?? [];
  // Immutable events retain their positions. Store explicit ends so an older
  // worker can append events without extending the previous receipt.
  const eventCount = projection.events.length;
  const eventReceiptBatches = JSON.stringify(eventCount > previousEventCount
    ? [...batches, [previousEventCount, eventCount, receivedAt]] : batches);
  const live = namespace === 'live';
  const stored = existing
    ? await db.prepare(`UPDATE task_telemetry SET digest = ?, received_at = ?, payload = ?, event_receipt_batches = ?
        WHERE owner_id = ? AND namespace = ? AND task_id = ? AND digest = ?
          AND LENGTH(CAST(? AS BLOB)) + LENGTH(CAST(? AS BLOB)) + COALESCE((SELECT SUM(LENGTH(CAST(payload AS BLOB)) + LENGTH(CAST(event_receipt_batches AS BLOB)))
            FROM task_telemetry WHERE owner_id = ? AND namespace = ? AND task_id <> ?), 0) <= ?`)
      .bind(digest, receivedAt, payload, eventReceiptBatches, owner, namespace, id, body.base,
        payload, eventReceiptBatches, owner, namespace, id, limit).run()
    : await db.prepare(`INSERT OR IGNORE INTO task_telemetry (owner_id, namespace, task_id, digest, received_at, payload, event_receipt_batches)
        SELECT ?, ?, ?, ?, ?, ?, ? WHERE
          (? OR (SELECT COUNT(*) FROM task_telemetry WHERE owner_id = ? AND namespace <> 'live') < ?) AND
          (SELECT COUNT(*) FROM task_telemetry WHERE owner_id = ? AND namespace = ?) < ? AND
          LENGTH(CAST(? AS BLOB)) + LENGTH(CAST(? AS BLOB)) + COALESCE((SELECT SUM(LENGTH(CAST(payload AS BLOB)) + LENGTH(CAST(event_receipt_batches AS BLOB)))
            FROM task_telemetry WHERE owner_id = ? AND namespace = ?), 0) <= ?`)
      .bind(owner, namespace, id, digest, receivedAt, payload, eventReceiptBatches, Number(live), owner, maxVerificationRows,
        owner, namespace, live ? maxLiveRows : maxVerificationNamespaceRows,
        payload, eventReceiptBatches, owner, namespace, limit).run();
  if (stored.meta.changes !== 1) {
    const after = await readTelemetry(db, owner, namespace, id);
    if (after?.digest === digest) return { status: 200, body: receipt(after) };
    if (!after || after.digest === existing?.digest) return fail(413, 'Private Task telemetry storage limit reached');
    return fail(409, 'Concurrent telemetry update. Read the current baseline and retry.');
  }
  return { status: 200, body: receipt({ digest, received_at: receivedAt, projection }) };
}

function receipt({ digest, received_at, projection }) {
  return { digest, received_at, generated_at: projection.generated_at, records: projection.records.length, events: projection.events.length };
}

function eventReceipts(projection, batches) {
  const receipts = [];
  for (const [start, end, receivedAt] of batches) {
    for (let index = start; index < end; index++) {
      receipts.push([eventKey(projection.events[index]), receivedAt]);
    }
  }
  return Object.fromEntries(receipts);
}

const scopedEventKey = event => JSON.stringify([event.task_id, eventKey(event)]);

export function combinedTelemetry(legacy, rows) {
  const records = new Map();
  const events = new Map();
  const sources = [];
  let latest = legacy?.generated_at ?? '';
  for (const row of rows) {
    const projection = JSON.parse(row.payload);
    const source = receipt({ ...row, projection });
    sources.push({ task_id: row.task_id, ...source,
      event_receipts: eventReceipts(projection, JSON.parse(row.event_receipt_batches ?? '[]')) });
    for (const record of projection.records) if (!records.has(recordKey(record))) records.set(recordKey(record), record);
    for (const event of projection.events) if (!events.has(scopedEventKey(event))) events.set(scopedEventKey(event), event);
    if (projection.generated_at > latest) latest = projection.generated_at;
  }
  if (legacy) {
    const syncedTasks = new Set(rows.map(row => row.task_id));
    for (const record of legacy.records) {
      if (!syncedTasks.has(record.record_type === 'task' ? record.id : record.task_id) &&
          !records.has(recordKey(record))) records.set(recordKey(record), record);
    }
    for (const event of legacy.events) if (!syncedTasks.has(event.task_id) && !events.has(scopedEventKey(event))) events.set(scopedEventKey(event), event);
  }
  if (!latest) return null;
  return { authority: 'local-task-records', generated_at: latest, records: [...records.values()], events: [...events.values()], sources,
    coverage: { scope: 'explicitly instrumented operations only', owner_acceptance: 'not_authenticated_by_export' } };
}
