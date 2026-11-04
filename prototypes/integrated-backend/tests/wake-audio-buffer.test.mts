import test from 'node:test';
import assert from 'node:assert/strict';
import { WakeAudioBuffer } from '../src/wake-audio-buffer.mts';

test('OFF allocates no capture buffer; disable wipes and releases all retained PCM', () => {
  const buffer = new WakeAudioBuffer(); assert.equal(buffer.state().allocatedBytes, 0);
  assert.throws(() => buffer.append(0, new Float32Array([1])), /wake_audio_off/);
  buffer.arm(); buffer.append(0, new Float32Array([.1, .2, .3]));
  const storage = (buffer as any).storage as Float32Array; buffer.dispose();
  assert.ok(storage.every(value => value === 0)); assert.equal(buffer.state().allocatedBytes, 0);
  assert.equal(buffer.state().retainedSamples, 0);
});
test('wrap retains only the bounded local tail and command handoff excludes the earlier wake audio', () => {
  const buffer = new WakeAudioBuffer(1); buffer.arm();
  const first = Float32Array.from({length:16000}, (_, index) => index / 16000);
  buffer.append(0, first); buffer.append(16000, new Float32Array([.91, .92, .93]));
  assert.equal(buffer.state().retainedSamples, 16000); assert.equal(buffer.state().allocatedBytes, 64000);
  const command = buffer.commandAfter(16000, 0);
  assert.deepEqual([...command.samples], [...new Float32Array([.91, .92, .93])]);
  assert.equal(command.fromSample, 16000); assert.equal(command.toSample, 16003); assert.equal(command.clipped, false);
  command.release(); assert.ok(command.samples.every(value => value === 0)); buffer.dispose();
});
test('estimated keyword overlap is bounded, clipping is explicit, and rejected frames do not alter retained audio', () => {
  const buffer = new WakeAudioBuffer(1); buffer.arm();
  buffer.append(0, new Float32Array(16000).fill(.5)); buffer.append(16000, new Float32Array(16000).fill(.25));
  const original = buffer.state();
  for (const [offset, samples] of [[31999,new Float32Array([1])],[32000,new Float32Array([NaN])],[32000,new Float32Array(16001)] ] as const)
    assert.throws(() => buffer.append(offset, samples), /wake_audio_frame_invalid/);
  assert.deepEqual(buffer.state(), original);
  const tail = buffer.commandAfter(30000); assert.equal(tail.fromSample, 28720); assert.equal(tail.samples.length, 3280);
  const clipped = buffer.commandAfter(1000); assert.equal(clipped.clipped, true); assert.equal(clipped.fromSample, 16000);
  assert.throws(() => buffer.commandAfter(32001), /wake_audio_boundary_invalid/);
  assert.throws(() => buffer.commandAfter(30000, 500), /wake_audio_boundary_invalid/);
  tail.release(); clipped.release(); buffer.clear(); assert.equal(buffer.state().retainedSamples, 0);
  buffer.append(32000, new Float32Array([.75])); assert.equal(buffer.state().retainedSamples, 1); buffer.dispose();
});
