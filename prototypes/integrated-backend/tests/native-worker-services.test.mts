import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const execute=promisify(execFile);
// The fixture can start two cold source workers on hosted Windows. This watchdog
// bounds the whole probe, while the probe verifies each native shutdown invariant.
const probeTimeoutMs = process.platform === 'win32' ? 30_000 : 20_000;
for(const scenario of ['roundtrip','absent','shutdown','shutdown-computer','effect-denied'])test('actual Backend worker native ports: '+scenario,async()=>{
 const {stdout}=await execute(process.execPath,['--import',new URL('./fixtures/native-worker-fetch.mjs',import.meta.url).href,fileURLToPath(new URL('./fixtures/native-worker-probe.mts',import.meta.url))],{env:{...process.env,AERYNTH_WORKER_HOP_SCENARIO:scenario},windowsHide:true,timeout:probeTimeoutMs,maxBuffer:65536});
 const result=JSON.parse(stdout.trim());assert.equal(result.passed,true);assert.equal(result.actualBackend,true);assert.equal(result.actualWorker,true);assert.equal(result.mutations,0);assert.equal(result.realHttpCalls,0);
});
