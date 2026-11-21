import {codexThreadHref} from './task-engine-client.mjs';
import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowDown, ArrowRight, ChevronRight, Filter, GitBranch, Plus, Search } from 'lucide-react';
import {taskActivityHref} from './github-activity.mjs';
import {taskEngineeringActivity} from './task-activity.mjs';
import { useCardMotion } from './card-motion.jsx';
import { attemptMatchesEvidence, criterionEvidenceStatus, evidenceClaimStatus } from './evidence-status.mjs';
import { attemptJournal } from './task-attempts.mjs';
import { dependencyGraph, organizeTasks, taskHref, workLabels } from './task-workspace.mjs';

export const defaultTaskFilters = { query: '', source: 'all', state: 'all', sort: 'newest', group: 'none' };
const labels = value => value.replaceAll('_', ' ');
const date = value => value ? new Date(value).toLocaleDateString() : 'Unavailable';

export function TaskRows({ tasks, controls, related, activityFor, Status, overviewResults }) {
  const reduce = useReducedMotion();
  const interaction = useCardMotion(true);
  return <ul className="task-rows">
    <AnimatePresence initial={false}>
      {tasks.map(task => {
        const control = Object.hasOwn(controls, task.id) ? controls[task.id] : null;
        const activity = activityFor(task);
        const result = overviewResults?.get(task.id);
        const attempts = related(task.id, 'attempt').length;
        const reports = related(task.id, 'evidence').length;
        return <motion.li key={task.id} layout={reduce ? false : 'position'}
          initial={reduce ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
          exit={reduce ? undefined : { opacity: 0 }} transition={{ duration: reduce ? 0 : .18 }}>
          <motion.a className="task-row" href={taskHref(task.id)} {...interaction}>
            <span className="task-row-title">
              <strong>{task.title}</strong>
              <small>{task.classification?.primary ?? 'Class unavailable'} · {date(task.created_at)}</small>
            </span>
            <span className="task-row-state"><small>Task state</small><Status value={result?.queued ? 'queued' : task.state==='verifying'&&activity.recovered?'candidate_recovered':task.state}/></span>
            <span className="task-priority">{control ? control.priority + ' priority' : 'Priority unavailable'}</span>
            <span className="task-counts"><TaskActivityLabel activity={activity}/><small>{attempts} {attempts === 1 ? 'attempt' : 'attempts'} · {reports} imported {reports === 1 ? 'report' : 'reports'}</small></span>
            <span className="task-row-action">{control ? 'Manage' : 'Inspect'}<ChevronRight size={15} aria-hidden="true"/></span>
          </motion.a>
          {result && (result.artifact || result.observedMs != null || result.observedTokens != null) &&
            <div className="task-row-results">
              {result.artifact && <a href={result.artifact.uri} target="_blank" rel="noreferrer"
                aria-label={'Open artifact for ' + task.title}>Open artifact <ArrowRight size={13} aria-hidden="true"/></a>}
              {(result.observedMs != null || result.observedTokens != null) &&
                <a href={taskHref(task.id)} aria-label={'Inspect latest attempt telemetry for ' + task.title}>
                  {result.observedTokens != null ? result.observedTokens.toLocaleString() + ' observed tokens' : null}
                  {result.observedTokens != null && result.observedMs != null ? ' · ' : null}
                  {result.observedMs != null ? (result.observedMs / 1000).toLocaleString(undefined, { maximumFractionDigits:2 }) + ' s observed' : null}
                </a>}
            </div>}
        </motion.li>;
      })}
    </AnimatePresence>
  </ul>;
}

export function TaskExplorer({tasks,controls,related,activityFor,Status,Panel,onCreate,loading,filters,setFilters,work,workActivity}) {
  const interaction=useCardMotion(true);
  const groups=useMemo(()=>organizeTasks(tasks,{...filters,work},controls,workActivity.byTask),[tasks,filters,controls,work,workActivity]);
  const queueViews=['all','active','waiting','review','issues','accepted','archived'];
  if(work!=='all'&&!queueViews.includes(work))queueViews.splice(-1,0,work);
  const states = [...new Set(tasks.map(task => task.state).filter(Boolean))].sort();
  const count = groups.reduce((sum, [, items]) => sum + items.length, 0);
  const field = event => {
    const { name, value } = event.currentTarget;
    setFilters(previous => ({ ...previous, [name]: value }));
  };
  return <Panel title="Task explorer" right={<button className="primary-button" type="button" onClick={onCreate}>
    <Plus size={16} aria-hidden="true"/> Create proposal
  </button>}>
    <nav className="task-work-filters" aria-label="Task activity views">
      {queueViews.map(view=><motion.a key={view} className="quiet-button task-work-filter" href={taskHref(undefined,view)}
        aria-current={work===view?'page':undefined} {...interaction}
        onClick={event=>{if(!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey)setFilters(previous=>({...previous,state:'all'}));}}>
        {view==='all'?'Current Tasks':workLabels[view]}
        <span>{view==='all'?tasks.length-workActivity.counts.archived:workActivity.counts[view]}</span>
      </motion.a>)}
    </nav>
    <div className="task-filters">
      <label>Search <span className="search"><Search size={16} aria-hidden="true"/>
        <input name="query" type="search" value={filters.query} onChange={field} placeholder="Title, objective, or ID"/>
      </span></label>
      <div className="task-filter"><label htmlFor="task-filter-source">Source</label><select id="task-filter-source" name="source" value={filters.source} onChange={field}>
        <option value="all">All Tasks</option><option value="private">Manageable private proposals</option>
      </select></div>
      <div className="task-filter"><label htmlFor="task-filter-state">State</label><select id="task-filter-state" name="state" value={filters.state} onChange={field}>
        <option value="all">{work==='all'?'Current Tasks':'Any state in view'}</option>
        {[...new Set([...states, ...(filters.state === 'all' ? [] : [filters.state])])].map(state =>
          <option key={state} value={state}>{labels(state)}</option>)}
      </select></div>
      <div className="task-filter"><label htmlFor="task-filter-sort">Sort</label><select id="task-filter-sort" name="sort" value={filters.sort} onChange={field}>
        <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
        <option value="priority">Highest priority</option><option value="title">Title</option>
      </select></div>
      <div className="task-filter"><label htmlFor="task-filter-group">Group</label><select id="task-filter-group" name="group" value={filters.group} onChange={field}>
        <option value="none">None</option><option value="state">State</option><option value="category">Category</option>
      </select></div>
    </div>
    <div className="task-result-bar">
      <span role="status"><Filter size={14} aria-hidden="true"/> {count} of {tasks.length} Tasks</span>
      {(filters!==defaultTaskFilters||work!=='all')&&<a className="text-button" href={taskHref()} onClick={()=>setFilters(defaultTaskFilters)}>Reset filters</a>}
    </div>
    {!loading && !count && <p>{tasks.length ? 'No Tasks match these filters.' : 'No Tasks in the current feed.'}</p>}
    {groups.map(([label, items]) => <section key={label} className="task-group" aria-label={labels(label)}>
      {filters.group !== 'none' && <h3>{labels(label)} <span>{items.length}</span></h3>}
      <TaskRows tasks={items} controls={controls} related={related} activityFor={activityFor} Status={Status}/>
    </section>)}
  </Panel>;
}

export function useTaskFilters() {
  return useState(defaultTaskFilters);
}

export function PrerequisiteChecks({graph,Status}) {
  const nodes=[...graph.upstream.map(node=>({...node,type:'Task'})),...graph.capabilities.map(node=>({...node,type:'Capability'}))];
  return nodes.length>0&&<ul className="dependency-nodes" aria-label="Prerequisite checks">{nodes.map(node=>
    <li key={node.type+':'+node.id}><span><small>{node.type}{node.milestone==='merged'?' · Requires merge into main':''}</small> {node.task?.title??node.id}</span><Status value={node.status}/></li>
  )}</ul>;
}

export function TaskDependencies({task,tasks,lifecycle,summaries,Status}) {
  const graph=dependencyGraph(task,tasks,{lifecycle,summaries});
  const renderNodes = (nodes, empty, showStatus) => nodes.length ? <ul className="dependency-nodes">
    {nodes.map(node => <li key={node.id}>
      <span>{node.task ? <a href={taskHref(node.id)}>{node.task.title}</a> : <span className="mono">{node.id}</span>}
        {showStatus&&node.milestone==='merged'&&<small> · Requires merge into main</small>}</span>
      <Status value={showStatus ? node.status : node.task?.state}/>
    </li>)}
  </ul> : <p className="low">{empty}</p>;
  return <>
    <div className="dependency-graph">
      <div><h3>Prerequisite Tasks</h3>{renderNodes(graph.upstream, 'None declared', true)}</div>
      <ArrowDown className="dependency-arrow" size={19} aria-hidden="true"/>
      <div className="dependency-focus"><GitBranch size={16} aria-hidden="true"/><strong>{task.title}</strong></div>
      <ArrowDown className="dependency-arrow" size={19} aria-hidden="true"/>
      <div><h3>Dependent Tasks</h3>{renderNodes(graph.downstream, 'None in the current feed', false)}</div>
    </div>
    <h3 className="subheading">Required capabilities</h3>
    {graph.capabilities.length>0 ? <ul className="dependency-nodes" aria-label="Required capabilities">
      {graph.capabilities.map(node=><li key={node.id}><span>{node.id}{node.reason==='attested'&&<small> · Owner attested</small>}</span>
        <Status value={node.status}/></li>)}
    </ul> : <p className="low">None declared</p>}
  </>;
}

export function TaskCapabilitySummary({ manageable }) {
  return <div className="task-capabilities">
    <h3>Execution controls</h3>
    <p>{manageable ? 'Proposal state and editing are available below.' : 'This source publishes Task records for inspection.'}</p>
    <dl>
      <div><dt>Schedule and dispatch</dt><dd>Unavailable from this Task source</dd></div>
      <div><dt>Pause, resume, stop and retry</dt><dd>Unavailable from this Task source</dd></div>
    </dl>
    <a className="text-button" href="#tasks">Browse Tasks <ArrowRight size={14} aria-hidden="true"/></a>
  </div>;
}

export function TaskActivityLabel({ activity }) {
  return <span className="task-activity-label"><strong>{activity.label}</strong>{activity.at&&<time dateTime={activity.at}>{new Date(activity.at).toLocaleString()}</time>}</span>;
}

const displayTime = value => value==null||!Number.isFinite(new Date(value).getTime())
  ? 'Unavailable' : new Date(value).toLocaleString();

export function TaskAttemptHistory({ attempts, events, audits, evidence, Status }) {
  const [expanded,setExpanded]=useState({});
  const reduce=useReducedMotion();
  if (!attempts.length) return <p>No execution attempt has been linked to this Task yet.</p>;
  return <ol className="task-attempt-records">{[...attempts].reverse().map(attempt=>{
    const history=attemptJournal(attempt,events,audits,evidence);
    const {supervision}=history;
    const elapsed=Date.parse(attempt.finished_at)-Date.parse(attempt.started_at);
    const conversation=codexThreadHref(attempt);
    const count=expanded[attempt.id]??8;
    return <li className="record task-attempt-card" key={attempt.id} id={'task-attempt-'+attempt.id}>
      <div className="record-title"><h3 tabIndex={-1}>Attempt {attempt.attempt_number}</h3><Status value={attempt.state}/></div>
      <dl className="github-facts">
        <div><dt>Executor</dt><dd>{[attempt.executor??attempt.provider,attempt.model].filter(Boolean).join(' / ')||'Unavailable from source'}</dd></div>
        <div><dt>Started</dt><dd>{displayTime(attempt.started_at)}</dd></div>
        <div><dt>Finished</dt><dd>{displayTime(attempt.finished_at)}</dd></div>
        {Number.isFinite(elapsed)&&elapsed>=0&&<div><dt>Elapsed</dt><dd>{(elapsed/1000).toLocaleString(undefined,{maximumFractionDigits:3})} s</dd></div>}
        {Number.isFinite(attempt.deadline)&&<div><dt>Attempt deadline</dt><dd>{displayTime(attempt.deadline)}</dd></div>}
        {supervision.leaseUntil!==null&&<div><dt>{attempt.state==='running'?'Lease deadline':'Last lease deadline'}</dt>
          <dd>{displayTime(supervision.leaseUntil)}</dd></div>}
        {supervision.lastRenewal&&<div><dt>Last successful lease renewal</dt>
          <dd><time dateTime={supervision.lastRenewal}>{displayTime(supervision.lastRenewal)}</time></dd></div>}
        {supervision.provider&&<div><dt>Last observed Codex turn state</dt>
          <dd>{labels(supervision.provider.state)} · <time dateTime={supervision.provider.at}>{displayTime(supervision.provider.at)}</time></dd></div>}
        {supervision.progress&&<div><dt>Last recorded execution progress</dt>
          <dd>{supervision.progress.label} · <time dateTime={supervision.progress.at}>{displayTime(supervision.progress.at)}</time></dd></div>}
        {supervision.recovery&&<div><dt>Recovery</dt><dd>{supervision.recovery}</dd></div>}
        {supervision.recoveryUntil!==null&&<div><dt>Saved candidate recovery deadline</dt>
          <dd>{displayTime(supervision.recoveryUntil)}</dd></div>}
        <div><dt>Base revision</dt><dd><code>{attempt.revision}</code></dd></div>
        {attempt.candidate_revision&&<div><dt>Candidate revision</dt><dd><code>{attempt.candidate_revision}</code></dd></div>}
        {attempt.checkpoint_revision&&<div><dt>Checkpoint revision</dt><dd><code>{attempt.checkpoint_revision}</code></dd></div>}
        {attempt.branch&&<div><dt>Branch</dt><dd><code>{attempt.branch}</code></dd></div>}
        {conversation&&<div><dt>Codex conversation</dt><dd><a href={conversation}><code>{attempt.session_id}</code></a></dd></div>}
      </dl>
      {conversation&&<details className="task-attempt-log">
        <summary>Continue from the worker host</summary>
        <p>Use the same Codex account and session store after the worker has stopped.</p>
        <code>codex resume --include-non-interactive {attempt.session_id}</code>
      </details>}
      {attempt.failure_diagnosis&&<div className="notice error">
        <strong>{attempt.state==='orphaned'?'Execution interrupted':'Failure'}
          {attempt.failure_kind?' · '+labels(attempt.failure_kind):''}</strong>
        <span>{attempt.failure_diagnosis}</span></div>}
      {attempt.checkout_diagnostic&&<dl className="github-facts">
        <div><dt>Checkout ID</dt><dd><code>{attempt.task_id}</code></dd></div>
        <div><dt>Stage</dt><dd>{labels(attempt.checkout_diagnostic.stage)}</dd></div>
        <div><dt>Provisioning duration</dt><dd>{attempt.checkout_diagnostic.duration_ms.toLocaleString()} ms</dd></div>
        <div><dt>Retryable failure</dt><dd>{attempt.checkout_diagnostic.retryable?'Yes':'No'}</dd></div>
        <div><dt>Recovery required</dt><dd>{attempt.checkout_diagnostic.recovery_required?'Yes':'No'}</dd></div>
      </dl>}
      <details className="task-attempt-log" open={attempt===attempts.at(-1)}>
        <summary>Execution log · {history.events.length} recorded events</summary>
        {history.events.length>0?<ol>{history.events.slice(0,count).map(event=>
          <motion.li key={event.id} initial={reduce?false:{opacity:0,y:3}} animate={{opacity:1,y:0}}>
            <div><strong>{labels(event.title??'Execution event')}</strong> <small>{event.source}{event.status?' · '+labels(event.status):''}</small></div>
            <time dateTime={event.at}>{displayTime(event.at)}</time>
            {event.reason&&<p>{event.reason}</p>}
            {event.metrics.length>0&&<ul>{event.metrics.map((metric,index)=><li key={index}>
              {labels(metric.name)} · {metric.availability==='unavailable'?'Unavailable':metric.value??'Unavailable'} {metric.unit} · {metric.availability}
            </li>)}</ul>}
          </motion.li>)}</ol>:<p>No lifecycle receipts or trace events are linked to this attempt.</p>}
        {history.events.length>count&&<button type="button" className="quiet-button" onClick={()=>setExpanded(previous=>({...previous,[attempt.id]:count+16}))}>Show earlier events</button>}
      </details>
      <details className="task-attempt-log">
        <summary>Reported evidence · {history.evidence.length} records</summary>
        {history.evidence.length>0?<ul className="task-links">{history.evidence.map(item=><li key={item.id}>
          <strong>{item.criterion_id} · {labels(item.kind)}</strong><Status value={evidenceClaimStatus(item,attempts)}/>
          <small>Revision <code>{item.revision}</code></small><EvidenceArtifact artifact={item.artifact}/>
        </li>)}</ul>:<p>No evidence records are linked to this attempt and revision.</p>}
      </details>
    </li>;
  })}</ol>;
}

export function TaskAcceptanceMatrix({task,canonical,evidence,attempts,reviewed,Status}) {
  const revision=canonical?.attempts?.at(-1)?.candidate_revision??task.revision;
  return <section aria-label="Task acceptance criteria">{(task.acceptance?.criteria??[]).map(criterion=>{
    const reports=evidence.filter(item=>item.criterion_id===criterion.id);
    const review=reviewed.get(criterion.id);
    return <article className="record" key={criterion.id}>
      <div className="record-title"><strong>{criterion.id}</strong>
        <Status value={review?'owner_accepted':criterionEvidenceStatus(reports,revision,attempts)}/></div>
      <p>{criterion.description}</p>
      {review?<div className="task-review-summary">
        <small>Accepted revision <code>{review.revision}</code></small>
        {review.at&&<small>Owner review <time dateTime={review.at}>{displayTime(review.at)}</time></small>}
        {review.uri&&<EvidenceArtifact artifact={{uri:review.uri}}/>}
      </div>:<small>{reports.length} reported {reports.length===1?'record':'records'}{canonical?.lifecycle.state==='verifying'?' · Awaiting owner review':''}</small>}
    </article>;
  })}</section>;
}

function EvidenceArtifact({ artifact }) {
  const uri = artifact?.uri;
  if (!uri) return <span>No artifact reference was recorded.</span>;
  const internal = taskActivityHref(uri);
  if (internal) return <a href={internal}>Open linked activity</a>;
  try {
    const url = new URL(uri);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.search) {
      return <a href={url.href} target="_blank" rel="noreferrer">Open evidence artifact</a>;
    }
  } catch { /* Local references are displayed as private identifiers only. */ }
  return <details><summary>Private artifact · link unavailable</summary>{uri.startsWith('private-artifact:') && <code>{uri}</code>}</details>;
}

