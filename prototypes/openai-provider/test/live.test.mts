import test from 'node:test';
import assert from 'node:assert/strict';
import { GptLiveController, LIVE_ENDPOINT, PROMPT_VOICE_ENDPOINT, WAKE_GREETING_INSTRUCTIONS, type GptLiveOptions } from '../live.mts';
import type { CanonicalVelaRuntimePort, LiveCanonicalContext, LiveClientCommand, LiveDelegationBinding, LiveNativeReview, LiveSessionView, LiveStartInput, LiveTranscriptFragment, SavedPromptVoice } from '../live-contracts.mts';
import { digest } from '../common.mts';

const credentialMarker = 'sk-SYNTHETIC_LIVE_API_SECRET_123';
const sdpOffer = 'v=0\r\no=SYNTHETIC_PRIVATE_OFFER\r\n';
const sdpAnswer = 'v=0\r\no=SYNTHETIC_PRIVATE_ANSWER\r\n';
const boundary = 'a'.repeat(64);
function startInput(attemptId = 'live-attempt-1'): LiveStartInput { return { attemptId, configurationId: 'vela-api', configurationVersion: 3, conversationId: 'canonical-vela', sdpOffer, authorizationRef: 'native-paid-start', budget: { ref: 'native-spend-reservation', maximumVoiceSeconds: 30, initializationExposureSeconds: 15 }, voice: { id: 'voice-selected', description: 'A warm adult voice.' } }; }
function context(): LiveCanonicalContext { return { conversationId: 'canonical-vela', contextRef: 'canonical-context-1', contextDigest: 'b'.repeat(64), identity: { id: 'system:vela', version: 'vela-identity@1', instructions: 'You are Vela, the same persistent application assistant.' }, history: [{ role: 'user', content: 'We were discussing timer-1.' }, { role: 'assistant', content: 'The task remains active.' }], operationRefs: ['canonical-task-1', 'timer-1'], backendCapabilities: ['Read and control native timers through canonical tools.'], speechPersonality: 'Be concise, warm and natural.' }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function fixture(overrides: Partial<GptLiveOptions> = {}) {
  const reviews: LiveNativeReview[] = [], requests: { url: string; init?: RequestInit }[] = [], commands: LiveClientCommand[] = [], fragments: LiveTranscriptFragment[] = [], bindings: LiveDelegationBinding[] = [], candidates: SavedPromptVoice[] = [], selections: unknown[] = [], snapshots: LiveSessionView[] = [], claims = new Map<string, 'claimed' | 'unknown'>();
  let peer: Parameters<GptLiveOptions['media']['connect']>[0] | undefined, sessionSequence = 0, delegateCalls = 0, channelCloses = 0;
  const runtime: CanonicalVelaRuntimePort = {
    context: async () => context(), validateContext: async () => {}, receiveFragment: async fragment => { fragments.push(fragment); },
    claimDelegation: async binding => { bindings.push(binding); const key = binding.sessionId + ':' + binding.delegationId; if (claims.has(key)) return claims.get(key) === 'unknown' ? 'unknown' : 'duplicate'; claims.set(key, 'claimed'); return 'claimed'; },
    delegate: async () => { delegateCalls++; return { state: 'verified', content: 'The timer is paused.', receiptRef: 'canonical-verified-receipt' }; },
    reconcile: async () => ({ state: 'reconciled', reconciliationRef: 'canonical-reconciliation' }), recordVoiceCandidate: async voice => { candidates.push(voice); },
    saveVoiceSelection: async value => { selections.push(value); return { settingsVersion: value.expectedSettingsVersion + 1 }; },
  };
  const options: GptLiveOptions = {
    native: { authorize: async review => { reviews.push(structuredClone(review)); }, resolveCredential: async (id, version) => { assert.equal(id, 'vela-api'); assert.equal(version, 3); return { providerId: 'openai-api-vela', kind: 'openai-api-key', bearer: credentialMarker, boundaryDigest: boundary, project: 'proj-synthetic' }; }, revalidate: async () => {} },
    runtime,
    fetch: async (url, init) => { requests.push({ url: String(url), init }); if (String(url) === LIVE_ENDPOINT) return Response.json({ session: { id: 'live-synthetic-' + ++sessionSequence }, transport: { type: 'webrtc', sdp: sdpAnswer } }, { status: 201 }); const body = JSON.parse(String(init?.body)); return Response.json({ object: 'audio.voice', id: 'voice-created-' + ++sessionSequence, type: 'prompt', name: body.name, prompt: body.prompt, created_at: 1000 }); },
    media: { connect: async value => { peer = value; return { send: async command => { commands.push(command); const type = command.type === 'session.close' ? 'session.closed' : command.type === 'session.input_audio.mute' ? 'session.input_audio.muted' : command.type === 'session.input_audio.unmute' ? 'session.input_audio.unmuted' : command.type === 'session.commentary.append' ? 'session.commentary.appended' : 'session.thinking.appended'; await value.onEvent(command.type === 'session.close' ? { type, event_id: 'close-' + command.event_id, session: { id: value.sessionId }, usage: { seconds: 10 } } : { type, event_id: 'ack-' + command.event_id, client_event_id: command.event_id }); }, close: async () => { channelCloses++; } }; } },
    limits: { timeoutMs: 100, acknowledgementMs: 50 }, onState: value => { snapshots.push(value); }, ...overrides,
  };
  const controller = new GptLiveController(options);
  return { controller, options, runtime, reviews, requests, commands, fragments, bindings, candidates, selections, snapshots, claims, get peer() { return peer!; }, get delegateCalls() { return delegateCalls; }, get channelCloses() { return channelCloses; }, started: async () => { const view = await controller.start(startInput()); await controller.receive(view.sessionId!, { type: 'session.started', event_id: 'started-' + view.sessionId, session: { id: view.sessionId } }); return controller.state(); } };
}

test('offline lifecycle journal failures before a paid dispatch fail closed without claiming exposure',async()=>{
  for(const fail of [()=>true,(view:LiveSessionView)=>view.dispatched]){
    const f=fixture({onState:view=>{if(fail(view))throw Error('SYNTHETIC_JOURNAL_DISK_FAILURE');}});
    try{const state=await f.controller.start(startInput());assert.equal(state.state,'failed');assert.equal(state.dispatched,false);assert.equal(state.initializationExposureSeconds,0);assert.equal(state.errorCode,'live_state_journal_unavailable');assert.equal(f.requests.length,0);}
    finally{await f.controller.dispose();}
  }
});

test('offline stop and disposal release peers after journal failure while preserving actual acknowledgment truth',async()=>{
  let fail=false;const f=fixture({onState:()=>{if(fail)throw Error('SYNTHETIC_JOURNAL_DISK_FAILURE');}});
  try{await f.started();fail=true;const state=await f.controller.stop();assert.equal(f.channelCloses,1);assert.equal(state.state,'closed');assert.equal(state.finalization,'confirmed');assert.equal(state.usage.final,true);assert.equal(state.errorCode,'live_state_journal_unavailable');assert.equal(f.requests.length,1);}
  finally{await f.controller.dispose();}
  fail=false;const unconfirmed=fixture({onState:()=>{if(fail)throw Error('SYNTHETIC_JOURNAL_DISK_FAILURE');}});
  try{await unconfirmed.started();fail=true;await unconfirmed.controller.dispose();assert.equal(unconfirmed.channelCloses,1);assert.equal(unconfirmed.controller.state().state,'unknown');assert.equal(unconfirmed.controller.state().finalization,'unconfirmed');assert.equal(unconfirmed.controller.state().errorCode,'live_state_journal_unavailable');}
  finally{await unconfirmed.controller.dispose();}
});

test('offline automatic voice budget teardown closes the peer even when the lifecycle journal fails',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let fail=false;
  const f=fixture({onState:()=>{if(fail)throw Error('SYNTHETIC_JOURNAL_DISK_FAILURE');}});
  try{await f.started();fail=true;t.mock.timers.tick(30000);await new Promise(resolve=>setImmediate(resolve));await f.controller.settled();
    assert.equal(f.channelCloses,1);assert.equal(f.controller.state().state,'closed');assert.equal(f.controller.state().finalization,'confirmed');assert.equal(f.controller.state().errorCode,'live_state_journal_unavailable');assert.equal(f.requests.length,1);
  }finally{await f.controller.dispose();t.mock.timers.reset();}
});

