export const timingLegend = 'Attempt windows, lifecycle intervals, trace spans and linked events share a recorded clock axis. Time before a claim can include scheduling and dependency delays. Overlap can include nested spans. Clock differences can affect ordering.';

const waitingLabels = {admit:'Admission to claim',resume:'Resume to claim',retry:'Retry to claim',reopen:'Reopen to claim'};
const waitEnds = new Set(['pause','cancel','dependency_cancelled','archive']);

export function executionTiming({taskId, canonical, attempts = [], spans = [], linkedEvents = []}) {
  const matched = attempts.filter(attempt=>attempt.task_id===taskId);
  const byAttempt = new Map(matched.map(attempt=>[attempt.id,attempt]));
  const rows = [];
  let unavailable = 0;
  for (const attempt of matched) {
    const start = Date.parse(attempt.started_at), end = Date.parse(attempt.finished_at);
    if (!Number.isFinite(start) || (attempt.finished_at && (!Number.isFinite(end) || end < start))) {
      unavailable++;
      continue;
    }
    rows.push({id:'attempt:'+attempt.id,kind:'attempt',label:'Attempt '+attempt.attempt_number,
      attemptId:attempt.id,source:'Attempt record',start,end:Number.isFinite(end)?end:null,
      startedAt:attempt.started_at,finishedAt:attempt.finished_at,
      state:attempt.state,revision:attempt.revision});
  }
  if (canonical?.task?.id===taskId) {
    const receipts = (canonical.events??[]).filter(receipt=>Number.isSafeInteger(receipt.version))
      .sort((a,b)=>a.version-b.version);
    let waiting, lastVersion;
    for (const receipt of receipts) {
      if (receipt.version!==lastVersion+1 || waitEnds.has(receipt.kind)) waiting=undefined;
      lastVersion=receipt.version;
      if (receipt.actor==='owner'&&Object.hasOwn(waitingLabels,receipt.kind)) waiting=receipt;
      if (receipt.kind!=='claim') continue;
      const attempt = byAttempt.get(receipt.attempt_id);
      const start = Date.parse(waiting?.at), end = Date.parse(receipt.at);
      if (attempt && receipt.actor==='worker' && Number.isFinite(start) && end>=start && end===Date.parse(attempt.started_at)) {
        rows.push({id:'wait:'+attempt.id,kind:'wait',label:waitingLabels[waiting.kind],attemptId:attempt.id,
          attemptNumber:attempt.attempt_number,source:'Task Engine audit receipts',start,end,
          startedAt:waiting.at,finishedAt:receipt.at});
      }
      waiting=undefined;
    }
  }
  const edges = new Map();
  for (const span of spans) {
    if (span.task!==taskId) continue;
    const attempt = byAttempt.get(span.attempt);
    if (!span.complete || (span.attempt && attempt?.revision!==span.revision)) {
      unavailable++;
      continue;
    }
    rows.push({id:'span:'+span.key,kind:'trace',label:span.phase.replaceAll('_',' '),attemptId:span.attempt,
      attemptNumber:attempt?.attempt_number,source:'Matched journal span',start:span.start,end:span.end,
      startedAt:span.events.find(event=>event.kind==='span_start')?.occurred_at,
      finishedAt:span.events.find(event=>event.kind==='span_end')?.occurred_at,
      monotonicMs:span.monotonicMs,state:span.outcome,revision:span.revision,spanId:span.id,parent:span.parent});
    edges.set(span.start,(edges.get(span.start)??0)+1);
    edges.set(span.end,(edges.get(span.end)??0)-1);
  }
  for (const event of linkedEvents) {
    const start = Date.parse(event.at);
    if (!Number.isFinite(start)) continue;
    rows.push({id:event.id,kind:'engineering',label:event.title,source:event.sourceLabel??'Linked GitHub snapshot',attemptId:event.attemptId,start,end:null,
      startedAt:event.at,state:event.outcome,url:event.href});
  }

  rows.sort((a,b)=>a.start-b.start||a.id.localeCompare(b.id));
  const start = rows[0]?.start;
  const end = rows.length ? Math.max(...rows.map(row=>row.end??row.start)) : null;
  let active = 0, previous = null, coveredMs = 0, overlapMs = 0;
  for (const [at,delta] of [...edges].sort(([a],[b])=>a-b)) {
    if (active > 0) coveredMs+=at-previous;
    if (active > 1) overlapMs+=at-previous;
    previous=at;
    active+=delta;
  }
  return {start,end,coveredMs:edges.size?coveredMs:null,overlapMs:edges.size?overlapMs:null,unavailable,
    rows:rows.map(row=>({...row,elapsedMs:row.end===null?null:row.end-row.start,
      offset:(row.start-start)/Math.max(1,end-start), width:row.end===null?0:(row.end-row.start)/Math.max(1,end-start)}))};
}
