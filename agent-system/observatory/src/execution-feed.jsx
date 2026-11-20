import React, { useMemo, useState } from 'react';
import { recurringTraceBottlenecks, traceTimeline } from './trace-timeline.mjs';
import { AutomaticTelemetry } from './automatic-telemetry.jsx';

const emptyEvents = [];
const limits = { spans: 80, events: 100 };
const timeLabel = ms => ms === null ? 'Unavailable' : ms < 1000
  ? `${ms.toFixed(0)} ms` : `${(ms / 1000).toFixed(2)} s`;

function Measurements({ events }) {
  return events.map(event => <div className="record" key={event.event_id}>
    <strong>{event.phase} · {event.state ?? event.kind}</strong>
    <small> {event.occurred_at}</small>
    {event.measurements?.map((metric, index) => <p key={index}>
      {metric.name}: {metric.availability === 'unavailable'
        ? 'Unavailable' : `${metric.value ?? 'Unavailable'} ${metric.unit ?? ''}`}
      {' · '}{metric.availability} · source {metric.source ?? 'Unavailable'} · {metric.method ?? 'Method unavailable'}
      {typeof metric.coverage === 'number' && ` · ${Math.round(metric.coverage * 100)}% coverage`}
    </p>)}
  </div>);
}

export function TraceWaterfall({ events, fixedTask }) {
  const [task, setTask] = useState('');
  const [attempt, setAttempt] = useState('');
  const [focused, setFocused] = useState('');
  const [showEvents, setShowEvents] = useState(false);
  const tasks = useMemo(() => [...new Set(events.map(event => event.task_id))].sort(), [events]);
  const selectedTask = fixedTask ?? (tasks.includes(task) ? task : tasks[0]);
  const taskEvents = useMemo(() => events.filter(event => event.task_id === selectedTask), [events, selectedTask]);
  const attempts = useMemo(() => [...new Set(taskEvents.map(event => event.attempt_id).filter(Boolean))].sort(), [taskEvents]);
  const selectedAttempt = attempts.includes(attempt) ? attempt : '';
  const visibleEvents = useMemo(() => selectedAttempt
    ? taskEvents.filter(event => event.attempt_id === selectedAttempt) : taskEvents,
    [taskEvents, selectedAttempt]);
  const timeline = useMemo(() => traceTimeline(visibleEvents), [visibleEvents]);
  if (!events.length) return <p className="low">No execution traces have been imported.</p>;
  const visible = timeline.spans.slice(-limits.spans);
  const first = visible[0]?.at ?? 0;
  const last = Math.max(first, ...visible.map(span => span.complete ? span.end : span.at));
  const range = Math.max(last - first, 1);
  const detail = visible.find(span => span.key === focused);

  return <div className="trace-view">
    <div className="form form-grid">
      {!fixedTask && <label>Task <select value={selectedTask} onChange={event => {
        setTask(event.target.value); setAttempt(''); setFocused('');
      }}>
        {tasks.map(id => <option key={id}>{id}</option>)}
      </select></label>}
      <label>Attempt <select value={selectedAttempt} onChange={event => {
        setAttempt(event.target.value); setFocused('');
      }}>
        <option value="">All attempts</option>
        {attempts.map(id => <option key={id}>{id}</option>)}
      </select></label>
    </div>
    <p>{timeLabel(timeline.coveredMs)} covered by matched span timestamps · {timeline.incomplete} incomplete spans.</p>
    <p className="low">Overlaps count once in this coverage. Critical path is unavailable without operation dependencies.</p>
    {timeline.phases.length > 0 && <details className="trace-phases">
      <summary>Time covered by phase</summary>
      <dl>{timeline.phases.map(phase => <div key={phase.phase}>
        <dt>{phase.phase}</dt><dd>{timeLabel(phase.coveredMs)}</dd>
      </div>)}</dl>
    </details>}
    {visible.length > 0 && <div className="trace-range-label"><span>{new Date(first).toISOString()}</span><span>+{timeLabel(last - first)}</span></div>}
    <div className="trace-rows" aria-label="Trace waterfall">
      {visible.map(span => <button type="button" className="trace-row quiet-button" key={span.key}
        aria-pressed={focused === span.key} onClick={() => setFocused(focused === span.key ? '' : span.key)}>
        <span>{span.parent && '↳ '}{span.phase} · {span.complete ? span.outcome ?? 'Observed' : 'Incomplete'}</span>
        <span className="trace-track" aria-hidden="true"><span
          className={span.complete ? 'trace-bar' : 'trace-marker'}
          style={{ left: `${100 * (span.at - first) / range}%`, width: span.complete ? `${100 * (span.end - span.start) / range}%` : undefined }}
        /></span>
        <span>{timeLabel(span.monotonicMs)}</span>
      </button>)}
    </div>
    {timeline.spans.length > limits.spans && <p>Showing the latest {limits.spans} of {timeline.spans.length} spans.</p>}
    {detail && <section aria-label="Selected span measurements">
      <p className="mono">{detail.id}{detail.parent && ` · parent ${detail.parent}`}</p>
      <Measurements events={detail.events}/>
    </section>}
    <details onToggle={event => setShowEvents(event.currentTarget.open)}>
      <summary>Recent trace events</summary>
      {showEvents && <><Measurements events={visibleEvents.slice(-limits.events)}/>
        {visibleEvents.length > limits.events && <p>Showing the latest {limits.events} of {visibleEvents.length} events.</p>}</>}
    </details>
  </div>;
}
export function ExecutionFeed({execution,records,headers,onRefresh,automatic}){
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 async function upload(event){
  const file=event.target.files?.[0];if(!file)return;
  if(file.size>1048576){setMessage('Export exceeds 1 MiB.');return;}
  setBusy(true);
  try{
   const body=await file.text();JSON.parse(body);
   const response=await fetch('/api/sync',{method:'POST',headers:{...headers,'content-type':'application/json'},body});
   if(!response.ok)throw Error('Import rejected (HTTP '+response.status+').');
   setMessage('Private projection updated. No execution or approval was initiated.');await onRefresh();
  }catch(error){setMessage(error.message)}finally{setBusy(false);event.target.value=''}
 }
 const events=execution?.events??emptyEvents;
 const bottlenecks=useMemo(() => recurringTraceBottlenecks(records??[], events), [records, events]);
 return <section className="panel"><div className="panel-heading"><div><div className="kicker">PRIVATE EXECUTION PROJECTION</div><h2>Measured execution</h2></div></div>
 <p>Connected AADS Task runners deliver sanitized journal updates automatically. Local Task records remain authoritative.</p>
 <p><a href="https://github.com/Kgray44/Aetherwake/blob/main/agent-system/observatory/README.md#automatic-delivery-from-the-local-task-runner">Connect a Task runner</a></p>
 <details><summary>Recovery imports</summary>
 <AutomaticTelemetry connection={automatic}/>
 <label className="quiet-button">Import sanitized export <input aria-label="Import sanitized private execution export" type="file" accept="application/json" disabled={busy} onChange={upload}/></label>
 <p role="status">{message}</p>
 </details>
 <p>Latest source snapshot: {execution?.generated_at??'Unavailable'}. {events.length} recorded trace events. Uninstrumented time and owner acceptance require separate evidence.</p>
 {execution?.sources?.length > 0 && <details><summary>Automatic delivery receipts</summary>
   <ul>{execution.sources.map(source => <li key={source.task_id}>
     {source.task_id} · received {source.received_at} · {source.records} records · {source.events} events
   </li>)}</ul>
 </details>}
 <TraceWaterfall events={events}/>
 {events.length>0 && <details>
   <summary>Recurring timing patterns</summary>
   {bottlenecks.length ? <ul>{bottlenecks.map(signal => <li key={signal.taskClass}>
     {signal.phase} covered the most recorded time on {signal.dominantTasks} of {signal.comparableTasks} comparable {signal.taskClass} Tasks
     {' · '}median {timeLabel(signal.medianMs)} among those Tasks.
     {' '}{signal.phase === 'verification'
       ? 'Compare a focused check against the same required coverage.'
       : 'Inspect this phase for a repeated operation or wait.'}
   </li>)}</ul> : <p>At least three comparable Tasks need the same longest recorded phase to show a recurring pattern.</p>}
   <small>Only matched intervals contribute. Coverage can vary by Task and timing alone does not identify a cause.</small>
 </details>}
 </section>
}
