import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { timelineFixture } from './timeline-view-fixture.mts';
import { mountTimelineExperience } from '../timeline-view.ts';
import { blockIdentity } from '../identity-model.ts';
import type { TimelineExternalOpen, TimelineExternalEvidence, TimelinePresentationPort, TimelinePresentationWindow, TimelineSourceCoverage, TimelineTimeAxis } from '../timeline-presentation.ts';
import { blockDocument } from './component-dom.mts';
import { until } from '../../conversation-product/test/component-dom.mts';
import { MotionCoordinator } from '../../visual-experience/cinematic-v3/src/motion.ts';
import type { ExperienceMotionPort } from '../../application-contract/motion.ts';
import type { SaveTimeline, TimelineDocument } from '../../timeline-product/contracts.ts';
const button = (root: any, text: string) => root.querySelectorAll('button').find((value: any) => value.textContent === text);
const input = (root: any, name: string) => root.querySelectorAll('input').find((value: any) => value.getAttribute('aria-label') === name);
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
async function setup(t: any, configure?: (f: ReturnType<typeof timelineFixture>) => { port?: TimelinePresentationPort; active?: boolean; showTitle?: boolean; externalOpen?: boolean }) {
  const f = timelineFixture(t); f.add(); const configured = configure?.(f) ?? {}, dom = blockDocument(), restore = dom.install(), coordinator = new MotionCoordinator();
  const motion: ExperienceMotionPort = { get reduced() { return coordinator.reduced; }, add: (key, pose) => coordinator.add(key, pose), target: (key, pose, cause) => coordinator.target(key, pose, cause), pose: key => coordinator.pose(key), remove: key => { coordinator.bodies.delete(key); }, wake() {} };
  const opened: string[] = [], external: TimelineExternalOpen[] = []; let document: TimelineDocument | null = null, window: TimelinePresentationWindow | null = null;
  const controller = mountTimelineExperience(dom.root, f.created.resourceId, configured.port ?? f.port, { motion, viewId: 'synthetic:timeline-view', active: configured.active, showTitle: configured.showTitle,
    onOpenResource: id => { opened.push(id); },
    ...(configured.externalOpen ? { onOpenExternalSource: (target: TimelineExternalOpen) => { external.push(target); } } : {}),
    onProjection: (doc, value) => { document = doc; window = value; } });
  t.after(() => { controller.dispose(); restore(); });
  const settled = () => dom.root.querySelector('.aw-timeline').getAttribute('aria-busy') === 'false';
  const ready = () => until(() => !!document && settled());
  const frame = () => { for (let i = 0; i < 100; i++) { coordinator.step(1 / 60); controller.frame(); } };
  return { f, dom, controller, coordinator, opened, external, ready, frame, settled, get document() { return document; }, get window() { return window; } };
}

