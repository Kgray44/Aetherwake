/* Private local PCM framing. No model, persistence, network, transcript or microphone API. */
class VelaWakePcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.frame = new Float32Array(640); this.offset = 0; this.sequence = 0;
    this.pending = new Set(); this.failed = false;
    this.port.onmessage = event => {
      const value = event.data;
      if (value && Object.keys(value).length === 2 && value.kind === 'ack' && Number.isSafeInteger(value.sequence)) this.pending.delete(value.sequence);
    };
    if (sampleRate !== 16000) this.fail('wake_worklet_sample_rate');
  }
  fail(code) {
    if (this.failed) return; this.failed = true; this.frame.fill(0); this.pending.clear();
    try { this.port.postMessage({ kind: 'error', code }); } catch { /* Owner has stopped capture. */ }
  }
  process(inputs, outputs) {
    for (const output of outputs) for (const channel of output) channel.fill(0);
    if (this.failed) return false;
    const channels = inputs[0]; if (!channels?.length) return true;
    if (channels.length !== 1 || channels[0].length > 1024) { this.fail('wake_worklet_pcm_invalid'); return false; }
    for (const value of channels[0]) {
      if (!Number.isFinite(value) || Math.abs(value) > 1) { this.fail('wake_worklet_pcm_invalid'); return false; }
      this.frame[this.offset++] = value;
      if (this.offset !== 640) continue;
      if (this.pending.size >= 4) { this.fail('wake_worklet_backpressure'); return false; }
      const samples = this.frame, sequence = this.sequence++;
      let square = 0; for (const sample of samples) square += sample * sample;
      const rms = Math.sqrt(square / samples.length);
      this.pending.add(sequence);
      try { this.port.postMessage({ kind: 'frame', sequence, startSample: sequence * 640, sampleRate: 16000,
        samples, signalActivity: rms >= 0.01 ? 'signal' : 'quiet', rms }, [samples.buffer]); }
      catch { this.fail('wake_worklet_closed'); return false; }
      this.frame = new Float32Array(640); this.offset = 0;
    }
    return true;
  }
}
registerProcessor('vela-wake-pcm', VelaWakePcmProcessor);
