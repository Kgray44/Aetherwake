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
    (filters.source !== 'private' || hasControl(task) && controls[task.id].source !== 'published') &&
    ((!filters.state || filters.state === 'all') ? task.state !== 'archived' : task.state === filters.state) &&
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

export function dependencyGraph(current,tasks,{lifecycle,summaries}={}) {
  const index=new Map(tasks.map(task=>[task.id,task]));
  const checks=new Map((lifecycle?.prerequisite_status??[]).map(item=>[item.type+':'+item.id,item]));
  const node=id=>{
    const task=index.get(id);
    const check=checks.get('task:'+id);
    const summary=summaries?.get(id);
    const stored=summary?.lifecycle.stored_state;
    const acceptedArchive=stored==='archived'&&summary.task?.owner_acceptance==='accepted';
    const status=check?.status??(summaries
      ? !summary?'unverified':stored==='completed'||acceptedArchive?'satisfied':'unsatisfied'
      : !task?'unverified':task.state==='accepted'?'satisfied':'unsatisfied');
    return {id,task,status,...(check?{reason:check.state}:{})};
  };
  return {
    upstream:[...new Set(current.prerequisites?.task_ids??[])].map(node),
    downstream:tasks.filter(task=>task.id!==current.id&&task.prerequisites?.task_ids?.includes(current.id)).map(task=>node(task.id)),
    capabilities:[...new Set(current.prerequisites?.capabilities??[])].map(id=>{
      const check=checks.get('capability:'+id);
      const attested=lifecycle?.prerequisites?.includes(id);
      return {id,status:check?.status??(attested?'satisfied':'unverified'),
        reason:check?.state??(attested?'attested':'unsatisfied')};
    }),
  };
}

const inactiveStates = new Set(['archived','cancelled','superseded']);
const waitingStates = new Set(['ready','queued','admitted','scheduled','paused']);

export function taskActivity(task,attempts,events,lifecycle,workerAccess) {
  if (workerAccess==='not_configured' && ['queued','ready'].includes(lifecycle?.state)) {
    return {label:'Waiting for Codex worker access',at:null};
  }
  const humanize = state => String(state).replaceAll('_', ' ');
  if (lifecycle && (['running','pausing','cancelling','blocked','failed','verifying','completed'].includes(lifecycle.state) ||
      waitingStates.has(lifecycle.state) || inactiveStates.has(lifecycle.state))) {
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

export function workspaceCounts(tasks, attempts, summaries) {
  const latest = new Map();
  const stamp = attempt => attempt.finished_at ?? attempt.started_at ?? attempt.created_at ?? '';
  for (const attempt of attempts) {
    const previous = latest.get(attempt.task_id);
    if (!previous || stamp(attempt) > stamp(previous)) latest.set(attempt.task_id, attempt);
  }
  const counts = { active: 0, accepted: 0, succeeded: 0, review: 0, waiting: 0, issues: 0, unlinked: 0, reportedRunning: 0 };
  for (const task of tasks) {
    const engine = summaries.get(task.id)?.lifecycle;
    const state = engine?.state ?? task.state;
    const report = latest.get(task.id);
    if (inactiveStates.has(state)) continue;
    if (task.owner_acceptance === 'accepted' && ['completed', 'accepted'].includes(state)) counts.accepted++;
    else if (engine && ['running','pausing','cancelling'].includes(state)) counts.active++;
    else if (state === 'verifying') counts.review++;
    else if (engine && waitingStates.has(state)) counts.waiting++;
    else if (['failed','blocked'].includes(state) || report?.state === 'failed') counts.issues++;
    else if (report?.state === 'succeeded') counts.succeeded++;
    else if (report?.state === 'running') counts.reportedRunning++;
    else if (!report && !engine?.executor) counts.unlinked++;
  }
  return counts;
}

export function attemptEvents(attempt, events) {
  return events.filter(event => event.task_id === attempt.task_id && event.attempt_id === attempt.id && event.revision === attempt.revision)
    .sort((a,b) => String(a.occurred_at).localeCompare(String(b.occurred_at)));
}
