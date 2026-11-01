import './style.css';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { blocks, createEvents, createMessages, FIXTURE_COUNTS, FIXTURE_SEED, type ResourceBlock } from './fixtures';
import { motion, type Quality, type VelaState } from './motion';
import { BenchmarkLedger, atOffset } from './benchmark-control';

const app = document.querySelector<HTMLDivElement>('#app')!;
const messages = createMessages();
const events = createEvents();
let selectedMessageId: string | null = null;
let selectedEventId: string | null = null;
const params = new URLSearchParams(location.search);
const surface = params.get('surface');
const detachedId = params.get('block');
const ledger = new BenchmarkLedger(surface ?? 'main');
let lastFrameCapture: ReturnType<typeof motion.endFrameCapture> | null = null;
const byId = new Map(blocks.map(block => [block.id, block]));
const STORAGE = 'aerynth-visual-lab-v1';
type LayoutState = { order: string[]; wide: string[]; collapsed: string[]; quality: Quality; reduced: boolean; selected: string | null; detached: string[] };
const defaults: LayoutState = { order: blocks.map(b => b.id), wide: [], collapsed: [], quality: 'cinematic', reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, selected: null, detached: [] };
function load(): LayoutState {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE) || '{}') as Partial<LayoutState>;
    const order = [...new Set([...(raw.order || []), ...defaults.order])].filter(id => byId.has(id));
    return { ...defaults, ...raw, order, wide: (raw.wide || []).filter(id => byId.has(id)), collapsed: (raw.collapsed || []).filter(id => byId.has(id)), detached: (raw.detached || []).filter(id => byId.has(id)) };
  } catch { return structuredClone(defaults); }
}
let layout = load();
function save() { localStorage.setItem(STORAGE, JSON.stringify(layout)); }
const glyph: Record<string, string> = { conversation: '◌', note: '✦', timeline: '⌁', files: '▥', signal: '✧', chart: '▤', plan: '◇', people: '⁂', reference: '▧', map: '⌘', terminal: '›_', review: '◎' };
function esc(value: string) { return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)); }
function $<T extends Element = Element>(selector: string, root: ParentNode = document) { return root.querySelector<T>(selector); }
function $$<T extends Element = Element>(selector: string, root: ParentNode = document) { return [...root.querySelectorAll<T>(selector)]; }
function blockVisual(block: ResourceBlock) {
  switch (block.kind) {
    case 'conversation': return '<span class="quote-strokes"><i></i><i></i><i></i></span>';
    case 'timeline': return '<span class="mini-timeline"><i></i><i></i><i></i><i></i></span>';
    case 'chart': return '<span class="mini-bars"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>';
    case 'people': return '<span class="mini-constellation"><i></i><i></i><i></i><i></i></span>';
    case 'terminal': return '<span class="mini-terminal">&gt; scene.ready<br><em>&gt; awaiting intent_</em></span>';
    case 'files': return '<span class="mini-files"><i></i><i></i><i></i></span>';
    default: return `<span class="mini-symbol">${glyph[block.kind]}</span>`;
  }
}
function card(block: ResourceBlock) {
  const wide = layout.wide.includes(block.id), collapsed = layout.collapsed.includes(block.id);
  return `<article class="resource-card accent-${block.accent} ${wide ? 'wide' : ''} ${collapsed ? 'collapsed' : ''}" data-id="${block.id}" tabindex="0" draggable="true" aria-label="${esc(block.eyebrow)}: ${esc(block.title)}" aria-selected="${layout.selected === block.id}">
    <div class="card-head"><span class="card-glyph" aria-hidden="true">${glyph[block.kind]}</span><span class="card-eyebrow">${esc(block.eyebrow)}</span><span class="card-index">${String(blocks.indexOf(block) + 1).padStart(2, '0')}</span></div>
    <div class="card-visual" aria-hidden="true">${blockVisual(block)}</div>
    <div class="card-copy"><h3>${esc(block.title)}</h3><p>${esc(block.summary)}</p><small>${esc(block.detail)}</small></div>
    <div class="card-actions"><button type="button" data-action="focus" aria-label="Focus ${esc(block.title)}">Focus <span aria-hidden="true">↗</span></button><button type="button" data-action="resize" aria-label="${wide ? 'Compact' : 'Widen'} ${esc(block.title)}">${wide ? 'Compact' : 'Widen'}</button><button type="button" data-action="collapse" aria-label="${collapsed ? 'Expand' : 'Collapse'} ${esc(block.title)}">${collapsed ? 'Expand' : 'Collapse'}</button><button type="button" data-action="detach" aria-label="Detach ${esc(block.title)}">Detach</button></div>
  </article>`;
}

