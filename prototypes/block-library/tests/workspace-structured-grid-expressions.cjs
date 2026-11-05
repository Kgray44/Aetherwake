const { expressions: common, preflight: commonPreflight, compileExpression } = require('./library-native-expressions.cjs');
const { createHash } = require('node:crypto');
const q = JSON.stringify;
function measureGrid(ids = []) {
  const state = window.__aerynth.application(), motion = window.__aerynth.snapshot(), problems = [];
  const viewport = state.viewport, project = item => ({ x: (item.x - viewport.x) * viewport.zoom, y: (item.y - viewport.y) * viewport.zoom, width: item.width * viewport.zoom, height: item.height * viewport.zoom });
  const bounds = node => { if (!node || node.closest('[hidden], [inert]')) return null; const r = node.getBoundingClientRect(), s = getComputedStyle(node); return { x: r.x, y: r.y, width: r.width, height: r.height, opacity: Number(s.opacity), painted: s.display !== 'none' && s.visibility === 'visible' }; };
  const settled = id => { const receipt = motion.receipts.filter(entry => entry.resource === id).at(-1); return !receipt || receipt.status === 'settled'; };
  const matches = (actual, expected) => actual && actual.painted && actual.opacity >= 0.995 && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(actual[key]) && Math.abs(actual[key] - expected[key]) <= 0.75);
  const fits = value => value && value.x >= 8 && value.y >= 170 && value.x + value.width <= innerWidth - 8 && value.y + value.height <= innerHeight - 60;
  if (document.hidden || !document.hasFocus()) problems.push('inactive-document');
  if (document.fonts && document.fonts.status !== 'loaded') problems.push('fonts-loading');
  if (ids.length < 3 || ids.length !== state.blocks.length || ids.some(id => !state.blocks.some(block => block.id === id))) problems.push('unexpected-card-set');
  if (document.querySelector('dialog[open], .folio.expanded, .floating-dialog:not([hidden])')) problems.push('unexpected-overlay');
  const stage = bounds(document.querySelector('#stage'));
  if (!stage || stage.opacity < 0.995 || !settled('application:arrival')) problems.push('arrival-unsettled');
  const cards = state.blocks.map(block => {
    const expected = project(block), node = document.querySelector('[data-block=' + JSON.stringify(block.id) + ']'), rendered = bounds(node), pose = motion.poses[block.id];
    const atRest = pose && ['x', 'y', 'w', 'h', 'lift', 'yaw', 'opacity'].every(key => Number.isFinite(pose[key]) && Math.abs(pose[key] - ({ x: expected.x, y: expected.y, w: expected.width, h: expected.height, lift: 0, yaw: 0, opacity: 1 })[key]) <= 0.1);
    if (!matches(rendered, expected) || !atRest || !settled(block.id)) problems.push(block.id + ':unsettled');
    if (!fits(rendered)) problems.push(block.id + ':clipped');
    return { id: block.id, expected, rendered, pose, transition: motion.receipts.filter(entry => entry.resource === block.id).at(-1) ?? null };
  });
  const vela = { expected: project(state.presence), rendered: bounds(document.querySelector('#vela')) };
  if (!matches(vela.rendered, vela.expected) || !settled('application:vela-presence') || !fits(vela.rendered)) problems.push('vela-unsettled-or-clipped');
  return { ready: problems.length === 0, problems, cards, vela, viewport, window: { width: innerWidth, height: innerHeight } };
}
const expressions = { gridFrame: ids => `(${measureGrid.toString()})(${q(ids)})`, gridResting: ids => `(${measureGrid.toString()})(${q(ids)}).ready` };
exports.expressions = Object.freeze({ ...common, ...expressions });
exports.preflight = () => {
  const common = commonPreflight(), inputs = { gridFrame: [[['quote"\n', 'second', 'third']], []], gridResting: [[['quote"\n', 'second', 'third']], []] }, names = Object.keys(expressions).sort(), compiled = [];
  if (JSON.stringify(names) !== JSON.stringify(Object.keys(inputs).sort())) throw Error('uncovered_structured_grid_expression');
  for (const name of names) for (const args of inputs[name]) { const code = expressions[name](...args); compileExpression(code); compiled.push([name, code]); }
  return { common, factories: names.length, cases: compiled.length, names, sha256: createHash('sha256').update(JSON.stringify({ common, compiled })).digest('hex') };
};
