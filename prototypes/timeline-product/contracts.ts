/** Browser-safe Timeline DTOs. Retained evidence and user-authored planning
 * have separate contracts; neither supplies task, provider or execution authority. */
export const TIMELINE_CONTRACT = "aerynth.timeline@1" as const;
export type EvidenceClass = "observed" | "reported" | "inferred" | "simulated";
export interface TimelineResource {
  id: string;
  kind: "timeline";
  title: string;
  projectId: string | null;
  version: number;
  state: "active" | "archived";
}
export interface TimelineSelection {
  eventId: string;
  cursor: number;
}
export interface TimelineView {
  schemaVersion: 1;
  mode: "activity" | "execution";
  /** Missing on existing views, which continue to use capture time. */
  timeAxis?: "receivedAt" | "reportedAt";
  /** Empty resourceIds means the authorized project/application scope, not all data. */
  scope: { projectId: string | null; resourceIds: string[] };
  sources: {
    providerIds: string[];
    eventTypes: string[];
    classifications: EvidenceClass[];
  };
  /** Pan/zoom changes the selected time interval. Source timestamps are never rewritten. */
  viewport: { from: string; to: string; displayTimeZone: string };
  selection: TimelineSelection | null;
}
export const timelineCapabilities = Object.freeze({
  planning: false,
  forecasts: false,
  dependencies: false,
  stateReconstruction: false,
  reexecution: false,
  export: false,
});
export interface TimelineDocument {
  contract: typeof TIMELINE_CONTRACT;
  schemaVersion: 1;
  resource: TimelineResource;
  /** Current host policy hint, never persisted or accepted as mutation authority. */
  canEdit: boolean;
  view: TimelineView;
  viewDigest: string;
  selectionUnavailable: boolean;
  createdAt: string;
  updatedAt: string;
  capabilities: typeof timelineCapabilities;
}
/** Exactly the version-1 retained header. No event payloads, deltas, account
 * status, model answers, tool output or private reasoning are materialized. */
export interface TimelineEventHeader {
  schemaVersion: 1;
  eventId: string;
  cursor: number;
  resourceId: string | null;
  executionId: string | null;
  providerId: string;
  providerInstanceId: string;
  connectionId: string;
  nativeEventId: string | null;
  nativeSequence: number | null;
  threadId: string | null;
  turnId: string | null;
  correlationId: string | null;
  causationId: string | null;
  receivedAt: string;
  providerTime: number | null;
  providerTimeSource: string | null;
  type: string;
  classification: EvidenceClass;
  status: string | null;
}
export interface RecordedTimelineItem {
  kind: "recorded-event";
  temporalClass: "historical";
  evidenceClass: EvidenceClass;
  event: TimelineEventHeader;
  source: {
    store: "intelligence_events";
    cursor: number;
    eventId: string;
    schemaVersion: 1;
  };
  navigation: { resourceId: string; state: "active" | "archived" } | null;
  externalEvidence?: GitHubCommitEvidence;
  taskVerification: "not-established-by-this-projection";
}
export interface GitHubCommitEvidence {
  kind: "github-commit";
  title: string;
  source: { ref: string; label: string; permalink: string | null };
  reportedAt: string | null;
  timeSource: "github-committer" | "github-author" | null;
}
export type TimelineGapReason =
  | "source-unavailable"
  | "before-retained-cursor"
  | "cursor-discontinuity"
  | "unsupported-event-schema"
  | "invalid-event"
  | "access-filtered"
  | "scan-limit"
  | "reported-time-unavailable"
  | "selection-unavailable";
