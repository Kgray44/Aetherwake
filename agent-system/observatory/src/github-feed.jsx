import React from 'react';
import {activityHref,activityId,activityState,newestActivity} from './github-activity.mjs';

const timestamp = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Unavailable';
const authLabels = {
  authenticated: 'Authenticated',
  anonymous: 'Anonymous',
  unverified: 'Awaiting authenticated response',
  rejected: 'Credential rejected',
  missing: 'Configured credential missing'
};

function GitHubApiDiagnostics({ api }) {
  if (!api) return null;
  const count = value => Number.isSafeInteger(value) && value >= 0;
  const budget = count(api.remaining)
    ? String(api.remaining) + (count(api.limit) ? ' of ' + api.limit : '') : 'Unavailable';
  const degraded = api.authentication === 'rejected' || api.authentication === 'missing';
  return <div className="record github-api-diagnostics">
    <strong>GitHub API</strong>
    <dl>
      <div><dt>Authentication</dt><dd>{authLabels[api.authentication] || 'Unavailable'}</dd></div>
      <div><dt>Budget remaining</dt><dd>{budget}</dd></div>
      <div><dt>Budget reset</dt><dd>{timestamp(api.reset_at)}</dd></div>
    </dl>
    {api.observed_at && <small>Budget observed {timestamp(api.observed_at)}</small>}
    {degraded && <p role="status">GitHub authentication is degraded. Last successful data is shown where available.</p>}
  </div>;
}
const short = value => value ? value.slice(0, 10) : 'Unavailable';

export function GitHubFeed({ data }) {
  const { repository, main, records, issues, pulls, ci, page_size, checked_at, retry_at, api } = data;
  const groups = [
    ['Issues', 'issues', issues, 'Recently updated issues.'],
    ['Pull requests', 'pulls', pulls, 'Newest pull requests first.'],
    ['CI runs', 'runs', ci, 'Newest workflow runs first.'],
  ];
  const stale = [main, records, issues, pulls, ci].some(group => group.status === 'stale');
  const staleNote = group => group.status === 'stale'
    ? <small>Last successful read {timestamp(group.observed_at)} · {group.reason}</small>
    : null;
  return <div className="github-feed">
    <p><strong>{repository} · main</strong> · {main.revision
      ? <a href={'https://github.com/Kgray44/Aetherwake/commit/' + main.revision}>{short(main.revision)}</a>
      : main.reason}</p>
    <p className="low">{checked_at ? 'Checked ' + timestamp(checked_at) + ' · ' : ''}GitHub activity is separate from v1 task outcomes and telemetry.</p>
    {(stale || retry_at) && <p className="low">{stale && 'Showing last successful data where available. '}{retry_at && 'Next GitHub retry after ' + timestamp(retry_at) + '.'}</p>}
    {staleNote(main)}
    <GitHubApiDiagnostics api={api}/>
    <div className="record">
      <strong>Contract records on main</strong>
      <p>{records.status === 'unavailable' ? records.reason : records.total + ' validated records'}
        {records.status === 'partial' && ' · partial coverage'}</p>
      {staleNote(records)}
      {records.absent?.length > 0 && <small>Absent at this revision: {records.absent.join(', ')}</small>}
      {records.errors?.length > 0 && <p>Unavailable paths: {records.errors.join(', ')}</p>}
      {records.rejected > 0 && <p>{records.rejected} entries failed contract or repository validation.</p>}
      {records.truncated && <p>Repository scan reached its size or coverage limit.</p>}
      {records.provenance?.length > 0 && <details><summary>Record origins</summary>
        <ul>{records.provenance.map(({ id, type, path, blob }) => <li key={type + ':' + id}>
          <a href={'https://github.com/Kgray44/Aetherwake/blob/' + records.revision + '/' + path.split('/').map(encodeURIComponent).join('/')}>{path}</a>
          {' · '}{type}{' · '}{id}{' · '}{short(blob)}
        </li>)}</ul>
      </details>}
    </div>
    <div className="github-groups">{groups.map(([name, kind, group, coverage]) => {
      const activity = kind !== 'issues';
      const rows = activity ? newestActivity(kind, group.items).slice(0, 5) : group.items;
      return <section key={name}>
        <h3><a href={activity ? activityHref(kind) : 'https://github.com/Kgray44/Aetherwake/issues'}>{name}</a></h3>
        <small>{coverage} {activity ? 'Up to 5 shown.' : 'First ' + page_size + ' results only.'}</small>
        {staleNote(group)}
        {group.status === 'unavailable' ? <p>{group.reason}</p> : !rows.length
          ? <p>No entries in this result window.</p>
          : <ul>{rows.map(item => {
            const id = activity ? activityId(kind, item) : null;
            return <li key={item.url}>
              <a href={id ? activityHref(kind, id) : item.url}>{item.label} · {item.title}</a>
              <small>{activity ? activityState(kind, item) : item.state}{item.revision && ' · ' + short(item.revision)}</small>
            </li>;
          })}</ul>}
        {activity && <a className="text-button github-home-more" href={activityHref(kind)}>View all {name.toLowerCase()} <span aria-hidden="true">↗</span></a>}
      </section>;
    })}</div>
  </div>;
}
