import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { WorkspaceEngine } from '../engine.mts';
import { footprint, intersects, resolveCollisions } from '../collisions.mts';
import { previewLayout } from '../organization.mts';
import type { Command, WorkspaceProjection } from '../contracts.mts';

test('Fluid keeps a valid in-bounds collision candidate ahead of a lower-disruption offscreen candidate',()=>{
  const bounds={x:0,y:0,width:800,height:500},input=[{id:'0',x:282,y:342,width:235,height:156},{id:'1',x:481,y:291,width:171,height:170},{id:'2',x:480,y:239,width:274,height:159},{id:'3',x:33,y:32,width:264,height:134}].map(p=>({...p,locked:false})),result=resolveCollisions(input,['0'],bounds,{protectNeighbors:true,yieldVisible:true});
  for(const item of result){const box=footprint(item);assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=800&&box.y+box.height<=500,JSON.stringify(item));assert.equal(item.width,input.find(p=>p.id===item.id)!.width);assert.equal(item.height,input.find(p=>p.id===item.id)!.height);for(const other of result)if(other.id!==item.id)assert.equal(intersects(box,footprint(other),12),false);}
});

test('switching into Fluid reveals crowded mixed sizes with matching preview and one undoable camera change',()=>{
  const kernel=WorkspaceKernel.open(':memory:');try{const engine=new WorkspaceEngine(kernel),bounds={x:20,y:170,width:760,height:330};let state=engine.createWorkspace('Synthetic crowded mode switch',null,{mode:'freeform'});const run=(action:Record<string,unknown>)=>{state=engine.execute({...action,workspaceId:state.workspaceId,expectedRevision:state.revision,commandId:randomUUID()} as Command);return state;};
    for(let i=0;i<5;i++)run({type:'createBlock',resource:{kind:'note',title:'Synthetic mixed card '+i,content:'Synthetic preserved content'},presentation:{x:i*80,y:200+i*45,width:400+i*20,height:240+i*15}});
    const before=state,preview=previewLayout(before,{organization:{mode:'fluid'},intent:'mode',bounds});run({type:'setOrganization',organization:{mode:'fluid'},expectedOrganizationRevision:state.organization.revision,bounds});assert.deepEqual(state.viewport,preview.viewport);assert.ok(state.viewport.zoom<before.viewport.zoom);
    for(const item of [...state.blocks,state.presence]){const box=footprint({...item,id:'test'}),left=(box.x-state.viewport.x)*state.viewport.zoom,top=(box.y-state.viewport.y)*state.viewport.zoom;assert.ok(left>=20-1e-6&&top>=170-1e-6&&left+box.width*state.viewport.zoom<=780+1e-6&&top+box.height*state.viewport.zoom<=500+1e-6);}
    const dimensions=(s:WorkspaceProjection)=>s.blocks.map(b=>({id:b.blockId,width:b.width,height:b.height}));assert.deepEqual(dimensions(state),dimensions(before));run({type:'undoLayout'});assert.equal(state.organization.mode,'freeform');assert.deepEqual(state.viewport,before.viewport);assert.deepEqual(state.blocks.map(b=>({id:b.blockId,x:b.x,y:b.y})),before.blocks.map(b=>({id:b.blockId,x:b.x,y:b.y})));for(const b of state.blocks)assert.equal(kernel.getResource(b.resourceId!).note.content,'Synthetic preserved content');
  }finally{kernel.close();}
});

test('entering Fluid reveals existing offscreen manual cards without clamping their noncolliding geometry',()=>{
  const kernel=WorkspaceKernel.open(':memory:');try{const engine=new WorkspaceEngine(kernel),workspace=engine.createWorkspace('Synthetic offscreen switch',null,{mode:'freeform'});let state=engine.execute({type:'createBlock',workspaceId:workspace.workspaceId,expectedRevision:workspace.revision,commandId:randomUUID(),resource:{kind:'note',title:'Synthetic offscreen note',content:'Synthetic retained'},presentation:{x:1600,y:600,width:280,height:280}});const before=state.blocks[0],bounds={x:20,y:170,width:760,height:330},preview=previewLayout(state,{organization:{mode:'fluid'},intent:'mode',bounds});state=engine.execute({type:'setOrganization',workspaceId:state.workspaceId,expectedRevision:state.revision,commandId:randomUUID(),organization:{mode:'fluid'},bounds});assert.equal(state.blocks[0].x,before.x);assert.equal(state.blocks[0].y,before.y);assert.deepEqual(state.viewport,preview.viewport);assert.ok(state.viewport.zoom<1);assert.ok((before.x-state.viewport.x)*state.viewport.zoom>=20);
    const stable=previewLayout(state,{intent:'view',bounds});assert.deepEqual(stable.viewport,state.viewport);assert.deepEqual(stable.blocks,state.blocks);
  }finally{kernel.close();}
});
