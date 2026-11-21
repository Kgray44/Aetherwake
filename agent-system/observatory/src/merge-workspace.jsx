import { useEffect, useRef, useState } from 'react';
import { GitMerge, GitPullRequest, RefreshCw } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { taskHref } from './task-workspace.mjs';
import { integrationLogFact, integrationWorkflowTiming } from './integration-analytics.mjs';
import { codexThreadHref } from './task-engine-client.mjs';

const endpoint = '/api/integrations/v1';
const empty = { access: {}, runs: [], loading: true };
const labels = {
  awaiting_pr: 'Awaiting pull request', checking: 'Checking', blocked: 'Blocked', repairing: 'Repairing',
  merge_ready: 'Merge ready', merged: 'Merged into main', deployed: 'Deployed',
};

async function integrationRequest(headers, search = '', body) {
  const response = await fetch(endpoint + search, {
    cache: 'no-store', credentials: 'same-origin',
    ...(body ? { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) } : { headers }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Integration request failed');
  return data;
}

export function useIntegrationRuns(headers, enabled, taskId) {
  const [data, setData] = useState(empty);
  const [generation, setGeneration] = useState(0);
  const verification = headers?.['x-observatory-verification'];
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const scope = verification ? { 'x-observatory-verification': verification } : {};
    setData(previous => ({ ...previous, loading: true, error: null, scope: taskId }));
    integrationRequest(scope, taskId ? '?task_id=' + encodeURIComponent(taskId) : '').then(
      result => { if (active) setData({ ...result, loading: false, scope: taskId }); },
      error => { if (active) setData({ ...empty, loading: false, error: error.message, scope: taskId }); },
    );
    return () => { active = false; };
  }, [verification, enabled, taskId, generation]);
  return { ...(enabled && data.scope === taskId ? data : empty), reload: () => setGeneration(value => value + 1) };
}

export function IntegrationTaskStatus({ runs, loading, error, attemptId, taskId }) {
  const run = runs.find(item => item.task?.attempt_id === attemptId);
  return <div className="notice" role="status">
    <GitMerge size={16} aria-hidden="true"/>
    <strong>{loading ? 'Loading merge status' : error ? 'Merge status unavailable' : labels[run?.state] ?? 'Merge not requested'}</strong>
    {run?.evidence?.merged_sha && <code className="integration-sha">{run.evidence.merged_sha}</code>}
    <a href={'#merge?task=' + encodeURIComponent(taskId)}>Open Merge Workspace</a>
  </div>;
}

function Revisions({ run }) {
  return <dl className="integration-revisions">
    {run.original_head_sha && <div><dt>Original head</dt><dd><code>{run.original_head_sha}</code></dd></div>}
    <div><dt>Source head</dt><dd><code>{run.head_sha}</code></dd></div>
    {run.evidence?.observed_head && run.evidence.observed_head !== run.head_sha &&
      <div><dt>Current PR head</dt><dd><code>{run.evidence.observed_head}</code></dd></div>}
    {run.task?.parent_sha && <div><dt>Candidate parent</dt><dd><code>{run.task.parent_sha}</code></dd></div>}
    <div><dt>Target main</dt><dd><code>{run.evidence?.base_sha ?? 'Awaiting GitHub evidence'}</code></dd></div>
    {run.evidence?.merged_sha && <div><dt>Verified merge</dt><dd><code>{run.evidence.merged_sha}</code></dd></div>}
  </dl>;
}

