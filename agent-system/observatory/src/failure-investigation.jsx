import React, { useEffect, useState } from 'react';
import { activityHref, githubItemHref } from './github-activity.mjs';
import { failedAttempts, failedRun, investigateAttempt, investigateRun, selectPulls, selectRunHistory } from './failure-investigation.mjs';

const milliseconds = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const elapsed = value => Number.isFinite(value) ? milliseconds.format(value / 1000) + ' s' : 'Unavailable';
const stamp = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Unavailable';

function RunLink({ row }) {
  return <a href={activityHref('runs', row.id)}>Run {row.id}{row.attempt ? ' · attempt ' + row.attempt : ''}</a>;
}

function PullLinks({ rows }) {
  return rows.length > 0
    ? <ul>{rows.map(row => <li key={row.number}><a href={activityHref('pulls', row.number)}>PR #{row.number}{row.title ? ' · ' + row.title : ''}</a></li>)}</ul>
    : <p className="low">No pull request in the loaded feed is tied to this exact revision.</p>;
}

function Revision({ sha }) {
  return sha ? <code>{sha}</code> : 'Unavailable';
}

function useRunComparisons({ enabled, passingId, repeatId, pullNumber, headers }) {
  const [result, setResult] = useState({});
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    const targets = [
      ['baseline', 'runs', passingId], ['repeat', 'runs', repeatId], ['pull', 'pulls', pullNumber],
    ].filter(([, , identity]) => identity);
    setResult({});
    // The backend shares one GitHub refresh lease across run and PR details.
    // Parallel cold reads would drop all but the first comparison.
    async function readComparisons() {
      for (const [key, kind, identity] of targets) {
        if (abort.signal.aborted) return;
        let detail = false;
        try {
          const response = await fetch('/api/github/' + kind + '/' + identity, {
            headers, cache: 'no-store', signal: abort.signal,
          });
          if (response.ok) detail = (await response.json()).detail ?? false;
        } catch { /* A failed read is displayed as unavailable. */ }
        if (!abort.signal.aborted) setResult(previous => ({ ...previous, [key]: detail }));
      }
    }
    void readComparisons();
    return () => abort.abort();
  }, [enabled, passingId, repeatId, pullNumber, headers]);
  return result;
}

