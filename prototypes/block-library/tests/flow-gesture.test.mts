import test from 'node:test';
import assert from 'node:assert/strict';
import { mountFlowGestures, flowOptions, type FlowCamera } from '../flow-gesture.ts';
import { mountStreamGraph } from '../stream-view.ts';
import { blockDocument } from './component-dom.mts';
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-8,`${a} matches ${b}`);
function fixture(t:any){const dom=blockDocument(),restore=dom.install();const viewport=dom.doc.createElement('div');dom.root.append(viewport);let camera:FlowCamera={x:20,y:20,zoom:1},enabled=true;let captured:number|null=null,focused:unknown;
viewport.setPointerCapture=(id:number)=>{captured=id;};viewport.releasePointerCapture=(id:number)=>{if(captured===id)captured=null;};viewport.focus=(value:unknown)=>{focused=value;dom.doc.activeElement=viewport;};
viewport.getBoundingClientRect=()=>({left:100,top:50,width:400,height:300});const gestures=mountFlowGestures(viewport,{enabled:()=>enabled,read:()=>camera,write:value=>{camera=value;}});t.after(()=>{gestures.dispose();restore();});
return{dom,viewport,gestures,get camera(){return camera;},get captured(){return captured;},get focused(){return focused;},disable(){enabled=false;gestures.cancel();}};}
const pointer={pointerId:4,button:0,isPrimary:true,clientX:150,clientY:90};
test('background Flow pan uses delivered final coordinates, captures pointer, and focuses without scrolling',t=>{const f=fixture(t);const outer=f.dom.doc.createElement('details');f.dom.root.append(outer);outer.append(f.viewport);f.viewport.fire('pointerdown',pointer);assert.equal(f.captured,4);assert.deepEqual(f.focused,{preventScroll:true});
f.viewport.fire('pointermove',{...pointer,pointerId:99,clientX:999});assert.equal(f.camera.x,20);
f.viewport.fire('pointerup',{...pointer,clientX:215,clientY:120});assert.deepEqual(f.camera,{x:85,y:50,zoom:1});assert.equal(f.captured,null);assert.equal(f.viewport.dataset.dragging,undefined);});
test('Escape restores an in-flight pan but idle Escape remains available to parent navigation',t=>{const f=fixture(t);f.viewport.fire('pointerdown',pointer);f.viewport.fire('pointermove',{...pointer,clientX:300});
let prevented=false,stopped=false;assert.equal(f.gestures.keydown({key:'Escape',preventDefault(){prevented=true;},stopPropagation(){stopped=true;}} as any),true);assert.ok(prevented&&stopped);assert.deepEqual(f.camera,{x:20,y:20,zoom:1});assert.equal(f.captured,null);
assert.equal(f.gestures.keydown({key:'Escape'} as any),false);});
test('wheel zoom preserves the world point under the delivered pointer with bounded zoom',t=>{const f=fixture(t),before={...f.camera};f.viewport.fire('wheel',{clientX:260,clientY:170,deltaY:-120,deltaMode:0});
const local={x:160,y:120};close((local.x-before.x)/before.zoom,(local.x-f.camera.x)/f.camera.zoom);close((local.y-before.y)/before.zoom,(local.y-f.camera.y)/f.camera.zoom);
f.viewport.fire('wheel',{clientX:260,clientY:170,deltaY:-100000,deltaMode:0});assert.equal(f.camera.zoom,2);f.viewport.fire('wheel',{clientX:260,clientY:170,deltaY:100000,deltaMode:0});assert.equal(f.camera.zoom,.3);});
test('task nodes do not pan; capture loss, access suspension and disposal cancel temporary transforms',t=>{const f=fixture(t),button=f.dom.doc.createElement('button');f.viewport.append(button);button.fire('pointerdown',pointer);assert.equal(f.captured,null);
for(const reason of ['pointercancel','lostpointercapture']){f.viewport.fire('pointerdown',pointer);f.viewport.fire('pointermove',{...pointer,clientX:300});f.viewport.fire(reason,pointer);assert.deepEqual(f.camera,{x:20,y:20,zoom:1});}
f.viewport.fire('pointerdown',pointer);f.viewport.fire('pointermove',{...pointer,clientX:300});f.disable();assert.deepEqual(f.camera,{x:20,y:20,zoom:1});assert.equal(f.captured,null);f.viewport.fire('wheel',{clientX:200,clientY:100,deltaY:-100});assert.equal(f.camera.zoom,1);
f.gestures.dispose();f.viewport.fire('pointerdown',pointer);assert.equal(f.captured,null);});
test('Flow precision controls are under one native disclosure; disabling cancels the actual mounted viewport drag',t=>{const dom=blockDocument(),restore=dom.install();const graph=mountStreamGraph(dom.root,{title:e=>e.type,metadata:()=>({}),open(){}});t.after(()=>{graph.dispose();restore();});
const menu=dom.root.querySelector('.aw-flow-options');assert.equal(menu.tagName,'DETAILS');assert.equal(menu.open,false);assert.equal(menu.firstChild.getAttribute('aria-label'),'Flow options');assert.ok(menu.querySelectorAll('button').length>=8);assert.equal(dom.root.querySelector('.aw-stream').children.some((n:any)=>n.className==='aw-stream-controls'),false);
const viewport=dom.root.querySelector('.aw-stream-viewport'),scene=dom.root.querySelector('.aw-stream-scene');viewport.setPointerCapture=()=>{};viewport.releasePointerCapture=()=>{};viewport.fire('pointerdown',pointer);viewport.fire('pointermove',{...pointer,clientX:230});assert.match(scene.style.transform,/translate\(100px, 20px\)/);graph.setAvailable(false);assert.match(scene.style.transform,/translate\(20px, 20px\)/);viewport.fire('pointerup',{...pointer,clientX:400});assert.match(scene.style.transform,/translate\(20px, 20px\)/);});
