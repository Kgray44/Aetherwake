import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blockDocument } from "../../../block-library/tests/component-dom.mts";
import { MotionCoordinator } from "../src/motion.ts";
import { createControlMotion } from "../src/control-motion.ts";

/** CPU DOM/event lifecycle boundary; no Chromium layout, GPU or native input. */
function setup() {
  const dom = blockDocument(),
    original = dom.doc.createElement,
    observers = [];
  dom.doc.createElement = (tag) => {
    const node = original(tag),
      matches = node.matches.bind(node),
      values = node.style,
      priorities = new Map();
    node.nodeType = 1;
    node.matches = (selector) =>
      selector === ":disabled"
        ? node.disabled
        : selector === ":hover"
          ? false
          : matches(selector);
    values.setProperty = (name, value, priority = "") => {
      values[name] = value;
      priorities.set(name, priority);
    };
    values.getPropertyValue = (name) => values[name] ?? "";
    values.getPropertyPriority = (name) => priorities.get(name) ?? "";
    values.removeProperty = (name) => {
      const before = values[name] ?? "";
      delete values[name];
      priorities.delete(name);
      return before;
    };
    return node;
  };
  class Observer {
    constructor(callback) {
      this.callback = callback;
      this.connected = false;
      observers.push(this);
    }
    observe(root, options) {
      this.root = root;
      this.options = options;
      this.connected = true;
    }
    disconnect() {
      this.connected = false;
    }
    deliver(records) {
      if (this.connected) this.callback(records);
    }
  }
  const restoreDOM = dom.install(),
    beforeObserver = globalThis.MutationObserver;
  globalThis.MutationObserver = Observer;
  const motion = new MotionCoordinator(),
    views = [];
  let wakes = 0;
  motion.add("synthetic:external", {
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    lift: 0,
    yaw: 0,
    opacity: 1,
  });
  const copy = (parent = dom.root) => {
    const node = dom.doc.createElement("button");
    node.textContent = "Copy synthetic text";
    node.setAttribute("data-native-copy-control", "");
    node.dataset.nativeCopyControl = "";
    parent.append(node);
    return node;
  };
  const mount = (selector) => {
    const view = createControlMotion({
      root: dom.root,
      motion,
      wake: () => {
        wakes++;
      },
      ...(selector ? { selector } : {}),
    });
    views.push(view);
    return view;
  };
  const tick = (view, frames = 180) => {
    for (let i = 0; i < frames; i++) {
      motion.step(1 / 60);
      view.frame();
    }
  };
  return {
    dom,
    motion,
    copy,
    mount,
    tick,
    observers,
    wakes: () => wakes,
    cleanup() {
      for (const view of views) view.dispose();
      restoreDOM();
      if (beforeObserver === undefined) delete globalThis.MutationObserver;
      else globalThis.MutationObserver = beforeObserver;
    },
  };
}
const key = (f) =>
  [...f.motion.bodies.keys()].find((value) =>
    value.startsWith("control-motion:"),
  );
const childList = (addedNodes = [], removedNodes = []) => [
  { type: "childList", addedNodes, removedNodes },
];

test("only explicitly tagged controls are bound, without changing semantics or existing callbacks", () => {
  const f = setup();
  try {
    const copy = f.copy(),
      unrelated = f.dom.doc.createElement("button");
    unrelated.textContent = "Workspace actions";
    f.dom.root.append(unrelated);
    copy.id = "synthetic:existing-id";
    copy.setAttribute("aria-label", "Copy exact text");
    copy.setAttribute("aria-pressed", "false");
    let clicked = 0,
      down = 0;
    copy.addEventListener("click", () => {
      clicked++;
    });
    copy.addEventListener("pointerdown", () => {
      down++;
    });
    const attrs = [...copy.attrs].filter(
        ([name]) => !["class", "style"].includes(name),
      ),
      view = f.mount("button");
    assert.equal(
      f.motion.bodies.size,
      2,
      "even a caller's broad selector cannot claim untagged navigation controls",
    );
    assert(copy.classList.contains("aw-control-motion"));
    assert(!unrelated.classList.contains("aw-control-motion"));
    assert.equal(copy.id, "synthetic:existing-id");
    assert.deepEqual(
      [...copy.attrs].filter(([name]) => !["class", "style"].includes(name)),
      attrs,
    );
    assert.equal(f.dom.doc.activeElement, null);
    const press = copy.fire("pointerdown", { button: 0 }),
      click = copy.fire("click");
    assert.equal(press.defaultPrevented, false);
    assert.equal(press.stopped, false);
    assert.equal(click.defaultPrevented, false);
    assert.equal(clicked, 1);
    assert.equal(down, 1);
    view.dispose();
    copy.fire("click");
    assert.equal(clicked, 2, "semantic handler survives adapter teardown");
  } finally {
    f.cleanup();
  }
});

