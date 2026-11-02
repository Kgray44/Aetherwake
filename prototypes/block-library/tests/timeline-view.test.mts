import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { timelineFixture } from './timeline-view-fixture.mts';
import { mountTimelineExperience } from '../timeline-view.ts';
import { blockDocument } from './component-dom.mts';
import { until } from '../../conversation-product/test/component-dom.mts';
import { MotionCoordinator } from '../../visual-experience/cinematic-v3/src/motion.ts';
import type { ExperienceMotionPort } from '../../application-contract/motion.ts';
import type { SaveTimeline, TimelineDocument, TimelinePort, TimelineWindow } from '../../timeline-product/contracts.ts';
const button = (root: any, text: string) => root.querySelectorAll('button').find((value: any) => value.textContent === text);
const input = (root: any, name: string) => root.querySelectorAll('input').find((value: any) => value.getAttribute('aria-label') === name);
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
async function setup(t: any, configure?: (f: ReturnType<typeof timelineFixture>) => { port?: TimelinePort; active?: boolean }) {
  const f = timelineFixture(t); f.add(); const configured = configure?.(f) ?? {}, dom = blockDocument(), restore = dom.install(), coordinator = new MotionCoordinator();
  const motion: ExperienceMotionPort = { get reduced() { return coordinator.reduced; }, add: (key, pose) => coordinator.add(key, pose), target: (key, pose, cause) => coordinator.target(key, pose, cause), pose: key => coordinator.pose(key), remove: key => { coordinator.bodies.delete(key); }, wake() {} };
  const opened: string[] = []; let document: TimelineDocument | null = null, window: TimelineWindow | null = null;
  const controller = mountTimelineExperience(dom.root, f.created.resourceId, configured.port ?? f.port, { motion, viewId: 'synthetic:timeline-view', active: configured.active,
    onOpenResource: id => { opened.push(id); }, onProjection: (doc, value) => { document = doc; window = value; } });
  t.after(() => { controller.dispose(); restore(); });
  const settled = () => dom.root.querySelector('.aw-timeline').getAttribute('aria-busy') === 'false';
  const ready = () => until(() => !!document && settled());
  const frame = () => { for (let i = 0; i < 100; i++) { coordinator.step(1 / 60); controller.frame(); } };
  return { f, dom, controller, coordinator, opened, ready, frame, settled, get document() { return document; }, get window() { return window; } };
}

test('Timeline reads real retained headers, saves pan/zoom/back/selection through canonical commands and uses only shared motion', async t => {
  const s = await setup(t); await s.ready(); s.frame();
  assert.equal(s.window!.items.length, 1); assert.equal(s.dom.root.querySelectorAll('.aw-timeline-items li').length, 1);
  assert.doesNotMatch(s.dom.root.textContent, /SYNTHETIC_PRIVATE_PAYLOAD/);
  s.dom.root.querySelector('.aw-timeline-items button').onclick();
  assert.match(s.dom.root.querySelector('.aw-timeline-selection').textContent, /Event reference|Capture cursor/);
  button(s.dom.root, 'Open source').onclick(); await until(() => s.opened.length === 1); assert.equal(s.opened[0], s.f.source.id);
  const version = s.document!.resource.version; button(s.dom.root, 'Save view').onclick(); await until(() => s.document!.resource.version === version + 1 && s.settled());
  assert.equal(s.f.service.read(s.f.created.resourceId).view.selection!.eventId, s.window!.items[0].event.eventId);
  const original = s.document!.view.viewport; button(s.dom.root, 'Zoom in').onclick(); await until(() => s.document!.resource.version === version + 2 && s.settled());
  assert.equal(Date.parse(s.document!.view.viewport.to) - Date.parse(s.document!.view.viewport.from), (Date.parse(original.to) - Date.parse(original.from)) / 2);
  button(s.dom.root, 'Previous view').onclick(); await until(() => s.document!.resource.version === version + 3 && s.settled()); assert.deepEqual(s.document!.view.viewport, original);
  const filters = s.dom.root.querySelector('.aw-timeline-filters'); button(s.dom.root, 'Filters').onclick(); s.frame(); assert.equal(filters.hidden, false);
  button(s.dom.root, 'Filters').onclick(); assert.equal(filters.inert, true); s.frame(); assert.equal(filters.hidden, true);
  assert.equal(s.f.db.prepare('SELECT count(*) n FROM workspaces').get()!.n, 0); assert.equal(s.f.db.prepare('SELECT count(*) n FROM blocks').get()!.n, 0);
  assert.equal(s.f.kernel.getResource(s.f.created.resourceId).resource.kind, 'generic');
});

