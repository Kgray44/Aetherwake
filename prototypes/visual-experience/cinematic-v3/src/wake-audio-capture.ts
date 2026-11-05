export const WAKE_CAPTURE_LIMITS = Object.freeze({ sampleRate: 16000, frameSamples: 640, pendingFrames: 4, framesPerSecond: 64 });
export interface WakePcmFrame {
  generation: number; sequence: number; startSample: number; sampleRate: 16000; samples: Float32Array;
  signalActivity: 'quiet' | 'signal'; rms: number; mode: 'detector' | 'handoff';
}
export interface WakeCaptureState {
  contract: 'aerynth.wake-audio-capture@1'; generation: number | null;
  phase: 'off' | 'arming' | 'capturing' | 'handoff' | 'stopped' | 'failed' | 'disposed';
  microphone: 'off' | 'requesting' | 'active' | 'released' | 'unknown'; sampleRate: 16000 | null;
  inputDevice: 'default' | 'selected'; frames: number; pendingFrames: number;
  signalActivity: 'unavailable' | 'quiet' | 'signal'; activitySource: 'local-rms-only'; errorCode?: string;
}
export interface WakeCaptureEnvironment {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  createContext(): AudioContext;
  createWorklet(context: AudioContext): AudioWorkletNode;
  /** Private synthetic source starts only after the consumer graph is ready, so no fixture prefix is lost. */
  startSource?(): Promise<void>;
  now(): number;
}
interface Options {
  workletUrl: string; onFrame(frame: WakePcmFrame): Promise<void>; onState?(state: WakeCaptureState): void;
  environment?: Partial<WakeCaptureEnvironment>;
}
const exact = (value: any, keys: string[]) => !!value && typeof value === 'object' && !Array.isArray(value) &&
  Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value'));
export function validWakeWorkletFrame(value: any): boolean {
  try{const valid=exact(value, ['kind', 'sequence', 'startSample', 'sampleRate', 'samples', 'signalActivity', 'rms']) && value.kind === 'frame' &&
    Number.isSafeInteger(value.sequence) && value.sequence >= 0 && Number.isSafeInteger(value.startSample) && value.startSample === value.sequence * 640 &&
    value.sampleRate === 16000 && value.samples instanceof Float32Array && !(value.samples.buffer instanceof SharedArrayBuffer) && value.samples.length === 640 &&
    value.samples.byteLength === 2560 && value.samples.every((sample: number) => Number.isFinite(sample) && Math.abs(sample) <= 1) &&
    ['quiet', 'signal'].includes(value.signalActivity) && Number.isFinite(value.rms) && value.rms >= 0 && value.rms <= 1 &&
    value.signalActivity === (value.rms >= 0.01 ? 'signal' : 'quiet');
    if(!valid)return false;let square=0;for(const sample of value.samples)square+=sample*sample;
    return Math.abs(Math.sqrt(square/640)-value.rms)<=1e-6;
  }catch{return false;}
}
/** Private local capture only. The native adapter authorizes arm and owns the worklet URL.
 * RMS describes signal activity, never recognized speech. No PCM is stored or exposed in state. */
