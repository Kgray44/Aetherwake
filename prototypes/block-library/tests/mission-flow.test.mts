import { flowGeometryProfile, downwardFlowPath } from "../flow-geometry.ts";
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { layoutMissionFlow, missionFlowInScope, missionTaskMetadata, mountMissionFlow } from '../mission-flow.ts';
import { mountEventExperience, type EventWindow } from '../event-view.ts';
import type { MissionProjection, MissionTask } from '../../integrated-backend/src/mission-contracts.mts';
import { blockDocument } from './component-dom.mts';
const task = (id: string, dependencies: string[] = [], state: MissionTask['state'] = 'queued'): MissionTask => ({ id, dependencies, state, objective: 'Synthetic '+id, executor: 'fixture-executor', claims: [], criterion: 'Synthetic criterion', timeoutMs: 1000, maxAttempts: 1, queuedAt: '2026-11-05T00:00:00Z', priority: 0, attempts: [] });
const mission = (): MissionProjection => ({ contract: 'aerynth.vela-mission@1', id: 'fixture-mission', requestId: 'fixture-request', objective: 'Synthetic mission objective', scope: { workspaceId: 'workspace', projectId: null }, criteria: ['Synthetic criterion'], createdAt: '2026-11-05T00:00:00Z', revision: 4, planRevision: 2, concurrency: 2, disposition: 'active', tasks: [task('cpu', [], 'verified'), task('ram', [], 'running'), task('join', ['cpu','ram'])], events: [], outcome: 'running', waits: {join: 'dependencies'}, profile: { elapsedMs: 1, peakWorkers: 2, attempts: 2, retries: 0, providerCalls: null, reportedTotalTokens: null, usageReports: 0, verifiedObjectivesPerReportedToken: null } });
const window = (projection: MissionProjection | null): EventWindow => ({ events: [], earliest: null, latest: 0, disconnected: false, resources: [], workspaceResourceIds: [], workspaceId: 'workspace', projectId: null, mission: projection });

test('shared Flow geometry styles also apply to standalone mission workrooms outside an EventView wrapper', () => {
  const css = readFileSync(new URL('../event-view.css', import.meta.url), 'utf8');
  assert.match(css, /\.aw-stream \.aw-stream-node\s*\{[^}]*position:absolute/);
  assert.match(css, /\.aw-stream \.aw-mission-task\s*\{[^}]*width:190px;[^}]*height:70px/);
  assert.match(css, /\.aw-stream-viewport\s*\{[^}]*max-height:52vh;[^}]*overflow:clip/);
});

test('current mission graph shows independent tasks and actual multi-parent joins without inventing events', () => {
  const input = mission(), before = structuredClone(input), result = layoutMissionFlow(input);
  assert.notEqual(result.nodes[0]!.x, result.nodes[1]!.x); assert.equal(result.nodes[0]!.y, result.nodes[1]!.y);
  assert.equal(result.nodes[2]!.join, true); assert.ok(result.nodes[2]!.y > result.nodes[0]!.y);
  assert.equal(result.nodes[2]!.x, (result.nodes[0]!.x + result.nodes[1]!.x) / 2);
  assert.deepEqual(result.edges, [{from:'cpu',to:'join'}, {from:'ram',to:'join'}]);
  assert.deepEqual(input, before); assert.equal(input.events.length, 0);
});

test('a genuine branch and rejoin uses spatial levels while disconnected tasks remain unlinked compact peers', () => {
  const input = mission(); input.tasks = [task('intent'), task('left', ['intent']), task('right', ['intent']), task('joined', ['left', 'right']), task('unrelated')];
  const graph = layoutMissionFlow(input), byId = new Map(graph.nodes.map(node => [node.task.id, node]));
  assert.equal(byId.get('left')!.y, byId.get('right')!.y); assert.notEqual(byId.get('left')!.x, byId.get('right')!.x);
  assert(byId.get('intent')!.y < byId.get('left')!.y && byId.get('joined')!.y > byId.get('right')!.y);
  assert.equal(byId.get('intent')!.x, byId.get('joined')!.x);
  assert(!graph.edges.some(edge => edge.from === 'unrelated' || edge.to === 'unrelated'));
  input.tasks = Array.from({ length: 12 }, (_, index) => task('independent-' + index));
  const peers = layoutMissionFlow(input); assert.equal(peers.edges.length, 0); assert.equal(new Set(peers.nodes.map(node => node.x)).size, 4);
  assert(Math.max(...peers.nodes.map(node => node.y)) < 400);
});

