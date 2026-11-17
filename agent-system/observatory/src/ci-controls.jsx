import React, { useEffect, useRef, useState } from 'react';
import { DIAGNOSTIC, isCancellableRun, isFailedConclusion } from '../ci-policy.mjs';
import { activityHref } from './github-activity.mjs';

const endpoint = '/api/github/actions';
const pending = operation => operation && (
  ['sending', 'accepted', 'unknown'].includes(operation.state) ||
  (operation.state === 'observed' && operation.observed?.status !== 'completed')
);
const label = state => String(state || 'Unavailable').replaceAll('_', ' ');

function choices(run, mainRevision, diagnostics) {
  if (!run) return /^[a-f0-9]{40}$/.test(mainRevision ?? '') && diagnostics?.some(item => item.key === DIAGNOSTIC.key)
    ? [{ name: 'Dispatch Observatory diagnostic', body: {
      type: 'dispatch', diagnostic: DIAGNOSTIC.key, expected_revision: mainRevision,
    } }] : [];
  if (!run.repository_owned_head || !run.workflow_id || !run.attempt || !run.head?.sha) return [];
  const body = { run_id: run.id, attempt: run.attempt, workflow_id: run.workflow_id, expected_revision: run.head.sha };
  if (isCancellableRun(run.status) && !run.conclusion) return [{ name: 'Cancel this run', body: { ...body, type: 'cancel' } }];
  if (run.status !== 'completed' || !Number.isFinite(Date.parse(run.created_at)) || Date.now() - Date.parse(run.created_at) > 30 * 86400000) return [];
  const failedJobs = run.jobs_stale ? [] : (run.jobs ?? []).filter(job => job.status === 'completed' && isFailedConclusion(job.conclusion));
  return [
    ...(isFailedConclusion(run.conclusion) ? [
      { name: 'Rerun failed workflow', body: { ...body, type: 'rerun_run' } },
      { name: 'Rerun all failed jobs', body: { ...body, type: 'rerun_failed' } },
    ] : []),
    ...failedJobs.map(job => ({
      name: 'Rerun job: ' + (job.name || job.id),
      body: { ...body, type: 'rerun_job', job_id: job.id },
    })),
  ];
}

function Operation({ operation }) {
  const result = operation.observed;
  return <div className="record">
    <div className="record-title"><strong>{label(operation.state)}</strong><span>{label(operation.type)}</span></div>
    <p>{operation.message}</p>
    {operation.github_status != null && <small>GitHub write HTTP {operation.github_status}</small>}
    <p>Operation <code>{operation.operation_id}</code></p>
    {operation.target?.revision && <p>Target revision <code>{operation.target.revision}</code></p>}
    {result?.run_id && <p><a href={activityHref('runs', result.run_id)}>Run {result.run_id}, attempt {result.attempt}</a>
      {' · '}{label(result.conclusion || result.status)}{result.job_id && ' · Job ' + result.job_id}</p>}
  </div>;
}

