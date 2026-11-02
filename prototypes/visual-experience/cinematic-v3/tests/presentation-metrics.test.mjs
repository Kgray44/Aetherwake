import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { summarizePresentMon } = createRequire(import.meta.url)(
  "../native/presentation-metrics.cjs",
);
test("display qualification keeps swap chains separate, ignores dropped/foreign frames and requires actual display columns", () => {
  const header =
    "Application,ProcessID,SwapChainAddress,Dropped,PresentMode,MsBetweenDisplayChange,MsUntilDisplayed";
  const rows = [
    ...Array.from(
      { length: 32 },
      () => "electron.exe,123,0x1,0,Composed: Flip,16.67,3",
    ),
    ...Array.from(
      { length: 10 },
      () => "electron.exe,123,0x1,1,Composed: Flip,0,NA",
    ),
    "electron.exe,123,0x2,0,Composed: Flip,100,",
    "other.exe,456,0x3,0,Composed: Flip,1,1",
  ];
  const result = summarizePresentMon([header, ...rows].join("\n"), 123);
  assert.equal(result.qualified, true);
  assert.equal(result.swapchains.length, 2);
  assert.equal(result.totalTargetFrames, 43);
  assert.equal(result.swapchains[0].displayedFrames, 32);
  assert.equal(result.swapchains[0].droppedFrames, 10);
  assert.equal(result.swapchains[0].displayIntervalsMs.p95, 16.67);
  assert.equal(result.swapchains[1].presentToDisplayMs.count, 0);
  assert.equal(
    summarizePresentMon("Application,callbacks\nelectron.exe,500", 123)
      .qualified,
    false,
  );
});