function renderMain() {
  app.innerHTML = `<div class="shell">
    <canvas class="atmosphere" id="atmosphere" aria-hidden="true"></canvas>
    <header class="topbar"><div class="brand-word"><span class="brand-diamond">✧</span><strong>AERYNTH</strong><span class="brand-divider"></span><span>VISUAL LAB / 02</span></div><span class="topbar-center">AN ENVIRONMENT FOR INTELLIGENT WORK</span><div class="topbar-right"><span class="connection-dot"></span><span>LOCAL PROTOTYPE</span><button id="about-button" class="top-icon" aria-label="Prototype information">ⓘ</button></div></header>
    <nav class="rail" aria-label="Primary"><button class="rail-button active" data-nav="home" aria-label="Home">✧<small>HOME</small></button><button class="rail-button" data-nav="workspace" aria-label="Workspace">▦<small>SPACE</small></button><button class="rail-button" data-nav="conversation" aria-label="Conversations">◌<small>CHAT</small></button><button class="rail-button" data-nav="stream" aria-label="Intelligence stream">≋<small>STREAM</small></button><div class="rail-spacer"></div><button class="rail-button" id="rail-settings" aria-label="Motion settings">⚙<small>MODE</small></button></nav>
    <main class="page-scroll" id="page-scroll"><div class="page-inner">
      <section class="hero" id="home" aria-label="Aerynth home scene"><div class="hero-glow"></div><div class="hero-copy"><div class="overline"><span class="overline-line"></span> THE LIVING WORKSPACE <span class="overline-number">01 / ENVIRONMENT</span></div><h1>Intelligence,<br><em>in its element.</em></h1><p>A space that responds to thought. Resources move with purpose; light follows attention. This is a local, synthetic visual study.</p><div class="hero-actions"><button class="button-primary" data-nav="workspace">Enter workspace <span>↗</span></button><button class="button-text" data-nav="conversation">Explore conversation <span>→</span></button></div><div class="hero-rule"></div><div class="hero-foot"><span>PROJECT AETHERWAKE</span><span>TAURI 2 CANDIDATE</span><span>SEED ${FIXTURE_SEED}</span></div></div><div class="hero-art"><div class="mark-halo"></div><img class="aerynth-mark" src="/aerynth-mark-master.png" alt="Official Aerynth ribbon A mark" /><span class="mark-caption">AERYNTH / FORM 001</span></div><div class="hero-aside"><span class="vertical-label">DIMENSIONAL INTERFACE STUDY</span><span class="hero-index">02<span>/ 06</span></span></div></section>
      <section class="section vela-section" aria-label="Vela presence"><div class="section-heading"><div><span class="section-kicker">PRESENCE / 01</span><h2>Vela, within reach.</h2></div><p>State is explicit. Motion follows state. Every activity here is a labeled simulation.</p></div><div class="vela-panel"><div class="vela-visual"><div class="vela-orbit orbit-one"></div><div class="vela-orbit orbit-two"></div><div class="vela-core"><div class="vela-core-inner"></div></div><span class="vela-spark spark-one"></span><span class="vela-spark spark-two"></span></div><div class="vela-copy"><span class="live-label"><i></i> SIMULATED PRESENCE</span><h3 id="vela-title">Listening to the quiet</h3><p id="vela-description">Vela is idle. The environment remains calm and available.</p><div class="state-switcher" role="group" aria-label="Simulated Vela state"><button data-vela="idle" class="active">Idle</button><button data-vela="working">Working</button><button data-vela="attention">Attention required</button><button data-vela="unavailable">Unavailable</button></div><small>Developer control · no model or agent connection</small></div><div class="vela-status"><span>STATE SIGNAL</span><strong id="vela-state-label">IDLE</strong><span>SIMULATION</span></div></div></section>
      <section class="section workspace-section" id="workspace"><div class="section-heading"><div><span class="section-kicker">SPATIAL SYSTEM / 02</span><h2>A workspace that moves with you.</h2></div><p>Twelve distinct resources. Select, rearrange, resize, collapse, focus, or detach a block. Identities remain stable.</p></div><div class="workspace-toolbar"><div class="toolbar-left"><span class="toolbar-dot"></span><strong>HORIZON / OVERVIEW</strong><span class="toolbar-count">12 RESOURCES · SYNTHETIC</span></div><div class="toolbar-right"><span id="selection-label">No selection</span><button id="reset-layout">Reset layout</button></div></div><div class="workspace-grid" id="workspace-grid">${layout.order.map(id => card(byId.get(id)!)).join('')}</div><p class="workspace-hint">Drag cards to rearrange · Alt + arrow keys move the selected card · Enter focuses · Escape returns</p></section>
      <section class="section lower-section" id="conversation"><div class="section-heading"><div><span class="section-kicker">CONVERSATION / 03</span><h2>Continuity, at length.</h2></div><p>2,000 deterministic messages rendered by viewport. Select a message without losing your place.</p></div><div class="data-layout"><div class="data-panel"><div class="data-panel-head"><div><span>ORION / CONVERSATION</span><strong>Long-form dialogue</strong></div><span class="fixture-pill">SYNTHETIC FIXTURE</span></div><div class="virtual-list" id="message-list" tabindex="0" aria-label="Synthetic conversation messages"><div class="virtual-spacer"></div><div class="virtual-items"></div></div><div class="data-panel-foot"><span id="message-status">2,000 messages</span><button id="jump-message">Jump to latest ↓</button></div></div><div class="side-column"><div class="stream-preview"><div class="side-heading"><span>INTELLIGENCE STREAM / 04</span><span>↗</span></div><h3>Activity, with provenance.</h3><p>A secondary native window shows 1,000 synthetic events. Burst playback changes presentation, not source history.</p><div class="stream-lines"><i></i><i></i><i></i></div><button id="open-stream">Open activity window →</button></div><div class="instrument-card"><span>FRAME INSTRUMENT</span><strong id="inline-frame-stats">Collecting intervals…</strong><p>Measured in this renderer. View the lab controls for p95, p99, and missed frames.</p></div></div></div></section>
      <section class="section lab-section" id="lab"><div class="section-heading"><div><span class="section-kicker">PERFORMANCE / 05</span><h2>Material, with a budget.</h2></div><p>Quality changes atmosphere density and frame pacing. Reduced motion preserves readable state and controls.</p></div><div class="lab-controls"><div><label for="quality-select">VISUAL QUALITY</label><select id="quality-select"><option value="cinematic">Cinematic · 200 particles</option><option value="balanced">Balanced · 100 particles</option><option value="efficient">Efficient · 36 particles</option></select></div><label class="check-label"><input type="checkbox" id="reduced-toggle" /> Reduced motion</label><button id="benchmark-button" class="button-primary">Run bounded benchmark ↗</button><button id="export-button" class="button-text">Export measurements ↓</button></div><pre class="benchmark-output" id="benchmark-output">Waiting for local frame samples. No process or GPU data is inferred from browser timings.</pre></section>
      <footer class="footer"><span>AERYNTH / PROJECT AETHERWAKE</span><span>LOCAL VISUAL CANDIDATE · NO LIVE CODEX CONNECTION</span><span>© LAB 02</span></footer>
    </div></main><div id="focus-layer" class="focus-layer" hidden></div><div id="toast" class="toast" role="status" aria-live="polite"></div></div>`;
  $('#lab')!.insertAdjacentHTML('beforeend', `<details class="bench-control"><summary>COMPARISON CONTROL / LOCAL SCRIPT</summary><p>Scripted renderer actions provide software timing proxies. They are not physical input or display-present measurements.</p><div class="bench-buttons"><button data-bench="prepare">Prepare fixed cinematic</button><button data-bench="S2">S2 idle</button><button data-bench="S3">S3 working</button><button data-bench="S4">S4 scroll</button><button data-bench="S6">S6 workspace</button><button data-bench="S7">S7 Vela</button><button data-bench="S8">S8 windows</button><button data-bench="S10-efficient">S10 efficient</button><button data-bench="S10-reduced">S10 reduced</button><button data-bench="capture-start">Start frame capture</button><button data-bench="capture-stop">Stop frame capture</button><button data-bench="export">Export local trace</button></div><output id="bench-status" role="status">Ready · seed ${FIXTURE_SEED}</output></details>`);
  motion.attach($('#atmosphere') as HTMLCanvasElement);
  motion.setQuality(layout.quality); motion.setReduced(layout.reduced);
  ($('#quality-select') as HTMLSelectElement).value = layout.quality;
  ($('#reduced-toggle') as HTMLInputElement).checked = layout.reduced;
  bindMain(); mountVirtualList('#message-list', messages, 84, messageRow);
  updateSelection(); updateVela('idle');
  setInterval(() => { const s = motion.stats(); const el = $('#inline-frame-stats'); if (el) el.textContent = s.medianMs === null ? 'No animated samples' : `${s.medianMs} ms median / ${s.p95Ms} ms p95`; }, 2500);
}

