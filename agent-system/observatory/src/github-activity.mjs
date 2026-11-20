const routes = { pulls: 'pull-requests', runs: 'ci-runs' };

export function activityId(kind, item) {
  const candidate = kind === 'pulls' ? item.number : item.id;
  if (Number.isSafeInteger(candidate) && candidate > 0) return candidate;
  // Older shared snapshots included the canonical URL but no numeric field.
  const route = kind === 'pulls' ? 'pull' : 'actions/runs';
  const prefix = 'https://github.com/Kgray44/Aetherwake/' + route + '/';
  const raw = typeof item.url === 'string' && item.url.startsWith(prefix) ? item.url.slice(prefix.length) : '';
  const id = /^\d+$/.test(raw) ? Number(raw) : 0;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function activityHref(kind, id) {
  if (!Object.hasOwn(routes, kind)) return '#';
  return '#' + routes[kind] + (id ? '/' + id : '');
}

export function parseActivityHref(hash) {
  const matched = /^#(pull-requests|ci-runs)(?:\/([1-9]\d*))?$/.exec(hash);
  if (!matched) return null;
  const id = matched[2] ? Number(matched[2]) : null;
  if (id !== null && !Number.isSafeInteger(id)) return null;
  return { kind: matched[1] === routes.pulls ? 'pulls' : 'runs', id };
}

export function githubItemHref(kind, id) {
  return 'https://github.com/Kgray44/Aetherwake/' + (kind === 'pulls' ? 'pull/' : 'actions/runs/') + id;
}

export function newestActivity(kind, items) {
  const date = item => {
    const value = Date.parse(item.created_at);
    return Number.isFinite(value) ? value : -Infinity;
  };
  return [...items].sort((a, b) =>
    (date(b) - date(a)) || ((activityId(kind, b) ?? 0) - (activityId(kind, a) ?? 0)));
}

export function activityState(kind, row) {
  if (kind === 'pulls') return row.merged === true || row.merged_at ? 'merged' : row.state;
  return row.conclusion || row.status || row.state;
}

export function activityGroup(kind, row) {
  return kind === 'pulls' ? row.base_ref : (row.workflow || row.label);
}

export function searchActivity(kind, items, { query = '', state = '', group = '', oldest = false } = {}) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const selected = items.filter(item => {
    if (state && activityState(kind, item) !== state) return false;
    if (group && activityGroup(kind, item) !== group) return false;
    const contents = [activityId(kind, item), item.label, item.title, item.author, item.head_ref,
      item.base_ref, item.branch, item.workflow, item.event, activityState(kind, item), item.revision].join(' ').toLowerCase();
    return terms.every(term => contents.includes(term));
  });
  const ordered = newestActivity(kind, selected);
  return oldest ? ordered.reverse() : ordered;
}

export function pullRepositoryTotals(group) {
  const totals = group?.totals;
  if (!['available', 'stale'].includes(totals?.status)) return null;
  const { total, open, merged, closed } = totals;
  if (![total, open, merged, closed].every(value => Number.isSafeInteger(value) && value >= 0) ||
      open + merged + closed !== total) return null;
  return { total, open, merged, closed, observedAt: totals.observed_at,
    stale: group.status === 'stale' || totals.status === 'stale' };
}

export function runRepositoryTotal(group) {
  const total = group?.repository_total;
  return Number.isSafeInteger(total) && total >= 0 ? total : null;
}

export function taskActivityHref(uri) {
  if (typeof uri !== 'string') return null;
  let url;
  try { url = new URL(uri); } catch { return null; }
  if (url.origin !== 'https://github.com' || url.username || url.password) return null;
  const pull = /^\/Kgray44\/Aetherwake\/pull\/([1-9]\d*)(?:\/(?:files|commits|checks))?\/?$/i.exec(url.pathname);
  const run = /^\/Kgray44\/Aetherwake\/actions\/runs\/([1-9]\d*)(?:\/(?:job|attempts)\/[1-9]\d*)?\/?$/i.exec(url.pathname);
  const id = Number(pull?.[1] ?? run?.[1]);
  return Number.isSafeInteger(id) ? activityHref(pull ? 'pulls' : 'runs', id) : null;
}
