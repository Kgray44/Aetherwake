import React, { useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { executionActions, reviewRevision, taskTokenRows } from './task-engine-client.mjs';

const actionLabels = {
  admit: 'Admit to Codex queue', pause: 'Pause', cancel: 'Cancel Task', resume: 'Resume', retry: 'Retry',
  accept: 'Record owner acceptance', reject: 'Reject candidate', supersede: 'Supersede', associate: 'Attach evidence link',
};
const humanize = value => String(value ?? 'unavailable').replaceAll('_', ' ');
const stamp = value => value ? new Date(value).toLocaleString() : 'Unavailable';

export function TaskEngineControls({ detail, publishedIntake, onCommand, tasks, Status }) {
  const reduce = useReducedMotion();
  const [action, setAction] = useState('');
  const [actionVersion, setActionVersion] = useState(detail.version);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const { task, lifecycle, attempts, events } = detail;
  const options = executionActions(detail, { publishedIntake });
  if (!publishedIntake) {
    if (['proposed', 'blocked', 'paused', 'failed'].includes(lifecycle.stored_state)) options.push('supersede');
    options.push('associate');
  }
  const candidate = attempts.at(-1);
  const candidateRevision = reviewRevision(candidate);
  const blocker = lifecycle.blockers ?? [];
  const unsatisfiedCapabilities = blocker.filter(item => item.type === 'capability');

  async function send(change) {
    if (pending.current) return;
    if (action && detail.version !== actionVersion) {
      setError('The Task changed. Reopen the action to review the latest state.');
      return;
    }
    pending.current = true;
    setBusy(true);
    setError('');
    setResult('');
    try {
      const next = await onCommand(change);
      setAction('');
      setResult('Recorded at version ' + next.version + ' · ' + humanize(next.lifecycle.state));
    } catch (cause) {
      setError(cause.message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function choose(type) {
    if (['pause', 'resume', 'satisfy'].includes(type) && !action) {
      void send({ type });
    } else {
      setAction(type);
      setActionVersion(detail.version);
      setError('');
      setResult('');
    }
  }

  function submit(event) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const change = { type: action };
    try {
      if (action === 'admit') {
        change.executor = 'codex';
        change.cancel_with_dependency = fields.has('cancel_with_dependency');
        change.prerequisites = fields.getAll('verified_capability');
        const date = fields.get('start_at');
        if (date) change.start_at = new Date(date).toISOString();
      }
      if (action === 'retry') change.changed_assumption = fields.get('reason');
      if (action === 'reject') change.reason = fields.get('reason');
      if (action === 'accept') change.evidence = task.acceptance.criteria.map(criterion => ({
        criterion_id: criterion.id, uri: fields.get(criterion.id), revision: candidateRevision,
      }));
      if (action === 'supersede') change.successor = fields.get('successor');
      if (action === 'satisfy') change.prerequisite = fields.get('prerequisite');
      if (action === 'associate') change.reference = {
        kind: fields.get('reference_kind'), uri: fields.get('uri'), revision: fields.get('revision'),
      };
      void send(change);
    } catch (cause) {
      setError(cause.message);
    }
  }

  return <>
    <div className="task-result-bar"><Status value={lifecycle.state}/>
      <span>Stored state {humanize(lifecycle.stored_state)} · Version {detail.version}</span>
    </div>
    <dl className="github-facts">
      <div><dt>Executor</dt><dd>{lifecycle.executor ?? 'Unassigned'}</dd></div>
      <div><dt>Start time</dt><dd>{lifecycle.start_at == null ? 'Unscheduled' : stamp(lifecycle.start_at)}</dd></div>
      <div><dt>Priority</dt><dd>{detail.priority}</dd></div>
      <div><dt>Dependency cancellation</dt><dd>{lifecycle.cancel_with_dependency ? 'Enabled' : 'Off'}</dd></div>
    </dl>
    {blocker.length > 0 && <ul aria-label="Admission blockers">{blocker.map(item => <li key={item.type + ':' + item.id}>
      {tasks.find(other => other.id === item.id)?.title ?? item.id} · {humanize(item.state)}
    </li>)}</ul>}
    <div className="form-actions">
      {options.map(type => <button key={type} type="button" className={type === 'admit' ? 'primary-button' : 'quiet-button'}
        aria-pressed={action === type} disabled={busy} onClick={() => choose(type)}>{actionLabels[type]}</button>)}
      {unsatisfiedCapabilities.length > 0 && <button type="button" className="quiet-button" disabled={busy}
        onClick={() => { setAction('satisfy'); setActionVersion(detail.version); setError(''); }}>
        Attest capability
      </button>}
    </div>
    {action && <motion.form key={action} aria-label={actionLabels[action] ?? 'Attest capability'}
      className="form proposal-disclosure" onSubmit={submit} initial={reduce ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}>
      <h3>{actionLabels[action] ?? 'Attest capability'}</h3>
      {action === 'admit' && <>
        <p>Admission allows a configured Codex worker to claim this Task once its schedule and prerequisites are satisfied.</p>
        <label>Start at (local time, optional)<input name="start_at" type="datetime-local"/></label>
        <label className="task-check"><input name="cancel_with_dependency" type="checkbox"/> Cancel if a dependency is cancelled</label>
        {task.prerequisites.capabilities.map(capability => <label className="task-check" key={capability}>
          <input name="verified_capability" type="checkbox" value={capability}/> Verify {capability}
        </label>)}
      </>}
      {['retry', 'reject'].includes(action) && <label>{action === 'retry' ? 'Changed assumption' : 'Review reason'}
        <textarea name="reason" required maxLength={500}/>
      </label>}
      {action === 'cancel' && <p>Confirm cancellation. If an executor is active, the request waits for it to confirm that it stopped.</p>}
      {action === 'supersede' && <label>Replacement Task <select name="successor" required>
        <option value="">Choose a Task</option>
        {tasks.filter(other => other.id !== task.id).map(other => <option key={other.id} value={other.id}>{other.title}</option>)}
      </select></label>}
      {action === 'satisfy' && <label>Observed capability <select name="prerequisite" required>
        {unsatisfiedCapabilities.map(item => <option key={item.id} value={item.id}>{item.id}</option>)}
      </select></label>}
      {action === 'accept' && <>
        <p>Record an owner review based on the linked evidence at revision {candidateRevision ?? 'unavailable'}.</p>
        {task.acceptance.criteria.map(criterion => <label key={criterion.id}>{criterion.description}
          <input name={criterion.id} type="url" placeholder="https://…" required maxLength={1000}/>
        </label>)}
      </>}
      {action === 'associate' && <>
        <label>Reference type <select name="reference_kind">{['branch', 'commit', 'pull_request', 'review', 'ci_run', 'test', 'artifact', 'investigation']
          .map(kind => <option key={kind} value={kind}>{humanize(kind)}</option>)}</select></label>
        <label>Evidence URL <input name="uri" type="url" required maxLength={1000}/></label>
        <label>Revision <input name="revision" pattern="[a-f0-9]{40}" defaultValue={candidateRevision ?? task.revision} required/></label>
      </>}
      <div className="form-actions">
        <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Submitting…' : 'Confirm'}</button>
        <button type="button" className="quiet-button" disabled={busy} onClick={() => setAction('')}>Close</button>
      </div>
    </motion.form>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {result && <p role="status">{result}</p>}
    <details className="proposal-disclosure"><summary>Task audit history</summary>
      {events.length ? <ol>{[...events].reverse().map((event, index) => <li key={event.operation_id ?? index}>
        {stamp(event.at)} · {humanize(event.kind ?? event.type)} · {humanize(event.state)}
      </li>)}</ol> : <p>No Task operations recorded.</p>}
    </details>
    <TaskDeliveryEvidence task={task} lifecycle={lifecycle} attempts={attempts} Status={Status}/>
  </>;
}

function EvidenceReference({ uri, label, revision }) {
  const href = safeLink(uri);
  return <>
    {href ? <a href={href} target="_blank" rel="noreferrer">{label}</a> : <strong>{label}</strong>}
    {revision && <small>Revision <code>{revision}</code></small>}
  </>;
}

function TaskDeliveryEvidence({ task, lifecycle, attempts, Status }) {
  const criteria = new Map(task.acceptance.criteria.map(criterion => [criterion.id, criterion.description]));
  const links = lifecycle.links ?? [];
  const reviewed = lifecycle.evidence ?? [];
  return <section className="proposal-disclosure" aria-label="Execution and delivery evidence">
    <h3>Execution attempts</h3>
    {attempts.length ? <ol className="task-links">{[...attempts].reverse().map(attempt =>
      <li key={attempt.id}>
        <strong>Attempt {attempt.attempt_number}</strong>{' '}<Status value={attempt.state}/>
        {attempt.started_at && <small>Started {stamp(attempt.started_at)}</small>}
        {attempt.finished_at && <small>Finished {stamp(attempt.finished_at)}</small>}
        {attempt.branch && <small>Branch <code>{attempt.branch}</code></small>}
        <small>Base revision <code>{attempt.revision}</code></small>
        {attempt.candidate_revision && <small>Candidate revision <code>{attempt.candidate_revision}</code></small>}
        {attempt.failure && <p>{attempt.failure}</p>}
      </li>)}</ol> : <p>No engine attempts recorded.</p>}
    <h3>Associated delivery evidence</h3>
    {links.length ? <ul className="task-links">{links.map((link, index) =>
      <li key={index}><EvidenceReference uri={link.uri} label={humanize(link.kind)} revision={link.revision}/></li>
    )}</ul> : <p>No delivery references attached.</p>}
    <h3>Owner-reviewed criteria</h3>
    {reviewed.length ? <ul className="task-links">{reviewed.map(item =>
      <li key={item.criterion_id}><EvidenceReference uri={item.uri}
        label={criteria.get(item.criterion_id) ?? item.criterion_id} revision={item.revision}/></li>
    )}</ul> : <p>No owner review evidence recorded.</p>}
  </section>;
}

function safeLink(uri) {
  try {
    const url = new URL(uri);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search ? url.href : undefined;
  } catch { return undefined; }
}

export function TaskTokenAccounting({ accounting, taskId }) {
  const rows = taskTokenRows(accounting, taskId);
  if (!rows.length) return <p>No observed token accounting is available for this Task.</p>;
  const display = value => value == null ? 'Unavailable' : value.toLocaleString();
  return <div className="analytics-table">
    <table>
      <caption>Observed Codex turn receipts by attempt. Costs are unavailable from this source.</caption>
      <thead><tr><th scope="col">Attempt</th><th scope="col">Model</th><th scope="col">Input</th><th scope="col">Cached</th>
        <th scope="col">Output</th><th scope="col">Total</th><th scope="col">Coverage</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.attemptId + ':' + row.revision}>
        <th scope="row">{row.attemptNumber ?? row.attemptId}<small className="row-meta">{row.revision.slice(0, 10)}</small></th>
        <td>{[row.provider, row.model].filter(Boolean).join(' / ') || 'Unavailable'}</td>
        <td>{display(row.observed.inputTokens)}</td><td>{display(row.observed.cachedInputTokens)}</td>
        <td>{display(row.observed.outputTokens)}</td><td>{display(row.observed.totalTokens)}</td><td>{row.coverage}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}
