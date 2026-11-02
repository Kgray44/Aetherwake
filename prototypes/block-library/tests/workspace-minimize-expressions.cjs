const { expressions: common, preflight: commonPreflight } = require('./workspace-approach-expressions.cjs');
const { compileExpression } = require('./library-native-expressions.cjs');
const { createHash } = require('node:crypto');
const q = JSON.stringify;
const pose = selector => `(()=>{const e=document.querySelector(${q(selector)}),r=e?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height,effectiveMinimized:e.dataset.blockMinimized,composition:e.dataset.blockComposition,expanded:e.classList.contains('expanded')}:null})()`;
const expressions = {
  pose,
  minimized: (id, value) => `window.__aerynth.application().blocks.find(b=>b.id===${q(id)})?.minimized===${q(value)}`,
  shrunk: (selector, before) => `(()=>{const p=${pose(selector)};return !!p&&p.effectiveMinimized==='true'&&p.composition==='overview'&&p.width>0&&p.height>0&&p.width<${q(before.width)}-8&&p.height<${q(before.height)}-8})()`,
  restoredSize: (selector, before) => `(()=>{const p=${pose(selector)};return !!p&&p.effectiveMinimized==='false'&&Math.abs(p.width-${q(before.width)})<=1&&Math.abs(p.height-${q(before.height)})<=1})()`,
};
exports.expressions = Object.freeze({ ...common, ...expressions });
exports.preflight = () => {
  const common = commonPreflight(), selector = '[data-block="quote\\\"id"]', before = { width: 147, height: 147 };
  const inputs = { pose: [[selector]], minimized: [['quote"\n', true], ['quote"\n', false]], shrunk: [[selector, before]], restoredSize: [[selector, before]] };
  const names = Object.keys(expressions).sort();
  if (JSON.stringify(names) !== JSON.stringify(Object.keys(inputs).sort())) throw Error('uncovered_minimize_expression');
  const compiled = [];
  for (const name of names) for (const args of inputs[name]) { const source = expressions[name](...args); compileExpression(source); compiled.push([name, source]); }
  return { common, factories: names.length, cases: compiled.length, names, sha256: createHash('sha256').update(JSON.stringify({ common, compiled })).digest('hex') };
};