test('lost save acknowledgment retries its exact receipt, saved/read-failure stays truthful, and fresh read-only permission disables actual edits', async t => {
  let lost = true, denyRead = false; const inputs: SaveTimeline[] = [];
  const s = await setup(t, f => ({ port: { ...f.port, read: async id => { if (denyRead) throw new Error('Synthetic read interruption'); return f.service.read(id); }, save: async value => {
    inputs.push(structuredClone(value)); const result = f.service.save(value); if (lost) { lost = false; throw new Error('Synthetic lost acknowledgment'); } return result;
  } } }));
  await s.ready(); const from = input(s.dom.root, 'From (UTC)'); from.value = '2026-11-02T06:00:00'; from.onchange();
  button(s.dom.root, 'Save view').onclick(); await until(() => s.dom.root.querySelector('.aw-timeline-status').textContent.includes('could not be confirmed'));
  await assert.rejects(s.controller.flush(), /needs confirmation/); button(s.dom.root, 'Retry save').onclick(); await until(() => inputs.length === 2 && s.settled());
  assert.deepEqual(inputs[0], inputs[1]); assert.equal(s.f.service.read(s.f.created.resourceId).resource.version, 2);
  denyRead = true; from.value = '2026-11-02T07:00:00'; from.onchange(); button(s.dom.root, 'Save view').onclick();
  await until(() => s.dom.root.querySelector('.aw-timeline-status').textContent.startsWith('View saved.')); assert.equal(s.f.service.read(s.f.created.resourceId).resource.version, 3);
  denyRead = false; await s.controller.refresh(); await s.controller.flush(); s.f.setWritable(false); await s.controller.refresh();
  assert.equal(s.document!.canEdit, false); assert.equal(button(s.dom.root, 'Zoom in').disabled, true);
  const before = inputs.length; button(s.dom.root, 'Zoom in').onclick(); await new Promise(resolve => setImmediate(resolve)); assert.equal(inputs.length, before);
});

test('inactive and stale reads do no hidden query work; current denial removes source headers/options while preserving local draft settings', async t => {
  const late = deferred<TimelineDocument>(); let reads = 0, queries = 0;
  const s = await setup(t, f => ({ active: false, port: { ...f.port, read: async id => ++reads === 1 ? late.promise : f.service.read(id), query: async value => { queries++; return f.service.query(value); } } }));
  assert.equal(reads, 0); s.controller.setActive(true); await until(() => reads === 1); s.controller.setActive(false);
  late.resolve(s.f.service.read(s.f.created.resourceId)); await new Promise(resolve => setImmediate(resolve)); assert.equal(queries, 0);
  s.controller.setActive(true); await s.ready(); const from = input(s.dom.root, 'From (UTC)'); from.value = '2026-11-02T05:00:00'; from.onchange();
  s.f.setDenied(true); await s.controller.refresh(); assert.equal(s.document, null); assert.equal(s.dom.root.querySelectorAll('.aw-timeline-items li').length, 0);
  assert.doesNotMatch(s.dom.root.textContent, /synthetic private event|synthetic-provider/);
  s.f.setDenied(false); await s.controller.refresh(); assert.equal(input(s.dom.root, 'From (UTC)').value, '2026-11-02T05:00:00');
  s.coordinator.add('unrelated:timeline-parent', { x: 0, y: 0, w: 0, h: 0, lift: 0, yaw: 0, opacity: 1 }); s.controller.dispose(); assert.deepEqual([...s.coordinator.bodies.keys()], ['unrelated:timeline-parent']);
});

