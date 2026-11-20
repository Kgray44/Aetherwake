import { criterionEvidenceStatus,ownerReviewByCriterion } from './evidence-status.mjs';
import { buildTaskTimeline } from './task-timeline.mjs';
import { buildEngineeringAnalytics } from './engineering-analytics.mjs';
import { desktopSessionTokens, taskTokenRows } from './task-engine-client.mjs';
import { traceTimeline } from './trace-timeline.mjs';
import { activityId, taskActivityHref } from './github-activity.mjs';

const words = value => value.replaceAll('_',' ');
const display = value => value == null ? 'Unavailable' : String(value);

function fields(record, prefix='') {
  return Object.entries(record ?? {}).flatMap(([key,value]) => {
    const label = prefix ? prefix+' / '+words(key) : words(key);
    return value && typeof value === 'object' && Object.keys(value).length
      ? fields(value,label) : [[label, Array.isArray(value) ? 'None' : display(value)]];
  });
}

function collectMeasurements(records) {
  return records.flatMap(record => (record.measurements ?? []).map(metric => ({
    at:record.occurred_at ?? record.observed_at ?? record.created_at,
    attempt:record.attempt_id, phase:record.phase, record:record.id ?? record.event_id, ...metric,
  })));
}

const section = (title, count) => ({text:count==null ? title : title+'  ·  '+count, style:'section'});
const subhead = title => ({text:title,style:'subhead'});
const none = {text:'No linked records in this snapshot.',style:'muted'};
const blocks = (items,title,represent = fields) => items.length ? items.flatMap((item,index) => [
  subhead(title(item,index)), ...represent(item).map(([label,value]) => ({
    text:[{text:label+'   ',bold:true,color:'#28516a'},value], margin:[0,0,0,3],
  })),
]) : [none];
const grid = (headers,rows,widths) => rows.length ? {
  layout:'lightHorizontalLines', table:{headerRows:1,widths,body:[
    headers.map(text=>({text,bold:true,fillColor:'#dcebef',color:'#163749'})),
    ...rows.map(row=>row.map(display)),
  ]}, fontSize:8,
} : none;