test('bounded mission layout discloses missing parents and cycles without guessing them', () => {
  const input = mission(); input.tasks = Array.from({length:100}, (_, i) => task('t'+i, i ? ['t'+(i-1)] : ['missing']));
  const result = layoutMissionFlow(input); assert.equal(result.nodes.length, 80); assert.equal(result.omitted, 20); assert.equal(result.unavailable, 1);
  input.tasks = [task('a',['b']),task('b',['a'])]; assert.equal(layoutMissionFlow(input).cycles,2);
});

test('mission source gate rejects other scopes and revoked originating conversations; metadata excludes private bodies', () => {
  const input = mission(); assert.equal(missionFlowInScope(input,window(input)),true);
  assert.equal(missionFlowInScope(input,{...window(input),workspaceId:'other'}),false);
  assert.equal(missionFlowInScope(input,{...window(input),projectId:'other'}),false);
  input.originConversationId='revoked-conversation'; assert.equal(missionFlowInScope(input,window(input)),false);
  const t = input.tasks[0]!; t.attempts = [{id:'attempt',executor:'fixture',admittedAt:'2026-11-05T00:00:00Z',outcome:'verified',evidence:{id:'evidence',attemptId:'attempt',source:'fixture-source',observedAt:'2026-11-05T00:00:00Z',value:'PRIVATE_EVIDENCE_BODY'}, verification:{criterion:'Synthetic criterion',passed:true,detail:'Recorded verification',evidenceIds:['evidence']}}];
  const metadata=missionTaskMetadata(input,t); assert.equal(metadata['Attempt 1 source'],'fixture-source'); assert.equal(metadata['Attempt 1 verification'],'Passed: Synthetic criterion'); assert.doesNotMatch(JSON.stringify(metadata),/PRIVATE_EVIDENCE_BODY/);
});

test('mission Flow has inspectable task states and dependency paths, Forensic fallback, and revocation cleanup', t => {
  const dom=blockDocument(),restore=dom.install(); let state=window(mission()); const opened:string[]=[];
  const view=mountEventExperience(dom.root,{snapshot:()=>state,async refresh(){},openMission:id=>opened.push(id)});
  t.after(()=>{view.dispose();restore();});
  const host=dom.root.querySelector('.aw-mission-flow'), nodes=()=>dom.root.querySelectorAll('.aw-mission-task');
  assert.equal(host.hidden,false); assert.equal(nodes().length,3);
  assert.match(host.textContent,/Current plan \/ execution projection/); assert.match(host.textContent,/not historical event causality/);
  const join=nodes().find((n:any)=>n.dataset.missionTaskId==='join'); join.onclick();
  const inspector=host.querySelector('.aw-stream-inspector'); assert.match(inspector.textContent,/Current waitdependencies/);
  assert.equal(nodes().filter((n:any)=>n.dataset.path==='true').length,3);
  inspector.querySelector('button').onclick(); assert.deepEqual(opened,['fixture-mission']);
  view.setActive(false); join.onclick(); assert.equal(inspector.hidden,true); assert.doesNotMatch(inspector.textContent,/Task IDjoin/); view.setActive(true);
  const modes=dom.root.querySelectorAll('.aw-stream-modes button'); modes[2].onclick(); assert.equal(host.hidden,true); assert.equal(dom.root.querySelector('ol').hidden,false);
  modes[0].onclick(); assert.equal(host.hidden,false);
  state={...state,workspaceId:'revoked-workspace'};view.update();join.onclick();
  assert.equal(nodes().length,0); assert.equal(host.hidden,true); assert.doesNotMatch(host.textContent,/Synthetic mission objective/); assert.equal(inspector.hidden,true);
  const fallback=dom.root.querySelectorAll('.aw-stream').find((n:any)=>!n.className.includes('aw-mission-flow')); assert.equal(fallback.hidden,false);
});


