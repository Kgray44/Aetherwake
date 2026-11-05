import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { agentFixture } from './agent-block-fixture.mts';
import { mountAgentBlockExperience, type AgentBlockProjection } from '../agent-view.ts';
import { blockDocument } from './component-dom.mts';
import { until } from '../../conversation-product/test/component-dom.mts';
import { MotionCoordinator } from '../../visual-experience/cinematic-v3/src/motion.ts';
import type { ExperienceMotionPort } from '../../application-contract/motion.ts';
import type { AgentProfile } from '../../agent-product/contracts.ts';

const button = (root: any, text: string) => root.querySelectorAll('button').find((value: any) => value.textContent === text);
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
async function setup(t: any, override?: (f: ReturnType<typeof agentFixture>) => Partial<Parameters<typeof mountAgentBlockExperience>[2]>) {
  const f = agentFixture(t), dom = blockDocument(), restore = dom.install(), coordinator = new MotionCoordinator(), projections: AgentBlockProjection[] = [], opens: string[] = [];
  const motion: ExperienceMotionPort = { get reduced() { return coordinator.reduced; }, add: (key, pose) => coordinator.add(key, pose),
    target: (key, pose, cause) => coordinator.target(key, pose, cause), pose: key => coordinator.pose(key), remove: key => { coordinator.bodies.delete(key); }, wake() {} };
  const controller = mountAgentBlockExperience(dom.root, f.created.agent.resourceId, { client: f.client, motion, viewId: 'synthetic:agent-block',
    onOpenAgent: id => { opens.push(id); }, onProjection: value => { projections.push(value); }, ...override?.(f) });
  t.after(() => { controller.dispose(); restore(); });
  const frame = () => { for (let i = 0; i < 100; i++) { coordinator.step(1 / 60); controller.frame(); } };
  return { f, dom, controller, coordinator, projections, opens, frame };
}

test('Agent block reads one saved canonical profile and catalog compatibility without claiming execution or fabricating history/actions', async t => {
  const s = await setup(t); await until(() => s.dom.root.textContent.includes('Compatible configuration')); s.frame();
  assert.match(s.dom.root.textContent, /Synthetic Researcher/);
  assert.equal(s.dom.root.querySelector('.aw-agent-purpose').textContent, s.f.service.inspect(s.f.created.agent.resourceId).profile.purpose);
  assert.match(s.dom.root.textContent, /Work reference history is unavailable/);
  assert.doesNotMatch(s.dom.root.textContent, /Running|Complete|Run agent|Assign work/);
  assert.equal(s.f.db.prepare('SELECT count(*) n FROM resources').get()!.n, 1); assert.equal(s.f.db.prepare('SELECT count(*) n FROM notes').get()!.n, 0);
  assert.equal(s.f.db.prepare('SELECT count(*) n FROM workspaces').get()!.n, 0); assert.equal(s.f.db.prepare('SELECT count(*) n FROM blocks').get()!.n, 0);
  button(s.dom.root, 'Open agent').onclick(); await until(() => s.opens.length === 1); assert.equal(s.opens[0], s.f.created.agent.resourceId);
  const details = s.dom.root.querySelector('.aw-agent-configuration'); button(s.dom.root, 'Configuration').onclick(); s.frame();
  assert.equal(details.hidden, false); assert.match(details.textContent, /Catalog compatibility only/);
  button(s.dom.root, 'Configuration').onclick(); assert.equal(details.inert, true); s.frame(); assert.equal(details.hidden, true);
  const version = s.f.service.inspect(s.f.created.agent.resourceId).ref; await s.controller.refresh(); assert.deepEqual(s.f.service.inspect(version.resourceId).ref, version);
});

test('optional reference projection opens actual canonical manual Tasks and labels saved links independently of runtime activity', async t => {
  let referenceId = '', taskId = ''; const opened: string[] = [];
  const s = await setup(t, f => { const ref = f.link(); referenceId = ref.id; taskId = ref.task.id;
    return { client: { ...f.client, references: async () => [f.service.assignment(referenceId)] }, onOpenResource: id => { opened.push(id); }, resourceTitle: id => id === taskId ? 'Exact canonical manual task' : undefined };
  });
  await until(() => s.dom.root.querySelector('li')); assert.match(s.dom.root.textContent, /Exact canonical manual task/);
  assert.match(s.dom.root.textContent, /Reference only; no execution started/); assert.doesNotMatch(s.dom.root.textContent, /Running|Verified|Complete/);
  button(s.dom.root, 'Open manual task').onclick(); await until(() => opened.length === 1); assert.deepEqual(opened, [taskId]);
  assert.equal(s.dom.root.querySelector('li').dataset.referenceId, referenceId);
  assert.equal(s.f.service.assignment(referenceId).startsExecution, false); assert.equal(s.f.service.assignment(referenceId).taskVerified, false);
});

test('late reads cannot replace fresh profile data, inactive mounts do not read, and disposal releases only owned motion', async t => {
  const late = deferred<AgentProfile>(); let reads = 0;
  const s = await setup(t, f => ({ active: false, client: { ...f.client, inspect: async id => { reads++; return reads === 1 ? late.promise : f.service.inspect(id); } } }));
  assert.equal(reads, 0); s.controller.setActive(true); await until(() => reads === 1);
  const stale = s.f.service.inspect(s.f.created.agent.resourceId);
  s.f.service.update({ commandId: 'synthetic:rename-profile', agent: stale.ref, title: 'Fresh canonical Agent', profile: stale.profile });
  await s.controller.refresh(); late.resolve(stale); await new Promise(resolve => setImmediate(resolve));
  assert.match(s.dom.root.textContent, /Fresh canonical Agent/); assert.doesNotMatch(s.dom.root.textContent, /Synthetic Researcher/);
  s.controller.setActive(false); const before = reads; await s.controller.refresh(); assert.equal(reads, before); assert.equal(s.dom.root.querySelector('.aw-agent-block').inert, true);
  s.frame(); assert.equal(s.dom.root.querySelector('.aw-agent-block').hidden, true);
  s.coordinator.add('unrelated:root', { x: 0, y: 0, w: 0, h: 0, lift: 0, yaw: 0, opacity: 1 });
  s.controller.dispose(); assert.deepEqual([...s.coordinator.bodies.keys()], ['unrelated:root']);
});

test('permission revocation clears profile and reference data, including denial after inspect while dependent reads are pending', async t => {
  let denyAfterInspect = false;
  const s = await setup(t, f => ({ client: { ...f.client, effective: async (ref, project) => {
    if (denyAfterInspect) f.deny(); return f.client.effective(ref, project);
  } } }));
  await until(() => s.dom.root.textContent.includes('Compatible configuration'));
  const purpose = s.f.service.inspect(s.f.created.agent.resourceId).profile.purpose;
  denyAfterInspect = true; await s.controller.refresh();
  assert.match(s.dom.root.textContent, /Agent unavailable/); assert.doesNotMatch(s.dom.root.textContent, /Synthetic Researcher|synthetic-model/);
  assert.equal(s.dom.root.textContent.includes(purpose), false);
  assert.equal(button(s.dom.root, 'Open agent').disabled, true);
  assert.deepEqual(s.projections.at(-1), { phase: 'unavailable' });
  const source = readFileSync(new URL('../agent-view.ts', import.meta.url), 'utf8'), css = readFileSync(new URL('../agent-view.css', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /requestAnimationFrame|setTimeout|setInterval|new MotionCoordinator|ResizeObserver/); assert.doesNotMatch(css, /\btransition\s*:|\banimation\s*:/);
});
