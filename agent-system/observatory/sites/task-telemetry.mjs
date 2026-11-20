import { applyTelemetryDelta, eventKey, recordKey } from '../telemetry-delta.mjs';
import { MAX_SYNC_BYTES, validateProjection } from './sync.mjs';

const digestPattern = /^[a-f0-9]{64}$/;
const bytes = new TextEncoder();
const limit = 2 * MAX_SYNC_BYTES;
const maxRows = 24;
const maxNamespaceRows = 8;

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
  // Validated deltas append immutable events in stable order. One offset dates the entire new batch.
  const eventReceiptBatches = JSON.stringify(projection.events.length > previousEventCount
    ? [...batches, [previousEventCount, receivedAt]] : batches);
  const stored = existing
    ? await db.prepare(`UPDATE task_telemetry SET digest = ?, received_at = ?, payload = ?, event_receipt_batches = ?
        WHERE owner_id = ? AND namespace = ? AND task_id = ? AND digest = ?
          AND LENGTH(CAST(? AS BLOB)) + LENGTH(CAST(? AS BLOB)) + COALESCE((SELECT SUM(LENGTH(CAST(payload AS BLOB)) + LENGTH(CAST(event_receipt_batches AS BLOB)))
            FROM task_telemetry WHERE owner_id = ? AND namespace = ? AND task_id <> ?), 0) <= ?`)
      .bind(digest, receivedAt, payload, eventReceiptBatches, owner, namespace, id, body.base,
        payload, eventReceiptBatches, owner, namespace, id, limit).run()
    : await db.prepare(`INSERT OR IGNORE INTO task_telemetry (owner_id, namespace, task_id, digest, received_at, payload, event_receipt_batches)
        SELECT ?, ?, ?, ?, ?, ?, ? WHERE
          (SELECT COUNT(*) FROM task_telemetry WHERE owner_id = ?) < ? AND
          (SELECT COUNT(*) FROM task_telemetry WHERE owner_id = ? AND namespace = ?) < ? AND
          LENGTH(CAST(? AS BLOB)) + LENGTH(CAST(? AS BLOB)) + COALESCE((SELECT SUM(LENGTH(CAST(payload AS BLOB)) + LENGTH(CAST(event_receipt_batches AS BLOB)))
            FROM task_telemetry WHERE owner_id = ? AND namespace = ?), 0) <= ?`)
      .bind(owner, namespace, id, digest, receivedAt, payload, eventReceiptBatches, owner, maxRows,
        owner, namespace, maxNamespaceRows, payload, eventReceiptBatches, owner, namespace, limit).run();
  if (stored.meta.changes !== 1) {
    const after = await readTelemetry(db, owner, namespace, id);
    if (after?.digest === digest) return { status: 200, body: receipt(after) };
    return fail(409, 'Concurrent update or private telemetry storage limit reached');
  }
  return { status: 200, body: receipt({ digest, received_at: receivedAt, projection }) };
}

function receipt({ digest, received_at, projection }) {
  return { digest, received_at, generated_at: projection.generated_at, records: projection.records.length, events: projection.events.length };
}

function eventReceipts(projection, batches) {
  let batch = 0;
  let receivedAt;
  const receipts = [];
  for (const [index, event] of projection.events.entries()) {
    if (batches[batch]?.[0] === index) receivedAt = batches[batch++][1];
    if (receivedAt) receipts.push([eventKey(event), receivedAt]);
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
