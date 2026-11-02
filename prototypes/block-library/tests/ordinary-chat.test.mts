import test from 'node:test';
import assert from 'node:assert/strict';
import { mountBlockLibrary } from '../view.ts';
import { blockCapabilities } from '../registry.ts';
import { blockIdentity } from '../identity-model.ts';
import { blockDocument } from './component-dom.mts';
import { until } from '../../conversation-product/test/component-dom.mts';
import type { LibraryCapabilities, CreateBlockInput } from '../contracts.ts';

test('ordinary creation defaults only to an explicitly available automatic route and forwards explicit manual/Codex unchanged', async t => {
  for (const automatic of [undefined, { state: 'unknown' as const }, { state: 'available' as const }]) {
    await t.test(automatic?.state ?? 'missing', async t => {
      const dom = blockDocument(); t.after(dom.install());
      const capabilities: LibraryCapabilities = { revision: 1, kinds: { conversation: { state: 'available' } },
        providers: { local: { state: 'available' }, codex: { state: 'available' }, ...(automatic ? { automatic } : {}) }, velaPlanning: { state: 'unsupported' } };
      const calls: CreateBlockInput[] = [];
      const view = mountBlockLibrary(dom.root, { capabilities: async () => capabilities, createBlock: async input => {
        calls.push(input); return { resourceId: 'canonical:chat', placementId: 'placement:chat', workspaceId: 'workspace:chat', layoutVersion: 2 };
      } }, { workspaceId: 'workspace:chat', expectedLayoutVersion: 1, onCreated() {}, onClose() {} });
      t.after(() => view.dispose());
      await until(() => !!dom.root.querySelector('form'));
      const selector = () => dom.root.querySelectorAll('select').find((item: any) => item.children.some((option: any) => option.value === 'local')) as any;
      const submit = async () => {
        const form = dom.root.querySelector('form') as any; form.reportValidity = () => true;
        form.onsubmit({ preventDefault() {} }); await new Promise(resolve => setImmediate(resolve));
      };
      const initial = selector(); assert.equal(initial.value, automatic?.state === 'available' ? '' : '__choose');
      await submit();
      assert.equal(calls.length, automatic?.state === 'available' ? 1 : 0);
      if (calls.length) assert.equal(Object.hasOwn(calls[0], 'provider'), false);
      for (const provider of ['local', 'codex'] as const) {
        const select = selector(); select.value = provider; select.onchange(); const before: number = calls.length;
        await submit(); assert.equal(calls.length, before + 1); assert.equal(calls.at(-1)!.provider, provider);
      }
      const streaming = blockCapabilities('conversation', capabilities).find(item => item.id === 'streaming');
      if (streaming) assert.equal(streaming.availability.state, automatic?.state ?? 'unknown');
    });
  }
});

test('ordinary model-backed conversations retain an AI identity despite the legacy local transport marker', () => {
  const resource = { id: 'canonical:ordinary', kind: 'conversation' as const, title: 'Ordinary', version: 1, provider: 'local' as const,
    providerId: 'ordinary:granted', content: '', messages: [] };
  assert.equal(blockIdentity({ kind: 'conversation', resource }).label, 'AI conversation');
  assert.equal(blockIdentity({ kind: 'conversation', resource: { ...resource, providerId: 'local' } }).label, 'Local chat');
});
