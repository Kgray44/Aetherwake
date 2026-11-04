import test from "node:test";
import assert from "node:assert/strict";
import { BrowserGptLiveMedia } from "../src/gpt-live-media.ts";

const privateOffer =
  "v=0\r\no=PRIVATE_SYNTHETIC_OFFER\r\na=ice-pwd:PRIVATE_ICE_VALUE\r\n";
const privateAnswer = "v=0\r\no=PRIVATE_SYNTHETIC_ANSWER\r\n";
const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function emit(target, type, properties = {}) {
  const event = new Event(type);
  for (const [name, value] of Object.entries(properties))
    Object.defineProperty(event, name, { value });
  target.dispatchEvent(event);
}
class Track extends EventTarget {
  constructor(id, kind = "audio") {
    super();
    this.id = id;
    this.kind = kind;
    this.enabled = true;
    this.muted = false;
    this.readyState = "live";
    this.stops = 0;
  }
  getSettings() {
    return { deviceId: this.id };
  }
  stop() {
    if (this.readyState === "ended") return;
    this.stops++;
    this.readyState = "ended";
    emit(this, "ended");
  }
}
class Stream {
  constructor(tracks = []) {
    this.tracks = [...tracks];
  }
  getTracks() {
    return [...this.tracks];
  }
  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === "audio");
  }
  addTrack(track) {
    this.tracks.push(track);
  }
  removeTrack(track) {
    this.tracks = this.tracks.filter((value) => value !== track);
  }
}
class Channel extends EventTarget {
  constructor() {
    super();
    this.readyState = "connecting";
    this.sent = [];
    this.closes = 0;
  }
  send(value) {
    if (this.readyState !== "open") throw Error(privateAnswer);
    this.sent.push(JSON.parse(value));
  }
  receive(value) {
    emit(this, "message", {
      data: typeof value === "string" ? value : JSON.stringify(value),
    });
  }
  close() {
    this.closes++;
    this.readyState = "closed";
    emit(this, "close");
  }
}
class Peer extends EventTarget {
  constructor() {
    super();
    this.channel = new Channel();
    this.connectionState = "new";
    this.iceGatheringState = "complete";
    this.closed = false;
    this.sender = {
      track: null,
      replaceTrack: async (track) => {
        this.sender.track = track;
      },
    };
  }
  createDataChannel(label) {
    assert.equal(label, "oai-events");
    return this.channel;
  }
  addTrack(track) {
    this.sender.track = track;
    return this.sender;
  }
  async createOffer() {
    return { type: "offer", sdp: privateOffer };
  }
  async setLocalDescription(value) {
    this.localDescription = value;
  }
  async setRemoteDescription(value) {
    this.remoteDescription = value;
    this.connectionState = "connected";
    this.channel.readyState = "open";
    emit(this.channel, "open");
    emit(this, "connectionstatechange");
  }
  close() {
    this.closed = true;
    this.connectionState = "closed";
    emit(this, "connectionstatechange");
  }
  remote(track) {
    emit(this, "track", { track, streams: [new Stream([track])] });
  }
}
class Audio extends EventTarget {
  constructor() {
    super();
    this.paused = true;
    this.muted = false;
    this.volume = 1;
    this.currentTime = 0;
    this.sinkId = "";
    this.srcObject = null;
    this.autoPlaying = true;
    this.loads = 0;
    this.plays = 0;
  }
  async setSinkId(value) {
    if (this.sinkFailure) throw Error(privateAnswer);
    this.sinkId = value;
  }
  async play() {
    this.plays++;
    if (this.blocked) throw Error(privateAnswer);
    this.paused = false;
    if (this.autoPlaying) emit(this, "playing");
  }
  pause() {
    const wasPaused = this.paused;
    this.paused = true;
    if (!wasPaused) emit(this, "pause");
  }
  removeAttribute() {}
  load() {
    this.loads++;
  }
  advance() {
    this.currentTime += 0.1;
    emit(this, "timeupdate");
  }
}
class AudioContextFixture {
  constructor() {
    this.state = "running";
    this.analysers = [];
    this.sources = [];
  }
  async resume() {
    this.state = "running";
  }
  async close() {
    this.state = "closed";
  }
  createMediaStreamSource(stream) {
    const source = {
      stream,
      disconnected: false,
      connect() {},
      disconnect() {
        this.disconnected = true;
      },
    };
    this.sources.push(source);
    return source;
  }
  createAnalyser() {
    const analyser = {
      amplitude: 0,
      disconnected: false,
      fftSize: 256,
      getFloatTimeDomainData(values) {
        values.fill(this.amplitude);
      },
      disconnect() {
        this.disconnected = true;
      },
    };
    this.analysers.push(analyser);
    return analyser;
  }
}
function fixture(options = {}) {
  const peers = [],
    audios = [],
    streams = [],
    constraints = [],
    authorizations = [],
    events = [],
    states = [],
    contexts = [],
    timers = [];
  let lost = 0;
  let microphoneProvider =
    options.environment?.getUserMedia ??
    (async (value) => {
      constraints.push(value);
      const stream = new Stream([
        new Track(value.audio.deviceId?.exact ?? "mic-default"),
      ]);
      streams.push(stream);
      return stream;
    });
  const environment = {
    getUserMedia: async (value) => {
      constraints.push(value);
      const stream = new Stream([
        new Track(value.audio.deviceId?.exact ?? "mic-default"),
      ]);
      streams.push(stream);
      return stream;
    },
    enumerateDevices: async () => [
      { kind: "audioinput", deviceId: "mic-A", label: "Synthetic microphone" },
      { kind: "audiooutput", deviceId: "speaker-A", label: "" },
      { kind: "videoinput", deviceId: "camera", label: "Unused camera" },
    ],
    createPeer: () => {
      const peer = new Peer();
      peers.push(peer);
      return peer;
    },
    createAudio: () => {
      const audio = new Audio();
      audios.push(audio);
      return audio;
    },
    createStream: (tracks) => new Stream(tracks),
    randomId: () => "offer-" + (peers.length + 1),
    schedule: (callback) => {
      const timer = { callback, stopped: false };
      timers.push(timer);
      return () => {
        timer.stopped = true;
      };
    },
    ...(options.analysis
      ? {
          createAudioContext: () => {
            const context = new AudioContextFixture();
            contexts.push(context);
            return context;
          },
        }
      : {}),
    ...options.environment,
    getUserMedia: (value) => microphoneProvider(value),
  };
  const adapter = new BrowserGptLiveMedia({
    environment,
    acceptNegotiation: async (value) => {
      authorizations.push(value);
    },
    onState: (value) => states.push(value),
    timeoutMs: 50,
    ...options.adapter,
  });
  const connect = async (sessionId = "live-fixture-1") =>
    adapter.connect({
      sessionId,
      sdpAnswer: privateAnswer,
      onEvent: async (event) => {
        events.push(event);
      },
      onConnectionLost: () => {
        lost++;
      },
    });
  const started = async (sessionId = "live-fixture-1") => {
    await adapter.prepare({
      inputDeviceId: "mic-A",
      outputDeviceId: "speaker-A",
    });
    const channel = await connect(sessionId);
    peers
      .at(-1)
      .channel.receive({
        type: "session.started",
        event_id: "started-" + sessionId,
        session: { id: sessionId },
      });
    await flush();
    return channel;
  };
  return {
    adapter,
    environment,
    peers,
    audios,
    streams,
    constraints,
    authorizations,
    events,
    states,
    contexts,
    timers,
    connect,
    started,
    setMicrophoneProvider: (provider) => {
      microphoneProvider = provider;
    },
    get lost() {
      return lost;
    },
  };
}

