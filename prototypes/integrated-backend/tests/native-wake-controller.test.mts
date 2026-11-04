import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createNativeWakeController } from '../src/native-wake-controller.mts';

function fixture() {
  let frame!: Parameters<Parameters<typeof createNativeWakeController>[0]['capture']>[0], stamp = 1000;
  let state = { contract: 'aerynth.wake-audio-capture@1', generation: null as number | null, phase: 'off', microphone: 'off', sampleRate: null as number | null, inputDevice: 'default', frames: 0, pendingFrames: 0, signalActivity: 'unavailable', activitySource: 'local-rms-only' };
  const waiting = new Map<string, (value: any) => void>(), deliveries: any[] = [];
  const controller = createNativeWakeController({ now: () => stamp,
    capture: handler => { frame = handler; return {
      authorizeArm: () => 'private-grant',
      arm: async input => { state = { ...state, generation: input.generation, phase: 'capturing', microphone: 'active', sampleRate: 16000 }; return state as any; },
      pause: async () => { state = { ...state, phase: 'handoff' }; return state as any; },
      stop: input => { if (input?.generation === undefined || input.generation === state.generation) state = { ...state, phase: 'stopped', microphone: 'released', sampleRate: null }; return state as any; },
      state: () => state as any, dispose: () => {},
    }; },
    call: async (name, input) => { deliveries.push({ name, input }); return { accepted: true }; },
    send: (wire: any) => waiting.get(wire.nativeWakeHost.id)?.(wire.nativeWakeHost),
  });
  const request = async (operation: string, payload: any) => {
    const id = randomUUID(), reply = new Promise<any>(resolve => waiting.set(id, resolve));
    assert.equal(controller.handle({ nativeWakeHost: { version: 1, kind: 'request', id, operation, payload } }), true);
    const result = await reply; waiting.delete(id); if (result.error) throw Error(result.error); return result.result;
  };
  const pcm = async (sequence: number, amplitude: number, mode: 'detector' | 'handoff' = 'detector', generation = 1) => {
    const samples = new Float32Array(640).fill(amplitude);
    await frame({ generation, sequence, startSample: sequence * 640, sampleRate: 16000, samples, signalActivity: amplitude >= .01 ? 'signal' : 'quiet', rms: Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / 640), mode }, new AbortController().signal);
    samples.fill(0);
  };
  return { controller, request, pcm, deliveries, advance: () => { stamp += 15001; } };
}
test('private capture handoff keeps fresh command samples, consumes once and wipes owned storage', async () => {
  const h = fixture();
  try {
    assert.equal(h.controller.state().allocatedBytes, 0);
    await h.request('arm', { generation: 1 });
    await h.pcm(0, .1); await h.pcm(1, .2);
    await h.request('pause', { generation: 1 });
    const lease = await h.request('lease', { generation: 1, keywordEndSample: 640, detectedAtSample: 1280 });
    assert.deepEqual(Object.keys(lease).sort(), ['leaseRef', 'postWakeSpeech']); assert.equal(lease.postWakeSpeech, 'unknown');
    await h.pcm(2, .3, 'handoff');
    const attempt = randomUUID(), audio = h.controller.consume(lease.leaseRef, attempt);
    assert.equal(audio.toSample, 1920); assert.equal(audio.fromSample, 0); // Explicit 80ms model-boundary overlap.
    assert.ok(audio.samples.at(-1)! > .29); assert.equal(h.controller.state().allocatedBytes, 0);
    assert.throws(() => h.controller.consume(lease.leaseRef, attempt), /wake_host_failed/);
    audio.release(); assert.ok(audio.samples.every(value => value === 0));
    assert.equal(h.deliveries.length, 3);
  } finally { h.controller.dispose(); }
});
test('stale leases and old generation teardown cannot consume or stop a new capture', async () => {
  const h = fixture();
  try {
    await h.request('arm', { generation: 1 }); await h.pcm(0, .2); await h.request('pause', { generation: 1 });
    const lease = await h.request('lease', { generation: 1, keywordEndSample: 320, detectedAtSample: 640 });
    h.advance(); assert.throws(() => h.controller.consume(lease.leaseRef, randomUUID()), /wake_host_failed/);
    await h.request('arm', { generation: 2 }); await h.request('stop', { generation: 1 });
    assert.equal(h.controller.state().generation, 2); assert.equal(h.controller.state().armed, true);
    await assert.rejects(h.pcm(0, .1, 'detector', 1), /wake_host_closed/);
    await h.request('stop', {}); assert.equal(h.controller.state().allocatedBytes, 0);
  } finally { h.controller.dispose(); }
});
