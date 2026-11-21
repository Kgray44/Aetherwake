import React, { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Activity, Archive, ArrowRight, CheckCircle2, Clock3, GitBranch, Link2, Pause, Play, RotateCcw, Square, XCircle } from 'lucide-react';
import {taskActivityHref} from './github-activity.mjs';
import { PrerequisiteChecks } from './task-workspace.jsx';
import { dependencyGraph } from './task-workspace.mjs';
import { StickySectionAside } from './sticky-section-aside.jsx';
import { useCardMotion } from './card-motion.jsx';
import { executionActions, reviewRevision, workerDispatchStatus } from './task-engine-client.mjs';

const actionLabels = {
  addendum:'Add owner instructions',
  recover_candidate:'Submit recovered candidate',
  continue_candidate:'Continue from candidate',
  configure_execution:'Edit execution settings', admit: 'Admit to Codex queue', pause: 'Pause', cancel: 'Cancel Task', resume: 'Resume', retry: 'Retry',
  archive:'Archive Task', reopen:'Reopen with feedback', accept: 'Record owner acceptance', reject: 'Reject candidate', supersede: 'Supersede', associate: 'Attach evidence link',
};
const actionIcons = { addendum:Link2, recover_candidate:CheckCircle2, continue_candidate:Play, configure_execution:Clock3, admit:Play, pause:Pause, resume:Play, retry:RotateCcw, accept:CheckCircle2,
  archive:Archive, reopen:RotateCcw, reject:XCircle, cancel:Square, supersede:GitBranch, associate:Link2, satisfy:CheckCircle2 };
const actionHints = { addendum:'Send instructions at an attempt checkpoint', recover_candidate:'Send the checked revision for owner review', configure_execution:'Change the schedule and limits before the next attempt', admit:'Choose a start time and prerequisite policy', pause:'Suspend the queue or request a worker pause',
  resume:'Return the Task to the queue', retry:'Record what changed before retrying', accept:'Review evidence at the candidate revision',
  continue_candidate:'Resume the original conversation from this candidate',
  reject:'Record why the candidate needs work', cancel:'Withdraw the Task or ask the worker to stop',
  archive:'Move the Task out of active views', reopen:'Queue a new attempt with owner feedback', supersede:'Point to the replacement Task', associate:'Link a PR, CI run, or artifact', satisfy:'Record an observed capability' };
const featuredActions = ['admit','resume','accept','reopen','recover_candidate','retry','pause'];

const humanize = value => String(value ?? 'unavailable').replaceAll('_', ' ');
const stamp = value => value ? new Date(value).toLocaleString() : 'Unavailable';

function localStart(value) {
  if(!Number.isFinite(value)) return '';
  const date=new Date(value);
  return new Date(value-date.getTimezoneOffset()*60_000).toISOString().slice(0,16);
}

