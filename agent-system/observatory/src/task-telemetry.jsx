import React, { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { useCardMotion } from './card-motion.jsx';
import { traceTimeline } from './trace-timeline.mjs';
import { TaskTokenAccounting } from './task-engine-controls.jsx';
import { formatReferenceCost, openAIReferenceBasis } from './openai-pricing.mjs';
import { taskUsageAccounting, usageFields } from './task-usage-accounting.mjs';
import { taskExecutionDiagnostics } from './task-execution-diagnostics.mjs';
import { taskDataCoverage } from './task-data-coverage.mjs';
import { codexThreadHref } from './task-engine-client.mjs';

const format = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const words = value => String(value ?? '').replaceAll('_', ' ');
const time = value => value == null ? 'Unavailable' : format.format(value / 1000) + ' s';

function MeasurementChart({ title, rows, empty }) {
  const reduced = useReducedMotion();
  const interaction = useCardMotion();
  const max = Math.max(1, ...rows.map(row => row.value));
  return <motion.section className="task-telemetry-chart" {...interaction}>
    <h3>{title}</h3>
    {rows.length ? <ul>{rows.map(row => <li key={row.label}>
      <span>{row.label}</span><strong>{row.display}</strong>
      <span className="task-telemetry-track" aria-hidden="true"><motion.span
        initial={false} animate={{ scaleX: row.value / max }} transition={{ duration: reduced ? 0 : .24 }}/></span>
    </li>)}</ul> : <p>{empty}</p>}
  </motion.section>;
}

function measurementRows(records, events) {
  const rows = [];
  for (const record of [...records, ...events]) {
    for (const [index, metric] of (record.measurements ?? []).entries()) {
      rows.push({ ...metric, key: (record.id ?? record.event_id) + ':' + index, phase: record.phase,
        received: record.occurred_at ?? record.created_at, attempt: record.attempt_id });
    }
  }
  return rows.sort((a,b) => String(b.received ?? '').localeCompare(String(a.received ?? '')));
}

function available(metric) {
  return metric.availability !== 'unavailable' && typeof metric.value === 'number' && Number.isFinite(metric.value);
}

function CodexHistory({ task, attempts, events }) {
  const sessions = [...new Set(attempts.map(attempt=>attempt.session_id).filter(Boolean))];
  const turns = events.filter(event=>event.activity?.kind==='codex_turn' && !event.attempt_id &&
    sessions.includes(event.session_id)).sort((a,b)=>b.occurred_at.localeCompare(a.occurred_at));
  if (!sessions.length) return null;
  return <section aria-label="Linked Codex history">
    <h3>Linked Codex history</h3>
    <ul>{sessions.map((session,index)=><li key={session}>
      <a href={codexThreadHref({executor:'codex',session_id:session})}>Open Codex conversation {index+1}</a>
    </li>)}</ul>
    {turns.length ? <>
      <p>{turns.length} synced turns outside managed execution. Latest completion{' '}
        <time dateTime={turns[0].occurred_at}>{new Date(turns[0].occurred_at).toLocaleString()}</time>.</p>
      <ul>{turns.slice(0,12).map(turn=>{
        const metric = name => turn.measurements.find(item=>item.name==='codex_turn_'+name)?.value;
        return <li key={turn.event_id}><time dateTime={turn.occurred_at}>{new Date(turn.occurred_at).toLocaleString()}</time>
          {' · '}{words(turn.activity.outcome)}{' · '}{metric('user_messages')} user messages
          {' · '}{metric('tool_items')} tool items{' · '}{metric('file_change_items')} file-change items
          {metric('item_page_partial')===1 ? ' · Partial item history' : ''}</li>;
      })}</ul>
    </> : <p>No independent turns have been synced from the linked conversation.</p>}
    <p>Run this from the signed-in Codex host to sync history. Stop the watcher with Ctrl+C. For managed continuation, check the pinned checkout before using the Task’s execution controls.</p>
    {/^[A-Za-z0-9_.:-]+$/.test(task.id) && <code>node scripts/agent/observatory-desktop-sync.mjs --task-id {task.id} --watch</code>}
  </section>;
}

export function TaskTelemetry({ task, canonical, attempts, telemetry, events, records, telemetrySource, pricing }) {
  const [limit, setLimit] = useState(24);
  const timeline = useMemo(() => traceTimeline(events), [events]);
  const usage = useMemo(() => taskUsageAccounting({task,canonical,attempts,events,pricing}), [task,canonical,attempts,events,pricing]);
  const {rows:tokens,desktop} = usage;
  const diagnostics = useMemo(() => taskExecutionDiagnostics({
    task, canonical, attempts, trace:timeline, tokens, records:records ?? [], events,
  }), [task,canonical,attempts,timeline,tokens,records,events]);
  const dataCoverage = useMemo(() => taskDataCoverage({task,canonical,attempts,usage,diagnostics,events,telemetrySource}),
    [task,canonical,attempts,usage,diagnostics,events,telemetrySource]);
  const coverageRows = diagnostics.coverage.slice(-8).flatMap(row => [
    {label:'Attempt ' + row.attemptNumber + ' · measured',value:row.coveredMs,display:time(row.coveredMs)},
    {label:'Attempt ' + row.attemptNumber + ' · untraced',value:row.untracedMs,display:time(row.untracedMs)},
  ]);
  const measurements = useMemo(() => measurementRows(telemetry, events), [telemetry, events]);
  const measurable = measurements.filter(available);
  const timeRows = timeline.phases.slice(0, 8).map(phase => ({ label: words(phase.phase), value: phase.coveredMs, display: time(phase.coveredMs) }));
  const durationRows = attempts.flatMap(attempt => {
    const duration = Date.parse(attempt.finished_at) - Date.parse(attempt.started_at);
    return Number.isFinite(duration) && duration >= 0 ? [{label:'Attempt ' + attempt.attempt_number,value:duration,display:time(duration)}] : [];
  }).slice(-8);
  const tokenRows = tokens.filter(row => row.observed.totalTokens != null).slice(-8).map(row => ({
    label: 'Attempt ' + (row.attemptNumber ?? row.attemptId), value: row.observed.totalTokens,
    display: format.format(row.observed.totalTokens) + ' tokens',
  }));
  const measuredResource = measurable.filter(metric => metric.availability === 'observed' && ['MiB','MB','%','bytes','cores'].includes(metric.unit));
  const resourceGroups = new Map();
  for (const metric of measuredResource) {
    const key = metric.unit;
    const group = resourceGroups.get(key) ?? [];
    if (group.length >= 5 || group.some(row => row.label === words(metric.name)) || metric.value < 0) continue;
    group.push({ label: words(metric.name),value:metric.value,display:format.format(metric.value)+' '+key });
    resourceGroups.set(key,group);
  }
  return <section className="task-telemetry" aria-label="Task telemetry">
    <CodexHistory task={task} attempts={canonical?.attempts ?? attempts} events={events}/>
    <dl className="github-facts task-telemetry-coverage">
      <div><dt>Observed trace time</dt><dd>{time(timeline.coveredMs)}</dd></div>
      <div><dt>Linked execution events</dt><dd>{events.length}</dd></div>
      <div><dt>Recorded metrics with values</dt><dd>{measurable.length}</dd></div>
      <div><dt>Attempts with token receipts</dt><dd>{usage.coverage.attemptTotals} of {usage.coverage.attempts}</dd></div>
    </dl>
    <div className="task-telemetry-grid">
      <MeasurementChart title="Time by phase" rows={timeRows} empty="No matched trace intervals were supplied."/>
      <MeasurementChart title="Attempt duration" rows={durationRows} empty="A completed attempt with start and finish times is needed."/>
      {coverageRows.length>0&&<MeasurementChart title="Attempt trace coverage" rows={coverageRows}/>}
      <MeasurementChart title="Observed tokens by attempt" rows={tokenRows} empty="No linked receipts supply total token counts for this Task."/>
      {desktop.length>0&&<MeasurementChart title="Desktop-session token counters" rows={desktop.map(metric=>({label:words(metric.name.replace(/^desktop_/,'')),value:metric.value,display:format.format(metric.value)+' tokens'}))}/>}
      {[...resourceGroups].map(([unit, rows]) => <MeasurementChart key={unit} title={'Latest resource readings ('+unit+')'} rows={rows}/>)}
    </div>
    <section aria-label="Data coverage">
      <h3>Data coverage</h3>
      <div className="analytics-table"><table>
        <thead><tr><th scope="col">Data</th><th scope="col">Coverage</th><th scope="col">Evidence</th></tr></thead>
        <tbody>{dataCoverage.map(row=><tr key={row.topic}><th scope="row">{row.topic}</th><td>{row.label}</td><td>{row.basis}</td></tr>)}</tbody>
      </table></div>
    </section>
    {usage.progressRows.length>0&&<section aria-label="Codex usage snapshots">
      <h3>Codex usage snapshots</h3>
      {usage.progressRows.map(row=><p key={row.receiptId}>
        Attempt {row.attemptNumber} · {row.state==='running'?'In progress':'Partial usage'} · <strong>{format.format(row.observed.totalTokens)} tokens observed during the turn</strong>
        {' · '}<time dateTime={row.observedAt}>{new Date(row.observedAt).toLocaleString()}</time>
        {row.observed.cachedInputTokens!=null&&row.observed.uncachedInputTokens!=null&&
          <><br/>{format.format(row.observed.cachedInputTokens)} cached · {format.format(row.observed.uncachedInputTokens)} uncached input tokens</>}
        {row.pace&&<><br/>{format.format(row.pace.inputPerMinute)} input tokens/min over the last {time(row.pace.elapsedMs)} sampled interval</>}
        {row.pace?.sustained&&<><br/><strong>Sustained input growth.</strong> Review recent tool work and repeated context before starting another run.</>}
      </p>)}
      <p className="low">Task totals use final usage receipts.</p>
    </section>}
    {diagnostics.findings.length>0&&<section aria-label="Execution diagnostics">
      <h3>Execution diagnostics</h3>
      <ul>{diagnostics.findings.map(({title,detail,key})=><li key={key??title}><strong>{title}</strong><p>{detail}</p></li>)}</ul>
    </section>}
    {diagnostics.comparisons.map(comparison=><section key={comparison.id} aria-label={comparison.title}>
      <h3>{comparison.title}</h3>
      <p>{comparison.summary}</p>
      <div className="analytics-table"><table>
        <thead><tr>{comparison.columns.map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{comparison.rows.map(([metric,...values])=><tr key={metric}>
          <th scope="row">{metric}</th>{values.map((value,index)=><td key={comparison.columns[index+1]}>{value}</td>)}
        </tr>)}</tbody>
      </table></div>
      <dl className="task-benchmark-provenance">
        {comparison.provenance.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
    </section>)}
    <p className="low">{desktop.length>0&&'Desktop counters are cumulative session observations and have no worker-attempt assignment. '}An attempt can have timing or resource measurements without producing a model token receipt. </p>
    <h3>Model and token accounting</h3>
    <h4>Observed Task token usage</h4>
    <dl className="github-facts task-telemetry-coverage">
      {usageFields.map(([key,label])=><div key={key}><dt>{label}</dt><dd>{usage.observed[key]?.toLocaleString()??'Unavailable'}</dd></div>)}
      <div><dt>Sessions with token totals</dt><dd>{usage.coverage.sessionTotals} of {usage.coverage.sessions}</dd></div>
      <div><dt>Actual billing</dt><dd>{usage.billing}</dd></div>
      <div><dt>OpenAI API reference estimate</dt><dd>{usage.referencePrice.total === null ? 'Unavailable' : formatReferenceCost(usage.referencePrice.total)}</dd></div>
    </dl>
    <p className="low">{usage.scope}</p>
    {usage.coverage.conflicts>0&&<p>Conflicting usage records excluded from the affected totals.</p>}
    {usage.sessionRows.length>0&&<div className="analytics-table"><table>
      <caption>Token usage by executor session</caption>
      <thead><tr><th scope="col">Session</th><th scope="col">Basis</th>
        {usageFields.map(([key,label])=><th key={key} scope="col">{label}</th>)}</tr></thead>
      <tbody>{usage.sessionRows.map(row=><tr key={row.id}>
        <th scope="row">{row.id}<small className="row-meta">{row.attemptIds.length} linked attempts</small></th>
        <td>{row.basis}{row.receiptId&&<small className="row-meta">Source event {row.receiptId}</small>}</td>
        {usageFields.map(([key])=><td key={key}>{row.observed[key]?.toLocaleString()??'Unavailable'}</td>)}
      </tr>)}</tbody>
    </table></div>}
    <TaskTokenAccounting rows={tokens}/>
    {usage.referencePrice.attempts.length>0&&<div className="analytics-table"><table>
      <caption>OpenAI API reference estimates for {usage.referencePrice.attempts.length} of {usage.coverage.attempts} attempts. {openAIReferenceBasis}</caption>
      <thead><tr><th scope="col">Attempt</th><th scope="col">Pricing source</th><th scope="col">Rates per 1M tokens</th><th scope="col">Estimate</th></tr></thead>
      <tbody>{usage.referencePrice.attempts.map(row=><tr key={row.attemptId}>
        <th scope="row">{row.attemptNumber ?? row.attemptId}</th>
        <td><a href={row.source} target="_blank" rel="noreferrer">{row.model}</a><small className="row-meta">Retrieved {new Date(row.retrievedAt).toLocaleString()}</small></td>
        <td>{formatReferenceCost(row.rate.input)} input · {formatReferenceCost(row.rate.cachedInput)} cached · {formatReferenceCost(row.rate.output)} output</td>
        <td>{formatReferenceCost(row.usd)}</td>
      </tr>)}</tbody>
    </table></div>}
    <h3>Recorded measurements</h3>
    {measurements.length ? <>
      <div className="analytics-table"><table>
        <thead><tr><th scope="col">Metric</th><th scope="col">Value</th><th scope="col">Phase</th><th scope="col">Source</th><th scope="col">Time</th></tr></thead>
        <tbody>{measurements.slice(0,limit).map(metric=><tr key={metric.key}>
          <th scope="row">{words(metric.name)}</th>
          <td>{available(metric) ? format.format(metric.value) + ' ' + (metric.unit ?? '') : 'Unavailable'}<small className="row-meta">{metric.availability}</small></td>
          <td>{words(metric.phase) || 'Unavailable'}</td><td>{words(metric.source) || 'Unavailable'}{metric.method && <small className="row-meta">{words(metric.method)}</small>}</td>
          <td>{metric.received ? new Date(metric.received).toLocaleString() : 'Unavailable'}</td>
        </tr>)}</tbody>
      </table></div>
      {measurements.length > limit && <button className="quiet-button" type="button" onClick={()=>setLimit(previous=>previous+24)}>Show more measurements</button>}
    </> : <p>No metric samples have been linked to this Task.</p>}
  </section>;
}
