import React, {useEffect,useMemo,useRef,useState} from 'react';
import {motion,useReducedMotion} from 'motion/react';
import {Activity, ArrowRight, CheckCircle2, ClipboardCheck, FileCheck2, Flag, GitCommitHorizontal, Search, SlidersHorizontal} from 'lucide-react';
import {buildTaskTimeline,executorHeartbeat,journalReceiptSummary} from './task-timeline.mjs';
import {taskActivityHref} from './github-activity.mjs';
import {taskEngineeringActivity,taskLinkedHref} from './task-activity.mjs';
import {StickySectionAside} from './sticky-section-aside.jsx';

const icons={Task:Flag,Attempt:GitCommitHorizontal,Audit:ClipboardCheck,Trace:Activity,Evidence:FileCheck2,Engineering:GitCommitHorizontal};
const time = value => new Date(value).toLocaleString(undefined,{hour:'numeric',minute:'2-digit',second:'2-digit'});
const day = value => new Date(value).toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'});
const categories=['All','Task','Attempt','Engineering','Audit','Trace','Evidence'];
const filters=[['executor','Executor'],['attemptId','Attempt'],['activityType','Activity type'],['outcome','Outcome']];

const heartbeatLabels = {
  receiving:'Heartbeat received', awaiting:'Awaiting first heartbeat',
  overdue:'Heartbeat overdue', ended:'Last executor heartbeat',
};

function ExecutorHeartbeat({taskId, attempt, state, audits}) {
  const [, refresh] = useState(0);
  const heartbeat = executorHeartbeat({taskId,attempt,state,audits});
  const leaseUntil = heartbeat?.leaseUntil;
  useEffect(() => {
    if (leaseUntil == null || leaseUntil <= Date.now()) return;
    const timer = window.setTimeout(() => refresh(n => n + 1), leaseUntil - Date.now() + 20);
    return () => window.clearTimeout(timer);
  }, [leaseUntil]);
  if (!heartbeat) return null;
  return <div className={'executor-heartbeat heartbeat-' + heartbeat.status} aria-label="Executor heartbeat" role="group">
    <span className={heartbeat.status==='receiving'?'live-dot':'heartbeat-dot'} aria-hidden="true"/>
    <strong role="status">{heartbeatLabels[heartbeat.status]}</strong>
    {heartbeat.lastAt && <time dateTime={heartbeat.lastAt}>{new Date(heartbeat.lastAt).toLocaleString()}</time>}
  </div>;
}