test('physical quiesce stops every microphone/playback track while preserving the bound data channel for final usage',async()=>{
  const f=fixture();try{const channel=await f.started('quiesce-session'),peer=f.peers[0],remote=new Track('remote-speaker');peer.remote(remote);await flush();
    await assert.rejects(f.adapter.quiesceCapture('foreign-session'),/session_mismatch/);assert.equal(f.streams[0].getTracks()[0].readyState,'live');
    await f.adapter.quiesceCapture('quiesce-session');assert.equal(f.streams[0].getTracks()[0].readyState,'ended');assert.equal(remote.readyState,'ended');
    assert.equal(f.audios[0].paused,true);assert.equal(f.audios[0].srcObject,null);assert.equal(f.adapter.state().microphoneAccess,'released');
    assert.equal(peer.closed,false);assert.equal(peer.channel.closes,0);assert.equal(f.lost,0);
    await assert.rejects(f.adapter.setInputDevice('mic-B'),/invalid_device/);await assert.rejects(f.adapter.resumePlayback(),/no_remote_audio/);
    const late=new Track('late-remote');peer.remote(late);await flush();assert.equal(late.readyState,'ended');
    await channel.send({type:'session.close',event_id:'close-native'});peer.channel.receive({type:'session.closed',event_id:'closed-native',session:{id:'quiesce-session'},usage:{seconds:2}});await flush();
    assert.ok(f.events.some(event=>event.type==='session.closed'));assert.equal(f.lost,0);
  }finally{await f.adapter.dispose();}
});

