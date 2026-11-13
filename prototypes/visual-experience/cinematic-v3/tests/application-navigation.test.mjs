import assert from "node:assert/strict";
import test from "node:test";
import { observeOverviewChrome } from "../src/application-navigation.ts";

test("overview chrome tracks visible bounds and releases observers only on final page exit", (t) => {
  const page = Object.assign(new EventTarget(), { innerWidth: 1000, innerHeight: 800 });
  let resize;
  let disconnected = 0;
  let rect = { left: 800, right: 975, top: 20, bottom: 150, height: 130 };
  const bar = { getBoundingClientRect: () => rect };
  const previous = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
  globalThis.ResizeObserver = class {
    constructor(callback) { resize = callback; }
    observe(element) { assert.equal(element, bar); }
    disconnect() { disconnected++; }
  };
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "ResizeObserver", previous);
    else delete globalThis.ResizeObserver;
  });
  const bottoms = [];
  observeOverviewChrome(bar, page, (bottom) => bottoms.push(bottom));
  resize();
  rect = { ...rect, height: 0 };
  page.dispatchEvent(new Event("resize"));
  const cached = Object.assign(new Event("pagehide"), { persisted: true });
  page.dispatchEvent(cached);
  assert.equal(disconnected, 0);
  rect = { ...rect, left: 10, right: 100, height: 130 };
  page.dispatchEvent(new Event("resize"));
  assert.deepEqual(bottoms, [150, 104]);
  page.dispatchEvent(new Event("pagehide"));
  page.dispatchEvent(new Event("pagehide"));
  page.dispatchEvent(new Event("resize"));
  assert.equal(disconnected, 1);
  assert.deepEqual(bottoms, [150, 104]);
});