export interface TimelineEvidenceGap {
  kind: "evidence-gap";
  reason: TimelineGapReason;
  /** No protected source IDs, times, bodies or hidden counts are attached. */
  cause: "unknown" | "unavailable" | "policy" | "bounded-query";
}
export interface TimelinePage {
  resourceId: string;
  resourceVersion: number;
  viewDigest: string;
  afterCursor: number;
  throughCursor: number;
}
export interface TimelineSourceCoverage {
  kind: "github-commits";
  sourceLabel: string;
  requestedFrom: string;
  requestedTo: string;
  fetchedAt: string | null;
  status: "bounded" | "partial" | "unavailable";
  omissionReason?: string;
}
export interface TimelineWindow {
  contract: "aerynth.timeline-window@1";
  resourceId: string;
  resourceVersion: number;
  viewDigest: string;
  order: "capture-cursor";
  timeAxis: NonNullable<TimelineView["timeAxis"]>;
  scopeBasis: "current-authorized-canonical-resources";
  items: RecordedTimelineItem[];
  gaps: TimelineEvidenceGap[];
  /** External fetch coverage is independent of the retained event page. */
  sourceCoverage?: TimelineSourceCoverage;
  next: TimelinePage | null;
  source: {
    store: "intelligence_events";
    state: "retained-history" | "unavailable";
    earliestRetainedCursor: number | null;
    throughCursor: number | null;
    observedLatestCursor: number | null;
  };
  coverage: {
    matchingItems: "complete-retained-window" | "bounded" | "unavailable";
    allActivity: false;
    rawPayloads: false;
    unscopedEvents: "authorized-global-only";
    timeComparability: "capture-order-is-not-global-causality";
  };
  hasNewEvents: boolean | null;
  selectionUnavailable: boolean;
  capabilities: typeof timelineCapabilities;
}
export interface CreateTimeline {
  commandId: string;
  title: string;
  projectId: string | null;
  view: TimelineView;
}
export interface SaveTimeline {
  commandId: string;
  resourceId: string;
  expectedVersion: number;
  view: TimelineView;
}
export interface TimelineMutationResult {
  resourceId: string;
  version: number;
  viewDigest: string;
}
export interface QueryTimeline {
  resourceId: string;
  expectedVersion: number;
  limit?: number;
  page?: TimelinePage;
}
/** Canonical user-authored plans, separate from retained event evidence. */
export interface TimelinePlanningValues {
  title: string;
  /** Exact UTC ISO instant, including milliseconds and Z. Never an inferred local time. */
  startAt: string;
  /** Elapsed milliseconds, including across DST changes. */
  durationMs: number;
  /** Named IANA display zone (UTC accepted); does not reinterpret startAt. */
  timeZone: string;
  laneId: string;
}
export interface TimelinePlanningItem extends TimelinePlanningValues {
  id: string;
  temporalClass: "planned";
  /** Canonical timeline resource version at this item's last mutation. */
  version: number;
}
export type TimelinePlanningRequest = {
  op: "list"; resourceId: string; expectedVersion: number;
} | ({ commandId: string; resourceId: string; expectedVersion: number } & (
  { op: "create"; values: TimelinePlanningValues } |
  { op: "update"; itemId: string; values: TimelinePlanningValues } |
  { op: "delete"; itemId: string } |
  { op: "undo"; targetCommandId: string }
));
export interface TimelinePlanningDocument {
  resourceId: string; resourceVersion: number; canEdit: boolean;
  items: TimelinePlanningItem[];
}
export interface TimelinePlanningMutationResult extends TimelineMutationResult {
  operationId: string;
  item: TimelinePlanningItem | null;
}
export type TimelinePlanningResponse = TimelinePlanningDocument | TimelinePlanningMutationResult;

export interface TimelinePort {
  planning?(input: TimelinePlanningRequest): Promise<TimelinePlanningResponse>;
  create(input: CreateTimeline): Promise<TimelineMutationResult>;
  read(resourceId: string): Promise<TimelineDocument>;
  save(input: SaveTimeline): Promise<TimelineMutationResult>;
  query(input: QueryTimeline): Promise<TimelineWindow>;
}
export const TIMELINE_LIMITS = Object.freeze({
  planningItems: 256,
  planningOperations: 4096,
  views: 256,
  receipts: 4096,
  viewBytes: 16384,
  resourceIds: 64,
  sourceFilters: 32,
  events: 200,
  scan: 1000,
  headerBytes: 16384,
  windowBytes: 262144,
});
