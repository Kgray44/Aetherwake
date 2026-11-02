import test from "node:test";
import assert from "node:assert/strict";
import { MotionCoordinator } from "../src/motion.ts";
import { createVelaManifestation } from "../src/vela-manifestation.ts";
import { manifestationGeometry } from "../../../vela-core/src/manifestation-geometry.ts";

const policy = { tier: "balanced", reduced: false, quiet: false, hidden: false, graphicsAvailable: true };
const rect = (x = 400, y = 200, width = 360, height = 400) => ({ x, y, width, height });
const source = rect(130, 260, 80, 100);
const pose = { x: 0, y: 0, w: 1, h: 1, lift: 0, yaw: 0, opacity: 1 };

/** Synthetic DOM geometry only: no browser, GPU, provider, native window or model. */
function fixture() {
  let inDelivery = false, reads = 0, wakes = 0, disconnects = 0, deliveries;
  class Node {
    constructor(tag = "div", bounds = rect()) { this.tagName = tag; this.rect = bounds; this.ownerDocument = doc; this.children = []; this.parent = null; this.hidden = false; this.isConnected = true; this.attributes = new Map(); this.styles = new Map(); this.scrollHeight = bounds.height; this.dataset = {}; this.css = { display: "block" }; this.classList = { add: (...names) => this.attributes.set("class", names.join(" ")) }; this.style = { cssText: "", setProperty: (k, v) => this.styles.set(k, v) }; }
    getBoundingClientRect() { assert.equal(inDelivery, false, "observer delivery must not measure layout"); reads++; return { ...this.rect }; }
    setAttribute(k, v) { this.attributes.set(k, v); }
    getAttribute(k) { return this.attributes.get(k) ?? null; }
    removeAttribute(k) { this.attributes.delete(k); }
    append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
    closest(selector) { assert.equal(selector, "[hidden]"); return this.hidden || this.attributes.has("hidden") ? this : this.parent?.closest(selector) ?? null; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); this.isConnected = false; }
  }
  const doc = { body: null, defaultView: { innerWidth: 1200, innerHeight: 900, getComputedStyle: node => { assert.equal(inDelivery, false); return node.css; }, ResizeObserver: class { constructor(callback) { deliveries = callback; } observe() {} disconnect() { disconnects++; } }, get HTMLElement() { return Node; } }, createElementNS: (_namespace, tag) => new Node(tag) };
  doc.body = new Node("body", rect(0, 0, 1200, 900));
  const root = new Node(), shell = new Node(), reading = new Node("div", rect(400, 200, 360, 300)), manifestation = new Node("section", rect(400, 216, 360, 60)), composer = new Node("form", rect(400, 500, 360, 110)), feedback = new Node("p", rect(400, 480, 360, 20));
  reading.css = { display: "block", paddingTop: "16px", paddingBottom: "16px" }; shell.dataset.context = "none";
  reading.append(manifestation); shell.append(reading, feedback, composer); root.append(shell); doc.body.append(root);
  const motion = new MotionCoordinator(), sizes = []; motion.add("unrelated", pose);
  const options = { motion, root, wake() { wakes++; }, resize(size) { assert.equal(inDelivery, false, "observer delivery must not resize"); sizes.push(size); } };
  const helper = createVelaManifestation(options), svg = doc.body.children.find(node => node !== root);
  const observation = (extra = {}) => ({ projection: { kind: "whisper", currentRequestId: "synthetic:request", currentMessageId: "synthetic:message", currentPlanId: null, historyResource: { resourceId: "synthetic:vela", revision: 3 }, pinned: false, canDismiss: true, requiredPlanIds: [], selectionReason: "latest" }, view: "current", baseline: true, elements: { shell, reading, manifestation, composer }, ...extra });
  return { helper, motion, root, shell, reading, manifestation, composer, feedback, svg, doc, options, sizes, observation,
    notify() { inDelivery = true; try { deliveries([]); } finally { inDelivery = false; } }, get reads() { return reads; }, get wakes() { return wakes; }, get disconnects() { return disconnects; } };
}

