import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID,createHash } from 'node:crypto';
import { readFileSync,mkdtempSync,writeFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { prepareDragGlide } from '../prepare-drag-glide-native.mts';
import { BackendCore } from '../../integrated-backend/src/core.mts';
const require=createRequire(import.meta.url),helper=require('./drag-glide-native.cjs'),{expressions:x,preflight}=require('./drag-glide-expressions.cjs');

test('canonical drag fixture reopens exact known separated geometry, real settings and independent recovery without execution',async()=>{
 const profile=join(tmpdir(),'aerynth-drag-glide-test-'+randomUUID()),seed=await prepareDragGlide(profile);
 const db=join(profile,'aerynth.sqlite'),core=new BackendCore({path:db,privateRoot:profile,cwd:process.cwd(),provider:'codex',contentPolicy:'local-private',retention:{maxEvents:10000}});
 try{const actual=await core.command('desktop',{type:'snapshot'});assert.deepEqual(actual,seed.expected);assert.deepEqual([actual.blocks.find(b=>b.id===seed.movingBlockId)!.x,actual.blocks.find(b=>b.id===seed.movingBlockId)!.y],[128,272]);assert.deepEqual((await core.command('notes',{name:'readNote',input:seed.document.resource.id})).result,seed.document);assert(seed.document.draft&&seed.document.draft.content!==seed.document.resource.content);assert.equal(Object.keys((await core.command('snapshot',{})).executions).length,0);assert.equal(actual.resources.length,3);assert.equal(Buffer.byteLength(JSON.stringify(seed))<262144,true);
  for(const mode of ['fluid','freeform','structured'] as const){const prior=await core.command('desktop',{type:'snapshot'});const before=await core.command('desktop',{type:'setOrganization',workspaceId:seed.workspaceId,expectedOrganizationRevision:prior.organization!.revision,organization:{mode}});assert.deepEqual(before.blocks,prior.blocks);const b=before.blocks.find(b=>b.id===seed.movingBlockId)!;const moved=await core.command('desktop',{type:'geometry',blockId:b.id,expectedVersion:b.version,placement:{x:b.x+96,y:b.y+48,width:b.width,height:b.height,z:b.z},shape:b.shape,rotation:b.rotation});helper.assertMove(before,moved,b.id,seed.delta);const undone=await core.command('desktop',{type:'undo'});helper.assertUndo(before,undone,b.id);}
 }finally{await core.command('close',{});}
 const before=createHash('sha256').update(readFileSync(db)).digest('hex');await assert.rejects(prepareDragGlide(profile),/Profile must not exist/);assert.equal(createHash('sha256').update(readFileSync(db)).digest('hex'),before);
});

function fixture(){
 const card:any={id:'note',gesture:{blockId:'note',intent:'move',phase:'active'},pose:{x:140,y:280,w:420,h:360,lift:55,opacity:1},target:{x:224,y:320,w:420,h:360,lift:55,opacity:1},outline:{x:224,y:320,width:420,height:360,opacity:1},gpuProjection:{bounds:{x:138,y:278,width:425,height:366},matrix:Array(16).fill(0)},domRect:{x:138,y:278,width:425,height:366},domTransform:'matrix3d(observed)'};
 card.gpuProjection.corners=[{x:138,y:278},{x:563,y:278},{x:563,y:644},{x:138,y:644}];
 const frame:any={drawSequence:12,rendererNowMs:1200,reduced:false,cards:[card],grid:{visible:true,reveal:1}};
 const document:any={hidden:false,hasFocus:()=>true,fonts:{status:'loaded'}};
 const context={window:{__aerynth:{snapshot:()=>({active:true,dragGlideFrame:frame})}},document};return {card,frame,document,probe:(rest=false)=>runInNewContext(x.glide('note',11,rest),context)};
}
test('compiled atomic observations require genuine active visible outline, independent projection match and lag/convergence',()=>{
 assert.deepEqual(preflight(),preflight());assert.equal(preflight().cases,4);
 const f=fixture();assert.equal(f.probe().ready,true);assert(f.probe().lag>1);
 f.card.gpuProjection.bounds.x+=2;assert.equal(f.probe().ready,false);f.card.gpuProjection.bounds.x-=2;
 f.card.outline.opacity=0;assert.equal(f.probe().ready,false);f.card.outline.opacity=1;
 f.card.outline.x++;assert.equal(f.probe().ready,false);f.card.outline.x--;
 f.frame.drawSequence=11;assert.equal(f.probe().ready,false);f.frame.drawSequence=12;
 const projection=f.card.gpuProjection;f.card.gpuProjection=null;assert.equal(f.probe().ready,false);f.card.gpuProjection=projection;
 f.card.gpuProjection.matrix[0]=NaN;assert.equal(f.probe().ready,false);f.card.gpuProjection.matrix[0]=0;
 f.document.hidden=true;assert.equal(f.probe().ready,false);f.document.hidden=false;
 f.document.fonts.status='loading';assert.equal(f.probe().ready,false);f.document.fonts.status='loaded';
 Object.assign(f.card.pose,{x:224,y:320,lift:0});f.card.gesture=null;assert.equal(f.probe(true).ready,true);assert.equal(f.probe().ready,false);
});
test('modern glide source preserves guard boundaries and refuses invalid startup or consumed profiles before native operations',async()=>{
 const source=readFileSync(new URL('./drag-glide-native.cjs',import.meta.url),'utf8');assert.doesNotMatch(source,/\.focus\(|\.dispatchEvent\(|resetMetrics\(|\.setBounds\(|\.setSize\(/);assert.doesNotMatch(source,/\b(?:js|wait)\(\s*['"`]/);assert.match(source,/driver\.js\(compileExpression\(code\)\)/);
 const argv=process.argv;process.argv=[...argv,'--verification-deadline-ms=30000'];try{
  for(const kind of ['missing','error','started','checkpoint']){
   const profile=mkdtempSync(join(tmpdir(),'aerynth-glide-reject-'));if(kind==='started'||kind==='checkpoint')writeFileSync(join(profile,kind==='started'?'drag-glide-initial-started.json':'drag-glide-expected.json'),'{}',{flag:'wx'});
   const contents:any=new EventEmitter();contents.isDestroyed=()=>false;const forbidden=()=>{throw Error('Rejected glide must not run native operations');};for(const key of ['executeJavaScript','sendInputEvent','capturePage','insertText'])contents[key]=forbidden;
   let exited=-1;const win={isDestroyed:()=>false,isVisible:()=>true,isMinimized:()=>false,isFocused:()=>true,webContents:contents};
   const result=await helper.verify({win,app:{exit(code:number){exited=code;}},privateRoot:profile,moduleStarted:Date.now(),source:{},startupErrors:kind==='missing'?undefined:kind==='error'?['Synthetic startup error']:[]});assert.equal(result.passed,false);assert.equal(exited,1);assert.equal(result.actions.length+result.screenshots.length,0);assert.equal(contents.listenerCount('before-input-event')+contents.listenerCount('console-message'),0);assert.match(result.error,kind==='missing'||kind==='error'?/startup collector or observed error/:/consumed_initial_profile/);
  }
 }finally{process.argv=argv;}
});