test('quiesce aborts pending microphone acquisition and releases a late stream without opening a peer session',async()=>{
  const f=fixture(),pending=deferred(),track=new Track('late-microphone');f.setMicrophoneProvider(()=>pending.promise);
  try{const prepare=f.adapter.prepare();await flush();await f.adapter.quiesceCapture();await assert.rejects(prepare);pending.resolve(new Stream([track]));await flush();
    assert.equal(track.readyState,'ended');assert.equal(f.adapter.state().microphoneAccess,'released');assert.equal(f.authorizations.length,0);
  }finally{await f.adapter.dispose();}
});

test("offline browser adapter: explicit microphone permission, selected devices, exact native negotiation and private SDP", async () => {
  const f = fixture();
  try {
    assert.equal(f.constraints.length, 0);
    assert.equal(f.adapter.state().microphoneAccess, "not-requested");
    assert.deepEqual(await f.adapter.devices(), [
      {
        kind: "audioinput",
        id: "mic-A",
        label: "Synthetic microphone",
        labelAvailable: true,
      },
      {
        kind: "audiooutput",
        id: "speaker-A",
        label: "",
        labelAvailable: false,
      },
    ]);
    const offer = await f.adapter.prepare({
      inputDeviceId: "mic-A",
      outputDeviceId: "speaker-A",
    });
    assert.equal(offer.sdpOffer, privateOffer);
    assert.deepEqual(f.constraints[0].audio.deviceId, { exact: "mic-A" });
    assert.equal(f.constraints[0].video, false);
    assert.equal(f.audios[0].sinkId, "speaker-A");
    assert.equal(f.streams[0].getAudioTracks()[0].enabled, false);
    assert.equal(f.adapter.state().providerInputMute, "unknown");
    assert.ok(!JSON.stringify(f.states).includes("PRIVATE_"));
    const channel = await f.connect();
    assert.deepEqual(f.authorizations[0], {
      offerId: offer.offerId,
      sessionId: "live-fixture-1",
      sdpAnswer: privateAnswer,
    });
    assert.equal(f.adapter.state().connection, "connected");
    assert.equal(f.adapter.state().localTrackEnabled, false);
    assert.deepEqual(f.peers[0].remoteDescription, {
      type: "answer",
      sdp: privateAnswer,
    });
    f.peers[0].channel.receive({
      type: "session.started",
      event_id: "actual-start",
      session: {
        id: "live-fixture-1",
        instructions: "PRIVATE_CONFIG_NOT_FORWARDED",
      },
    });
    await flush();
    assert.equal(f.adapter.state().localTrackEnabled, true);
    assert.equal(f.events[0].session.instructions, undefined);
    assert.equal(f.adapter.state().humanAudibility, "unverified");
    await channel.close();
    assert.equal(f.streams[0].getAudioTracks()[0].readyState, "ended");
    assert.equal(f.peers[0].closed, true);
    assert.equal(f.audios[0].srcObject, null);
    assert.equal(f.lost, 0);
  } finally {
    await f.adapter.dispose();
  }
});