export function taskReportDefinition({task, canonical, records=[], events=[], audits=[], attempts=[], github, coverage, generatedAt}) {
  const taskRecords=records.filter(record=>record.task_id===task.id);
  const taskEvents=events.filter(event=>event.task_id===task.id);
  const taskAudits=audits.filter(audit=>!audit.target_id||audit.target_id===task.id);
  const taskAttempts=attempts.filter(attempt=>attempt.task_id===task.id);
  const evidence=taskRecords.filter(record=>record.record_type==='evidence');
  const reviewed=ownerReviewByCriterion(task,canonical);
  const reviewRevision=canonical?.attempts?.at(-1)?.candidate_revision??task.revision;
  const criteria=(task.acceptance?.criteria??[]).map(criterion=>{
    const receipt=reviewed.get(criterion.id);
    const reports=evidence.filter(item=>item.criterion_id===criterion.id);
    return {criterion:criterion.description,id:criterion.id,
      status:receipt?'Owner accepted':words(criterionEvidenceStatus(reports,reviewRevision,taskAttempts)),
      reported_records:reports.length,
      ...(receipt?{accepted_revision:receipt.revision,...(receipt.at?{reviewed_at:receipt.at}:{}),reviewed_artifact:receipt.uri}:{})};
  });
  const timeline=buildTaskTimeline({task,attempts:taskAttempts,events:taskEvents,audits:taskAudits,evidence,records:taskRecords});
  const measurements=collectMeasurements([...taskRecords,...taskEvents]);
  const trace=traceTimeline(taskEvents);
  const tokenAccounting=buildEngineeringAnalytics({records:[task,...taskRecords],events:taskEvents}).tokenAccounting;
  const tokens=taskTokenRows(tokenAccounting,task.id);
  const desktop=desktopSessionTokens(task.id,taskEvents);
  const urls=new Set([
    ...(canonical?.lifecycle.links??[]).map(link=>link.uri),
    ...(canonical?.lifecycle.evidence??[]).map(link=>link.uri),
    ...evidence.map(item=>item.artifact?.uri),
    ...taskAudits.flatMap(item=>[item.reference?.uri,...(item.evidence??[]).map(link=>link.uri)]),
  ].map(taskActivityHref).filter(Boolean));
  const linkedActivity=[
    ...(github?.pulls?.items??[]).filter(item=>urls.has('#pull-requests/'+activityId('pulls',item))),
    ...(github?.ci?.items??[]).filter(item=>urls.has('#ci-runs/'+activityId('runs',item))),
  ];

  return {
    pageSize:'A4',pageMargins:[44,47,44,46],
    info:{title:task.title+' — Task report',author:'Aetherwake Engineering Observatory'},
    defaultStyle:{fontSize:9,lineHeight:1.15,color:'#142b3b'},
    header:{text:'AETHERWAKE  /  ENGINEERING OBSERVATORY',margin:[44,18,44,0],style:'muted'},
    footer:(page,total)=>({columns:[{text:task.id},{text:page+' / '+total,alignment:'right'}],
      margin:[44,13,44,0],style:'muted'}),
    styles:{
      title:{fontSize:24,bold:true,color:'#0c2839',margin:[0,0,0,10]},
      section:{fontSize:15,bold:true,color:'#113c50',margin:[0,14,0,6]},
      subhead:{fontSize:10,bold:true,color:'#194e65',margin:[0,8,0,4]},
      muted:{fontSize:8,color:'#506775'},
    },
    content:[
      {text:'TASK DATA REPORT',style:'muted',margin:[0,0,0,7]},
      {text:task.title,style:'title'},
      {text:task.objective,margin:[0,0,0,10]},
      grid(['State','Owner decision','Generated (UTC)'],[[canonical?.lifecycle.state??task.state,task.owner_acceptance,generatedAt]],['*','*','*']),
      section('Report coverage'),
      {text:coverage??'Snapshot of the Task data available to the Observatory. Times use UTC. Unavailable readings retain their source status.',margin:[0,0,0,7]},
      grid(['Timeline entries','Attempts','Execution events','Measurement samples','Evidence records'],
        [[timeline.length,taskAttempts.length,taskEvents.length,measurements.length,evidence.length]],['*','*','*','*','*']),
      section('Task record and acceptance criteria'),
      ...blocks([task],()=>task.id),
      ...(canonical ? blocks([{version:canonical.version,priority:canonical.priority,...canonical.lifecycle}],()=> 'Canonical lifecycle') : []),
      section('Acceptance criteria and owner review',criteria.length),
      ...blocks(criteria,item=>item.id+'  ·  '+item.status),
      section('Task Timeline',timeline.length),
      ...blocks(timeline,item=>item.at+'  ·  '+item.title,item=>[
        ['Category',item.type], ...(item.description?[['Summary',item.description]]:[]), ...item.details,
        ...(item.href?[['Reference',item.href]]:[]),
      ]),
      section('Execution attempts',taskAttempts.length),
      ...blocks(taskAttempts,item=>'Attempt '+item.attempt_number,item=>{
        const duration=Date.parse(item.finished_at)-Date.parse(item.started_at);
        return [...fields(item),['Elapsed milliseconds',Number.isFinite(duration)&&duration>=0?String(duration):'Unavailable']];
      }),
      section('Execution trace and phase timing'),
      {text:'Covered trace milliseconds   '+display(trace.coveredMs)},
      grid(['Phase','Covered milliseconds','Intervals'],trace.phases.map(phase=>[
        words(phase.phase),phase.coveredMs,trace.spans.filter(span=>span.complete&&span.phase===phase.phase).length,
      ]),['*','*','*']),
      section('Model and token accounting',tokens.length),
      ...blocks(tokens,item=>'Attempt '+(item.attemptNumber??item.attemptId)),
      ...blocks(desktop,item=>words(item.name)),
      section('Recorded telemetry and measurement samples',measurements.length),
      ...blocks(measurements,item=>words(item.name??'Measurement')),
      section('Evidence ledger and linked engineering activity'),
      ...blocks(evidence,item=>words(item.kind??'Evidence')+'   '+item.id),
      ...blocks(linkedActivity,item=>item.title??item.name??String(activityId('runs',item))),
      section('Source records'),
      ...blocks(taskAudits,item=>(item.at??'Time unavailable')+'  ·  '+words(item.kind??item.type??'Operation')),
      ...blocks(taskEvents,item=>(item.occurred_at??'Time unavailable')+'  ·  '+words(item.kind??'Execution event')),
      ...blocks(taskRecords.filter(item=>item.record_type!=='evidence'),item=>words(item.record_type)+'  ·  '+item.id),
    ],
  };
}