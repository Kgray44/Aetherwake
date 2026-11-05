const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const { createVelaApiConnectionBroker, safeApiStatus, safeApiCatalog } = require('../native/vela-api-connections.cjs');
const status = () => ({ contract: 'aerynth.vela-api-connection@1', providerId: 'openai-api-vela', billingRoute: 'openai-api',
  configurationId: 'vela-primary', version: 1, configured: true, state: 'configured', storageAvailable: true,
  catalog: { state: 'not-checked' }, inferenceVerified: false, entitlement: 'unverified' });
const catalog = () => ({ providerId: 'openai-api-vela', configurationId: 'vela-primary', version: 1,
  observedAt: 1000, expiresAt: 61000, catalogOnly: true, inferenceVerified: false, capabilities: 'unverified',
  models: [{ id: 'synthetic-model', label: 'synthetic-model' }] });

test('API native broker reads passive status and requires native authorization for setup/catalog/disconnect', async () => {
  const calls = []; let authorized = false, setups = 0;
  const broker = createVelaApiConnectionBroker({ call: async (name, input) => { calls.push({ name, input }); return input.type === 'catalog' ? catalog() : status(); },
    setup: async () => { setups++; }, authorize: async () => authorized });
  assert.deepEqual(await broker.command({ type: 'status' }), status()); assert.equal(calls.length, 1); assert.equal(setups, 0);
  for (const input of [{ type: 'setup' }, { type: 'catalog', expectedVersion: 1 }, { type: 'disconnect', expectedVersion: 1 }])
    await assert.rejects(broker.command(input), /api_user_gesture_required/);
  assert.equal(calls.length, 1); authorized = true;
  assert.deepEqual(await broker.command({ type: 'setup' }), status()); assert.equal(setups, 1);
  assert.deepEqual(await broker.command({ type: 'catalog', expectedVersion: 1 }), catalog());
  await broker.command({ type: 'disconnect', expectedVersion: 1 });
  assert.deepEqual(calls.map(call => call.input.type), ['status', 'status', 'catalog', 'disconnect']);
  assert.ok(calls.every(call => call.name === 'velaApiConnection')); broker.close();
  await assert.rejects(broker.command({ type: 'status' }), /api_connections_closed/);
});

test('API native DTO and redacted projection reject injected configuration, raw credentials and catalog capability claims', async () => {
  const broker = createVelaApiConnectionBroker({ call: async () => { throw Error('unexpected'); }, setup: async () => {}, authorize: async () => true });
  for (const input of [{ type: 'configure', apiKey: 'SYNTHETIC_PRIVATE_MARKER' }, { type: 'status', providerId: 'other' },
    { type: 'catalog', expectedVersion: 0 }, { type: 'disconnect', expectedVersion: 1, configurationId: 'other' }])
    await assert.rejects(broker.command(input), /api_configuration_invalid/);
  assert.throws(() => safeApiStatus({ ...status(), apiKey: 'SYNTHETIC_PRIVATE_MARKER' }), /api_status_invalid/);
  assert.throws(() => safeApiStatus({ ...status(), boundaryDigest: 'a'.repeat(64) }), /api_status_invalid/);
  assert.throws(() => safeApiStatus({ ...status(), errorCode: 'SYNTHETIC_PRIVATE_MARKER' }), /api_status_invalid/);
  assert.throws(() => safeApiCatalog({ ...catalog(), capabilities: 'verified' }, 1), /api_catalog_invalid/);
  assert.throws(() => safeApiCatalog(catalog(), 2), /api_catalog_invalid/);
  assert.throws(() => safeApiCatalog({ ...catalog(), models: [{ id: 'synthetic-model', label: 'SYNTHETIC_PRIVATE_MARKER' }] }, 1), /api_catalog_invalid/);
  broker.close();
});

test('ordinary preload excludes native API configure and observes actual activation for API operations', async () => {
  let exposed, active = false; const calls = [];
  vm.runInNewContext(readFileSync(join(__dirname, '../native/desktop-preload.cjs'), 'utf8'), {
    require: name => { assert.equal(name, 'electron'); return {
      contextBridge: { exposeInMainWorld: (_name, value) => { exposed = value; } },
      ipcRenderer: { invoke: async (...args) => { calls.push(args); return { ok: true, result: status() }; }, on() {}, removeListener() {} },
    }; }, process: { argv: [] }, navigator: { userActivation: { get isActive() { return active; } } },
  });
  await assert.rejects(exposed.command('velaApiConfigure', { credential: {} }), /unsupported_command/);
  await exposed.command('velaApiConnection', { type: 'status' });
  await assert.rejects(exposed.command('velaApiConnection', { type: 'setup' }), /api_user_gesture_required/);
  await assert.rejects(exposed.command('velaApiConnection', { type: 'catalog', expectedVersion: 1 }), /api_user_gesture_required/);
  assert.equal(calls.length, 1); active = true;
  await exposed.command('velaApiConnection', { type: 'setup' }); assert.equal(calls.length, 2);
  assert.equal(JSON.stringify(calls).includes('apiKey'), false);
});

test('durable API usage is a distinct exact-version native gesture operation, never implied by setup or status', async () => {
  let enabled=false, allowed=false; const calls=[];
  const usage=()=>({enabled,configurationVersion:1,maxOutputTokens:2048,requestsPerDay:64,usedToday:0});
  const broker=createVelaApiConnectionBroker({call:async(name,input)=>{calls.push({name,input}); if(name==='velaApiUsageAuthorize')enabled=input.enabled; return usage();},setup:async()=>{},authorize:async()=>allowed});
  assert.equal((await broker.command({type:'usageStatus'})).enabled,false); assert.deepEqual(calls,[{name:'velaApiUsageStatus',input:{}}]);
  await assert.rejects(broker.command({type:'authorizeUsage',expectedVersion:1,enabled:true}),/api_user_gesture_required/); assert.equal(calls.length,1);
  allowed=true; assert.equal((await broker.command({type:'authorizeUsage',expectedVersion:1,enabled:true})).enabled,true);
  assert.deepEqual(calls.at(-1),{name:'velaApiUsageAuthorize',input:{expectedVersion:1,enabled:true}});
  assert.equal((await broker.command({type:'authorizeUsage',expectedVersion:1,enabled:false})).enabled,false);
  await assert.rejects(broker.command({type:'authorizeUsage',expectedVersion:1,enabled:true,apiKey:'SYNTHETIC_PRIVATE_MARKER'}),/api_configuration_invalid/);
  broker.close();
});
