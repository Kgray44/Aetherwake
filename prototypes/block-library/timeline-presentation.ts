import type { RecordedTimelineItem, TimelineWindow } from '../timeline-product/contracts.ts';

export type {
  GitHubCommitEvidence as TimelineExternalEvidence,
  RecordedTimelineItem as TimelinePresentationItem,
  TimelineGapReason as TimelinePresentationGapReason,
  TimelinePort as TimelinePresentationPort,
  TimelineSourceCoverage,
  TimelineWindow as TimelinePresentationWindow,
} from '../timeline-product/contracts.ts';
/** The host owns external link resolution using the selected canonical event. */
export type TimelineExternalOpen = { timelineId: string; eventId: string; cursor: number };
export type TimelineTimeAxis = TimelineWindow['timeAxis'];

export function timelineItemTitle(item: RecordedTimelineItem) {
  return item.externalEvidence?.title || item.event.type.replaceAll('.', ' ').replaceAll('_', ' ');
}

export function timelineItemTime(item: RecordedTimelineItem, axis: TimelineTimeAxis): string | undefined {
  if (axis === 'receivedAt') return item.event.receivedAt;
  const reported = item.externalEvidence?.reportedAt;
  return reported && Number.isFinite(Date.parse(reported)) ? reported : undefined;
}