test('mission motion uses distinct host keys, skips hidden Forensic frames and retires revoked tasks', t => {
  const dom=blockDocument(),restore=dom.install(); let state=window(mission());
  const poses=new Map<string,import('../../application-contract/motion.ts').ExperiencePose>();
  const motion={reduced:true,add(key:string,pose:import('../../application-contract/motion.ts').ExperiencePose){poses.set(key,pose);},target(key:string,pose:import('../../application-contract/motion.ts').ExperiencePose){poses.set(key,pose);},pose(key:string){assert.ok(poses.has(key));return poses.get(key)!;},remove(key:string){poses.delete(key);},wake(){}};
  const view=mountEventExperience(dom.root,{snapshot:()=>state,async refresh(){}},{motion,viewId:'mission-fixture'});
  t.after(()=>{view.dispose();restore();});
  assert.equal(poses.size,3); assert.ok([...poses.keys()].every(k=>k.startsWith('mission-flow:mission-fixture:fixture-mission:'))); view.frame();
  const modes=dom.root.querySelectorAll('.aw-stream-modes button');modes[2].onclick();view.frame();assert.equal(poses.size,0);
  modes[1].onclick();view.frame();assert.equal(poses.size,3);
  state={...state,mission:null};view.update();view.frame();assert.equal(poses.size,0);
  view.dispose();assert.equal(poses.size,0);
});


test('mission Flow gesture aborts on canonical source revocation and keeps precision navigation behind disclosure',t=>{
  const dom=blockDocument(),restore=dom.install();let state=window(mission());
  const view=mountEventExperience(dom.root,{snapshot:()=>state,async refresh(){}});t.after(()=>{view.dispose();restore();});
  const host=dom.root.querySelector('.aw-mission-flow'),viewport=host.querySelector('.aw-stream-viewport'),scene=host.querySelector('.aw-stream-scene');
  const menu=host.querySelector('.aw-flow-options');assert.equal(menu.open,false);assert.equal(menu.firstChild.getAttribute('aria-label'),'Flow options');
  viewport.setPointerCapture=()=>{};viewport.releasePointerCapture=()=>{};
  const pointer={pointerId:9,button:0,isPrimary:true,clientX:100,clientY:100};viewport.fire('pointerdown',pointer);viewport.fire('pointermove',{...pointer,clientX:180,clientY:140});
  assert.match(scene.style.transform,/translate\(100px, 60px\)/);
  state={...state,mission:null};view.update();assert.match(scene.style.transform,/translate\(20px, 20px\)/);assert.equal(viewport.dataset.dragging,undefined);
  viewport.fire('pointerup',{...pointer,clientX:600});assert.match(scene.style.transform,/translate\(20px, 20px\)/);
});