test('typed GitHub evidence uses the saved axis, independent coverage, and an identity-only host open', async t => {
  const externalEvidence: TimelineExternalEvidence = {
    kind: 'github-commit', title: 'Preserve placement history',
    source: { ref: 'synthetic:retained-commit', label: 'fixture/repository · main', permalink: 'https://github.com/fixture/repository/commit/0123456789abcdef0123456789abcdef01234567' },
    reportedAt: '2026-11-02T03:00:00+01:00', timeSource: 'github-committer',
  };
  const sourceCoverage: TimelineSourceCoverage = {
    kind: 'github-commits', sourceLabel: externalEvidence.source.label, requestedFrom: '2026-11-01T00:00:00Z',
    requestedTo: '2026-11-03T00:00:00Z', fetchedAt: '2026-11-02T12:00:00Z', status: 'partial', omissionReason: 'Source page limit reached.',
  };
  let timeAxis: TimelineTimeAxis = 'receivedAt';
  const s = await setup(t, f => {
    f.add({ type: 'github.commit', providerId: 'github', classification: 'reported' });
    return { externalOpen: true, port: { ...f.port, query: async input => {
      const actual = f.service.query(input);
      return {
        ...actual, timeAxis, sourceCoverage,
        gaps: timeAxis === 'reportedAt' ? [...actual.gaps, { kind: 'evidence-gap', reason: 'reported-time-unavailable', cause: 'unavailable' }] : actual.gaps,
        items: actual.items.map(item => item.event.type === 'github.commit' ? { ...item, externalEvidence } : item),
      };
    } } };
  });
  await s.ready(); s.frame();
  const item = s.window!.items.find(item => item.externalEvidence)!;
  const rendered = () => s.dom.root.querySelectorAll('.aw-timeline-items li').find((row: any) => row.dataset.eventId === item.event.eventId);
  const dotKey = 'timeline:synthetic:timeline-view:event:' + item.event.cursor + ':' + item.event.eventId + ':dot';
  const capturedX = s.coordinator.pose(dotKey).x;
  assert.match(s.dom.root.querySelector('.aw-timeline-range').textContent, /capture time/);
  assert.equal(rendered().querySelector('time').getAttribute('datetime'), item.event.receivedAt);
  assert.match(s.dom.root.querySelector('.aw-timeline-source-coverage').textContent, /partial source coverage.*Source page limit reached/);
  assert.match(s.dom.root.querySelector('.aw-timeline-coverage').textContent, /retained page scanned/);
  rendered().querySelector('button').onclick();
  assert.match(s.dom.root.querySelector('.aw-timeline-selection').textContent, /Preserve placement history.*Reported time.*GitHub committer time.*2026-11-02T03:00:00\+01:00.*Captured/);
  assert.equal(s.dom.root.querySelectorAll('a').length, 0, 'External opens use the host action');
  const open = button(s.dom.root, 'Open commit on GitHub');
  open.onclick(); await until(() => s.external.length === 1);
  assert.deepEqual(s.external[0], { timelineId: s.f.created.resourceId, eventId: item.event.eventId, cursor: item.event.cursor });

  timeAxis = 'reportedAt'; await s.controller.refresh(); s.frame();
  assert.match(s.dom.root.querySelector('.aw-timeline-range').textContent, /reported time/);
  assert.match(s.dom.root.querySelector('.aw-timeline-legend').textContent, /Reported event positions/);
  assert.match(s.dom.root.querySelector('.aw-timeline-gaps').textContent, /no usable reported time/);
  assert.equal(rendered().querySelector('time').getAttribute('datetime'), externalEvidence.reportedAt);
  assert.ok(s.coordinator.pose(dotKey).x < capturedX);
  assert.equal(s.dom.root.querySelectorAll('.aw-timeline-dot').filter((marker: any) => marker.hidden).length, 1, 'Missing reported time has no track position');
  const resource = { ...s.document!.resource, kind: 'timeline' as const, provider: 'local' as const, content: '', messages: [] };
  const compact = blockIdentity({ kind: 'timeline', resource, timeline: { document: s.document, window: s.window } });
  assert.deepEqual(compact.rows.map(row => row.time), [externalEvidence.reportedAt, undefined]);
  assert.equal(compact.rows[0].title, externalEvidence.title);
  assert.match(compact.subtitle, /reported events.*partial source coverage/);
  open.onclick();
  assert.equal(s.external.length, 1, 'An action retained from a prior window is stale');
  s.f.setDenied(true); await s.controller.refresh();
  assert.doesNotMatch(s.dom.root.textContent, /fixture\/repository|Preserve placement history/);
  assert.equal(s.dom.root.querySelector('.aw-timeline-source-coverage').hidden, true);
});

