import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { validateProjection, storeProjection } from './sync.mjs';
const base = {export_version:1,authority:'local-task-records',repository:'Kgray44/Aetherwake',generated_at:'2026-11-16T06:00:00.000Z',records:[],events:[],coverage:{}};
const valid=()=>true;
test('rejects unsupported authority, raw fields, malformed times, invalid evidence and acceptance claims',()=>{
 for(const patch of [{authority:'site'},{raw_prompt:'secret'},{generated_at:'today'},{records:[{}]},{events:[{}]},{records:[{repository:base.repository,owner_acceptance:'accepted'}]}]) assert.throws(()=>validateProjection({...base,...patch},valid));
 assert.equal(validateProjection(base,valid).coverage.owner_acceptance,'not_authenticated_by_export');
});
test('private projection has idempotent retries, conflict/replay rejection and owner/namespace isolation',async()=>{
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('./drizzle/0002_private_projection.sql',import.meta.url),'utf8'));
 const db={prepare:q=>({bind:(...args)=>({run:async()=>({meta:sql.prepare(q).run(...args)})})})};
 assert.equal(await storeProjection(db,'a','live',base),true);
 assert.equal(await storeProjection(db,'a','live',base),true);
 assert.equal(await storeProjection(db,'a','live',{...base,coverage:{other:1}}),false);
 assert.equal(await storeProjection(db,'a','live',{...base,generated_at:'2026-11-15T06:00:00.000Z'}),false);
 assert.equal(await storeProjection(db,'b','live',base),true);
 assert.equal(await storeProjection(db,'a','verification:test',base),true);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM private_projection').get().n,3);sql.close();
});
test('future timestamp cannot pin projection and clock skew is bounded',()=>{
 const now=Date.parse('2026-11-16T06:00:00.000Z');
 assert.throws(()=>validateProjection({...base,generated_at:new Date(now+300001).toISOString()},valid,valid,now),/trusted clock/);
 assert.doesNotThrow(()=>validateProjection({...base,generated_at:new Date(now+300000).toISOString()},valid,valid,now));
});
test('verification namespace quota is atomic, owner scoped and allows retry/live updates',async()=>{
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('./drizzle/0002_private_projection.sql',import.meta.url),'utf8'));
 const db={prepare:q=>({bind:(...args)=>({run:async()=>({meta:sql.prepare(q).run(...args)})})})};
 for(let i=0;i<8;i++)assert.equal(await storeProjection(db,'owner','verification:'+i,base),true);
 assert.equal(await storeProjection(db,'owner','verification:excess',base),false);
 assert.equal(await storeProjection(db,'owner','verification:0',base),true);
 assert.equal(await storeProjection(db,'owner','verification:0',{...base,generated_at:'2026-11-16T06:01:00.000Z'}),true);
 assert.equal(await storeProjection(db,'owner','live',base),true);
 assert.equal(await storeProjection(db,'other','verification:excess',base),true);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM private_projection WHERE owner_id=?').get('owner').n,9);sql.close();
});