export function MergeWorkspace({ headers, acceptedTasks, pulls, initialTask, demo }) {
  const [mode, setMode] = useState(initialTask ? 'task' : 'pr');
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState(false);
  const observation = useRef({ id: null, polls: 0 });
  const reduce = useReducedMotion();
  const { runs, access, loading, error, reload } = useIntegrationRuns(headers, !demo);
  const verification = headers?.['x-observatory-verification'];
  useEffect(() => {
    if (!selected) return;
    let active = true;
    const scope = verification ? { 'x-observatory-verification': verification } : {};
    integrationRequest(scope, '?id=' + encodeURIComponent(selected)).then(
      result => { if (active) setDetail(result); },
      cause => { if (active) setMessage(cause.message); },
    );
    return () => { active = false; };
  }, [selected, verification, runs]);
  const run = detail?.run.id === selected ? detail.run : runs.find(item => item.id === selected);
  const transientJobs = run?.evidence?.jobs?.filter(job => job.infrastructure) ?? [];
  const sourceRepair = run?.source_repairs?.at(-1);
  const sourceActive = ['queued','claimed','running','awaiting_review'].includes(sourceRepair?.status);
  const autoCI = run?.policy.auto_ci_reruns;
  const privateOnlyPoll = sourceActive || run?.policy.auto_source_repair?.status === 'armed' ||
    autoCI?.status === 'armed' ||
    ['queued','claimed','sending'].includes(run?.transfer?.status);
  const { id: activeId, version: activeVersion, state: activeState, pr_number: activePull } = run ?? {};
  useEffect(() => {
    if (!activeId || demo || busy || (!privateOnlyPoll && (!activePull || !['checking', 'repairing'].includes(activeState)))) return;
    if (observation.current.id !== activeId) observation.current = { id: activeId, polls: 0 };
    if (observation.current.polls >= 8) return;
    let current = true;
    const timeout = window.setTimeout(async () => {
      try {
        observation.current.polls += 1;
        const scope = verification ? { 'x-observatory-verification': verification } : {};
        const result = privateOnlyPoll ? await integrationRequest(scope, '?id=' + encodeURIComponent(activeId)) :
          await integrationRequest(scope, '', { op: 'refresh', id: activeId,
            expected_version: activeVersion, operation_id: crypto.randomUUID() });
        if (current) setDetail(previous => ({ run: result.run, events: result.events ?? previous?.events ?? [] }));
      } catch (cause) {
        if (current) setMessage(cause.message);
      }
    }, 20_000);
    return () => { current = false; window.clearTimeout(timeout); };
  }, [activeId, activeVersion, activeState, activePull, verification, demo, busy, privateOnlyPoll, detail]);

  async function act(body) {
    setBusy(true);
    setMessage('');
    try {
      const result = await integrationRequest(headers, '', { operation_id: crypto.randomUUID(), ...body });
      setConfirm(false);
      setSelected(result.run.id);
      setDetail({ run: result.run, events: [] });
      reload();
    } catch (cause) {
      setMessage(cause.message);
      reload();
    } finally {
      setBusy(false);
    }
  }
  const change = (op, fields = {}) => act({ op, id: run.id, expected_version: run.version, ...fields });
  if (demo) return <p className="notice">Switch to Live to view integration evidence.</p>;
  if (error) return <p className="notice" role="alert">{error}</p>;
  return <div className="integration-workspace">
    <section className="panel integration-intake" aria-labelledby="integration-start-title">
      <h2 id="integration-start-title">Start integration</h2>
      <div className="integration-actions" role="group" aria-label="Integration source">
        <button type="button" className="quiet-button" aria-pressed={mode === 'pr'} onClick={() => setMode('pr')}>
          <GitPullRequest size={16} aria-hidden="true"/> Merge PR
        </button>
        <button type="button" className="quiet-button" aria-pressed={mode === 'task'} onClick={() => setMode('task')}>
          <GitMerge size={16} aria-hidden="true"/> Integrate Task
        </button>
      </div>
      <form key={mode} onSubmit={event => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const repair_limit = Number(fields.get('repair_limit'));
        act(mode === 'task' ? { op: 'start', task_id: fields.get('task'), repair_limit } :
          { op: 'start', pr_number: Number(fields.get('pr')), head_sha: fields.get('head').trim(), repair_limit });
      }}>
        {mode === 'task' ? <label>Accepted Task<select name="task" required defaultValue={initialTask ?? ''}>
          <option value="">Select a Task</option>
          {acceptedTasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}
        </select></label> : <>
          <label>Pull request number<input name="pr" inputMode="numeric" pattern="[1-9][0-9]*" list="integration-pulls" required/></label>
          <datalist id="integration-pulls">{pulls.map(pr => <option key={pr.number} value={pr.number} label={pr.title}/>)}</datalist>
          <label>Reviewed head SHA<input name="head" pattern="[0-9a-f]{40}" spellCheck={false} autoComplete="off" required/></label>
        </>}
        <label>Integration repair limit<select name="repair_limit" defaultValue="3">
          {[1, 2, 3, 4, 5].map(limit => <option key={limit} value={limit}>{limit}</option>)}
        </select></label>
        <button className="primary-button" disabled={busy || loading}>Inspect source</button>
      </form>
    </section>
    <section className="panel integration-runs" aria-labelledby="integration-runs-title">
      <h2 id="integration-runs-title">Integration runs</h2>
      {loading && <p role="status">Loading integration runs…</p>}
      {!loading && !runs.length && <p className="muted">No integration runs recorded.</p>}
      <ul>{runs.map(item => <li key={item.id}><button className="quiet-button" aria-pressed={selected === item.id} onClick={() => {
        setConfirm(false);
        setSelected(item.id);
      }}>
        {item.pr_number ? 'PR #' + item.pr_number : 'Task candidate ' + item.head_sha.slice(0, 8)}
        <span>{labels[item.id === run?.id ? run.state : item.state]}</span>
      </button></li>)}</ul>
    </section>
    <div role="status" aria-live="polite" className="integration-message">{message}</div>
    {run && <motion.section key={run.id} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.18 }} className="panel integration-details" aria-labelledby="integration-detail-title">
      <div className="integration-heading"><h2 id="integration-detail-title">{labels[run.state]}</h2>
        <div className="integration-actions">
          {run.task && <a href={taskHref(run.task.id)}>Implementation Task</a>}
          {run.evidence?.url && run.pr_number && <>
            <a href={run.evidence.url}>PR #{run.pr_number} on GitHub</a>
            <a href={run.evidence.url + '/files'}>View changes</a>
          </>}
        </div>
      </div>
      <Revisions run={run}/>
      {run.evidence?.policy_observed && <p>{run.evidence.queue_required ? 'GitHub merge queue required' : 'GitHub branch protections observed'}
        {run.evidence.required_approvals > 0 && ' · ' + run.evidence.required_approvals + ' required approvals'}</p>}
      {run.evidence?.detail && <p className="notice">{run.evidence.detail}</p>}
      {run.publication && <p>PR publication <strong>{run.publication.status}</strong></p>}
      {run.transfer && <p>Candidate transfer <strong>{run.transfer.status}</strong></p>}
      {run.policy.auto_source_repair && <p>Automatic source repair <strong>{run.policy.auto_source_repair.status}</strong>
        {run.policy.auto_source_repair.reason && <small> {run.policy.auto_source_repair.reason}</small>}</p>}
      {autoCI && <p>Automatic CI reruns <strong>{autoCI.status}</strong>
        {autoCI.reason && <small> {autoCI.reason.replaceAll('_',' ')}</small>}
        {autoCI.status==='armed' && !access.ci_enabled && <small> CI write authorization is unavailable.</small>}</p>}
      {run.merge_attempt && <p>Merge request <strong>{run.merge_attempt.status}</strong> · {run.merge_attempt.method.replaceAll('_', ' ')}</p>}
      {!!run.evidence?.checks?.length && <section><h3>Required checks</h3><ul className="integration-evidence">
        {run.evidence.checks.map(check => <li key={JSON.stringify([check.context, check.app, check.source])}>
          <span>{check.context}</span><strong>{check.state}</strong>
        </li>)}
      </ul></section>}
      {!!(run.workflow_history ?? run.evidence?.workflows)?.length && <section><h3>GitHub Actions</h3><ul className="integration-evidence">
        {integrationWorkflowTiming(run).map(workflow => <li key={workflow.run_id + ':' + workflow.attempt}>
          <span><a href={workflow.url}>{workflow.name ?? 'Workflow ' + workflow.workflow_id} · attempt {workflow.attempt}</a>
            {workflow.queueMs !== null && <small>Queue {Math.round(workflow.queueMs / 1000)} s</small>}
            {workflow.wallMs !== null && <small>Start to GitHub update {Math.round(workflow.wallMs / 1000)} s</small>}</span>
          <strong>{workflow.conclusion ?? workflow.status}</strong>
        </li>)}
      </ul></section>}
      {!!run.evidence?.jobs?.length && <section><h3>Failed jobs</h3><ul className="integration-evidence">
        {run.evidence.jobs.map(job => <li key={job.job_id}>
          <span><a href={job.url}>{job.name ?? 'Job ' + job.job_id}</a>
            {job.failed_steps.map(step => <small key={step.number}>Step {step.number} · {step.name}</small>)}</span>
          <strong>{job.conclusion}</strong>
        </li>)}
      </ul></section>}
      {!!run.repair_attempts?.length && <section><h3>CI rerun history</h3><ol className="integration-evidence">
        {run.repair_attempts.map(repair => <li key={repair.id}><span>Job {repair.job_id} · workflow attempt {repair.run_attempt}</span>
          <strong>{repair.authorization_id ? 'Automatic · ' : ''}{repair.status}</strong></li>)}
      </ol></section>}
      {run.log_diagnostics && <section><h3>Sanitized failed-step diagnostics</h3>
        <p>Observed for head <code className="integration-sha">{run.log_diagnostics.head_sha}</code>.</p>
        {!run.log_diagnostics.jobs.some(job=>job.steps.some(step=>step.log)) &&
          <p>No failed-step log was linked to a confirmed required check.</p>}
        <ul className="integration-evidence">{run.log_diagnostics.jobs.flatMap(job=>job.steps.filter(step=>step.log).map(step=>
          <li key={job.job_id+':'+step.number}><div><strong>Workflow {job.workflow_id} · run {job.run_id} · attempt {job.run_attempt}</strong>
            <small>Job {job.job_id} · step {step.number}</small>
            {step.log.status==='observed' ? step.log.facts.length ? step.log.facts.map((fact,index)=><small key={index}>
              {integrationLogFact(fact)}
            </small>) : <small>No supported diagnostic facts were found in the sample.</small> :
              <small>Log sample unavailable.</small>}
          </div></li>
        ))}</ul>
      </section>}
      {!!run.source_repairs?.length && <section><h3>Codex source repairs</h3><ol className="integration-evidence">
        {run.source_repairs.map(repair => <li key={repair.id}><span>
          <strong>{repair.status.replaceAll('_', ' ')}</strong>
          <small>Source <code>{repair.head_sha}</code></small>
          {repair.candidate_sha && <small>Candidate <code>{repair.candidate_sha}</code></small>}
          {repair.tree_sha && <small>Tree <code>{repair.tree_sha}</code></small>}
          {repair.changed_paths?.map(path => <small key={path}>{path}</small>)}
          {repair.session_id && <small><a href={codexThreadHref({ executor:'codex', session_id:repair.session_id })}>Open Codex repair conversation</a></small>}
          {repair.usage && <small>{repair.usage.input_tokens - repair.usage.cached_input_tokens} uncached input · {repair.usage.cached_input_tokens} cached input · {repair.usage.output_tokens} output tokens
            {!repair.usage.complete && ' · observed lower bound'}</small>}
        </span></li>)}
      </ol></section>}
      {!['merged', 'deployed'].includes(run.state) && <div className="integration-controls">
        {!run.pr_number && !run.stopped && (run.task || run.reviewed_source) && access.publish_enabled && <form onSubmit={event => {
          event.preventDefault();
          change('publish', { head_sha: run.head_sha });
        }}>
          <label className="task-check"><input type="checkbox" checked={confirm} onChange={event => setConfirm(event.target.checked)}/>
            I approve publication of this exact candidate to GitHub.</label>
          <button className="primary-button" disabled={busy || !confirm}>
            {run.publication && run.publication.status !== 'rejected' ? 'Reconcile publication' :
              run.transfer && !['verified','failed'].includes(run.transfer.status) ? 'Reconcile transfer' : 'Publish reviewed PR'}
          </button>
          <small>{access.transfer_enabled
            ? 'If the candidate exists only on the worker, this queues transfer. Confirm publication again after the branch is verified.'
            : 'The reviewed commit must already be reachable by GitHub.'}</small>
        </form>}
        {!run.pr_number && !run.stopped ? <form onSubmit={event => {
          event.preventDefault();
          change('attach', { pr_number: Number(new FormData(event.currentTarget).get('pr')) });
        }}><label>Published PR number<input name="pr" inputMode="numeric" pattern="[1-9][0-9]*" required/></label>
          <button className="quiet-button" disabled={busy}>Verify and attach PR</button></form> : null}
        {run.pr_number && !run.stopped && !sourceActive && <button className="quiet-button" disabled={busy} onClick={() => change('refresh')}>
          <RefreshCw size={15} aria-hidden="true"/> Refresh GitHub evidence
        </button>}
        {autoCI?.status === 'armed' && <button className="quiet-button" disabled={busy}
          onClick={()=>change('disarm_ci_reruns')}>Disarm automatic CI reruns</button>}
        {access.ci_enabled && autoCI?.status !== 'armed' && ['checking','blocked'].includes(run.state) &&
          !run.stopped && !sourceActive && run.pr_number &&
          run.evidence?.base_sha && (run.state === 'checking' || ['missing_checks','ci_infrastructure'].includes(run.evidence.reason)) &&
          (run.repair_attempts?.length ?? 0)+(run.source_repairs?.length ?? 0) < run.policy.repair_limit &&
          <button className="quiet-button" disabled={busy}
            onClick={()=>change('arm_ci_reruns',{head_sha:run.head_sha,base_sha:run.evidence.base_sha})}>
            Authorize automatic infrastructure reruns for this head
          </button>}
        {run.state==='blocked' && !run.stopped && run.pr_number && run.evidence?.reason==='ci_failure' &&
          <button className="quiet-button" disabled={busy} onClick={()=>change('inspect_logs')}>Read sanitized failed-step diagnostics</button>}
        {run.state === 'blocked' && run.pr_number && <form onSubmit={event => {
          event.preventDefault();
          change('retry', { feedback: new FormData(event.currentTarget).get('feedback') });
        }}><label>Owner feedback (optional)<textarea name="feedback" maxLength={1000} rows={2}/></label>
          <button className="quiet-button" disabled={busy}>Retry inspection</button></form>}
        {access.repair_enabled && ['checking','blocked'].includes(run.state) && !run.stopped && !sourceActive && run.pr_number &&
          run.evidence?.base_sha && run.policy.auto_source_repair?.status !== 'armed' &&
          (run.state==='checking' || ['ci_failure','missing_checks','ci_infrastructure'].includes(run.evidence.reason)) &&
          (run.source_repairs?.length ?? 0) + (run.repair_attempts?.length ?? 0) < run.policy.repair_limit && <form onSubmit={event => {
            event.preventDefault();
            const fields = new FormData(event.currentTarget);
            const automatic = event.nativeEvent.submitter?.value === 'automatic';
            change(automatic ? 'arm_repair' : 'repair_source', {
              paths: fields.get('paths').split('\n').map(path => path.trim()).filter(Boolean), feedback:fields.get('feedback'),
              ...(automatic ? {head_sha:run.head_sha,base_sha:run.evidence.base_sha} : {}),
            });
          }}>
            <label>Approved changed files, one path per line<textarea name="paths" rows={3} maxLength={3000} required/></label>
            <label>Owner feedback (optional)<textarea name="feedback" maxLength={1000} rows={2}/></label>
            <div className="integration-actions">
              {run.evidence.reason==='ci_failure' && <button className="primary-button" disabled={busy}>Request scoped Codex repair</button>}
              <button className="quiet-button" value="automatic" disabled={busy}>Authorize one repair for this exact head</button>
            </div>
          </form>}
        {sourceRepair?.status === 'awaiting_review' && <form onSubmit={event => {
          event.preventDefault();
          change('review_repair', { repair_id: sourceRepair.id, candidate_sha: sourceRepair.candidate_sha, tree_sha: sourceRepair.tree_sha,
            decision: event.nativeEvent.submitter?.value === 'reject' ? 'reject' : 'approve' });
        }}>
          <label className="task-check"><input type="checkbox" checked={confirm} onChange={event => setConfirm(event.target.checked)}/>
            I reviewed this exact repair commit and tree.</label>
          <div className="integration-actions">
            <button className="primary-button" value="approve" disabled={busy || !confirm}>Approve repair for publication</button>
            <button className="quiet-button" value="reject" disabled={busy}>Reject repair</button>
          </div>
        </form>}
        {access.ci_enabled && run.state === 'blocked' && !run.stopped && run.evidence?.reason === 'ci_infrastructure' &&
          transientJobs.length > 0 &&
          (run.repair_attempts?.length ?? 0) + (run.source_repairs?.length ?? 0) < run.policy.repair_limit && <form onSubmit={event => {
            event.preventDefault();
            const fields = new FormData(event.currentTarget);
            change('rerun_job', { job_id: Number(fields.get('job')), feedback: fields.get('feedback') });
          }}>
            <label>Infrastructure job<select name="job" required>
              {transientJobs.map(job =>
                <option key={job.job_id} value={job.job_id}>{job.name ?? 'Job ' + job.job_id}</option>)}
            </select></label>
            <label>Owner feedback (optional)<textarea name="feedback" maxLength={1000} rows={2}/></label>
            <button className="quiet-button" disabled={busy}>Rerun selected job</button>
          </form>}
        {!run.merge_attempt && !run.stopped && run.pr_number &&
          <button className="quiet-button" disabled={busy} onClick={() => change('stop')}>{sourceActive ? 'Stop repair' : 'Stop inspection'}</button>}
        {run.state === 'merge_ready' && (access.merge_enabled && (run.evidence.queue_required || run.evidence.strict_base)
          ? <form onSubmit={event => {
            event.preventDefault();
            change('merge', { method: new FormData(event.currentTarget).get('method') ?? 'merge',
              head_sha: run.head_sha, base_sha: run.evidence.base_sha });
          }}>
            {!run.evidence.queue_required && <label>Merge method<select name="method">
              <option value="merge">Merge commit</option><option value="squash">Squash</option><option value="rebase">Rebase</option>
            </select></label>}
            <label className="task-check"><input type="checkbox" checked={confirm} onChange={event => setConfirm(event.target.checked)}/>
              I approve merging this exact pull request head into main.</label>
            <button className="primary-button" disabled={busy || !confirm}>{run.evidence.queue_required ? 'Submit to merge queue' : 'Request protected merge'}</button>
          </form> : <p className="muted">Protected merge write authorization or strict base protection is unavailable.</p>)}
      </div>}
      {!!detail?.events?.length && detail.run.id === run.id && <section><h3>Audit history</h3>
        <ol className="integration-evidence">{detail.events.map(event => <li key={event.version}>
          <span>{event.kind.replaceAll('_', ' ')} · {labels[event.state]}{event.feedback && <small>{event.feedback}</small>}</span>
          <time dateTime={event.at}>{new Date(event.at).toLocaleString()}</time>
        </li>)}</ol></section>}
    </motion.section>}
  </div>;
}
