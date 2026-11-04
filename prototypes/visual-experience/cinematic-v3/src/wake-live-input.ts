/** Audio for one native-authorized wake activation. The same physical capture
 * continues in Main; this private media window receives only the command tail
 * and its subsequent contiguous frames, never a second microphone stream. */
export class WakeLiveInput {
  private readonly context: AudioContext;
  private readonly destination: MediaStreamAudioDestinationNode;
  private readonly queued: Float32Array[] = [];
  private readonly playing = new Set<{ source: AudioBufferSourceNode; buffer: AudioBuffer; length: number }>();
  private nextSample = 0;
  private retained = 0;
  private nextTime = 0;
  private active = false;
  private closed = false;
  readonly stream: MediaStream;
  constructor(createContext: () => AudioContext = () => new AudioContext({sampleRate:16000})) {
    this.context = createContext();
    if (this.context.sampleRate !== 16000) { void this.context.close(); throw Error('wake_live_sample_rate'); }
    this.destination = this.context.createMediaStreamDestination(); this.stream = this.destination.stream;
  }
  append(startSample: number, samples: Float32Array) {
    if (this.closed || !(samples instanceof Float32Array) || samples.buffer instanceof SharedArrayBuffer || samples.length < 1 || samples.length > 640 ||
        startSample !== this.nextSample || !samples.every(value=>Number.isFinite(value)&&Math.abs(value)<=1) || this.retained + samples.length > 128000)
      throw Error('wake_live_frame_invalid');
    const copy = new Float32Array(samples); this.nextSample += copy.length; this.retained += copy.length;
    if (this.active) this.schedule(copy); else this.queued.push(copy);
  }
  async activate() {
    if (this.closed) throw Error('wake_live_closed'); if(this.active)return;
    await this.context.resume(); if(this.closed)throw Error('wake_live_closed');
    if(this.active)return;
    if(this.context.state!=='running')throw Error('wake_live_audio_unavailable');
    this.active=true;this.nextTime=this.context.currentTime+.02;
    while(this.queued.length)this.schedule(this.queued.shift()!);
  }
  private schedule(samples: Float32Array) {
    let source: AudioBufferSourceNode | undefined, buffer: AudioBuffer | undefined;
    try {
      buffer=this.context.createBuffer(1,samples.length,16000);buffer.getChannelData(0).set(samples);
      source=this.context.createBufferSource();source.buffer=buffer;source.connect(this.destination);
      const entry={source,buffer,length:samples.length};this.playing.add(entry);
      source.onended=()=>{if(!this.playing.delete(entry))return;this.retained-=entry.length;entry.buffer.getChannelData(0).fill(0);entry.source.disconnect();entry.source.onended=null;};
      const at=Math.max(this.nextTime,this.context.currentTime+.005);source.start(at);this.nextTime=at+samples.length/16000;
    } catch {
      buffer?.getChannelData(0).fill(0);try{source?.disconnect();}catch{}
      this.quiesce();throw Error('wake_live_audio_unavailable');
    } finally { samples.fill(0); }
  }
  /** Synchronous local release; closing the provider is a separate operation. */
  quiesce() {
    if(this.closed)return;this.closed=true;this.active=false;
    for(const samples of this.queued)samples.fill(0);this.queued.splice(0);
    for(const entry of this.playing){entry.source.onended=null;try{entry.source.stop();}catch{}try{entry.source.disconnect();}catch{}entry.buffer.getChannelData(0).fill(0);}this.playing.clear();
    this.retained=0;for(const track of this.stream.getTracks())track.stop();
    try{this.destination.disconnect();}catch{}
  }
  async dispose() { this.quiesce(); await this.context.close().catch(()=>{}); }
  state(){return {active:this.active,closed:this.closed,retainedSamples:this.retained,receivedSamples:this.nextSample,maximumSamples:128000};}
}