test("offline browser mute: local tracks stop immediately; unmute requires the matching latest provider acknowledgment", async () => {
  const f = fixture();
  try {
    const channel = await f.started(),
      wire = f.peers[0].channel,
      track = f.streams[0].getAudioTracks()[0];
    await channel.send({
      type: "session.input_audio.mute",
      event_id: "mute-1",
    });
    assert.equal(track.enabled, false);
    assert.equal(f.adapter.state().providerInputMute, "mute-pending");
    wire.receive({
      type: "session.input_audio.muted",
      event_id: "wrong-ack",
      client_event_id: "unrelated",
    });
    await flush();
    assert.equal(f.adapter.state().providerInputMute, "mute-pending");
    wire.receive({
      type: "session.input_audio.muted",
      event_id: "mute-ack",
      client_event_id: "mute-1",
    });
    await flush();
    assert.equal(f.adapter.state().providerInputMute, "muted");
    await channel.send({
      type: "session.input_audio.unmute",
      event_id: "unmute-1",
    });
    assert.equal(track.enabled, false);
    wire.receive({
      type: "session.started",
      event_id: "duplicate-start",
      session: { id: "live-fixture-1" },
    });
    await flush();
    assert.equal(track.enabled, false);
    wire.receive({
      type: "session.input_audio.unmuted",
      event_id: "unmute-ack",
      client_event_id: "unmute-1",
    });
    await flush();
    assert.equal(track.enabled, true);
    f.adapter.setLocalMute(true);
    assert.equal(track.enabled, false);
    assert.equal(f.adapter.state().providerInputMute, "unmuted");
    f.adapter.setLocalMute(false);
    assert.equal(track.enabled, true);
    await assert.rejects(
      channel.send({
        type: "session.update",
        event_id: "arbitrary",
        apiKey: "PRIVATE_NOT_ALLOWED",
      }),
      /live_media_invalid_command/,
    );
  } finally {
    await f.adapter.dispose();
  }
});

test("offline browser playback: play acceptance is pending until actual playing/clock events; interruption affects playback only", async () => {
  const f = fixture();
  try {
    await f.started();
    f.audios[0].autoPlaying = false;
    const remote = new Track("remote-audio");
    f.peers[0].remote(remote);
    await flush();
    assert.equal(f.adapter.state().playback, "pending");
    f.audios[0].advance();
    assert.equal(f.adapter.state().playbackObserved, false);
    emit(f.audios[0], "playing");
    f.audios[0].advance();
    assert.equal(f.adapter.state().playback, "playing");
    assert.equal(f.adapter.state().playbackObserved, true);
    assert.equal(f.adapter.state().humanAudibility, "unverified");
    const sent = f.peers[0].channel.sent.length;
    f.adapter.interruptPlayback();
    assert.equal(f.adapter.state().playback, "interrupted");
    assert.equal(f.adapter.state().interruption, "explicit-user");
    assert.equal(f.peers[0].channel.sent.length, sent);
    assert.equal(f.streams[0].getAudioTracks()[0].enabled, true);
    f.audios[0].autoPlaying = true;
    await f.adapter.resumePlayback();
    assert.equal(f.adapter.state().playback, "playing");
    assert.equal(f.adapter.state().interruption, "none");
    await f.adapter.dispose();
    assert.equal(remote.readyState, "ended");
    assert.equal(f.audios[0].srcObject, null);
  } finally {
    await f.adapter.dispose();
  }
});