test("actual source/host CSS geometry drives one viewport-fixed bridge outside panel clipping, never content styles", () => {
  const f = fixture(); try { for (const node of [f.composer, f.manifestation, f.reading]) for (const field of ["value", "selectionStart", "selectionEnd", "scrollTop", "textContent"]) Object.defineProperty(node, field, { get() { throw Error("Optics must not inspect content/editor/scroll state"); }, set() { throw Error("Optics must not mutate content/editor/scroll state"); } }); const value = f.observation(); f.helper.observe(value); f.helper.frame(policy); f.helper.afterRender(source);
    assert.deepEqual(f.helper.diagnostics().geometry, manifestationGeometry({ actualVelaRect: source, hostRect: f.root.rect, viewport: { width: 1200, height: 900 } }));
    assert.equal(f.svg.parent, f.doc.body); assert.equal(f.svg.getAttribute("aria-hidden"), "true"); assert.equal(f.svg.getAttribute("focusable"), "false"); assert.match(f.svg.style.cssText, /position:fixed/); assert.match(f.svg.style.cssText, /z-index:999999/); assert.match(f.svg.style.cssText, /pointer-events:none/); assert.equal(f.svg.getAttribute("hidden"), null);
    assert.equal(f.helper.diagnostics().ownedBodies, 1); assert.equal(f.motion.bodies.size, 2); assert.equal(f.helper.diagnostics().opacity, 1, "old history is a baseline, not replayed content arrival");
    assert.deepEqual([...f.shell.styles], []); assert.deepEqual([...f.composer.styles], []); assert.deepEqual([...f.manifestation.styles], []); assert.equal(value.elements.composer, f.composer);
    const previous = f.helper.diagnostics().geometry; f.root.rect.y += 50; f.helper.afterRender({ ...source, y: source.y + 50 }); assert.notDeepEqual(f.helper.diagnostics().geometry, previous); assert.equal(f.helper.diagnostics().inputs.hostRect.y, f.root.rect.y);
  } finally { f.helper.dispose(); } assert.equal(f.motion.bodies.size, 1); assert.deepEqual(f.doc.body.children, [f.root]);
});

test("short Whisper shrinks a stretched reading viewport; Action/history and contextual content remain measured and bounded", () => {
  const f = fixture(); try { f.helper.observe(f.observation()); f.helper.frame(policy); assert.deepEqual(f.helper.size(), { width: 360, height: 222 }); assert(f.helper.size().height < 420); assert.equal(f.reading.scrollHeight, 300, "the old viewport height is not mistaken for content");
    f.manifestation.rect.height = 1800; f.helper.observe(f.observation({ view: "history" })); f.helper.frame(policy); assert.deepEqual(f.helper.size(), { width: 520, height: 640 });
    f.manifestation.rect.height = 16; f.feedback.hidden = true; f.helper.observe(f.observation({ projection: { ...f.observation().projection, kind: "action" } })); f.helper.frame(policy); assert.equal(f.helper.size().width, 520); assert(f.helper.size().height < 420);
    f.shell.dataset.context = "sources"; f.helper.observe(f.observation()); f.helper.frame(policy); assert.equal(f.helper.size().width, 520);
  } finally { f.helper.dispose(); }
});

test("observer notifications coalesce into existing frames; unchanged preferred size never writes or creates a feedback loop", () => {
  const f = fixture(); try { f.helper.observe(f.observation()); f.helper.frame(policy); const reads = f.reads, wakes = f.wakes; f.notify(); f.notify(); f.notify(); assert.equal(f.reads, reads); assert.equal(f.wakes, wakes + 1); f.helper.frame(policy); assert.equal(f.sizes.length, 1);
    f.manifestation.rect.height += 40; f.notify(); f.helper.frame(policy); assert.equal(f.sizes.length, 2); assert.equal(f.sizes.at(-1).height, 262);
    // Simulate ResizeObserver reacting to its host's own resize. Reading client
    // size may change; the natural direct group did not, so there is no new write.
    f.reading.rect.height = 600; f.reading.scrollHeight = 600; f.notify(); for (let i = 0; i < 25; i++) f.helper.frame(policy); assert.equal(f.sizes.length, 2);
    const after = f.reads; for (let i = 0; i < 25; i++) f.helper.frame(policy); assert.equal(f.reads, after, "idle frames perform no content measurement");
  } finally { f.helper.dispose(); }
});

