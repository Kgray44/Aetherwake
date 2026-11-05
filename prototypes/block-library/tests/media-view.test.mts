import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser as XmlParser } from '@xmldom/xmldom';
import { mountMediaExperience, type MediaResource } from '../media-view.ts';
import { mountSafeDocument } from '../media-docx-dom.ts';
import { parseDocx } from '../media-docx-parser.ts';
import { mountBlockLibrary } from '../view.ts';
import { mountDirectResourceExperience } from '../direct-resource-view.ts';
import { docxFixture } from './media-fixtures.mts';
import { blockDocument } from './component-dom.mts';
import { until } from '../../conversation-product/test/component-dom.mts';
import type { MediaReadPort, MediaMetadata } from '../../application-contract/media.ts';

const file: MediaResource = { id: 'canonical:media', kind: 'file', title: 'Synthetic media', version: 7 };
const findButton = (root: any, label: string) => root.querySelectorAll('button').find((item: any) => item.textContent === label);
function ports(metadata: MediaMetadata) {
  const calls: { name: string; input: any }[] = [];
  const port: MediaReadPort = {
    async describe(input) { calls.push({ name: 'describe', input }); return { metadata, capabilities: { read: true, play: true, embed: false, openExternal: true } }; },
    async readBytes(input) { calls.push({ name: 'readBytes', input }); return new TextEncoder().encode('Actual text\nLine two'); },
    async acquirePlayback(input) { calls.push({ name: 'acquirePlayback', input }); return { leaseId: 'lease:opaque', kind: 'local-video', src: 'aerynth-media://lease/opaque', mime: 'video/mp4' }; },
    async releasePlayback(input) { calls.push({ name: 'releasePlayback', input }); },
    async openExternal(input) { calls.push({ name: 'openExternal', input }); },
  }; return { port, calls };
}
test('actual DOCX output becomes a restricted semantic DOM; source URLs, events and active markup are never adopted', async t => {
  const result = await parseDocx(docxFixture());
  const dom = blockDocument(); t.after(dom.install());
  // The exact locked XML parser already used by Mammoth supplies XML nodes in
  // this CPU test. Production uses the browser's inert XML DOMParser.
  const source = result.html + '<p onclick="alert(1)"><script>bad()</script><iframe src="https://example.org"/><img src="https://example.org/remote.png"/><a href="javascript:alert(1)">Unsafe link text</a></p>';
  const content = mountSafeDocument(dom.root, source, new XmlParser() as unknown as DOMParser);
  assert.match(content.textContent!, /Synthetic document/); assert.ok(content.querySelector('h1')); assert.ok(content.querySelector('strong')); assert.ok(content.querySelector('table'));
  assert.equal(content.querySelector('script'), null); assert.equal(content.querySelector('iframe'), null); assert.equal(content.querySelector('img'), null);
  assert.equal(content.querySelector('a'), null); assert.match(content.textContent!, /Unsafe link text/); assert.doesNotMatch(content.textContent!, /bad\(\)/);
  for (const element of content.querySelectorAll('*')) { assert.equal(element.getAttribute('onclick'), null); assert.equal(element.getAttribute('href'), null); }
});
test('text file viewer reads the exact canonical revision, preserves its DOM while inactive and never writes or creates a placement', async t => {
  const dom = blockDocument(); t.after(dom.install());
  const f = ports({ source: 'file', format: 'text', name: 'Synthetic.txt', mime: 'text/plain', sourceRevision: 'source:7', byteLength: 20 });
  const view = mountMediaExperience(dom.root, file, f.port); t.after(() => view.dispose());
  await until(() => dom.root.textContent.includes('Text ready.'));
  const content = dom.root.querySelector('pre')!; assert.equal(content.textContent, 'Actual text\nLine two');
  assert.deepEqual(f.calls.find(item => item.name === 'readBytes')!.input, { resourceId: file.id, expectedVersion: 7, sourceRevision: 'source:7', offset: 0, length: 20 });
  view.setActive(false); view.setActive(true); assert.equal(dom.root.querySelector('pre'), content);
  await view.flush(); assert.equal(f.calls.length, 2);
  findButton(dom.root, 'Open original').onclick(); await until(() => f.calls.some(item => item.name === 'openExternal'));
  assert.deepEqual(f.calls.at(-1)!.input, { resourceId: file.id, expectedVersion: 7 });
  view.update({ ...file, available: false }); assert.equal(dom.root.querySelector('pre'), null); assert.match(dom.root.textContent, /resource is unavailable/);
});
test('YouTube remains a real external canonical link without an embed capability; mounting never starts playback or fetches media bytes', async t => {
  const dom = blockDocument(); t.after(dom.install());
  const f = ports({ source: 'link', format: 'youtube', name: 'Synthetic YouTube', mime: 'text/html', sourceRevision: 'link:1', url: 'https://youtu.be/abcdefghijk', youtubeId: 'abcdefghijk' });
  const view = mountMediaExperience(dom.root, { ...file, kind: 'link' }, f.port); t.after(() => view.dispose());
  await until(() => dom.root.textContent.includes('Inline YouTube playback is unavailable'));
  assert.deepEqual(f.calls.map(item => item.name), ['describe']); assert.equal(findButton(dom.root, 'Open player').disabled, true);
  findButton(dom.root, 'Open player').onclick(); await new Promise(resolve => setImmediate(resolve)); assert.equal(f.calls.length, 1);
  assert.equal(dom.root.querySelector('iframe'), null);
  findButton(dom.root, 'Open original').onclick(); await until(() => f.calls.length === 2); assert.equal(f.calls[1].name, 'openExternal');
});
test('placement-free canonical focus uses the identical media reader without acquiring a NoteSession or writing content', async t => {
  const dom = blockDocument(); t.after(dom.install());
  const f = ports({ source: 'file', format: 'text', name: 'Focused.txt', mime: 'text/plain', sourceRevision: 'focus:7', byteLength: 20 });
  const forbidden = () => { throw new Error('Media must not use note/task/editor or placement factories'); };
  const resource = { ...file, content: '', provider: 'local' as const, messages: [] };
  const view = mountDirectResourceExperience(dom.root, resource, { media: f.port, notes: {} as any, noteSession: forbidden,
    saveContent: forbidden, setTaskStatus: forbidden, setTaskPriority: forbidden, manageMembers: forbidden, openResource: forbidden }); t.after(() => view.dispose());
  await until(() => dom.root.textContent.includes('Text ready.')); assert.equal(dom.root.querySelectorAll('.aw-media').length, 1);
  assert.equal(dom.root.querySelector('textarea'), null); await view.flush();
  assert.deepEqual(f.calls.map(item => item.name), ['describe', 'readBytes']);
  view.update({ ...resource, available: false }); assert.equal(dom.root.querySelector('pre'), null);
});
test('local video leases are explicit, non-autoplay and released on suspension; resumed viewer stays usable and late acquisition is released after disposal', async t => {
  const dom = blockDocument(); t.after(dom.install());
  const create = dom.doc.createElement; let pauses = 0;
  dom.doc.createElement = (tag: string) => { const element = create(tag); if (tag === 'video') { element.pause = () => { pauses++; }; element.load = () => {}; } return element; };
  const f = ports({ source: 'file', format: 'video', name: 'Synthetic.mp4', mime: 'video/mp4', byteLength: 100, sourceRevision: 'video:1' });
  const view = mountMediaExperience(dom.root, file, f.port);
  await until(() => !!findButton(dom.root, 'Open player')); assert.equal(f.calls.length, 1);
  findButton(dom.root, 'Open player').onclick(); await until(() => !!dom.root.querySelector('video'));
  const video = dom.root.querySelector('video') as any; assert.equal(video.autoplay, false); assert.equal(video.controls, true); assert.equal(video.preload, 'metadata');
  view.setActive(false); assert.equal(pauses, 1); assert.equal(f.calls.filter(item => item.name === 'releasePlayback').length, 1);
  view.setActive(true); findButton(dom.root, 'Open player').onclick(); await until(() => f.calls.filter(item => item.name === 'acquirePlayback').length === 2);
  await new Promise(resolve => setImmediate(resolve)); view.dispose(); assert.equal(f.calls.filter(item => item.name === 'releasePlayback').length, 2);
  const late = blockDocument(); // The same installed document owns this second CPU slot.
  let resolveLease!: (value: any) => void;
  const delayed = { ...f.port, acquirePlayback: () => new Promise<any>(resolve => { resolveLease = resolve; }) };
  const second = mountMediaExperience(late.root, file, delayed); await until(() => !!findButton(late.root, 'Open player'));
  findButton(late.root, 'Open player').onclick(); second.dispose();
  resolveLease({ leaseId: 'lease:late', src: 'aerynth-media://lease/late', kind: 'local-video', mime: 'video/mp4' });
  await until(() => f.calls.some(item => item.name === 'releasePlayback' && item.input.leaseId === 'lease:late'));
});
test('library media choices invoke only the explicit native import with current layout CAS; cancellation and missing capability never create generic shells', async t => {
  const dom = blockDocument(); t.after(dom.install()); const calls: any[] = []; let revision = 11, cancelled = true, revealed = 0;
  const port: any = { capabilities: async () => ({ revision: 1, kinds: { file: { state: 'available' }, link: { state: 'available' } }, providers: {}, velaPlanning: { state: 'unsupported' } }),
    createBlock: async () => { throw new Error('generic file shells are forbidden'); }, mediaImport: { chooseMediaForAdd: async (input: any) => { calls.push(input); return cancelled ? null : { resource: file, placementId: 'placement:canonical' }; } } };
  const view = mountBlockLibrary(dom.root, port, { workspaceId: 'workspace:real', expectedLayoutVersion: () => revision, bounds: () => revision === 13 ? { x: 20, y: 170, width: 800, height: 600 } : undefined, onCreated() {}, onClose() {}, onMediaCreated() { revealed++; } }); t.after(() => view.dispose());
  await until(() => !!dom.root.querySelector('[data-media-import]'));
  (dom.root.querySelectorAll('[data-media-import]').find((item: any) => item.dataset.mediaImport === 'media.pdf') as any).onclick();
  findButton(dom.root, 'Choose pdf').closest('form').requestSubmit(); await until(() => dom.root.textContent.includes('Selection cancelled.'));
  assert.equal(revealed, 0); assert.deepEqual(calls[0], { kind: 'file', variant: 'pdf', workspaceId: 'workspace:real', expectedLayoutVersion: 11 });
  cancelled = false; revision = 12; findButton(dom.root, 'Choose pdf').closest('form').requestSubmit(); await until(() => revealed === 1); assert.equal(calls[1].expectedLayoutVersion, 12);
  (dom.root.querySelectorAll('[data-media-import]').find((item: any) => item.dataset.mediaImport === 'media.link') as any).onclick();
  const form = findButton(dom.root, 'Add link').closest('form');
  const url = form.querySelector('input');
  assert.equal(url.type, 'url');
  url.value = 'file:///private/local.txt'; form.requestSubmit();
  assert.equal(calls.length, 2, 'Local paths cannot reach link import');
  url.value = '  https://example.org/document?q=1  ';
  revision = 13; form.requestSubmit();
  await until(() => revealed === 2);
  assert.deepEqual(calls[2], {
    kind: 'link', variant: 'any', workspaceId: 'workspace:real', expectedLayoutVersion: 13,
    bounds: { x: 20, y: 170, width: 800, height: 600 },
    url: 'https://example.org/document?q=1',
  });
  delete port.mediaImport; await view.refreshCapabilities(); assert.equal(findButton(dom.root, 'Add link').disabled, true);
});
