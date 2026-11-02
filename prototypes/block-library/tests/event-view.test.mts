import test from "node:test";
import assert from "node:assert/strict";
import type { StreamEvent } from "../../integrated-backend/src/contracts.mts";
import {
  filterRecordedEvents,
  readRecentEvents,
  eventMetadata,
  type EventWindow,
  type EventFilters,
} from "../event-view.ts";
test("recent event replay seeks the retained tail instead of showing the first default page as the latest activity", async () => {
  const calls: { after: number; limit: number }[] = [];
  const result = await readRecentEvents(async (input) => {
    calls.push(input);
    return {
      events: input.limit === 1 ? [event(401)] : [event(451), event(700)],
      earliest: 401,
      latest: 700,
      truncated: input.after < 400,
    };
  });
  assert.deepEqual(calls, [
    { after: 0, limit: 1 },
    { after: 450, limit: 250 },
  ]);
  assert.equal(result.earliest, 401);
  assert.deepEqual(
    result.events.map((event) => event.cursor),
    [451, 700],
  );
});
const event = (
  cursor: number,
  overrides: Partial<StreamEvent> = {},
): StreamEvent => ({
  schemaVersion: 1,
  eventId: "synthetic-event-" + cursor,
  cursor,
  resourceId: "resource-a",
  executionId: "execution-a",
  providerId: "synthetic-provider",
  providerInstanceId: "instance-a",
  connectionId: "connection-a",
  nativeEventId: null,
  nativeSequence: cursor,
  threadId: "native-thread",
  turnId: "native-turn",
  correlationId: "command-a",
  causationId: "cause-a",
  receivedAt: "2026-11-01T12:00:00.000Z",
  providerTime: null,
  providerTimeSource: null,
  type: "turn.completed",
  classification: "reported",
  status: "completed",
  payload: { redacted: true },
  ...overrides,
});
const defaults: EventFilters = {
  scope: "all",
  classification: "",
  source: "",
  resourceId: "",
  executionId: "",
  query: "",
};
const window = (): EventWindow => ({
  events: [
    event(4),
    event(7, {
      resourceId: "resource-b",
      classification: "simulated",
      providerId: "fixture",
      executionId: "execution-b",
    }),
    event(9, { resourceId: "revoked", providerId: "hidden-provider" }),
    event(12, {
      resourceId: null,
      type: "stream/gap-or-reorder",
      classification: "inferred",
    }),
  ],
  earliest: 4,
  latest: 12,
  disconnected: false,
  resources: [
    { id: "resource-a", projectId: "project-a", title: "Synthetic A" },
    { id: "resource-b", projectId: "project-b", title: "Synthetic B" },
  ],
  workspaceResourceIds: ["resource-a"],
  projectId: "project-a",
});

test("event views preserve canonical identity/evidence and current-membership scope without exposing unavailable sources", () => {
  const input = window(),
    before = structuredClone(input);
  assert.deepEqual(
    filterRecordedEvents(input, defaults).map((e) => e.cursor),
    [12, 7, 4],
  );
  assert.deepEqual(
    filterRecordedEvents(input, { ...defaults, scope: "workspace" }).map(
      (e) => e.eventId,
    ),
    ["synthetic-event-4"],
  );
  assert.deepEqual(
    filterRecordedEvents(input, { ...defaults, scope: "project" }).map(
      (e) => e.eventId,
    ),
    ["synthetic-event-4"],
  );
  assert.equal(
    filterRecordedEvents(
      { ...input, projectId: null },
      { ...defaults, scope: "project" },
    ).length,
    0,
  );
  assert.equal(
    filterRecordedEvents(input, defaults).find((e) => e.cursor === 7)
      ?.classification,
    "simulated",
  );
  assert.deepEqual(input, before);
});
test("stream filters intersect actual source/class/resource/execution/time metadata", () => {
  const input = window();
  assert.deepEqual(
    filterRecordedEvents(input, {
      ...defaults,
      source: "fixture",
      classification: "simulated",
      resourceId: "resource-b",
      executionId: "execution-b",
      query: "completed synthetic-event-7",
    }).map((e) => e.cursor),
    [7],
  );
  assert.equal(
    filterRecordedEvents(input, {
      ...defaults,
      source: "fixture",
      classification: "observed",
    }).length,
    0,
  );
  assert.equal(
    filterRecordedEvents(input, {
      ...defaults,
      since: Date.parse("2026-11-01T12:00:01Z"),
    }).length,
    0,
  );
  assert.equal(
    filterRecordedEvents(input, { ...defaults, query: "private reasoning" })
      .length,
    0,
  );
});
test("metadata detail allowlist excludes assistant output and private tool payloads while missing measurements remain unavailable", () => {
  const record = event(1, {
    payload: {
      redacted: true,
      textBytes: 0,
      itemType: "tool",
      delta: "SYNTHETIC_PRIVATE_OUTPUT",
      privateReasoning: "SYNTHETIC_PRIVATE_REASONING",
    } as any,
  });
  const metadata = eventMetadata(record),
    text = JSON.stringify(metadata);
  assert.equal(metadata["Evidence class"], "reported");
  assert.equal(metadata["Provider time"], "Unavailable");
  assert.equal(metadata["Recorded output bytes"], "0");
  assert.equal(metadata["Execution"], "execution-a");
  assert.equal(text.includes("SYNTHETIC_PRIVATE"), false);
});
