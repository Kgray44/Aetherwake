import test from "node:test";
import assert from "node:assert/strict";
import type { StreamEvent } from "../../integrated-backend/src/contracts.mts";
import {
  filterRecordedEvents,
  readRecentEvents,
  eventMetadata,
  mountEventExperience,
  type EventWindow,
  type EventFilters,
} from "../event-view.ts";
import { blockDocument } from "./component-dom.mts";
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

test("normal stream loads details only on disclosure and retires inactive or filtered details without changing event identity", (t) => {
  const view = blockDocument();
  t.after(view.install());
  const actual = window(),
    opened: string[] = [];
  let reads = 0;
  const controller = mountEventExperience(
    view.root,
    {
      snapshot() {
        reads++;
        return actual;
      },
      async refresh() {},
      openResource(id) {
        opened.push(id);
      },
    },
    { presentation: "workspace" },
  );
  t.after(() => controller.dispose());
  const query = view.root.querySelector(".aw-event-tools input");
  query.value = "synthetic-event-7";
  query.focus();
  query.setSelectionRange(2, 6);
  query.fire("input");
  const row = view.root.querySelector("[data-event-id]"),
    details = row.querySelector("details");
  assert.equal(details.children.length, 1, "A closed row contains only its summary");
  assert.equal(row.querySelector("dl"), null);
  assert.equal(row.querySelector("button"), null);
  details.open = true;
  details.fire("toggle");
  const metadata = row.querySelector("dl"),
    open = row.querySelector("button");
  assert.ok(metadata);
  assert.match(metadata.textContent, /Event IDsynthetic-event-7Cursor7/);
  const before = reads;
  controller.setPresentation("focused");
  controller.setPresentation("workspace");
  assert.equal(reads, before);
  controller.update();
  assert.equal(view.root.querySelector("[data-event-id]"), row);
  assert.equal(row.querySelector("dl"), metadata, "An unchanged open row retains its details");
  assert.equal(details.open, true);
  assert.equal(view.doc.activeElement, query);
  assert.deepEqual([query.selectionStart, query.selectionEnd], [2, 6]);
  assert.match(row.textContent, /simulated/);
  assert.equal(row.querySelector(".aw-event-time").getAttribute("datetime"), "2026-11-01T12:00:00.000Z");
  assert.equal(row.querySelector(".aw-event-type").textContent, "turn.completed");
  assert.equal(row.querySelector(".aw-event-evidence").textContent, "simulated");
  assert.match(row.querySelector("summary").getAttribute("aria-label"), /received 2026-11-01T12:00:00.000Z/);
  open.onclick();
  assert.deepEqual(opened, ["resource-b"]);
  details.open = false;
  open.onclick();
  details.fire("toggle");
  assert.equal(details.children.length, 1);
  details.open = true;
  details.fire("toggle");
  assert.notEqual(row.querySelector("dl"), metadata);
  open.onclick();
  assert.deepEqual(opened, ["resource-b"], "A retired button cannot open a resource after reopening");
  assert.equal(view.root.querySelector(".aw-event-advanced").open, false);
  controller.setActive(false);
  assert.equal(details.open, true, "Suspension keeps the user's disclosure state");
  assert.equal(details.children.length, 1);
  const paused = reads;
  controller.update();
  assert.equal(reads, paused);
  controller.setActive(true);
  const activeOpen = row.querySelector("button");
  assert.ok(activeOpen, "The same authorized open row reloads on return");
  actual.resources = actual.resources.filter(
    (resource) => resource.id !== "resource-b",
  );
  controller.update();
  assert.equal(view.root.querySelectorAll("[data-event-id]").length, 0);
  assert.equal(details.children.length, 1);
  activeOpen.onclick();
  assert.deepEqual(
    opened,
    ["resource-b"],
    "An unavailable old row cannot open its resource",
  );
  actual.resources = [...actual.resources, { id: "resource-b", projectId: "project-b", title: "Synthetic B" }];
  controller.update();
  const replacement = view.root.querySelector("[data-event-id]").querySelector("details");
  replacement.open = true;
  replacement.fire("toggle");
  assert.ok(replacement.querySelector("dl"));
  activeOpen.onclick();
  assert.deepEqual(opened, ["resource-b"], "Reappearing event IDs do not revive old controls");
  controller.dispose();
  replacement.fire("toggle");
  assert.equal(replacement.children.length, 1, "Disposal drops metadata and prevents pending toggles from restoring it");
});

test("the capped Stream list keeps all closed rows free of metadata and related-resource controls", (t) => {
  const view = blockDocument();
  t.after(view.install());
  const controller = mountEventExperience(view.root, {
    snapshot: () => ({ ...window(), latest: 120, events: Array.from({ length: 120 }, (_, i) => event(i + 1)) }),
    async refresh() {},
    openResource() {},
  });
  t.after(() => controller.dispose());
  const rows = view.root.querySelectorAll("[data-event-id]");
  assert.equal(rows.length, 100);
  assert.equal(rows[0].dataset.eventId, "synthetic-event-120");
  assert.ok(rows.every(row => row.querySelector("details").children.length === 1));
  const details = rows[0].querySelector("details");
  details.open = true;
  details.fire("toggle");
  assert.equal(view.root.querySelectorAll("[data-event-id] dl").length, 1);
  assert.equal(view.root.querySelectorAll("[data-event-id] button").length, 1);
});