function messageRow(message: typeof messages[number]) {
  return `<button class="message-row ${selectedMessageId === message.id ? 'selected' : ''}" data-message="${message.id}" aria-pressed="${selectedMessageId === message.id}" aria-label="Message ${message.index + 1}, ${esc(message.author)}"><span class="message-index">${String(message.index + 1).padStart(4, '0')}</span><span class="message-avatar">${message.author === 'You' ? 'Y' : 'V'}</span><span class="message-body"><strong>${esc(message.author)} <em>${esc(message.subject)}</em></strong><span>${esc(message.text)}</span></span><span class="message-time">${message.time}</span></button>`;
}
function eventRow(event: typeof events[number]) {
  return `<button class="event-row ${selectedEventId === event.id ? 'selected' : ''}" data-event="${event.id}" aria-pressed="${selectedEventId === event.id}" aria-label="Synthetic event ${event.index + 1}"><span class="event-seq">${String(event.index + 1).padStart(4, '0')}</span><span class="event-mark"></span><span class="event-body"><small>${event.kind.toUpperCase()} · SIMULATED</small><strong>${esc(event.title)}</strong><em>${esc(event.detail)}</em></span><span class="event-time">${event.time}</span></button>`;
}
function mountVirtualList<T>(selector: string, items: T[], rowHeight: number, row: (item: T) => string) {
  const list = $<HTMLElement>(selector)!;
  const spacer = $<HTMLElement>('.virtual-spacer', list)!;
  const contents = $<HTMLElement>('.virtual-items', list)!;
  spacer.style.height = `${items.length * rowHeight}px`;
  let previous = -1;
  const update = () => {
    const start = Math.max(0, Math.floor(list.scrollTop / rowHeight) - 5);
    const end = Math.min(items.length, start + Math.ceil(list.clientHeight / rowHeight) + 11);
    if (start === previous) return;
    previous = start;
    contents.style.transform = `translateY(${start * rowHeight}px)`;
    contents.innerHTML = items.slice(start, end).map(row).join('');
  };
  list.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
  return { update, jumpTo: (index: number) => { list.scrollTop = index * rowHeight; previous = -1; update(); } };
}

