import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {sendToWindow}=createRequire(import.meta.url)('../native/host-lifecycle.cjs');
test('child events notify a live renderer without changing their payload',()=>{
  const sent=[],event={type:'backend/disconnected'};
  const win={isDestroyed:()=>false,webContents:{isDestroyed:()=>false,send:(...args)=>sent.push(args)}};
  assert.equal(sendToWindow(win,'application-event',event),true);assert.deepEqual(sent,[['application-event',event]]);
});
test('queued child exit after native window destruction never reads destroyed webContents',()=>{
  const win={isDestroyed:()=>true,get webContents(){throw new Error('Object has been destroyed')}};
  assert.equal(sendToWindow(win,'application-event',{}),false);assert.equal(sendToWindow(null,'application-event',{}),false);
});
test('renderer destruction before window destruction does not send into dead contents',()=>{
  const win={isDestroyed:()=>false,webContents:{isDestroyed:()=>true,send:()=>assert.fail('must not send')}};
  assert.equal(sendToWindow(win,'application-event',{}),false);
});
test('destruction between liveness check and send is contained',()=>{
  const win={isDestroyed:()=>false,webContents:{isDestroyed:()=>false,send:()=>{throw new Error('Object has been destroyed')}}};
  assert.doesNotThrow(()=>sendToWindow(win,'application-event',{}));assert.equal(sendToWindow(win,'application-event',{}),false);
});