test("bridge opacity retargets continuously in one MC body; null drops references and only retained geometry closes", () => {
  const f = fixture(); try { f.helper.observe(f.observation({ baseline: false })); f.helper.frame(policy); f.helper.afterRender(source); assert.equal(f.helper.diagnostics().opacity, 0); assert.equal(f.svg.getAttribute("hidden"), ""); f.motion.step(1 / 60); f.helper.afterRender(source); const opacity = f.helper.diagnostics().opacity; assert(opacity > 0 && opacity < 1);
    f.helper.observe(f.observation({ baseline: false })); assert.equal(f.helper.diagnostics().opacity, opacity); assert.equal(f.helper.diagnostics().ownedBodies, 1); const geometry = f.helper.diagnostics().geometry;
    f.helper.observe(null); assert.equal(f.helper.diagnostics().active, false); assert.equal(f.helper.diagnostics().closing, true); const reads = f.reads; f.root.getBoundingClientRect = () => { throw Error("closed references must not be measured"); }; f.helper.afterRender(rect(800, 100, 100, 100)); assert.equal(f.reads, reads); assert.deepEqual(f.helper.diagnostics().geometry, geometry);
    for (let i = 0; i < 180; i++) { f.motion.step(1 / 60); f.helper.frame(policy); } assert.equal(f.helper.diagnostics().ownedBodies, 0); assert.equal(f.helper.diagnostics().geometry, null); assert.equal(f.svg.getAttribute("hidden"), ""); assert.equal(f.motion.bodies.size, 1);
  } finally { f.helper.dispose(); }
});

test("reduced/quiet close immediately; hidden or graphics loss retire only optics, preserving useful content and sizing", () => {
  for (const flag of ["reduced", "quiet", "hidden", "graphicsAvailable"]) { const f = fixture(); try { f.helper.observe(f.observation({ baseline: false })); f.helper.frame(policy); f.helper.afterRender(source); const value = { ...policy, [flag]: flag !== "graphicsAvailable" }; f.manifestation.rect.height += 30; f.notify(); f.helper.frame(value);
    if (flag === "hidden" || flag === "graphicsAvailable") { assert.equal(f.helper.diagnostics().ownedBodies, 0); assert.equal(f.svg.getAttribute("hidden"), ""); if (flag === "graphicsAvailable") assert.equal(f.helper.size().height, 252, "CPU content sizing is independent of graphics availability"); }
    else { f.helper.afterRender(source); assert.equal(f.helper.diagnostics().opacity, 1); }
    f.helper.observe(null); assert.equal(f.helper.diagnostics().ownedBodies, 0); assert.deepEqual([...f.composer.styles], []); assert.equal(f.composer.hidden, false);
  } finally { f.helper.dispose(); } }
});

test("invalid, overlapping, invisible or detached geometry hides rather than inventing an attachment", () => {
  const f = fixture(); try { f.helper.observe(f.observation()); f.helper.frame(policy);
    for (const value of [null, rect(NaN, 20, 80, 100), rect(-500, 100, 80, 100), rect(420, 230, 80, 100)]) { f.helper.afterRender(source); assert.equal(f.svg.getAttribute("hidden"), null); f.helper.afterRender(value); assert.equal(f.svg.getAttribute("hidden"), ""); assert.equal(f.helper.diagnostics().geometry, null); assert.equal(f.helper.diagnostics().ownedBodies, 0); }
    f.root.isConnected = false; f.helper.afterRender(source); assert.equal(f.helper.diagnostics().geometry, null); assert.equal(f.helper.diagnostics().rejectedGeometry, 5);
  } finally { f.helper.dispose(); }
});

test("resize failures cannot gate or mutate ready nodes; disposing disconnects and ignores future observations", () => {
  const f = fixture(); f.options.resize = () => { throw Error("Synthetic host resize failure"); }; f.helper.observe(f.observation()); f.helper.frame(policy); assert.equal(f.helper.diagnostics().resizeFailures, 1); assert.equal(f.helper.diagnostics().active, true); f.helper.afterRender(source); assert.equal(f.svg.getAttribute("hidden"), null);
  const count = f.disconnects; f.helper.dispose(); assert(f.disconnects > count); assert.equal(f.helper.diagnostics().ownedBodies, 0); f.helper.observe(f.observation()); f.helper.frame(policy); f.helper.afterRender(source); assert.equal(f.helper.diagnostics().active, false); assert.equal(f.doc.body.children.length, 1); assert.deepEqual([...f.composer.styles], []);
});