let focusId: string | null = null;
let focusPlaceholder: HTMLElement | null = null;
let currentAnimation: Animation | null = null;
function animateReposition(node: HTMLElement, from: DOMRect, to: DOMRect, duration = 520) {
  currentAnimation?.cancel();
  if (layout.reduced) return;
  const dx = from.left - to.left, dy = from.top - to.top;
  const sx = from.width / Math.max(1, to.width), sy = from.height / Math.max(1, to.height);
  currentAnimation = node.animate([
    { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: .88 },
    { transform: 'translate(0, 0) scale(1, 1)', opacity: 1 },
  ], { duration, easing: 'cubic-bezier(.18,.74,.2,1)', fill: 'both' });
  currentAnimation.onfinish = () => { currentAnimation?.cancel(); currentAnimation = null; };
  motion.record('spatial', 'resource-transition', node.dataset.id);
}
function focusBlock(id: string) {
  if (focusId && focusId !== id) closeFocus();
  if (focusId === id) return;
  const node = $<HTMLElement>(`.resource-card[data-id="${id}"]`);
  if (!node) return;
  const from = node.getBoundingClientRect();
  focusPlaceholder = document.createElement('div');
  focusPlaceholder.className = `card-placeholder ${node.classList.contains('wide') ? 'wide' : ''}`;
  node.replaceWith(focusPlaceholder);
  const layer = $<HTMLElement>('#focus-layer')!;
  layer.hidden = false;
  layer.innerHTML = '<div class="focus-backdrop"></div><div class="focus-shell"><div class="focus-toolbar"><span>RESOURCE FOCUS · SAME IDENTITY</span><button id="close-focus">Return to workspace ×</button></div><div class="focus-content"></div></div>';
  $<HTMLElement>('.focus-content', layer)!.append(node);
  node.classList.add('focused');
  focusId = id;
  animateReposition(node, from, node.getBoundingClientRect());
  $('#close-focus')?.addEventListener('click', closeFocus);
  $('.focus-backdrop')?.addEventListener('click', closeFocus);
  node.focus({ preventScroll: true });
}
function closeFocus() {
  if (!focusId || !focusPlaceholder) return;
  const layer = $<HTMLElement>('#focus-layer')!;
  const node = $<HTMLElement>('.resource-card', layer)!;
  const from = node.getBoundingClientRect();
  currentAnimation?.cancel(); currentAnimation = null;
  node.classList.remove('focused');
  focusPlaceholder.replaceWith(node);
  focusPlaceholder = null;
  layer.hidden = true; layer.innerHTML = '';
  focusId = null;
  animateReposition(node, from, node.getBoundingClientRect(), 420);
  node.focus({ preventScroll: true });
}
function updateSelection() {
  $$('.resource-card').forEach(node => node.setAttribute('aria-selected', String(node.getAttribute('data-id') === layout.selected)));
  const label = $('#selection-label');
  if (label) label.textContent = layout.selected ? `Selected · ${byId.get(layout.selected)?.title || ''}` : 'No selection';
}
function selectBlock(id: string) { layout.selected = id; save(); updateSelection(); motion.record('interaction', 'select', id); }
function updateVela(state: VelaState) {
  motion.setVela(state);
  const copy = {
    idle: ['Listening to the quiet', 'Vela is idle. The environment remains calm and available.'],
    working: ['In motion, with purpose', 'Simulated working state. No model reasoning or agent execution is occurring.'],
    attention: ['A moment needs you', 'Simulated attention request. No actual approval or pending action exists.'],
    unavailable: ['Present, but offline', 'Simulated unavailable state. No backend connection is configured.'],
  }[state];
  $('#vela-title')!.textContent = copy[0]; $('#vela-description')!.textContent = copy[1];
  $('#vela-state-label')!.textContent = state.toUpperCase().replace('ATTENTION', 'ATTENTION REQUIRED');
  $$('[data-vela]').forEach(button => button.classList.toggle('active', button.getAttribute('data-vela') === state));
}
function toast(message: string) { const el = $<HTMLElement>('#toast'); if (!el) return; el.textContent = message; el.classList.add('shown'); setTimeout(() => el.classList.remove('shown'), 3400); }
function moveCard(id: string, direction: number) {
  const old = layout.order.indexOf(id), next = Math.max(0, Math.min(layout.order.length - 1, old + direction));
  if (old === next) return;
  layout.order.splice(old, 1); layout.order.splice(next, 0, id); save();
  const grid = $('#workspace-grid')!;
  const node = $<HTMLElement>(`.resource-card[data-id="${id}"]`, grid)!;
  const reference = grid.children[next];
  if (direction > 0) reference?.after(node); else reference?.before(node);
  node.focus(); motion.record('spatial', 'rearrange', id);
}
async function detachBlock(id: string) {
  if (!(window as any).__TAURI_INTERNALS__) { toast('Native detachment requires the Tauri desktop host.'); return; }
  const label = `block-${id}`;
  try {
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) { await existing.setFocus(); return; }
    const windowRef = new WebviewWindow(label, { title: `Aerynth · ${byId.get(id)!.title}`, url: `index.html?surface=block&block=${encodeURIComponent(id)}`, width: 740, height: 580, minWidth: 520, minHeight: 400, center: true });
    await new Promise<void>((resolve, reject) => { windowRef.once('tauri://created', () => resolve()); windowRef.once('tauri://error', event => reject(event.payload)); });
    layout.detached = [...new Set([...layout.detached, id])]; save();
    motion.record('spatial', 'detach-native-window', id);
    toast(`${byId.get(id)!.title} opened in a native window.`);
  } catch (error) { toast(`Window could not open: ${String(error)}`); }
}
function bindMain() {
  document.addEventListener('click', async event => {
    const target = event.target as HTMLElement;
    const nav = target.closest<HTMLElement>('[data-nav]');
    if (nav) { const id = nav.dataset.nav!; if (id === 'stream') { await openStream(); return; } $(`#${id}`)?.scrollIntoView({ behavior: layout.reduced ? 'instant' : 'smooth' }); return; }
    const state = target.closest<HTMLElement>('[data-vela]');
    if (state) { updateVela(state.dataset.vela as VelaState); return; }
    const action = target.closest<HTMLElement>('[data-action]');
    if (action) {
      const card = action.closest<HTMLElement>('.resource-card')!, id = card.dataset.id!;
      if (action.dataset.action === 'focus') focusBlock(id);
      if (action.dataset.action === 'resize') { const wide = layout.wide.includes(id); layout.wide = wide ? layout.wide.filter(x => x !== id) : [...layout.wide, id]; card.classList.toggle('wide', !wide); action.textContent = wide ? 'Widen' : 'Compact'; save(); motion.record('spatial', 'resize', id); }
      if (action.dataset.action === 'collapse') { const collapsed = layout.collapsed.includes(id); layout.collapsed = collapsed ? layout.collapsed.filter(x => x !== id) : [...layout.collapsed, id]; card.classList.toggle('collapsed', !collapsed); action.textContent = collapsed ? 'Collapse' : 'Expand'; save(); motion.record('spatial', 'collapse', id); }
      if (action.dataset.action === 'detach') await detachBlock(id);
      return;
    }
    const card = target.closest<HTMLElement>('.resource-card');
    if (card) selectBlock(card.dataset.id!);
    const message = target.closest<HTMLElement>('[data-message]');
    if (message) { selectedMessageId = message.dataset.message!; $$('.message-row.selected').forEach(el => { el.classList.remove('selected'); el.setAttribute('aria-pressed', 'false'); }); message.classList.add('selected'); message.setAttribute('aria-pressed', 'true'); $('#message-status')!.textContent = `Selected · ${selectedMessageId} · synthetic`; }
  });
  const grid = $('#workspace-grid')!;
  let dragged: string | null = null;
  grid.addEventListener('dragstart', event => { const card = (event.target as HTMLElement).closest<HTMLElement>('.resource-card'); if (!card) return; dragged = card.dataset.id!; card.classList.add('dragging'); (event as DragEvent).dataTransfer?.setData('text/plain', dragged); motion.record('interaction', 'drag-start', dragged); });
  grid.addEventListener('dragover', event => { if ((event.target as HTMLElement).closest('.resource-card')) event.preventDefault(); });
  grid.addEventListener('drop', event => { event.preventDefault(); const target = (event.target as HTMLElement).closest<HTMLElement>('.resource-card'); if (!dragged || !target || dragged === target.dataset.id) return; const old = layout.order.indexOf(dragged), next = layout.order.indexOf(target.dataset.id!); layout.order.splice(old, 1); layout.order.splice(next, 0, dragged); save(); const node = $<HTMLElement>(`.resource-card[data-id="${dragged}"]`, grid)!; if (old < next) target.after(node); else target.before(node); motion.record('spatial', 'drop-rearrange', dragged); });
  grid.addEventListener('dragend', () => { $$('.dragging', grid).forEach(el => el.classList.remove('dragging')); dragged = null; });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeFocus(); return; }
    const card = (event.target as HTMLElement).closest<HTMLElement>('.resource-card');
    if (!card || (event.target as HTMLElement).closest('button')) return;
    if (event.key === 'Enter') { focusBlock(card.dataset.id!); event.preventDefault(); }
    if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'ArrowRight' || event.key === 'ArrowDown')) { event.preventDefault(); moveCard(card.dataset.id!, event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1); }
  });
  $('#quality-select')!.addEventListener('change', event => { layout.quality = (event.target as HTMLSelectElement).value as Quality; save(); motion.setQuality(layout.quality); });
  $('#reduced-toggle')!.addEventListener('change', event => { layout.reduced = (event.target as HTMLInputElement).checked; save(); motion.setReduced(layout.reduced); });
  $('#reset-layout')!.addEventListener('click', () => { layout.order = [...defaults.order]; layout.wide = []; layout.collapsed = []; save(); $('#workspace-grid')!.innerHTML = layout.order.map(id => card(byId.get(id)!)).join(''); toast('Workspace layout reset.'); });
  $('#open-stream')!.addEventListener('click', openStream);
  $('#jump-message')!.addEventListener('click', () => { const el = $<HTMLElement>('#message-list')!; el.scrollTop = el.scrollHeight; });
  $('#about-button')!.addEventListener('click', () => toast('Tauri 2 visual candidate · all content is synthetic · no Codex connection.'));
  $('#rail-settings')!.addEventListener('click', () => $('#lab')?.scrollIntoView({ behavior: layout.reduced ? 'instant' : 'smooth' }));
  $('#benchmark-button')!.addEventListener('click', runBenchmark);
  $('#export-button')!.addEventListener('click', exportMeasurements);
  $('.bench-control')!.addEventListener('click', async event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-bench]');
    if (!button) return;
    button.disabled = true;
    try { await benchmarkCommand(button.dataset.bench!); }
    catch (error) { benchmarkStatus(`Failed: ${String(error)}`); }
    finally { button.disabled = false; }
  });
}
async function openStream() {
  if (!(window as any).__TAURI_INTERNALS__) { $('#conversation')?.scrollIntoView(); toast('Secondary native window requires Tauri.'); return; }
  try {
    const win = await WebviewWindow.getByLabel('activity');
    if (win) { await win.setFocus(); return; }
    const reopened = new WebviewWindow('activity', { title: 'Aerynth · Intelligence Stream', url: 'index.html?surface=stream', width: 460, height: 720, minWidth: 360, minHeight: 500, center: true });
    await new Promise<void>((resolve, reject) => { reopened.once('tauri://created', () => resolve()); reopened.once('tauri://error', event => reject(event.payload)); });
    motion.record('spatial', 'reopen-activity-window');
  }
  catch (error) { toast(`Activity window unavailable: ${String(error)}`); }
}

