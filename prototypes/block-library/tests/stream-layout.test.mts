import test from "node:test";
import assert from "node:assert/strict";
import { layoutStream, streamPath } from "../stream-layout.ts";
import { mountEventExperience, type EventWindow } from "../event-view.ts";
import type { StreamEvent } from "../../integrated-backend/src/contracts.mts";
import type { ExperiencePose } from "../../application-contract/motion.ts";
import { blockDocument } from "./component-dom.mts";
const event = (cursor: number, extra: Partial<StreamEvent> = {}): StreamEvent => ({
  schemaVersion: 1, eventId: `event-${cursor}`, cursor, resourceId: "resource", executionId: null,
  providerId: "fixture", providerInstanceId: "fixture-instance", connectionId: "fixture-connection",
  nativeEventId: null, nativeSequence: cursor, threadId: "fixture-thread", turnId: null,
  correlationId: "shared-correlation", causationId: null, receivedAt: "2026-11-04T12:00:00Z",
  providerTime: null, providerTimeSource: null, type: "fixture/activity", classification: "simulated",
  status: "recorded", payload: { redacted: true }, ...extra,
});
const snapshot = (events: StreamEvent[]): EventWindow => ({ events, earliest: 1, latest: 999, disconnected: false,
  resources: [{ id: "resource", title: "Fixture resource", projectId: null }], workspaceResourceIds: ["resource"], projectId: null });

test("explicit canonical causes branch while shared correlation alone never creates edges", () => {
  const layout = layoutStream([event(4), event(2, { causationId: "event-1" }), event(1), event(3, { causationId: "event-1" })]);
  assert.deepEqual(layout.edges, [{ from: "event-1", to: "event-2" }, { from: "event-1", to: "event-3" }]);
  assert.notEqual(layout.nodes[1].x, layout.nodes[2].x);
  assert.equal(layout.nodes[1].y, layout.nodes[2].y);
  assert(layout.nodes[1].y > layout.nodes[0].y, 'Branches descend from their actual parent');
  assert.deepEqual([...streamPath(layout.edges, "event-2")].sort(), ["event-1", "event-2"]);
});

test('unrelated records form bounded side-by-side spatial tiles without inventing a causal sequence', () => {
  const result = layoutStream(Array.from({ length: 20 }, (_, index) => event(index + 1)));
  assert.equal(result.edges.length, 0); assert.equal(new Set(result.nodes.map(node => `${node.x}:${node.y}`)).size, 20);
  assert.equal(new Set(result.nodes.map(node => node.x)).size, 4);
  assert(result.nodes[0].y === result.nodes[1].y && result.nodes[0].x !== result.nodes[1].x);
  assert(Math.max(...result.nodes.map(node => node.x)) < 850); assert(Math.max(...result.nodes.map(node => node.y)) < 700);
});

test("native causes resolve only uniquely within provider instance, connection and thread", () => {
  const parent = event(1, { nativeEventId: "native-cause" });
  assert.equal(layoutStream([parent, event(2, { causationId: "native-cause" })]).edges.length, 1);
  for (const extra of [{ connectionId: "other" }, { providerInstanceId: "other" }, { threadId: "other" }, { providerId: "other" }]) {
    const layout = layoutStream([parent, event(2, { causationId: "native-cause", ...extra })]);
    assert.equal(layout.edges.length, 0); assert.equal(layout.unresolved, 1);
  }
  const ambiguous = layoutStream([parent, event(2, { nativeEventId: "native-cause" }), event(3, { causationId: "native-cause" })]);
  assert.equal(ambiguous.edges.length, 0);
});

test("bounded projection does not fabricate missing parents, future links or mission joins", () => {
  const events = Array.from({ length: 300 }, (_, i) => event(i + 1, { causationId: i ? `event-${i}` : null }));
  const before = structuredClone(events), layout = layoutStream(events);
  assert.equal(layout.nodes.length, 80); assert.equal(layout.omitted, 220); assert.equal(layout.unresolved, 1);
  assert.equal(layoutStream([event(1, { causationId: "event-2" }), event(2)]).edges.length, 0);
  assert.deepEqual(events, before);
});

