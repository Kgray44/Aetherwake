function unionMs(spans) {
  let total = 0, end = -Infinity;
  for (const span of spans) {
    total += Math.max(0, span.end - Math.max(span.start, end));
    end = Math.max(end, span.end);
  }
  return total;
}

export function traceTimeline(events) {
  const grouped = new Map();
  for (const event of events) {
    if (event.kind === 'lifecycle') continue;
    const key = JSON.stringify([event.task_id, event.attempt_id, event.revision, event.trace_id, event.span_id]);
    const group = grouped.get(key) ?? [];
    group.push(event);
    grouped.set(key, group);
  }
  const spans = [];
  for (const [key, group] of grouped) {
    const starts = group.filter(event => event.kind === 'span_start');
    const ends = group.filter(event => event.kind === 'span_end');
    const first = starts[0] ?? ends[0] ?? group[0];
    const last = ends[0];
    const start = Date.parse(starts[0]?.occurred_at);
    const end = Date.parse(last?.occurred_at);
    const complete = starts.length === 1 && ends.length === 1 && start <= end && first.phase === last.phase;
    const elapsed = last?.measurements?.find(metric => metric.name === 'elapsed_wall_ms' &&
      metric.availability === 'observed' && metric.unit === 'ms' && Number.isFinite(metric.value) && metric.value >= 0);
    spans.push({
      key, id: first.span_id, parent: first.parent_span_id, task: first.task_id,
      attempt: first.attempt_id, phase: first.phase, outcome: complete ? last.state : undefined,
      at: Date.parse(first.occurred_at), start, end, complete, monotonicMs: complete ? elapsed?.value ?? null : null,
      events: group
    });
  }
  spans.sort((a, b) => a.at - b.at);
  const complete = spans.filter(span => span.complete);
  const phases = [...new Set(complete.map(span => span.phase))].map(phase => ({
    phase,
    coveredMs: unionMs(complete.filter(span => span.phase === phase))
  })).sort((a,b) => b.coveredMs - a.coveredMs);
  return {
    spans, phases, incomplete: spans.length - complete.length,
    coveredMs: complete.length ? unionMs(complete) : null
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Compare only phases with recorded boundaries across comparable Tasks. */
export function recurringTraceBottlenecks(records, events) {
  const byTask = new Map();
  for (const event of events) {
    const group = byTask.get(event.task_id) ?? [];
    group.push(event);
    byTask.set(event.task_id, group);
  }
  const classes = new Map();
  const taskClasses = new Map(records.filter(record => record.record_type === 'task')
    .map(task => [task.id, task.classification?.primary]));
  for (const [taskId, taskClass] of taskClasses) {
    if (!taskClass || !byTask.has(taskId)) continue;
    const { phases, incomplete } = traceTimeline(byTask.get(taskId));
    if (incomplete || !phases.length || phases[0].coveredMs <= 0 ||
        phases[0].coveredMs === phases[1]?.coveredMs) continue;
    const group = classes.get(taskClass) ?? [];
    group.push(phases[0]);
    classes.set(taskClass, group);
  }
  const findings = [];
  for (const [taskClass, group] of classes) {
    for (const phase of new Set(group.map(entry => entry.phase))) {
      const times = group.filter(entry => entry.phase === phase).map(entry => entry.coveredMs);
      // Require repetition across Tasks and a majority within the class.
      if (times.length >= 3 && times.length * 2 > group.length) {
        findings.push({ taskClass, phase, comparableTasks: group.length, dominantTasks: times.length,
          medianMs: median(times) });
      }
    }
  }
  return findings.sort((a, b) => b.medianMs - a.medianMs);
}
