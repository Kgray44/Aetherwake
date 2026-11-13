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
