const idPattern = /^[A-Za-z0-9_.:-]{1,160}$/;
const priorities = ['urgent', 'high', 'normal', 'low'];

export function taskHref(id) {
  return id === undefined ? '#tasks' : '#tasks/' + encodeURIComponent(id).replaceAll('%3A', ':');
}

export function parseTaskHref(hash) {
  if (hash === '#tasks') return { id: null };
  const id = hash.startsWith('#tasks/') && hash.slice(7);
  return id && idPattern.test(id) ? { id } : null;
}

export function organizeTasks(tasks, filters, controls = {}) {
  const query = (filters.query ?? '').trim().toLowerCase();
  const hasControl = task => Object.hasOwn(controls, task.id);
  const rank = task => {
    const index = priorities.indexOf(hasControl(task) ? controls[task.id].priority : undefined);
    return index < 0 ? priorities.length : index;
  };
  const visible = tasks.filter(task =>
    (filters.source !== 'private' || hasControl(task)) &&
    (!filters.state || filters.state === 'all' || task.state === filters.state) &&
    [task.title, task.objective, task.id, task.classification?.primary].join(' ').toLowerCase().includes(query));
  visible.sort((a, b) => {
    const newest = String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
    if (filters.sort === 'oldest') return -newest || a.id.localeCompare(b.id);
    if (filters.sort === 'priority') return rank(a) - rank(b) || newest || a.id.localeCompare(b.id);
    if (filters.sort === 'title') return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
    return newest || a.id.localeCompare(b.id);
  });
  const groups = new Map();
  for (const task of visible) {
    const label = (filters.group === 'state' ? task.state :
      filters.group === 'category' ? task.classification?.primary : 'All Tasks') ?? 'Unavailable';
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(task);
  }
  return [...groups];
}

export function dependencyGraph(current, tasks) {
  const index = new Map(tasks.map(task => [task.id, task]));
  const node = id => {
    const task = index.get(id);
    return { id, task, status: !task ? 'unverified' : task.state === 'accepted' ? 'satisfied' : 'unsatisfied' };
  };
  return {
    upstream: [...new Set(current.prerequisites?.task_ids ?? [])].map(node),
    downstream: tasks.filter(task => task.id !== current.id && task.prerequisites?.task_ids?.includes(current.id))
      .map(task => node(task.id)),
  };
}

export function taskActivity(task, attempts, events, lifecycle) {
  const humanize = state => String(state).replaceAll('_', ' ');
  if (lifecycle && ['running', 'pausing', 'cancelling', 'queued', 'scheduled', 'ready', 'paused'].includes(lifecycle.state)) {
    return { label: 'Engine ' + humanize(lifecycle.state), at: lifecycle.state === 'scheduled'
      && Number.isFinite(lifecycle.start_at) ? new Date(lifecycle.start_at).toISOString() : null };
  }
  const time = attempt => attempt.finished_at ?? attempt.started_at ?? attempt.created_at;
  const latest = attempts.filter(attempt => attempt.task_id === task.id).sort((a, b) =>
    String(time(b) ?? '').localeCompare(String(time(a) ?? '')))[0];
  const event = events.filter(event => event.task_id === task.id && (!latest || event.attempt_id === latest.id))
    .sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)))[0];
  if (latest) return {
    label: latest.state === 'running' ? 'Attempt last reported running' : 'Latest attempt ' + humanize(latest.state),
    at: [time(latest), event?.occurred_at].filter(Boolean).sort().at(-1) ?? null,
  };
  if (event) return { label: 'Execution event reported', at: event.occurred_at ?? null };
  return { label: 'No execution reported', at: null };
}
