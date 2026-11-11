const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mkdirSync, readFileSync, realpathSync } = require('node:fs');
const { join } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const { CHANNEL, createLiveMediaBroker } = require('./live-media-broker.cjs');
const { createProtectedStorageBroker } = require('./protected-storage.cjs');

const scratch = realpathSync(process.argv[2]);
const preloadPath = realpathSync(process.argv[3]);
const flags = process.argv.slice(4);
assert(flags.length === new Set(flags).size && flags.every(flag => ['--software-rendering', '--core'].includes(flag)));
const softwareRendering = flags.includes('--software-rendering');
const checkCore = flags.includes('--core');
const profile = join(scratch, 'electron-profile');
mkdirSync(profile);
// This transport probe has no graphics workload.
if (softwareRendering) app.disableHardwareAcceleration();
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.on('window-all-closed', () => {});

// Executed only in the owned test peer. No ICE server, provider, or microphone.
async function makeAnswer(sdp, sessionId) {
  const peer = new RTCPeerConnection({ iceServers: [] });
  window.fixturePeer = peer;
  const context = new AudioContext();
  window.fixtureAudio = context;
  const silence = context.createMediaStreamDestination().stream;
  peer.addTrack(silence.getAudioTracks()[0], silence);
  peer.addEventListener('datachannel', ({ channel }) => {
    channel.addEventListener('open', () => channel.send(JSON.stringify({
      type: 'session.started', event_id: 'loopback-started', session: { id: sessionId },
    })));
    channel.addEventListener('message', ({ data }) => {
      const command = JSON.parse(data);
      if (command.type === 'session.commentary.append') channel.send(JSON.stringify({
        type: 'session.commentary.appended', event_id: 'loopback-appended', client_event_id: command.event_id,
      }));
      if (command.type === 'session.close') channel.send(JSON.stringify({
        type: 'session.closed', event_id: 'loopback-closed', session: { id: sessionId }, usage: { seconds: 0 },
      }));
    });
  });
  await peer.setRemoteDescription({ type: 'offer', sdp });
  await peer.setLocalDescription(await peer.createAnswer());
  if (peer.iceGatheringState !== 'complete') await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('loopback ICE timeout')), 8000);
    peer.addEventListener('icegatheringstatechange', () => {
      if (peer.iceGatheringState !== 'complete') return;
      clearTimeout(timeout);
      resolve();
    });
  });
  return peer.localDescription.sdp;
}

async function waitForEvent(events, type) {
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    const event = events.find(item => item.type === type);
    if (event) return event;
    await delay(20);
  }
  throw Error('loopback event timeout');
}

