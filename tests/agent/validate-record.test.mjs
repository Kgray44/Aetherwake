import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateRecord} from '../../scripts/agent/validate-record.mjs';
// Synthetic, non-private contract fixture. Actual runObserved output is also
// validated during the private cross-component demonstration, never committed.
function telemetry(value) {
  return {schema_version:1,record_type:'telemetry',id:'telemetry_fixture',created_at:'2026-11-16T00:00:00Z',repository:'example/fixture',revision:'a'.repeat(40),task_id:'task_fixture',attempt_id:'attempt_fixture',phase:'verification',observed_at:'2026-11-16T00:00:00Z',measurements:[{name:'elapsed_wall_ms',availability:value===null?'unavailable':'observed',value,unit:'ms',source:'synthetic-test',method:'fixture'}]};
}
test('foundation union type accepts measured numeric telemetry',()=>{for(const value of [0,42,0.125])assert.deepEqual(validateRecord(telemetry(value)),[])});
test('foundation union type accepts explicit unavailable null telemetry',()=>assert.deepEqual(validateRecord(telemetry(null)),[]));
test('numeric/null union rejects other primitive and structured values',()=>{for(const value of ['42',false,[],{}])assert.notDeepEqual(validateRecord(telemetry(value)),[])});
test('numeric/null union rejects non-finite numbers rather than serializing them to null',()=>{for(const value of [NaN,Infinity,-Infinity])assert.notDeepEqual(validateRecord(telemetry(value)),[])});
