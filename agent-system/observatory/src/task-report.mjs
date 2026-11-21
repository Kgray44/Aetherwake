import { criterionEvidenceStatus,ownerReviewByCriterion } from './evidence-status.mjs';
import { taskNextAction } from './task-engine-client.mjs';
import { buildTaskTimeline, journalReceiptSummary } from './task-timeline.mjs';
import { formatReferenceCost, openAIReferenceBasis } from './openai-pricing.mjs';
import { taskUsageAccounting, usageFields } from './task-usage-accounting.mjs';
import { traceTimeline } from './trace-timeline.mjs';
import { executionTiming,timingLegend } from './execution-timing.mjs';
import { taskEngineeringActivity } from './task-activity.mjs';
import { taskExecutionDiagnostics } from './task-execution-diagnostics.mjs';
import { taskDataCoverage } from './task-data-coverage.mjs';
import { integrationMilestones, integrationWorkflowTiming, integrationRepairPricing, integrationLogFact } from './integration-analytics.mjs';
import { developmentNoteBytes, notesCategory, taskDevelopmentNotes } from '../development-notes.mjs';

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

const section = (title, count) => ({text:count==null ? title : title+'  ·  '+count, style:'section',tocItem:true});
const subhead = title => ({text:title,style:'subhead'});
const none = {text:'No linked records in this snapshot.',style:'muted'};
const linkedValue = value => typeof value === 'string' && /^https:\/\/[^\s]+$/.test(value)
  ? {text:value,link:value,color:'#0e6077',decoration:'underline'} : value;
const blocks = (items,title,represent = fields) => items.length ? items.flatMap((item,index) => [
  subhead(title(item,index)), ...represent(item).map(([label,value]) => ({
    text:[{text:label+'   ',bold:true,color:'#28516a'},linkedValue(value)], margin:[0,0,0,3],
  })),
]) : [none];
const grid = (headers,rows,widths) => rows.length ? {
  layout:'lightHorizontalLines', table:{headerRows:1,widths,body:[
    headers.map(text=>({text,bold:true,fillColor:'#dcebef',color:'#163749'})),
    ...rows.map(row=>row.map(display)),
  ]}, fontSize:8,
} : none;

function timingChart(timing) {
  if (!timing.rows.length) return [none];
  const width=130, colors={attempt:'#456b9d',wait:'#6a5a93',trace:'#18788b',engineering:'#906327'};
  const utc=value=>new Date(value).toISOString();
  return [
    {text:timingLegend,style:'muted'},
    {text:utc(timing.start)+' to '+utc(timing.end),style:'muted',margin:[0,4,0,3]},
    grid(['Trace coverage (ms)','Overlap within trace spans (ms)','Unavailable timings'],
      [[timing.coveredMs,timing.overlapMs,timing.unavailable]],['*','*','*']),
    {layout:'lightHorizontalLines',fontSize:8,table:{headerRows:1,widths:['*',155,width],body:[
      ['Recorded activity','Source time and elapsed duration','Relative clock axis'].map(text=>({text,bold:true})),
      ...timing.rows.map(row=>{
        const marker=row.elapsedMs===null||row.elapsedMs===0;
        const plottedWidth=marker?2:Math.max(.4,row.width*width);
        const x=Math.min(row.offset*width,width-plottedWidth);
        return [
          {stack:[row.label,{text:row.source,style:'muted'}, ...(row.url?[linkedValue(row.url)]:[])]},
          {stack:[row.startedAt??utc(row.start),
            ...(row.kind==='engineering'?[]:[row.end===null?'End unavailable':row.finishedAt??utc(row.end),
              row.elapsedMs===null?'Elapsed unavailable':row.elapsedMs+' ms elapsed'])]},
          {canvas:[
            {type:'rect',x:0,y:3,w:width,h:5,color:'#e1eaf0'},
            {type:'rect',x,y:3,w:plottedWidth,h:5,color:colors[row.kind]},
          ]},
        ];
      }),
    ]}},
  ];
}

function allocationBar(part, total) {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0 || part < 0 || part > total) return [];
  const width = 300, measured = width * part / total;
  return [{margin:[0,4,0,2],canvas:[
    {type:'rect',x:0,y:0,w:width,h:6,color:'#dcebef'},
    ...(measured ? [{type:'rect',x:0,y:0,w:measured,h:6,color:'#18788b'}] : []),
  ]}];
}

