import React, {useMemo,useState} from 'react';
import {executionTiming,timingLegend} from './execution-timing.mjs';
import {taskEngineeringActivity,taskLinkedHref} from './task-activity.mjs';
import {traceTimeline} from './trace-timeline.mjs';

const utc = value => new Date(value).toISOString();
const duration = value => value == null ? 'Unavailable' : value < 1000 ? value+' ms' : (value/1000).toFixed(2)+' s';
const labels = {attempt:'Attempt window',wait:'Lifecycle interval',trace:'Trace span',engineering:'Linked event'};

export function TaskExecutionTiming({task,canonical,attempts,events,audits,evidence,github,telemetrySource,onOpenAttempt}) {
  const [selected,setSelected] = useState(null);
  const [limit,setLimit] = useState(16);
  const [attemptFilter,setAttemptFilter] = useState('');
  const filteredAttempt = attempts.find(attempt=>attempt.id===attemptFilter);
  const timing = useMemo(()=>{
    const {events:linkedEvents} = taskEngineeringActivity({task,canonical,attempts,audits,evidence,events,github,telemetrySource});
    const spans = traceTimeline(events).spans;
    return executionTiming({taskId:task.id,canonical,
      attempts:filteredAttempt?[filteredAttempt]:attempts,
      spans:filteredAttempt?spans.filter(span=>span.attempt===filteredAttempt.id):spans,
      linkedEvents:filteredAttempt?linkedEvents.filter(event=>event.attemptId===filteredAttempt.id):linkedEvents});
  },[task,canonical,attempts,events,audits,evidence,github,telemetrySource,filteredAttempt]);
  const item = timing.rows.find(row=>row.id===selected);
  return <section className="trace-view execution-timing" aria-label="Execution timing">
    <p>{timingLegend}</p>
    {attempts.length>0&&<div className="form form-grid"><label>Timing range
      <select value={filteredAttempt?.id??''} onChange={event=>{setAttemptFilter(event.target.value);setSelected(null);setLimit(16);}}>
        <option value="">All recorded activity</option>
        {attempts.map(attempt=><option key={attempt.id} value={attempt.id}>Attempt {attempt.attempt_number}</option>)}
      </select>
    </label></div>}
    <dl className="github-facts task-telemetry-coverage">
      <div><dt>Recorded trace coverage</dt><dd>{duration(timing.coveredMs)}</dd></div>
      <div><dt>Time with overlapping spans</dt><dd>{duration(timing.overlapMs)}</dd></div>
      <div><dt>Attempt or span timing unavailable</dt><dd>{timing.unavailable}</dd></div>
    </dl>
    {timing.rows.length>0?<div className="trace-range-label"><span>{utc(timing.start)}</span><span>{utc(timing.end)}</span></div>:
      <p>No dated attempt windows, paired trace spans, or linked engineering events are available for this view.</p>}
    <div className="trace-rows" role="group" aria-label="Recorded timing rows">
      {timing.rows.slice(-limit).map(row=>{
        const marker = row.elapsedMs===null||row.elapsedMs===0;
        return <button type="button" className="trace-row quiet-button" key={row.id} aria-pressed={selected===row.id}
          onClick={()=>setSelected(selected===row.id?null:row.id)}>
          <span>{row.label}<small>{labels[row.kind]}{row.attemptNumber==null?'':' · attempt '+row.attemptNumber}</small></span>
          <span className="trace-track" aria-hidden="true"><span
            className={(marker?'trace-marker':'trace-bar')+' timing-'+row.kind}
            style={{left:marker?'min('+row.offset*100+'%, calc(100% - 3px))':row.offset*100+'%',width:marker?undefined:row.width*100+'%'}}/>
          </span>
          <span>{row.kind==='engineering'?'Event':duration(row.elapsedMs)}</span>
        </button>;
      })}
    </div>
    {timing.rows.length>limit&&<button className="quiet-button" type="button" onClick={()=>setLimit(previous=>previous+16)}>
      Show earlier timing rows ({timing.rows.length-limit})
    </button>}
    {item&&<section aria-label="Selected timing details">
      <h3>{item.label}</h3>
      <dl className="github-facts">
        <div><dt>Source</dt><dd>{item.source}</dd></div>
        <div><dt>{item.kind==='engineering'?'Recorded occurrence':'Recorded start'}</dt><dd>{item.startedAt??utc(item.start)}</dd></div>
        {item.kind!=='engineering'&&<div><dt>Recorded end</dt><dd>{item.end===null?'Unavailable':item.finishedAt??utc(item.end)}</dd></div>}
        {item.monotonicMs!=null&&<div><dt>Monotonic duration</dt><dd>{duration(item.monotonicMs)}</dd></div>}
        {item.state&&<div><dt>Outcome</dt><dd>{item.state}</dd></div>}
        {item.spanId&&<div><dt>Span</dt><dd>{item.spanId}</dd></div>}
        {item.parent&&<div><dt>Parent span</dt><dd>{item.parent}</dd></div>}
        {item.revision&&<div><dt>Revision</dt><dd>{item.revision}</dd></div>}
      </dl>
      {item.attemptId&&<button type="button" className="text-button" onClick={()=>onOpenAttempt(item.attemptId)}>Open attempt details</button>}
      {item.url&&taskLinkedHref(item.url)&&<a href={taskLinkedHref(item.url)}>Open linked event</a>}
    </section>}
  </section>;
}
