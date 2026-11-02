import test from 'node:test';
import assert from 'node:assert/strict';
import { mountNoteExperience } from '../note-view.ts';
import { mountDirectResourceExperience } from '../direct-resource-view.ts';
import { NoteSession } from '../note-session.ts';
import type { NoteExperiencePort, NoteDocument } from '../note-contracts.ts';
import { blockDocument } from './component-dom.mts';
import { until } from '../../conversation-product/test/component-dom.mts';

// Actual component/session at a CPU DOM boundary. No native clipboard read or
// write is performed here; Root owns exact Windows readback acceptance.
const button = (root: any, label: string) => root.querySelectorAll('button').find((item: any) => item.textContent === label);
async function fixture(t: any, kind: 'note' | 'reference' | 'research', copyText?: (text: string) => Promise<void>, content = '# Synthetic source\nhttps://example.org/source?q=1&v=2') {
  const dom = blockDocument(), restore = dom.install(), cleanup: (() => void)[] = []; dom.doc.addEventListener = () => {}; dom.doc.removeEventListener = () => {};
  const resource = { id: 'canonical:' + kind, kind, title: 'Synthetic ' + kind, version: 3, content, project_id: 'project:actual' };
  const mutations: string[] = [], doc: NoteDocument = { resource, draft: null, draftRevision: 0, conflict: false, canRename: false };
  const forbidden = async () => { mutations.push('unexpected mutation'); throw new Error('Copy must not save, rename or discard'); };
  const port: NoteExperiencePort = { readNote: async () => structuredClone(doc), saveNoteDraft: forbidden, commitNote: forbidden, discardNoteDraft: forbidden };
  const session = new NoteSession(resource.id, port, resource); await until(() => session.snapshot().phase !== 'loading');
  const editor = dom.doc.createElement('textarea'); dom.root.append(editor);
  const view = mountNoteExperience(dom.root, editor, session, port, { kind, initialMode: kind === 'note' ? 'write' : 'read', copyText }); t.after(() => { for (const dispose of cleanup) dispose(); view.dispose(); restore(); });
  return { dom, editor, view, resource, session, port, mutations, cleanup, saveStatus: dom.root.querySelector('.aw-note-status'), copyStatus: dom.root.querySelector('.aw-note-copy-status') };
}

for (const kind of ['reference', 'research'] as const) test(`${kind} copy waits for the trusted callback and stays independent from save refresh`, async t => {
  const calls: string[] = []; let resolve!: () => void;
  const f = await fixture(t, kind, value => { calls.push(value); return new Promise<void>(done => { resolve = done; }); });
  const before = f.session.snapshot(); button(f.dom.root, 'Copy link').onclick();
  assert.deepEqual(calls, ['https://example.org/source?q=1&v=2']); assert.equal(f.copyStatus.textContent, 'Copying…'); assert.equal(f.saveStatus.textContent, 'Saved locally.');
  await f.session.refresh(); assert.equal(f.copyStatus.textContent, 'Copying…'); assert.equal(button(f.dom.root, 'Copy link').disabled, true);
  resolve(); await until(() => f.copyStatus.textContent === 'Source link copied.');
  assert.deepEqual(f.session.snapshot(), before); assert.deepEqual(f.mutations, []); assert.equal(button(f.dom.root, 'Copy link').disabled, false);
});

test('denied copying has a copy-specific failure, leaves editor/save state unchanged, and can retry', async t => {
  let reject = true; const f = await fixture(t, 'reference', async () => { if (reject) throw new Error('Write permission denied'); });
  f.editor.setSelectionRange(3, 8); f.editor.scrollTop = 73; const before = f.session.snapshot();
  button(f.dom.root, 'Copy link').onclick(); await until(() => f.copyStatus.textContent.startsWith('Could not copy source link.'));
  assert.equal(f.saveStatus.textContent, 'Saved locally.'); assert.equal(f.dom.root.dataset.noteState, 'ready'); assert.doesNotMatch(f.copyStatus.textContent, /save|document/i);
  assert.deepEqual(f.session.snapshot(), before); assert.deepEqual([f.editor.selectionStart, f.editor.selectionEnd, f.editor.scrollTop], [3, 8, 73]); assert.deepEqual(f.mutations, []);
  await f.session.refresh(); assert.match(f.copyStatus.textContent, /^Could not copy source link/);
  reject = false; button(f.dom.root, 'Copy link').onclick(); await until(() => f.copyStatus.textContent === 'Source link copied.');
});

