import React, {useEffect,useMemo,useRef,useState} from 'react';
import {motion,useReducedMotion} from 'motion/react';
import {Activity, ArrowRight, CheckCircle2, ClipboardCheck, FileCheck2, Flag, GitCommitHorizontal} from 'lucide-react';
import {buildTaskTimeline,executorHeartbeat} from './task-timeline.mjs';
import {taskActivityHref} from './github-activity.mjs';
import {StickySectionAside} from './sticky-section-aside.jsx';

const icons={Task:Flag,Attempt:GitCommitHorizontal,Audit:ClipboardCheck,Trace:Activity,Evidence:FileCheck2};
const time = value => new Date(value).toLocaleString(undefined,{hour:'numeric',minute:'2-digit',second:'2-digit'});
const day = value => new Date(value).toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'});
const categories=['All','Task','Attempt','Audit','Trace','Evidence'];

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

export function TaskTimeline({task,attempts,events,audits,evidence,records,executorAttempt,executorState,onOpenAttempt}) {
  const reduce=useReducedMotion();
  const items=useMemo(()=>buildTaskTimeline({task,attempts,events,audits,evidence,records}),[task,attempts,events,audits,evidence,records]);
  const [filter,setFilter]=useState('All');
  const [selected,setSelected]=useState('');
  const [limit,setLimit]=useState(14);
  const focusDetails=useRef(false);
  const heading=useRef(null);
  const visible=filter==='All'?items:items.filter(item=>item.type===filter);
  const event=visible.find(item=>item.id===selected)??visible[0];
  const activeId=event?.id;
  const activity=taskActivityHref(event?.href);
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
    <div className="task-timeline-toolbar">
      <nav aria-label="Timeline filters" className="task-timeline-filters">
        {categories.filter(kind=>kind==='All'||items.some(item=>item.type===kind)).map(kind=>
          <button type="button" className="quiet-button" key={kind} aria-pressed={filter===kind} onClick={()=>{setFilter(kind);setLimit(14);}}>{kind}</button>)}
      </nav>
      <ExecutorHeartbeat taskId={task.id} attempt={executorAttempt} state={executorState} audits={audits}/>
    </div>
    <div className="task-timeline-grid">
      <div>
        {visible.length===0 ? <p>No dated events are available for this Task.</p> :
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
          <p><time dateTime={event.at}>{new Date(event.at).toLocaleString()}</time></p>
          {event.description&&<p>{event.description}</p>}
          {event.details.length>0&&<dl className="github-facts">{event.details.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
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
  </section>;
}

const human = value => String(value??'').replaceAll('_',' ');
