import { sanitizeExport } from '../../../scripts/agent/telemetry-export.mjs';
// Private projection only. Local execution records remain authoritative.
export const MAX_SYNC_BYTES = 1024 * 1024;
export const MAX_VERIFICATION_NAMESPACES = 8;
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
export function validateProjection(body, validateRecord, validateEvent, now = Date.now()) {
  if (!body || body.export_version !== 1 || body.authority !== 'local-task-records' || body.repository !== 'Kgray44/Aetherwake') throw Error('Unsupported projection authority');
  if (!Number.isFinite(Date.parse(body.generated_at)) || new Date(body.generated_at).toISOString() !== body.generated_at) throw Error('Invalid export timestamp');
  if (Date.parse(body.generated_at) > now + MAX_CLOCK_SKEW_MS) throw Error('Export timestamp is ahead of trusted clock');
  if (Object.keys(body).some(k => !['export_version','authority','repository','generated_at','records','events','coverage'].includes(k))) throw Error('Unexpected export field');
  if (!Array.isArray(body.records) || body.records.length > 750 || !Array.isArray(body.events) || body.events.length > 2000) throw Error('Projection limit exceeded');
  const keys = new Set();
  for (const record of body.records) {
    if (!validateRecord(record) || record.repository !== body.repository) throw Error('Invalid contract record');
    const key = record.record_type + ':' + record.id;
    if (keys.has(key)) throw Error('Duplicate record identifier');
    keys.add(key);
    // Ingestion is never independent evidence of human acceptance.
    if (record.owner_acceptance === 'accepted' || (record.record_type === 'task' && record.state === 'accepted')) throw Error('Owner acceptance requires an independent authenticated receipt');
  }
  const ids = new Set();
  for (const event of body.events) {
    if (!validateEvent || !validateEvent(event) || event.repository !== body.repository) throw Error('Invalid trace event');
    if (ids.has(event.event_id)) throw Error('Duplicate event identifier');
    ids.add(event.event_id);
  }
  const sanitized = sanitizeExport(body);
  sanitized.generated_at = body.generated_at;
  if (sanitized.records.some(r => !validateRecord(r)) || sanitized.events.some(e => !validateEvent(e))) throw Error('Sanitized projection violates contract');
  return sanitized;
}
export async function storeProjection(db, owner, namespace, projection) {
  if (projection.events.some(event=>event.activity?.kind==='codex_turn')) {
    throw Error('Codex turn observations require a canonical Task telemetry endpoint');
  }
  const payload = JSON.stringify(projection);
  // Compare-and-set by source generation time. Identical retry is idempotent;
  // equal timestamps with different bodies fail, never silently overwrite.
  const result = await db.prepare(`INSERT INTO private_projection(owner_id, namespace, generated_at, payload)
    SELECT ?, ?, ?, ? WHERE ? = 'live'
    OR EXISTS (SELECT 1 FROM private_projection WHERE owner_id = ? AND namespace = ?)
    OR (SELECT COUNT(*) FROM private_projection WHERE owner_id = ? AND namespace <> 'live') < ?
    ON CONFLICT(owner_id, namespace) DO UPDATE SET
    generated_at=excluded.generated_at, payload=excluded.payload
    WHERE excluded.generated_at > private_projection.generated_at
    OR (excluded.generated_at = private_projection.generated_at AND excluded.payload = private_projection.payload)`)
    .bind(owner, namespace, projection.generated_at, payload, namespace, owner, namespace, owner, MAX_VERIFICATION_NAMESPACES).run();
  return result.meta.changes === 1;
}
