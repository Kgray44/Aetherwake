export const telemetryTaskId = /^[A-Za-z0-9_.:-]{1,160}$/;
export const recordKey = record => record.record_type + ':' + record.id;
export const eventKey = event => event.event_id;

function index(items, key) {
  const entries = new Map();
  for (const item of items) {
    const id = key(item);
    if (!id || entries.has(id)) throw Error('Duplicate or missing telemetry identity');
    entries.set(id, item);
  }
  return entries;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

export function withIndependentActivity(snapshot, baseline, {activityOnly = false} = {}) {
  const remote = baseline?.projection;
  if (!remote) return snapshot;
  const ids = new Set(snapshot.events.map(eventKey));
  const retained = remote.events.filter(event=>!ids.has(eventKey(event)) &&
    (activityOnly || (event.kind==='engineering_activity'&&!event.attempt_id)));
  // An independent journal supplies receipts only. A full journal still has
  // to reproduce the formal records and attempt-bound events it synchronized.
  return { ...snapshot, records: activityOnly ? remote.records : snapshot.records, events: [...snapshot.events, ...retained] };
}

export function telemetryDelta(snapshot, baseline) {
  const before = baseline?.projection;
  function diff(current, previous, key, immutable) {
    const available = index(current, key);
    const existing = index(previous ?? [], key);
    for (const [id, old] of existing) {
      if (!available.has(id)) throw Error('Local journal is missing previously synchronized data');
      if (immutable && !same(available.get(id), old)) throw Error('Local journal rewrites a synchronized trace event');
    }
    return current.filter(item => !same(item, existing.get(key(item))));
  }
  const records = diff(snapshot.records, before?.records, recordKey, false);
  const events = diff(snapshot.events, before?.events, eventKey, true);
  if (!events.length && !records.length) return null;
  return { base: baseline?.digest ?? null, generated_at: snapshot.generated_at, records, events };
}

export function applyTelemetryDelta(current, change) {
  const records = index(current?.records ?? [], recordKey);
  const events = index(current?.events ?? [], eventKey);
  for (const [id, record] of index(change.records, recordKey)) {
    const old = records.get(id);
    if (old && !same(old, record)) {
      if (!['task', 'attempt'].includes(record.record_type) ||
          record.created_at !== old.created_at || record.task_id !== old.task_id ||
          (record.record_type === 'attempt' && (record.attempt_number !== old.attempt_number ||
            record.revision !== old.revision || record.started_at !== old.started_at ||
            (['succeeded', 'failed', 'cancelled'].includes(old.state) && old.state !== record.state)))) {
        throw Error('Telemetry update changes existing record identity or terminal outcome');
      }
    }
    records.set(id, record);
  }
  for (const [id, event] of index(change.events, eventKey)) {
    if (events.has(id) && !same(events.get(id), event)) throw Error('Telemetry event identity conflict');
    events.set(id, event);
  }
  return {
    export_version: 1, repository: 'Kgray44/Aetherwake', authority: 'local-task-records',
    generated_at: change.generated_at, records: [...records.values()], events: [...events.values()],
  };
}