test('offline GPT-Live exact WebRTC/client delegation wire, explicit initial exposure, canonical identity and SDP/key boundaries', async () => {
  const f = fixture();
  try {
    const view = await f.controller.start(startInput()); assert.equal(view.state, 'awaiting-start'); assert.equal(view.initializationExposureSeconds, 15); assert.equal(view.dispatched, true); assert.equal(view.audioPlayback, 'unverified');
    const request = f.requests[0], body = JSON.parse(String(request.init?.body));
    assert.equal(request.url, LIVE_ENDPOINT); assert.equal(request.init?.method, 'POST'); assert.equal(request.init?.redirect, 'error'); assert.equal(new Headers(request.init?.headers).get('authorization'), 'Bearer ' + credentialMarker); assert.equal(new Headers(request.init?.headers).get('OpenAI-Project'), 'proj-synthetic');
    assert.equal(body.session.model, 'gpt-live-1'); assert.deepEqual(body.session.delegation, { type: 'client' }); assert.equal(body.session.store, false); assert.equal('format' in (body.session.audio ?? {}), false); assert.deepEqual(body.session.audio.output.voice, { id: 'voice-selected' });
    assert.equal(body.transport.type, 'webrtc'); assert.equal(body.transport.sdp, sdpOffer); assert.equal(f.peer.sdpAnswer, sdpAnswer); assert.equal('bearer' in f.peer, false);
    assert.ok(body.session.instructions.includes('same persistent application assistant')); assert.ok(body.session.instructions.includes('Generate <|SpawnThinking|>')); assert.ok(body.session.instructions.includes('Backchannel policy:')); assert.equal(body.session.input[1].content[0].type, 'output_text');
    assert.equal(f.reviews[0].bodyDigest, digest(String(request.init?.body))); assert.equal(f.reviews[0].contextDigest, context().contextDigest); assert.equal(f.reviews[0].budget!.initializationExposureSeconds, 15); assert.equal(f.reviews[0].paidSession, true);
    assert.ok(!JSON.stringify(f.reviews).includes(sdpOffer)); assert.ok(!JSON.stringify(f.snapshots).includes('SYNTHETIC_PRIVATE')); assert.ok(!JSON.stringify(f.snapshots).includes(credentialMarker)); assert.equal(f.commands.some(command => (command as any).type === 'session.start'), false);
    await f.controller.receive(view.sessionId!, { type: 'session.started', event_id: 'started', session: { id: view.sessionId } }); assert.equal(f.controller.state().state, 'running');
    const final = await f.controller.stop(); assert.equal(final.finalization, 'confirmed'); assert.equal(final.usage.final, true); assert.equal(final.usage.seconds, 10); assert.equal(final.audioPlayback, 'unverified');
  } finally { await f.controller.dispose(); }
});