export function RunFailureInvestigation({ run, records, events, github, headers, openTask, ui }) {
  const { Panel, Rise } = ui;
  const [compare, setCompare] = useState(false);
  const [historyFeed, setHistoryFeed] = useState(null);
  const historyEnabled = failedRun(run) && Boolean(run.workflow_id && run.head?.sha);
  useEffect(() => {
    if (!historyEnabled) return;
    const controller = new AbortController();
    fetch('/api/github/histories/' + run.id, { headers, cache: 'no-store', signal: controller.signal })
      .then(async response => response.ok ? (await response.json()).detail : null)
      .then(detail => {
        if (!controller.signal.aborted) {
          const matches = detail?.id === run.id && detail.attempt === run.attempt && detail.head?.sha === run.head.sha &&
            detail.workflow_id === run.workflow_id;
          setHistoryFeed(matches ? detail.history : false);
        }
      }).catch(() => { if (!controller.signal.aborted) setHistoryFeed(false); });
    return () => controller.abort();
  }, [historyEnabled, run.id, run.attempt, run.head?.sha, run.workflow_id, headers]);
  const currentGitHub = historyFeed?.status === 'available' || historyFeed?.status === 'stale'
    ? { ...github, ci: historyFeed } : github;
  const past = selectRunHistory(run, currentGitHub?.ci);
  const pulls = selectPulls(run.head?.sha, github, run.pull_requests);
  const readback = useRunComparisons({ enabled: compare && (!historyEnabled || historyFeed !== null), passingId: past.passing?.id,
    repeatId: past.recentFailures[0]?.id, pullNumber: pulls[0]?.number, headers });
  const finding = investigateRun({ run, records, events, github: currentGitHub, ...readback });
  if (!finding) return null;
  const { history, jobs, changes, traces } = finding;
  const original = githubItemHref('runs', run.id) + '/attempts/' + run.attempt;
  return <Rise><Panel title="Failure investigation" kicker="GITHUB ACTIONS">
    <div className="failure-investigation">
    <p>GitHub reported {run.conclusion.replaceAll('_', ' ')} for attempt {run.attempt} at run head <Revision sha={run.head?.sha}/>.</p>
    {finding.elapsedMs !== null && <p>Start to last run update · {elapsed(finding.elapsedMs)}</p>}
    <h3>Failed jobs</h3>
    {run.jobs_stale && <p className="low">Job details are cached from {stamp(run.jobs_observed_at)}.</p>}
    {run.jobs_truncated && <p className="low">Only the first part of the job list is available.</p>}
    {jobs.length === 0 ? <p className="low">The available job data identifies no failing job. See the run log for errors before job startup.</p>
      : <ul>{jobs.map(job => <li key={job.id}>
        <a href={githubItemHref('runs', run.id) + '/job/' + job.id} target="_blank" rel="noreferrer">{job.name || 'Job ' + job.id}</a>
        {' · '}{job.conclusion.replaceAll('_', ' ')}{' · '}{elapsed(job.elapsedMs)}
        {job.passingElapsedMs !== null && <span> · Same named job in prior pass {elapsed(job.passingElapsedMs)}</span>}
        {job.repeated && <span> · Same named job and conclusion in the latest matching failure</span>}
        {job.steps.length > 0 && <ul>{job.steps.map(([number, name]) => <li key={number}>Step {number} · {name}</li>)}</ul>}
        {job.stepsTruncated && <span className="low">Additional steps are available in GitHub.</span>}
      </li>)}</ul>}
    <h3>Comparable run history</h3>
    {historyEnabled && historyFeed === null && <p role="status">Reading the previous runs for this workflow…</p>}
    {(historyFeed === false || historyFeed?.status === 'unavailable') &&
      <p className="low">Workflow history unavailable. Showing only the repository activity window.{historyFeed?.reason && ' ' + historyFeed.reason}</p>}
    <p className="low">Runs from the same workflow ID, branch, and trigger whose last update preceded this run’s start.
      {' '}{history.status === 'stale' && 'Cached feed · '}{history.observedAt && 'Observed ' + stamp(history.observedAt)}</p>
    {!run.workflow_id && <p className="low">Workflow ID is missing. Refresh this run to enable historical matching.</p>}
    {history.passing
      ? <p>Latest earlier success · <RunLink row={history.passing}/> · <Revision sha={finding.passingRevision}/></p>
      : <p className="low">No earlier passing run meets these criteria in the available window.</p>}
    {history.recentFailures.length
      ? <><p>{history.recentFailures.length} earlier {history.recentFailures.length === 1 ? 'run has' : 'runs have'} the same conclusion.</p>
        <ul>{history.recentFailures.slice(0, 4).map(row => <li key={row.id}>
          <RunLink row={row}/> · <Revision sha={row.revision}/></li>)}</ul></>
      : <p className="low">No earlier matching conclusion appears in the available window.</p>}
    <h3>Changes and local observations</h3>
    <PullLinks rows={finding.exactPulls}/>
    {finding.passingRevision && run.head?.sha && finding.passingRevision !== run.head.sha &&
      <p><a href={'https://github.com/Kgray44/Aetherwake/compare/' + finding.passingRevision + '...' + run.head.sha} target="_blank" rel="noreferrer">Compare run head revisions on GitHub</a></p>}
    <details className="github-job" onToggle={event => { if (event.currentTarget.open) setCompare(true); }}>
      <summary>Read comparable jobs and changed files</summary>
      <div className="github-job-content">
      {compare && ((past.passing && readback.baseline === undefined) ||
        (past.recentFailures.length > 0 && readback.repeat === undefined) ||
        (pulls.length > 0 && readback.pull === undefined)) && <p role="status">Loading GitHub comparison evidence…</p>}
      {past.passing && readback.baseline !== undefined && !finding.passingDetail && <p className="low">Job evidence for the exact passing attempt is unavailable.</p>}
      {past.recentFailures.length > 0 && readback.repeat !== undefined && !finding.repeatDetail && <p className="low">Job evidence for the exact earlier failure is unavailable.</p>}
      {finding.passingDetail && !jobs.some(job => job.passingElapsedMs !== null) && <p className="low">No unambiguous successful job with comparable timing was found.</p>}
      {finding.repeatDetail && !jobs.some(job => job.repeated) && <p className="low">No unambiguous repeated job signature was found.</p>}
      {changes ? <>
        <p>{changes.files?.length ?? 0} files shown for <Revision sha={changes.head?.sha}/>{changes.files_truncated && ' · Bounded subset'}.
          {changes.files_status === 'stale' && ' Cached ' + stamp(changes.files_observed_at) + '.'}</p>
        {finding.workflowChanged && <p>This file list includes the run’s workflow definition. Review its diff before comparing results.</p>}
        <ul>{(changes.files ?? []).slice(0, 12).map(file => <li key={file.path}><code>{file.path}</code> · {file.status}</li>)}</ul>
        {(changes.files?.length ?? 0) > 12 && <p><a href={activityHref('pulls', changes.number)}>View more files in PR #{changes.number}</a></p>}
      </> : <p className="low">An exact-revision changed-file list is unavailable.</p>}
      </div>
    </details>
    {finding.references.length > 0 && <><p>Engineering evidence records that reference this GitHub run.</p>
      <ul>{finding.references.map(reference => <li key={reference.attempt}>
        {openTask ? <button type="button" className="text-button" onClick={() => openTask(reference.task)}>{reference.task}</button> : reference.task}
        {' · '}Evidence {reference.evidence} · {reference.attemptMatched ? 'Exact run attempt link' : 'Run link without an attempt number'}
      </li>)}</ul></>}
    {traces.length > 0 ? <><p>Local attempts that share the GitHub run’s head revision.</p>
      <ul>{traces.map(trace => <li key={trace.id}>
        {openTask ? <button type="button" className="text-button" onClick={() => openTask(trace.task)}>{trace.task}</button> : trace.task}
        {' · '}{trace.id}{' · '}{trace.state}{trace.failureCategory && ' · recorded category ' + trace.failureCategory}
        {trace.failedPhases.length > 0 && ' · failed phases ' + trace.failedPhases.join(', ')}
        {trace.observations > 0 && ' · ' + trace.observations + ' resource measurements'}
      </li>)}</ul></> : <p className="low">The current projection has no local attempt at this revision.</p>}
    <h3>Next diagnostic</h3>
    <p>{finding.suggestedNext} <a href={original} target="_blank" rel="noreferrer">Open this run attempt</a>.</p>
    <p className="low">The run head comes from GitHub metadata. The logs or build artifacts can show what the workflow actually checked out.</p>
    </div>
  </Panel></Rise>;
}

export function TaskFailureInvestigation({ task, records, events, github, ui }) {
  const { Panel, Rise } = ui;
  const [selected, setSelected] = useState('');
  const attempts = failedAttempts(task, records);
  const attempt = attempts.find(row => row.id === selected) ?? attempts[0];
  const finding = investigateAttempt({ task, attempt, records, events, github });
  if (!finding && task.state !== 'failed') return null;
  return <Rise><Panel title="Failure investigation" kicker="TASK ATTEMPTS">
    <div className="failure-investigation">
    {!finding ? <p className="low">This Task reports failure. Import the matching Attempt, Trace, and Evidence to investigate it.</p> : <>
      <label>Failed attempt <select value={attempt.id} onChange={event => setSelected(event.target.value)}>
        {attempts.map(row => <option key={row.id} value={row.id}>#{row.attempt_number} · {row.id}</option>)}
      </select></label>
      <p>Tested revision · <Revision sha={attempt.revision}/> · {elapsed(finding.elapsedMs)}</p>
      <p>Recorded failure category · {attempt.failure_category && attempt.failure_category !== 'none' ? attempt.failure_category : 'Unavailable'}</p>
      <h3>Earlier attempts</h3>
      {finding.passing
        ? <p>Most recent finished success · #{finding.passing.attempt_number} · {finding.passing.id}
          {' · '}<Revision sha={finding.passing.revision}/>{' · '}{elapsed(finding.passingElapsedMs)}</p>
        : <p className="low">No earlier successful attempt is present in the loaded records.</p>}
      {finding.repeats.length > 0 && <p>Same recorded category on {finding.repeats.length} earlier attempts
        {' · '}{finding.repeats.slice(0, 5).map(row => '#' + row.attempt_number).join(', ')}</p>}
      <h3>Observed errors and timing</h3>
      {finding.failedCriteria.length > 0 ? <ul>{finding.failedCriteria.map(evidence => <li key={evidence.id}>
        Criterion {evidence.criterion_id} · {evidence.kind} reported failed · {evidence.id} · {stamp(evidence.observed_at)}
        {finding.comparativeEvidence.some(row => row.criterion_id === evidence.criterion_id && row.kind === evidence.kind)
          && ' · Earlier attempt reported a pass for this criterion and evidence kind'}
      </li>)}</ul> : <p className="low">No non-synthetic failed evidence is bound to this attempt and revision.</p>}
      {finding.failedSpans.length > 0 && <ul>{finding.failedSpans.map(span => <li key={span.key}>
        Failed {span.phase} span {span.id} · {elapsed(span.monotonicMs)} · {stamp(span.events[0]?.occurred_at)}
      </li>)}</ul>}
      <p className="low">Time covered by complete trace spans · {elapsed(finding.traceMs)}
        {finding.incomplete > 0 && ' · ' + finding.incomplete + ' incomplete spans'}</p>
      {finding.phaseTiming.length > 0 && <ul>{finding.phaseTiming.map(phase => <li key={phase.phase}>
        {phase.phase} span coverage · {elapsed(phase.coveredMs)} · Prior pass coverage {elapsed(phase.passingCoveredMs)}
      </li>)}</ul>}
      {finding.resources.length > 0 && <><h3>Latest comparable resource observations</h3><ul>{finding.resources.map(metric => <li key={JSON.stringify([metric.phase, metric.name, metric.method, metric.source, metric.unit])}>
        {metric.phase} · {metric.name} {milliseconds.format(metric.value)} {metric.unit} · {metric.origin} {metric.observation}
        {' · '}{metric.source} / {metric.method} · {stamp(metric.observedAt)}
        {metric.coverage !== undefined && ' · ' + (metric.coverage * 100) + '% coverage'}
        {metric.passing && ' · Prior pass ' + milliseconds.format(metric.passing.value) + ' ' + metric.unit + ' (' + metric.passing.observation + ')'}
      </li>)}</ul></>}
      <h3>Changes and CI</h3>
      <PullLinks rows={finding.pulls}/>
      {finding.testedRuns.length > 0 && <><p>CI runs whose GitHub head matches this attempt revision.</p>
        <ul>{finding.testedRuns.map(row => <li key={row.id}><RunLink row={row}/> · {row.conclusion ?? row.status}</li>)}</ul></>}
      <h3>Next diagnostic</h3>
      <p>{finding.suggestedNext}</p>
      <p className="low">Attempt results are reported observations. Use the linked sources to verify what happened.</p>
    </>}
    </div>
  </Panel></Rise>;
}

