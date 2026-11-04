import type {
  LiveChannel,
  LiveClientCommand,
  LiveMediaAdapter,
} from "../../../openai-provider/live-contracts.mts";

export interface GptLiveMediaState {
  contract: "aerynth.gpt-live-media@1";
  connection:
    | "idle"
    | "preparing"
    | "prepared"
    | "connecting"
    | "connected"
    | "closed"
    | "failed"
    | "disposed";
  microphoneAccess: "not-requested" | "active" | "released";
  localTrackEnabled: boolean;
  localSourceMuted: boolean | null;
  providerInputMute:
    | "unknown"
    | "unmuted"
    | "mute-pending"
    | "muted"
    | "unmute-pending";
  playback:
    | "idle"
    | "pending"
    | "playing"
    | "blocked"
    | "paused"
    | "interrupted"
    | "ended"
    | "error";
  /** A media-element clock observation is not proof that a person heard sound. */
  playbackObserved: boolean;
  humanAudibility: "unverified";
  inputDevice: "default" | "selected";
  outputDevice: "default" | "selected";
  localSpeech: "unavailable" | "silent" | "detected";
  remoteSignal: "unavailable" | "silent" | "detected";
  interruption: "none" | "explicit-user" | "inferred-local-barge-in";
  errorCode?: string;
}
export interface PrivateGptLiveOffer {
  offerId: string;
  sdpOffer: string;
}
export interface GptLiveAudioDevice {
  kind: "audioinput" | "audiooutput";
  id: string;
  label: string;
  labelAvailable: boolean;
}
export interface GptLiveBrowserEnvironment {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  enumerateDevices(): Promise<MediaDeviceInfo[]>;
  createPeer(): RTCPeerConnection;
  createAudio(): HTMLAudioElement;
  createStream(tracks?: MediaStreamTrack[]): MediaStream;
  createAudioContext?: () => AudioContext;
  schedule(callback: () => void, intervalMs: number): () => void;
  randomId(): string;
}
export interface GptLiveMediaOptions {
  /** Trusted native broker must match this exact prepared offer/session/answer.
   * Never replace this with a renderer-provided boolean. No API key is accepted. */
  acceptNegotiation(input: {
    offerId: string;
    sessionId: string;
    sdpAnswer: string;
  }): Promise<void>;
  environment?: Partial<GptLiveBrowserEnvironment>;
  onState?(state: GptLiveMediaState): void;
  timeoutMs?: number;
  analysisIntervalMs?: number;
}
export class GptLiveMediaError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "GptLiveMediaError";
    this.code = code;
  }
}
const check: (condition: unknown, code: string) => asserts condition = (
  condition,
  code,
) => {
  if (!condition) throw new GptLiveMediaError(code);
};
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const identifier = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 512 &&
  !/[\x00-\x20\x7f]/.test(value);
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
type Session = Parameters<LiveMediaAdapter["connect"]>[0];
type Analysis = {
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  values: Float32Array<ArrayBuffer>;
};
type Resources = {
  offerId: string;
  peer: RTCPeerConnection;
  channel: RTCDataChannel;
  audio: HTMLAudioElement;
  local?: MediaStream;
  localAllocations: Set<MediaStream>;
  remote: MediaStream;
  sender?: RTCRtpSender;
  binding?: Session;
  inputId?: string;
  outputId?: string;
  localMuted: boolean;
  expectedClose: boolean;
  listeners: (() => void)[];
  pending: Map<string, "muted" | "unmuted">;
  context?: AudioContext;
  localAnalysis?: Analysis;
  remoteAnalysis?: Analysis;
  stopAnalysis?: () => void;
  loudFrames: number;
  quietFrames: number;
  lastTime: number;
  queue: Promise<void>;
  started: boolean;
  latestMuteId?: string;
  abort: AbortController;
  captureAbort: AbortController;
  captureQuiesced: boolean;
  inputListeners: (() => void)[];
};

/** Browser WebRTC/media only. SDP stays in the prepared/native negotiation path;
 * event authority comes from that bound peer, not window messages or DOM state. */
