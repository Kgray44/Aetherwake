import test from 'node:test';
import assert from 'node:assert/strict';
import { velaVisualState } from '../src/vela-visual-state.ts';
import { OPERATIONAL_VELA_SHAPES, velaCenter } from '../src/vela-shape.ts';

test('all thirteen visual states require explicit observed inputs, with truthful voice and verification', () => {
  const cases = [
    [{}, 'idle'], [{panelPhase:'receiving'}, 'aware'],
    [{wake:{phase:'ARMED',detector:'armed',microphone:'wake-only'}}, 'wake-armed'],
    [{voice:{active:true,microphoneOn:true,speaking:false}}, 'listening'],
    [{pendingRequest:true}, 'interpreting'], [{planning:true}, 'planning'], [{applying:true}, 'acting'],
    [{mission:{outcome:'running',runningTasks:2,waits:0}}, 'coordinating'],
    [{voice:{active:true,microphoneOn:false,speaking:true}}, 'speaking'],
    [{mission:{outcome:'running',runningTasks:0,waits:2}}, 'waiting'],
    [{needsInput:true}, 'needs-input'], [{mission:{outcome:'verified',runningTasks:0,waits:0}}, 'verified'],
    [{mission:{outcome:'uncertain',runningTasks:0,waits:0}}, 'blocked'],
  ];
  for (const [input, expected] of cases) assert.equal(velaVisualState(input), expected);
  assert.equal(new Set(cases.map(([, state]) => state)).size, 13);
  assert.equal(velaVisualState({voice:{active:true,microphoneOn:false,speaking:false}}), 'idle', 'a connected session is not listening or speaking');
  assert.equal(velaVisualState({wake:{phase:'ARMED',detector:'starting',microphone:'unknown'}}), 'idle');
  assert.equal(velaVisualState({mission:{outcome:'completed',runningTasks:0,waits:0}}), 'idle', 'reported completion is not verification');
  assert.equal(velaVisualState({mission:{outcome:'failed',runningTasks:0,waits:0},voice:{active:true,microphoneOn:true,speaking:false}}), 'blocked');
});

test('all operational target silhouettes differ without color and retain nonsingular transported frames through morphs', () => {
  const shapes = Object.values(OPERATIONAL_VELA_SHAPES), signatures = new Set();
  for (const shape of shapes) signatures.add(Array.from({length:64}, (_, i) => velaCenter(i / 64 * 2 * Math.PI, shape).slice(0,2).map(v=>v.toFixed(3)).join(',')).join(';'));
  assert.equal(signatures.size, 13);
  for (const from of shapes) for (const to of shapes) for (const weight of [0,.25,.5,.75,1]) {
    const shape = Object.fromEntries(Object.keys(from).map(key => [key, from[key] + (to[key] - from[key]) * weight]));
    for (let i=0;i<256;i++) {
      const p=velaCenter(i/256*2*Math.PI,shape);
      assert(p.every(Number.isFinite)); assert(Math.hypot(p[3],p[4])>.001, 'normal frame must stay defined');
    }
  }
});