test("a generic experience control borrows the same shared feedback without claiming clipboard authority", () => {
  const f = setup();
  try {
    const control = f.dom.doc.createElement("button");
    control.setAttribute("data-aerynth-motion-control", "true");
    control.dataset.aerynthMotionControl = "true";
    control.textContent = "Add checklist item";
    f.dom.root.append(control);
    const view = f.mount();
    assert.equal(f.motion.bodies.size, 2);
    control.fire("pointerenter");
    f.tick(view, 2);
    const energy = Number(control.style.getPropertyValue("--control-hover"));
    assert(energy > 0 && energy < 1);
    assert.equal(control.dataset.nativeCopyControl, undefined);
  } finally {
    f.cleanup();
  }
});

test("actual event retargets preserve shared-MC position/velocity, and only Root frame paints the glide", () => {
  const f = setup();
  try {
    const copy = f.copy(),
      view = f.mount(),
      id = key(f);
    copy.fire("pointerenter");
    assert.equal(copy.style["--control-hover"], "0");
    f.tick(view, 7);
    const value = f.motion.pose(id).x,
      velocity = f.motion.bodies.get(id).channels.x.velocity;
    assert(value > 0 && value < 1);
    copy.fire("pointerleave");
    assert.equal(f.motion.pose(id).x, value);
    assert.equal(f.motion.bodies.get(id).channels.x.velocity, velocity);
    copy.focus();
    copy.fire("focusin");
    copy.fire("keydown", { key: "Enter" });
    f.tick(view, 1);
    assert(Number(copy.style["--control-focus"]) > 0);
    assert(Number(copy.style["--control-press"]) > 0);
    copy.fire("keyup", { key: "Enter" });
    copy.fire("focusout", { relatedTarget: null });
    f.tick(view);
    assert.equal(copy.style["--control-hover"], "0");
    assert.equal(copy.style["--control-focus"], "0");
    assert.equal(copy.style["--control-press"], "0");
    assert.deepEqual(f.motion.pose("synthetic:external"), {
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      lift: 0,
      yaw: 0,
      opacity: 1,
    });
  } finally {
    f.cleanup();
  }
});

test("disabled mutation has immediate native semantics and a shared-MC fade; reduced motion reconciles without a scheduler", () => {
  const f = setup();
  try {
    const copy = f.copy(),
      view = f.mount(),
      observer = f.observers[0];
    assert.deepEqual(observer.options, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled"],
    });
    copy.fire("pointerdown", { button: 0 });
    f.tick(view, 3);
    copy.disabled = true;
    observer.deliver([
      { type: "attributes", attributeName: "disabled", target: copy },
    ]);
    assert.equal(copy.disabled, true);
    assert.equal(copy.style["--control-disabled"], "0");
    f.tick(view, 1);
    assert(Number(copy.style["--control-disabled"]) > 0);
    copy.fire("pointerdown", { button: 0 });
    f.tick(view);
    assert.equal(copy.style["--control-press"], "0");
    assert.equal(copy.style["--control-disabled"], "1");
    f.motion.reduced = true;
    copy.disabled = false;
    observer.deliver([
      { type: "attributes", attributeName: "disabled", target: copy },
    ]);
    view.frame();
    assert.equal(copy.style["--control-disabled"], "0");
    copy.fire("pointerenter");
    view.frame();
    assert.equal(copy.style["--control-hover"], "1");
  } finally {
    f.cleanup();
  }
});

