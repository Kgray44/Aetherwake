import test from 'node:test';
import assert from 'node:assert/strict';
import { blockDocument } from '../../../block-library/tests/component-dom.mts';
import { until } from '../../../conversation-product/test/component-dom.mts';
import { createVelaVoiceView } from '../src/vela-voice-view.ts';
const snapshot = () => ({ available: true, session: { state: 'idle' }, media: null,
  settings: { version: 0, speechPersonality: 'Brief and warm.', selectedVoice: null, candidates: [] }, captions: [],
  usage: { enabled: true, maximumVoiceSeconds: 300, initializationExposureSeconds: 15 } });
function harness(command) {
  const dom = blockDocument(); dom.doc.addEventListener = () => {}; dom.doc.removeEventListener = () => {};
  const view = createVelaVoiceView(dom.doc, command); dom.root.append(view.element);
  const button = text => dom.root.querySelectorAll('button').find(node => node.textContent === text);
  return { dom, view, button };
}
test('voice view stays passive, hides without stopping media, preserves unsaved style during polling', async () => {
  const calls = [], value = snapshot(); const { dom, view } = harness(async request => { calls.push(request); return value; });
  try {
    assert.equal(calls.length, 0); view.setVisible(true); await until(() => dom.root.textContent.includes('Voice is off.'));
    await new Promise(resolve => setImmediate(resolve));
    const style = dom.root.querySelector('textarea'); style.value = 'My unsaved style'; style.fire('input'); style.selectionStart = 5;
    value.settings.version = 1; value.settings.speechPersonality = 'Changed elsewhere';
    view.setVisible(true); await new Promise(resolve => setImmediate(resolve));
    assert.equal(style.value, 'My unsaved style'); assert.equal(style.selectionStart, 5);
    view.setVisible(false); assert.ok(calls.every(request => request.name === 'state'));
  } finally { view.dispose(); }
});
test('voice save binds the displayed version and uses the default voice explicitly', async () => {
  const calls = [], value = snapshot(); const { dom, view, button } = harness(async request => { calls.push(request); return value; });
  try {
    view.setVisible(true); await until(() => !button('Save voice').disabled);
    const style = dom.root.querySelector('textarea'); style.value = 'Calm and concise'; style.fire('input');
    button('Save voice').fire('click'); await until(() => calls.some(request => request.name === 'saveVoice'));
    assert.deepEqual(calls.find(request => request.name === 'saveVoice'), { name: 'saveVoice', input: { voiceId: null, expectedSettingsVersion: 0, speechPersonality: 'Calm and concise' } });
  } finally { view.dispose(); }
});
test('typed voice start forwards its exact intent synchronously and never reports an unconfirmed start as success', async () => {
  const calls = [], value = snapshot(); const { view, dom } = harness(async request => { calls.push(request); return { ...value, session: { state: 'failed' } }; });
  try {
    const pending = view.start('Let’s talk instead');
    assert.deepEqual(calls[0], { name: 'start', input: { intent: 'Let’s talk instead' } });
    await assert.rejects(pending, /live_start_unconfirmed/);
    assert.ok(dom.root.textContent.includes('conversation is saved'));
  } finally { view.dispose(); }
});
test('raw provider errors never appear in the voice surface', async () => {
  const { view, dom } = harness(async () => { throw new Error('PRIVATE_KEY_MARKER'); });
  try { await assert.rejects(view.start()); assert.equal(dom.root.textContent.includes('PRIVATE_KEY_MARKER'), false); }
  finally { view.dispose(); }
});
