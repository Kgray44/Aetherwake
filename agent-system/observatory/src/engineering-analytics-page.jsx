import React, { useMemo, useState } from 'react';
import { Activity, ArrowUpRight, BarChart3, Boxes, CheckCircle2, Clock3, Cpu, FileCheck2, GitPullRequest, Workflow } from 'lucide-react';
import { buildEngineeringAnalytics } from './engineering-analytics.mjs';
import { activityHref, activityId, activityState, newestActivity, pullRepositoryTotals, runRepositoryTotal } from './github-activity.mjs';

const noRows = [];
const formatCount = new Intl.NumberFormat();
const formatDay = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
const count = value => Number.isFinite(value) ? formatCount.format(value) : 'Unavailable';
const rate = value => Number.isFinite(value) ? Math.round(value * 100) + '%' : 'Unavailable';
const label = value => String(value).replaceAll('_',' ');
const stamp = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Unavailable';
const day = value => formatDay.format(new Date(value));
const spanTime = value => {
  if (!Number.isFinite(value) || value < 0) return 'Unavailable';
  if (value < 1000) return count(Math.round(value)) + ' ms';
  const seconds = Math.round(value / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds / 3600) % 24;
  const minutes = Math.floor(seconds / 60) % 60;
  if (days) return days + 'd ' + hours + 'h';
  if (hours) return hours + 'h ' + minutes + 'm';
  return minutes ? minutes + 'm ' + seconds % 60 + 's' : seconds + 's';
};

const trends = {
  delivery: { label: 'Pull requests', series: [['prsCreated', 'Opened'], ['prsMerged', 'Merged']] },
  ci: { label: 'CI outcomes', series: [['ciSucceeded', 'Passed'], ['ciFailed', 'Failed']] },
  work: { label: 'Engineering Tasks', series: [['tasks', 'Tasks registered'], ['attempts', 'Attempts started']] }
};

function TrendChart({ days }) {
  const [mode, setMode] = useState('delivery');
  const [selectedDay, setSelectedDay] = useState(null);
  const series = trends[mode].series;
  const dates = days.filter(row => series.some(([key]) => Number.isFinite(row[key])));
  const active = dates.find(row => row.date === selectedDay) ?? dates.at(-1);
  const maximum = Math.max(1, ...dates.flatMap(row => series.map(([key]) => row[key] ?? 0)));
  return <>
    <div className="analytics-tabs" role="group" aria-label="Trend series">
      {Object.entries(trends).map(([key, value]) => <button key={key} type="button"
        className="quiet-button" aria-pressed={mode === key} onClick={() => {setMode(key);setSelectedDay(null);}}>{value.label}</button>)}
    </div>
    {dates.length ? <>
      <div className="analytics-trend-bars" aria-label={trends[mode].label + ' daily values in UTC'}>
        {days.map(row => {
          const enabled = series.some(([key]) => Number.isFinite(row[key]));
          const description = day(row.date) + ' UTC · ' + series.map(([key, title]) => title + ' ' + count(row[key])).join(' · ');
          return <button key={row.date} type="button" className="analytics-day" disabled={!enabled}
            aria-pressed={active?.date === row.date} aria-label={description} title={description} onClick={() => setSelectedDay(row.date)}>
            {series.map(([key], index) => Number.isFinite(row[key]) && row[key] > 0 &&
              <span key={key} className={'analytics-bar color-' + index} style={{height: (100 * row[key] / maximum) + '%'}}/>)}
          </button>;
        })}
      </div>
      <div className="analytics-day-labels"><span>{day(days[0].date)} UTC</span><span>{day(days.at(-1).date)} UTC</span></div>
      <div className="analytics-day-readout" aria-live="polite">
        <strong>{day(active.date)} UTC</strong>
        {series.map(([key, title], index) => <span key={key}>
          <i className={'color-' + index} aria-hidden="true"/> {title} · {count(active[key])}
        </span>)}
      </div>
      <p className="low">{mode === 'ci' ? 'CI outcomes are grouped by run creation date.'
        : mode === 'delivery' ? 'Each series follows the observed opening or merge date.' : 'Task creation and attempt start dates are shown separately.'}</p>
      <details><summary>Daily values</summary><div className="analytics-table">
        <table><thead><tr><th scope="col">UTC date</th>{series.map(([key,title]) => <th key={key} scope="col">{title}</th>)}</tr></thead>
          <tbody>{days.map(row => <tr key={row.date}><th scope="row">{day(row.date)}</th>
            {series.map(([key]) => <td key={key}>{count(row[key])}</td>)}</tr>)}</tbody></table>
      </div></details>
    </> : <p className="low">Daily observations are unavailable for this series.</p>}
  </>;
}

