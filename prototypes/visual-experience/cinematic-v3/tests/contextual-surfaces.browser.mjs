import { MotionCoordinator } from "../src/motion.ts";
import { createContextualSurfaces } from "../src/contextual-surfaces.ts";
import "../src/contextual-surfaces.css";
export async function run() {
  const checks = [];
  const check = (name, ok) => {
    checks.push({ name, passed: !!ok });
    if (!ok) throw Error(name);
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
  return {
    checks,
    limitations: [
      "Hidden Electron DOM/component validation with scripted DOM events; no native foreground, screenshot, shared-host integration or performance qualification claimed.",
    ],
  };
}
