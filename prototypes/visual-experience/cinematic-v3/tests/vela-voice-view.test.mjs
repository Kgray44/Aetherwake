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
test('voice save binds the displayed version and uses the discovered Vela 3 ID explicitly', async () => {
  const calls = [], value = snapshot(); const { dom, view, button } = harness(async request => { calls.push(request); return value; });
  value.settings.selectedVoice={id:'voice-three',name:'Vela 3'};value.settings.candidates=[value.settings.selectedVoice,{id:'voice-two',name:'Vela 2'}];
  try {
    view.setVisible(true); await until(() => !button('Save voice').disabled);
    const style = dom.root.querySelector('textarea'); style.value = 'Calm and concise'; style.fire('input');
    button('Save voice').fire('click'); await until(() => calls.some(request => request.name === 'saveVoice'));
    assert.deepEqual(calls.find(request => request.name === 'saveVoice'), { name: 'saveVoice', input: { voiceId: 'voice-three', expectedSettingsVersion: 0, speechPersonality: 'Calm and concise' } });
  } finally { view.dispose(); }
});

test('voice settings offer only Vela 3 and Vela 2 and refresh explicitly when opened, never during passive state reads',async()=>{
 const calls=[],value=snapshot();value.settings.selectedVoice={id:'voice-three',name:'Vela 3'};value.settings.candidates=[value.settings.selectedVoice,{id:'voice-two',name:'Vela 2'},{id:'unrelated',name:'UNRELATED_VOICE_MUST_NOT_SURFACE'}];const{dom,view}=harness(async request=>{calls.push(request);return value;});
 try{view.setVisible(true);await new Promise(resolve=>setImmediate(resolve));const select=dom.root.querySelector('select');assert.deepEqual([...select.options].map(option=>option.textContent),['Vela 3','Vela 2']);assert.equal(calls.filter(request=>request.name==='refreshVoices').length,0);const details=dom.root.querySelector('details');details.open=true;details.fire('toggle');await until(()=>calls.some(request=>request.name==='refreshVoices'));assert.equal(calls.filter(request=>request.name==='refreshVoices').length,1);view.setVisible(true);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.filter(request=>request.name==='refreshVoices').length,1);assert(!dom.root.textContent.includes('UNRELATED_VOICE_MUST_NOT_SURFACE'));}finally{view.dispose();}
});

test('saving Vela 2 while voice is running applies to the next session and dispatches no start, reconnect or audition',async()=>{
 const calls=[],value=snapshot();value.session={state:'running',sessionId:'existing-session'};value.settings.selectedVoice={id:'voice-three',name:'Vela 3'};value.settings.candidates=[value.settings.selectedVoice,{id:'voice-two',name:'Vela 2'}];const{dom,view,button}=harness(async request=>{calls.push(request);if(request.name==='saveVoice'){value.settings.selectedVoice=value.settings.candidates[1];value.settings.version++;}return value;});
 try{view.setVisible(true);await new Promise(resolve=>setImmediate(resolve));const select=dom.root.querySelector('select');select.value='voice-two';select.fire('change');assert.equal(button('Save voice').disabled,false);button('Save voice').fire('click');await until(()=>calls.some(request=>request.name==='saveVoice'));assert.equal(calls.find(request=>request.name==='saveVoice').input.voiceId,'voice-two');assert(!calls.some(request=>['start','reconnect','audition'].includes(request.name)));assert(dom.root.textContent.includes('next session'));}finally{view.dispose();}
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