function Counts({ entries, empty }) {
  const rows = Object.entries(entries ?? {}).filter(([, value]) => Number.isFinite(value) && value > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return rows.length ? <dl className="analytics-counts">
    {rows.map(([key, value]) => <div key={key}><dt>{label(key)}</dt><dd>{count(value)}</dd></div>)}
  </dl> : <p className="low">{empty}</p>;
}

function MetricRows({ fields }) {
  return <dl className="analytics-counts">{fields.map(([key,value]) => (
    <div key={key}><dt>{key}</dt><dd>{value ?? 'Unavailable'}</dd></div>
  ))}</dl>;
}

function PhaseTable({ trace }) {
  const phases = trace.byPhase ?? [];
  const max = Math.max(1, ...phases.map(row => row.coveredMs || 0));
  return <>
    <div className="analytics-caption">Matched wall-clock coverage {spanTime(trace.coveredMs)} · {count(trace.complete)} matched spans · {count(trace.incomplete)} incomplete</div>
    {phases.length ? <ul className="analytics-phases">{phases.map(row => <li key={row.phase}>
      <div><strong>{label(row.phase)}</strong><small>{count(row.spans)} matched spans</small></div>
      <span className="analytics-phase-track" aria-hidden="true"><span style={{width: (100 * row.coveredMs / max) + '%'}}/></span>
      <strong>{spanTime(row.coveredMs)}</strong>
    </li>)}</ul> : <p className="low">Matched phase timings are unavailable.</p>}
    <small>Overlapping spans are counted once within a phase. Operation dependencies are required to measure the critical path.</small>
  </>;
}

function displaySample(name, value, unit) {
  if (!Number.isFinite(value)) return 'Unavailable';
  if (unit === 'bytes') return (value / 1048576).toFixed(1) + ' MiB';
  if (unit === 'ms') return spanTime(value);
  return count(value) + (unit ? ' ' + unit : '');
}

function Usage({ usage }) {
  return <div className="analytics-split">
    <div><h3>Observed token usage</h3>
      {usage.tokens.length ? <dl className="analytics-counts">{usage.tokens.map(metric => <div key={metric.name}>
        <dt>{label(metric.name.replace(/^provider_/,''))}<small>{count(metric.samples)} observations</small></dt>
        <dd>{displaySample(metric.name, metric.total, metric.unit)}</dd>
      </div>)}</dl> : <p className="low">No provider-reported token observations.</p>}
    </div>
    <div><h3>Resource samples</h3>
      {usage.resources.length ? <dl className="analytics-counts">{usage.resources.map(metric => <div key={metric.name}>
        <dt>{label(metric.name)}<small>{count(metric.samples)} observations</small></dt>
        <dd><span>{displaySample(metric.name, metric.max, metric.unit)} max</span>
          <small>{displaySample(metric.name, metric.median, metric.unit)} median</small></dd>
      </div>)}</dl> : <p className="low">No CPU, memory, or I/O measurements have been projected.</p>}
    </div>
  </div>;
}

export function EngineeringAnalyticsPage({ records, events, github, execution, ready, ui }) {
  const { Metric, Panel, Rise, Status } = ui;
  const data = useMemo(() => buildEngineeringAnalytics({
    records: ready ? records : undefined,
    events: ready && execution ? events : undefined,
    github: ready ? github : undefined,
    now: Date.now()
  }), [records, events, github, execution, ready]);
  const recent = useMemo(() => newestActivity('runs', ready ? github?.ci?.items ?? noRows : noRows)
    .filter(item => ['failure','timed_out','startup_failure','action_required'].includes(activityState('runs',item))).slice(0,5),
    [github, ready]);
  const totals = ready ? pullRepositoryTotals(github?.pulls) : null;
  const runTotal = ready ? runRepositoryTotal(github?.ci) : null;
  const stats = [
    ['Engineering Tasks', ready ? count(data.tasks.total) : '—', 'Loaded live records', Boxes],
    ['Execution attempts', ready ? count(data.attempts.total) : '—', 'Loaded live records', Activity],
    ['Attempt success', rate(data.attempts.successRate), count(data.attempts.terminal) + ' terminal attempts', CheckCircle2],
    ['Recent CI pass rate', rate(data.ci.successRate), count(data.ci.concluded) + ' concluded in the loaded window', Workflow],
    ['Merged pull requests', totals ? count(totals.merged) : '—', totals?.stale ? 'Cached repository count' : 'Repository-wide GitHub count', GitPullRequest],
    ['Recent median merge time', spanTime(data.pulls.medianMergeMs), count(data.pulls.mergeSamples) + ' observed merges in the loaded window', Clock3]
  ];
  return <>
    <div className="metrics analytics-metrics">{stats.map(([name,value,meta,Icon], index) =>
      <Metric key={name} name={name} value={value} meta={meta} Icon={Icon} index={index}/>)}</div>
    <Rise><Panel title="Engineering activity" right={<span className="panel-meta">14 UTC days · loaded records</span>}>
      <TrendChart days={data.days}/>
    </Panel></Rise>
    <div className="analytics-grid">
      <Rise><Panel title="Delivery and reliability" right={<BarChart3 size={18} className="muted-icon"/>}>
        <MetricRows fields={[
          ['All pull requests', count(totals?.total)], ['Pull requests loaded', count(data.pulls.total)], ['Loaded PRs opened in period', count(data.pulls.createdInWindow)],
          ['Loaded PRs merged in period', count(data.pulls.mergedInWindow)], ['All workflow runs', count(runTotal)], ['Recent CI run window', count(data.ci.total)],
          ['Recent successful runs', count(data.ci.succeeded)], ['Recent failed runs', count(data.ci.failed)],
          ['Median recorded attempt', spanTime(data.attempts.medianMs)], ['Attempts with both time boundaries', count(data.attempts.timed)]
        ]}/>
      </Panel></Rise>
      <Rise><Panel title="Recent failed CI runs" right={<a className="text-button" href={activityHref('runs')}>All CI runs <ArrowUpRight size={15}/></a>}>
        {recent.length ? <ul className="github-meta-list">{recent.map(item => {
          const id = activityId('runs', item);
          return <li key={id ?? item.url}><div><a href={id ? activityHref('runs', id) : item.url}>{item.title || item.label}</a>
            <small>{[item.branch, stamp(item.created_at)].filter(Boolean).join(' · ')}</small></div>
            <Status value={activityState('runs', item)}/>
          </li>;
        })}</ul> : <p className="low">{data.ci.total === null ? 'CI results are unavailable.' : 'No failures in the loaded CI window.'}</p>}
      </Panel></Rise>
      <Rise><Panel title="Task outcomes"><div className="analytics-split">
        <div><h3>Task states</h3><Counts entries={data.tasks.byState} empty="No Task states observed."/></div>
        <div><h3>Task classes</h3><Counts entries={data.tasks.byClass} empty="No Task classes observed."/></div>
      </div></Panel></Rise>
      <Rise><Panel title="Attempt outcomes"><div className="analytics-split">
        <div><h3>Attempt states</h3><Counts entries={data.attempts.byState} empty="No attempt states observed."/></div>
        <div><h3>Failure categories</h3><Counts entries={data.attempts.byFailure} empty="No classified failures observed."/></div>
      </div></Panel></Rise>
    </div>
    <Rise><Panel title="Recorded execution phases" right={<Clock3 size={18} className="muted-icon"/>}><PhaseTable trace={data.trace}/></Panel></Rise>
    <div className="analytics-grid">
      <Rise><Panel title="Evidence observations" right={<FileCheck2 size={18} className="muted-icon"/>}>
        <MetricRows fields={[['Evidence records', count(data.evidence.total)], ['Synthetic evidence records', count(data.evidence.synthetic)]]}/>
        <Counts entries={data.evidence.byStatus ?? data.evidence.byResult} empty="No evidence observations in this view."/>
        <small>Reported passes are distinct from owner acceptance.</small>
      </Panel></Rise>
      <Rise><Panel title="Source coverage">
        <MetricRows fields={[
          ['PR feed', label(data.pulls.status || 'unavailable')], ['Last successful PR refresh', stamp(data.pulls.observedAt)],
          ['Repository PR totals refreshed', stamp(totals?.observedAt)], ['CI feed', label(data.ci.status || 'unavailable')], ['Last successful CI refresh', stamp(data.ci.observedAt)],
          ['Private projection', stamp(execution?.generated_at)], ['Trace events', count(data.trace.events)],
          ['Conflicting observations', ready ? count(data.sources.recordConflicts + data.sources.traceConflicts) : 'Unavailable'],
          ['API budget remaining', count(github?.api?.remaining)], ['API budget resets', stamp(github?.api?.reset_at)]
        ]}/>
      </Panel></Rise>
    </div>
    <Rise><Panel title="Provider and resource observations" right={<Cpu size={18} className="muted-icon"/>}><Usage usage={data.usage}/></Panel></Rise>
  </>;
}