test("Flow is primary with accessible Glimpse and Forensic modes; inspection remains authorized and allowlisted", t => {
  const dom = blockDocument(); t.after(dom.install());
  let current = snapshot([event(1, { payload: { redacted: true, delta: "private answer" } }), event(2, { causationId: "event-1" })]);
  const opened: string[] = [];
  const control = mountEventExperience(dom.root, { snapshot: () => current, async refresh() {}, openResource: id => opened.push(id) });
  t.after(() => control.dispose());
  const graph = dom.root.querySelector(".aw-stream"), list = dom.root.querySelector("ol");
  assert.equal(graph.hidden, false); assert.equal(list.hidden, true);
  const buttons = () => dom.root.querySelectorAll(".aw-stream-node");
  buttons()[0].onclick();
  assert.match(dom.root.querySelector(".aw-stream-inspector").textContent, /Event IDevent-1/);
  assert.doesNotMatch(dom.root.textContent, /private answer/);
  dom.root.querySelector(".aw-stream-inspector button").onclick(); assert.deepEqual(opened, ["resource"]);
  const retained = buttons()[0]; retained.focus(); control.update();
  assert.equal(buttons()[0], retained); assert.equal(dom.doc.activeElement, retained);
  const modes = dom.root.querySelectorAll(".aw-stream-modes button");
  modes[2].onclick(); assert.equal(graph.hidden, true); assert.equal(list.hidden, false);
  modes[0].onclick(); assert.equal(graph.hidden, false); assert.equal(list.hidden, true);
  control.setActive(false); assert.equal(dom.root.querySelector(".aw-stream-inspector").hidden, true);
  control.setActive(true);
  current = { ...current, resources: [] }; control.update();
  assert.equal(buttons().length, 0); assert.equal(dom.root.querySelector(".aw-stream-inspector").hidden, true);
  dom.root.querySelector(".aw-stream-inspector button").onclick(); assert.deepEqual(opened, ["resource"]);
});

test("host motion owns node poses and retirement; viewport has keyboard zoom/pan alternatives", t => {
  const dom = blockDocument(); t.after(dom.install());
  const poses = new Map<string, ExperiencePose>(), removed: string[] = [];
  const motion = { reduced: true, add(key: string, pose: ExperiencePose) { poses.set(key, pose); },
    target(key: string, pose: ExperiencePose) { poses.set(key, pose); }, pose(key: string) { return poses.get(key)!; },
    remove(key: string) { removed.push(key); poses.delete(key); }, wake() {} };
  const control = mountEventExperience(dom.root, { snapshot: () => snapshot([event(1)]), async refresh() {} }, { motion, viewId: "fixture-view" });
  assert.deepEqual([...poses.keys()], ["stream:fixture-view:event-1"]); control.frame();
  assert.equal(dom.root.querySelector(".aw-stream-node").style.opacity, "1");
  const viewport = dom.root.querySelector(".aw-stream-viewport"), scene = dom.root.querySelector(".aw-stream-scene");
  let prevented = false;
  viewport.onkeydown({ target: viewport, key: "ArrowRight", preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.match(scene.style.transform, /-80px/);
  viewport.onkeydown({ target: viewport, key: "Home", preventDefault() {} });
  assert.match(scene.style.transform, /translate\(20px, 20px\)/);
  control.dispose(); assert.deepEqual(removed, ["stream:fixture-view:event-1"]);
});


test("inactive Stream rejects retained node callbacks and invalid time filters clear revoked inspection", t => {
  const dom = blockDocument(), restore = dom.install();
  let current = snapshot([event(1)]), reads = 0;
  const control = mountEventExperience(dom.root, { snapshot: () => { reads++; return current; }, async refresh() {} }, { active: false });
  t.after(() => { control.dispose(); restore(); });
  assert.equal(reads, 0); assert.equal(dom.root.querySelectorAll(".aw-stream-node").length, 0);
  control.setActive(true);
  const retained = dom.root.querySelector(".aw-stream-node"), inspector = dom.root.querySelector(".aw-stream-inspector");
  retained.onclick(); assert.match(inspector.textContent, /Event IDevent-1/);
  control.setActive(false); retained.onclick();
  assert.equal(inspector.hidden, true); assert.doesNotMatch(inspector.textContent, /Event IDevent-1/);
  control.setActive(true);
  const since = dom.root.querySelectorAll("input").find((input: any) => input.type === "datetime-local");
  since.value = "999999-01-01T12:00";
  current = { ...current, resources: [] }; control.update(); retained.onclick();
  assert.equal(dom.root.querySelectorAll(".aw-stream-node").length, 0);
  assert.equal(dom.root.querySelectorAll("[data-event-id]").length, 0);
  assert.equal(inspector.hidden, true); assert.doesNotMatch(inspector.textContent, /Event IDevent-1/);
  assert.match(dom.root.textContent, /Choose a valid received-after time/);
  control.dispose(); retained.onclick();
  assert.equal(inspector.hidden, true); assert.doesNotMatch(inspector.textContent, /Event IDevent-1/);
});
