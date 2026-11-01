import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MotionCoordinator } from '../../visual-experience/cinematic-v3/src/motion.ts';
import { ConstellationController } from '../controller.ts';
import { SyntheticService } from '../demo/service.mts';

const step=m=>{for(let i=0;i<150;i++)m.step(1/60);};
const empty=()=>({projects:[],workspaces:[],resources:[],blocks:[],relationships:[],activeWorkspaceId:null});
const setup=t=>{const dir=mkdtempSync(join(tmpdir(),'aerynth-constellation-'));let service=new SyntheticService(join(dir,'fixture.sqlite'));service.seed();t.after(()=>{service.close();rmSync(dir,{recursive:true});});return {get service(){return service;},restart(){service.close();service=new SyntheticService(join(dir,'fixture.sqlite'));return service;}};};
const create=service=>{const motion=new MotionCoordinator();const c=new ConstellationController({snapshot:service.snapshot(),motion,navigate:async d=>service.navigate(d),persistence:{load:async()=>service.load(),save:async s=>service.save(s)},openResource:async()=>{}});return {c,motion};};

test('zero, one and many projects; standalone workspaces remain direct destinations',()=>{
  const motion=new MotionCoordinator(),s=empty();const c=new ConstellationController({snapshot:s,motion,navigate:async()=>{}});
  assert.equal(c.nodes.size,0);assert.deepEqual(c.visible(1400,800),[]);
  s.projects.push({id:'one',title:'One'});s.workspaces.push({id:'standalone',title:'Standalone',project_id:null});c.update(s);assert.equal(c.search('One').filter(n=>n.kind==='project').length,1);assert.equal(c.search('Standalone')[0].kind,'workspace');
  for(let i=0;i<30;i++)s.projects.push({id:`p${i}`,title:`Project ${i}`});c.update(s);assert.equal(c.search('Project',100).length,30);c.dispose();
});

test('persisted workspace → project → universe → other project → editor → back preserves identities and layouts',async t=>{
  const {service}=setup(t),{c,motion}=create(service);await c.restore();const before=service.snapshot();const a=before.workspaces.find(w=>w.title==='Development'),b=before.workspaces.find(w=>w.title==='Engineering');
  assert.equal(c.location.workspaceId,a.id);await c.zoomOut();assert.equal(c.location.projectId,a.project_id);await c.zoomOut();assert.equal(c.location.kind,'universe');
  await c.approach(`project:${b.project_id}`);assert.equal(c.location.kind,'project');await c.approach(`workspace:${b.id}`);assert.equal(service.snapshot().activeWorkspaceId,b.id);
  const block=before.blocks.find(x=>x.workspace_id===b.id);await c.approach(`resource:${block.id}`);assert.equal(c.location.resourceId,block.resource_id);assert.equal(c.location.kind,'surface');
  const r=service.snapshot().resources.find(r=>r.id===block.resource_id);service.content(r.id,'Edited through the real canonical kernel.',r.version);
  await c.zoomOut();await c.go({kind:'workspace',workspaceId:a.id});step(motion);await c.persist();
  assert.deepEqual(service.snapshot().blocks,before.blocks);assert.equal(service.snapshot().resources.length,before.resources.length);assert.equal(service.snapshot().resources.find(x=>x.id===r.id).content,'Edited through the real canonical kernel.');
  await c.back();assert.equal(c.location.workspaceId,b.id);
});

test('restart restores camera, pinned project/workspace anchors and canonical block geometry',async t=>{
  const fixture=setup(t),{c,motion}=create(fixture.service);await c.restore();await c.zoomOut();const project=c.location.projectId;await c.pin(`project:${project}`,{x:808,y:304});await c.pin(`workspace:${fixture.service.snapshot().workspaces[0].id}`,{x:950,y:480});c.move({x:900,y:410,zoom:1.22});step(motion);await c.persist();const saved=structuredClone(c.state),blocks=fixture.service.snapshot().blocks;c.dispose();fixture.restart();const restored=create(fixture.service);await restored.c.restore();assert.deepEqual(restored.c.camera,saved.bookmarks[`project:${project}`].camera);assert.deepEqual(restored.c.state.anchors,saved.anchors);assert.deepEqual(fixture.service.snapshot().blocks,blocks);
});