test('compact/Glimpse task bounds and declared edge anchors use one geometry profile',()=>{
 const projection=mission(),profile=flowGeometryProfile('mission','workspace','flow'),layout=layoutMissionFlow(projection,80,profile);
 assert.deepEqual([profile.width,profile.height],[110,32]);
 assert.equal(Math.max(...layout.nodes.map(n=>n.x+profile.width))+profile.inset*2,252);
 assert.equal(Math.max(...layout.nodes.map(n=>n.y+profile.height))+profile.inset*2,98);
 const from=layout.nodes.find(n=>n.task.id==='cpu')!,to=layout.nodes.find(n=>n.task.id==='join')!;
 assert.match(downwardFlowPath(from,to,profile.width,profile.height),/^M 55 32 C/);
 assert.ok(to.y+profile.height+profile.inset*2<=100, "Terminal node and incoming path fit the compact viewport without scene scaling");
 assert.deepEqual(flowGeometryProfile('mission','focused','glimpse'),profile);
 assert.deepEqual([flowGeometryProfile('mission','focused','flow').width,flowGeometryProfile('mission','focused','flow').height],[190,70]);
});
test('presentation reflow retains selected identity and camera, aligns host poses, and keeps external options in Forensic',t=>{
 const dom=blockDocument(),restore=dom.install(),optionsHost=dom.doc.createElement('div'),context=dom.doc.createElement('button');dom.root.append(optionsHost);
 const poses=new Map<string,import('../../application-contract/motion.ts').ExperiencePose>();
 const motion={reduced:true,add(key:string,p:import('../../application-contract/motion.ts').ExperiencePose){poses.set(key,p);},target(key:string,p:import('../../application-contract/motion.ts').ExperiencePose){poses.set(key,p);},pose(key:string){return poses.get(key)!;},remove(key:string){poses.delete(key);},wake(){}};
 const view=mountMissionFlow(dom.root,{motion,viewId:'profiles',optionsHost,contextTools:[context],presentation:'focused'});t.after(()=>{view.dispose();restore();});view.update(mission());view.frame();
 const host=dom.root.querySelector('.aw-mission-flow'),nodes=dom.root.querySelectorAll('.aw-mission-task'),join=nodes.find((n:any)=>n.dataset.missionTaskId==='join');join.onclick();
 const scene=host.querySelector('.aw-stream-scene'),viewport=host.querySelector('.aw-stream-viewport');viewport.setPointerCapture=()=>{};viewport.releasePointerCapture=()=>{};
 viewport.fire('pointerdown',{pointerId:2,button:0,clientX:100,clientY:100});viewport.fire('pointerup',{pointerId:2,clientX:133,clientY:125});
 const camera=scene.style.transform;view.setPresentation('workspace');view.frame();
 assert.equal(scene.style.transform,camera);assert.equal(join.style.width,'110px');assert.equal(join.style.height,'32px');assert.equal(join.getAttribute('aria-pressed'),'true');
 assert.match(host.querySelector('.aw-stream-inspector').textContent,/Task IDjoin/);assert.equal(host.querySelectorAll('.aw-mission-task').find((n:any)=>n.dataset.missionTaskId==='join'),join);
 assert.ok([...poses.values()].every(p=>p.w===110&&p.h===32));view.reflow();view.update(mission(),'glimpse');view.setPresentation('focused');view.frame();assert.equal(join.style.width,'110px');
 view.update(mission(),'flow');view.frame();assert.equal(join.style.width,'190px');assert.equal(join.style.height,'70px');
 view.update(mission(),'forensic');assert.equal(host.hidden,true);assert.ok(optionsHost.querySelector('.aw-flow-options'));assert.equal(optionsHost.querySelector('.aw-flow-options').contains(context),true);
 dom.root.append(context);view.dispose();assert.equal(optionsHost.children.length,0);assert.equal(dom.root.contains(context),true);assert.equal(poses.size,0);
});


test('compact roots and join fit a measured narrow viewport while preserving task labels and identities',t=>{
 for(const width of [220,230]){const profile=flowGeometryProfile('mission','workspace','flow',width),layout=layoutMissionFlow(mission(),80,profile);assert.ok(Math.max(...layout.nodes.map(n=>n.x+profile.width))+profile.inset*2<=width);assert.equal(profile.height,32);assert.equal(profile.gapX,16);}
 const dom=blockDocument(),restore=dom.install();const view=mountMissionFlow(dom.root,{presentation:'workspace'});t.after(()=>{view.dispose();restore();});view.update(mission());
 const viewport=dom.root.querySelector('.aw-stream-viewport');Object.defineProperty(viewport,'clientWidth',{value:230,configurable:true});view.reflow();
 const node=dom.root.querySelector('.aw-mission-task'),label=node.children[1].textContent;node.onclick();assert.equal(node.style.width,'99px');assert.equal(node.style.height,'32px');
 Object.defineProperty(viewport,'clientWidth',{value:220,configurable:true});view.reflow();assert.equal(dom.root.querySelector('.aw-mission-task'),node);assert.equal(node.style.width,'94px');assert.equal(node.children[1].textContent,label);assert.equal(node.getAttribute('aria-pressed'),'true');assert.match(dom.root.querySelector('.aw-stream-inspector').textContent,/Task IDcpu/);
 assert.equal(flowGeometryProfile('mission','workspace','flow',0).width,110);
});
