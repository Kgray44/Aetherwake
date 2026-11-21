import { attemptMatchesEvidence, ownerReviewByCriterion } from './evidence-status.mjs';
import { attemptTraceCoverage } from './trace-timeline.mjs';
import { validMatchedBenchmark } from '../matched-benchmark.mjs';
import { appServerTurnProfiles } from './task-engine-client.mjs';

const number = new Intl.NumberFormat('en-US');
const percent = new Intl.NumberFormat('en-US',{style:'percent',maximumFractionDigits:1});
const seconds = milliseconds => (milliseconds / 1000).toFixed(2) + ' s';

function benchmarkComparison(record) {
  const pair = record.matched_benchmark;
  const metrics = [
    ['Input tokens',arm=>arm.input_tokens],
    ['Cached input tokens',arm=>arm.cached_input_tokens],
    ['Uncached input tokens',arm=>arm.input_tokens-arm.cached_input_tokens],
    ['Output tokens',arm=>arm.output_tokens],
    ['Total tokens',arm=>arm.total_tokens],
    ['Successful commands',arm=>arm.commands],
    ['Turn time',arm=>arm.turn_ms,ms=>(ms/1000).toFixed(3)+' s'],
  ];
  const rows = metrics.map(([name,measure,format=value=>number.format(value)])=>{
    const standard=measure(pair.standard), compact=measure(pair.compact), delta=compact-standard;
    return [name,format(standard),format(compact),(delta>0?'+':'')+format(delta)];
  });
  rows.push(['Billing','Unknown','Unknown','Unknown']);
  const result=String(record.result??'Unavailable').replaceAll('_',' ').replace(/^./,initial=>initial.toUpperCase());
  return {
    id:record.id, title:'Standard vs compact benchmark',
    summary:'Reported artifact byte identity is unverified. Token counts are final Codex App Server thread totals. Billing was unavailable from the signed-in source.',
    columns:['Metric','Standard','Compact','Compact − standard'],rows,
    provenance:[
      ['Provider and model',pair.provider+' / '+pair.model],
      ['Benchmark revision',pair.source_revision],
      ['Reported artifact SHA-256 (both arms)',pair.artifact_sha256],
      ['Reported evidence result',result],
      ['Standard receipt SHA-256',pair.standard.receipt_sha256],
      ['Compact receipt SHA-256',pair.compact.receipt_sha256],
      ['Receipt hash scope','Verified benchmark log entry, excluding the line ending'],
      ['Linked evidence',record.id],
      ['Evidence revision',record.revision],
    ],
  };
}

export function taskExecutionDiagnostics({ task, canonical, attempts, trace, tokens, records, events = [] }) {
  const coverage = attemptTraceCoverage(attempts, trace.spans);
  const accepted = ownerReviewByCriterion(task, canonical);
  const evidence = records.filter(record => record.task_id === task.id && record.record_type === 'evidence');
  const comparisons = evidence.filter(record=>record.repository===task.repository&&record.kind==='benchmark'&&
    record.synthetic===false&&validMatchedBenchmark(record.matched_benchmark)&&
    attempts.some(attempt=>attemptMatchesEvidence(attempt,record))).map(benchmarkComparison);
  const findings = [];
  const display = value => value === null ? 'unavailable' : number.format(value);
  for (const profile of appServerTurnProfiles(
    attempts.filter(attempt=>attempt.task_id===task.id).map(attempt=>({...attempt,repository:attempt.repository??task.repository})),events
  )) {
    const samples = profile.samples.map(row=>'#'+row.interval+' '+display(row.tokens)+' / '+display(row.cached)+
      ' / '+display(row.output)+' / '+display(row.commands));
    findings.push({title:'Attempt '+profile.attemptNumber+' App Server turn profile · turn '+profile.ordinal, key:profile.receiptId,
      detail:'Reconciled '+display(profile.reconciled)+' of '+display(profile.intervals)+' observed usage intervals. '+
        'First and latest reconciled response input were '+display(profile.first.tokens)+' and '+display(profile.latest.tokens)+
        ' tokens, with '+display(profile.first.cached)+' and '+display(profile.latest.cached)+' cached. '+
        display(profile.commands)+' observed commands, '+display(profile.repeated)+' repeated command invocations, '+
        display(profile.outputBytes)+' bytes across '+display(profile.commandOutputs)+' command output samples. '+
        (profile.toolLimited?'Tool observations reached the capture limit. ':'')+
        (samples.length?'Sampled intervals show input, cached input, output and command completions. '+samples.join(', ')+'. ':'')+
        'Submitted Task prompt '+display(profile.promptBytes)+' bytes. Full provider request contents are unavailable. '+
        'Receipt '+profile.receiptId+' at '+profile.revision+'.'});
  }
  for (const row of coverage) {
    if (row.untracedMs <= 0) continue;
    const edges = row.beforeTraceMs == null ? '' :
      ' First measured span began ' + seconds(row.beforeTraceMs) + ' after claim, and the attempt ended ' +
      seconds(row.afterTraceMs) + ' after the final measured span.';
    findings.push({ title:'Attempt ' + row.attemptNumber + ' trace coverage',
      detail:seconds(row.coveredMs) + ' measured of ' + seconds(row.elapsedMs) + '. ' +
        seconds(row.untracedMs) + ' outside measured intervals.' + edges });
  }
  for (const row of tokens) {
    const { inputTokens, cachedInputTokens, uncachedInputTokens, totalTokens } = row.observed;
    if (inputTokens != null && cachedInputTokens != null && uncachedInputTokens != null) {
      const reuseRatio = inputTokens>0 ? ' (' + percent.format(cachedInputTokens/inputTokens) + ' of input)' : '';
      findings.push({ title:'Attempt ' + row.attemptNumber + ' input reuse',
        detail:number.format(cachedInputTokens) + ' cache-reused input tokens' + reuseRatio + ' and ' +
          number.format(uncachedInputTokens) + ' uncached input tokens from ' + (row.source??'Codex CLI receipts') +
          '. The receipt measures aggregate input across model calls.' });
    }
    if (!row.model && totalTokens != null) findings.push({title:'Attempt ' + row.attemptNumber + ' model attribution missing',
      detail:'The linked attempt reports token usage without an actual model identifier. Cost is unavailable.'});
  }
  for (const span of trace.spans) {
    if (!span.complete || span.task !== task.id) continue;
    const measurements = span.events.flatMap(event=>event.measurements??[]);
    const count = name => measurements.find(metric=>metric.name===name &&
      metric.source==='codex_exec_jsonl' && metric.availability==='observed')?.value;
    const repeated = count('provider_repeated_observed_command_count');
    const failed = count('provider_command_failed_event_count');
    if (repeated > 0 || failed > 0) findings.push({title:'Observed command rework',key:span.key,
      detail:number.format(repeated ?? 0) + ' repeated command executions and ' +
        number.format(failed ?? 0) + ' failed command executions in the recorded stream. Inspect the attempt before removing retries or verification steps.'});
  }
  if (accepted.size && !evidence.length) findings.push({title:'Owner review recorded',
    detail:accepted.size + ' criterion receipt(s) reference an accepted artifact revision. No separate verification records are linked.'});
  if (attempts.length > 1) findings.push({title:'Multiple attempts',
    detail:attempts.length + ' attempts are recorded. Review their outcomes and retry reasons before attributing repeated work.'});
  return { coverage, accepted, evidence, findings, comparisons };
}