export function TaskTimeline({task,canonical,github,telemetrySource,attempts,events,audits,evidence,records,executorAttempt,executorState,onOpenAttempt}) {
  const reduce=useReducedMotion();
  const known=useMemo(()=>taskEngineeringActivity({task,canonical,attempts,audits,evidence,events,github,telemetrySource}),[task,canonical,attempts,audits,evidence,events,github,telemetrySource]);
  const items=useMemo(()=>buildTaskTimeline({task,attempts,events,audits,evidence,records,engineeringEvents:known.events,telemetrySource}),
    [task,attempts,events,audits,evidence,records,known,telemetrySource]);
  const [filter,setFilter]=useState('All');
  const [criteria,setCriteria]=useState({});
  const [filtersOpen,setFiltersOpen]=useState(false);
  const [selected,setSelected]=useState('');
  const [limit,setLimit]=useState(14);
  const focusDetails=useRef(false);
  const heading=useRef(null);
  const query=criteria.query?.trim().toLowerCase();
  const activeFilters=Object.entries(criteria).filter(([field,value])=>field!=='query'&&value).length;
  const visible=items.filter(item=>{
    const timestamp=Date.parse(item.at);
    return (filter==='All'||item.type===filter) && filters.every(([field])=>!criteria[field]||item[field]===criteria[field]) &&
      (!query||[item.title,item.description,...item.details.map(([,value])=>value)].join(' ').toLowerCase().includes(query)) &&
      (!criteria.from||timestamp>=new Date(criteria.from+'T00:00:00').getTime()) &&
      (!criteria.through||timestamp<=new Date(criteria.through+'T23:59:59.999').getTime());
  });
  const event=visible.find(item=>item.id===selected)??visible[0];
  const activeId=event?.id;
  const activity=taskLinkedHref(event?.href);
  function updateCriterion(field,value){setCriteria(previous=>({...previous,[field]:value}));setLimit(14);}
  function focusEventDetails(){
    const title=heading.current;
    if(!title)return;
    title.focus({preventScroll:true});
    const area=title.getBoundingClientRect();
    if(area.top<0||area.bottom>window.innerHeight){
      title.scrollIntoView({block:'nearest',behavior:reduce?'instant':'smooth'});
    }
  }

  useEffect(()=>{
    if(!focusDetails.current||!heading.current)return;
    focusDetails.current=false;
    focusEventDetails();
  },[activeId,reduce]);
  function open(id){
    if(id===activeId){
      focusEventDetails();
      return;
    }
    focusDetails.current=true;
    setSelected(id);
  }

  return <section className="task-timeline" aria-label="Task timeline">
    <dl className="github-facts task-telemetry-coverage">
      {known.counts.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value??'Unavailable'}</dd></div>)}
    </dl>
    <p className="low">{known.coverage} Trace events are ordered by journal occurrence. {journalReceiptSummary(items)}</p>
    <div className="task-timeline-toolbar">
      <nav aria-label="Timeline filters" className="task-timeline-filters">
        {categories.filter(kind=>kind==='All'||items.some(item=>item.type===kind)).map(kind=>
          <button type="button" className="quiet-button" key={kind} aria-pressed={filter===kind} onClick={()=>{setFilter(kind);setLimit(14);}}>{kind}</button>)}
      </nav>
      <ExecutorHeartbeat taskId={task.id} attempt={executorAttempt} state={executorState} audits={audits}/>
    </div>
    <div className="task-timeline-search">
      <label className="search">
        <Search size={16} aria-hidden="true"/>
        <input type="search" aria-label="Search timeline" placeholder="Search timeline" value={criteria.query??''}
          onChange={event=>updateCriterion('query',event.target.value)}/>
      </label>
      <button type="button" className="quiet-button" aria-expanded={filtersOpen} aria-controls="timeline-filter-fields"
        onClick={()=>setFiltersOpen(open=>!open)}>
        <SlidersHorizontal size={15} aria-hidden="true"/> Filters{activeFilters>0&&` (${activeFilters})`}
      </button>
    </div>
    <div className="task-filters task-timeline-filter-fields" id="timeline-filter-fields" hidden={!filtersOpen}>
      {filters.map(([field,label])=><label className="task-filter" key={field}>{label}<select value={criteria[field]??''}
        onChange={event=>updateCriterion(field,event.target.value)}><option value="">All</option>
        {[...new Set(items.map(item=>item[field]).filter(Boolean))].sort().map(value=>
          <option key={value} value={value}>{field==='attemptId'?'Attempt '+(attempts.find(attempt=>attempt.id===value)?.attempt_number??value):human(value)}</option>)}
      </select></label>)}
      <label>From<input type="date" value={criteria.from??''} onChange={event=>updateCriterion('from',event.target.value)}/></label>
      <label>Through<input type="date" value={criteria.through??''} onChange={event=>updateCriterion('through',event.target.value)}/></label>
    </div>
    {(query||activeFilters>0)&&<div className="task-result-bar">
      <span role="status">{visible.length} of {items.length} events</span>
      <button type="button" className="text-button" onClick={()=>{setCriteria({});setLimit(14);}}>Clear filters</button>
    </div>}
    <div className="task-timeline-grid">
      <div>
        {visible.length===0 ? <p>{items.length?'No events match these filters.':'No dated events are available for this Task.'}</p> :
          <ol className="task-timeline-list">{visible.slice(0,limit).map((item,index)=>{
            const Icon=item.milestone?CheckCircle2:icons[item.type];
            const startsDay=index===0||day(item.at)!==day(visible[index-1].at);
            return <li key={item.id} className={'task-timeline-entry'+(startsDay?' starts-day':'')}>
              {startsDay&&<strong className="task-timeline-day">{day(item.at)}</strong>}
              <button type="button" className={'task-timeline-event'+(item.milestone?' milestone':'')} aria-current={item.id===activeId?'true':undefined}
                aria-controls="task-timeline-details" onClick={()=>open(item.id)}>
                <time dateTime={item.at}>{time(item.at)}</time>
                <span className={'task-timeline-node node-'+item.type.toLowerCase()}><Icon size={15} aria-hidden="true"/></span>
                <span className="task-timeline-label"><strong>{item.title}</strong>{item.description&&<small>{item.description}</small>}</span>
                <ArrowRight className="task-timeline-arrow" size={14} aria-hidden="true"/>
              </button>
            </li>;
          })}</ol>}
        {visible.length>limit&&<button type="button" className="quiet-button" onClick={()=>setLimit(previous=>previous+14)}>Show earlier events</button>}
      </div>
      {event&&<StickySectionAside as="aside" id="task-timeline-details" className="task-timeline-details" aria-label="Selected timeline event">
        <motion.div key={event.id} initial={reduce?false:{opacity:0}} animate={{opacity:1}} transition={{duration:reduce?0:.18}}>
          <span className="task-timeline-kind">{event.milestone?'Owner acceptance':event.type}</span>
          <h3 ref={heading} tabIndex={-1}>{event.title}</h3>
          <p>Recorded occurrence <time dateTime={event.at} title={event.at}>{new Date(event.at).toLocaleString()}</time></p>
          {event.description&&<p>{event.description}</p>}
          {event.details.length>0&&<dl className="github-facts">{event.details.map(([label,value])=><div key={label+':'+value}>
            <dt>{label}</dt><dd>{label==='Merge commit'&&value===event.mergeCommitHref
              ?<a href={event.mergeCommitHref}>{value.slice(-40)}</a>:value}</dd>
          </div>)}</dl>}
          {event.measurements?.length>0&&<ul className="task-timeline-measurements">{event.measurements.map((metric,index)=><li key={index}>
            {human(metric.name)} · {metric.availability==='unavailable'?'Unavailable':metric.value??'Unavailable'} {metric.unit} · {metric.availability}
          </li>)}</ul>}
          {event.attemptId&&onOpenAttempt&&<button type="button" className="text-button" onClick={()=>onOpenAttempt(event.attemptId)}>Open attempt details <ArrowRight size={14} aria-hidden="true"/></button>}
          {activity&&<a className="text-button" href={activity}>Open linked activity <ArrowRight size={14} aria-hidden="true"/></a>}
          {event.reviewedEvidence?.length>0&&<ul>{event.reviewedEvidence.map(item=>{
            const href=taskActivityHref(item.uri);
            return <li key={item.criterion_id}>{href?<a href={href}>{item.criterion_id}</a>:item.criterion_id} · {item.revision}</li>;
          })}</ul>}
        </motion.div>
      </StickySectionAside>}
    </div>
    {known.references.length>0&&<details>
      <summary>Linked engineering references ({known.references.length})</summary>
      <ul>{known.references.map(ref=><li key={ref.id}>
        <a href={taskLinkedHref(ref.url)}>{ref.label}</a>{' · '}{ref.revisions.map(revision=>revision.slice(0,10)).join(', ')}
        {ref.provenance&&<small className="row-meta">{ref.provenance}{ref.source_status?' · '+ref.source_status+' snapshot':''}</small>}
      </li>)}</ul>
    </details>}
  </section>;
}

const human = value => String(value??'').replaceAll('_',' ');
