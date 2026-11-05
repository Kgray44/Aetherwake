import test from 'node:test';
import assert from 'node:assert/strict';
import { componentDocument } from '../../../conversation-product/test/component-dom.mts';
import { mountContextualResources, contextualResourcePage } from '../src/workspace-context-views.ts';

// CPU component/port evidence only; this adapter supplies no native layout or OS picker.
test('Resources presents Files and Folders as separate groups and one canonical folder row', async () => {
  const { root } = componentDocument(), calls = [];
  const snapshot = { workspaceId: 'workspace', resources: [
    { id: 'folder-canonical', title: 'Optics', kind: 'folder', canAttach: false, path: 'PRIVATE_LOCATOR', sourceGrantId: 'PRIVATE_GRANT', children: ['not-a-resource'] },
    { id: 'file-canonical', title: 'Alignment.txt', kind: 'file', canAttach: true },
  ] };
  const view = mountContextualResources(root, { snapshot: () => snapshot, open: id => calls.push(['open', id]), attach: id => calls.push(['attach', id]),
    actions: [{ id: 'choose-source-folder', label: 'Choose a folder…', run: () => calls.push(['picker', 'folder']) }] });
  const group = name => root.querySelectorAll('.aw-context-resource-group').find(node => node.querySelector('.aw-context-group-heading').children[0].textContent === name);
  assert.equal(group('Files').hidden, false); assert.equal(group('Folders').hidden, false);
  assert.equal(group('Files').querySelectorAll('.aw-context-resource').length, 1); assert.equal(group('Folders').querySelectorAll('.aw-context-resource').length, 1);
  assert.equal(group('Folders').querySelector('[data-open-resource]').dataset.openResource, 'folder-canonical');
  assert.doesNotMatch(root.textContent, /PRIVATE_LOCATOR|PRIVATE_GRANT|not-a-resource/); assert.deepEqual(calls, []);
  // The application mounts the returned addMenu in the Resources header.
  const choose = view.addMenu.querySelector('[data-resource-action="choose-source-folder"]'); choose.onclick(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [['picker', 'folder']]); view.dispose();
});

test('large Files and Folders libraries keep 24 mounted rows and reuse rows on unchanged updates', () => {
  const { root, doc } = componentDocument(); let allocations = 0, calls = 0;
  const create = doc.createElement; doc.createElement = tag => { allocations++; return create(tag); };
  const snapshot = { workspaceId: 'workspace', resources: Array.from({ length: 20000 }, (_, i) => ({ id: `canonical-${i}`, title: `Source ${i}`, kind: i % 2 ? 'folder' : 'file' })) };
  const view = mountContextualResources(root, { snapshot: () => snapshot, open: () => calls++, attach: () => calls++ });
  assert.equal(root.querySelectorAll('.aw-context-resource').length, 24);
  const before = allocations; view.update(); assert.equal(allocations, before); assert.equal(calls, 0);
  const folders = contextualResourcePage(snapshot, 'Folders', 0); assert.equal(folders.total, 10000); assert.equal(folders.items.length, 24); assert.ok(folders.items.every(item => item.kind === 'folder'));
  const query = root.querySelector('input'); query.value = 'Folders'; query.fire('input');
  assert.equal(root.querySelectorAll('.aw-context-resource').length, 24); assert.ok(root.querySelectorAll('.aw-context-resource-kind').every(node => node.textContent === 'Folder'));
  view.setActive(false); const inactive = allocations; view.update(); assert.equal(allocations, inactive); view.dispose();
});

test('Workspace sources uses unique canonical folder IDs while All sources reveals unattached files', () => {
  const { root } = componentDocument(); let reads = 0;
  const snapshot = { workspaceId: 'workspace', workspaceResourceIds: ['folder', 'folder'], resources: [
    { id: 'folder', title: 'Optics folder', kind: 'folder' }, { id: 'unattached-file', title: 'Separate.txt', kind: 'file' },
  ] };
  const view = mountContextualResources(root, { snapshot: () => snapshot, open: () => reads++, attach: () => reads++ });
  const rows = () => root.querySelectorAll('.aw-context-resource'); const scope = name => root.querySelectorAll('button').find(node => node.textContent === name);
  assert.equal(rows().length, 1); assert.equal(rows()[0].querySelector('[data-open-resource]').dataset.openResource, 'folder');
  assert.equal(scope('Workspace sources').getAttribute('aria-pressed'), 'true');
  scope('All sources').onclick(); assert.equal(rows().length, 2);
  scope('Workspace sources').onclick(); assert.equal(rows().length, 1); assert.equal(reads, 0); view.dispose();
});
