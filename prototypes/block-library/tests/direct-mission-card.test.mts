import test from 'node:test';
import assert from 'node:assert/strict';
import { mountDirectResourceExperience, type DirectResourcePorts } from '../direct-resource-view.ts';
import { NoteSession } from '../note-session.ts';
import type { Resource } from '../../application-contract/contracts.ts';
import type { TimelineExperience } from '../timeline-view.ts';
import { blockDocument } from './component-dom.mts';
import { until } from '../../conversation-product/test/component-dom.mts';

const resource = (kind: 'note' | 'stream' = 'note'): Resource => ({ id: 'synthetic:mission-card', kind, title: 'Synthetic bound mission graph',
  version: 1, content: '', provider: 'local', messages: [] });
const forbidden = () => { throw Error('No generic editor, event port or canonical mutation is allowed for a bound mission card'); };
const basePorts = (): DirectResourcePorts => ({ notes: { readNote: forbidden, saveNoteDraft: forbidden, commitNote: forbidden, discardNoteDraft: forbidden },
  noteSession: forbidden, saveContent: forbidden, setTaskStatus: forbidden, setTaskPriority: forbidden, manageMembers: forbidden, openResource: forbidden,
  events: { snapshot: forbidden, refresh: forbidden } });

for (const kind of ['note', 'stream'] as const) test('direct mission ' + kind + ' keeps canonical identity and delegates lifecycle without generic dispatch or duplicate mounts', async t => {
  const dom = blockDocument(), restore = dom.install(), calls: string[] = []; let mounts = 0;
  const target = resource(kind), marker = dom.doc.createElement('section'); marker.textContent = 'Authorized canonical mission Flow';
  const card: TimelineExperience = { setPresentation: value => { calls.push('presentation:' + value); }, setActive: value => { calls.push('active:' + value); },
    refresh: async () => { calls.push('refresh'); }, flush: async () => { calls.push('flush'); }, frame: () => { calls.push('frame'); },
    reflow: () => { calls.push('reflow'); }, dispose: () => { calls.push('dispose'); marker.remove(); } };
  const view = mountDirectResourceExperience(dom.root, target, { ...basePorts(), mountMissionCard(host, actual) {
    mounts++; assert.equal(actual.id, target.id); assert.equal(actual.kind, kind); host.append(marker); return card;
  } }); t.after(() => { view.dispose(); restore(); });
  assert.equal(dom.root.dataset.resourceId, target.id); assert.equal(dom.root.querySelector('textarea'), null);
  assert.equal(dom.root.querySelector('.aw-event-view'), null); assert.equal(mounts, 1);
  view.frame!(); view.reflow!(); await view.flush(); assert(calls.includes('frame') && calls.includes('reflow') && calls.includes('flush'));
  view.update({ ...target, version: 2 }); await until(() => calls.includes('refresh')); assert.equal(mounts, 1);
  view.update({ ...target, version: 2, title: 'Updated canonical title' }); assert.equal(mounts, 1);
  view.setActive(false); const before = calls.length; view.frame!(); view.reflow!(); await view.refresh!(); assert.equal(calls.length, before);
  view.setActive(true); assert.equal(mounts, 1); assert(calls.includes('active:false'));
  dom.doc.hidden = true; const frames = calls.filter(value => value === 'frame').length; view.frame!(); await view.refresh!(); assert.equal(calls.filter(value => value === 'frame').length, frames);
  assert.throws(() => view.update({ ...target, id: 'other' }), /identity cannot change/);
  view.dispose(); view.dispose(); assert.equal(calls.filter(value => value === 'dispose').length, 1);
});

test('direct mission access loss stops and redacts immediately, and a previously bound ID cannot fall through to a Note editor', async t => {
  const dom = blockDocument(), restore = dom.install(), target = resource(), calls: string[] = []; let authorized = true, mounts = 0;
  const view = mountDirectResourceExperience(dom.root, target, { ...basePorts(), mountMissionCard(host) {
    mounts++; if (!authorized) return undefined;
    const text = dom.doc.createElement('p'); text.textContent = 'SYNTHETIC authorized mission metadata'; host.append(text);
    return { setPresentation() {}, setActive: value => { calls.push('active:' + value); }, refresh: async () => { calls.push('refresh'); }, flush: async () => {},
      frame() {}, reflow() {}, dispose() { calls.push('dispose'); text.remove(); } };
  } }); t.after(() => { view.dispose(); restore(); });
  view.update({ ...target, available: false });
  assert.equal(dom.root.querySelector('.aw-direct-resource-body').textContent, ''); assert(calls.includes('active:false')); assert(calls.includes('dispose'));
  await assert.rejects(view.flush(), /Mission card is unavailable/);
  authorized = false; view.update({ ...target, version: 2 });
  assert.equal(dom.root.querySelector('textarea'), null); assert.match(dom.root.textContent, /mission card binding is unavailable/);
  await assert.rejects(view.flush(), /Mission card is unavailable/); assert.equal(mounts, 2);
  authorized = true; view.update({ ...target, version: 3 }); assert.equal(mounts, 3); assert.match(dom.root.textContent, /authorized mission metadata/);
  view.update({ ...target, version: 3, state: 'archived' }); assert.equal(dom.root.querySelector('.aw-direct-resource-body').textContent, '');
});

test('undefined mission factory preserves ordinary Note sessions and ordinary Stream presentation', async t => {
  const dom = blockDocument(), restore = dom.install(); dom.doc.addEventListener = () => {}; dom.doc.removeEventListener = () => {};
  t.after(restore); let factoryCalls = 0, sessions = 0;
  const target = { ...resource(), id: 'ordinary:note', content: '# Ordinary local note' };
  const notes = { readNote: async () => ({ resource: target, draft: null, draftRevision: 0, conflict: false, canRename: false }),
    saveNoteDraft: forbidden, commitNote: forbidden, discardNoteDraft: forbidden };
  const session = new NoteSession(target.id, notes, target);
  const view = mountDirectResourceExperience(dom.root, target, { ...basePorts(), notes, noteSession: () => { sessions++; return session; },
    mountMissionCard() { factoryCalls++; return undefined; } });
  await until(() => session.snapshot().phase !== 'loading');
  const editor = dom.root.querySelector('textarea'); assert(editor); editor.focus(); editor.setSelectionRange(2, 8);
  view.update({ ...target, title: 'Changed title' }); assert.equal(dom.root.querySelector('textarea'), editor); assert.equal(editor.selectionStart, 2);
  assert.equal(sessions, 1); assert.equal(factoryCalls, 1); view.dispose();
  const stream = mountDirectResourceExperience(dom.root, { ...resource('stream'), id: 'ordinary:stream' }, { ...basePorts(),
    mountMissionCard() { factoryCalls++; return undefined; }, events: { snapshot: () => ({ events: [], earliest: null, latest: 0, disconnected: false,
      resources: [], workspaceResourceIds: [], projectId: null }), refresh: async () => {} } });
  assert(dom.root.querySelector('.aw-event-view')); assert.equal(factoryCalls, 2); stream.dispose();
});