export class WakeAudioCapture {
  private readonly options: Options; private readonly environment: WakeCaptureEnvironment;
  private epoch = 0; private closed = false; private stream: MediaStream | null = null; private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null; private worklet: AudioWorkletNode | null = null; private gain: GainNode | null = null;
  private activeFrames = new Set<Float32Array>(); private rateAt = 0; private rate = 0; private sequence = 0;
  private view: WakeCaptureState = { contract: 'aerynth.wake-audio-capture@1', generation: null, phase: 'off', microphone: 'off',
    sampleRate: null, inputDevice: 'default', frames: 0, pendingFrames: 0, signalActivity: 'unavailable', activitySource: 'local-rms-only' };
  constructor(options: Options) {
    if (!/^file:\/\//u.test(options.workletUrl)) throw Error('wake_capture_worklet_url');
    this.options = options; this.environment = {
      getUserMedia: constraints => navigator.mediaDevices.getUserMedia(constraints),
      createContext: () => new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' }),
      createWorklet: context => new AudioWorkletNode(context, 'vela-wake-pcm', { numberOfInputs: 1, numberOfOutputs: 1,
        outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' }),
      now: () => performance.now(), ...options.environment,
    };
  }
  state(): WakeCaptureState { return { ...this.view }; }
  private publish(patch: Partial<WakeCaptureState>) { this.view = { ...this.view, ...patch }; try { this.options.onState?.(this.state()); } catch { /* State observers cannot retain capture. */ } }
  private alive(epoch: number) { return !this.closed && epoch === this.epoch; }
  async start(input: { generation: number; inputDeviceId?: string }): Promise<WakeCaptureState> {
    if (this.closed) throw Error('wake_capture_disposed');
    if (!Number.isSafeInteger(input.generation) || input.generation < 1 || input.inputDeviceId !== undefined &&
      (typeof input.inputDeviceId !== 'string' || !input.inputDeviceId.length || input.inputDeviceId.length > 256)) throw Error('wake_capture_input');
    if (['arming', 'capturing', 'handoff'].includes(this.view.phase)) throw Error('wake_capture_busy');
    const epoch = ++this.epoch; this.sequence = 0; this.rateAt = this.environment.now(); this.rate = 0;
    this.view = { ...this.view, generation: input.generation, phase: 'arming', microphone: 'requesting', sampleRate: null,
      inputDevice: input.inputDeviceId ? 'selected' : 'default', frames: 0, pendingFrames: 0, signalActivity: 'unavailable' }; delete this.view.errorCode; this.publish({});
    let stream: MediaStream | null = null, context: AudioContext | null = null;
    try {
      stream = await this.environment.getUserMedia({ video: false, audio: { channelCount: { ideal: 1 }, sampleRate: { ideal: 16000 },
        echoCancellation: true, noiseSuppression: true, autoGainControl: false, ...(input.inputDeviceId ? { deviceId: { exact: input.inputDeviceId } } : {}) } });
      if (!this.alive(epoch)) { for (const track of stream.getTracks()) track.stop(); return this.state(); }
      if (stream.getVideoTracks().length || stream.getAudioTracks().length !== 1) throw Error('wake_capture_tracks');
      this.stream = stream; context = this.environment.createContext(); this.context = context;
      if (context.sampleRate !== 16000) throw Error('wake_capture_sample_rate');
      await context.audioWorklet.addModule(this.options.workletUrl);
      if (!this.alive(epoch)) { for (const track of stream.getTracks()) track.stop(); await context.close().catch(() => {}); return this.state(); }
      const worklet = this.environment.createWorklet(context); this.worklet = worklet;
      const source = context.createMediaStreamSource(stream), gain = context.createGain(); this.source = source; this.gain = gain;
      gain.gain.value = 0; worklet.port.onmessage = event => { void this.frame(event.data, epoch); };
      worklet.onprocessorerror = () => { if (this.alive(epoch)) void this.fail('wake_capture_processor_failed'); };
      for (const track of stream.getTracks()) track.onended = () => { if (this.alive(epoch)) void this.fail('wake_capture_device_ended'); };
      source.connect(worklet); worklet.connect(gain); gain.connect(context.destination);
      this.publish({ phase: 'capturing', microphone: 'active', sampleRate: 16000 });await context.resume();
      if (!this.alive(epoch)) {
        for(const track of stream.getTracks())track.stop();
        worklet.port.onmessage=null;worklet.onprocessorerror=null;worklet.port.close();
        for(const node of [source,worklet,gain])try{node.disconnect();}catch{/* Old generation only. */}
        await context.close().catch(()=>{});return this.state();
      }
      await this.environment.startSource?.();
      return this.state();
    } catch {
      if (stream && stream !== this.stream) for (const track of stream.getTracks()) track.stop();
      if (context && context !== this.context) await context.close().catch(() => {});
      if (this.alive(epoch)) await this.fail('wake_capture_start_failed');
      return this.state();
    }
  }
  pause(generation: number) {
    if (generation !== this.view.generation || !['capturing', 'handoff'].includes(this.view.phase)) throw Error('wake_capture_generation');
    this.publish({ phase: 'handoff' }); return this.state();
  }
  private async frame(value: any, epoch: number) {
    if (!this.alive(epoch) || !['capturing', 'handoff'].includes(this.view.phase)) return;
    if (value?.kind === 'error') { await this.fail('wake_capture_processor_failed'); return; }
    const now = this.environment.now(); if (now < this.rateAt || now - this.rateAt >= 1000) { this.rateAt = now; this.rate = 0; }
    if (!validWakeWorkletFrame(value) || value.sequence !== this.sequence || this.activeFrames.size >= 4 || ++this.rate > 64) { await this.fail('wake_capture_frame_invalid'); return; }
    const samples: Float32Array = value.samples; this.activeFrames.add(samples); this.sequence++;
    // Frame-rate telemetry stays in the private pull state; do not emit a UI/journal event for every PCM block.
    this.view={...this.view,frames:this.sequence,pendingFrames:this.activeFrames.size,signalActivity:value.signalActivity};
    try {
      await this.options.onFrame({ generation: this.view.generation!, sequence: value.sequence, startSample: value.startSample, sampleRate: 16000,
        samples, signalActivity: value.signalActivity, rms: value.rms, mode: this.view.phase === 'handoff' ? 'handoff' : 'detector' });
      if (this.alive(epoch)) this.worklet?.port.postMessage({ kind: 'ack', sequence: value.sequence });
    } catch { if (this.alive(epoch)) await this.fail('wake_capture_frame_delivery_failed'); }
    finally { samples.fill(0); this.activeFrames.delete(samples); if (this.alive(epoch)) this.view={...this.view,pendingFrames:this.activeFrames.size}; }
  }
  private release(): Promise<void> {
    const stream = this.stream, context = this.context, source = this.source, worklet = this.worklet, gain = this.gain;
    this.stream = this.context = this.source = this.worklet = this.gain = null;
    for (const samples of this.activeFrames) samples.fill(0); this.activeFrames.clear();
    for (const track of stream?.getTracks() ?? []) { track.onended = null; try { track.stop(); } catch { /* Continue independent releases. */ } }
    for (const node of [source, worklet, gain]) try { node?.disconnect(); } catch { /* Continue context release. */ }
    if (worklet) { worklet.port.onmessage = null; worklet.onprocessorerror = null; try { worklet.port.close(); } catch { /* Already closed. */ } }
    return context ? context.close().catch(() => {}) : Promise.resolve();
  }
  private async fail(code: string) { ++this.epoch; const released = this.release(); this.publish({ phase: 'failed', microphone: 'released', sampleRate: null, pendingFrames: 0, errorCode: code }); await released; }
  async stop(generation?: number): Promise<WakeCaptureState> {
    if (generation !== undefined && generation !== this.view.generation) return this.state();
    ++this.epoch; const released = this.release(); this.publish({ phase: this.closed ? 'disposed' : 'stopped', microphone: 'released', sampleRate: null, pendingFrames: 0, signalActivity: 'unavailable' });
    await released; return this.state();
  }
  async dispose() { this.closed = true; return this.stop(); }
}
