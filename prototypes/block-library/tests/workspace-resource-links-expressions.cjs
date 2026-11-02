const { expressions: common, preflight: commonPreflight } = require('./workspace-approach-expressions.cjs');
const { compileExpression } = require('./library-native-expressions.cjs');
const { createHash } = require('node:crypto');
const q = JSON.stringify, panel = '.aw-contextual-surface[data-surface-id="related-resources"]';
const expressions = {
  relatedReady: id => `(()=>{const e=document.querySelector(${q(panel + ' .aw-resource-links')});return !!e&&e.dataset.resourceId===${q(id)}&&e.getAttribute('aria-busy')!=='true'})()`,
  focused: selector => `document.activeElement===document.querySelector(${q(selector)})`,
  focusDetails: () => `(()=>{const e=document.activeElement;return e?{tag:e.tagName,ariaLabel:e.getAttribute('aria-label'),insideRelated:!!e.closest(${q(panel)})}:null})()`,
  edgeExists: (source, target, kind) => `window.__aerynth.application().relationships.some(e=>e.source_id===${q(source)}&&e.target_id===${q(target)}&&e.kind===${q(kind)}&&e.provenance==='user')`,
  edgeAbsent: id => `!window.__aerynth.application().relationships.some(e=>e.id===${q(id)})`,
  linkDetail: id => `document.querySelector(${q(panel + ' [data-relationship-id=' + q(id) + '] small')})?.textContent`,
  openedTarget: id => `(()=>{const s=window.__aerynth.application();return s.navigation.kind==='workspace'&&s.blocks.some(b=>b.resource_id===${q(id)}&&document.querySelector('[data-block='+JSON.stringify(b.id)+']')?.classList.contains('expanded'))})()`,
};
exports.panel = panel;
exports.expressions = Object.freeze({ ...common, ...expressions });
exports.preflight = () => {
  const common = commonPreflight(), id = 'quote"\n', selector = '[data-resource-id="quote\\\"id"]';
  const inputs = { relatedReady: [[id]], focused: [[selector]], focusDetails: [[]], edgeExists: [[id, 'task"\n', 'references'], [id, 'task"\n', 'depends_on'], [id, 'task"\n', 'related_to']], edgeAbsent: [[id]], linkDetail: [[id]], openedTarget: [[id]] };
  const names = Object.keys(expressions).sort();
  if (JSON.stringify(names) !== JSON.stringify(Object.keys(inputs).sort())) throw Error('uncovered_resource_links_expression');
  const compiled = [];
  for (const name of names) for (const args of inputs[name]) { const source = expressions[name](...args); compileExpression(source); compiled.push([name, source]); }
  return { common, factories: names.length, cases: compiled.length, names, sha256: createHash('sha256').update(JSON.stringify({ common, compiled })).digest('hex') };
};
