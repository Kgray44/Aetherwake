import type { TimelinePresentationItem, TimelineTimeAxis } from './timeline-presentation.ts';
import { timelineItemTime } from './timeline-presentation.ts';

export type TemporalOrientation = 'horizontal' | 'vertical' | 'multilane';
export const temporalKey = (item: TimelinePresentationItem) => item.event.cursor + ':' + item.event.eventId;
/** Screen geometry is derived from exact source time, never used as event state. */
export function temporalProjection(items: TimelinePresentationItem[], axis: TimelineTimeAxis, from: number, to: number, extent: number, multilane: boolean, selectedKey?: string) {
  const lanes = multilane ? [...new Set(items.map(item => item.event.providerId))].sort() : ['Recorded events'];
  const timed = items.flatMap(item => {
    const value = timelineItemTime(item, axis), time = value ? Date.parse(value) : NaN;
    if (!Number.isFinite(time) || time < from || time > to) return [];
    return [{ item, time, key: temporalKey(item), lane: multilane ? lanes.indexOf(item.event.providerId) : 0, position: (time - from) / Math.max(1, to - from) * extent }];
  }).sort((a, b) => a.time - b.time || a.item.event.cursor - b.item.event.cursor);
  const clusters: { lane: number; position: number; members: typeof timed; representative: typeof timed[number] }[] = [];
  for (const entry of timed) {
    let cluster = clusters.findLast(value => value.lane === entry.lane);
    if (!cluster || entry.position - cluster.members[0].position >= 40) {
      cluster = { lane: entry.lane, position: entry.position, members: [], representative: entry }; clusters.push(cluster);
    }
    cluster.members.push(entry);
    if (entry.key === selectedKey) { cluster.representative = entry; cluster.position = entry.position; }
  }
  return { lanes, timed, clusters };
}
const steps = [1000, 5000, 15000, 60000, 300000, 900000, 3600000, 21600000, 86400000, 604800000, 2592000000, 31536000000];
export function temporalTicks(from: number, to: number, extent: number, zone: string) {
  const span = to - from;
  if (!Number.isFinite(span) || span <= 0) return [];
  const desired = span / Math.max(1, Math.floor(extent / 145));
  const step = steps.find(value => value >= desired) ?? Math.ceil(desired / steps.at(-1)!) * steps.at(-1)!;
  let formatter: Intl.DateTimeFormat;
  try { formatter = new Intl.DateTimeFormat(undefined, { timeZone: zone, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: span < 60000 ? '2-digit' : undefined, timeZoneName: 'shortOffset' }); }
  catch { formatter = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'shortOffset' }); }
  const ticks: { time: number; position: number; label: string }[] = [];
  for (let time = Math.ceil(from / step) * step; time <= to && ticks.length < 32; time += step) ticks.push({ time, position: (time - from) / span * extent, label: formatter.format(time) });
  return ticks;
}
/** Keep the selected instant at its existing fraction of the viewport. */
export function temporalZoom(from: number, to: number, factor: number, anchor = (from + to) / 2) {
  const ratio = Math.max(0, Math.min(1, (anchor - from) / (to - from))), span = Math.max(1000, Math.min(630720000000, (to - from) * factor));
  return { from: anchor - ratio * span, to: anchor + (1 - ratio) * span };
}
/** Recorded timestamps and elapsed host time define review progress; no inferred activity. */
export function recordedReviewTime(start: number, elapsed: number, rate: number, end: number) {
  return Math.min(end, start + Math.max(0, elapsed) * rate);
}
/** An explicit UTC/offset instant avoids guessing either side of a DST overlap. */
export function planningInstant(value: string, zone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw Error('Enter ISO date/time with seconds and an explicit Z or UTC offset.');
  if (!zone.trim() || /^[+-]/.test(zone)) throw Error('Enter a named IANA timezone.');
  try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(0); } catch { throw Error('Enter a valid named IANA timezone.'); }
  const time = Date.parse(value); if (!Number.isFinite(time)) throw Error('Enter a valid exact timestamp.');
  const offset = /([+-])(\d{2}):(\d{2})$/.exec(value);
  const offsetMinutes = offset ? (offset[1] === '+' ? 1 : -1) * (Number(offset[2]) * 60 + Number(offset[3])) : 0;
  const local = new Date(time + offsetMinutes * 60000), civil = value.slice(0, 19);
  if (local.toISOString().slice(0, 19) !== civil) throw Error('The date or UTC offset is invalid.');
  return new Date(time).toISOString();
}
export function planningSnap(value: number, interval: number) { return Math.round(value / interval) * interval; }
export function planningInterval(start: number, duration: number, from: number, to: number, extent: number) {
  const end = start + duration, span = Math.max(1, to - from);
  return { visible: end >= from && start <= to, position: Math.max(0, (start - from) / span * extent), length: Math.max(8, (Math.min(to, end) - Math.max(from, start)) / span * extent) };
}
