import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity, ArrowLeft, ArrowUpRight, CheckCircle2, CircleX, Clock3, GitMerge, GitPullRequest, Search, Workflow
} from 'lucide-react';
import {
  activityGroup, activityHref, activityId, activityState, githubItemHref, pullRepositoryTotals, runRepositoryTotal, searchActivity
} from './github-activity.mjs';
import { RunFailureInvestigation } from './failure-investigation.jsx';
import { CIControls } from './ci-controls.jsx';

const EMPTY = [];
const text = value => value === null || value === undefined || value === '' ? 'Unavailable' : String(value);
const stamp = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Unavailable';
const label = value => String(value || 'Unavailable').replaceAll('_', ' ');
const branch = value => value?.ref || 'Unavailable';
const sha = value => value?.sha ? <code>{value.sha}</code> : 'Unavailable';
const actor = value => typeof value === 'string' ? value : value?.login;
const entityName = kind => kind === 'pulls' ? 'Pull requests' : 'CI runs';
const activeRun = value => ['in_progress', 'queued', 'waiting', 'pending', 'requested'].includes(value);
const failedRun = value => ['failure', 'timed_out', 'startup_failure', 'action_required'].includes(value);
function duration(start, end) {
  const ms = Date.parse(end) - Date.parse(start);
  if (!Number.isFinite(ms) || ms < 0) return 'Unavailable';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

export function GitHubActivityList({ kind, group, filters, setFilters, ui, ci }) {
  const { Metric, Panel, Rise, Status } = ui;
  const items = group?.items ?? EMPTY;
  const pr = kind === 'pulls';
  const states = useMemo(() => [...new Set(items.map(item => activityState(kind, item)).filter(Boolean))].sort(), [items, kind]);
  const groups = useMemo(() => [...new Set(items.map(item => activityGroup(kind, item)).filter(Boolean))].sort(), [items, kind]);
  const rows = useMemo(() => searchActivity(kind, items, filters), [items, kind, filters]);
  const recentKnown = group && group.status !== 'unavailable';
  const countRecent = check => recentKnown
    ? items.filter(item => check(activityState(kind, item))).length.toLocaleString() : '—';
  const showTotal = value => Number.isSafeInteger(value) ? value.toLocaleString() : '—';
  const pullTotals = pullRepositoryTotals(group);
  const runTotal = runRepositoryTotal(group);
  const repoMeta = pr && pullTotals?.stale || group?.status === 'stale'
    ? 'Cached repository count' : 'Repository-wide GitHub count';
  const recentMeta = recentKnown ? 'Among the latest ' + items.length + ' runs' : 'Recent results unavailable';
  const stats = pr
    ? [['All pull requests', showTotal(pullTotals?.total), GitPullRequest, repoMeta],
      ['Open pull requests', showTotal(pullTotals?.open), Activity, repoMeta],
      ['Merged pull requests', showTotal(pullTotals?.merged), GitMerge, repoMeta],
      ['Closed without merge', showTotal(pullTotals?.closed), CircleX, repoMeta]]
    : [['All workflow runs', showTotal(runTotal), Workflow, repoMeta], ['Recent active runs', countRecent(activeRun), Clock3, recentMeta],
      ['Recent passed runs', countRecent(x => x === 'success'), CheckCircle2, recentMeta],
      ['Recent failed runs', countRecent(failedRun), CircleX, recentMeta]];
  const update = (key, value) => setFilters({ ...filters, [key]: value });

  return <>
    {!pr && ci && <CIControls {...ci} Panel={Panel} Rise={Rise}/>}
    <div className="metrics github-activity-metrics">{stats.map(([name, value, Icon, meta], index) =>
      <Metric key={name} name={name} value={value} Icon={Icon} index={index} meta={meta}/>)}</div>
    <Rise><Panel title={entityName(kind)} right={<span className="panel-meta">{rows.length} of {items.length} recent results</span>}>
      {pr && !pullTotals && <p className="low">Repository totals are unavailable{group?.totals?.reason ? ' · ' + group.totals.reason : ''}.</p>}
      {pr && pullTotals && <p className="low">{pullTotals.stale ? 'Cached repository totals' : 'Repository totals'} · {stamp(pullTotals.observedAt)}</p>}
      {recentKnown && <p className="low">Search and filters apply to the latest {items.length} results.</p>}
      {group?.status === 'stale' && <p className="notice">Cached · Last successful refresh {stamp(group.observed_at)} · {group.reason}</p>}
      <div className="form github-activity-filters">
        <label>Search
          <span className="github-search"><Search size={16} aria-hidden="true"/>
            <input type="search" value={filters.query} onChange={event => update('query', event.target.value)}
              placeholder={pr ? 'Title, number, author or branch' : 'Run, workflow or branch'}/></span></label>
        <label>Status <select value={filters.state} onChange={event => update('state', event.target.value)}>
          <option value="">All statuses</option>{states.map(state => <option key={state} value={state}>{label(state)}</option>)}
        </select></label>
        <label>{pr ? 'Base branch' : 'Workflow'} <select value={filters.group} onChange={event => update('group', event.target.value)}>
          <option value="">{pr ? 'All branches' : 'All workflows'}</option>{groups.map(value => <option key={value}>{value}</option>)}
        </select></label>
        <label>Order <select value={filters.oldest ? 'old' : 'new'} onChange={event => update('oldest', event.target.value === 'old')}>
          <option value="new">Newest first</option><option value="old">Oldest first</option>
        </select></label>
      </div>
      {!rows.length && <p className="low">{group?.status === 'unavailable' ? group.reason
        : !group ? 'GitHub activity is available on the connected private Site.' : 'No results match the current filters.'}</p>}
      <ul className="github-activity-list">
        {rows.map(row => {
          const id = activityId(kind, row);
          const title = row.title || row.workflow || row.label || 'Untitled';
          const metadata = pr
            ? [id && '#' + id, row.author && '@' + row.author, row.head_ref, row.base_ref && 'into ' + row.base_ref, row.draft && 'Draft']
            : [row.workflow || row.label, row.branch, row.event, row.attempt && 'Attempt ' + row.attempt];
          const body = <><div className="github-row-copy"><strong>{title}</strong>
            <small>{metadata.filter(Boolean).join(' · ')}</small></div>
            <Status value={activityState(kind, row) || 'unavailable'}/>
            <time dateTime={row.created_at || undefined}>{stamp(row.created_at)}</time>
            <ArrowUpRight size={16} aria-hidden="true"/></>;
          return <li key={id ?? row.url}>
            {id ? <a className="github-activity-row" href={activityHref(kind, id)}>{body}</a>
              : <div className="github-activity-row">{body}</div>}
          </li>;
        })}
      </ul>
    </Panel></Rise>
  </>;
}

function Facts({ fields }) {
  return <dl className="github-facts">{fields.map(([name, value]) => <div key={name}>
    <dt>{name}</dt><dd>{value ?? 'Unavailable'}</dd>
  </div>)}</dl>;
}

function names(list) {
  return Array.isArray(list) ? list.map(entry => entry?.name || actor(entry)).filter(Boolean).join(', ') || 'None' : 'Unavailable';
}

function SectionCoverage({ status, observedAt, reason }) {
  if (!status || status === 'available') return null;
  return <p className="low">{status === 'stale' ? 'Cached' : label(status)}
    {observedAt && ' · Last successful refresh ' + stamp(observedAt)}{reason && ' · ' + reason}</p>;
}

function PullDetails({ detail, Panel, Rise, Status }) {
  return <>
    <Rise><Panel title="Pull request details" right={<Status value={detail.merged ? 'merged' : detail.state || 'unavailable'}/>}>
      <Facts fields={[
        ['Author', text(actor(detail.author))], ['Draft', typeof detail.draft === 'boolean' ? detail.draft ? 'Yes' : 'No' : 'Unavailable'],
        ['PR number', detail.number], ['Opened', stamp(detail.created_at)], ['Updated', stamp(detail.updated_at)],
        ['Closed', stamp(detail.closed_at)], ['Merged', stamp(detail.merged_at)],
        ['Base branch', branch(detail.base)], ['Base revision', sha(detail.base)],
        ['Head branch', branch(detail.head)], ['Head revision', sha(detail.head)],
        ['Merge revision', detail.merge_commit_sha ? <code>{detail.merge_commit_sha}</code> : 'Unavailable'],
        ['Assignees', names(detail.assignees)], ['Requested reviewers', names(detail.requested_reviewers)],
        ['Requested teams', names(detail.requested_teams)], ['Labels', names(detail.labels)],
        ['Milestone', text(detail.milestone?.title ?? detail.milestone)],
        ['Maintainer edits', typeof detail.maintainer_can_modify === 'boolean' ? detail.maintainer_can_modify ? 'Allowed' : 'Disabled' : 'Unavailable']
      ]}/>
    </Panel></Rise>
    <Rise><Panel title="Change summary"><Facts fields={[
      ['Changed files', detail.changed_files], ['Additions', detail.additions], ['Deletions', detail.deletions],
      ['Commits', detail.commits], ['Comments', detail.comments], ['Review comments', detail.review_comments]
    ]}/></Panel></Rise>
    {detail.body && <Rise><Panel title="Description"><p className="github-description">{detail.body}</p>
      {detail.body_truncated && <p className="low">Full description available on GitHub.</p>}</Panel></Rise>}
    {(Array.isArray(detail.files) || detail.files_status) && <Rise><Panel title="Changed files">
      <SectionCoverage status={detail.files_status} observedAt={detail.files_observed_at} reason={detail.files_reason}/>
      {detail.files_truncated && <p className="low">Showing a bounded file list. Open the pull request on GitHub for all files.</p>}
      {detail.files_status === 'available' && !detail.files?.length && <p className="low">No changed files were returned.</p>}
      <ul className="github-meta-list">{(detail.files ?? []).map(file => <li key={file.path}>
        <div><strong className="mono">{file.path}</strong>{file.previous_path && <small>From {file.previous_path}</small>}</div>
        <small>{label(file.status)} · +{text(file.additions)} / −{text(file.deletions)}</small>
      </li>)}</ul>
    </Panel></Rise>}
    {(Array.isArray(detail.reviews) || detail.reviews_status) && <Rise><Panel title="Submitted reviews">
      <SectionCoverage status={detail.reviews_status} observedAt={detail.reviews_observed_at} reason={detail.reviews_reason}/>
      {detail.reviews_truncated && <p className="low">Showing a bounded review list. Open the pull request on GitHub for all reviews.</p>}
      {detail.reviews_status === 'available' && !detail.reviews?.length && <p className="low">No submitted reviews were returned.</p>}
      <ul className="github-meta-list">{(detail.reviews ?? []).map(review => <li key={review.id}>
        <div><strong>{text(actor(review.author))}</strong><small>{stamp(review.submitted_at)}</small></div>
        <Status value={review.state?.toLowerCase() || 'unavailable'}/>
      </li>)}</ul>
    </Panel></Rise>}
  </>;
}

function RunDetails({ detail, Panel, Rise, Status }) {
  return <>
    <Rise><Panel title="Run details" right={<Status value={detail.conclusion || detail.status || detail.state || 'unavailable'}/>}>
      <Facts fields={[
        ['Workflow', detail.name], ['Trigger', detail.event], ['Actor', actor(detail.actor ?? detail.author)],
        ['Run ID', detail.id], ['Run number', detail.run_number], ['Attempt', detail.attempt], ['Status', label(detail.status)],
        ['Conclusion', label(detail.conclusion)], ['Branch', branch(detail.head)], ['Head revision', sha(detail.head)],
        ['Created', stamp(detail.created_at)], ['Started', stamp(detail.started_at)], ['Updated', stamp(detail.updated_at)],
        ['Workflow path', detail.path], ['Associated pull requests', Array.isArray(detail.pull_requests)
          ? detail.pull_requests.length ? detail.pull_requests.map(pr => <a key={pr.number ?? pr} href={activityHref('pulls', pr.number ?? pr)}>#{pr.number ?? pr} </a>) : 'None'
          : 'Unavailable']
      ]}/>
    </Panel></Rise>
    <Rise><Panel title="Jobs and steps" right={<span className="panel-meta">{detail.jobs?.length || 0}{Number.isSafeInteger(detail.total_jobs) ? ' of ' + detail.total_jobs : ''} shown</span>}>
      {detail.jobs_stale && <p className="low">Cached job data · {stamp(detail.jobs_observed_at)}</p>}
      {detail.jobs_truncated && <p className="low">This window contains the first set of jobs. Open the run on GitHub for the full job list.</p>}
      {!detail.jobs?.length && <p className="low">Job details are unavailable.</p>}
      {(detail.jobs ?? []).map(job => <details className="github-job" key={job.id}>
        <summary><strong>{job.name || 'Job ' + job.id}</strong><Status value={job.conclusion || job.status || 'unavailable'}/>
          <small>{duration(job.started_at, job.completed_at)}</small></summary>
        <div className="github-job-content">
          <Facts fields={[
            ['Started', stamp(job.started_at)], ['Completed', stamp(job.completed_at)],
            ['GitHub job', <a href={githubItemHref('runs', detail.id) + '/job/' + job.id} target="_blank" rel="noreferrer">Open job on GitHub</a>]
          ]}/>
          {job.steps_truncated && <p className="low">Open this job on GitHub for the full step list.</p>}
          {job.steps?.length > 0 && <ol className="github-steps">{job.steps.map(step => <li key={step.number}>
            <div><strong>{step.number}. {step.name}</strong><small>{stamp(step.started_at)} → {stamp(step.completed_at)}</small></div>
            <Status value={step.conclusion || step.status || 'unavailable'}/>
            <small>{duration(step.started_at, step.completed_at)}</small>
          </li>)}</ol>}
        </div>
      </details>)}
    </Panel></Rise>
  </>;
}

export function GitHubActivityDetails({ kind, id, group, headers, live, ui, investigation }) {
  const { Panel, Rise, Status } = ui;
  const summary = group?.items?.find(row => activityId(kind, row) === id);
  const [response, setResponse] = useState(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!live) return;
    const controller = new AbortController();
    setResponse(null);
    async function readDetails() {
      try {
        const result = await fetch('/api/github/' + kind + '/' + id, {
          cache: 'no-store', headers, signal: controller.signal
        });
        const data = await result.json();
        if (!controller.signal.aborted) setResponse(result.ok ? data : { reason: data.reason || data.error });
      } catch {
        if (!controller.signal.aborted) setResponse({ reason: 'GitHub details are temporarily unavailable.' });
      }
    }
    readDetails();
    return () => controller.abort();
  }, [kind, id, headers, live, refresh]);
  const detail = live ? response?.detail : null;
  const displayTitle = detail?.title || summary?.title;
  const title = displayTitle ? (kind === 'pulls' ? '#' + id + ' · ' : '') + displayTitle
    : (kind === 'pulls' ? 'Pull request #' : 'CI run ') + id;
  return <>
    <div className="github-detail-actions">
      <a className="back" href={activityHref(kind)}><ArrowLeft size={15}/> {entityName(kind)}</a>
      <a className="primary-button" href={githubItemHref(kind, id)} target="_blank" rel="noreferrer">Open on GitHub <ArrowUpRight size={16}/></a>
    </div>
    <Rise><Panel title={title} right={summary && <Status value={activityState(kind, summary) || 'unavailable'}/>}>
      <p className="low">{live && response === null ? 'Loading GitHub details…' : !live
        ? 'Detailed GitHub data is available in Live mode on the private Site.'
        : <>{response.status === 'stale' ? 'Cached · ' : ''}{response.observed_at ? 'Last successful refresh ' + stamp(response.observed_at) : ''}{response.reason && ' ' + response.reason}</>}</p>
      {live && response && <button className="quiet-button" type="button" onClick={() => setRefresh(value => value + 1)}>Refresh details</button>}
    </Panel></Rise>
    {detail?.kind === 'pull' && <PullDetails detail={detail} Panel={Panel} Rise={Rise} Status={Status}/>}
    {detail?.kind === 'run' && <RunDetails detail={detail} Panel={Panel} Rise={Rise} Status={Status}/>}
    {detail?.kind === 'run' && <CIControls key={detail.id + ':' + detail.attempt} run={detail}
      headers={headers} live={live} Panel={Panel} Rise={Rise}/>}
    {detail?.kind === 'run' && investigation && <RunFailureInvestigation key={detail.id + ':' + detail.attempt}
      run={detail} headers={headers} ui={ui} {...investigation}/>}
  </>;
}