export function CIControls({ run = null, mainRevision, headers, live, Panel, Rise }) {
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    if (!live) return;
    const controller = new AbortController();
    fetch(endpoint, { cache: 'no-store', headers, signal: controller.signal })
      .then(async response => {
        const value = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) throw Error(value.error || 'CI controls unavailable');
        setSnapshot(value);
      })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [headers, live, epoch]);

  const operationId = selected?.operation_id;
  useEffect(() => {
    if (!live || !operationId) return;
    const controller = new AbortController();
    let timer;
    let polls = 0;
    async function observe() {
      try {
        const response = await fetch(endpoint + '?operation=' + encodeURIComponent(operationId), {
          cache: 'no-store', headers, signal: controller.signal,
        });
        const body = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) {
          if (response.status === 404 && polls < 2) throw Error('CI receipt pending');
          setError(body.error || 'CI receipt unavailable');
          return;
        }
        setError('');
        setSelected(body.operation);
        if (!pending(body.operation)) return;
      } catch {
        if (controller.signal.aborted) return;
      }
      if (++polls < 8) timer = setTimeout(observe, 4000);
    }
    timer = setTimeout(observe, 4000);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [operationId, headers, live, epoch]);

  async function submit() {
    if (submitting.current || !confirmation || !snapshot?.access?.enabled) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    const request = { ...confirmation.body, operation_id: crypto.randomUUID() };
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(request),
      });
      const body = await response.json();
      if (!response.ok && response.status < 500) {
        setError(body.error || 'CI operation unavailable');
        return;
      }
      if (!response.ok) throw Error('Uncertain HTTP result');
      setSelected(body.operation);
    } catch {
      setSelected({ operation_id: request.operation_id, state: 'unknown', type: request.type,
        message: 'The connection was interrupted. Look up the receipt before issuing another operation.' });
    } finally {
      setConfirmation(null);
      setBusy(false);
      submitting.current = false;
      setEpoch(value => value + 1);
    }
  }

  if (!live) return null;
  const relevant = (snapshot?.operations ?? []).filter(item => run
    ? item.target?.run_id === run.id || item.observed?.run_id === run.id
    : item.type === 'dispatch');
  const canOperate = Boolean(snapshot?.access?.enabled);
  const actions = canOperate ? choices(run, mainRevision, snapshot.access.diagnostics) : [];
  return <Rise><Panel title={run ? 'CI controls' : 'Allowlisted diagnostics'}>
    {error && <p role="status" className="notice error">{error}</p>}
    {!snapshot && !error && <p className="low">Checking CI permissions…</p>}
    {snapshot && !canOperate && <p className="low">{snapshot.access?.reason}</p>}
    {canOperate && !actions.length && <p className="low">{run
      ? 'This workflow attempt has no eligible action.'
      : 'A current confirmed main revision is required to dispatch the Observatory diagnostic.'}</p>}
    {!confirmation && actions.length > 0 && <div className="form-actions">
      {actions.map(action => <button className="quiet-button" type="button" key={action.body.type + ':' + (action.body.job_id ?? '')}
        disabled={busy || pending(selected)} onClick={() => setConfirmation(action)}>{action.name}</button>)}
    </div>}
    {confirmation && <section aria-label="Confirm GitHub Actions operation" className="record">
      <strong>{confirmation.name}</strong>
      <p>Kgray44/Aetherwake · {run ? 'Run ' + run.id + ', attempt ' + run.attempt : DIAGNOSTIC.name}</p>
      <p>{run?.head?.ref ?? DIAGNOSTIC.ref} · <code>{confirmation.body.expected_revision}</code></p>
      {confirmation.body.job_id && <p>Job {confirmation.body.job_id}, including dependent jobs as scheduled by GitHub</p>}
      {run?.pull_requests?.length > 0 && <p>Pull requests {run.pull_requests.map(id => <a key={id} href={activityHref('pulls', id)}>#{id} </a>)}</p>}
      <div className="form-actions">
        <button type="button" className="primary-button" disabled={busy} onClick={submit}>{busy ? 'Submitting…' : 'Confirm operation'}</button>
        <button type="button" className="quiet-button" disabled={busy} onClick={() => setConfirmation(null)}>Back</button>
      </div>
    </section>}
    {selected && <div aria-live="polite"><Operation operation={selected}/>
      <button type="button" className="quiet-button" onClick={() => setEpoch(value => value + 1)}>Check GitHub readback</button>
      <button type="button" className="quiet-button" onClick={() => setSelected(null)}>Close receipt</button>
    </div>}
    {relevant.length > 0 && <details><summary>Recent operation receipts</summary>
      {relevant.map(item => <div key={item.operation_id}>
        <Operation operation={item}/>
        <button className="quiet-button" type="button" onClick={() => { setSelected(item); setEpoch(value => value + 1); }}>Inspect receipt</button>
      </div>)}
    </details>}
  </Panel></Rise>;
}
