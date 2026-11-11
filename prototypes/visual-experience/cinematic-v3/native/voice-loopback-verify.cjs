const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mkdirSync, realpathSync } = require('node:fs');
const { join } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { app, BrowserWindow, ipcMain } = require('electron');
const { CHANNEL, createLiveMediaBroker } = require('./live-media-broker.cjs');

const scratch = realpathSync(process.argv[2]);
const preloadPath = realpathSync(process.argv[3]);
const softwareRendering = process.argv[4] === '--software-rendering';
assert(process.argv.length === (softwareRendering ? 5 : 4));
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