test('offline paid grant, API credential/configuration, context identity and post-request revocation fail closed without retries', async () => {
  const f = fixture();
  try {
    const input = startInput(); (input.budget as any).initializationExposureSeconds = 0; await assert.rejects(f.controller.start(input), /live_paid_start_review_required/); assert.equal(f.requests.length, 0);
    f.options.native.authorize = async () => { throw Error(credentialMarker + ' raw denial'); };
    const denied = await f.controller.start(startInput()); assert.equal(denied.dispatched, false); assert.equal(denied.state, 'failed'); assert.ok(!JSON.stringify(denied).includes(credentialMarker));
    f.options.native.authorize = async () => {}; f.options.runtime.context = async () => ({ ...context(), conversationId: 'unrelated-assistant' });
    assert.equal((await f.controller.start(startInput('bad-context'))).dispatched, false); assert.equal(f.requests.length, 0);
    f.options.runtime.context = async () => context(); f.options.native.resolveCredential = async () => ({ providerId: 'chatgpt-plan-responses', kind: 'chatgpt-plan', bearer: credentialMarker, boundaryDigest: boundary });
    assert.equal((await f.controller.start(startInput('wrong-billing'))).dispatched, false);
  } finally { await f.controller.dispose(); }
  const revoked = fixture(); let fences = 0; revoked.options.native.revalidate = async () => { if (++fences === 2) throw Error(credentialMarker); };
  try { const view = await revoked.controller.start(startInput()); assert.equal(view.state, 'unknown'); assert.equal(view.dispatched, true); assert.equal(view.finalization, 'unconfirmed'); assert.equal(revoked.requests.length, 1); assert.equal(view.sessionId, 'live-synthetic-1'); assert.ok(!JSON.stringify(view).includes(credentialMarker)); }
  finally { await revoked.controller.dispose(); }
});

