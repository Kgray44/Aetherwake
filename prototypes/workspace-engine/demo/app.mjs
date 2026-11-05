import { bindBlock, BlockMotionBridge } from '/modules/workspace-engine/interaction.mts';
import { reachable } from '/modules/workspace-engine/geometry.mts';
import { MotionCoordinator } from '/modules/visual-experience/cinematic-v3/src/motion.ts';
const $ = id => document.getElementById(id), token = document.querySelector('meta[name=demo-token]').content;
const api = async (path, body = {}) => {
  const r = await fetch(`/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-demo-token': token }, body: JSON.stringify(body) });
  const data = await r.json(); if (!r.ok) throw Object.assign(new Error(data.message), data); return data;
};
let state, selected, listing, frame = 0, last = performance.now(), readerBlock;
const nodes = new Map(), drafts = new Map(), pendingNotes = new Map();
const motion = new MotionCoordinator(), bridge = new BlockMotionBridge(motion);
const status = text => { $('status').textContent = text; };
const failed = e => status(`${e.code ?? 'ERROR'}: ${e.message}. Your draft remains in its editor. Refresh state before retrying a conflicting layout command.`);
const safe = fn => async () => { try { await fn(); } catch (e) { failed(e); } };
const current = () => state.blocks.find(b => b.blockId === selected);
const dataFor = id => listing.resources.find(v => v.resource.id === id);
const canvasSize = () => ({ width: Math.max(128, $('canvas').clientWidth), height: Math.max(96, $('canvas').clientHeight) });
const interactionState = () => { const size = canvasSize(); return { ...state, blocks: state.blocks.map(b => reachable(b, size.width, size.height)) }; };
const radii = { rectangle: '0', rounded: '18px', circle: '50%', pill: '70px', folio: '4px 24px 24px 4px', lens: '50%' };
function animate() {
  frame = 0; const now = performance.now(), active = motion.step((now - last) / 1000); last = now;
  const top = $('status').getBoundingClientRect().bottom;
  $('canvas').style.top = `${top}px`; document.querySelector('aside').style.top = `${top}px`;
  const size = canvasSize();
  for (const b of state.blocks) {
    const item = nodes.get(b.blockId); if (!item || !motion.bodies.has(b.blockId)) continue;
    const p = motion.pose(b.blockId), visible = reachable({ x: p.x, y: p.y, width: p.w, height: p.h }, size.width, size.height);
    Object.assign(item.el.style, { left: `${visible.x}px`, top: `${visible.y}px`, width: `${p.w}px`, height: `${p.h}px`, transform: `rotate(${b.rotation}deg)`, zIndex: b.zIndex, borderRadius: radii[b.shape] });
  }
  if (active) wake();
}
function wake() { if (!frame) { last = performance.now(); frame = requestAnimationFrame(animate); } }
function properties() {
  const b = current(); $('selected').textContent = b ? `Block ${b.blockId.slice(0, 8)} · resource ${b.resourceId.slice(0, 8)}` : 'Select a block.';
  if (!b) return;
  for (const key of ['shape', 'x', 'y', 'width', 'height']) $(key).value = b[key];
  for (const [id, n] of nodes) n.el.classList.toggle('selected', id === b.blockId);
}
async function refreshList() {
  listing = await api('list');
  for (const [id, values, label, selectedValue] of [
    ['workspaces', listing.workspaces, w => w.title, state?.workspaceId],
    ['resource', listing.resources.filter(v => v.resource.state === 'active'), v => v.resource.title, $('resource').value],
    ['checkpoints', listing.checkpoints, v => v.name, $('checkpoints').value],
  ]) {
    const target = $(id); target.replaceChildren(...values.map(v => { const o = document.createElement('option'); o.value = v.workspaceId ?? v.resource?.id ?? v.id; o.textContent = label(v); return o; }));
    if (Array.from(target.options).some(o => o.value === selectedValue)) target.value = selectedValue;
  }
}
function edit(resourceId, content) {
  drafts.set(resourceId, content);
  for (const item of nodes.values()) if (item.resourceId === resourceId && document.activeElement !== item.editor) item.editor.value = content;
  if (readerBlock?.resourceId === resourceId && document.activeElement !== $('reading-editor')) $('reading-editor').value = content;
  // Serialize writes per canonical resource, including duplicate placements and readers.
  const previous = pendingNotes.get(resourceId) ?? Promise.resolve();
  const job = previous.catch(() => {}).then(async () => {
    const data = dataFor(resourceId); if (!data?.note) return;
    const result = await api('note', { resourceId, content, expectedVersion: data.resource.version });
    data.resource = result; data.note.content = content;
    if (drafts.get(resourceId) === content) drafts.delete(resourceId);
    status('Canonical synthetic draft saved. Layout operations preserve the editor.');
  }).catch(failed);
  pendingNotes.set(resourceId, job); return job;
}
function makeBlock(b) {
  const el = document.createElement('article'); el.className = 'block'; el.dataset.blockId = b.blockId;
  const surface = document.createElement('div'); surface.className = 'surface';
  const grip = document.createElement('button'); grip.className = 'grip'; grip.textContent = 'Move block ⠿'; grip.setAttribute('aria-label', 'Move block. Alt plus arrows.');
  const title = document.createElement('h2'), summary = document.createElement('p'); summary.className = 'summary';
  const editor = document.createElement('textarea'); editor.setAttribute('aria-label', 'Synthetic note draft');
  const open = document.createElement('button'); open.textContent = 'Open reading surface';
  surface.append(grip, title, summary, editor, open); el.append(surface);
  const handles = {};
  for (const h of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) {
    const button = document.createElement('button'); button.className = `handle ${h}`; button.textContent = '·'; button.setAttribute('aria-label', `Resize ${h}. Arrow keys resize.`); handles[h] = button; el.append(button);
  }
  const select = () => { selected = b.blockId; properties(); };
  el.addEventListener('pointerdown', select); el.addEventListener('focusin', select);
  editor.addEventListener('input', () => void edit(b.resourceId, editor.value));
  open.onclick = () => {
    selected = b.blockId; properties(); readerBlock = current();
    const data = dataFor(b.resourceId); $('reading-title').textContent = data.resource.title;
    $('reading-editor').value = drafts.get(b.resourceId) ?? data.note?.content ?? 'Conversation fixture: provider unavailable.';
    $('reading-editor').readOnly = !data.note; $('reading').hidden = false;
    const size = canvasSize(); bridge.unfold(readerBlock, size.width, size.height); wake(); $('reading-editor').focus();
  };
  $('canvas').append(el);
  const dispose = bindBlock({ element: el, grip, handles, blockId: b.blockId, state: interactionState, port: { project: workspaceId => api('state', { workspaceId }), execute: c => api('execute', c) }, motion: bridge,
    changed: accept, failed, preview: () => wake(), grid: () => $('snap').checked ? 16 : 0 });
  return { el, title, summary, editor, open, handles, grip, resourceId: b.resourceId, dispose };
}
async function accept(next) {
  state = next; await refreshList();
  const ids = new Set(state.blocks.map(b => b.blockId));
  for (const [id, n] of nodes) if (!ids.has(id)) { n.dispose(); n.el.remove(); nodes.delete(id); }
  bridge.sync(state.blocks, 'committed layout or shape change');
  for (const b of state.blocks) {
    let n = nodes.get(b.blockId); if (!n) { n = makeBlock(b); nodes.set(b.blockId, n); }
    const data = dataFor(b.resourceId);
    n.el.dataset.contentMode = b.contentMode;
    n.title.textContent = data.resource.title; n.summary.textContent = b.resourceState === 'archived' ? 'Archived resource. Restore to return to active views.' : `Canonical ${data.resource.kind} · ${b.shape}`;
    n.editor.hidden = b.contentMode === 'summary' || !data.note || b.resourceState === 'archived'; n.open.hidden = b.resourceState === 'archived';
    if (document.activeElement !== n.editor) n.editor.value = drafts.get(b.resourceId) ?? data.note?.content ?? '';
    for (const h of Object.values(n.handles)) h.disabled = b.locked;
    n.grip.disabled = b.locked;
  }
  if (!current()) selected = state.blocks[0]?.blockId;
  $('undo').disabled = !state.canUndo; $('redo').disabled = !state.canRedo; properties(); wake();
  status(`${state.blocks.length} blocks · layout revision ${state.revision} · persistent SQLite state`);
}
async function command(action) {
  const next = await api('execute', { commandId: crypto.randomUUID(), workspaceId: state.workspaceId, expectedRevision: state.revision, ...action }); await accept(next); return next;
}
$('new-note').onclick = safe(() => command({ type: 'createBlock', resource: { kind: 'note', title: `Synthetic note ${state.blocks.length + 1}`, content: 'Synthetic editable fixture.' }, templateId: $('template').value }));
$('attach').onclick = safe(() => command({ type: 'attachResource', resourceId: $('resource').value, templateId: $('template').value }));
$('create-workspace').onclick = safe(async () => { await Promise.all(pendingNotes.values()); await accept(await api('create', { title: $('workspace-title').value })); });
$('rename-workspace').onclick = safe(async () => accept(await api('rename', { workspaceId: state.workspaceId, title: $('workspace-title').value, expectedVersion: state.workspaceVersion })));
$('workspaces').onchange = safe(async () => { await Promise.all(pendingNotes.values()); $('reading').hidden = true; await accept(await api('switch', { workspaceId: $('workspaces').value })); });
$('undo').onclick = safe(() => command({ type: 'undoLayout' })); $('redo').onclick = safe(() => command({ type: 'redoLayout' }));
$('arrange').onclick = safe(() => command({ type: 'applyPreset', preset: $('preset').value, ...canvasSize() }));
$('apply').onclick = safe(() => command({ type: 'saveLayout', placements: [{ blockId: current().blockId, expectedVersion: current().version, presentation: { x: Number($('x').value), y: Number($('y').value), width: Number($('width').value), height: Number($('height').value), shape: $('shape').value } }] }));
for (const [id, type, fields] of [
  ['duplicate', 'duplicateBlock', () => ({})], ['remove', 'detachBlock', () => ({})],
  ['lock', 'setBlockLock', () => ({ locked: !current().locked })], ['minimize', 'setBlockPresentation', () => ({ patch: { minimized: !current().minimized } })],
  ['forward', 'setBlockLayer', () => ({ zIndex: current().zIndex + 1 })], ['backward', 'setBlockLayer', () => ({ zIndex: current().zIndex - 1 })],
]) $(id).onclick = safe(() => command({ type, blockId: current().blockId, ...fields() }));
$('archive').onclick = safe(async () => { const data = dataFor(current().resourceId); await api('archive', { resourceId: data.resource.id, archived: data.resource.state === 'active', expectedVersion: data.resource.version }); await accept(await api('state')); });
$('checkpoint').onclick = safe(() => command({ type: 'checkpoint', name: `Synthetic checkpoint ${listing.checkpoints.length + 1}` }));
$('restore').onclick = safe(() => command({ type: 'restoreCheckpoint', checkpointId: $('checkpoints').value }));
$('reduce').checked = matchMedia('(prefers-reduced-motion: reduce)').matches; motion.reduced = $('reduce').checked;
$('reduce').onchange = () => { motion.reduced = $('reduce').checked; wake(); };
$('reading-editor').addEventListener('input', () => { if (readerBlock) void edit(readerBlock.resourceId, $('reading-editor').value); });
$('close-reading').onclick = () => { $('reading').hidden = true; bridge.sync(state.blocks, 'close reading surface'); wake(); nodes.get(readerBlock?.blockId)?.open.focus(); readerBlock = null; };
addEventListener('resize', wake);
await accept(await api('state'));
