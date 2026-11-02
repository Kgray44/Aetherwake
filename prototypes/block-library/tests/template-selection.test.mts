import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { mountWorkspaceTemplates } from '../view.ts';
import { predefinedTemplates } from '../model.ts';
import type { TemplateSummary, WorkspaceTemplate, WorkspaceTemplatePort } from '../contracts.ts';
import { blockDocument } from './component-dom.mts';
import { until } from '../../conversation-product/test/component-dom.mts';
const { expressions, compileExpression } = createRequire(import.meta.url)('./library-native-expressions.cjs');

test('actual template list and generated native selector retain template identity when async search moves its row before click', async t => {
  // CPU component/selector boundary only; no native input, browser layout or provider.
  const ui = blockDocument(); t.after(ui.install());
  const template: WorkspaceTemplate = { ...predefinedTemplates()[1], id: 'template:synthetic-target', name: 'Synthetic saved template', version: 1, state: 'active', source: 'saved', createdAt: '2026-11-02T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z' };
  const summary: TemplateSummary = { id: template.id, name: template.name, description: template.description, tags: template.tags, version: 1, state: 'active', source: 'saved', mode: template.body.organization.mode, placementCount: template.body.placements.length, resourceCount: template.body.resources.length, createdAt: template.createdAt, updatedAt: template.updatedAt };
  const initial = [...Array.from({ length: 4 }, (_, i) => ({ ...summary, id: 'template:other-' + i, name: 'Other template ' + i })), summary];
  let resolveSearch!: (value: TemplateSummary[]) => void;
  const selected: string[] = [];
  const noWrite = async () => { throw Error('No writes allowed in preview selection'); };
  const port: WorkspaceTemplatePort = {
    async capabilities() { return { revision: 1, kinds: {}, providers: {}, velaPlanning: { state: 'unsupported' } }; },
    async listTemplates(input) { return input?.query ? new Promise(resolve => { resolveSearch = resolve; }) : initial; },
    async getTemplate(id) { selected.push(id); assert.equal(id, template.id); return template; },
    saveTemplate: noWrite, renameTemplate: noWrite, archiveTemplate: noWrite, previewTemplate: noWrite, applyTemplate: noWrite, requestVelaTemplate: noWrite,
  };
  const controller = mountWorkspaceTemplates(ui.root, port, { projectId: null, onClose() {}, onApplied: noWrite });
  t.after(() => controller.dispose());
  await until(() => ui.root.querySelector('.aw-library__list').children.length === 5);
  const list = ui.root.querySelector('.aw-library__list');
  for (const button of list.children) button.getBoundingClientRect = () => ({ width: 100, height: 40 });
  const oldButton = list.children[4], search = ui.root.querySelector('input');
  search.value = 'Synthetic saved'; search.oninput();
  await until(() => !!resolveSearch);
  const source = expressions.buttonPath('.aw-library__list', 'Synthetic saved template ·', true);
  compileExpression(source);
  const selector = runInNewContext(source, { document: { querySelector: (value: string) => ui.root.querySelector(value) }, getComputedStyle: () => ({ visibility: 'visible' }) });
  assert.equal(selector, '.aw-library__list button[data-template-id="template:synthetic-target"]');
  assert.doesNotMatch(selector, /nth-child/);
  resolveSearch([summary]); await until(() => list.children.length === 1);
  const current = ui.root.querySelector(selector);
  assert.equal(current, list.children[0]); assert.notEqual(current, oldButton, 'The asynchronous component really replaced the original fifth row');
  current.onclick(); await until(() => selected.length === 1 && ui.root.querySelectorAll('.aw-library__layout-block').length === template.body.placements.length);
  assert.deepEqual(selected, [template.id]);
  assert.equal(ui.root.querySelectorAll('.aw-library__layout-block').length, template.body.placements.length);
  search.value = 'Removed target'; search.oninput();
  resolveSearch([{ ...summary, id: 'template:foreign-same-name' }]);
  await until(() => list.children[0]?.dataset.templateId === 'template:foreign-same-name');
  assert.equal(ui.root.querySelector(selector), null, 'A removed template cannot silently retarget a replacement row with the same label');
  assert.deepEqual(selected, [template.id]);

});
