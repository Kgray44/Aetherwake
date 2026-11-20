import { validateNewTask } from '../intake.mjs';

export const operationId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const priorities = ['low', 'normal', 'high', 'urgent'];
const transitions = {
  proposed: ['blocked', 'cancelled', 'superseded'],
  blocked: ['proposed', 'cancelled', 'superseded'],
};
const failure = (status, error) => ({ status, body: { error } });

export function proposalControl(row) {
  return { version: row.version, priority: row.priority, history: JSON.parse(row.receipts).map(({ digest, ...receipt }) => receipt) };
}

export async function changeProposal({ db, owner, namespace, id, action, validate }) {
  if (!action || !operationId.test(action.operation_id) || !Number.isSafeInteger(action.expected_version) ||
      action.expected_version < 1 || !['edit', 'transition'].includes(action.type)) {
    return failure(400, 'Invalid proposal operation');
  }
  const select = () => db.prepare(`
    SELECT record, version, priority, receipts FROM proposals
    WHERE owner_id = ? AND namespace = ? AND task_id = ? AND github_state IS NULL AND engine IS NULL
  `).bind(owner, namespace, id).first();
  const row = await select();
  if (!row) return failure(404, 'Private proposal not found');
  const task = JSON.parse(row.record);
  const receipts = JSON.parse(row.receipts);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(JSON.stringify(action)))), b => b.toString(16).padStart(2, '0')).join('');
  function replay(current) {
    const prior = current && JSON.parse(current.receipts).find(receipt => receipt.operation_id === action.operation_id);
    if (!prior) return null;
    return prior.digest === digest
      ? { status: 200, body: { task: JSON.parse(current.record), ...proposalControl(current) } }
      : failure(409, 'Operation ID already used for another request');
  }
  const previous = replay(row);
  if (previous) return previous;
  if (row.version !== action.expected_version) return failure(409, 'Proposal changed. Refresh before editing.');
  if (task.owner_acceptance !== 'not_reviewed') return failure(409, 'Proposal already has an owner decision');

  let updated = { ...task };
  let priority = row.priority;
  if (action.type === 'edit') {
    if (task.state !== 'proposed') return failure(409, 'Only proposed tasks can be edited');
    let fields;
    try { fields = validateNewTask(action.fields); }
    catch (cause) { return failure(400, cause.message); }
    priority = action.fields.priority;
    if (!priorities.includes(priority) || fields.ids.includes(id)) {
      return failure(400, 'Invalid priority or prerequisite');
    }
    const previousCriteria = [...task.acceptance.criteria];
    updated = {
      ...task,
      title: fields.title,
      objective: fields.objective,
      classification: { ...task.classification, primary: fields.primary },
      prerequisites: { task_ids: fields.ids, capabilities: fields.capabilities },
      ...(fields.requirements===undefined?{}:{requirements:fields.requirements}),
      ...(fields.deliverables===undefined?{}:{deliverables:fields.deliverables}),
      acceptance: { profile_id: fields.profile, criteria: fields.accept.map(({ description }) => {
        const index = previousCriteria.findIndex(criterion => criterion.description === description);
        return index < 0 ? { description, id: 'criterion-' + crypto.randomUUID() } : previousCriteria.splice(index, 1)[0];
      }) },
    };
  } else {
    const { state, reason, superseded_by: successor } = action;
    if (!transitions[task.state]?.includes(state)) return failure(409, 'Invalid proposal transition');
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) return failure(400, 'A transition reason is required');
    updated.state = state;
    if (state === 'superseded') {
      if (typeof successor !== 'string' || successor === id) return failure(400, 'Choose a different replacement proposal');
      const replacement = await db.prepare(`
        SELECT task_id FROM proposals WHERE owner_id = ? AND namespace = ? AND task_id = ?
          AND json_extract(record, '$.state') IN ('proposed', 'blocked')
      `).bind(owner, namespace, successor).first();
      if (!replacement) return failure(400, 'Replacement proposal is unavailable');
      updated.superseded_by = successor;
    }
  }
  if (!validate(updated)) return failure(400, 'Task did not match the engineering contract');
  const version = row.version + 1;
  const receipt = {
    operation_id: action.operation_id, digest, actor: 'authenticated-owner', target_kind: 'proposal', target_id: id,
    expected_version: row.version, version, type: action.type, status: 'applied', at: new Date().toISOString(),
    ...(action.type === 'edit' ? { fields:[
      ...['title','objective','classification','prerequisites','requirements','deliverables','acceptance'].filter(key =>
        JSON.stringify(task[key]) !== JSON.stringify(updated[key])),
      ...(priority!==row.priority?['priority']:[]),
    ] } : {}),
    ...(action.type === 'transition' ? { state: updated.state, reason: action.reason.trim() } : {}),
  };
  const history = JSON.stringify([...receipts.slice(-19), receipt]);
  // Bind the authorization and expected version to the same write as its receipt.
  const result = await db.prepare(`
    UPDATE proposals SET record = ?, version = ?, priority = ?, receipts = ?
    WHERE owner_id = ? AND namespace = ? AND task_id = ? AND version = ? AND github_state IS NULL AND engine IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM task_telemetry t
        WHERE t.owner_id = proposals.owner_id AND t.namespace = proposals.namespace AND t.task_id = proposals.task_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM private_projection p, json_each(p.payload, '$.records') r
        WHERE p.owner_id = proposals.owner_id AND p.namespace = proposals.namespace
          AND json_extract(r.value, '$.record_type') = 'task' AND json_extract(r.value, '$.id') = proposals.task_id
      )
      AND (? IS NULL OR EXISTS (
        SELECT 1 FROM proposals successor WHERE successor.owner_id = proposals.owner_id
          AND successor.namespace = proposals.namespace AND successor.task_id = ?
          AND json_extract(successor.record, '$.state') IN ('proposed', 'blocked')
      ))
  `).bind(JSON.stringify(updated), version, priority, history, owner, namespace, id, row.version,
    updated.superseded_by ?? null, updated.superseded_by ?? null).run();
  if (result.meta.changes !== 1) return replay(await select()) ??
    failure(409, 'Proposal, replacement, or local execution record changed. Refresh and check before retrying.');
  return { status: 200, body: { task: updated, ...proposalControl({ version, priority, receipts: history }) } };
}