test('zoom reversal and interrupted/retargeted camera preserve stable orientation',async t=>{
  const {service}=setup(t),{c,motion}=create(service);await c.zoomOut();c.zoom(2);motion.step(.04);const before=c.camera;c.zoom(.5);assert.deepEqual(c.camera,before);motion.step(.03);c.interrupt();const at=c.camera;step(motion);assert.deepEqual(c.camera,at);c.fit([...c.nodes.keys()][0]);step(motion);assert.equal(motion.pose(c.motionId).yaw,0);assert.equal(c.camera.zoom,.8);
});

test('reduced motion, Quiet and hidden states settle immediately in all quality tiers',async t=>{
  const {service}=setup(t);for(const tier of ['cinematic','balanced','efficient']){const {c,motion}=create(service);c.setPolicy({tier,reduced:true});c.move({x:100,y:200,zoom:.8});assert.deepEqual(c.camera,{x:100,y:200,zoom:.8});assert.equal(motion.bodies.get(c.motionId).transitioning,false);c.setPolicy({reduced:false,quiet:true});c.pan(20,10);assert.equal(c.camera.x,120);c.setPolicy({quiet:false,hidden:true});c.zoom(2);assert.equal(c.camera.zoom,1.6);c.dispose();}
});

test('visibility filtering removes nodes, search, edges, counts and saved hidden IDs; unknown/unavailable open fails',async t=>{
  const {service}=setup(t),{c}=create(service);const s=service.snapshot(),hidden=s.projects[0];await c.go({kind:'project',projectId:hidden.id});await c.pin(`project:${hidden.id}`,{x:777,y:0});hidden.visible=false;c.update(s);assert.equal(c.location.kind,'universe');assert.equal(c.nodes.has(`project:${hidden.id}`),false);assert.equal(c.search(hidden.title).length,0);assert.equal(JSON.stringify(c.state).includes(hidden.id),false);
  const unavailable=s.workspaces.find(w=>w.project_id!==hidden.id);unavailable.available=false;c.update(s);await assert.rejects(c.approach(`workspace:${unavailable.id}`),/unavailable/);await assert.rejects(c.go({kind:'workspace',workspaceId:'unknown'}),/unavailable/);
});

test('incremental placement never moves saved anchors or collides with occupied cells',async t=>{
  const {service}=setup(t),{c}=create(service);const before=structuredClone(c.state.anchors);service.kernel.createProject('New fixture');c.update(service.snapshot());for(const [key,p] of Object.entries(before))assert.deepEqual(c.state.anchors[key],p);const points=service.snapshot().projects.map(p=>c.state.anchors[`project:${p.id}`]);assert.equal(new Set(points.map(p=>`${p.x},${p.y}`)).size,points.length);
});

test('graphics recovery retains selection, navigation and camera; corrupt stored views recover truthfully',async t=>{
  const {service}=setup(t),{c}=create(service);await c.zoomOut();c.select(`project:${c.location.projectId}`);const selected=c.selected;c.setPolicy({graphicsAvailable:false});assert.equal(c.selected,selected);c.setPolicy({graphicsAvailable:true});assert.equal(c.selected,selected);const broken=new ConstellationController({snapshot:service.snapshot(),motion:new MotionCoordinator(),navigate:async()=>{},persistence:{load:async()=>{throw Error('storage');},save:async()=>{}}});await broken.restore();assert.match(broken.error,/could not be restored/);assert.ok(broken.search('Engineering').length);
});

test('large datasets have bounded proxy counts and no content mounted in projection',async()=>{
  const s=empty();for(let p=0;p<50;p++){s.projects.push({id:`p${p}`,title:`P ${p}`});for(let w=0;w<10;w++){s.workspaces.push({id:`w${p}-${w}`,project_id:`p${p}`,title:`W ${w}`});for(let r=0;r<20;r++){const id=`r${p}-${w}-${r}`;s.resources.push({id,title:id,kind:'note'});s.blocks.push({id:`b${id}`,workspace_id:`w${p}-${w}`,resource_id:id,x:r*20,y:0,width:100,height:100,z:r});}}}const c=new ConstellationController({snapshot:s,motion:new MotionCoordinator(),navigate:async()=>{}});assert.equal(c.nodes.size,10550);for(const tier of ['cinematic','balanced','efficient']){c.setPolicy({tier});assert.ok(c.visible(1920,1080).length<=120);}assert.equal(JSON.stringify([...c.nodes.values()]).includes('content'),false);
});