test('next retained page honors frozen high-water and current permissions without keeping revoked prior-page headers', async t => {
  const s = await setup(t, f => { for (let index = 0; index < 50; index++) f.add(); return {}; }); await s.ready();
  assert.equal(s.window!.items.length, 50); assert(s.window!.next); const through = s.window!.source.throughCursor;
  s.f.add(); s.f.deniedResources.add(s.f.source.id); button(s.dom.root, 'Next events').onclick();
  await until(() => s.settled() && s.window!.items.length === 0); assert.equal(s.window!.source.throughCursor, through); assert.equal(s.window!.hasNewEvents, true);
  assert(s.window!.gaps.some(value => value.reason === 'access-filtered')); assert.equal(s.dom.root.querySelectorAll('.aw-timeline-items li').length, 0);
  assert.doesNotMatch(s.dom.root.textContent, /synthetic private event/);
  s.f.deniedResources.clear(); await s.controller.refresh(); assert.equal(s.window!.items.length, 50); assert.notEqual(s.window!.source.throughCursor, through);
  const source = readFileSync(new URL('../timeline-view.ts', import.meta.url), 'utf8'), css = readFileSync(new URL('../timeline-view.css', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /requestAnimationFrame|setTimeout|setInterval|new MotionCoordinator|ResizeObserver/); assert.doesNotMatch(css, /\btransition\s*:|\banimation\s*:/);
});

test('competing saved view requires explicit review before keeping local settings and event filters preserve actual classifications', async t => {
  const s = await setup(t, f => { f.add({ type: 'synthetic.provider_completed', executionId: 'synthetic:execution-reference', classification: 'reported', status: 'provider_completed' }); return {}; });
  await s.ready(); const from = input(s.dom.root, 'From (UTC)'); from.value = '2026-11-02T06:00:00'; from.onchange();
  const other = s.f.service.read(s.f.created.resourceId); other.view.viewport.from = '2026-11-02T10:00:00.000Z';
  s.f.service.save({ commandId: 'synthetic:competing-view', resourceId: other.resource.id, expectedVersion: other.resource.version, view: other.view });
  button(s.dom.root, 'Save view').onclick(); await until(() => s.dom.root.querySelector('.aw-timeline-status').textContent.includes('competing changes'));
  assert.equal(button(s.dom.root, 'Keep my view').disabled, true, 'Cannot rebase against a stale local document');
  await s.controller.refresh(); assert.equal(from.value, '2026-11-02T06:00:00'); assert.equal(button(s.dom.root, 'Save view').disabled, true);
  button(s.dom.root, 'Keep my view').onclick(); button(s.dom.root, 'Save view').onclick(); await until(() => s.document!.resource.version === 3 && s.settled());
  assert.equal(s.f.service.read(other.resource.id).view.viewport.from, '2026-11-02T06:00:00.000Z');
  const mode = s.dom.root.querySelectorAll('select').find((value: any) => value.getAttribute('aria-label') === 'Timeline mode');
  assert.deepEqual(mode.options.map((value: any) => value.value), ['activity', 'execution']); mode.value = 'execution'; mode.onchange();
  button(s.dom.root, 'Save view').onclick(); await until(() => s.document!.resource.version === 4 && s.settled());
  assert.equal(s.window!.items.length, 1); assert.equal(s.window!.items[0].evidenceClass, 'reported'); assert.equal(s.window!.items[0].taskVerification, 'not-established-by-this-projection');
  const evidence = s.dom.root.querySelectorAll('select').find((value: any) => value.getAttribute('aria-label') === 'Evidence class');
  evidence.value = 'observed'; evidence.onchange(); button(s.dom.root, 'Save view').onclick(); await until(() => s.document!.resource.version === 5 && s.settled()); assert.equal(s.window!.items.length, 0);
  evidence.value = ''; evidence.onchange(); button(s.dom.root, 'Save view').onclick(); await until(() => s.document!.resource.version === 6 && s.settled());
  assert.deepEqual(s.document!.view.sources.classifications, ['observed', 'reported', 'inferred', 'simulated']); assert.equal(s.window!.items.length, 1);
});
