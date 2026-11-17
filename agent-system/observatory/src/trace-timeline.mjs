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