export function TaskEvidenceLedger({ task, evidence, attempts, reviewed, reviewNotes, events, telemetrySource, Status }) {
  const criteria = new Map((task.acceptance?.criteria ?? []).map(item => [item.id,item.description]));
  const {verificationReports} = taskEngineeringActivity({task,attempts,events,telemetrySource});
  if (!evidence.length && !reviewed.length && !verificationReports.length) return <p>No verification results have been linked to this Task yet.</p>;
  const ordered = [...evidence].sort((a,b)=>String(b.observed_at??b.created_at).localeCompare(String(a.observed_at??a.created_at)));
  return <>
    {reviewed.length>0&&<section aria-label="Owner review receipts"><h3>Owner review</h3>
      {reviewNotes&&<p className="objective">{reviewNotes.split(/(\s+)/).map((part,index)=>{
        if(!part.startsWith('https://'))return part;
        try{
          const url=new URL(part);
          if(url.username||url.password||url.search)return part;
          const internal=taskActivityHref(url.href);
          return <a key={index} href={internal??url.href} target={internal?undefined:'_blank'} rel={internal?undefined:'noreferrer'}>{part}</a>;
        }catch{return part;}
      })}</p>}
      <ul className="task-links">{reviewed.map(item=> <li key={item.criterion_id}>
      <strong>{criteria.get(item.criterion_id) ?? item.criterion_id}</strong><small>Reviewed revision <code>{item.revision}</code></small>
      {item.at&&<small>Owner review <time dateTime={item.at}>{displayTime(item.at)}</time></small>}
      {item.uri&&<EvidenceArtifact artifact={{uri:item.uri}}/>}
    </li>)}</ul></section>}
    {ordered.map(item=>{
      const attempt = attempts.find(run=>attemptMatchesEvidence(run,item));
      const stamp = item.observed_at ?? item.created_at;
      return <article className="record task-links" key={item.id}>
        <div className="record-title"><strong>{criteria.get(item.criterion_id) ?? item.criterion_id}</strong><Status value={evidenceClaimStatus(item,attempts)}/></div>
        <dl className="github-facts">
          <div><dt>Evidence type</dt><dd>{labels(item.kind)}{item.synthetic ? ' · Synthetic' : ''}</dd></div>
          <div><dt>Attempt</dt><dd>{attempt ? 'Attempt '+attempt.attempt_number : 'No matching attempt in the feed'}</dd></div>
          <div><dt>{item.observed_at?'Observed':'Recorded'}</dt><dd>{stamp?new Date(stamp).toLocaleString():'Unavailable'}</dd></div>
          <div><dt>Evidence revision</dt><dd><code>{item.revision}</code></dd></div>
        </dl>
        <EvidenceArtifact artifact={item.artifact}/>
      </article>;
    })}
    {verificationReports.length>0&&<section aria-label="Reported verification activity">
      <h3>Reported verification activity</h3>
      {verificationReports.map(item=><details className="record" key={item.id}>
        <summary>{item.title} · <time dateTime={item.at}>{displayTime(item.at)}</time></summary>
        <dl className="github-facts">
          {item.details.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
      </details>)}
    </section>}
  </>;
}

export function RawTaskRecord({ records }) {
  const [open, setOpen] = useState(false);
  return <details onToggle={event => setOpen(event.currentTarget.open)}><summary>Inspect raw records</summary>{open&&<pre className="json">{JSON.stringify(records,null,2)}</pre>}</details>;
}
