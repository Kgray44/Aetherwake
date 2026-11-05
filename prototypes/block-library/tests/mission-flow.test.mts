import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { layoutMissionFlow, missionFlowInScope, missionTaskMetadata } from '../mission-flow.ts';
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
  assert.match(css, /\.aw-stream-viewport\s*\{[^}]*max-height:52vh;[^}]*overflow:auto/);
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