test('offline transcript fragments retain timestamps/spaces and canonical dedupe without invented turn completion or playback', async () => {
  const f = fixture();
  try {
    await f.started(); const sessionId = f.controller.state().sessionId!;
    const fragment = { type: 'session.input_transcript.delta', event_id: 'fragment-1', delta: 'Pause ', start_ms: 100, end_ms: 150 };
    await f.controller.receive(sessionId, fragment); await f.controller.receive(sessionId, fragment);
    await f.controller.receive(sessionId, { type: 'session.output_transcript.delta', event_id: 'fragment-2', delta: 'Sure', start_ms: 120, end_ms: 160 });
    await f.controller.receive(sessionId, { type: 'session.input_transcript.delta', event_id: 'fragment-3', delta: 'the timer', start_ms: 150, end_ms: 250 });
    assert.equal(f.fragments.length, 3); assert.equal(f.fragments[0].delta, 'Pause '); assert.equal(f.fragments[2].delta, 'the timer'); assert.equal(f.fragments[0].conversationId, 'canonical-vela'); assert.equal(f.fragments[0].completedTurn, false); assert.equal(f.fragments[1].playback, 'unverified'); assert.equal(f.controller.state().transcriptFragments, 3);
    await assert.rejects(f.controller.receive('other-session', fragment), /live_invalid_event/);
    await assert.rejects(f.controller.receive(sessionId, { ...fragment, event_id: 'negative', start_ms: -1 }), /live_invalid_transcript/);
    await f.controller.stop();
  } finally { await f.controller.dispose(); }
});

test('offline mute/unmute require matching provider acknowledgments and append acceptance never claims audible speech', async () => {
  const f = fixture();
  try {
    await f.started(); assert.equal((await f.controller.mute(true)).inputMute, 'muted'); assert.equal((await f.controller.mute(false)).inputMute, 'unmuted');
    await f.controller.append('A short verified update.', true); assert.equal(f.controller.state().lastAppend, 'accepted'); assert.equal(f.controller.state().audioPlayback, 'unverified');
    await f.controller.append('The canonical task remains running.', false);
    assert.equal(f.commands.at(-1)!.type, 'session.thinking.append'); assert.equal(f.commands.at(-2)!.type, 'session.commentary.append');
    await assert.rejects(f.controller.append('x'.repeat(501), true), /live_append_capacity/); await assert.rejects(f.controller.append('x', true, 'unrecognized-delegation'), /live_unknown_delegation/);
    await f.controller.stop();
  } finally { await f.controller.dispose(); }
});

