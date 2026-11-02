const { expressions: common, compileExpression, preflight: commonPreflight } = require('./library-native-expressions.cjs');
const { createHash } = require('node:crypto');
const q = JSON.stringify;
// Read-only, bounded diagnostics distinguish native Tab from camera reflow.
const editorMetrics = selector => `(()=>{const e=document.querySelector(${q(selector)});if(!e)return null;const s=getComputedStyle(e),b=e.closest('.working-content'),r=e.getBoundingClientRect(),br=b?.getBoundingClientRect();return {scroll:e.scrollTop,scrollLeft:e.scrollLeft,clientWidth:e.clientWidth,clientHeight:e.clientHeight,scrollWidth:e.scrollWidth,scrollHeight:e.scrollHeight,start:e.selectionStart,end:e.selectionEnd,focused:document.activeElement===e,width:r.width,height:r.height,fontSize:s.fontSize,lineHeight:s.lineHeight,overflowAnchor:s.overflowAnchor,body:b?{scroll:b.scrollTop,scrollLeft:b.scrollLeft,width:br.width,height:br.height}:null}})()`;
const expressions = {
  execute: command => `window.__aerynth.execute(${q(command)})`,
  composition: (selector, mode) => `document.querySelector(${q(selector)})?.dataset.blockComposition===${q(mode)}`,
  expanded: (selector, value) => `!!document.querySelector(${q(selector)})&&document.querySelector(${q(selector)}).classList.contains('expanded')===${q(value)}`,
  rememberNode: selector => `(()=>{window.__workspaceApproachNode=document.querySelector(${q(selector)});return !!window.__workspaceApproachNode})()`,
  sameNode: selector => `document.querySelector(${q(selector)})===window.__workspaceApproachNode`,
  editorMetrics,
  rememberEditor: selector => `(()=>{const e=document.querySelector(${q(selector)}),metrics=${editorMetrics(selector)};window.__workspaceApproachEditor={node:e,value:e.value,start:e.selectionStart,end:e.selectionEnd,scroll:e.scrollTop,metrics};return {value:e.value,start:e.selectionStart,end:e.selectionEnd,scroll:e.scrollTop,metrics}})()`,
  retainedEditor: selector => `(()=>{const e=document.querySelector(${q(selector)}),r=window.__workspaceApproachEditor;return {sameNode:e===r.node,sameText:e.value===r.value,sameSelection:e.selectionStart===r.start&&e.selectionEnd===r.end,scrollDelta:Math.abs(e.scrollTop-r.scroll),before:r.metrics,after:${editorMetrics(selector)}}})()`,
  checked: (selector, value) => `document.querySelector(${q(selector)})?.checked===${q(value)}`,
  dom: selector => `(()=>{const e=document.querySelector(${q(selector)}),b=e?.querySelector('.working-content'),r=b?.getBoundingClientRect();return {composition:e?.dataset.blockComposition,expanded:e?.classList.contains('expanded'),body:{width:r?.width,height:r?.height},hiddenChildren:b?[...b.children].filter(n=>!n.classList.contains('aw-block-overview')).map(n=>({inert:n.inert,visibility:getComputedStyle(n).visibility})):[]}})()`,
};
exports.expressions = Object.freeze({ ...common, ...expressions });
exports.preflight = () => {
  const commonResult = commonPreflight(), selector = '[data-block="synthetic-quoted-id"] textarea';
  const inputs = { execute: [[{ type: 'navigate', target: { kind: 'workspace', workspaceId: 'quote"\n' } }], [{ type: 'setViewport', workspaceId: 'quote"\n', viewport: { x: -17, y: -43, zoom: .35 } }]], composition: [[selector, 'overview'], [selector, 'working']], expanded: [[selector, true], [selector, false]], rememberNode: [[selector]], sameNode: [[selector]], editorMetrics: [[selector]], rememberEditor: [[selector]], retainedEditor: [[selector]], checked: [[selector, true], [selector, false]], dom: [[selector]] };
  const names = Object.keys(expressions).sort();
  if (JSON.stringify(names) !== JSON.stringify(Object.keys(inputs).sort())) throw Error('uncovered_approach_expression');
  const compiled = [];
  for (const name of names) for (const args of inputs[name]) { const source = expressions[name](...args); compileExpression(source); compiled.push([name, source]); }
  return { common: commonResult, factories: names.length, cases: compiled.length, names, sha256: createHash('sha256').update(JSON.stringify(compiled)).digest('hex') };
};