export function taskReportDefinition({task, canonical, records=[], events=[], audits=[], attempts=[], github, telemetrySource, coverage, generatedAt, pricing, workerAccess, integrationRuns=[]}) {
  const taskRecords=records.filter(record=>record.task_id===task.id);
  const taskEvents=events.filter(event=>event.task_id===task.id);
  const taskAudits=audits.filter(audit=>!audit.target_id||audit.target_id===task.id);
  const taskAttempts=attempts.filter(attempt=>attempt.task_id===task.id);
  const integrations=integrationRuns.filter(run=>run.task?.id===task.id);
  const notes=taskDevelopmentNotes(task.id,taskEvents,taskAttempts);
  const noteIds=new Set(notes.map(note=>note.event_id));
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
  const activity=taskEngineeringActivity({task,canonical,attempts:taskAttempts,audits:taskAudits,evidence,events:taskEvents,github,telemetrySource});
  const timeline=buildTaskTimeline({task,attempts:taskAttempts,events:taskEvents,audits:taskAudits,evidence,records:taskRecords,
    engineeringEvents:activity.events,telemetrySource});
  const measurements=collectMeasurements([...taskRecords,...taskEvents]);
  const trace=traceTimeline(taskEvents);
  const timing=executionTiming({taskId:task.id,canonical,attempts:taskAttempts,spans:trace.spans,linkedEvents:activity.events});
  const usage=taskUsageAccounting({task,canonical,attempts:taskAttempts,events:taskEvents,pricing});
  const {rows:tokens,desktop}=usage;
  const diagnostics=taskExecutionDiagnostics({task,canonical,attempts:taskAttempts,trace,tokens,records:taskRecords,events:taskEvents});
  const dataCoverage=taskDataCoverage({task,canonical,attempts:taskAttempts,usage,diagnostics,events:taskEvents,telemetrySource});
  const nextAction=taskNextAction(canonical,workerAccess);
  const latestCoverage=diagnostics.coverage.at(-1);
  const latestTokens=tokens.at(-1)?.observed;

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
      {text:'Engineering executive summary',style:'section'},
      {text:coverage??'Snapshot of the Task data available to the Observatory. Times use UTC. Unavailable readings retain their source status.',margin:[0,0,0,7]},
      grid(['Attempts','Trace intervals','Verification records','Owner-reviewed criteria'],
        [[taskAttempts.length,trace.spans.filter(span=>span.complete).length,evidence.length,diagnostics.accepted.size]],['*','*','*','*']),
      subhead('Known engineering activity'),
      {text:activity.coverage,style:'muted',margin:[0,0,0,5]},
      grid(['Scope','Count'],activity.counts,['*','auto']),
      subhead('Attempt coverage in seconds'),
      grid(['Attempt','Elapsed','Measured','Untraced'],diagnostics.coverage.slice(-3).map(row=>[
        row.attemptNumber,...[row.elapsedMs,row.coveredMs,row.untracedMs].map(ms=>(ms/1000).toFixed(2)),
      ]),['*','*','*','*']),
      ...allocationBar(latestCoverage?.coveredMs,latestCoverage?.elapsedMs),
      subhead('Token and model coverage'),
      grid(['Attempt','Model','Uncached input','Cached input','Output'],tokens.slice(-3).map(row=>[
        row.attemptNumber,row.model,row.observed.uncachedInputTokens,row.observed.cachedInputTokens,row.observed.outputTokens,
      ]),['*','*','*','*','*']),
      ...allocationBar(latestTokens?.cachedInputTokens,latestTokens?.inputTokens),
      {text:'OpenAI API reference estimate '+(usage.referencePrice.total===null?'unavailable':formatReferenceCost(usage.referencePrice.total))+
        ' · '+usage.referencePrice.attempts.length+' of '+usage.coverage.attempts+' attempts · Actual billing '+usage.billing,style:'muted',margin:[0,4,0,0]},
      {toc:{title:{text:'Report contents',style:'section'}},pageBreak:'before'},
      ...(nextAction?[section('Current Task action'),{text:nextAction.title,bold:true},
        {text:nextAction.description},...(nextAction.at?[{text:'Scheduled start (UTC) '+nextAction.at}]:[])]:[]),
      section('Data coverage'),
      grid(['Data','Coverage','Evidence'],dataCoverage.map(row=>[row.topic,row.label,row.basis]),[105,100,'*']),
      section('Execution diagnostics',diagnostics.findings.length),
      ...blocks(diagnostics.findings,item=>item.title,item=>[['Observation',item.detail]]),
      ...diagnostics.comparisons.flatMap(comparison=>[
        section(comparison.title), {text:comparison.summary,margin:[0,0,0,7]},
        grid(comparison.columns,comparison.rows,['*','auto','auto','auto']),
        ...blocks([comparison],()=> 'Benchmark provenance',item=>item.provenance),
      ]),
      section('Task record and acceptance criteria'),
      ...blocks([task],()=>task.id),
      ...(canonical ? blocks([{version:canonical.version,priority:canonical.priority,...canonical.lifecycle}],()=> 'Canonical lifecycle') : []),
      section('Acceptance criteria and owner review',criteria.length),
      ...blocks(criteria,item=>item.id+'  ·  '+item.status),
      ...(integrations.length ? [section('Integration and merge evidence',integrations.length),
        ...integrations.flatMap(run=>{
          const milestones=integrationMilestones(run);
          const estimate=integrationRepairPricing([run],pricing,Date.parse(generatedAt));
          return [...blocks([run],()=>run.pr_number ? 'Pull request '+run.pr_number : 'Task candidate',()=>[
            ['Integration state',words(run.state)], ['Accepted attempt',run.task.attempt_id],
            ['Source SHA',run.head_sha], ['Target main SHA',run.evidence?.base_sha],
            ['Verified merge SHA',run.evidence?.merged_sha], ['Acceptance time (UTC)',milestones.acceptedAt],
            ['PR creation time (UTC)',milestones.prCreatedAt], ['Merge time (UTC)',milestones.mergedAt],
            ['Acceptance to PR (ms)',milestones.acceptanceToPrMs], ['PR to merge (ms)',milestones.prToMergeMs],
            ['CI rerun receipts',run.repair_attempts?.length ?? 0], ['Actual integration billing','Unavailable'],
            ['Automatic infrastructure authorization',run.policy?.auto_ci_reruns?.status],
            ['Automatic CI rerun receipts',(run.repair_attempts ?? []).filter(attempt=>attempt.authorization_id).length],
            ['OpenAI API reference estimate for repairs',estimate.total===null?'Unavailable':
              formatReferenceCost(estimate.total)+' across '+estimate.attempts.length+' priced repairs'],
          ]),
          ...blocks((run.log_diagnostics?.jobs ?? []).flatMap(job=>job.steps).flatMap(step=>step.log?[step.log]:[]),
            log=>'GitHub failed-step diagnostics',log=>[
              ['Workflow',log.workflow_id], ['Run',log.run_id], ['Attempt',log.run_attempt],
              ['Job',log.job_id], ['Step',log.step_number], ['Head SHA',log.head_sha],
              ['Sample status',log.status], ['Observed facts',log.facts?.map(integrationLogFact).join(' · ')],
            ]),
          ...blocks(run.source_repairs ?? [],repair=>'Codex source repair '+repair.id,repair=>[
            ['Status',words(repair.status)], ['Failed head SHA',repair.head_sha],
            ['Candidate SHA',repair.candidate_sha], ['Candidate tree',repair.tree_sha],
            ['Session',repair.session_id], ['Turn',repair.turn_id],
            ['Usage coverage',repair.usage ? repair.usage.complete ? 'Complete turn receipt' : 'Observed lower bound' : 'Unavailable'],
            ['Uncached input tokens',repair.usage ? repair.usage.input_tokens-repair.usage.cached_input_tokens : null],
            ['Cached input tokens',repair.usage?.cached_input_tokens], ['Output tokens',repair.usage?.output_tokens],
            ['Owner review (UTC)',repair.reviewed_at],
          ]),
          ...blocks(integrationWorkflowTiming(run),work=>'Workflow '+work.run_id+' · attempt '+work.attempt,work=>[
            ['Revision',work.head_sha], ['Conclusion',work.conclusion], ['Queue (ms)',work.queueMs], ['Start to GitHub update (ms)',work.wallMs],
            ['GitHub',work.url],
          ])];
        }),
      ] : []),
      section('Task Timeline',timeline.length),
      {text:'Trace events are ordered by journal occurrence. '+journalReceiptSummary(timeline),style:'muted'},
      ...blocks(timeline,item=>item.at+'  ·  '+item.title,item=>[
        ['Category',item.type], ...(item.description?[['Summary',item.description]]:[]), ...item.details,
        ...(item.href?[['Reference',item.href]]:[]),
      ]),
      section('Development Notes',notes.length),
      ...(notes.length ? [
        {text:developmentNoteBytes(notes)+' bytes of note text. The provider reports turn-level usage only.',style:'muted'},
        ...blocks(notes,item=>notesCategory(item.development_note.category)+'  ·  '+item.occurred_at,item=>[
          ['Note',item.development_note.text],['Attempt',item.attempt_id],['Codex session',item.session_id],
        ]),
      ] : [none]),
      section('Execution attempts',taskAttempts.length),
      ...blocks(taskAttempts,item=>'Attempt '+item.attempt_number,item=>{
        const duration=Date.parse(item.finished_at)-Date.parse(item.started_at);
        return [...fields(item),['Elapsed milliseconds',Number.isFinite(duration)&&duration>=0?String(duration):'Unavailable']];
      }),
      section('Execution timing',timing.rows.length),
      ...timingChart(timing),
      section('Execution trace and phase timing'),
      {text:'Covered trace milliseconds   '+display(trace.coveredMs)},
      grid(['Phase','Covered milliseconds','Intervals'],trace.phases.map(phase=>[
        words(phase.phase),phase.coveredMs,trace.spans.filter(span=>span.complete&&span.phase===phase.phase).length,
      ]),['*','*','*']),
      section('Model and token accounting',tokens.length),
      subhead('Observed Task token usage'),
      {text:usage.scope,style:'muted'},
      grid(['Scope',...usageFields.map(([,label])=>label)],[
        ['Task',...usageFields.map(([key])=>usage.observed[key])],
      ],['*','*','*','*','*']),
      {text:'Attempt totals '+usage.coverage.attemptTotals+' of '+usage.coverage.attempts+
        ' · Session totals '+usage.coverage.sessionTotals+' of '+usage.coverage.sessions+
        ' · Conflicts '+usage.coverage.conflicts+' · Billing '+usage.billing,style:'muted'},
      ...(usage.referencePrice.attempts.length?[subhead('OpenAI API reference estimates'),{text:openAIReferenceBasis,style:'muted'},
        ...blocks(usage.referencePrice.attempts,row=>'Attempt '+(row.attemptNumber??row.attemptId),row=>[
          ['Estimate',formatReferenceCost(row.usd)],['Model',row.model],['OpenAI price source',row.source],['Retrieved at',row.retrievedAt],
          ['Rates per 1M tokens',[['input',row.rate.input],['cached',row.rate.cachedInput],['output',row.rate.output]]
            .map(([label,rate])=>formatReferenceCost(rate)+' '+label).join(' · ')],
        ])]:[]),
      ...blocks(usage.sessionRows,row=>'Executor session '+row.id,row=>[
        ['Receipt scope',row.basis],['Linked attempts',row.attemptIds.join(', ')||'None'],
        ...usageFields.map(([key,label])=>[label,display(row.observed[key])]),
        ...(row.receiptId?[['Source event',row.receiptId],['Observed at',row.observedAt]]:[]),
      ]),
      ...blocks(tokens,item=>'Attempt '+(item.attemptNumber??item.attemptId)),
      ...blocks(usage.progressRows,item=>(item.state==='running'?'In-progress':'Partial')+' Codex usage · attempt '+item.attemptNumber,item=>[
        ['Coverage','Observed during the turn. Task totals use final usage receipts.'],
        ['Observed at',item.observedAt],['Source event',item.receiptId],
        ...(item.pace?[
          ['Sampled input tokens per minute',display(Math.round(item.pace.inputPerMinute))],
          ['Sample interval',display(item.pace.elapsedMs/1000)+' s'],
          ...(item.pace.sustained?[['Diagnostic','Input increased across the last two sampled intervals. Review repeated tool work and context.']]:[]),
        ]:[]),
        ...usageFields.map(([key,label])=>[label,display(item.observed[key])]),
      ]),
      ...blocks(desktop,item=>words(item.name)),
      section('Recorded telemetry and measurement samples',measurements.length),
      ...blocks(measurements,item=>words(item.name??'Measurement')),
      section('Evidence ledger and linked engineering activity'),
      ...blocks(evidence,item=>words(item.kind??'Evidence')+'   '+item.id,
        ({matched_benchmark,...record})=>fields(record)),
      ...blocks(activity.references,item=>item.label,item=>[['Reference',item.url],['Linked revisions',item.revisions.join(', ')||'Unavailable'],
        ...(item.provenance?[['Provenance',item.provenance]]:[]),
        ...(item.source_status?[['Source snapshot',item.source_status]]:[])]),
      ...(activity.verificationReports.length?[subhead('Reported verification activity'),
        ...blocks(activity.verificationReports,item=>item.title,item=>[['Recorded occurrence',item.at],...item.details])]:[]),
      section('Appendix · Task operations'),
      ...blocks(taskAudits.filter(item=>item.kind!=='heartbeat'),item=>(item.at??'Time unavailable')+'  ·  '+words(item.kind??item.type??'Operation')),
      section('Appendix · Heartbeat receipts'),
      ...blocks(taskAudits.filter(item=>item.kind==='heartbeat'),item=>(item.at??'Time unavailable')+'  ·  Heartbeat'),
      section('Appendix · Raw trace and contract records'),
      ...blocks(taskEvents,item=>(item.occurred_at??'Time unavailable')+'  ·  '+words(item.kind??'Execution event'),item=>{
        const {development_note,...record}=item;
        return fields(noteIds.has(item.event_id)?item:record);
      }),
      ...blocks(taskRecords.filter(item=>item.record_type!=='evidence'),item=>words(item.record_type)+'  ·  '+item.id),
    ],
  };
}
