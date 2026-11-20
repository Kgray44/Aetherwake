import { ownerReviewByCriterion } from './evidence-status.mjs';
import { attemptTraceCoverage } from './trace-timeline.mjs';

const number = new Intl.NumberFormat('en-US');
const percent = new Intl.NumberFormat('en-US',{style:'percent',maximumFractionDigits:1});
const seconds = milliseconds => (milliseconds / 1000).toFixed(2) + ' s';

export function taskExecutionDiagnostics({ task, canonical, attempts, trace, tokens, records }) {
  const coverage = attemptTraceCoverage(attempts, trace.spans);
  const accepted = ownerReviewByCriterion(task, canonical);
  const evidence = records.filter(record => record.task_id === task.id && record.record_type === 'evidence');
  const findings = [];
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
  return { coverage, accepted, evidence, findings };
}
