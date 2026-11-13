import test from "node:test";
import assert from "node:assert/strict";
import { refreshWorkspaceChrome } from "../src/application-shell.ts";

test("workspace chrome preserves controls and skips unchanged label and disabled writes", () => {
  let writes = 0;
  const control = () =>
    new Proxy(
      { textContent: "", disabled: false },
      {
        set(target, key, value) {
          writes++;
          return Reflect.set(target, key, value);
        },
      },
    );
  const controls = {
    workspace: control(),
    undo: control(),
    undoLabel: control(),
    layoutLabel: control(),
  };
  const snapshot = {
    activeWorkspaceId: "workspace",
    workspaces: [{ id: "workspace", title: "<Aerynth>" }],
    canUndo: true,
    organization: { mode: "structured" },
  };
  refreshWorkspaceChrome(controls, snapshot);
  assert.equal(controls.workspace.textContent, "<Aerynth> ↗");
  assert.equal(controls.undo.disabled, false);
  assert.equal(controls.undoLabel.textContent, "Undo layout");
  assert.equal(controls.layoutLabel.textContent, "Structured");
  const firstWrites = writes;
  refreshWorkspaceChrome(controls, snapshot);
  assert.equal(writes, firstWrites);
  refreshWorkspaceChrome(controls, { workspaces: [], canUndo: false });
  assert.equal(controls.workspace.textContent, "Workspaces ↗");
  assert.equal(controls.undo.disabled, true);
  assert.equal(controls.layoutLabel.textContent, "Layout");
});
