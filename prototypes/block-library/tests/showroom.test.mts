import test from 'node:test';
import assert from 'node:assert/strict';
import { REGISTERED_BLOCKS } from '../registry.ts';
import { instrumentIntents } from '../instrument.ts';
import { searchShowroom, instrumentMiniature, showroomDemonstration, type ShowroomReplay } from '../showroom.ts';
import { mountBlockLibrary } from '../view.ts';
import { blockDocument } from './component-dom.mts';
import { until } from '../../conversation-product/test/component-dom.mts';
import type { LibraryCapabilities } from '../contracts.ts';
import { MotionCoordinator } from '../../visual-experience/cinematic-v3/src/motion.ts';
import type { ExperienceMotionPort } from '../../application-contract/motion.ts';

function borrowedMotion() {
  const coordinator = new MotionCoordinator(); let wakes = 0;
  const motion: ExperienceMotionPort = { get reduced() { return coordinator.reduced; },
    add: (key, pose) => coordinator.add(key, pose), target: (key, pose, cause) => coordinator.target(key, pose, cause),
    pose: key => coordinator.pose(key), remove: key => { coordinator.bodies.delete(key); }, wake() { wakes++; } };
  return { coordinator, motion, wakes: () => wakes };
}

const capabilities: LibraryCapabilities = {
  revision: 1, kinds: Object.fromEntries(REGISTERED_BLOCKS.map(definition => [definition.kind, { state: 'available' }])),
  providers: { automatic: { state: 'setup_required', reason: 'Connect a provider before execution.' } },
  subjects: { project_overview: { state: 'available' }, collection_browser: { state: 'available' }, resource_browser: { state: 'available' } },
  velaPlanning: { state: 'unsupported' },
};

test('showroom discovery retains exactly the registry and searches actual restrictions, capability names and cross-intent membership', () => {
  assert.deepEqual(searchShowroom('', capabilities).map(item => item.kind), REGISTERED_BLOCKS.map(item => item.kind));
  assert.deepEqual(searchShowroom('saved', capabilities, 'specialists').map(item => item.kind), ['agent']);
  assert(searchShowroom('setup_required provider', capabilities).some(item => item.kind === 'conversation'));
  assert(searchShowroom('Filter sources', capabilities).some(item => item.kind === 'timeline'));
  assert(searchShowroom('', capabilities, 'knowledge').some(item => item.kind === 'resource_browser'));
  assert(searchShowroom('', capabilities, 'navigation').some(item => item.kind === 'resource_browser'));
  assert.deepEqual(searchShowroom('', capabilities, 'environment'), []);
  const changed = { ...capabilities, kinds: { ...capabilities.kinds, timeline: { state: 'unsupported' as const, reason: 'Unavailable on this host' } } };
  assert(searchShowroom('unsupported host', changed).some(item => item.kind === 'timeline'));
});

test('Timeline replay advances a local labeled fixture, resets and cannot schedule or call a backend', t => {
  const dom = blockDocument(); t.after(dom.install());
  const originalTimeout = globalThis.setTimeout, originalInterval = globalThis.setInterval;
  globalThis.setTimeout = (() => assert.fail('No replay timer')) as any;
  globalThis.setInterval = (() => assert.fail('No replay interval')) as any;
  t.after(() => { globalThis.setTimeout = originalTimeout; globalThis.setInterval = originalInterval; });
  const demo = showroomDemonstration('timeline'); dom.root.append(demo);
  assert.match(demo.textContent!, /Synthetic interaction demonstration/);
  const initial = demo.textContent;
  const next = demo.querySelector<HTMLButtonElement>('[data-demo-next]')!;
  next.onclick!({} as MouseEvent);
  assert.match(demo.textContent!, /Zoom · Inspect a narrower range/);
  next.onclick!({} as MouseEvent); assert.match(demo.textContent!, /Filter · Focus/);
  next.onclick!({} as MouseEvent); assert.match(demo.textContent!, /workspace.saved · observed/); assert(next.disabled);
  demo.querySelector<HTMLButtonElement>('[data-demo-replay]')!.onclick!({} as MouseEvent);
  assert.equal(demo.textContent, initial); assert.equal(demo.querySelector('[role="status"]')!.getAttribute('aria-live'), 'polite');
});

