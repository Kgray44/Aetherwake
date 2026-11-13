import test from 'node:test';
import assert from 'node:assert/strict';
import { blockDocument } from '../../../block-library/tests/component-dom.mts';
import { until } from '../../../conversation-product/test/component-dom.mts';
import { mountVelaApiConnection } from '../src/vela-api-connection-view.ts';
const status = overrides => ({ contract: 'aerynth.vela-api-connection@1', providerId: 'openai-api-vela', billingRoute: 'openai-api',
  configurationId: 'vela-primary', version: null, configured: false, state: 'disconnected', storageAvailable: true,
  catalog: { state: 'not-checked' }, inferenceVerified: false, entitlement: 'unverified', ...overrides });

test('API connection view is passive until a click, opens native setup without a key field, discovers only explicitly', async () => {
  const dom = blockDocument(), restore = dom.install(), calls = []; let saved = false, discovered = false, enabled = false;
  const view = mountVelaApiConnection(dom.root, async input => {
    if (input.type === 'authorizeUsage') enabled = input.enabled;
    if (input.type === 'usageStatus' || input.type === 'authorizeUsage') { calls.push(input); return {enabled,configurationVersion:saved?1:null,maxOutputTokens:2048,requestsPerDay:64,usedToday:0}; }
    calls.push(input); if (input.type === 'setup') saved = true;
    if (input.type === 'catalog') { discovered = true; return { providerId: 'openai-api-vela', configurationId: 'vela-primary', version: 1,
      observedAt: 1000, expiresAt: 61000, catalogOnly: true, inferenceVerified: false, capabilities: 'unverified', models: [{ id: 'synthetic-model', label: 'synthetic-model' }] }; }
    return status(saved ? { configured: true, state: 'configured', version: 1, ...(discovered ? { catalog: { state: 'ready', observedAt: 1000, expiresAt: 61000, modelCount: 1 } } : {}) } : {});
  });
  const button = action => dom.root.querySelector(`[data-vela-api-action="${action}"]`);
  try {
    await view.ready; assert.deepEqual(calls, [{ type: 'status' },{type:'usageStatus'}]); assert.equal(dom.root.querySelectorAll('input').length, 0);
    assert.equal(button('catalog').disabled, true); button('setup').onclick(); await until(() => !button('catalog').disabled);
    assert.deepEqual(calls.map(c => c.type), ['status','usageStatus','setup','status','usageStatus']); assert.ok(dom.root.textContent.includes('billed separately'));
    button('usage').onclick(); await until(() => button('usage').textContent === 'Disable Vela API usage');
    assert.deepEqual(calls.at(-1),{type:'authorizeUsage',expectedVersion:1,enabled:true});
    assert.ok(dom.root.textContent.includes('API charges apply'));
    assert.ok(dom.root.textContent.includes('without asking again'));
    assert.ok(dom.root.textContent.includes('new sources or permissions still require review'));
    button('catalog').onclick(); await until(() => dom.root.textContent.includes('1 model listed'));
    assert.deepEqual(calls.slice(-3), [{ type: 'catalog', expectedVersion: 1 }, { type: 'status' }, {type:'usageStatus'}]);
    assert.ok(dom.root.textContent.includes('Access varies by model')); assert.equal(JSON.stringify(calls).includes('apiKey'), false);
    button('usage').onclick(); await until(() => button('usage').textContent === 'Enable Vela API usage');
    assert.deepEqual(calls.at(-1), {type:'authorizeUsage',expectedVersion:1,enabled:false});
  } finally { view.dispose(); restore(); }
});

test('API view keeps native errors private and disables setup when protected storage is unavailable', async () => {
  const dom = blockDocument(), restore = dom.install(); let unavailable = false;
  const view = mountVelaApiConnection(dom.root, async input => {
    if (input.type === 'usageStatus') return {enabled:false,configurationVersion:null,maxOutputTokens:2048,requestsPerDay:64,usedToday:0};
    if (input.type !== 'status') throw Error('SYNTHETIC_PRIVATE_MARKER');
    return status(unavailable ? { state: 'unavailable', storageAvailable: false } : {});
  });
  try {
    await view.ready; dom.root.querySelector('[data-vela-api-action="setup"]').onclick();
    await until(() => dom.root.textContent.includes('could not be updated'));
    assert.equal(dom.root.textContent.includes('SYNTHETIC_PRIVATE_MARKER'), false);
    unavailable = true; await view.refresh();
    assert.equal(dom.root.querySelector('[data-vela-api-action="setup"]').disabled, true);
    assert.ok(dom.root.textContent.includes('storage is unavailable')); assert.equal(dom.root.textContent.includes('SYNTHETIC_PRIVATE_MARKER'), false);
  } finally { view.dispose(); restore(); }
});