test("offline browser autoplay blocking is actionable and selected output failure never silently resumes another sink", async () => {
  const f = fixture();
  try {
    await f.started();
    f.audios[0].blocked = true;
    f.peers[0].remote(new Track("remote"));
    await flush();
    assert.equal(f.adapter.state().playback, "blocked");
    assert.equal(f.adapter.state().errorCode, "live_media_playback_blocked");
    f.audios[0].blocked = false;
    await f.adapter.resumePlayback();
    assert.equal(f.adapter.state().playback, "playing");
    f.audios[0].sinkFailure = true;
    await assert.rejects(
      f.adapter.setOutputDevice("speaker-B"),
      /live_media_output_device_unavailable/,
    );
    assert.equal(f.audios[0].paused, true);
    assert.equal(f.audios[0].sinkId, "speaker-A");
    assert.ok(!JSON.stringify(f.states).includes("PRIVATE_"));
    f.audios[0].sinkFailure = false;
    await f.adapter.setOutputDevice("speaker-B");
    assert.equal(f.audios[0].sinkId, "speaker-B");
    await f.adapter.setOutputDevice("default");
    assert.equal(f.audios[0].sinkId, "");
    assert.equal(f.adapter.state().outputDevice, "default");
  } finally {
    await f.adapter.dispose();
  }
});

test("offline browser input switching replaces the sender atomically, preserves mute, and stops incorrect/failed replacement tracks", async () => {
  const f = fixture();
  try {
    await f.started();
    const first = f.streams[0].getAudioTracks()[0];
    await f.adapter.setInputDevice("mic-B");
    assert.equal(first.readyState, "ended");
    assert.equal(f.peers[0].sender.track.id, "mic-B");
    assert.equal(f.peers[0].sender.track.enabled, true);
    f.adapter.setLocalMute(true);
    await f.adapter.setInputDevice("mic-C");
    assert.equal(f.peers[0].sender.track.id, "mic-C");
    assert.equal(f.peers[0].sender.track.enabled, false);
    const wrong = new Track("wrong-input");
    f.setMicrophoneProvider(async () => new Stream([wrong]));
    await assert.rejects(
      f.adapter.setInputDevice("mic-D"),
      /live_media_input_device_mismatch/,
    );
    assert.equal(wrong.readyState, "ended");
    assert.equal(f.peers[0].sender.track.id, "mic-C");
    assert.equal(f.adapter.state().localTrackEnabled, false);
  } finally {
    await f.adapter.dispose();
  }
});

test("offline browser provider events come only from the bound data channel, project safe fields, and reject cross-session data", async () => {
  const f = fixture();
  try {
    await f.started();
    const wire = f.peers[0].channel;
    emit(f.peers[0], "message", {
      data: JSON.stringify({
        type: "session.delegation.created",
        offset_ms: 1,
        delegation: { id: "not-a-channel-event", target: "client" },
      }),
    });
    await flush();
    assert.equal(f.events.length, 1);
    wire.receive({
      type: "session.delegation.created",
      event_id: "delegation",
      offset_ms: 1,
      delegation: {
        id: "delegation-1",
        target: "client",
        task: "UNTRUSTED_TASK_TEXT",
      },
    });
    wire.receive({
      type: "error",
      event_id: "provider-error",
      error: {
        message: privateOffer,
        code: "PRIVATE_ERROR",
        client_event_id: "native-command",
      },
    });
    await flush();
    assert.deepEqual(f.events.at(-2).delegation, {
      id: "delegation-1",
      type: "delegation",
      target: "client",
    });
    assert.equal(
      JSON.stringify(f.events).includes("UNTRUSTED_TASK_TEXT"),
      false,
    );
    assert.equal(JSON.stringify(f.events).includes("PRIVATE_"), false);
    wire.receive({
      type: "session.started",
      event_id: "cross-session",
      session: { id: "foreign-session" },
    });
    await flush();
    assert.equal(f.lost, 1);
    assert.equal(f.peers[0].closed, true);
    assert.equal(f.streams[0].getAudioTracks()[0].readyState, "ended");
    assert.equal(f.adapter.state().connection, "failed");
  } finally {
    await f.adapter.dispose();
  }
});

