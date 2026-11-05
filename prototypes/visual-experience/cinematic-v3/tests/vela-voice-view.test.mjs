import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
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
test('reply speech hashes exact canonical UTF8 content and forwards only identity; scoped stop and safe presence expose no text',async()=>{
 const calls=[],value=snapshot(),message={id:'canonical-reply',content:'Exact reply — preserved spacing.\nTwo lines.'},contentDigest=createHash('sha256').update(message.content).digest('hex'),{view,dom}=harness(async request=>{calls.push(request);if(request.name==='speak'){value.session={state:'awaiting-start',attemptId:'speech-attempt'};value.speech={state:'starting',messageId:message.id,attemptId:'speech-attempt',contentDigest};}return value;});dom.doc.defaultView={crypto:webcrypto};let presence;const unsubscribe=view.subscribe(value=>{presence=value;});
 try{await view.speak(message);assert.deepEqual(calls[0],{name:'speak',input:{messageId:message.id,contentDigest}});assert.equal(JSON.stringify(calls).includes(message.content),false);assert.deepEqual(presence.speech,{state:'starting',messageId:message.id,attemptId:'speech-attempt',contentDigest});assert.equal(presence.microphoneOn,false);await view.stopSpeech('speech-attempt');assert.deepEqual(calls.at(-1),{name:'stopSpeech',input:{attemptId:'speech-attempt'}});}finally{unsubscribe();view.dispose();}
});
test('speak-replies preference is opt-in and binds the current displayed settings version',async()=>{
 const calls=[],value=snapshot(),{view,dom}=harness(async request=>{calls.push(request);return value;});try{view.setVisible(true);await new Promise(resolve=>setImmediate(resolve));const checkbox=dom.root.querySelectorAll('input').find(node=>node.type==='checkbox');assert.equal(checkbox.checked,false);assert.equal(calls.some(request=>request.name==='setSpeakReplies'),false);checkbox.checked=true;checkbox.fire('change');await until(()=>calls.some(request=>request.name==='setSpeakReplies'));assert.deepEqual(calls.find(request=>request.name==='setSpeakReplies'),{name:'setSpeakReplies',input:{enabled:true,expectedSettingsVersion:0}});}finally{view.dispose();}
});
test('a genuine voice event refreshes a hidden idle view once and exposes automatic reply Stop presence',async()=>{
 const calls=[],value=snapshot(),{view}=harness(async request=>{calls.push(request);return value;});let presence;const unsubscribe=view.subscribe(next=>{presence=next;});try{assert.equal(calls.length,0);view.observe();view.observe();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,1);assert.equal(presence.active,false);
  value.session={state:'running',attemptId:'automatic-speech'};value.media={localTrackEnabled:false,microphoneAccess:'not-requested',playback:'playing',playbackObserved:true};value.speech={state:'speaking',messageId:'new-primary',attemptId:'automatic-speech',contentDigest:'a'.repeat(64)};view.observe();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,2);assert.equal(presence.active,true);assert.equal(presence.microphoneOn,false);assert.equal(presence.speech.attemptId,'automatic-speech');assert.equal(presence.speech.messageId,'new-primary');assert(calls.every(request=>request.name==='state'));
 }finally{unsubscribe();view.dispose();}
});
test('scoped Stop remains available while Speak awaits startup and a late startup result cannot replace the stopped or newer session',async()=>{
 const calls=[],message={id:'pending-primary',content:'A synthetic reply waiting for startup.'},contentDigest=createHash('sha256').update(message.content).digest('hex'),starting={...snapshot(),session:{state:'starting',attemptId:'pending-speech'},speech:{state:'starting',messageId:message.id,attemptId:'pending-speech',contentDigest}},closed={...starting,session:{state:'closed',attemptId:'pending-speech'},speech:{...starting.speech,state:'closed'}};let releaseSpeak,value=starting,presence;
 const {view,dom}=harness(async request=>{calls.push(request);if(request.name==='speak')return new Promise(resolve=>{releaseSpeak=resolve;});if(request.name==='stopSpeech'){value=closed;return closed;}return value;});dom.doc.defaultView={crypto:webcrypto};const unsubscribe=view.subscribe(next=>{presence=next;}),speaking=view.speak(message);
 try{await until(()=>calls.some(request=>request.name==='speak'));view.observe();await until(()=>presence.speech?.attemptId==='pending-speech');assert.equal(presence.speech.state,'starting');await view.stopSpeech('pending-speech');assert.deepEqual(calls.filter(request=>request.name==='stopSpeech'),[{name:'stopSpeech',input:{attemptId:'pending-speech'}}]);assert.equal(presence.speech.state,'closed');
  value={...snapshot(),session:{state:'running',attemptId:'new-manual'},media:{microphoneAccess:'active',localTrackEnabled:true,playback:'idle',playbackObserved:false},speech:{...starting.speech,state:'closed'}};view.observe();await until(()=>presence.microphoneOn===true);releaseSpeak(starting);await speaking;assert.equal(presence.microphoneOn,true);assert.equal(presence.speech.state,'closed');const before=calls.length;await view.stopSpeech('pending-speech');assert.equal(calls.length,before);assert.equal(calls.filter(request=>request.name==='speak').length,1);assert(!calls.some(request=>['start','reconnect','audition'].includes(request.name)));
 }finally{releaseSpeak?.(starting);await speaking.catch(()=>{});unsubscribe();view.dispose();}
});
