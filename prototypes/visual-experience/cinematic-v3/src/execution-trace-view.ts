import type { MissionExecutionProfile } from '../../../integrated-backend/src/execution-profiler.mts';

type Attempt = MissionExecutionProfile['attempts'][number];
const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const milliseconds = (value: number | null | undefined) => value == null ? 'Unavailable' : number.format(value) + ' ms';

export function projectTraceClocks(attempts: readonly Attempt[]) {
  const groups = new Map<string, (Attempt & { interval: NonNullable<Attempt['interval']> })[]>();
  for (const attempt of attempts) {
    const span = attempt.interval;
    if (!span || !Number.isFinite(span.start) || !Number.isFinite(span.end) || span.end < span.start) continue;
    const group = groups.get(span.clock) ?? [];
    group.push({ ...attempt, interval: span });
    groups.set(span.clock, group);
  }
  return Array.from(groups, ([clock, group]) => {
    const start = Math.min(...group.map(attempt => attempt.interval.start));
    const end = Math.max(...group.map(attempt => attempt.interval.end));
    return { clock, start, duration: end - start,
      attempts: group.map(attempt => ({ attempt, offset: attempt.interval.start - start,
        duration: attempt.interval.end - attempt.interval.start })) };
  });
}

export function mountExecutionTrace(doc: Document) {
  const element = doc.createElement('section');
  element.className = 'aw-execution-trace';
  element.setAttribute('aria-label', 'Recorded execution trace');
  element.hidden = true;
  const chart = doc.createElement('div'), detail = doc.createElement('dl');
  const heading = doc.createElement('h5');
  heading.textContent = 'Recorded execution trace';
  element.append(heading, chart, detail);
  let missionId: string | undefined, selectedId: string | undefined, rendered: MissionExecutionProfile | null = null;
  const controls = new Map<string, HTMLButtonElement>();
  function select(attempt?: Attempt) {
    selectedId = attempt?.id;
    for (const [id, control] of controls) control.setAttribute('aria-pressed', String(id === selectedId));
    detail.replaceChildren();
    if (!attempt) return;
    const rows: [string, string | number | null | undefined][] = [
      ['Attempt', attempt.id], ['Task', attempt.taskId], ['Outcome', attempt.state],
      ['Executor', attempt.executor], ['Plan revision', attempt.planRevision],
      ['Start event', attempt.start.eventSeq], ['Started', attempt.start.utc],
      ['End event', attempt.end?.eventSeq], ['Ended', attempt.end?.utc],
      ['Occupied span', attempt.interval ? milliseconds(attempt.interval.end - attempt.interval.start) : null],
      ['Observed ready wait', milliseconds(attempt.readyQueueMs)],
      ['Execution', milliseconds(attempt.executionMs)], ['Verification', milliseconds(attempt.verificationMs)],
      ['Provider adapter', milliseconds(attempt.providerAdapterMs)],
      ['Provider evidence', attempt.providerEvidence],
      ['Predecessor attempts', attempt.predecessors?.join(', ') || (attempt.predecessors ? 'None recorded' : null)],
      ['Verified evidence', attempt.verifiedEvidenceIds.join(', ') || 'None recorded'],
    ];
    for (const [label, value] of rows) {
      const term = doc.createElement('dt'), reading = doc.createElement('dd');
      term.textContent = label;
      reading.textContent = String(value ?? 'Unavailable');
      detail.append(term, reading);
    }
  }
  function row(parent: HTMLElement, attempt: Attempt, critical: boolean, span?: { offset: number; duration: number; extent: number }) {
    const control = doc.createElement('button'), label = doc.createElement('span'), track = doc.createElement('span');
    control.type = 'button';
    control.dataset.traceAttempt = attempt.id;
    control.dataset.criticalPath = String(critical);
    control.setAttribute('aria-pressed', 'false');
    label.textContent = attempt.taskId + ' · ' + attempt.state + (critical ? ' · Critical path' : '');
    track.className = 'aw-execution-trace-track';
    if (span) {
      const bar = doc.createElement('span');
      const extent = span.extent || 1;
      bar.style.insetInlineStart = span.offset / extent * 100 + '%';
      bar.style.width = span.duration / extent * 100 + '%';
      bar.setAttribute('aria-hidden', 'true');
      track.append(bar);
      track.setAttribute('aria-label', 'Offset ' + milliseconds(span.offset) + ', duration ' + milliseconds(span.duration));
    } else {
      track.textContent = 'Interval unavailable';
    }
    control.append(label, track);
    control.onclick = () => select(attempt);
    parent.append(control);
    controls.set(attempt.id, control);
  }
  return {
    element,
    update(profile: MissionExecutionProfile | null, clearSelection = false) {
      if (clearSelection || profile && profile.missionId !== missionId) selectedId = undefined;
      if (profile === rendered && !clearSelection) return;
      const focusedId = (doc.activeElement as HTMLElement | null)?.dataset.traceAttempt;
      rendered = profile;
      element.hidden = !profile;
      chart.replaceChildren();
      detail.replaceChildren();
      controls.clear();
      if (!profile) return;
      missionId = profile.missionId;
      const critical = new Set(profile.work.criticalPath?.attemptIds);
      const measured = new Set<string>();
      for (const [index, clock] of projectTraceClocks(profile.attempts).entries()) {
        const group = doc.createElement('section'), title = doc.createElement('p');
        title.textContent = 'Clock ' + (index + 1) + ' · 0–' + milliseconds(clock.duration) + ' from first measured start';
        group.append(title);
        for (const span of clock.attempts) {
          measured.add(span.attempt.id);
          row(group, span.attempt, critical.has(span.attempt.id), { ...span, extent: clock.duration });
        }
        chart.append(group);
      }
      const unknown = profile.attempts.filter(attempt => !measured.has(attempt.id));
      if (unknown.length) {
        const group = doc.createElement('section'), title = doc.createElement('p');
        title.textContent = 'Attempts without comparable timing';
        group.append(title);
        for (const attempt of unknown) row(group, attempt, critical.has(attempt.id));
        chart.append(group);
      }
      if (!profile.attempts.length) chart.textContent = 'No retained attempt spans.';
      select(profile.attempts.find(attempt => attempt.id === selectedId));
      if (focusedId) controls.get(focusedId)?.focus({ preventScroll: true });
    },
  };
}