test("offline browser malformed/binary/oversized event data cannot reach canonical callbacks or fabricate provider readiness", async () => {
  for (const bad of [
    "not-json",
    "x".repeat(65537),
    new Uint8Array([1, 2, 3]),
  ]) {
    const f = fixture();
    try {
      await f.adapter.prepare();
      await f.connect();
      emit(f.peers[0].channel, "message", { data: bad });
      await flush();
      assert.equal(f.events.length, 0);
      assert.equal(f.lost, 1);
      assert.equal(f.adapter.state().localTrackEnabled, false);
    } finally {
      await f.adapter.dispose();
    }
  }
});

test("offline browser native negotiation denial releases microphone and never applies an unauthenticated answer", async () => {
  const f = fixture({
    adapter: {
      acceptNegotiation: async () => {
        throw Error(privateAnswer);
      },
    },
  });
  try {
    await f.adapter.prepare();
    await assert.rejects(
      f.connect(),
      (error) =>
        /live_media_negotiation_denied/.test(String(error)) &&
        !String(error).includes("PRIVATE_"),
    );
    assert.equal(f.peers[0].remoteDescription, undefined);
    assert.equal(f.peers[0].closed, true);
    assert.equal(f.streams[0].getAudioTracks()[0].readyState, "ended");
  } finally {
    await f.adapter.dispose();
  }
});

test("offline browser disposal during permission acquisition stops a late stream and never revives the peer", async () => {
  const gate = deferred(),
    track = new Track("late-mic");
  const f = fixture({ environment: { getUserMedia: () => gate.promise } });
  const preparing = f.adapter.prepare();
  await flush();
  await f.adapter.dispose();
  gate.resolve(new Stream([track]));
  await assert.rejects(preparing, /live_media_replaced/);
  assert.equal(track.readyState, "ended");
  assert.equal(f.peers[0].closed, true);
  assert.equal(f.adapter.state().connection, "disposed");
});

test("offline browser reconnect releases old resources and late old events cannot affect the new session", async () => {
  const f = fixture();
  try {
    const oldChannel = await f.started(),
      oldWire = f.peers[0].channel;
    await oldChannel.close();
    await f.adapter.prepare();
    await f.connect("live-fixture-2");
    f.peers[1].channel.receive({
      type: "session.started",
      event_id: "new-start",
      session: { id: "live-fixture-2" },
    });
    await flush();
    const count = f.events.length;
    oldWire.receive({
      type: "session.input_transcript.delta",
      event_id: "late-old",
      delta: "must not persist",
      start_ms: 1,
      end_ms: 2,
    });
    await oldChannel.close();
    await flush();
    assert.equal(f.events.length, count);
    assert.equal(f.adapter.state().connection, "connected");
    assert.equal(f.adapter.state().localTrackEnabled, true);
    assert.equal(f.peers[1].closed, false);
    f.peers[1].connectionState = "failed";
    emit(f.peers[1], "connectionstatechange");
    await flush();
    assert.equal(f.lost, 1);
    assert.equal(f.streams.at(-1).getAudioTracks()[0].readyState, "ended");
  } finally {
    await f.adapter.dispose();
  }
});