test('offline delegation derives intent from canonical context, durably claims once and distinguishes verified results from unknown work', async () => {
  const f = fixture();
  try {
    await f.started(); const sessionId = f.controller.state().sessionId!;
    await f.controller.receive(sessionId, { type: 'session.input_transcript.delta', event_id: 'intent-fragment', delta: 'Pause timer-1.', start_ms: 0, end_ms: 800 });
    const event = { type: 'session.delegation.created', event_id: 'delegation-event', offset_ms: 800, delegation: { id: 'delegation-1', type: 'delegation', target: 'client', task: 'INJECTED_EVENT_TASK_MUST_NOT_DISPATCH' } };
    await f.controller.receive(sessionId, event); await f.controller.receive(sessionId, { ...event, event_id: 'duplicate-event' }); await f.controller.settled();
    assert.equal(f.delegateCalls, 1); assert.equal(f.bindings.length, 1); assert.equal(f.bindings[0].contextRef, 'canonical-context-1'); assert.equal(f.bindings[0].configurationVersion, 3); assert.equal(JSON.stringify(f.bindings).includes('INJECTED_EVENT_TASK'), false);
    assert.equal(f.commands.filter(command => command.type === 'session.commentary.append').length, 1); assert.equal((f.commands.at(-1) as any).delegation_id, 'delegation-1'); assert.equal(f.controller.state().backend, 'idle');
    assert.equal(f.reviews.find(review => review.operation === 'append')!.verificationRef, 'canonical-verified-receipt');
    f.runtime.delegate = async () => { throw Error('unknown external outcome ' + credentialMarker); };
    await f.controller.receive(sessionId, { ...event, event_id: 'unknown-work', delegation: { id: 'delegation-2', target: 'client' } }); await f.controller.settled();
    await f.controller.receive(sessionId, { ...event, event_id: 'unknown-replay', delegation: { id: 'delegation-2', target: 'client' } }); await f.controller.settled();
    assert.equal(f.bindings.length, 2); assert.equal(f.controller.state().backend, 'unknown'); assert.ok(!JSON.stringify(f.snapshots).includes(credentialMarker));
    f.runtime.claimDelegation = async () => 'unknown'; f.runtime.delegate = async () => { assert.fail('Unknown durable claim must not execute'); };
    await f.controller.receive(sessionId, { ...event, event_id: 'durable-unknown', delegation: { id: 'delegation-3', target: 'client' } }); await f.controller.settled();
    await f.controller.stop();
  } finally { await f.controller.dispose(); }
});

test('offline full duplex fragments and voice closure do not automatically cancel or replay canonical backend work', async () => {
  const f = fixture(), entered = deferred<void>(), completed = deferred<{ state: 'verified'; content: string; receiptRef: string }>(); let backendSignal: AbortSignal | undefined;
  f.runtime.delegate = async input => { backendSignal = input.signal; entered.resolve(); return completed.promise; };
  try {
    await f.started(); const sessionId = f.controller.state().sessionId!;
    await f.controller.receive(sessionId, { type: 'session.delegation.created', event_id: 'long-task', offset_ms: 1, delegation: { id: 'long-task-id', target: 'client' } }); await entered.promise;
    await f.controller.receive(sessionId, { type: 'session.input_transcript.delta', event_id: 'barge-in-fragment', delta: 'One more detail.', start_ms: 2, end_ms: 3 });
    assert.equal(f.fragments.length, 1); assert.equal(backendSignal!.aborted, false);
    await f.controller.stop(); assert.equal(backendSignal!.aborted, false);
    completed.resolve({ state: 'verified', content: 'The operation completed.', receiptRef: 'verified-late' }); await f.controller.settled();
    assert.equal(f.commands.some(command => command.type === 'session.commentary.append'), false); assert.equal(f.bindings.length, 1); assert.equal(f.controller.state().state, 'closed');
  } finally { completed.resolve({ state: 'verified', content: 'Done.', receiptRef: 'verified-late' }); await f.controller.dispose(); }
});

test('offline active configuration revocation denies delegation before durable claim and backend execution', async () => {
  const f = fixture();
  try {
    await f.started(); f.options.native.revalidate = async () => { throw Error(credentialMarker); };
    await f.controller.receive(f.controller.state().sessionId!, { type: 'session.delegation.created', event_id: 'revoked-task', offset_ms: 1, delegation: { id: 'revoked-delegation', target: 'client' } }); await f.controller.settled();
    assert.equal(f.bindings.length, 0); assert.equal(f.delegateCalls, 0); assert.equal(f.controller.state().backend, 'unknown'); assert.equal(f.commands.length, 0);
    await f.controller.stop();
  } finally { await f.controller.dispose(); }
});

