const { expressions: common, preflight: commonPreflight } = require('./workspace-approach-expressions.cjs');
const { compileExpression } = require('./library-native-expressions.cjs');
const { createHash } = require('node:crypto');
const q = JSON.stringify;
const expressions = {
  noteSavedIs: (id, content) => `window.aerynthHost.command('notes',${q({ name: 'readNote', input: id })}).then(r=>!r.result.draft&&r.result.resource.content===${q(content)})`,
  groupHas: (groupId, taskId) => `window.__aerynth.application().resources.find(r=>r.id===${q(groupId)})?.taskMembers?.some(t=>t.id===${q(taskId)})===true`,
  eventMetadata: (selector) => `(()=>{const row=document.querySelector(${q(selector)});if(!row)return null;const dt=[...row.querySelectorAll('dt')],dd=[...row.querySelectorAll('dd')];return Object.fromEntries(dt.map((e,i)=>[e.textContent,dd[i]?.textContent]))})()`,
  projectSummary: selector => `document.querySelector(${q(selector + ' .aw-project-summary')})?.textContent`,
  composerProvider: selector => `(()=>{const e=document.querySelector(${q(selector + ' .cp-composer-provider')});return e?{id:e.dataset.providerId,label:e.textContent}:null})()`,
};
exports.expressions = Object.freeze({ ...common, ...expressions });
exports.preflight = () => {
  const common = commonPreflight(), id = 'quote"\n', selector = '[data-block="quote\\\"id"]';
  const inputs = { noteSavedIs: [[id, 'canonical"\n']], groupHas: [[id, 'task"\n']], eventMetadata: [[selector]], projectSummary: [[selector]], composerProvider: [[selector]] };
  const names = Object.keys(expressions).sort();
  if (JSON.stringify(names) !== JSON.stringify(Object.keys(inputs).sort())) throw Error('uncovered_functional_expression');
  const compiled = [];
  for (const name of names) for (const args of inputs[name]) { const source = expressions[name](...args); compileExpression(source); compiled.push([name, source]); }
  return { common, factories: names.length, cases: compiled.length, names, sha256: createHash('sha256').update(JSON.stringify({ common, compiled })).digest('hex') };
};
