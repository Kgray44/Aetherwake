import React from 'react';

const timestamp = value => new Date(value).toLocaleString();
const short = value => value ? value.slice(0, 10) : 'Unavailable';

export function GitHubFeed({ data }) {
  const { repository, main, records, issues, pulls, ci, page_size, checked_at, retry_at } = data;
  const groups = [
    ['Issues', issues, 'Most recently updated issue entries, with pull requests filtered out.'],
    ['Pull requests', pulls, 'Most recently updated across branches.'],
    ['CI runs', ci, 'Recent runs on main, with each run’s head commit.'],
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
    <div className="github-groups">{groups.map(([name, group, coverage]) =>
      <section key={name}>
        <h3>{name}</h3>
        <small>{coverage} First {page_size} results only.</small>
        {staleNote(group)}
        {group.status === 'unavailable' ? <p>{group.reason}</p> : !group.items.length
          ? <p>No entries in this result window.</p>
          : <ul>{group.items.map(item => <li key={item.url}>
            <a href={item.url}>{item.label} · {item.title}</a>
            <small>{item.state}{item.revision && ' · ' + short(item.revision)}</small>
          </li>)}</ul>}
      </section>)}</div>
  </div>;
}