type BenchmarkRecord = { scenario: string; source: 'measured-renderer'; stats: ReturnType<typeof motion.stats> };
let benchmarkResults: BenchmarkRecord[] = [];
async function runBenchmark() {
  const button = $<HTMLButtonElement>('#benchmark-button')!;
  button.disabled = true; button.textContent = 'Measuring…';
  const original = { quality: motion.quality, reduced: motion.reduced, paused: motion.paused };
  benchmarkResults = [];
  try {
    for (const scenario of [
      { name: 'animated-cinematic', quality: 'cinematic' as Quality, reduced: false },
      { name: 'animated-efficient', quality: 'efficient' as Quality, reduced: false },
      { name: 'idle-still', quality: 'cinematic' as Quality, reduced: false, paused: true },
      { name: 'reduced-motion', quality: 'cinematic' as Quality, reduced: true },
    ]) {
      motion.setQuality(scenario.quality); motion.setReduced(scenario.reduced); motion.setPaused('paused' in scenario && scenario.paused === true); motion.resetStats();
      await new Promise(resolve => setTimeout(resolve, 2200));
      benchmarkResults.push({ scenario: scenario.name, source: 'measured-renderer', stats: motion.stats() });
    }
    const output = $<HTMLElement>('#benchmark-output')!;
    output.textContent = JSON.stringify({ fixtureSeed: FIXTURE_SEED, fixtureCounts: FIXTURE_COUNTS, records: benchmarkResults,
      limits: ['Missed frames are estimated against each quality tier target, not measured display presents.', 'Process CPU/GPU and hidden/minimized measurements require separate host observation.'] }, null, 2);
  } finally { motion.setQuality(original.quality); motion.setReduced(original.reduced); motion.setPaused(original.paused); button.disabled = false; button.textContent = 'Run bounded benchmark ↗'; }
}
function exportMeasurements() {
  const payload = { capturedAt: new Date().toISOString(), source: 'local renderer requestAnimationFrame', seed: FIXTURE_SEED, counts: FIXTURE_COUNTS,
    current: motion.stats(), benchmark: benchmarkResults, unsupported: ['GPU time', 'process CPU', 'process memory', 'true present-to-display latency'] };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'aerynth-visual-lab-measurements.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function benchmarkStatus(message: string) { const output = $('#bench-status'); if (output) output.textContent = message; }
function benchmarkSnapshot() {
  return { source: 'local-renderer-control', seed: FIXTURE_SEED, sourceCounts: FIXTURE_COUNTS,
    quality: motion.quality, reducedMotion: motion.reduced, vela: motion.vela,
    wallUtc: new Date().toISOString(), rendererTimeOriginMs: performance.timeOrigin,
    actionTrace: ledger.snapshot(), currentFrames: motion.stats(), frameCapture: lastFrameCapture };
}
function downloadTrace() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(benchmarkSnapshot(), null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `aerynth-${ledger.surface}-local-trace.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function prepareFixedCinematic() {
  layout = { ...structuredClone(defaults), quality: 'cinematic', reduced: false };
  save();
  $('#workspace-grid')!.innerHTML = layout.order.map(id => card(byId.get(id)!)).join('');
  ($('#quality-select') as HTMLSelectElement).value = 'cinematic';
  ($('#reduced-toggle') as HTMLInputElement).checked = false;
  updateSelection(); updateVela('idle');
  motion.setQuality('cinematic'); motion.setReduced(false); motion.setPaused(false);
  ledger.clear(); lastFrameCapture = null;
  benchmarkStatus('Fixed cinematic ready · no adaptive quality control is active');
}
let scenarioRunning = false;
async function runScriptedScenario(name: string) {
  if (scenarioRunning) throw new Error('Another scripted scenario is still running');
  scenarioRunning = true;
  const start = performance.now();
  const step = async (offset: number, id: string, operation: () => void | Promise<void>) => {
    await atOffset(start, offset); await ledger.step(id, operation, offset);
  };
  const cardAction = (id: string, action: string) => $<HTMLButtonElement>(`.resource-card[data-id="${id}"] [data-action="${action}"]`)?.click();
  try {
    benchmarkStatus(`${name} · scripted actions running`);
    if (name === 'S2') await step(0, 'S2-vela-idle', () => updateVela('idle'));
    else if (name === 'S3') await step(0, 'S3-vela-working', () => updateVela('working'));
    else if (name === 'S4') {
      const list = $<HTMLElement>('#message-list')!;
      for (const [index, offset] of [[0, 0], [500, 300], [1000, 600], [1500, 900], [1999, 1200]]) {
        await step(offset, `S4-scroll-${index}`, () => { list.scrollTop = index * 84; list.dispatchEvent(new Event('scroll')); });
      }
    }
    else if (name === 'S6') {
      const first = blocks[0].id, second = blocks[1].id;
      await step(0, 'S6-reset-layout', () => { $('#reset-layout')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      await step(120, 'S6-select', () => selectBlock(first));
      await step(240, 'S6-drag-drop', () => {
        const source = $<HTMLElement>(`.resource-card[data-id="${first}"]`)!, target = $<HTMLElement>(`.resource-card[data-id="${second}"]`)!;
        const dataTransfer = new DataTransfer();
        source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
        target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
        target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
        source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
      });
      await step(360, 'S6-keyboard-reorder-equivalent', () => moveCard(first, -1));
      await step(480, 'S6-widen', () => cardAction(first, 'resize'));
      await step(600, 'S6-collapse', () => cardAction(first, 'collapse'));
      await step(720, 'S6-expand', () => cardAction(first, 'collapse'));
      await step(840, 'S6-focus', () => focusBlock(first));
      await step(860, 'S6-interrupt-return', closeFocus);
    }
    else if (name === 'S7') {
      for (const [state, offset] of [['idle', 0], ['working', 300], ['attention', 600], ['unavailable', 900]] as const) {
        await step(offset, `S7-vela-${state}`, () => updateVela(state));
      }
    }
    else if (name === 'S8') {
      if (!(window as any).__TAURI_INTERNALS__) throw new Error('S8 requires the native Tauri host');
      const id = blocks[1].id;
      await step(0, 'S8-activity-open', openStream);
      await step(250, 'S8-block-detach', () => detachBlock(id));
      await step(500, 'S8-block-focus', async () => { const win = await WebviewWindow.getByLabel(`block-${id}`); await win?.setFocus(); });
      await step(750, 'S8-block-close', async () => { const win = await WebviewWindow.getByLabel(`block-${id}`); await win?.close(); });
      await step(1000, 'S8-activity-close', async () => { const win = await WebviewWindow.getByLabel('activity'); await win?.close(); });
      await step(1250, 'S8-activity-reopen', openStream);
    }
    else if (name === 'S10-efficient') await step(0, 'S10-efficient', () => { layout.quality = 'efficient'; save(); motion.setQuality('efficient'); ($('#quality-select') as HTMLSelectElement).value = 'efficient'; });
    else if (name === 'S10-reduced') await step(0, 'S10-reduced', () => { layout.reduced = true; save(); motion.setReduced(true); ($('#reduced-toggle') as HTMLInputElement).checked = true; });
    else throw new Error(`Unknown scripted scenario: ${name}`);
    benchmarkStatus(`${name} complete · ${ledger.snapshot().records.length} timestamped actions`);
  } finally { scenarioRunning = false; }
}
async function benchmarkCommand(command: string) {
  if (command === 'prepare') prepareFixedCinematic();
  else if (command === 'capture-start') { motion.beginFrameCapture(); benchmarkStatus('Frame callback capture started · max 12,000 samples'); }
  else if (command === 'capture-stop') { lastFrameCapture = motion.endFrameCapture(); benchmarkStatus(`Frame callback capture stopped · ${lastFrameCapture.samples.length} samples`); }
  else if (command === 'export') { downloadTrace(); benchmarkStatus('Local JSON export requested; keep raw traces outside the public repository'); }
  else await runScriptedScenario(command);
}

function renderStream() {
  app.innerHTML = `<div class="stream-window"><header><span class="brand-diamond">✧</span><div><small>AERYNTH / SECONDARY SURFACE</small><strong>Intelligence Stream</strong></div><span class="fixture-pill">SYNTHETIC</span></header><div class="stream-intro"><span class="section-kicker">OBSERVABLE ACTIVITY / FIXTURE</span><h1>A current of events.</h1><p>1,000 deterministic events. No live Codex connection, agent run, or private reasoning is represented.</p><div class="stream-controls"><button id="burst-button">Play reproducible burst ↗</button><span id="burst-status">SEED ${FIXTURE_SEED}</span></div></div><div class="stream-list virtual-list" id="event-list" tabindex="0" aria-label="Synthetic activity events"><div class="virtual-spacer"></div><div class="virtual-items"></div></div><footer><span id="event-status">1,000 synthetic events</span><span>LOCAL / NO EGRESS</span></footer></div>`;
  const virtual = mountVirtualList('#event-list', events, 90, eventRow);
  $('#event-list')!.addEventListener('click', event => { const row = (event.target as HTMLElement).closest<HTMLElement>('[data-event]'); if (!row) return; selectedEventId = row.dataset.event!; $$('.event-row.selected').forEach(el => { el.classList.remove('selected'); el.setAttribute('aria-pressed', 'false'); }); row.classList.add('selected'); row.setAttribute('aria-pressed', 'true'); $('#event-status')!.textContent = `Selected · ${selectedEventId} · synthetic`; });
  $('#burst-button')!.addEventListener('click', async () => {
    const button = $<HTMLButtonElement>('#burst-button')!; button.disabled = true;
    for (let batch = 0; batch < 12; batch++) { virtual.jumpTo(Math.min(events.length - 1, batch * 73)); $('#burst-status')!.textContent = `SIMULATED BURST · ${String((batch + 1) * 73).padStart(3, '0')} / 1000`; await new Promise(resolve => setTimeout(resolve, 95)); }
    $('#burst-status')!.textContent = 'BURST COMPLETE · SYNTHETIC'; button.disabled = false;
  });
}
function renderDetached(id: string) {
  const block = byId.get(id);
  if (!block) { app.textContent = 'Unknown resource identity.'; return; }
  app.innerHTML = `<div class="detached-window"><header><span class="brand-diamond">✧</span><strong>AERYNTH / DETACHED RESOURCE</strong><span class="fixture-pill">SYNTHETIC</span></header><div class="detached-body"><span class="section-kicker">${esc(block.eyebrow)} · ${esc(block.id)}</span><div class="detached-visual">${blockVisual(block)}</div><h1>${esc(block.title)}</h1><p>${esc(block.summary)}</p><small>${esc(block.detail)}</small><div class="detached-actions"><button id="close-detached">Return to workspace ×</button></div></div><footer>Same fixture identity · independent native presentation</footer></div>`;
  $('#close-detached')?.addEventListener('click', () => window.close());
}

if (surface === 'stream') renderStream(); else if (surface === 'block' && detachedId) renderDetached(detachedId); else renderMain();

Object.assign(window, { __AERYNTH_BENCH__: {
  schema: 'aerynth-local-benchmark-control-v1',
  prepareFixedCinematic: () => { if (!surface) prepareFixedCinematic(); },
  runScenario: (name: string) => !surface ? runScriptedScenario(name) : Promise.reject(new Error('Main-window scenario only')),
  startFrameCapture: () => motion.beginFrameCapture(),
  stopFrameCapture: () => { lastFrameCapture = motion.endFrameCapture(); return lastFrameCapture; },
  snapshot: benchmarkSnapshot,
  clear: () => { ledger.clear(); lastFrameCapture = null; },
} });
