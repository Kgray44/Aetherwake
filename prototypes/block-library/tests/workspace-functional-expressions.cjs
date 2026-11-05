const { expressions: common, preflight: commonPreflight } = require('./workspace-approach-expressions.cjs');
const { compileExpression } = require('./library-native-expressions.cjs');
const { createHash } = require('node:crypto');
const q = JSON.stringify;
// Finite read-only probe used by the existing guarded driver's wait scheduler.
// Settled receipts are the coordinator's own state, never a new animation loop.
function measureComparison(input) {
  const snapshot = window.__aerynth.snapshot(), problems = [];
  const view = { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio };
  const rect = node => {
    if (!node) return null;
    const value = node.getBoundingClientRect(), style = getComputedStyle(node);
    return value.width > 0 && value.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
      ? { x: value.x, y: value.y, width: value.width, height: value.height, opacity: Number(style.opacity) }
      : null;
  };
  const chrome = ['.dock', '.keys', '.provenance', '#status', '.topbar', '.study-caption'].flatMap(selector => {
    const bounds = rect(document.querySelector(selector)); return bounds ? [{ selector, ...bounds }] : [];
  });
  const footers = chrome.filter(bounds => bounds.y >= view.height / 2), headers = chrome.filter(bounds => bounds.y < view.height / 2);
  const usable = { left: 8, right: view.width - 8, top: Math.max(170, ...headers.map(bounds => bounds.y + bounds.height + 8)), bottom: Math.min(view.height, ...footers.map(bounds => bounds.y)) - 8 };
  const fits = bounds => !!bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) && bounds.x >= usable.left && bounds.y >= usable.top && bounds.x + bounds.width <= usable.right && bounds.y + bounds.height <= usable.bottom;
  const near = (actual, expected) => !!actual && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(actual[key]) && Math.abs(actual[key] - expected[key]) <= 0.75);
  const latest = id => snapshot.receipts.filter(receipt => receipt.resource === id).at(-1);
  const settled = id => !latest(id) || latest(id).status === 'settled';
  if (view.width < 1600 || view.height < 1000) problems.push('reference-window-too-small');
  if (document.hidden || !document.hasFocus()) problems.push('inactive-document');
  if (document.fonts && document.fonts.status !== 'loaded') problems.push('fonts-loading');
  if (snapshot.expanded !== null || document.querySelector('.folio.expanded, dialog[open], .aw-contextual-surface[open], .floating-dialog:not([hidden])')) problems.push('expanded-or-overlay');
  const stage = rect(document.querySelector('#stage'));
  if (!stage || stage.opacity < 0.995 || !settled('application:arrival')) problems.push('workspace-arrival-unsettled');
  const painted = node => {
    if (!node || node.closest('[hidden], [inert]')) return null;
    let opacity = 1;
    for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (style.display === 'none' || style.visibility !== 'visible') return null;
      opacity *= Number(style.opacity);
      if (!Number.isFinite(opacity) || opacity < 0.995) return null;
    }
    const bounds = rect(node); return bounds ? { ...bounds, opacity } : null;
  };
  const intersection = (a, b) => {
    if (!a || !b) return null;
    const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
    return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
  };
  const cards = input.cards.map(expected => {
    const node = document.querySelector('[data-block=' + JSON.stringify(expected.id) + ']'), bounds = rect(node), pose = snapshot.poses[expected.id];
    const compact = node?.querySelector('.aw-block-compact'), content = node?.querySelector('.aw-identity-body');
    const poseMatches = !!pose && ['x', 'y', 'w', 'h', 'lift', 'yaw', 'opacity'].every(key => Number.isFinite(pose[key]) && Math.abs(pose[key] - ({ x: expected.x, y: expected.y, w: expected.width, h: expected.height, lift: 0, yaw: 0, opacity: 1 })[key]) <= 0.1);
    const metadataReady = !!node && node.dataset.blockVariant === expected.variant && node.dataset.resourceAvailability === 'available' && !!compact && compact.getAttribute('aria-busy') === 'false' && !!content?.textContent?.trim();
    const wrapper = painted(node?.querySelector('.working-content'));
    const clip = intersection(wrapper, bounds), withinClip = value => !!value && value.width >= 8 && value.height >= 8;
    const surface = (selector, valid) => {
      const element = node?.querySelector(selector), bounds = painted(element);
      const visibleIntersection = intersection(bounds, clip);
      return { selector, bounds, intersection: visibleIntersection, ready: !!bounds && withinClip(visibleIntersection) && !!valid(element), textCharacters: element?.textContent?.length ?? 0 };
    };
    let visible = { selector: null, bounds: null, intersection: null, ready: false, textCharacters: 0 };
    const composition = node?.dataset.blockComposition;
    if (composition === 'overview') {
      visible = surface('.aw-block-overview-content', element => !!element.textContent?.trim() && (expected.role !== 'stream' || !expected.expectedOverviewEvent || element.textContent.includes(expected.expectedOverviewEvent.type)));
    } else if (composition === 'working') {
      if (expected.role === 'local' || expected.role === 'codex') {
        const provider = node?.querySelector('.cp-composer-provider'), providerBounds = painted(provider);
        visible = surface('.cp-composer textarea', element => element.value === expected.expectedText && !!providerBounds && withinClip(intersection(providerBounds, clip)) && provider.dataset.providerId === expected.providerId);
      } else if (expected.role === 'note') {
        const state = node?.querySelector('.working-content')?.dataset.noteState;
        const editing = surface('textarea', element => element.value === expected.expectedText);
        const reading = surface('.aw-note-reading', element => element.textContent?.includes(expected.expectedText));
        visible = editing.ready ? editing : reading;
        visible.ready &&= ['ready', 'saved', 'recovered'].includes(state);
      } else if (expected.role === 'group') {
        const manage = node?.querySelector('.aw-task-group > button');
        visible = surface('.aw-task-group-summary', element => !!element.textContent?.trim() && !!painted(manage) && !manage.disabled);
      } else if (expected.role === 'stream') {
        const view = node?.querySelector('.aw-event-view'), refresh = node?.querySelector('.aw-event-tools > button'), status = view?.querySelector('[role="status"]');
        const selector = expected.expectedEvent ? '.aw-event-view [data-event-id=' + JSON.stringify(expected.expectedEvent.eventId) + ']' : '.aw-event-view [data-event-id]';
        const record = surface(selector, () => true), empty = surface('.aw-event-empty', element => !expected.expectedEvent && !!element.textContent?.trim());
        visible = record.ready ? record : empty;
        visible.ready &&= !!painted(view) && !!refresh && !refresh.disabled && !!status?.textContent?.trim();
      } else if (expected.role === 'project') {
        const view = node?.querySelector('.aw-subject-view');
        visible = surface('.aw-project-summary', element => element.textContent === expected.expectedText && !!painted(view) && view.getAttribute('aria-busy') !== 'true');
      }
    }
    const ready = metadataReady && !!wrapper && wrapper.opacity >= 0.995 && visible.ready;
    if (!fits(expected) || !fits(bounds)) problems.push(expected.role + ':clipped');
    if (!near(bounds, expected) || bounds.opacity < 0.995 || !poseMatches || !settled(expected.id)) problems.push(expected.role + ':unsettled');
    if (!ready) problems.push(expected.role + ':content-not-ready');
    return { role: expected.role, id: expected.id, projected: expected, rendered: bounds, pose, transition: latest(expected.id) ?? null, contentReady: ready, metadataReady, workingClip: clip, visibleSurface: visible, composition: composition ?? null };
  });
  const vela = rect(document.querySelector('#vela'));
  if (!fits(input.vela) || !fits(vela)) problems.push('vela:clipped');
  if (!near(vela, input.vela) || vela.opacity < 0.995 || !settled('application:vela-presence')) problems.push('vela:unsettled');
  for (const card of cards) if (card.rendered && vela) {
    const bounds = card.rendered;
    if (bounds.x < vela.x + vela.width && bounds.x + bounds.width > vela.x && bounds.y < vela.y + vela.height && bounds.y + bounds.height > vela.y) problems.push(card.role + ':overlaps-vela');
  }
  return { ready: problems.length === 0, problems, view, usable, footers, headers, stage, arrival: latest('application:arrival') ?? null, cards, vela, normalSixCardState: snapshot.expanded === null, proportions: 'normalized 400x340 surfaces; default proportions and tall Chat are not qualified' };
}
const expressions = {
  noteSavedIs: (id, content) => `window.aerynthHost.command('notes',${q({ name: 'readNote', input: id })}).then(r=>!r.result.draft&&r.result.resource.content===${q(content)})`,
  groupHas: (groupId, taskId) => `window.__aerynth.application().resources.find(r=>r.id===${q(groupId)})?.taskMembers?.some(t=>t.id===${q(taskId)})===true`,
  eventMetadata: (selector) => `(()=>{const row=document.querySelector(${q(selector)});if(!row)return null;const dt=[...row.querySelectorAll('dt')],dd=[...row.querySelectorAll('dd')];return Object.fromEntries(dt.map((e,i)=>[e.textContent,dd[i]?.textContent]))})()`,
  projectSummary: selector => `document.querySelector(${q(selector + ' .aw-project-summary')})?.textContent`,
  composerProvider: selector => `(()=>{const e=document.querySelector(${q(selector + ' .cp-composer-provider')});return e?{id:e.dataset.providerId,label:e.textContent}:null})()`,
  comparisonProbe: input => `(${measureComparison.toString()})(${q(input)})`,
  comparisonReady: input => `(${measureComparison.toString()})(${q(input)}).ready`,
};
exports.expressions = Object.freeze({ ...common, ...expressions });
exports.preflight = () => {
  const common = commonPreflight(), id = 'quote"\n', selector = '[data-block="quote\\\"id"]';
  const comparison = { cards: [{ id, role: 'quoted"\n', variant: 'document', x: 81, y: 198, width: 360, height: 306 }], vela: { x: 1296, y: 207, width: 187.2, height: 234 } };
  const inputs = { noteSavedIs: [[id, 'canonical"\n']], groupHas: [[id, 'task"\n']], eventMetadata: [[selector]], projectSummary: [[selector]], composerProvider: [[selector]], comparisonProbe: [[comparison]], comparisonReady: [[comparison]] };
  const names = Object.keys(expressions).sort();
  if (JSON.stringify(names) !== JSON.stringify(Object.keys(inputs).sort())) throw Error('uncovered_functional_expression');
  const compiled = [];
  for (const name of names) for (const args of inputs[name]) { const source = expressions[name](...args); compileExpression(source); compiled.push([name, source]); }
  return { common, factories: names.length, cases: compiled.length, names, sha256: createHash('sha256').update(JSON.stringify({ common, compiled })).digest('hex') };
};