test('missing native capability is unavailable and never reads or falls back to navigator.clipboard', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator'); let accesses = 0;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { get clipboard() { accesses++; throw new Error('Browser clipboard must not be accessed'); } } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor); else delete (globalThis as any).navigator; });
  const f = await fixture(t, 'reference'); assert.equal(button(f.dom.root, 'Copy link').disabled, true); assert.equal(button(f.dom.root, 'Copy text').disabled, true);
  assert.match(f.dom.root.textContent, /Native copying is unavailable/);
  button(f.dom.root, 'Copy link').onclick(); assert.match(f.copyStatus.textContent, /Native copying is unavailable/); assert.equal(accesses, 0); assert.deepEqual(f.mutations, []);
});

test('Notes copy exact current editor text, selected text and canonical resource information without intercepting Ctrl+C or changing draft state', async t => {
  const calls: string[] = [], f = await fixture(t, 'note', async value => { calls.push(value); });
  const raw = 'Unsaved α\r\nconst π = "✓";\n'; f.editor.value = raw; f.editor.setSelectionRange(8, 16); f.editor.scrollTop = 61;
  const before = f.session.snapshot(); button(f.dom.root, 'Copy text').onclick(); await until(() => f.copyStatus.textContent === 'Text copied.'); assert.equal(calls[0], raw);
  button(f.dom.root, 'Copy selection').onclick({ detail: 0 }); await until(() => f.copyStatus.textContent === 'Selected text copied.'); assert.equal(calls[1], raw.slice(8, 16));
  button(f.dom.root, 'Copy resource information').onclick(); await until(() => f.copyStatus.textContent === 'Resource information copied.');
  assert.equal(calls[2], 'Title: Synthetic note\nType: note\nResource ID: canonical:note\nVersion: 3\nProject ID: project:actual');
  assert.deepEqual(f.session.snapshot(), before); assert.equal(f.editor.value, raw); assert.deepEqual([f.editor.selectionStart, f.editor.selectionEnd, f.editor.scrollTop], [8, 16, 61]); assert.deepEqual(f.mutations, []);
  assert.equal(f.editor.fire('keydown', { key: 'c', ctrlKey: true }).defaultPrevented, false);
});

test('code copy retains CRLF, unterminated last lines and the full fenced source beyond a reading preview; read selection is captured before focus changes', async t => {
  for (const [source, expected] of [
    ['```ts\r\nconst π = "✓";\r\n```\r\n', 'const π = "✓";\r\n'],
    ['```js\nx=1;', 'x=1;'],
    ['```\n' + 'actual line\n'.repeat(1510) + '```', 'actual line\n'.repeat(1510)],
  ]) await t.test(expected.length > 1000 ? 'full code beyond preview' : JSON.stringify(expected), async t => {
    const calls: string[] = [], f = await fixture(t, 'reference', async value => { calls.push(value); }, source);
    button(f.dom.root, 'Copy code').onclick(); await until(() => f.copyStatus.textContent === 'Code copied.'); assert.equal(calls[0], expected);
    const anchor = f.dom.root.querySelector('code'); f.dom.select({ rangeCount: 1, isCollapsed: false, anchorNode: anchor, focusNode: anchor, toString: () => 'Actual selected code' });
    const copy = button(f.dom.root, 'Copy selection'); copy.onpointerdown(); f.dom.select(null); copy.onclick({ detail: 1 });
    await until(() => f.copyStatus.textContent === 'Selected text copied.'); assert.equal(calls[1], 'Actual selected code');
  });
});

test('suspension/disposal suppresses late feedback and new copy requests; direct resource views forward the same native callback', async t => {
  const calls: string[] = []; let resolve!: () => void;
  const f = await fixture(t, 'reference', value => { calls.push(value); return new Promise<void>(done => { resolve = done; }); });
  const original = button(f.dom.root, 'Copy link'); original.onclick(); f.view.setActive(false); resolve();
  await new Promise(done => setImmediate(done)); assert.equal(f.copyStatus.textContent, ''); original.onclick(); assert.equal(calls.length, 1);
  f.view.setActive(true); f.view.dispose(); original.onclick(); assert.equal(calls.length, 1);
  const directRoot = f.dom.doc.createElement('section'); f.dom.root.append(directRoot);
  const forbidden = () => { throw new Error('Copy must not create or mutate resources'); };
  const direct = mountDirectResourceExperience(directRoot, { ...f.resource, provider: 'local', messages: [] }, {
    notes: f.port, noteSession: () => f.session, copyText: async value => { calls.push(value); }, saveContent: forbidden,
    setTaskStatus: forbidden, setTaskPriority: forbidden, manageMembers: forbidden, openResource: forbidden,
  }); f.cleanup.push(() => direct.dispose());
  button(directRoot, 'Copy link').onclick(); await until(() => directRoot.querySelector('.aw-note-copy-status').textContent === 'Source link copied.');
  assert.equal(calls.at(-1), 'https://example.org/source?q=1&v=2'); assert.deepEqual(f.mutations, []);
});
