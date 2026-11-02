import { MotionCoordinator } from "../src/motion.ts";
import { createContextualSurfaces } from "../src/contextual-surfaces.ts";
import "../src/contextual-surfaces.css";
export async function run() {
  const checks = [];
  const check = (name, ok, detail) => {
    checks.push({ name, passed: !!ok });
    if (!ok) throw Error(name + (detail ? ": " + JSON.stringify(detail) : ""));
  };
  document.body.innerHTML =
    '<button id="anchor" style="position:fixed;left:280px;top:210px">Open</button><button id="outside" style="position:fixed;left:4px;top:4px">Other action</button><div id="source" hidden></div>';
  const anchor = document.querySelector("#anchor"),
    outside = document.querySelector("#outside"),
    source = document.querySelector("#source");
  const content = document.createElement("div");
  content.innerHTML =
    '<label>Draft <input value="Preserved draft"></label><p>Long content can wrap naturally without scaling text or controls.</p><button id="inside">Continue</button><fieldset disabled><input aria-label="Unavailable control"></fieldset><input tabindex="-1" aria-label="Programmatic focus only">';
  source.append(content);
  const input = content.querySelector("input");
  input.setSelectionRange(2, 5);
  anchor.focus();
  const motion = new MotionCoordinator();
  motion.reduced = true;
  motion.add("existing-resource", {
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    lift: 0,
    yaw: 0,
    opacity: 1,
  });
  let view = { width: 400, height: 300 },
    wakes = 0;
  const host = createContextualSurfaces({
    motion,
    wake: () => wakes++,
    viewport: () => view,
    safeInsets: { left: 8, right: 8, top: 8, bottom: 8 },
  });
  const request = {
    id: "draft",
    anchor,
    content,
    label: "Draft details",
    minSize: { width: 240, height: 120 },
    maxSize: { width: 320, height: 260 },
  };
  const panel = host.open(request);
  let r = panel.getBoundingClientRect();
  check(
    "content and input identities remain mounted with their state",
    panel.contains(input) &&
      input.value === "Preserved draft" &&
      input.selectionStart === 2 &&
      input.selectionEnd === 5,
  );
  check(
    "nonmodal surface is bounded and focuses its actual control",
    r.left >= 8 &&
      r.top >= 8 &&
      r.right <= 392.01 &&
      r.bottom <= 292.01 &&
      document.activeElement === input &&
      !panel.matches(":modal"),
  );
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 20));
    host.frame(i * 20);
  }
  const settledWakes = wakes;
  await new Promise((r) => setTimeout(r, 50));
  check(
    "measured content settles without a repeating ResizeObserver wake loop",
    wakes === settledWakes,
  );
  input.addEventListener("keydown", (event) => event.preventDefault(), {
    once: true,
  });
  const consumedEscape = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  input.dispatchEvent(consumedEscape);
  check(
    "an inner component can consume Escape without dismissing its host",
    consumedEscape.defaultPrevented && panel.isConnected,
  );
  const escape = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  input.dispatchEvent(escape);
  check(
    "Escape closes and returns focus while restoring the original content slot",
    escape.defaultPrevented &&
      !panel.isConnected &&
      document.activeElement === anchor &&
      content.parentElement === source &&
      input.value === "Preserved draft",
  );
  const outsidePanel = host.open(request);
  outside.focus();
  outside.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, clientX: 4, clientY: 4 }),
  );
  check(
    "outside-pointer dismissal does not steal focus from the new target",
    !outsidePanel.isConnected && document.activeElement === outside,
  );
  const modal = host.open({ ...request, modal: true });
  check(
    "explicit modal uses native modality and accessible dialog semantics",
    modal.matches(":modal") &&
      modal.getAttribute("aria-modal") === "true" &&
      modal.getAttribute("aria-label") === "Draft details",
  );
  const last = content.querySelector("#inside"),
    first = modal.querySelector(".aw-contextual-dismiss");
  last.focus();
  last.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    }),
  );
  check(
    "modal Tab wraps to the first control",
    document.activeElement === first,
  );
  first.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  check(
    "modal Shift-Tab wraps back to the last control",
    document.activeElement === last,
  );
  host.close("draft");
  view = { width: 180, height: 160 };
  const narrow = host.open(request);
  host.viewportChanged();
  r = narrow.getBoundingClientRect();
  check(
    "a viewport below the minimum gets real reflow and scrolling, never a scale",
    r.left >= 8 &&
      r.right <= 172.01 &&
      r.top >= 8 &&
      r.bottom <= 152.01 &&
      !narrow.style.transform.includes("scale") &&
      input.getBoundingClientRect().right <= r.right,
  );
  host.close("draft");
  view = { width: 400, height: 300 };
  motion.reduced = false;
  const animated = host.open(request);
  for (let i = 0; i < 8; i++) {
    motion.step(1 / 60);
    host.frame((i * 1000) / 60);
  }
  const opacity = Number(animated.style.opacity);
  host.close("draft");
  const reopened = host.open(request);
  for (let i = 0; i < 180; i++) {
    motion.step(1 / 60);
    host.frame((i * 1000) / 60);
  }
  check(
    "interrupted close reverses through the same dialog and editor identity",
    opacity > 0 &&
      opacity < 1 &&
      reopened === animated &&
      reopened.contains(input) &&
      Number(reopened.style.opacity) === 1,
  );
  anchor.remove();
  host.frame(0);
  check(
    "removing the anchor releases its UI and motion body without deleting content",
    !animated.isConnected &&
      content.parentElement === source &&
      motion.bodies.size === 1,
  );
  const bodyCount = motion.bodies.size,
    layerCount = document.querySelectorAll(".aw-contextual-surface").length;
  let rejected = false;
  try {
    host.open({
      ...request,
      anchor: { x: 0, y: 0, width: 1, height: 1 },
      minSize: { width: 500, height: 100 },
      maxSize: { width: 200, height: 200 },
    });
  } catch {
    rejected = true;
  }
  check(
    "invalid size limits leave no mounted UI or leaked motion body",
    rejected &&
      motion.bodies.size === bodyCount &&
      document.querySelectorAll(".aw-contextual-surface").length === layerCount,
  );
  host.dispose();
  host.dispose();
  check(
    "disposal is idempotent and preserves the caller's existing motion body",
    !document.querySelector(".aw-contextual-layer") &&
      motion.bodies.has("existing-resource") &&
      motion.bodies.size === 1 &&
      wakes > 0,
  );
  const guardMotion = new MotionCoordinator();
  guardMotion.reduced = true;
  const guarded = createContextualSurfaces({
    motion: guardMotion,
    wake: () => {},
    viewport: () => ({ width: 400, height: 300 }),
  });
  const unhandled = [];
  const onUnhandled = (event) => {
    unhandled.push(event.reason);
    event.preventDefault();
  };
  window.addEventListener("unhandledrejection", onUnhandled);
  const settle = async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const deferred = () => {
    let resolve, reject;
    const promise = new Promise((a, b) => {
      resolve = a;
      reject = b;
    });
    return { promise, resolve, reject };
  };
  const fixture = (id, beforeClose) => {
    const trigger = document.createElement("button");
    trigger.textContent = "Open draft";
    document.body.append(trigger);
    trigger.focus();
    const content = document.createElement("div");
    content.innerHTML =
      '<label>Draft<textarea>Unsaved draft</textarea></label><p role="status"></p>';
    source.append(content);
    const input = content.querySelector("textarea"),
      closed = [];
    const request = {
      id,
      anchor: trigger,
      content,
      label: "Draft",
      beforeClose,
      onClose: (reason) => closed.push(reason),
    };
    const panel = guarded.open(request);
    input.setSelectionRange(2, 6);
    return { request, panel, input, content, trigger, closed };
  };
  let allowed = false,
    syncCalls = 0;
  const sync = fixture("sync-guard", () => {
    syncCalls++;
    return allowed;
  });
  const returned = guarded.close("sync-guard");
  check(
    "a synchronous veto preserves the same usable input, focus and caret",
    returned === undefined &&
      sync.panel.isConnected &&
      !sync.panel.inert &&
      document.activeElement === sync.input &&
      sync.input.value === "Unsaved draft" &&
      sync.input.selectionStart === 2 &&
      sync.input.selectionEnd === 6 &&
      syncCalls === 1,
  );
  allowed = true;
  guarded.close("sync-guard");
  check(
    "a synchronous allowed retry closes exactly once with the existing void API",
    !sync.panel.isConnected &&
      sync.closed.length === 1 &&
      sync.closed[0] === "programmatic" &&
      syncCalls === 2 &&
      sync.content.parentElement === source,
  );
  const success = deferred();
  let successCalls = 0;
  const good = fixture("async-success", () => {
    successCalls++;
    return success.promise;
  });
  guarded.close("async-success");
  good.input.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );
  good.panel.querySelector(".aw-contextual-dismiss").click();
  outside.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, clientX: 4, clientY: 4 }),
  );
  guarded.close("async-success");
  check(
    "pending persistence deduplicates all dismissal paths without inerting or starting the close",
    successCalls === 1 &&
      good.panel.isConnected &&
      !good.panel.inert &&
      Number(good.panel.style.opacity) === 1 &&
      document.activeElement === good.input &&
      good.closed.length === 0,
  );
  success.resolve(true);
  await settle();
  check(
    "successful asynchronous persistence closes once and restores the same content",
    !good.panel.isConnected &&
      good.closed.length === 1 &&
      good.content.parentElement === source &&
      good.input.value === "Unsaved draft",
  );
  const veto = deferred();
  const kept = fixture("async-veto", () => veto.promise);
  guarded.close("async-veto", "escape");
  kept.input.value = "Edited while saving";
  kept.input.setSelectionRange(3, 8);
  veto.resolve(false);
  await settle();
  check(
    "an asynchronous veto retains edits made while pending and the live focus/caret",
    kept.panel.isConnected &&
      !kept.panel.inert &&
      document.activeElement === kept.input &&
      kept.input.value === "Edited while saving" &&
      kept.input.selectionStart === 3 &&
      kept.input.selectionEnd === 8 &&
      kept.closed.length === 0,
  );
  guarded.close("async-veto", "disposed");
  const rejection = deferred();
  const failed = fixture("async-rejection", () => rejection.promise);
  failed.content.querySelector('[role="status"]').textContent =
    "Save failed; draft retained";
  guarded.close("async-rejection");
  rejection.reject(Error("Synthetic persistence failure"));
  await settle();
  check(
    "a rejected guard keeps the same usable DOM/focus and caller's visible save error",
    failed.panel.isConnected &&
      !failed.panel.inert &&
      document.activeElement === failed.input &&
      failed.content.textContent.includes("Save failed") &&
      failed.input.value === "Unsaved draft" &&
      failed.closed.length === 0 &&
      unhandled.length === 0,
  );
  guarded.close("async-rejection", "disposed");
  const thrown = fixture("throwing-guard", () => {
    throw Error("Synthetic synchronous save failure");
  });
  guarded.close("throwing-guard");
  check(
    "a throwing guard is contained without closing or disabling its draft",
    thrown.panel.isConnected &&
      !thrown.panel.inert &&
      document.activeElement === thrown.input &&
      thrown.closed.length === 0,
  );
  guarded.close("throwing-guard", "disposed");
  const stale = deferred(),
    fresh = deferred();
  let freshCalls = 0;
  const race = fixture("reopen-race", () => stale.promise);
  guarded.close("reopen-race");
  const same = guarded.open({
    ...race.request,
    beforeClose: () => {
      freshCalls++;
      return fresh.promise;
    },
  });
  guarded.close("reopen-race");
  stale.resolve(true);
  await settle();
  guarded.close("reopen-race");
  check(
    "reopen invalidates the old success without clearing a newer pending decision",
    same === race.panel &&
      same.isConnected &&
      !same.inert &&
      same.contains(race.input) &&
      freshCalls === 1 &&
      race.closed.length === 0,
  );
  fresh.resolve(false);
  await settle();
  guarded.close("reopen-race", "disposed");
  const old = deferred();
  const replaced = fixture("replace-race", () => old.promise);
  guarded.close("replace-race");
  const replacementContent = document.createElement("div");
  replacementContent.innerHTML = '<input value="Replacement draft">';
  source.append(replacementContent);
  const replacement = guarded.open({
    ...replaced.request,
    content: replacementContent,
    modal: true,
    beforeClose: () => false,
    onClose: () => {},
  });
  old.resolve(true);
  await settle();
  check(
    "explicit synchronous replacement ignores a stale guard and preserves replacement input",
    replacement !== replaced.panel &&
      replacement.isConnected &&
      replacement.matches(":modal") &&
      !replacement.inert &&
      replacementContent.querySelector("input").value === "Replacement draft" &&
      replaced.closed.length === 1 &&
      replaced.content.parentElement === source,
  );
  guarded.close("replace-race", "disposed");
  const nativePending = deferred();
  let nativeCalls = 0;
  const native = fixture("native-force", () => {
    nativeCalls++;
    return nativePending.promise;
  });
  guarded.close("native-force");
  native.panel.close();
  guarded.frame(0);
  await settle();
  nativePending.resolve(true);
  await settle();
  check(
    "native-close forces immediate cleanup and invalidates a pending decision",
    !native.panel.isConnected &&
      native.closed.length === 1 &&
      native.closed[0] === "native-close" &&
      nativeCalls === 1 &&
      native.content.parentElement === source,
    {
      connected: native.panel.isConnected,
      open: native.panel.open,
      closed: native.closed,
      calls: nativeCalls,
      restored: native.content.parentElement === source,
    },
  );
  const nativeStale = deferred();
  const nativeRace = fixture("native-reopen", () => nativeStale.promise);
  guarded.close("native-reopen");
  nativeRace.panel.close();
  const nativeReopened = guarded.open({
    ...nativeRace.request,
    beforeClose: () => false,
  });
  nativeStale.resolve(true);
  await settle();
  check(
    "a queued native-close event and old guard cannot dismiss the reopened dialog",
    nativeReopened !== nativeRace.panel &&
      nativeReopened.isConnected &&
      nativeReopened.open &&
      !nativeReopened.inert &&
      nativeReopened.contains(nativeRace.input) &&
      nativeRace.input.value === "Unsaved draft" &&
      nativeRace.closed.length === 1,
  );
  guarded.close("native-reopen", "disposed");
  const anchorPending = deferred();
  const anchorGone = fixture("anchor-force", () => anchorPending.promise);
  guarded.close("anchor-force");
  anchorGone.trigger.remove();
  guarded.frame(0);
  anchorPending.reject(Error("Late canceled save"));
  await settle();
  check(
    "anchor removal cannot hang on a pending guard or leak its rejection",
    !anchorGone.panel.isConnected &&
      anchorGone.closed.length === 1 &&
      anchorGone.closed[0] === "anchor-removed" &&
      unhandled.length === 0,
  );
  const disposePending = deferred();
  const disposing = fixture("dispose-force", () => disposePending.promise);
  guarded.close("dispose-force");
  guarded.dispose();
  disposePending.resolve(true);
  await settle();
  check(
    "dispose never waits for persistence and stale completion cannot revive UI",
    !disposing.panel.isConnected &&
      disposing.closed.length === 1 &&
      disposing.closed[0] === "disposed" &&
      guardMotion.bodies.size === 0 &&
      !document.querySelector(".aw-contextual-layer") &&
      unhandled.length === 0,
  );
  window.removeEventListener("unhandledrejection", onUnhandled);
  return {
    checks,
    limitations: [
      "Hidden Electron DOM/component validation with scripted DOM events; no native foreground, screenshot, shared-host integration or performance qualification claimed.",
    ],
  };
}