async function verifyCore(remote, media, broker) {
  const { BackendCore } = await import('../../../integrated-backend/src/core.mts');
  const { createNativeHostClient } = await import('../../../integrated-backend/src/native-host.mts');
  const { LIVE_ENDPOINT } = await import('../../../openai-provider/live.mts');
  const { VOICE_CATALOG_ENDPOINT } = await import('../../../openai-provider/voice-catalog.mts');
  const secrets = createNativeHostClient(message => storage.handle(message));
  const storage = createProtectedStorageBroker({ safeStorage, isReady: () => app.isReady(), send: message => secrets.handle(message) });
  const credential = 'synthetic-loopback-' + randomUUID();
  const sessionId = 'synthetic-loopback-' + randomUUID();
  const sample = 'Synthetic Core voice audition.';
  let core;
  let dispatches = 0;
  const fetchFixture = async (url, init) => {
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer ' + credential);
    if (String(url) === 'https://api.openai.com/v1/models') return Response.json({ data: [{ id: 'gpt-6-luna' }] });
    if (String(url) === VOICE_CATALOG_ENDPOINT) {
      assert.equal(init.method, 'GET');
      return Response.json({ object: 'list', has_more: false, data: [
        { object: 'audio.voice', id: 'fixture-voice', type: 'prompt', name: 'Vela 3', prompt: 'Synthetic voice.', created_at: 1000 },
      ] });
    }
    assert.equal(String(url), LIVE_ENDPOINT);
    assert.equal(init.method, 'POST');
    assert.equal(++dispatches, 1);
    const body = JSON.parse(init.body);
    assert.equal(body.session.store, false);
    assert.deepEqual(body.session.input.map(message => message.role), ['developer']);
    assert.ok(body.session.input[0].content[0].text.endsWith(sample));
    assert.equal(body.transport.type, 'webrtc');
    assert.match(body.transport.sdp, /^m=audio /m);
    const sdp = await remote.webContents.executeJavaScript(
      `(${makeAnswer.toString()})(${JSON.stringify(body.transport.sdp)},${JSON.stringify(sessionId)})`,
    );
    return Response.json({ session: { id: sessionId }, transport: { type: 'webrtc', sdp } }, { status: 201 });
  };
  const database = join(profile, 'canonical.sqlite');
  const open = () => new BackendCore({ path: database, provider: 'fixture', contentPolicy: 'synthetic-only' },
    () => {}, { ...secrets.services, liveMedia: media }, undefined, { fetch: fetchFixture, voice: { fetch: fetchFixture } });
  const voice = (name, input = {}) => core.command('velaVoice', { name, input });
  const native = (name, input) => core.command('velaVoiceNative', { name, input });
  try {
    core = open();
    const configured = await core.command('velaApiConfigure', { credential: { configurationId: 'vela-primary', apiKey: credential }, expectedVersion: null });
    await core.command('velaApiUsageAuthorize', { expectedVersion: configured.version, enabled: true });
    const attemptId = randomUUID();
    const unauthorized = { attemptId, authorizationRef: randomUUID(), sample };
    await assert.rejects(native('audition', unauthorized), /live_paid_start_review_required/);
    assert.equal(dispatches, 0);
    const grant = await native('authorize', { attemptId, operation: 'audition', maximumVoiceSeconds: 30 });
    broker.authorizeAttempt(attemptId);
    const input = { attemptId, authorizationRef: grant.authorizationRef, sample };
    const startedAt = performance.now();
    let state = await native('audition', input);
    const deadline = performance.now() + 6000;
    while (state.session.lastAppend !== 'accepted' && performance.now() < deadline) {
      assert.ok(['awaiting-start', 'running'].includes(state.session.state), state.session.errorCode);
      await delay(25);
      state = await voice('state');
    }
    assert.equal(state.session.state, 'running');
    assert.equal(state.session.lastAppend, 'accepted');
    assert.equal(state.session.sessionId, sessionId);
    assert.equal(state.media.connection, 'connected');
    assert.equal(state.media.microphoneAccess, 'not-requested');
    assert.equal(state.media.localTrackEnabled, false);
    await assert.rejects(media.setInputDevice('default'), /live_media_protocol/);
    const closed = await voice('stop');
    assert.equal(closed.session.state, 'closed');
    assert.equal(closed.session.finalization, 'confirmed');
    assert.equal(closed.media.connection, 'disposed');
    assert.equal(closed.media.humanAudibility, 'unverified');
    await assert.rejects(native('audition', input), /live_paid_start_review_required/);
    assert.equal(dispatches, 1);
    await core.command('close', {});
    assert.equal(readFileSync(database).includes(Buffer.from(credential)), false);
    core = open();
    const restored = await voice('state');
    assert.equal(restored.session.attemptId, attemptId);
    assert.equal(restored.session.sessionId, sessionId);
    assert.equal(restored.session.state, 'closed');
    assert.equal(restored.session.finalization, 'confirmed');
    await assert.rejects(native('audition', input), /live_paid_start_review_required/);
    assert.equal(dispatches, 1);
    return { canonicalRestart: true, singleUseGrant: true, initializationRequests: dispatches,
      microphoneAccess: state.media.microphoneAccess, humanAudibility: closed.media.humanAudibility,
      auditionAndReopenMs: Math.round(performance.now() - startedAt) };
  } finally {
    try { await core?.command('close', {}); } finally { secrets.close(); storage.close(); }
  }
}

