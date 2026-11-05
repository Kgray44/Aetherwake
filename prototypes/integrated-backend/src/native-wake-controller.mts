import { randomUUID } from 'node:crypto';
import { WakeAudioBuffer } from './wake-audio-buffer.mts';
import { createNativeWakeCaptureServer, encodeNativeWakeFrame, type NativeWakeCaptureServices, type NativeWakePcmFrame } from './wake-capture-host.mts';
import type { WakeCaptureState, WakePcmFrame } from '../../visual-experience/cinematic-v3/src/wake-audio-capture.ts';

interface Capture {
  authorizeArm(generation: number): string;
  arm(input: { generation: number; inputDeviceId?: string }, grant: string): Promise<WakeCaptureState>;
  pause(input: { generation: number }): Promise<WakeCaptureState>;
  stop(input?: { generation?: number }): WakeCaptureState;
  state(): WakeCaptureState;
  dispose(): void;
}
interface Options {
  capture(onFrame: (frame: WakePcmFrame, signal: AbortSignal) => Promise<void>): Capture;
  call(name: 'velaWakeFrame', input: NativeWakePcmFrame): Promise<unknown>;
  send(message: unknown): void;
  now?(): number;
}
/** Electron Main owns this volatile handoff. Only opaque lease references cross
 * the private Core bridge; raw PCM never enters a renderer API or event journal. */
export function createNativeWakeController(options: Options) {
  const now = options.now ?? Date.now, ring = new WakeAudioBuffer(4);
  let generation: number | null = null, handoff = false, closed = false;
  let live: {attemptId:string;generation:number;fromSample:number;nextSample:number;feed(frame:{startSample:number;samples:Float32Array}):Promise<void>} | null = null;
  const leases = new Map<string, { generation: number; end: number; expires: number }>();
  const claimedAttempts = new Set<string>();
  const purge = () => { leases.clear(); ring.dispose(); handoff = false; };
  const capture = options.capture(async (frame, signal) => {
    if (closed || signal.aborted || frame.generation !== generation) throw Error('wake_host_closed');
    if(live){
      if(frame.generation!==live.generation||frame.startSample!==live.nextSample)throw Error('wake_host_failed');
      const owner=live;owner.nextSample+=frame.samples.length;
      await owner.feed({startSample:frame.startSample-owner.fromSample,samples:frame.samples});return;
    }
    ring.append(frame.startSample, frame.samples);
    const result = await options.call('velaWakeFrame', encodeNativeWakeFrame(frame)) as { accepted?: boolean };
    if (result?.accepted !== true) throw Error('wake_host_failed');
  });
  const services: NativeWakeCaptureServices = {
    async arm(input) {
      if (closed || live) throw Error('wake_host_closed');
      const grant = capture.authorizeArm(input.generation);
      purge(); generation = input.generation; ring.arm();
      try { const result = await capture.arm(input, grant); if (closed || generation !== input.generation) throw Error('wake_host_closed'); return result; }
      catch { if (generation === input.generation) { generation = null; purge(); capture.stop(input); } throw Error('wake_host_failed'); }
    },
    async pause(input) {
      if (closed || input.generation !== generation) throw Error('wake_host_closed');
      const result = await capture.pause(input);
      if (generation !== input.generation || result.phase !== 'handoff') throw Error('wake_host_failed');
      handoff = true; return result;
    },
    async stop(input) {
      // A paid session owns the same physical capture after handoff. Disabling
      // only the detector must not sever separately authorized voice input.
      if(live&&input.generation===live.generation)return capture.state();
      if (input.generation === undefined || generation === input.generation) { generation = null; purge(); }
      return capture.stop(input);
    },
    async state() { return capture.state(); },
    async lease(input) {
      if (closed || !handoff || input.generation !== generation || input.detectedAtSample > ring.state().endSample) throw Error('wake_host_failed');
      for (const [ref, lease] of leases) if (lease.expires <= now()) leases.delete(ref);
      if (leases.size >= 2) throw Error('wake_host_capacity');
      const audio = ring.commandAfter(input.keywordEndSample, 0);
      try {
        if (audio.clipped) throw Error('wake_host_failed');
        // RMS is signal evidence, not speech recognition. Preserve uncertain
        // input and suppress a greeting rather than asserting that it is speech.
        const square = audio.samples.reduce((sum, sample) => sum + sample * sample, 0);
        const rms = audio.samples.length ? Math.sqrt(square / audio.samples.length) : 0;
        const postWakeSpeech = audio.samples.length >= 4000 && rms < .005 ? 'absent' as const : 'unknown' as const;
        const leaseRef = randomUUID(); leases.set(leaseRef, { generation: input.generation, end: input.keywordEndSample, expires: now() + 15000 });
        return { leaseRef, postWakeSpeech };
      } finally { audio.release(); }
    },
    async releaseLease({ leaseRef }) { return { released: leases.delete(leaseRef) }; },
  };
  const server = createNativeWakeCaptureServer(services, options.send);
  function claim(leaseRef:string,attemptId:string){
    const lease=leases.get(leaseRef);leases.delete(leaseRef);
    if(closed||live||!handoff||!lease||lease.expires<=now()||lease.generation!==generation||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(attemptId)||claimedAttempts.has(attemptId))throw Error('wake_host_failed');
    const audio=ring.commandAfter(lease.end);if(audio.clipped){audio.release();throw Error('wake_host_failed');}
    claimedAttempts.add(attemptId);if(claimedAttempts.size>128)claimedAttempts.delete(claimedAttempts.values().next().value!);return audio;
  }
  return {
    handle: server.handle,
    /** Call only from the private Live broker after its replacement input is
     * ready. The caller must release this copy after the owned media handoff. */
    consume(leaseRef: string, attemptId: string) {
      const audio=claim(leaseRef,attemptId);
      const prior = generation; generation = null; purge();
      try { capture.stop({ generation: prior! }); } catch { audio.release(); throw Error('wake_host_failed'); }
      return audio;
    },
    claimLive(leaseRef:string,attemptId:string,feed:(frame:{startSample:number;samples:Float32Array})=>Promise<void>){
      const audio=claim(leaseRef,attemptId);live={attemptId,generation:generation!,fromSample:audio.fromSample,nextSample:audio.toSample,feed};ring.dispose();return audio;
    },
    releaseLive(attemptId:string){
      if(live?.attemptId!==attemptId)return false;const prior=live.generation;live=null;generation=null;purge();capture.stop({generation:prior});return true;
    },
    state: () => ({ generation, handoff, leases: leases.size, liveAttemptId:live?.attemptId??null, ...ring.state() }),
    masterOffLocal() { live=null; generation = null; purge(); capture.stop({}); },
    dispose() { if (closed) return; closed = true; live=null; generation = null; server.dispose(); purge(); claimedAttempts.clear(); capture.dispose(); },
  };
}
