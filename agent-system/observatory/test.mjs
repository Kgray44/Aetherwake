import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {demoRecords} from './src/demo-data.js';

process.env.OBSERVATORY_NO_LISTEN='1';
const {validateNewTask,handler}=await import('./server.mjs');
test('task intake validates bounded contract fields',()=>{
  const base={title:'GPU presence transition',objective:'Implement and verify visual Vela state transitions',primary:'visual',profile_id:'visual-gpu',criteria:['Visual acceptance']};
  const result=validateNewTask(base);
  assert.equal(result.primary,'visual');
  assert.equal(result.accept.length,1);
  assert.throws(()=>validateNewTask({...base,primary:'mission-11'}),/classification/);
  assert.throws(()=>validateNewTask({...base,criteria:[]}),/criterion/);
  assert.throws(()=>validateNewTask({...base,objective:''}),/12 to 100,000/);
});
test('simulation is bounded, labeled and separate from actual data',()=>{
  const result=demoRecords();
  assert.equal(result.filter(r=>r.record_type==='task').length,7);
  assert.ok(result.length<30);
  assert.ok(result.filter(r=>r.record_type==='evidence').every(x=>x.synthetic===true));
  assert.ok(result.filter(r=>r.record_type==='telemetry').every(x=>x.measurements.some(m=>m.availability==='unavailable')));
});
test('local APIs reject hostile origins and incorrect content type',async()=>{
  const srv=http.createServer((req,res)=>handler(req,res));
  await new Promise(resolve=>srv.listen(0,'127.0.0.1',resolve));
  try{
    const origin='http://127.0.0.1:'+srv.address().port;
    const overview=await fetch(origin+'/api/overview');
    assert.equal(overview.status,200);
    const data=await overview.json();
    assert.ok(Array.isArray(data.records));
    const denied=await fetch(origin+'/api/tasks',{method:'POST',headers:{'content-type':'application/json',origin:'https://hostile.example'},body:'{}'});
    assert.equal(denied.status,403);
    const type=await fetch(origin+'/api/tasks',{method:'POST',headers:{'content-type':'text/plain'},body:'{}'});
    assert.equal(type.status,415);
  }finally{srv.close()}
});