test('offline voice usage is cumulative provider-reported seconds and never becomes inferred backend billing or playback', async () => {
  const f = fixture();
  try {
    await f.started(); const sessionId = f.controller.state().sessionId!;
    await f.controller.receive(sessionId, { type: 'session.usage.updated', event_id: 'usage-2', usage: { seconds: 2 } });
    await f.controller.receive(sessionId, { type: 'session.usage.updated', event_id: 'usage-3', usage: { seconds: 3.5 } });
    assert.deepEqual(f.controller.state().usage, { seconds: 3.5, source: 'provider-reported', final: false });
    await assert.rejects(f.controller.receive(sessionId, { type: 'session.usage.updated', event_id: 'usage-invalid', usage: { seconds: 1 } }), /live_invalid_usage/);
    await f.controller.receive(sessionId, { type: 'unsupported.turn.completed', event_id: 'not-a-turn-event' }); assert.equal(f.controller.state().transcriptFragments, 0);
    const stopped = await f.controller.stop(); assert.equal(stopped.usage.seconds, 10); assert.equal(stopped.usage.final, true); assert.equal(stopped.audioPlayback, 'unverified'); assert.equal('backendTokens' in stopped.usage, false);
  } finally { await f.controller.dispose(); }
});

test('offline reconnect creates a new Live session only after canonical reconciliation and preserves identity/history/task continuity', async () => {
  const f = fixture(); let reconciles = 0;
  try {
    await f.started(); const oldSession = f.controller.state().sessionId!; f.controller.connectionLost(oldSession);
    await assert.rejects(f.controller.start(startInput('blind-restart')), /live_reconnect_required/);
    f.runtime.reconcile = async input => { reconciles++; assert.equal(input.conversationId, 'canonical-vela'); assert.equal(input.previousSessionId, oldSession); return { state: 'unknown' }; };
    await assert.rejects(f.controller.reconnect(startInput('blocked-reconnect')), /live_reconciliation_required/); assert.equal(f.requests.length, 1);
    f.runtime.reconcile = async () => { reconciles++; return { state: 'reconciled', reconciliationRef: 'canonical-reconciled-1' }; };
    const next = await f.controller.reconnect(startInput('new-authorized-session')); assert.notEqual(next.sessionId, oldSession); assert.equal(next.state, 'awaiting-start'); assert.equal(next.conversationId, 'canonical-vela'); assert.equal(reconciles, 2); assert.equal(f.reviews.at(-1)!.operation, 'reconnect'); assert.equal(f.reviews.at(-1)!.reconciliationRef, 'canonical-reconciled-1');
    const body = JSON.parse(String(f.requests[1].init?.body)); assert.equal(body.session.input[0].content[0].text, 'We were discussing timer-1.'); assert.equal(body.session.input[1].content[0].text, 'The task remains active.');
    await assert.rejects(f.controller.receive(oldSession, { type: 'session.closed', usage: { seconds: 999 } }), /live_invalid_event/);
    await f.controller.receive(next.sessionId!, { type: 'session.started', event_id: 'next-start', session: { id: next.sessionId } }); await f.controller.stop();
  } finally { await f.controller.dispose(); }
});

