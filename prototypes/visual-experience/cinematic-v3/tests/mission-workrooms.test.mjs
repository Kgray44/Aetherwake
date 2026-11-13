import test from "node:test";
import assert from "node:assert/strict";
import { createMissionWorkrooms } from "../src/mission-workrooms.ts";

test("scope and access reach each live workroom and disposal retires it once", () => {
  const document = new EventTarget();
  const registry = createMissionWorkrooms(document);
  const calls = [];
  const mount = () =>
    registry.track({
      observe: (changed) => calls.push(["observe", changed]),
      setScope: (scope) => calls.push(["scope", scope]),
      disconnect: () => calls.push(["disconnect"]),
      dispose: () => calls.push(["dispose"]),
    });
  const first = mount();
  registry.setScope("workspace-a");
  assert.equal(registry.scope, "workspace-a");
  registry.setScope("workspace-a");
  registry.observe(true);
  document.dispatchEvent(new Event("visibilitychange"));
  first.dispose();
  first.dispose();
  registry.observe(true);
  mount();
  registry.dispose();
  document.dispatchEvent(new Event("visibilitychange"));
  assert.deepEqual(calls, [
    ["scope", "workspace-a"],
    ["observe", true],
    ["observe", false],
    ["dispose"],
    ["dispose"],
  ]);
});

test("disconnect closes the tracked surface and prevents refresh or scope reactivation", () => {
  const document = new EventTarget();
  const registry = createMissionWorkrooms(document);
  let closed = 0;
  const surface = registry.track({
    observe: () => assert.fail("disconnected surface refreshed"),
    setScope: () => assert.fail("disconnected surface changed scope"),
    disconnect: () => surface.dispose(),
    dispose: () => closed++,
  });
  registry.disconnect();
  registry.disconnect();
  registry.setScope("another-workspace");
  registry.observe(true);
  document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(registry.scope, null);
  const late = registry.track({
    observe: () => assert.fail("late surface refreshed"),
    setScope: () => assert.fail("late surface changed scope"),
    disconnect: () => closed++,
    dispose() {},
  });
  late.dispose();
  registry.dispose();
  assert.equal(closed, 2);
});
