import React,{useState} from 'react';
export function ExecutionFeed({execution,headers,onRefresh}){
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
 const events=execution?.events??[];
 return <section className="panel"><div className="panel-heading"><div><div className="kicker">PRIVATE EXECUTION PROJECTION</div><h2>Measured execution</h2></div></div>
 <p>Import an explicitly sanitized local export. Raw journals, prompts and command output must stay local. Local Task records remain authoritative; this Site cannot approve or execute them.</p>
 <label className="quiet-button">Import sanitized export <input aria-label="Import sanitized private execution export" type="file" accept="application/json" disabled={busy} onChange={upload}/></label>
 <p role="status">{message}</p>
 <p>Last synchronization: {execution?.generated_at??'Unavailable'}. {events.length} recorded trace events. Uninstrumented time is unavailable, not zero. Imported evidence is a reported claim, not independently verified approval.</p>
 {events.slice(-100).map(event=><div className="record" key={event.event_id}><strong>{event.phase??event.kind} · {event.state??event.kind}</strong><small> {event.occurred_at} · {event.task_id}</small>{event.measurements?.map((m,i)=><p key={i}>{m.name}: {m.availability==='unavailable'?'Unavailable':String(m.value??'Unavailable')} {m.unit} · {m.availability} · source: {m.source??'Unavailable'} · method: {m.method??'Unavailable'}{typeof m.coverage==='number'?' · coverage '+Math.round(m.coverage*100)+'%':''}</p>)}</div>)}
 {events.length>100&&<p>Showing the latest 100 of {events.length} imported events.</p>}
 </section>
}