test('wake greeting uses native Live generation after the real start event, without a separate reasoning request or a playback claim', async () => {
  const f = fixture();
  try {
    const view = await f.controller.start({ ...startInput(), wake: { greeting: 'dynamic', pronunciation: 'VAY-luh' } });
    assert.equal(f.requests.length, 1); assert.equal(f.commands.length, 0);
    const body = JSON.parse(String(f.requests[0].init?.body));
    assert.ok(body.session.input.some((item:any) => item.role === 'developer' && item.content[0].text === WAKE_GREETING_INSTRUCTIONS));
    assert.ok(Buffer.byteLength(WAKE_GREETING_INSTRUCTIONS) <= 500);
    await f.controller.receive(view.sessionId!, { type: 'session.started', event_id: 'wake-started', session: { id: view.sessionId } });
    await f.controller.settled();
    assert.equal(f.requests.length, 1); assert.equal(f.commands.length, 1);
    assert.equal(f.commands[0].type, 'session.commentary.append'); assert.equal((f.commands[0] as any).content, WAKE_GREETING_INSTRUCTIONS);
    assert.equal(f.controller.state().lastAppend, 'accepted'); assert.equal(f.controller.state().audioPlayback, 'unverified');
    await f.controller.stop();
  } finally { await f.controller.dispose(); }
});
test('wake-plus-command omits the greeting and rejects unsupported native wake metadata before dispatch', async () => {
  const f = fixture();
  try {
    await assert.rejects(f.controller.start({ ...startInput(), wake: { greeting: 'rotate-static-phrases', pronunciation: 'VAY-luh' } } as any), /live_invalid_wake/);
    assert.equal(f.requests.length, 0);
    const view = await f.controller.start({ ...startInput(), wake: { greeting: 'none', pronunciation: 'VAY-luh' } });
    await f.controller.receive(view.sessionId!, { type: 'session.started', event_id: 'wake-command-started', session: { id: view.sessionId } });
    await f.controller.settled(); assert.equal(f.commands.length, 0); assert.equal(f.requests.length, 1);
    const body = JSON.parse(String(f.requests[0].init?.body)); assert.match(body.session.input.at(-1).content[0].text, /Do not add an opening greeting/);
    await f.controller.stop();
  } finally { await f.controller.dispose(); }
});
test('offline prompt voice creation returns metadata only, records candidate, and saves selection without starting audio or changing active voice', async () => {
  const f = fixture();
  try {
    const result = await f.controller.createPromptVoice({ attemptId: 'voice-design-1', configurationId: 'vela-api', configurationVersion: 3, authorizationRef: 'native-voice-design', name: 'Vela warm', prompt: 'An adult warm English voice.', scriptHint: 'Welcome back. What shall we work on?' });
    assert.equal(result.state, 'created'); assert.equal(result.audioPreview, false); assert.equal(result.selected, false); assert.equal(result.savedLocally, true); assert.equal(f.requests[0].url, PROMPT_VOICE_ENDPOINT);
    assert.deepEqual(JSON.parse(String(f.requests[0].init?.body)), { type: 'prompt', name: 'Vela warm', prompt: 'An adult warm English voice.', model: 'auto', script_hint: 'Welcome back. What shall we work on?' });
    assert.equal(f.reviews[0].paidSession, false); assert.equal(f.candidates.length, 1); assert.equal(f.commands.length, 0); assert.equal(f.controller.state().state, 'idle'); assert.equal('audio' in result, false);
    const saved = await f.controller.saveVoiceSelection({ voice: result.candidate!, expectedSettingsVersion: 4, speechPersonality: 'Warm, concise and natural.', authorizationRef: 'native-save-selection' }); assert.equal(saved.settingsVersion, 5); assert.equal(f.selections.length, 1); assert.equal(f.requests.length, 1);
    await f.started(); const session = f.controller.state().sessionId!;
    await f.controller.saveVoiceSelection({ voice: result.candidate!, expectedSettingsVersion: 5, speechPersonality: 'Gentle and clear.', authorizationRef: 'native-save-selection-2' });
    assert.equal(f.controller.state().sessionId, session); assert.equal(f.commands.some(command => (command as any).type === 'session.update'), false); await f.controller.stop();
  } finally { await f.controller.dispose(); }
});

