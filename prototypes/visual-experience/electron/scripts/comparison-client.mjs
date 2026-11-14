import {
  mkdirSync,
  renameSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

const [dir, id, operation, argument] = process.argv.slice(2);
if (!path.isAbsolute(dir ?? "") || !/^[A-Za-z0-9_-]{1,64}$/.test(id ?? "")) {
  throw new Error(
    "Usage: node scripts/comparison-client.mjs <absolute-dir> <safe-id> <json-command|stream-messages|stream-events|interrupt|plan:S4|schedule:S4> [config-path|block]",
  );
}
mkdirSync(dir, { recursive: true });

function request(actionId, command) {
  const target = path.join(dir, `${actionId}.request.json`);
  if (existsSync(target))
    throw new Error(`Request already exists: ${actionId}`);
  const temp = `${target}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify({ id: actionId, command }));
  renameSync(temp, target);
  return performance.now();
}
async function response(actionId) {
  const target = path.join(dir, `${actionId}.response.json`);
  const deadline = performance.now() + 10_000;
  while (!existsSync(target)) {
    if (performance.now() > deadline)
      throw new Error(`Response timed out: ${actionId}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const value = JSON.parse(readFileSync(target, "utf8"));
  if (!value.ok) throw new Error(`${actionId}: ${value.error}`);
  return value;
}

if (operation?.startsWith("schedule:") || operation?.startsWith("plan:")) {
  const planOnly = operation.startsWith("plan:");
  const scenarioId = operation.slice(operation.indexOf(":") + 1);
  const config = JSON.parse(readFileSync(argument, "utf8"));
  const spec = config.scenarios.find((s) => s.id === scenarioId);
  if (!spec || spec.durationSeconds !== 30)
    throw new Error("Unsupported 30-second scenario");
  const actions = [];
  const add = (atMs, label, command) => actions.push({ atMs, label, command });
  if (scenarioId === "S2") add(0, "reset", { op: "reset" });
  else if (scenarioId === "S3")
    add(0, "working", { op: "setVela", state: "working" });
  else if (scenarioId === "S4") {
    for (let n = 0; n < spec.appendCount; n++)
      add(n * spec.appendIntervalMs, `append-${n + 1}`, {
        op: "appendMessages",
        count: 1,
      });
    for (let n = 0; n < spec.scrollSteps; n++)
      add(n * spec.scrollIntervalMs, `scroll-${n + 1}`, {
        op: "scrollChat",
        index: Math.floor(((n + 1) * 1999) / spec.scrollSteps),
      });
  } else if (scenarioId === "S5") {
    for (let n = 0; n < spec.appendCount; n++)
      add(n * spec.appendIntervalMs, `append-${n + 1}`, {
        op: "appendEvents",
        count: 1,
      });
  } else if (scenarioId === "S6") {
    const t = spec.actionTimesSeconds.map((n) => n * 1000);
    add(t[0], "select-message", { op: "selectMessage", index: 1000 });
    add(t[1], "expand-conversation", {
      op: "expandBlock",
      block: "conversation",
    });
    add(t[2], "interrupt-expand-activity", {
      op: "expandBlock",
      block: "activity",
    });
    add(t[2] + 300, "interrupt-collapse-activity", {
      op: "collapseBlock",
      block: "activity",
    });
    add(t[3], "keyboard-equivalent-nudge", {
      op: "nudgeBlock",
      block: "conversation",
      delta: 1,
    });
    add(t[4], "native-window-resize", {
      op: "setWindowBounds",
      target: "main",
      width: 1420,
      height: 900,
    });
    add(t[5], "scripted-swap-not-pointer-drag", {
      op: "swapBlocks",
      first: "conversation",
      second: "activity",
    });
  } else if (scenarioId === "S7") {
    spec.states.forEach((state, n) =>
      add(spec.actionTimesSeconds[n] * 1000, `vela-${state}-${n + 1}`, {
        op: "setVela",
        state: state === "attention" ? "attention required" : state,
      }),
    );
  } else if (scenarioId === "S8") {
    const t = spec.actionTimesSeconds.map((n) => n * 1000);
    add(t[0], "open-detached-activity", {
      op: "openWindow",
      block: "activity",
    });
    add(t[1], "focus-detached-activity", {
      op: "focusWindow",
      target: "activity",
    });
    add(t[2], "close-detached-activity", {
      op: "closeWindow",
      block: "activity",
    });
    add(t[3], "reopen-detached-activity", {
      op: "openWindow",
      block: "activity",
    });
  } else if (scenarioId === "S9b") add(0, "minimize", { op: "minimizeWindow" });
  else if (scenarioId === "S9c") add(0, "restore", { op: "restoreWindow" });
  else if (scenarioId === "S10a")
    add(0, "reduced-motion", { op: "setReduced", reduced: true });
  else if (scenarioId === "S10b") {
    add(0, "normal-motion", { op: "setReduced", reduced: false });
    add(10, "efficient-quality", { op: "setQuality", quality: "efficient" });
  } else
    throw new Error(
      `${scenarioId} requires external control or is unsupported`,
    );
  actions.sort((a, b) => a.atMs - b.atMs);
  if (planOnly) {
    console.log(
      JSON.stringify({
        scenarioId,
        durationSeconds: spec.durationSeconds,
        actions,
      }),
    );
  } else {
    const anchor = performance.now();
    const scheduled = [];
    for (const [n, action] of actions.entries()) {
      const waitMs = anchor + action.atMs - performance.now();
      if (waitMs > 0)
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      const actionId = `${id}-${String(n + 1).padStart(2, "0")}`;
      scheduled.push({
        actionId,
        label: action.label,
        plannedAtMs: action.atMs,
        actualAtMs: request(actionId, action.command) - anchor,
      });
    }
    const remainingMs =
      anchor + spec.durationSeconds * 1000 - performance.now();
    if (remainingMs > 0)
      await new Promise((resolve) => setTimeout(resolve, remainingMs));
    const receipts = await Promise.all(
      scheduled.map((item) => response(item.actionId)),
    );
    console.log(
      JSON.stringify({
        scenarioId,
        durationSeconds: spec.durationSeconds,
        actions: scheduled.map((item, n) => ({
          ...item,
          dispatchErrorMs: item.actualAtMs - item.plannedAtMs,
          completedWallUtc: receipts[n].completedWallUtc,
          result: receipts[n].result,
        })),
      }),
    );
  }
} else if (operation === "interrupt") {
  const block = argument ?? "conversation";
  const firstId = `${id}-expand`,
    secondId = `${id}-collapse`;
  const firstAtMs = request(firstId, { op: "expandBlock", block });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const secondAtMs = request(secondId, { op: "collapseBlock", block });
  const receipts = await Promise.all([response(firstId), response(secondId)]);
  console.log(
    JSON.stringify({ block, gapMs: secondAtMs - firstAtMs, receipts }),
  );
} else if (operation === "stream-messages" || operation === "stream-events") {
  const op =
    operation === "stream-messages" ? "appendMessages" : "appendEvents";
  const anchor = performance.now();
  const scheduled = [];
  for (let n = 0; n < 60; n++) {
    const waitMs = anchor + n * 100 - performance.now();
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    const actionId = `${id}-${String(n + 1).padStart(2, "0")}`;
    scheduled.push({ actionId, sentAtMs: request(actionId, { op, count: 1 }) });
  }
  const receipts = await Promise.all(
    scheduled.map((item) => response(item.actionId)),
  );
  console.log(
    JSON.stringify({
      op,
      count: receipts.length,
      cadenceMs: 100,
      actualDispatchGapsMs: scheduled
        .slice(1)
        .map((item, n) => item.sentAtMs - scheduled[n].sentAtMs),
      firstId: scheduled[0].actionId,
      lastId: scheduled.at(-1).actionId,
      responses: receipts.map((r) => ({
        id: r.id,
        completedWallUtc: r.completedWallUtc,
        result: r.result,
      })),
    }),
  );
} else {
  if (argument !== undefined) throw new Error("Pass one JSON command argument");
  request(id, JSON.parse(operation));
  console.log(JSON.stringify(await response(id)));
}