test('Timeline reads real retained headers, saves pan/zoom/back/selection through canonical commands and uses only shared motion', async t => {
  const s = await setup(t); await s.ready(); s.frame();
  assert.equal(s.dom.root.querySelector('.aw-timeline h3').hidden, false, 'Standalone title is visible by default');
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

test('a host-owned title can suppress the retained Timeline heading through refresh without hiding its experience', async t => {
  const s = await setup(t, () => ({ showTitle: false })); await s.ready(); s.frame();
  const heading = s.dom.root.querySelector('.aw-timeline h3'); assert.equal(heading.hidden, true); assert.equal(heading.textContent, s.document!.resource.title);
  await s.controller.refresh(); assert.equal(s.dom.root.querySelector('.aw-timeline h3'), heading); assert.equal(heading.hidden, true);
  assert.equal(s.dom.root.querySelector('.aw-timeline').hidden, false); assert.equal(s.window!.items.length, 1);
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

test('LI-05/LI-16: temporal default, cluster keyboard inspection, orientation and forensic disclosure preserve event identity', async t => {
  const s = await setup(t, f => { f.add(); f.add({ receivedAt: '2026-11-02T06:00:00.000Z', providerId: 'another-source' }); return {}; });
  await s.ready(); s.frame();
  const list = s.dom.root.querySelector('.aw-timeline-items');
  assert.equal(list.hidden, true, 'Chronology is the primary presentation');
  assert.ok(s.dom.root.querySelectorAll('.aw-timeline-tick').length > 1);
  const dots = s.dom.root.querySelectorAll('.aw-timeline-dot');
  assert.equal(dots.filter((value: any) => !value.hidden).length, 2, 'Coincident events cluster');
  const first = dots.find((value: any) => value.tabIndex === 0)!;
  first.onkeydown({ key: 'End', preventDefault() {} }); s.frame();
  const selected = dots.find((value: any) => value.getAttribute('aria-pressed') === 'true')!;
  assert.equal(selected.hidden, false, 'Every clustered event can become the visible anchor');
  const version = s.document!.resource.version;
  const orientation = s.dom.root.querySelectorAll('select').find((value: any) => value.getAttribute('aria-label') === 'Orientation');
  orientation.value = 'vertical'; orientation.onchange(); s.frame();
  assert.equal(s.dom.root.querySelector('.aw-timeline').dataset.orientation, 'vertical');
  assert.equal(selected.getAttribute('aria-pressed'), 'true');
  orientation.value = 'multilane'; orientation.onchange();
  assert.equal(s.dom.root.querySelectorAll('.aw-timeline-lane-label').length, 2);
  assert.equal(s.document!.resource.version, version, 'Presentation does not mutate canonical history');
  button(s.dom.root, 'Forensic event list').onclick(); assert.equal(list.hidden, false);
  button(s.dom.root, 'Save view').onclick(); await until(() => s.document!.resource.version === version + 1 && s.settled());
  const saved = s.f.service.read(s.f.created.resourceId).view.selection;
  assert.equal(saved!.eventId, selected.dataset.eventId);
});

test('LI-06 partial: scrubbing uses exact retained timestamps without writes and stops on current-access refresh', async t => {
  const s = await setup(t, f => { f.add({ receivedAt: '2026-11-02T13:00:00.000Z' }); return {}; });
  await s.ready();
  const scrub = s.dom.root.querySelectorAll('input').find((value: any) => value.getAttribute('aria-label') === 'Recorded time position');
  const version = s.document!.resource.version;
  scrub.value = String(Date.parse('2026-11-02T12:30:00Z')); scrub.oninput(); s.controller.frame();
  assert.equal(s.dom.root.querySelector('.aw-timeline-playhead').hidden, false);
  assert.equal(s.dom.root.querySelectorAll('.aw-timeline-dot').filter((value: any) => value.dataset.reviewState === 'reached').length, 1);
  assert.equal(s.document!.resource.version, version);
  assert.equal(s.f.events.length, 1, 'Only the original canonical creation receipt exists');
  button(s.dom.root, 'Play recorded time').onclick();
  assert.ok(button(s.dom.root, 'Pause recorded time'));
  s.controller.setActive(false); s.controller.frame();
  assert.ok(button(s.dom.root, 'Play recorded time'));
  s.f.setDenied(true); s.controller.setActive(true); await until(() => s.dom.root.querySelector('.aw-timeline-status').textContent.includes('could not be read'));
  assert.equal(s.dom.root.querySelectorAll('.aw-timeline-dot').length, 0);
  assert.equal(s.dom.root.querySelector('.aw-timeline-playhead').hidden, true);
});
