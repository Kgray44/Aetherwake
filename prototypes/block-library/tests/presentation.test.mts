import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { applyBlockConfiguration } from "../configuration-view.ts";
import { applyBlockPoseStyle } from "../pose-style.ts";

// CPU-only declaration boundary: assigning cssText replaces all declarations.
// This checks the actual configuration/pose functions, not computed browser CSS.
class Declaration {
  values = new Map<string, string>();
  writes = 0;
  set cssText(value: string) {
    this.writes++;
    this.values.clear();
    for (const declaration of value.split(";")) {
      const separator = declaration.indexOf(":");
      if (separator > 0)
        this.values.set(
          declaration.slice(0, separator).trim(),
          declaration.slice(separator + 1).trim(),
        );
    }
  }
  getPropertyValue(name: string) {
    return this.values.get(name) ?? "";
  }
  setProperty(name: string, value: string) {
    this.writes++;
    this.values.set(name, value);
  }
}

const originalDocument = globalThis.document;
before(() => {
  globalThis.document = { createElement: () => ({ style: new Declaration() }) } as unknown as Document;
});
after(() => { globalThis.document = originalDocument; });

test("configured typography survives the actual pose writer through focus, movement and resizing", () => {
  const style = new Declaration(),
    editor = { rows: 5 },
    dataset: Record<string, string> = {};
  const root = {
    style,
    dataset,
    querySelectorAll: () => [editor],
  } as unknown as HTMLElement;
  applyBlockConfiguration(root, {
    schemaVersion: 1,
    textScale: 1.5,
    contentMode: "reading",
  });
  for (const pose of [
    "left:22px;top:44px;width:420px;height:280px;--unfold:0;transform:perspective(1500px) translateZ(0px) rotateZ(0deg) rotateY(0deg);clip-path:inset(0 round 18px);",
    "left:200px;top:150px;width:900px;height:700px;--unfold:1;transform:perspective(1500px) translateZ(10px) rotateZ(0deg) rotateY(0deg);clip-path:inset(0 round 18px);",
    "left:61px;top:97px;width:486px;height:330px;--unfold:0;transform:perspective(1500px) translateZ(0px) rotateZ(3deg) rotateY(2deg);clip-path:inset(0 round 18px);",
  ]) {
    const expected = new Declaration();
    expected.cssText = pose;
    const writes = style.writes;
    applyBlockPoseStyle(root.style, pose);
    assert.equal(style.writes - writes, 1, "Paint the complete pose in one live write");
    assert.equal(style.getPropertyValue("--aw-block-text-scale"), "1.5");
    for (const [property, value] of expected.values)
      assert.equal(
        style.getPropertyValue(property),
        value,
        "pose declaration remains exact: " + property,
      );
    assert.equal(style.values.size, expected.values.size + 1);
    assert.equal(dataset.awContentMode, "reading");
    assert.equal(editor.rows, 10);
  }
  applyBlockConfiguration(root, {
    schemaVersion: 1,
    textScale: 2,
    contentMode: "compact",
  });
  applyBlockPoseStyle(root.style, "left:0px;top:0px;width:400px;height:280px;");
  assert.equal(style.getPropertyValue("--aw-block-text-scale"), "2");
  assert.equal(dataset.awContentMode, "compact");
  assert.equal(editor.rows, 3);
});

test("pose painting retains no stale geometry and creates no scale override before configuration is loaded", () => {
  const style = new Declaration();
  style.cssText = "left:9px;right:99px;opacity:0.1;";
  applyBlockPoseStyle(
    style as unknown as CSSStyleDeclaration,
    "left:42px;width:500px;opacity:1;",
  );
  assert.deepEqual(Object.fromEntries(style.values), {
    left: "42px",
    width: "500px",
    opacity: "1",
  });
  assert.equal(style.getPropertyValue("--aw-block-text-scale"), "");
});
