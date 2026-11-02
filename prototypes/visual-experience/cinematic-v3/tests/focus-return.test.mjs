import test from "node:test";
import assert from "node:assert/strict";
import { returnFocusAfterDialogClose } from "../src/focus-return.ts";

test("delayed native dialog close preserves deliberate Vela, resource or composer focus", () => {
  const body = {},
    inside = {},
    vela = {},
    resource = {},
    composer = {};
  const document = { body, activeElement: null };
  const surface = {
    ownerDocument: document,
    contains: (node) => node === inside,
  };
  let restored = 0;
  const trigger = { isConnected: true, focus: () => restored++ };
  for (const active of [vela, resource, composer]) {
    document.activeElement = active;
    returnFocusAfterDialogClose(surface, trigger);
  }
  assert.equal(restored, 0, "Closing must not steal a chosen target's focus");
  for (const active of [null, body, surface, inside]) {
    document.activeElement = active;
    returnFocusAfterDialogClose(surface, trigger);
  }
  assert.equal(restored, 4, "Ordinary dismissal restores a valid trigger");
  document.activeElement = body;
  trigger.isConnected = false;
  returnFocusAfterDialogClose(surface, trigger);
  assert.equal(restored, 4);
});