export class BrowserGptLiveMedia implements LiveMediaAdapter {
  private readonly options: GptLiveMediaOptions;
  private readonly environment: GptLiveBrowserEnvironment;
  private readonly timeoutMs: number;
  private readonly intervalMs: number;
  private resources?: Resources;
  private disposed = false;
  private cleaning = false;
  private inputChanging = false;
  private outputChanging = false;
  private stateValue: GptLiveMediaState = {
    contract: "aerynth.gpt-live-media@1",
    connection: "idle",
    microphoneAccess: "not-requested",
    localTrackEnabled: false,
    localSourceMuted: null,
    providerInputMute: "unknown",
    playback: "idle",
    playbackObserved: false,
    humanAudibility: "unverified",
    inputDevice: "default",
    outputDevice: "default",
    localSpeech: "unavailable",
    remoteSignal: "unavailable",
    interruption: "none",
  };
  constructor(options: GptLiveMediaOptions) {
    this.options = options;
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.intervalMs = options.analysisIntervalMs ?? 50;
    check(
      Number.isSafeInteger(this.timeoutMs) &&
        this.timeoutMs > 0 &&
        this.timeoutMs <= 15000 &&
        Number.isSafeInteger(this.intervalMs) &&
        this.intervalMs >= 25 &&
        this.intervalMs <= 250,
      "live_media_invalid_limits",
    );
    this.environment = {
      getUserMedia: (constraints) =>
        navigator.mediaDevices.getUserMedia(constraints),
      enumerateDevices: () => navigator.mediaDevices.enumerateDevices(),
      createPeer: () => new RTCPeerConnection(),
      createAudio: () => document.createElement("audio"),
      createStream: (tracks) => new MediaStream(tracks ?? []),
      ...(typeof AudioContext === "function"
        ? { createAudioContext: () => new AudioContext() }
        : {}),
      schedule: (callback, interval) => {
        const timer = setInterval(callback, interval);
        return () => clearInterval(timer);
      },
      randomId: () => crypto.randomUUID(),
      ...options.environment,
    };
  }
  state(): GptLiveMediaState {
    return structuredClone(this.stateValue);
  }
  private publish(patch: Partial<GptLiveMediaState>) {
    this.stateValue = { ...this.stateValue, ...patch };
    try {
      this.options.onState?.(this.state());
    } catch {
      /* A UI observer is not media or provider authority. */
    }
  }
  private async bounded<T>(
    operation: () => Promise<T>,
    code: string,
    signal?: AbortSignal,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let removeAbort = () => {};
    try {
      check(!signal?.aborted, "live_media_replaced");
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new GptLiveMediaError(code)),
            this.timeoutMs,
          );
        }),
        ...(signal
          ? [
              new Promise<never>((_, reject) => {
                const abort = () =>
                  reject(new GptLiveMediaError("live_media_replaced"));
                signal.addEventListener("abort", abort, { once: true });
                removeAbort = () => signal.removeEventListener("abort", abort);
              }),
            ]
          : []),
      ]);
    } catch (error) {
      throw error instanceof GptLiveMediaError
        ? error
        : new GptLiveMediaError(code);
    } finally {
      clearTimeout(timer);
      removeAbort();
    }
  }
  private listen(
    resources: Resources,
    target: EventTarget,
    type: string,
    listener: EventListener,
  ) {
    target.addEventListener(type, listener);
    resources.listeners.push(() => target.removeEventListener(type, listener));
  }
  private active(resources: Resources) {
    check(
      this.resources === resources && !this.disposed,
      "live_media_replaced",
    );
  }
  private async microphone(
    resources: Resources,
    deviceId?: string,
  ): Promise<MediaStream> {
    let accept = true;
    const pending = Promise.resolve()
      .then(() =>
        this.environment.getUserMedia({
          audio: {
            ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        }),
      )
      .then((stream) => {
        if (!accept || this.resources !== resources || this.disposed || resources.captureQuiesced) {
          for (const track of stream.getTracks()) track.stop();
          throw new GptLiveMediaError("live_media_replaced");
        }
        return stream;
      });
    try {
      const stream = await this.bounded(
        () => pending,
        "live_media_microphone_unavailable",
        AbortSignal.any([resources.abort.signal,resources.captureAbort.signal]),
      );
      const tracks = stream.getAudioTracks();
      if (
        tracks.length !== 1 ||
        tracks[0].readyState !== "live" ||
        (deviceId && tracks[0].getSettings().deviceId !== deviceId)
      ) {
        for (const track of stream.getTracks()) track.stop();
        throw new GptLiveMediaError("live_media_input_device_mismatch");
      }
      resources.localAllocations.add(stream);
      return stream;
    } catch (error) {
      accept = false;
      throw error;
    }
  }
  async devices(): Promise<GptLiveAudioDevice[]> {
    check(!this.disposed, "live_media_disposed");
    const devices = await this.bounded(
      () => this.environment.enumerateDevices(),
      "live_media_devices_unavailable",
    );
    check(
      Array.isArray(devices) && devices.length <= 128,
      "live_media_devices_unavailable",
    );
    return devices
      .filter(
        (device) =>
          device.kind === "audioinput" || device.kind === "audiooutput",
      )
      .map((device) => {
        check(
          identifier(device.deviceId) &&
            typeof device.label === "string" &&
            device.label.length <= 300,
          "live_media_devices_unavailable",
        );
        return {
          kind: device.kind as "audioinput" | "audiooutput",
          id: device.deviceId,
          label: device.label,
          labelAvailable: device.label.length > 0,
        };
      });
  }
  /** Explicit user-start boundary. Microphone permission is never requested on construction. */
  async prepare(
    input: { inputDeviceId?: string; outputDeviceId?: string } = {},
  ): Promise<PrivateGptLiveOffer> {
    check(
      !this.disposed && !this.resources && !this.cleaning,
      "live_media_busy",
    );
    check(
      object(input) &&
        Object.keys(input).every(
          (key) => key === "inputDeviceId" || key === "outputDeviceId",
        ) &&
        (input.inputDeviceId === undefined ||
          identifier(input.inputDeviceId)) &&
        (input.outputDeviceId === undefined ||
          identifier(input.outputDeviceId)),
      "live_media_invalid_device",
    );
    let peer: RTCPeerConnection | undefined,
      channel: RTCDataChannel | undefined,
      audio: HTMLAudioElement | undefined,
      resources: Resources;
    try {
      peer = this.environment.createPeer();
      channel = peer.createDataChannel("oai-events");
      audio = this.environment.createAudio();
      resources = {
        offerId: this.environment.randomId(),
        peer,
        channel,
        audio,
        remote: this.environment.createStream(),
        localAllocations: new Set(),
        inputId:
          input.inputDeviceId === "default" ? undefined : input.inputDeviceId,
        outputId:
          input.outputDeviceId === "default" ? undefined : input.outputDeviceId,
        localMuted: false,
        expectedClose: false,
        listeners: [],
        pending: new Map(),
        loudFrames: 0,
        quietFrames: 0,
        lastTime: 0,
        queue: Promise.resolve(),
        started: false,
        abort: new AbortController(),
        captureAbort: new AbortController(),
        captureQuiesced: false,
        inputListeners: [],
      };
    } catch {
      try {
        channel?.close();
      } catch {}
      try {
        peer?.close();
      } catch {}
      throw new GptLiveMediaError("live_media_environment_unavailable");
    }
    this.resources = resources;
    audio.autoplay = false;
    audio.controls = false;
    audio.volume = 1;
    this.stateValue = {
      ...this.stateValue,
      connection: "preparing",
      microphoneAccess: "not-requested",
      localTrackEnabled: false,
      providerInputMute: "unknown",
      playback: "idle",
      playbackObserved: false,
      inputDevice: resources.inputId ? "selected" : "default",
      outputDevice: resources.outputId ? "selected" : "default",
      localSpeech: "unavailable",
      remoteSignal: "unavailable",
      interruption: "none",
    };
    delete this.stateValue.errorCode;
    this.publish({});
    try {
      this.bindEvents(resources);
      if (resources.outputId) await this.sink(resources, resources.outputId);
      resources.local = await this.microphone(resources, resources.inputId);
      this.active(resources);
      this.inputTrack(resources);
      this.applyMute(resources);
      resources.sender = peer.addTrack(
        resources.local.getAudioTracks()[0],
        resources.local,
      );
      this.publish({ microphoneAccess: "active" });
      await this.analysis(resources);
      check(!resources.captureQuiesced,'live_media_replaced');
      const offer = await this.bounded(
        () => resources.peer.createOffer(),
        "live_media_offer_unavailable",
        resources.abort.signal,
      );
      this.active(resources);
      await this.bounded(
        () => resources.peer.setLocalDescription(offer),
        "live_media_offer_unavailable",
        resources.abort.signal,
      );
      await this.waitFor(
        resources,
        resources.peer,
        "icegatheringstatechange",
        () => resources.peer.iceGatheringState === "complete",
        "live_media_ice_timeout",
      );
      this.active(resources);
      const sdpOffer = resources.peer.localDescription?.sdp;
      check(
        typeof sdpOffer === "string" &&
          bytes(sdpOffer) > 0 &&
          bytes(sdpOffer) <= 65536,
        "live_media_offer_unavailable",
      );
      this.publish({ connection: "prepared" });
      return { offerId: resources.offerId, sdpOffer };
    } catch (error) {
      await this.release(resources, "failed");
      const code =
        error instanceof GptLiveMediaError
          ? error.code
          : "live_media_prepare_unavailable";
      if (!this.resources && !this.disposed) this.publish({ errorCode: code });
      throw new GptLiveMediaError(code);
    }
  }
  async connect(input: Session): Promise<LiveChannel> {
    const resources = this.resources;
    check(
      resources &&
        this.stateValue.connection === "prepared" &&
        identifier(input.sessionId) &&
        typeof input.sdpAnswer === "string" &&
        bytes(input.sdpAnswer) > 0 &&
        bytes(input.sdpAnswer) <= 65536 &&
        typeof input.onEvent === "function" &&
        typeof input.onConnectionLost === "function",
      "live_media_invalid_negotiation",
    );
    try {
      await this.bounded(
        () =>
          this.options.acceptNegotiation({
            offerId: resources.offerId,
            sessionId: input.sessionId,
            sdpAnswer: input.sdpAnswer,
          }),
        "live_media_negotiation_denied",
        resources.abort.signal,
      );
      this.active(resources);
      resources.binding = input;
      this.publish({ connection: "connecting" });
      await this.bounded(
        () =>
          resources.peer.setRemoteDescription({
            type: "answer",
            sdp: input.sdpAnswer,
          }),
        "live_media_answer_unavailable",
        resources.abort.signal,
      );
      this.active(resources);
      await this.waitFor(
        resources,
        resources.channel,
        "open",
        () => resources.channel.readyState === "open",
        "live_media_channel_timeout",
      );
      this.active(resources);
      this.publish({ connection: "connected" });
      return {
        send: (command) => this.send(resources, command),
        close: () => this.release(resources, "closed"),
      };
    } catch (error) {
      await this.release(resources, "failed");
      const code =
        error instanceof GptLiveMediaError
          ? error.code
          : "live_media_connect_unavailable";
      if (!this.resources && !this.disposed) this.publish({ errorCode: code });
      throw new GptLiveMediaError(code);
    }
  }
  private async waitFor(
    resources: Resources,
    target: EventTarget,
    event: string,
    ready: () => boolean,
    code: string,
  ): Promise<void> {
    if (ready()) return;
    let remove = () => {};
    try {
      await this.bounded(
        () =>
          new Promise<void>((resolve) => {
            const listener = () => {
              if (ready()) resolve();
            };
            target.addEventListener(event, listener);
            remove = () => target.removeEventListener(event, listener);
            resources.listeners.push(remove);
            listener();
          }),
        code,
        resources.abort.signal,
      );
    } finally {
      remove();
    }
  }
  private bindEvents(resources: Resources) {
    this.listen(resources, resources.channel, "message", (event) => {
      if (
        this.resources !== resources ||
        !resources.binding ||
        event.currentTarget !== resources.channel
      )
        return;
      const data = (event as MessageEvent).data;
      resources.queue = resources.queue
        .then(() => this.message(resources, data))
        .catch(() => {
          if (this.resources === resources) {
            this.publish({ errorCode: "live_media_invalid_provider_event" });
            this.lost(resources);
          }
        });
    });
    for (const type of ["close", "error"])
      this.listen(resources, resources.channel, type, () =>
        this.lost(resources),
      );
    this.listen(resources, resources.peer, "connectionstatechange", () => {
      if (
        ["failed", "disconnected", "closed"].includes(
          resources.peer.connectionState,
        )
      )
        this.lost(resources);
    });
    this.listen(resources, resources.peer, "track", (event) => {
      void this.remoteTrack(resources, event as RTCTrackEvent).catch(() => {
        if (
          this.resources === resources &&
          this.stateValue.playback !== "blocked"
        )
          this.publish({
            playback: "error",
            errorCode: "live_media_remote_audio_unavailable",
          });
      });
    });
    this.listen(resources, resources.audio, "playing", () => {
      if (this.resources === resources && !resources.audio.paused)
        this.publish({ playback: "playing" });
    });
    this.listen(resources, resources.audio, "pause", () => {
      if (
        this.resources === resources &&
        this.stateValue.playback !== "interrupted"
      )
        this.publish({ playback: "paused" });
    });
    this.listen(resources, resources.audio, "ended", () => {
      if (this.resources === resources) this.publish({ playback: "ended" });
    });
    this.listen(resources, resources.audio, "error", () => {
      if (this.resources === resources)
        this.publish({
          playback: "error",
          errorCode: "live_media_playback_unavailable",
        });
    });
    this.listen(resources, resources.audio, "timeupdate", () => {
      if (this.resources !== resources) return;
      const time = resources.audio.currentTime;
      if (
        Number.isFinite(time) &&
        time > resources.lastTime &&
        !resources.audio.paused &&
        !resources.audio.muted &&
        resources.audio.volume > 0 &&
        this.stateValue.playback === "playing"
      )
        this.publish({ playbackObserved: true });
      resources.lastTime = time;
    });
  }
  private applyMute(resources: Resources) {
    const enabled =
      !resources.captureQuiesced && !resources.localMuted && this.stateValue.providerInputMute === "unmuted";
    for (const track of resources.local?.getAudioTracks() ?? [])
      track.enabled = enabled;
    this.publish({
      localTrackEnabled:
        !!resources.local &&
        enabled &&
        resources.local
          .getAudioTracks()
          .some((track) => track.readyState === "live"),
    });
  }
  private inputTrack(resources: Resources) {
    for (const remove of resources.inputListeners.splice(0)) remove();
    const track = resources.local!.getAudioTracks()[0];
    const update = () => {
      if (
        this.resources !== resources ||
        resources.local?.getAudioTracks()[0] !== track
      )
        return;
      this.publish({
        localSourceMuted: typeof track.muted === "boolean" ? track.muted : null,
        ...(track.readyState === "ended"
          ? {
              localTrackEnabled: false,
              microphoneAccess: "released",
              localSpeech: "unavailable",
              errorCode: "live_media_microphone_ended",
            }
          : {}),
      });
    };
    for (const type of ["mute", "unmute", "ended"]) {
      track.addEventListener(type, update);
      resources.inputListeners.push(() =>
        track.removeEventListener(type, update),
      );
    }
    update();
  }
  setLocalMute(muted: boolean): void {
    check(
      typeof muted === "boolean" && this.resources,
      "live_media_not_prepared",
    );
    this.resources.localMuted = muted;
    this.applyMute(this.resources);
  }
  private async send(
    resources: Resources,
    command: LiveClientCommand,
  ): Promise<void> {
    this.active(resources);
    check(
      resources.binding &&
        resources.channel.readyState === "open" &&
        object(command) &&
        identifier(command.event_id),
      "live_media_channel_unavailable",
    );
    const append =
      command.type === "session.thinking.append" ||
      command.type === "session.commentary.append";
    check(
      append
        ? Object.keys(command).length === 4 &&
            Object.keys(command).every((key) =>
              ["type", "event_id", "delegation_id", "content"].includes(key),
            ) &&
            (command.delegation_id === null ||
              identifier(command.delegation_id)) &&
            typeof command.content === "string" &&
            bytes(command.content) <= 500
        : Object.keys(command).length === 2 &&
            [
              "session.input_audio.mute",
              "session.input_audio.unmute",
              "session.close",
            ].includes(command.type),
      "live_media_invalid_command",
    );
    if (
      command.type === "session.input_audio.mute" ||
      command.type === "session.input_audio.unmute"
    ) {
      check(
        resources.pending.size < 32 && !resources.pending.has(command.event_id),
        "live_media_command_backpressure",
      );
      const muted = command.type === "session.input_audio.mute";
      resources.localMuted = muted;
      resources.latestMuteId = command.event_id;
      resources.pending.set(command.event_id, muted ? "muted" : "unmuted");
      this.publish({
        providerInputMute: muted ? "mute-pending" : "unmute-pending",
      });
      this.applyMute(resources);
    } else if (command.type === "session.close") {
      resources.localMuted = true;
      this.applyMute(resources);
      resources.audio.pause();
    }
    try {
      resources.channel.send(JSON.stringify(command));
    } catch {
      if (resources.pending.delete(command.event_id)) {
        this.publish({ providerInputMute: "unknown" });
        this.applyMute(resources);
      }
      throw new GptLiveMediaError("live_media_send_unavailable");
    }
  }
  private event(
    data: unknown,
    sessionId: string,
  ): Record<string, unknown> | null {
    check(
      typeof data === "string" && bytes(data) <= 65536,
      "live_media_invalid_provider_event",
    );
    let value: unknown;
    try {
      value = JSON.parse(data);
    } catch {
      throw new GptLiveMediaError("live_media_invalid_provider_event");
    }
    check(
      object(value) &&
        typeof value.type === "string" &&
        value.type.length <= 100 &&
        (value.event_id === undefined || identifier(value.event_id)),
      "live_media_invalid_provider_event",
    );
    const base = {
      type: value.type,
      ...(typeof value.event_id === "string"
        ? { event_id: value.event_id }
        : {}),
    };
    if (value.type === "session.started") {
      check(
        object(value.session) && value.session.id === sessionId,
        "live_media_session_mismatch",
      );
      return { ...base, session: { id: sessionId } };
    }
    if (
      value.type === "session.closed" ||
      value.type === "session.usage.updated"
    ) {
      if (object(value.session) && value.session.id !== undefined)
        check(value.session.id === sessionId, "live_media_session_mismatch");
      check(
        object(value.usage) &&
          typeof value.usage.seconds === "number" &&
          Number.isFinite(value.usage.seconds) &&
          value.usage.seconds >= 0 &&
          value.usage.seconds <= 86400,
        "live_media_invalid_provider_event",
      );
      return {
        ...base,
        ...(value.type === "session.closed"
          ? { session: { id: sessionId } }
          : {}),
        usage: { seconds: value.usage.seconds },
      };
    }
    if (
      [
        "session.input_audio.muted",
        "session.input_audio.unmuted",
        "session.thinking.appended",
        "session.commentary.appended",
      ].includes(value.type)
    ) {
      check(
        identifier(value.client_event_id),
        "live_media_invalid_provider_event",
      );
      return { ...base, client_event_id: value.client_event_id };
    }
    if (
      value.type === "session.input_transcript.delta" ||
      value.type === "session.output_transcript.delta"
    ) {
      check(
        identifier(value.event_id) &&
          typeof value.delta === "string" &&
          bytes(value.delta) <= 32768 &&
          typeof value.start_ms === "number" &&
          Number.isFinite(value.start_ms) &&
          value.start_ms >= 0 &&
          typeof value.end_ms === "number" &&
          Number.isFinite(value.end_ms) &&
          value.end_ms >= value.start_ms,
        "live_media_invalid_provider_event",
      );
      return {
        ...base,
        delta: value.delta,
        start_ms: value.start_ms,
        end_ms: value.end_ms,
      };
    }
    if (value.type === "session.delegation.created") {
      check(
        identifier(value.event_id) &&
          typeof value.offset_ms === "number" &&
          Number.isFinite(value.offset_ms) &&
          value.offset_ms >= 0 &&
          object(value.delegation) &&
          identifier(value.delegation.id) &&
          value.delegation.target === "client",
        "live_media_invalid_provider_event",
      );
      return {
        ...base,
        offset_ms: value.offset_ms,
        delegation: {
          id: value.delegation.id,
          type: "delegation",
          target: "client",
        },
      };
    }
    if (value.type === "error") {
      check(object(value.error), "live_media_invalid_provider_event");
      return {
        ...base,
        error: {
          ...(identifier(value.error.client_event_id)
            ? { client_event_id: value.error.client_event_id }
            : {}),
        },
      };
    }
    return null;
  }
  private async message(resources: Resources, data: unknown) {
    this.active(resources);
    const binding = resources.binding!,
      event = this.event(data, binding.sessionId);
    if (!event) return;
    if (event.type === "session.started") {
      if (resources.started) return;
      resources.started = true;
      this.publish({ providerInputMute: "unmuted" });
      this.applyMute(resources);
    }
    if (
      event.type === "session.input_audio.muted" ||
      event.type === "session.input_audio.unmuted"
    ) {
      const id = String(event.client_event_id),
        expected = resources.pending.get(id),
        observed =
          event.type === "session.input_audio.muted" ? "muted" : "unmuted";
      if (expected === observed) {
        resources.pending.delete(id);
        if (resources.latestMuteId === id) {
          this.publish({ providerInputMute: observed });
          this.applyMute(resources);
        }
      }
    }
    if (
      event.type === "error" &&
      object(event.error) &&
      typeof event.error.client_event_id === "string" &&
      resources.pending.delete(event.error.client_event_id)
    ) {
      this.publish({ providerInputMute: "unknown" });
      this.applyMute(resources);
    }
    await binding.onEvent(event);
    if (event.type === "session.closed")
      await this.release(resources, "closed");
  }
  private lost(resources: Resources) {
    if (this.resources !== resources || resources.expectedClose) return;
    const binding = resources.binding;
    void this.release(resources, "failed").catch(() => {});
    try {
      binding?.onConnectionLost();
    } catch {
      /* Local cleanup is still complete. */
    }
  }
  private async sink(resources: Resources, deviceId: string) {
    const audio = resources.audio;
    check(
      typeof audio.setSinkId === "function",
      "live_media_output_selection_unsupported",
    );
    await this.bounded(
      () => audio.setSinkId(deviceId),
      "live_media_output_device_unavailable",
      resources.abort.signal,
    );
    this.active(resources);
    check(audio.sinkId === deviceId, "live_media_output_device_mismatch");
  }
  async setOutputDevice(deviceId: string): Promise<void> {
    const resources = this.resources;
    check(resources && identifier(deviceId), "live_media_invalid_device");
    check(!this.outputChanging, "live_media_device_change_busy");
    this.outputChanging = true;
    const resume = this.stateValue.playback === "playing";
    resources.audio.pause();
    try {
      await this.sink(resources, deviceId === "default" ? "" : deviceId);
      resources.outputId = deviceId === "default" ? undefined : deviceId;
      this.publish({
        outputDevice: resources.outputId ? "selected" : "default",
        errorCode: undefined,
      });
      if (resume) await this.resumePlayback();
    } catch (error) {
      if (this.resources === resources)
        this.publish({
          errorCode:
            error instanceof GptLiveMediaError
              ? error.code
              : "live_media_output_device_unavailable",
        });
      throw error instanceof GptLiveMediaError
        ? error
        : new GptLiveMediaError("live_media_output_device_unavailable");
    } finally {
      this.outputChanging = false;
    }
  }
  async setInputDevice(deviceId: string): Promise<void> {
    const resources = this.resources;
    check(
      resources?.sender && !resources.captureQuiesced && identifier(deviceId),
      "live_media_invalid_device",
    );
    check(!this.inputChanging, "live_media_device_change_busy");
    this.inputChanging = true;
    let stream: MediaStream | undefined;
    try {
      stream = await this.microphone(
        resources,
        deviceId === "default" ? undefined : deviceId,
      );
      this.active(resources);
      const track = stream.getAudioTracks()[0];
      track.enabled =
        !resources.localMuted &&
        this.stateValue.providerInputMute === "unmuted";
      await this.bounded(
        () => resources.sender!.replaceTrack(track),
        "live_media_input_device_unavailable",
        AbortSignal.any([resources.abort.signal,resources.captureAbort.signal]),
      );
      this.active(resources);
      check(!resources.captureQuiesced,'live_media_replaced');
      const previous = resources.local;
      resources.local = stream;
      resources.inputId = deviceId === "default" ? undefined : deviceId;
      for (const old of previous?.getTracks() ?? []) old.stop();
      if(previous)resources.localAllocations.delete(previous);
      this.inputTrack(resources);
      resources.localAnalysis?.source.disconnect();
      resources.localAnalysis?.analyser.disconnect();
      resources.localAnalysis = resources.context
        ? this.analyse(resources.context, stream)
        : undefined;
      this.publish({
        inputDevice: resources.inputId ? "selected" : "default",
        errorCode: undefined,
      });
      this.applyMute(resources);
    } catch (error) {
      for (const track of stream?.getTracks() ?? []) track.stop();
      if(stream)resources.localAllocations.delete(stream);
      if (this.resources === resources) {
        resources.localMuted = true;
        this.applyMute(resources);
        this.publish({
          errorCode:
            error instanceof GptLiveMediaError
              ? error.code
              : "live_media_input_device_unavailable",
        });
      }
      throw error instanceof GptLiveMediaError
        ? error
        : new GptLiveMediaError("live_media_input_device_unavailable");
    } finally {
      this.inputChanging = false;
    }
  }
  private async remoteTrack(resources: Resources, event: RTCTrackEvent) {
    if (
      this.resources !== resources ||
      resources.captureQuiesced ||
      !resources.binding ||
      event.track.kind !== "audio"
    ) {
      event.track.stop();
      return;
    }
    const existing = resources.remote.getAudioTracks();
    if (existing.includes(event.track)) return;
    for (const track of existing)
      if (track.readyState === "ended") resources.remote.removeTrack(track);
    if (resources.remote.getAudioTracks().length >= 2) {
      event.track.stop();
      throw new GptLiveMediaError("live_media_remote_track_capacity");
    }
    resources.remote.addTrack(event.track);
    resources.audio.srcObject = resources.remote;
    this.listen(resources, event.track, "ended", () => {
      if (
        this.resources === resources &&
        resources.remote
          .getAudioTracks()
          .every((track) => track.readyState === "ended")
      ) {
        resources.audio.pause();
        this.publish({ playback: "ended", remoteSignal: "silent" });
      }
    });
    resources.remoteAnalysis?.source.disconnect();
    resources.remoteAnalysis?.analyser.disconnect();
    resources.remoteAnalysis = resources.context
      ? this.analyse(resources.context, resources.remote)
      : undefined;
    await this.resumePlayback();
  }
  async resumePlayback(): Promise<void> {
    const resources = this.resources;
    check(
      resources &&
        !resources.captureQuiesced &&
        resources.remote
          .getAudioTracks()
          .some((track) => track.readyState === "live"),
      "live_media_no_remote_audio",
    );
    this.publish({ playback: "pending", interruption: "none" });
    try {
      await this.bounded(
        () => resources.audio.play(),
        "live_media_playback_blocked",
        resources.abort.signal,
      );
      this.active(resources);
      this.publish({ errorCode: undefined });
    } catch {
      if (this.resources === resources)
        this.publish({
          playback: "blocked",
          errorCode: "live_media_playback_blocked",
        });
      throw new GptLiveMediaError("live_media_playback_blocked");
    }
  }
  interruptPlayback(): void {
    const resources = this.resources;
    check(resources, "live_media_not_prepared");
    this.publish({ playback: "interrupted", interruption: "explicit-user" });
    resources.audio.pause();
  }
  private analyse(context: AudioContext, stream: MediaStream): Analysis {
    const source = context.createMediaStreamSource(stream),
      analyser = context.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    return { source, analyser, values: new Float32Array(256) };
  }
  private async analysis(resources: Resources) {
    if (!this.environment.createAudioContext) return;
    try {
      resources.context = this.environment.createAudioContext();
      await this.bounded(
        () => resources.context!.resume(),
        "live_media_analysis_unavailable",
        resources.abort.signal,
      );
      this.active(resources);
      resources.localAnalysis = this.analyse(
        resources.context,
        resources.local!,
      );
      resources.stopAnalysis = this.environment.schedule(
        () => this.sample(resources),
        this.intervalMs,
      );
    } catch {
      if (this.resources === resources)
        this.publish({
          localSpeech: "unavailable",
          remoteSignal: "unavailable",
        });
    }
  }
  private energy(analysis: Analysis): number {
    analysis.analyser.getFloatTimeDomainData(analysis.values);
    let total = 0;
    for (const sample of analysis.values) total += sample * sample;
    return Math.sqrt(total / analysis.values.length);
  }
  private sample(resources: Resources) {
    if (this.resources !== resources) return;
    if (resources.context?.state !== "running") {
      if (
        this.stateValue.localSpeech !== "unavailable" ||
        this.stateValue.remoteSignal !== "unavailable"
      )
        this.publish({
          localSpeech: "unavailable",
          remoteSignal: "unavailable",
          interruption:
            this.stateValue.interruption === "explicit-user"
              ? "explicit-user"
              : "none",
        });
      return;
    }
    const loud =
      this.stateValue.localTrackEnabled &&
      this.stateValue.localSourceMuted !== true &&
      !!resources.localAnalysis &&
      this.energy(resources.localAnalysis) >= 0.025;
    resources.loudFrames = loud ? Math.min(3, resources.loudFrames + 1) : 0;
    resources.quietFrames = loud ? 0 : Math.min(5, resources.quietFrames + 1);
    const localSpeech =
      resources.loudFrames >= 3
        ? "detected"
        : resources.quietFrames >= 5
          ? "silent"
          : this.stateValue.localSpeech;
    const remoteSignal = resources.remoteAnalysis
      ? this.energy(resources.remoteAnalysis) >= 0.015
        ? "detected"
        : "silent"
      : "unavailable";
    const interruption =
      this.stateValue.interruption === "explicit-user"
        ? "explicit-user"
        : localSpeech === "detected" &&
            remoteSignal === "detected" &&
            this.stateValue.playback === "playing"
          ? "inferred-local-barge-in"
          : "none";
    if (
      localSpeech !== this.stateValue.localSpeech ||
      remoteSignal !== this.stateValue.remoteSignal ||
      interruption !== this.stateValue.interruption
    )
      this.publish({ localSpeech, remoteSignal, interruption });
  }
  private async release(
    resources: Resources,
    connection: "closed" | "failed" | "disposed",
  ) {
    if (this.resources !== resources) return;
    this.resources = undefined;
    this.cleaning = true;
    resources.expectedClose = true;
    resources.abort.abort();
    resources.captureAbort.abort();
    resources.stopAnalysis?.();
    for (const remove of [
      ...resources.listeners.splice(0),
      ...resources.inputListeners.splice(0),
    ])
      remove();
    resources.pending.clear();
    for (const stream of [...resources.localAllocations, resources.remote])
      for (const track of stream?.getTracks() ?? []) {
        try {
          track.stop();
        } catch {
          /* Continue owned resource cleanup. */
        }
      }
    resources.localAllocations.clear();
    try {
      resources.channel.close();
    } catch {}
    try {
      resources.peer.close();
    } catch {}
    try {
      resources.audio.pause();
      resources.audio.srcObject = null;
      resources.audio.removeAttribute("src");
      resources.audio.load();
    } catch {}
    for (const analysis of [
      resources.localAnalysis,
      resources.remoteAnalysis,
    ]) {
      try {
        analysis?.source.disconnect();
        analysis?.analyser.disconnect();
      } catch {}
    }
    this.publish({
      connection: this.disposed ? "disposed" : connection,
      microphoneAccess: resources.local
        ? "released"
        : this.stateValue.microphoneAccess,
      localTrackEnabled: false,
      localSourceMuted: null,
      providerInputMute: "unknown",
      playback: "idle",
      localSpeech: "unavailable",
      remoteSignal: "unavailable",
      interruption: "none",
    });
    if (resources.context) {
      try {
        await this.bounded(
          () => resources.context!.close(),
          "live_media_analysis_unavailable",
        );
      } catch {}
    }
    this.cleaning = false;
    if (this.disposed) this.publish({ connection: "disposed" });
  }
  /** Expected channel closure and disposal never fabricate session.closed or final usage. */
  async quiesceCapture(expectedSessionId?:string):Promise<void>{
    const resources=this.resources;if(!resources)return;
    check(expectedSessionId===undefined||resources.binding?.sessionId===expectedSessionId,'live_media_session_mismatch');
    resources.captureQuiesced=true;resources.captureAbort.abort();resources.localMuted=true;resources.stopAnalysis?.();resources.stopAnalysis=undefined;
    for(const remove of resources.inputListeners.splice(0))remove();
    for(const stream of [...resources.localAllocations,resources.remote])for(const track of stream.getTracks()){try{track.enabled=false;track.stop();}catch{/* Stop every owned track. */}}
    resources.localAllocations.clear();
    try{resources.audio.pause();resources.audio.srcObject=null;resources.audio.removeAttribute('src');resources.audio.load();}catch{/* Continue physical release. */}
    for(const analysis of [resources.localAnalysis,resources.remoteAnalysis]){try{analysis?.source.disconnect();analysis?.analyser.disconnect();}catch{/* No audio analysis is retained. */}}
    resources.localAnalysis=resources.remoteAnalysis=undefined;
    this.publish({microphoneAccess:'released',localTrackEnabled:false,localSourceMuted:null,playback:'interrupted',localSpeech:'unavailable',remoteSignal:'unavailable',interruption:'explicit-user'});
    const context=resources.context;resources.context=undefined;
    if(context)try{await this.bounded(()=>context.close(),'live_media_analysis_unavailable');}catch{/* Physical tracks and playback are already released. */}
    // Preserve peer, channel and provider event listeners to drain session.closed/usage.
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.resources) await this.release(this.resources, "disposed");
    else this.publish({ connection: "disposed", localTrackEnabled: false });
  }
}
export function createGptLiveMedia(
  options: GptLiveMediaOptions,
): BrowserGptLiveMedia {
  return new BrowserGptLiveMedia(options);
}