test('offline audition is a separately authorized paid new session and append acknowledgment does not prove a sample was heard', async () => {
  const f = fixture();
  try {
    const view = await f.controller.audition(startInput('paid-audition'), 'Hello, I am Vela.'); assert.equal(view.state, 'awaiting-start'); assert.equal(f.reviews[0].operation, 'audition'); assert.equal(f.reviews[0].paidSession, true); assert.equal(f.commands.length, 0);
    await f.controller.receive(view.sessionId!, { type: 'session.started', event_id: 'audition-start', session: { id: view.sessionId } }); await f.controller.settled();
    assert.equal(f.commands.length, 1); assert.equal(f.commands[0].type, 'session.commentary.append'); assert.equal(f.controller.state().lastAppend, 'accepted'); assert.equal(f.controller.state().audioPlayback, 'unverified');
    await assert.rejects(f.controller.receive(view.sessionId!, { type: 'session.delegation.created', event_id: 'audition-task', offset_ms: 1, delegation: { id: 'no-task-during-audition', target: 'client' } }), /live_delegation_unavailable/); await f.controller.stop();
  } finally { await f.controller.dispose(); }
});

test('offline dropped start/close and denied command stay uncertain; no automatic network retry, session resurrection or secret diagnostics', async () => {
  const failing = fixture(); failing.options.fetch = async () => { throw Error(credentialMarker + sdpOffer); };
  try { const view = await failing.controller.start(startInput()); assert.equal(view.state, 'unknown'); assert.equal(view.initializationExposureSeconds, 15); assert.ok(!JSON.stringify(view).includes(credentialMarker)); assert.equal(view.audioPlayback, 'unverified'); }
  finally { await failing.controller.dispose(); }
  const f = fixture({ limits: { timeoutMs: 100, acknowledgementMs: 10 } }); let channelInput: Parameters<GptLiveOptions['media']['connect']>[0] | undefined;
  f.options.media.connect = async value => { channelInput = value; return { send: async command => { if (command.type === 'session.input_audio.mute') await value.onEvent({ type: 'session.input_audio.muted', event_id: 'wrong-mute', client_event_id: 'wrong-command' }); }, close: async () => {} }; };
  const keepAlive = setTimeout(() => {}, 200);
  try { const view = await f.controller.start(startInput()); await channelInput!.onEvent({ type: 'session.started', event_id: 'started-manually', session: { id: view.sessionId } }); assert.equal((await f.controller.mute(true)).inputMute, 'unknown'); const stopped = await f.controller.stop(); assert.equal(stopped.state, 'unknown'); assert.equal(stopped.finalization, 'unconfirmed'); assert.equal(stopped.usage.final, false); }
  finally { clearTimeout(keepAlive); await f.controller.dispose(); }
});

test('offline synchronous host failures cannot expose private exception text through append/settings/reconnect', async () => {
  const f = fixture();
  try {
    await f.started(); f.options.native.authorize = () => { throw Error(credentialMarker + sdpAnswer); };
    await assert.rejects(f.controller.append('An update.', true), error => !String(error).includes(credentialMarker) && !String(error).includes('SYNTHETIC_PRIVATE'));
    await assert.rejects(f.controller.saveVoiceSelection({ voice: { configurationId: 'vela-api', configurationVersion: 3, id: 'voice-safe', name: 'Vela', prompt: 'A warm adult voice.', createdAt: 1, type: 'prompt' }, expectedSettingsVersion: 0, speechPersonality: '', authorizationRef: 'selection' }), error => !String(error).includes(credentialMarker));
    f.controller.connectionLost(f.controller.state().sessionId!); f.runtime.reconcile = () => { throw Error(credentialMarker); };
    await assert.rejects(f.controller.reconnect(startInput('sync-failure-reconnect')), error => !String(error).includes(credentialMarker));
  } finally { await f.controller.dispose(); }
});

test('offline provider finalization during media connection cannot resurrect an ended session or retain its channel', async () => {
  let closes = 0;
  const f = fixture({ media: { connect: async input => { await input.onEvent({ type: 'session.closed', event_id: 'early-close', session: { id: input.sessionId }, usage: { seconds: 0 } }); return { send: async () => { assert.fail('Ended session must not receive a command'); }, close: async () => { closes++; } }; } } });
  try { const view = await f.controller.start(startInput()); assert.equal(view.state, 'closed'); assert.equal(view.finalization, 'confirmed'); assert.equal(closes, 1); assert.equal(view.audioPlayback, 'unverified'); }
  finally { await f.controller.dispose(); }
});