test("insertion binds once, same-root reparenting retains identity/velocity, and detached cleanup preserves original style", () => {
  const f = setup();
  try {
    const left = f.dom.doc.createElement("section"),
      right = f.dom.doc.createElement("section");
    f.dom.root.append(left, right);
    const view = f.mount(),
      observer = f.observers[0],
      copy = f.copy(left);
    copy.style.setProperty("--control-hover", ".25", "important");
    observer.deliver(childList([copy]));
    const id = key(f),
      body = f.motion.bodies.get(id);
    copy.fire("pointerenter");
    f.tick(view, 3);
    const velocity = body.channels.x.velocity;
    right.append(copy);
    observer.deliver(childList([copy], [copy]));
    assert.equal(key(f), id);
    assert.equal(f.motion.bodies.get(id), body);
    assert.equal(body.channels.x.velocity, velocity);
    assert.equal(f.motion.bodies.size, 2);
    copy.remove();
    observer.deliver(childList([], [copy]));
    assert.equal(f.motion.bodies.size, 1);
    assert.equal(copy.style.getPropertyValue("--control-hover"), ".25");
    assert.equal(
      copy.style.getPropertyPriority("--control-hover"),
      "important",
    );
    assert(!copy.classList.contains("aw-control-motion"));
    for (const name of ["pointerenter", "pointerleave", "keydown", "focusin"])
      assert.equal(copy.listeners.get(name)?.length ?? 0, 0);
    right.append(copy);
    observer.deliver(childList([copy]));
    assert.equal(
      key(f),
      id,
      "the same surviving node keeps its private visual ID after reattachment",
    );
  } finally {
    f.cleanup();
  }
});

test("style/class writes cannot produce an observer feedback loop; frames do not rescan the document", () => {
  const f = setup();
  try {
    const copy = f.copy(),
      view = f.mount(),
      observer = f.observers[0],
      receipts = f.motion.receipts.length,
      bodies = f.motion.bodies.size,
      wakes = f.wakes();
    const original = f.dom.root.querySelectorAll.bind(f.dom.root);
    let scans = 0;
    f.dom.root.querySelectorAll = (selector) => {
      scans++;
      return original(selector);
    };
    observer.deliver([
      { type: "attributes", attributeName: "style", target: copy },
      { type: "attributes", attributeName: "class", target: copy },
    ]);
    observer.deliver(childList([{ nodeType: 3 }], [{ nodeType: 3 }]));
    const unrelated = f.dom.doc.createElement("p");
    f.dom.root.append(unrelated);
    observer.deliver(childList([unrelated]));
    for (let i = 0; i < 10; i++) view.frame();
    assert.equal(scans, 0);
    assert.equal(f.wakes(), wakes);
    assert.equal(f.motion.receipts.length, receipts);
    assert.equal(f.motion.bodies.size, bodies);
  } finally {
    f.cleanup();
  }
});

test("overlapping adapters cannot fight over a node and disposal restores only owned material", () => {
  const f = setup();
  try {
    const copy = f.copy();
    copy.classList.add("aw-control-motion");
    const first = f.mount(),
      second = f.mount();
    assert.equal(f.motion.bodies.size, 2);
    second.dispose();
    assert.equal(f.motion.bodies.size, 2);
    assert(copy.classList.contains("aw-control-motion"));
    first.dispose();
    first.dispose();
    assert.equal(f.motion.bodies.size, 1);
    assert(
      copy.classList.contains("aw-control-motion"),
      "a pre-existing presentation class is retained",
    );
    assert(f.observers.every((observer) => !observer.connected));
    const wakes = f.wakes();
    copy.fire("pointerenter");
    first.frame();
    f.observers[0].callback(childList([copy]));
    assert.equal(f.wakes(), wakes);
    assert.equal(f.motion.bodies.size, 1);
  } finally {
    f.cleanup();
  }
});

test("invalid selector fails before attaching any material body or changing the control", () => {
  const f = setup();
  try {
    const copy = f.copy(),
      before = copy.className;
    f.dom.root.querySelectorAll = () => {
      throw Error("Synthetic invalid selector");
    };
    assert.throws(() => f.mount("["), /invalid selector/);
    assert.equal(f.motion.bodies.size, 1);
    assert.equal(copy.className, before);
    assert(f.observers.every((observer) => !observer.connected));
  } finally {
    f.cleanup();
  }
});

test("feedback styles have no layout/hit-target change, CSS animation, forced-colors delay or independent scheduler", () => {
  const source = readFileSync(
      new URL("../src/control-motion.ts", import.meta.url),
      "utf8",
    ),
    css = readFileSync(
      new URL("../src/control-motion.css", import.meta.url),
      "utf8",
    );
  assert(
    !/requestAnimationFrame\s*\(|setTimeout\s*\(|setInterval\s*\(|\.step\s*\(/.test(
      source,
    ),
  );
  assert(
    !/\b(?:transition|animation|transform|padding|margin|width|height|pointer-events)\s*:|@keyframes/.test(
      css,
    ),
  );
  assert(
    !/preventDefault|stopPropagation|\.focus\s*\(|clipboard/i.test(
      source.replace(/\/\*[^]*?\*\//g, ""),
    ),
  );
  assert(
    css.includes("forced-colors: active") &&
      css.includes("outline: 2px solid Highlight !important"),
  );
});