test("offline browser bounded audio-energy analysis marks barge-in as inferred and disposes every analyser/timer", async () => {
  const f = fixture({ analysis: true });
  try {
    await f.started();
    f.peers[0].remote(new Track("remote-analysis"));
    await flush();
    const context = f.contexts[0];
    context.analysers[0].amplitude = 0.06;
    context.analysers[1].amplitude = 0.04;
    for (let i = 0; i < 3; i++) f.timers[0].callback();
    assert.equal(f.adapter.state().localSpeech, "detected");
    assert.equal(f.adapter.state().remoteSignal, "detected");
    assert.equal(f.adapter.state().interruption, "inferred-local-barge-in");
    assert.equal(f.peers[0].channel.sent.length, 0);
    assert.equal(f.adapter.state().humanAudibility, "unverified");
    f.adapter.setLocalMute(true);
    for (let i = 0; i < 5; i++) f.timers[0].callback();
    assert.equal(f.adapter.state().localSpeech, "silent");
    assert.equal(f.adapter.state().interruption, "none");
    context.state = "suspended";
    f.timers[0].callback();
    assert.equal(f.adapter.state().localSpeech, "unavailable");
    assert.equal(f.adapter.state().remoteSignal, "unavailable");
    await f.adapter.dispose();
    assert.equal(context.state, "closed");
    assert.equal(f.timers[0].stopped, true);
    assert.ok(context.sources.every((source) => source.disconnected));
    assert.ok(context.analysers.every((analyser) => analyser.disconnected));
  } finally {
    await f.adapter.dispose();
  }
});

test("offline browser hardware source mute/end remains distinct from local and provider mute", async () => {
  const f = fixture();
  try {
    await f.started();
    const track = f.streams[0].getAudioTracks()[0];
    assert.equal(f.adapter.state().localSourceMuted, false);
    track.muted = true;
    emit(track, "mute");
    assert.equal(f.adapter.state().localSourceMuted, true);
    assert.equal(f.adapter.state().localTrackEnabled, true);
    assert.equal(f.adapter.state().providerInputMute, "unmuted");
    track.muted = false;
    emit(track, "unmute");
    assert.equal(f.adapter.state().localSourceMuted, false);
    track.stop();
    assert.equal(f.adapter.state().localTrackEnabled, false);
    assert.equal(f.adapter.state().microphoneAccess, "released");
    assert.equal(f.adapter.state().errorCode, "live_media_microphone_ended");
  } finally {
    await f.adapter.dispose();
  }
});

test("offline browser disposal cancels ICE waits promptly and constructor/device errors release partial resources without raw diagnostics", async () => {
  let peer;
  const waiting = fixture({
    environment: {
      createPeer: () => {
        peer = new Peer();
        peer.iceGatheringState = "gathering";
        return peer;
      },
    },
  });
  const prepare = waiting.adapter.prepare();
  await flush();
  await waiting.adapter.dispose();
  await assert.rejects(prepare, /live_media_replaced/);
  assert.equal(peer.closed, true);
  let partial;
  const broken = fixture({
    environment: {
      createPeer: () => {
        partial = new Peer();
        return partial;
      },
      createAudio: () => {
        throw Error(privateOffer);
      },
    },
  });
  try {
    await assert.rejects(
      broken.adapter.prepare(),
      (error) =>
        String(error) ===
        "GptLiveMediaError: live_media_environment_unavailable",
    );
    assert.equal(partial.closed, true);
    assert.equal(partial.channel.readyState, "closed");
  } finally {
    await broken.adapter.dispose();
  }
  const unsupported = fixture({
    environment: {
      createAudio: () => {
        const audio = new Audio();
        audio.setSinkId = undefined;
        return audio;
      },
    },
  });
  try {
    await assert.rejects(
      unsupported.adapter.prepare({ outputDeviceId: "speaker-A" }),
      /live_media_output_selection_unsupported/,
    );
    assert.equal(unsupported.constraints.length, 0);
    assert.equal(unsupported.peers[0].closed, true);
  } finally {
    await unsupported.adapter.dispose();
  }
});
