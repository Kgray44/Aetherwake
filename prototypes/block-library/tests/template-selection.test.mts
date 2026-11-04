import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { mountWorkspaceTemplates } from '../view.ts';
import { predefinedTemplates } from '../model.ts';
import type { LibraryCapabilities, TemplateSummary, VelaTemplateRequest, WorkspaceTemplate, WorkspaceTemplatePort } from '../contracts.ts';
import { WORKSPACE_ARCHITECT_PROVIDER } from '../contracts.ts';
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

test('Vela workspace review shows provenance and updates the proposed layout before saving selected bindings', async t => {
  const ui = blockDocument(); t.after(ui.install());
  const draft = predefinedTemplates()[1];
  const noWrite = async () => { throw Error('Unexpected template mutation'); };
  const saved: string[][] = [];
  const port: WorkspaceTemplatePort = {
    async capabilities() { return { revision: 1, kinds: {}, providers: {}, velaPlanning: { state: 'available' } }; },
    async listTemplates() { return []; },
    async requestVelaTemplate(input) {
      assert.equal(input.prompt, 'Plan a development workspace');
      return { ...draft, provenance: { requestId: input.requestId, providerId: WORKSPACE_ARCHITECT_PROVIDER } };
    },
    async saveTemplate(input) {
      saved.push(input.body.resources.map(role => role.key));
      return { ...input, id: 'template:reviewed', source: 'vela', version: 1, state: 'active', createdAt: '', updatedAt: '' };
    },
    getTemplate: noWrite, renameTemplate: noWrite, archiveTemplate: noWrite, previewTemplate: noWrite, applyTemplate: noWrite,
  };
  const controller = mountWorkspaceTemplates(ui.root, port, { projectId: null, onClose() {}, onApplied: noWrite });
  t.after(() => controller.dispose());
  await controller.refresh();
  ui.root.querySelectorAll('button').find(button => button.textContent === 'Ask Vela').onclick();
  ui.root.querySelector('textarea').value = 'Plan a development workspace';
  ui.root.querySelector('form').onsubmit({ preventDefault() {} });
  await until(() => ui.root.querySelectorAll('.aw-library__layout-block').length === draft.body.placements.length);
  assert.ok(ui.root.querySelectorAll('.aw-library__hint').some(node => node.textContent.includes('Local workspace planner')));
  const exclude = ui.root.querySelectorAll('.aw-library__bindings input')[0];
  const omitted = draft.body.resources[0].key;
  exclude.checked = false;
  exclude.onchange();
  assert.equal(ui.root.querySelectorAll('.aw-library__layout-block').length, draft.body.placements.filter(role => role.resourceKey !== omitted).length);
  assert.deepEqual(saved, []);
  ui.root.querySelectorAll('button').find(button => button.textContent === 'Save proposal as template').onclick();
  await until(() => saved.length === 1);
  assert.deepEqual(saved, [draft.body.resources.slice(1).map(role => role.key)]);
});

test('direct Workspace Architect entry retains the chosen project and editable purpose through capability loading', async t => {
  const ui = blockDocument(); t.after(ui.install());
  const draft = predefinedTemplates()[1], requests: VelaTemplateRequest[] = [];
  const noWrite = async () => { throw Error('Proposal review must not create or save a workspace'); };
  let resolveCapabilities!: (value: LibraryCapabilities) => void;
  const port: WorkspaceTemplatePort = {
    capabilities: () => new Promise(resolve => { resolveCapabilities = resolve; }),
    async listTemplates() { return []; },
    async requestVelaTemplate(input) {
      requests.push(input);
      return { ...draft, provenance: { requestId: input.requestId, providerId: WORKSPACE_ARCHITECT_PROVIDER } };
    },
    getTemplate: noWrite, saveTemplate: noWrite, renameTemplate: noWrite, archiveTemplate: noWrite, previewTemplate: noWrite, applyTemplate: noWrite,
  };
  const controller = mountWorkspaceTemplates(ui.root, port, {
    projectId: 'project:signals', initialVela: { projectTitle: 'Signals', purpose: 'Signal analysis workspace' },
    onClose() {}, onApplied: noWrite,
  });
  t.after(() => controller.dispose());
  const purpose = ui.root.querySelector('[data-workspace-purpose]');
  const submit = ui.root.querySelectorAll('button').find(button => button.textContent === 'Request proposal');
  const form = ui.root.querySelector('form');
  assert.equal(purpose.value, 'Signal analysis workspace');
  assert(ui.root.querySelectorAll('.aw-library__hint').some(node => node.textContent.includes('Project · Signals')));
  assert.equal(submit.disabled, true);
  form.onsubmit({ preventDefault() {} });
  assert.deepEqual(requests, []);
  purpose.value = 'Compare retained signal measurements';
  resolveCapabilities({ revision: 1, kinds: {}, providers: {}, velaPlanning: { state: 'available' } });
  await until(() => !submit.disabled);
  assert.equal(purpose.value, 'Compare retained signal measurements');
  assert.deepEqual(requests, []);
  form.onsubmit({ preventDefault() {} });
  await until(() => ui.root.querySelectorAll('.aw-library__layout-block').length === draft.body.placements.length);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].projectId, 'project:signals');
  assert.equal(requests[0].prompt, 'Compare retained signal measurements');
});