test('temporal, causal, conversation, agent, navigation and knowledge miniatures differ structurally', t => {
  const dom = blockDocument(); t.after(dom.install());
  const kinds = ['timeline', 'clock_timer', 'stream', 'conversation', 'agent', 'resource_browser', 'note'] as const;
  const miniatures = kinds.map(kind => instrumentMiniature(kind));
  assert.equal(new Set(miniatures.map(item => item.className)).size, kinds.length);
  assert.equal(new Set(miniatures.map(item => item.textContent)).size, kinds.length);
  assert(miniatures.every(item => item.getAttribute('aria-hidden') === 'true'));
});

test('actual library exposes seven intent filters, replay stays isolated and Timeline remains reference-only', async t => {
  const dom = blockDocument(); t.after(dom.install()); let writes = 0;
  const library = mountBlockLibrary(dom.root, { capabilities: async () => capabilities,
    createBlock: async () => { writes++; throw new Error('Unexpected create'); },
  }, { workspaceId: 'synthetic:workspace', expectedLayoutVersion: 1, onCreated() {}, onClose() {} });
  t.after(() => library.dispose()); await until(() => !!dom.root.querySelector('[data-block-kind="timeline"]'));
  const category = dom.root.querySelectorAll('select').find((item: any) => item.getAttribute('aria-label') === 'Block category');
  assert.deepEqual(category.querySelectorAll('option').map((item: any) => item.value), ['', ...instrumentIntents]);
  dom.root.querySelector('[data-block-kind="timeline"]').onclick();
  const detail = dom.root.querySelector('.aw-library__detail');
  assert.match(detail.textContent, /choose an existing saved resource/); assert.equal(detail.querySelector('form'), null);
  detail.querySelector('[data-demo-next]').onclick(); library.frame();
  assert.match(detail.textContent, /Zoom · Inspect a narrower range/); assert.equal(writes, 0);
  category.value = 'environment'; category.onchange();
  assert.match(dom.root.querySelector('.aw-library__list').textContent, /No matching block types/);
  category.value = 'time'; category.onchange();
  assert.deepEqual(dom.root.querySelectorAll('[data-block-kind]').map((item: any) => item.dataset.blockKind), ['timeline', 'clock_timer']);
  assert.equal(writes, 0);
});

test('animated replay advances only through borrowed coordinator host frames, settles a finite sequence and never writes canonical data', async t => {
  const dom = blockDocument(), restore = dom.install(), f = borrowedMotion(); let writes = 0;
  dom.doc.addEventListener = () => {}; dom.doc.removeEventListener = () => {};
  const library = mountBlockLibrary(dom.root, { capabilities: async () => capabilities,
    createBlock: async () => { writes++; throw new Error('Unexpected canonical create'); },
  }, { workspaceId: 'synthetic:workspace', expectedLayoutVersion: 1, onCreated() {}, onClose() {},
    drop: { motion: f.motion, viewId: 'synthetic:showroom', point: () => null } });
  t.after(() => { library.dispose(); restore(); }); await until(() => !!dom.root.querySelector('[data-block-kind="timeline"]'));
  dom.root.querySelector('[data-block-kind="timeline"]').onclick();
  const detail = dom.root.querySelector('.aw-library__detail'), replay = detail.querySelector('[data-demo-replay]'); replay.onclick();
  assert.equal(f.coordinator.bodies.size, 1); assert(f.wakes() > 0);
  for (let i = 0; i < 10; i++) library.frame();
  assert.match(detail.textContent, /Example step 1 \/ 4/);
  f.coordinator.step(1 / 60); library.frame();
  assert.notEqual(detail.querySelector('.aw-showroom-demo .aw-showroom-miniature').parentElement.style.transform, 'translateY(0px)');
  for (let i = 0; i < 1000; i++) { f.coordinator.step(1 / 60); library.frame(); }
  assert.match(detail.textContent, /Example step 4 \/ 4/); assert.equal(f.coordinator.bodies.size, 0); assert.equal(writes, 0);
  assert(f.coordinator.receipts.some(receipt => receipt.cause === 'instrument:replay'));
  replay.onclick(); assert.equal(f.coordinator.bodies.size, 1);
  dom.root.querySelector('[data-block-kind="note"]').onclick(); assert.equal(f.coordinator.bodies.size, 0);
  assert.equal(writes, 0);
});

