const { expressions: common, preflight: commonPreflight } = require('./workspace-approach-expressions.cjs');
const { compileExpression } = require('./library-native-expressions.cjs');
const { createHash } = require('node:crypto');
const q = JSON.stringify, panel = '.aw-contextual-surface[data-surface-id="related-resources"]';
// Finite observation for the existing guarded wait scheduler. Public snapshots
// expose contextual transition receipts, but not contextual channel poses.
function measureRelatedFrame(input = {}) {
  const selector = '.aw-contextual-surface[data-surface-id="related-resources"]', problems = [];
  const host = document.querySelector(selector), snapshot = window.__aerynth.snapshot();
  const transition = snapshot.receipts.filter(entry => /^contextual:\d+:related-resources$/.test(entry.resource)).at(-1) ?? null;
  const bounds = node => {
    if (!node || node.closest('[hidden], [inert]')) return null;
    let opacity = 1;
    for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (style.display === 'none' || style.visibility !== 'visible') return null;
      opacity *= Number(style.opacity);
    }
    const value = node.getBoundingClientRect();
    return { x: value.x, y: value.y, width: value.width, height: value.height, opacity };
  };
  const inside = (value, clip) => !!value && !!clip && [value.x, value.y, value.width, value.height, value.opacity].every(Number.isFinite) && value.width > 0 && value.height > 0 && value.opacity >= 0.995 && value.x >= clip.x - 0.75 && value.y >= clip.y - 0.75 && value.x + value.width <= clip.x + clip.width + 0.75 && value.y + value.height <= clip.y + clip.height + 0.75;
  const rendered = bounds(host), style = host ? getComputedStyle(host) : null, body = host?.querySelector('.aw-contextual-content');
  const clip = bounds(body), section = host?.querySelector('.aw-resource-links');
  const items = [
    ['heading', '.aw-contextual-heading > span', rendered], ['dismiss', '.aw-contextual-dismiss', rendered],
    ['source', '.aw-resource-links-header h3', clip], ['search', 'input[aria-label="Find related resources"]', clip],
  ].map(([role, path, clip]) => { const node = host?.querySelector(path), value = bounds(node); return { role, bounds: value, visible: inside(value, clip), text: (node?.textContent ?? '').slice(0, 240) }; });
  for (const id of [input.edgeId, input.membershipId].filter(Boolean)) {
    const row = host?.querySelector('[data-relationship-id=' + JSON.stringify(id) + ']');
    for (const [role, path] of [['target', '.aw-resource-links-target'], ['detail', 'small'], ...(id === input.edgeId ? [['remove', '[data-remove-link]']] : [])]) {
      const node = row?.querySelector(path), value = bounds(node);
      items.push({ role: id + ':' + role, bounds: value, visible: inside(value, clip), text: (node?.textContent ?? '').slice(0, 240) });
    }
  }
  if (!host?.open || !inside(rendered, { x: 1, y: 1, width: innerWidth - 2, height: innerHeight - 2 })) problems.push('host-not-painted-in-window');
  if (!inside(clip, rendered)) problems.push('content-clip-not-painted');
  if (!section || section.dataset.resourceId !== input.resourceId || section.getAttribute('aria-busy') === 'true' || !input.resourceId || !input.edgeId) problems.push('wrong-or-busy-source');
  if (!transition || transition.status !== 'settled') problems.push('contextual-motion-unsettled');
  if (!style || !rendered || ![parseFloat(style.width), parseFloat(style.height)].every(Number.isFinite) || Math.abs(parseFloat(style.width) - rendered.width) > 0.75 || Math.abs(parseFloat(style.height) - rendered.height) > 0.75) problems.push('host-dimensions-not-painted');
  if (document.hidden || !document.hasFocus()) problems.push('inactive-document');
  if (document.fonts && document.fonts.status !== 'loaded') problems.push('fonts-loading');
  for (const item of items) if (!item.visible) problems.push(item.role + ':clipped-or-transparent');
  const disclosure = path => { const node = host?.querySelector(path); return { bounds: bounds(node), visible: inside(bounds(node), clip) }; };
  return { ready: problems.length === 0, problems, expected: input, rendered, transition,
    material: style ? { opacity: style.opacity, background: style.background, backdropFilter: style.backdropFilter, transform: style.transform, width: style.width, height: style.height } : null,
    scroll: body ? { top: body.scrollTop, clientHeight: body.clientHeight, scrollHeight: body.scrollHeight } : null,
    items, addLink: disclosure('.aw-resource-links-create-toggle > summary'), aboutLinks: disclosure('.aw-resource-links-help > summary') };
}
const expressions = {
  relatedReady: id => `(()=>{const e=document.querySelector(${q(panel + ' .aw-resource-links')});return !!e&&e.dataset.resourceId===${q(id)}&&e.getAttribute('aria-busy')!=='true'})()`,
  focused: selector => `document.activeElement===document.querySelector(${q(selector)})`,
  focusDetails: () => `(()=>{const e=document.activeElement;return e?{tag:e.tagName,ariaLabel:e.getAttribute('aria-label'),insideRelated:!!e.closest(${q(panel)})}:null})()`,
  edgeExists: (source, target, kind) => `window.__aerynth.application().relationships.some(e=>e.source_id===${q(source)}&&e.target_id===${q(target)}&&e.kind===${q(kind)}&&e.provenance==='user')`,
  edgeAbsent: id => `!window.__aerynth.application().relationships.some(e=>e.id===${q(id)})`,
  linkDetail: id => `document.querySelector(${q(panel + ' [data-relationship-id=' + q(id) + '] small')})?.textContent`,
  openedTarget: id => `(()=>{const s=window.__aerynth.application();return s.navigation.kind==='workspace'&&s.blocks.some(b=>b.resource_id===${q(id)}&&document.querySelector('[data-block='+JSON.stringify(b.id)+']')?.classList.contains('expanded'))})()`,
  relatedFrame: input => `(${measureRelatedFrame.toString()})(${q(input)})`,
  relatedResting: input => `(${measureRelatedFrame.toString()})(${q(input)}).ready`,
};
exports.panel = panel;
exports.expressions = Object.freeze({ ...common, ...expressions });
exports.preflight = () => {
  const common = commonPreflight(), id = 'quote"\n', selector = '[data-resource-id="quote\\\"id"]';
  const frameCases = [[{ resourceId: id, edgeId: 'edge"\n' }], [{ resourceId: id, edgeId: 'edge"\n', membershipId: 'protected"\n' }], []];
  const inputs = { relatedReady: [[id]], focused: [[selector]], focusDetails: [[]], edgeExists: [[id, 'task"\n', 'references'], [id, 'task"\n', 'depends_on'], [id, 'task"\n', 'related_to']], edgeAbsent: [[id]], linkDetail: [[id]], openedTarget: [[id]], relatedFrame: frameCases, relatedResting: frameCases };
  const names = Object.keys(expressions).sort();
  if (JSON.stringify(names) !== JSON.stringify(Object.keys(inputs).sort())) throw Error('uncovered_resource_links_expression');
  const compiled = [];
  for (const name of names) for (const args of inputs[name]) { const source = expressions[name](...args); compileExpression(source); compiled.push([name, source]); }
  return { common, factories: names.length, cases: compiled.length, names, sha256: createHash('sha256').update(JSON.stringify({ common, compiled })).digest('hex') };
};