export function TaskEngineControls({ detail, workerAccess, workerDispatch, publishedIntake, onCommand, tasks, Status }) {
  const reduce = useReducedMotion();
  const interaction = useCardMotion(true);
  const [action, setAction] = useState('');
  const [actionVersion, setActionVersion] = useState(detail.version);
  const [actionAttempt, setActionAttempt] = useState(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const formHeading = useRef(null);
  useEffect(() => { if (action) formHeading.current?.focus(); }, [action]);
  const { task, lifecycle, attempts } = detail;
  const options = executionActions(detail, { publishedIntake });
  if (!publishedIntake) {
    if (['proposed', 'blocked', 'paused', 'failed'].includes(lifecycle.stored_state)) options.push('supersede');
    options.push('associate');
  }
  const featuredAction = featuredActions.find(key=>options.includes(key));
  const candidate = attempts.at(-1);
  const candidateRevision = reviewRevision(candidate);
  const blocker = lifecycle.blockers ?? [];
  const unsatisfiedCapabilities = blocker.filter(item => item.type === 'capability');

  async function send(change) {
    if (pending.current) return;
    if (action && (action === 'addendum'
      ? (candidate?.id ?? null) !== actionAttempt || !lifecycle.can_addendum
      : detail.version !== actionVersion)) {
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
    if (['pause', 'resume'].includes(type) && !action) {
      void send({ type });
    } else {
      setAction(type);
      setActionVersion(detail.version);
      setActionAttempt(candidate?.id ?? null);
      setError('');
      setResult('');
    }
  }

  function submit(event) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const change = { type: action };
    try {
      if (['admit','configure_execution'].includes(action)) {
        const date=fields.get('start_at');
        const earlier=action==='configure_execution'?localStart(lifecycle.start_at):'';
        if(date!==earlier) change.start_at=date?new Date(date).toISOString():null;
        change.cancel_with_dependency=fields.has('cancel_with_dependency');
        if(fields.has('max_attempt_minutes')) change.max_attempt_minutes=Number(fields.get('max_attempt_minutes'));
      }
      if (action==='admit') {
        change.executor='codex';
        change.prerequisites=fields.getAll('verified_capability');
      }
      if (action === 'retry') change.changed_assumption = fields.get('reason');
      if (action === 'addendum') {
        change.text = fields.get('text');
        change.target = fields.get('target');
        if (change.target === 'active_attempt') change.attempt_id = actionAttempt;
      }
      if (action === 'recover_candidate') {
        change.attempt_id = candidate.id;
        change.revision = fields.get('revision');
        change.reason = fields.get('reason');
      }
      if (action === 'reopen') change.feedback = fields.get('feedback');
      if (action === 'continue_candidate') {
        change.attempt_id = actionAttempt;
        change.revision = candidateRevision;
        change.feedback = fields.get('feedback');
      }
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
    <div className="task-command-shell">
      <div className="task-command-context">
        <header className="task-command-hero"><span className="task-command-signal"><Activity size={19} aria-hidden="true"/></span>
          <div><Status value={lifecycle.recovered_candidate&&lifecycle.state==='verifying'?'candidate_recovered':lifecycle.state}/><p>Stored state {humanize(lifecycle.stored_state)} · Version {detail.version}</p></div></header>
        <dl className="task-command-facts">
          <div><dt>Executor</dt><dd>{lifecycle.executor ?? 'Unassigned'}</dd></div>
          {workerAccess&&<div><dt>Codex worker access</dt><dd>{workerAccess==='not_configured'?'Not configured':'Configured'}</dd></div>}
          {lifecycle.executor && <div><dt>Worker status</dt><dd>{workerDispatchStatus(workerDispatch, workerAccess).label}
            {workerDispatch?.last_seen_at && <><br/><time dateTime={workerDispatch.last_seen_at}>{stamp(workerDispatch.last_seen_at)}</time></>}</dd></div>}
          {lifecycle.executor && workerDispatch?.last_error && <div><dt>Last worker error</dt>
            <dd>{humanize(workerDispatch.last_error.state)} · <time dateTime={workerDispatch.last_error.at}>{stamp(workerDispatch.last_error.at)}</time></dd></div>}
          <div><dt>Specification</dt><dd>v{lifecycle.spec_version ?? 1}
            {candidate?.spec_version && <> · Last claim v{candidate.spec_version}</>}
            {lifecycle.pending_spec && <> · Next attempt v{lifecycle.pending_spec.version}</>}</dd></div>
          <div><dt><Clock3 size={14} aria-hidden="true"/>Start time</dt><dd>{lifecycle.start_at == null ? 'Unscheduled' : stamp(lifecycle.start_at)}</dd></div>
          <div><dt>Priority</dt><dd>{detail.priority}</dd></div>
          <div><dt>Attempt time limit</dt><dd>{lifecycle.max_attempt_minutes == null ? 'Unreported' : lifecycle.max_attempt_minutes+' min'}</dd></div>
          <div><dt>Dependency cancellation</dt><dd>{lifecycle.cancel_with_dependency ? 'Enabled' : 'Off'}</dd></div>
        </dl>
        {workerAccess==='not_configured'&&['proposed','admitted','queued','ready','scheduled','blocked','paused'].includes(lifecycle.state)&&
          <p className="notice">A Codex worker can claim a queued Task once worker access is configured.</p>}
        {blocker.length > 0 && <section className="task-command-blockers"><h3>Blocking execution</h3><ul aria-label="Admission blockers">{blocker.map(item => <li key={item.type + ':' + item.id}>
          {tasks.find(other => other.id === item.id)?.title ?? item.id} · {humanize(item.state)}
        </li>)}</ul></section>}
        {!!lifecycle.addenda?.length && <section aria-label="Owner addendum delivery">
          <h3>Owner addenda</h3>
          <ul className="task-links">{[...lifecycle.addenda].reverse().map(item => <li key={item.id}>
            <div><Status value={item.status}/> <span>Added at v{item.version} · {stamp(item.accepted_at)}</span></div>
            <details><summary>{item.attempt_id ? 'Attempt ' + item.attempt_id : 'Next attempt'}</summary>
              <p>{item.text}</p>
              {item.spec_version != null && <p>Claimed specification v{item.spec_version}</p>}
              {item.session_id && <p>Codex thread <code>{item.session_id}</code></p>}
              {item.delivered_at && <p>Delivered {stamp(item.delivered_at)}</p>}
              {item.acknowledged_at && <p>Executor completed the addendum turn {stamp(item.acknowledged_at)}</p>}
              {item.reason && <p>{item.reason}</p>}
            </details>
          </li>)}</ul>
        </section>}
      </div>
      <StickySectionAside className="task-command-deck">
        <nav aria-label="Task actions" className="task-command-actions">
          {[...options, ...(unsatisfiedCapabilities.length ? ['satisfy'] : [])]
            .sort((a,b)=> Number(featuredAction===b)-Number(featuredAction===a))
            .map(type => {
              const Icon=actionIcons[type];
              const title=actionLabels[type] ?? 'Attest capability';
              const featured=featuredAction===type;
              return <motion.button key={type} type="button" aria-label={title} aria-pressed={action===type}
                className={'task-command-button'+(featured?' featured':'')+(type==='cancel'?' destructive':'')}
                {...(!busy ? interaction : {})} disabled={busy} onClick={()=>choose(type)}>
                <Icon size={17} aria-hidden="true"/><span><strong>{title}</strong><small>{actionHints[type]}</small></span><ArrowRight size={14} aria-hidden="true"/>
              </motion.button>;
            })}
        </nav>
    {action && <motion.form key={action} aria-label={actionLabels[action] ?? 'Attest capability'}
      className="form task-command-form" onSubmit={submit} initial={reduce ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}>
      <h3 ref={formHeading} tabIndex={-1}>{actionLabels[action] ?? 'Attest capability'}</h3>
      {['admit','configure_execution'].includes(action)&&<>
        <p>{action==='admit'
          ? workerAccess==='not_configured'
            ? 'You can queue this Task now. Execution also requires Codex worker access.'
            : 'A configured Codex worker can claim this Task once its schedule and prerequisites are satisfied.'
          : 'Changes apply to the next attempt. A paused Task still needs to be resumed.'}</p>
        <label>Start at (local time, optional)<input name="start_at" type="datetime-local"
          defaultValue={action==='configure_execution'?localStart(lifecycle.start_at):''}/>
          <small>Leave blank to make the Task eligible immediately once prerequisites are satisfied.</small>
        </label>
        {lifecycle.max_attempt_minutes!=null&&<label>Maximum minutes per attempt
          <input name="max_attempt_minutes" type="number" min={1} max={30} step={1} defaultValue={lifecycle.max_attempt_minutes} required/>
          <small>The worker stops at this limit. Time spent in the queue is excluded.</small>
        </label>}
        <label className="task-check"><input name="cancel_with_dependency" type="checkbox"
          defaultChecked={action==='configure_execution'&&lifecycle.cancel_with_dependency}/> Cancel if a dependency is cancelled</label>
        {action==='admit'&&<PrerequisiteChecks graph={dependencyGraph(task,tasks,{lifecycle})} Status={Status}/>}
        {action==='admit'&&task.prerequisites.capabilities.map(capability => <label className="task-check" key={capability}>
          <input name="verified_capability" type="checkbox" value={capability}/> Attest {capability} on admission
        </label>)}
      </>}
      {action==='recover_candidate'&&<>
        <label>Recovered Git revision<input name="revision" required pattern="[a-f0-9]{40}"/></label>
        <label>How did you check the recovered candidate?<textarea name="reason" required maxLength={500}/></label>
      </>}
      {action==='addendum'&&<>
        <p>Instructions are appended to the Task history. The active attempt can receive them at its supported Codex turn boundary.</p>
        <label>Delivery target <select name="target" defaultValue={lifecycle.stored_state==='running'?'active_attempt':'next_attempt'}>
          {lifecycle.stored_state==='running'&&<option value="active_attempt">Current attempt</option>}
          <option value="next_attempt">Next attempt</option>
        </select></label>
        <label>Supplemental instructions <textarea name="text" required maxLength={2000}/></label>
      </>}
      {['retry', 'reject'].includes(action) && <label>{action === 'retry' ? 'Changed assumption' : 'Review reason'}
        <textarea name="reason" required maxLength={500}/>
      </label>}
      {action === 'archive' && <p>Move this Task to Archived. Its timeline, attempts, and evidence remain available there.</p>}
      {action === 'reopen' && <><p>Queue a new Codex attempt from the last accepted revision. Previous approval remains in the timeline.</p>
        <label>Feedback for the next attempt<textarea name="feedback" required maxLength={2000}/></label></>}
      {action === 'continue_candidate' && <><p>Queue a new attempt in the saved Codex conversation from <code>{candidateRevision}</code>. The candidate remains in the Task history for reference.</p>
        <label>Remaining work<textarea name="feedback" required maxLength={2000}/></label></>}
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
        <label>Reference type <select name="reference_kind">{['branch', 'commit', 'pull_request', 'review', 'ci_run', 'test', 'artifact', 'investigation', 'deployment', 'executor_session']
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
      </StickySectionAside>
    </div>
  </>;
}

function EvidenceReference({ uri, label, revision }) {
  const internal = taskActivityHref(uri);
  const href = internal ?? safeLink(uri);
  return <>
    {href ? <a href={href} target={internal?undefined:"_blank"} rel={internal?undefined:"noreferrer"}>{label}</a> : <strong>{label}</strong>}
    {revision && <small>Revision <code>{revision}</code></small>}
  </>;
}

export function TaskDeliveryEvidence({ task, lifecycle }) {
  const criteria = new Map(task.acceptance.criteria.map(criterion => [criterion.id, criterion.description]));
  const links = lifecycle.links ?? [];
  const reviewed = lifecycle.evidence ?? [];
  return <section className="proposal-disclosure" aria-label="Execution and delivery evidence">
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

export function TaskTokenAccounting({ rows }) {
  if (!rows.length) return <p>No observed token accounting is available for this Task.</p>;
  const display = value => value == null ? 'Unavailable' : value.toLocaleString();
  return <div className="analytics-table">
    <table>
      <caption>Observed Codex token receipts by attempt.</caption>
      <thead><tr><th scope="col">Attempt</th><th scope="col">Model</th><th scope="col">Input</th><th scope="col">Cached</th>
        <th scope="col">Output</th><th scope="col">Total</th><th scope="col">Coverage</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.attemptId + ':' + row.revision}>
        <th scope="row">{row.attemptNumber ?? row.attemptId}<small className="row-meta">{row.revision.slice(0, 10)}</small></th>
        <td>{[row.provider, row.model].filter(Boolean).join(' / ') || 'Unavailable'}
          {row.identitySource==='codex_app_server_thread_start'&&<small className="row-meta">Observed at App Server thread start</small>}</td>
        <td>{display(row.observed.inputTokens)}</td><td>{display(row.observed.cachedInputTokens)}</td>
        <td>{display(row.observed.outputTokens)}</td><td>{display(row.observed.totalTokens)}</td><td>{row.coverage}{row.source && <small className="row-meta">{row.source}</small>}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}
