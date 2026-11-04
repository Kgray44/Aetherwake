/** Local-only volatile PCM. Nothing in this type is a renderer, journal or provider DTO. */
export interface WakeCommandAudio {
  samples: Float32Array;
  sampleRate: 16000;
  fromSample: number;
  toSample: number;
  clipped: boolean;
  boundary: 'model-estimate-with-overlap';
  release(): void;
}
export class WakeAudioBuffer {
  readonly sampleRate = 16000 as const;
  private readonly capacity: number;
  private storage: Float32Array | null = null;
  private end = 0;
  private start = 0;
  constructor(seconds = 4) {
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 8) throw Error('wake_audio_bound_invalid');
    this.capacity = Math.floor(seconds * this.sampleRate);
  }
  arm(startSample = 0) {
    if (!Number.isSafeInteger(startSample) || startSample < 0) throw Error('wake_audio_offset_invalid');
    this.dispose(); this.storage = new Float32Array(this.capacity); this.start = this.end = startSample;
  }
  append(startSample: number, samples: Float32Array) {
    const buffer = this.storage;
    if (!buffer) throw Error('wake_audio_off');
    if (!Number.isSafeInteger(startSample) || startSample !== this.end || !(samples instanceof Float32Array) ||
        samples.length < 1 || samples.length > this.sampleRate || !Number.isSafeInteger(this.end + samples.length) ||
        !samples.every(Number.isFinite)) throw Error('wake_audio_frame_invalid');
    const offset = this.end % this.capacity, first = Math.min(samples.length, this.capacity - offset);
    buffer.set(samples.subarray(0, first), offset);
    if (first < samples.length) buffer.set(samples.subarray(first), 0);
    this.end += samples.length; this.start = Math.max(this.start, this.end - this.capacity);
  }
  commandAfter(keywordEndSample: number, overlapMs = 80): WakeCommandAudio {
    const buffer = this.storage;
    if (!buffer) throw Error('wake_audio_off');
    if (!Number.isSafeInteger(keywordEndSample) || keywordEndSample < 0 || keywordEndSample > this.end ||
        !Number.isFinite(overlapMs) || overlapMs < 0 || overlapMs > 160) throw Error('wake_audio_boundary_invalid');
    // Alignment is model-estimated. A small overlap protects an immediately
    // following command without uploading the whole wake-listening buffer.
    const requested = Math.max(0, keywordEndSample - Math.ceil(overlapMs * this.sampleRate / 1000));
    const fromSample = Math.max(this.start, requested), toSample = this.end;
    const samples = new Float32Array(toSample - fromSample), offset = fromSample % this.capacity;
    const first = Math.min(samples.length, this.capacity - offset);
    samples.set(buffer.subarray(offset, offset + first));
    if (first < samples.length) samples.set(buffer.subarray(0, samples.length - first), first);
    return { samples, sampleRate: this.sampleRate, fromSample, toSample, clipped: requested < this.start,
      boundary: 'model-estimate-with-overlap', release() { samples.fill(0); } };
  }
  clear() { this.storage?.fill(0); this.start = this.end; }
  dispose() { this.storage?.fill(0); this.storage = null; this.start = this.end = 0; }
  state() { return { armed: this.storage !== null, retainedSamples: this.end - this.start,
    allocatedBytes: this.storage?.byteLength ?? 0, startSample: this.start, endSample: this.end }; }
}