async function verify() {
  const { createNativeLiveHostClient } = await import('../../../integrated-backend/src/live-media-host.mts');
  let stage = 'unauthorized prepare';
  let remote;
  const observed = { loads: 0, preloadErrors: 0, readySignals: 0, replies: 0 };
  app.on('web-contents-created', (_event, contents) => {
    contents.on('did-finish-load', () => { observed.loads++; });
    contents.on('preload-error', () => { observed.preloadErrors++; });
  });
  ipcMain.on(CHANNEL + '-ready', () => { observed.readySignals++; });
  ipcMain.on(CHANNEL + '-reply', () => { observed.replies++; });
  const client = createNativeLiveHostClient(message => broker.handle(message));
  const broker = createLiveMediaBroker({
    BrowserWindow, ipcMain, send: message => client.handle(message), preloadPath,
    htmlPath: join(__dirname, 'voice-media.html'), syntheticInput: true,
  });
  try {
    const { services } = client;
    const attemptId = randomUUID();
    await assert.rejects(services.prepare({ attemptId, outputOnly: true }), /live_media_protocol/);
    assert.equal(BrowserWindow.getAllWindows().length, 0);

    stage = 'start muted local peer';
    remote = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
        partition: 'aerynth-synthetic-loopback-peer' },
    });
    remote.webContents.setAudioMuted(true);
    const remoteSession = remote.webContents.session;
    remoteSession.setPermissionRequestHandler((_owner, _permission, callback) => callback(false));
    remoteSession.setPermissionCheckHandler(() => false);
    remoteSession.webRequest.onBeforeRequest((request, callback) => callback({ cancel: !request.url.startsWith('data:') }));
    await remote.loadURL('data:text/html,<meta charset=utf-8><title>Synthetic voice peer</title>');
    if (checkCore) {
      stage = 'Core output-only audition and restart';
      const proof = await verifyCore(remote, services, broker);
      assert.deepEqual(BrowserWindow.getAllWindows().map(window => window.id), [remote.id]);
      console.log(JSON.stringify({ result: 'pass', platform: process.platform, electron: process.versions.electron,
        mode: 'synthetic-core-local-webrtc', graphics: softwareRendering ? 'software' : 'default', ...proof }));
      return;
    }

    stage = 'authorized output-only offer';
    broker.authorizeAttempt(attemptId);
    const offerStarted = performance.now();
    const offer = await services.prepare({ attemptId, outputOnly: true });
    const offerMs = Math.round(performance.now() - offerStarted);
    assert.match(offer.sdpOffer, /^m=audio /m);
    stage = 'output-only state and input denial';
    const prepared = await services.state();
    assert.equal(prepared.connection, 'prepared');
    assert.equal(prepared.microphoneAccess, 'not-requested');
    assert.equal(prepared.localTrackEnabled, false);
    await assert.rejects(services.setInputDevice('default'), /live_media_protocol/);

    stage = 'WebRTC answer and acknowledgment';
    const sessionId = 'synthetic-loopback-session';
    const answer = await remote.webContents.executeJavaScript(
      `(${makeAnswer.toString()})(${JSON.stringify(offer.sdpOffer)},${JSON.stringify(sessionId)})`,
    );
    const events = [];
    const channel = await services.connect({
      sessionId, sdpAnswer: answer, onEvent: async event => { events.push(event); }, onConnectionLost: () => {},
    });
    const started = await waitForEvent(events, 'session.started');
    assert.equal(started.session.id, sessionId);
    assert.equal((await services.state()).connection, 'connected');
    await channel.send({
      type: 'session.commentary.append', event_id: 'synthetic-append',
      delegation_id: null, content: 'Synthetic loopback verification.',
    });
    const appended = await waitForEvent(events, 'session.commentary.appended');
    assert.equal(appended.client_event_id, 'synthetic-append');

    stage = 'finalize and dispose';
    await channel.send({ type: 'session.close', event_id: 'synthetic-close' });
    assert.equal((await waitForEvent(events, 'session.closed')).session.id, sessionId);
    await channel.close();
    await services.dispose();
    const disposed = await services.state();
    assert.equal(disposed.connection, 'disposed');
    assert.equal(disposed.microphoneAccess, 'not-requested');
    assert.equal(disposed.localTrackEnabled, false);
    assert.equal(disposed.humanAudibility, 'unverified');
    assert.deepEqual(BrowserWindow.getAllWindows().map(window => window.id), [remote.id]);
    await assert.rejects(services.prepare({ attemptId, outputOnly: true }), /live_media_protocol/);
    console.log(JSON.stringify({
      result: 'pass', platform: process.platform, electron: process.versions.electron,
      mode: 'synthetic-local-webrtc', graphics: softwareRendering ? 'software' : 'default',
      unauthorizedPrepareDenied: true, microphoneAccess: disposed.microphoneAccess,
      events: events.map(event => event.type), offerMs, disposed: true, staleAttemptDenied: true,
      humanAudibility: disposed.humanAudibility,
    }));
  } catch (error) {
    console.error(JSON.stringify({ result: 'fail', stage, error: error.code ?? error.name, observed }));
    throw Error('voice loopback verification failed');
  } finally {
    client.close();
    broker.close();
    if (remote && !remote.isDestroyed()) remote.destroy();
  }
}

const watchdog = setTimeout(() => {
  console.error(JSON.stringify({ result: 'fail', error: 'loopback watchdog' }));
  app.exit(1);
}, 45000);
app.whenReady().then(verify).then(() => app.exit(0), () => app.exit(1)).finally(() => clearTimeout(watchdog));