test('pause, inactivity, visibility changes and disposal release only the replay key; no hidden replay resumes itself', t => {
  const dom = blockDocument(), restore = dom.install(), f = borrowedMotion(); let controller!: ShowroomReplay, active = true;
  const visibilityListeners = new Set<() => void>();
  dom.doc.addEventListener = (name: string, listener: () => void) => { if (name === 'visibilitychange') visibilityListeners.add(listener); };
  dom.doc.removeEventListener = (name: string, listener: () => void) => { if (name === 'visibilitychange') visibilityListeners.delete(listener); };
  const demo = showroomDemonstration('timeline', { motion: f.motion, key: 'fixture:replay', active: () => active, register: value => { controller = value; } });
  dom.root.append(demo); t.after(() => { controller.dispose(); restore(); });
  f.motion.add('unrelated', { x: 0, y: 0, w: 0, h: 0, lift: 0, yaw: 0, opacity: 1 });
  const play = () => demo.querySelector<HTMLButtonElement>('[data-demo-replay]')!.onclick!({} as MouseEvent);
  play(); demo.querySelector<HTMLButtonElement>('[data-demo-pause]')!.onclick!({} as MouseEvent);
  assert.deepEqual([...f.coordinator.bodies.keys()], ['unrelated']);
  play(); active = false; controller.frame(); assert.deepEqual([...f.coordinator.bodies.keys()], ['unrelated']);
  active = true; controller.frame(); assert.equal(f.coordinator.bodies.size, 1);
  play(); (dom.doc as any).visibilityState = 'hidden'; for (const listener of visibilityListeners) listener();
  assert.equal(f.coordinator.bodies.size, 1, 'Hidden-document cleanup does not require another host frame');
  (dom.doc as any).visibilityState = 'visible'; play(); assert.equal(f.coordinator.bodies.size, 2);
  controller.dispose(); controller.frame(); play(); assert.deepEqual([...f.coordinator.bodies.keys()], ['unrelated']); assert.equal(visibilityListeners.size, 0);
});

test('reduced motion uses manual steps without adding coordinator channels, including a preference change during replay', t => {
  const dom = blockDocument(), restore = dom.install(), f = borrowedMotion(); let controller!: ShowroomReplay;
  f.coordinator.reduced = true;
  const demo = showroomDemonstration('clock_timer', { motion: f.motion, key: 'fixture:reduced', register: value => { controller = value; } }); dom.root.append(demo);
  t.after(() => { controller.dispose(); restore(); });
  assert.match(demo.textContent!, /Advance steps manually/);
  const play = () => demo.querySelector<HTMLButtonElement>('[data-demo-replay]')!.onclick!({} as MouseEvent);
  play(); controller.frame(); assert.equal(f.coordinator.bodies.size, 0);
  demo.querySelector<HTMLButtonElement>('[data-demo-next]')!.onclick!({} as MouseEvent); assert.match(demo.textContent!, /04:59/);
  f.coordinator.reduced = false; play(); assert.equal(f.coordinator.bodies.size, 1);
  f.coordinator.reduced = true; controller.frame(); assert.equal(f.coordinator.bodies.size, 0);
});
