import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {appendEvent,readJournal,traceEvent,summarize} from '../scripts/agent/journal.mjs';
import {sanitizeExport} from '../scripts/agent/telemetry-export.mjs';
const task={id:'task_1',repository:'example/repo',revision:'a'.repeat(40)};
test('journal deduplicates, refuses conflicting identity, ignores interrupted temp and enforces bounds',async t=>{
 const root=await mkdtemp(join(tmpdir(),'journal-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const dir=join(root,'private');const e=traceEvent({task,kind:'lifecycle',state:'started',eventId:'evt_1'});
 assert.equal(await appendEvent(dir,e),true);assert.equal(await appendEvent(dir,e),false);
 await assert.rejects(appendEvent(dir,{...e,state:'failed'}),/Conflicting/);
 await writeFile(join(dir,'.pending-crash'),'{');assert.equal((await readJournal(dir)).length,1);
 await assert.rejects(appendEvent(dir,{...e,event_id:'evt_2'},{maxEvents:1}),/retention/);
});
test('trace preserves unfinished spans; exporter drops private payload',()=>{
 const start=traceEvent({task,kind:'span_start',phase:'context',spanId:'span_1'});
 assert.equal(summarize([start]).incomplete_spans,1);
 const result=sanitizeExport({repository:task.repository,events:[{...start,prompt:'SECRET',command:'/private/path'}]});
 assert.equal(JSON.stringify(result).includes('SECRET'),false);assert.equal(JSON.stringify(result).includes('/private/path'),false);
 assert.equal(result.coverage.owner_acceptance,'not_authenticated_by_export');
});

test('provider adapter uses explicit token observations without content or cost inference',async()=>{
 const {codexUsage}=await import('../scripts/agent/provider-events.mjs');
 const m=codexUsage({type:'turn.completed',usage:{input_tokens:12,output_tokens:4},text:'SECRET'});
 assert.equal(m.find(x=>x.name==='provider_input_tokens').value,12);
 assert.equal(m.find(x=>x.name==='provider_cached_input_tokens').availability,'unavailable');
 assert.equal(m.find(x=>x.name==='provider_cost_usd').availability,'unavailable');
 assert.equal(JSON.stringify(m).includes('SECRET'),false);
});

test('lifecycle survives reopen, rejects impossible state and separates owner acceptance',async t=>{
 const {observeLifecycle,observeOperation,lifecycleSummary}=await import('../scripts/agent/lifecycle.mjs');
 const root=await mkdtemp(join(tmpdir(),'lifecycle-'));t.after(()=>rm(root,{recursive:true,force:true}));const directory=join(root,'private');
 for(const state of ['created','ready','started','failed','restarted','started','verifying','completed','integrated'])await observeLifecycle({directory,task,state,attemptId:'attempt_1'});
 await assert.rejects(observeLifecycle({directory,task,state:'accepted',attemptId:'attempt_1'}),/independent/);
 await observeOperation({directory,task,attemptId:'attempt_1',phase:'verification',run:async()=>42});
 const events=await readJournal(directory);assert.equal(lifecycleSummary(events,task.id).attempts,1);assert.equal(lifecycleSummary(events,task.id).failed_attempts,1);
 assert.equal(summarize(events).incomplete_spans,0);
});
test('resource collection labels unsupported platforms unavailable',async()=>{
 const {observeResources}=await import('../scripts/agent/resources.mjs');
 const m=await observeResources(process.pid,{platform:'unsupported'}).stop();
 assert.equal(m.find(x=>x.name==='child_sampled_cpu_ms').availability,'unavailable');
 assert.throws(()=>observeResources(process.pid,{intervalMs:1}),/interval/);
});

test('concurrent writers cannot exceed retention admission',async t=>{
 const root=await mkdtemp(join(tmpdir(),'race-'));t.after(()=>rm(root,{recursive:true,force:true}));const dir=join(root,'private');
 await Promise.allSettled(Array.from({length:20},(_,i)=>appendEvent(dir,traceEvent({task,kind:'lifecycle',state:'created',eventId:'race_'+i}),{maxEvents:1})));
 assert.equal((await readJournal(dir)).length,1);
});
test('export rejects path-bearing state and measurements',()=>{
 assert.throws(()=>sanitizeExport({repository:task.repository,events:[traceEvent({task,kind:'measurement',measurements:[{name:'/home/PRIVATE',availability:'unavailable'}]})]}),/measurement/);
});

test('explicit interrupted-lock recovery refuses living owner and preserves records',async t=>{
 const {mkdir}=await import('node:fs/promises');const {hostname}=await import('node:os');
 const {recoverInterruptedWriter}=await import('../scripts/agent/journal.mjs');
 const root=await mkdtemp(join(tmpdir(),'recovery-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const lock=join(root,'.writer-lock');await mkdir(lock);const created_at=new Date().toISOString();
 await writeFile(join(lock,'owner.json'),JSON.stringify({pid:process.pid,host:hostname(),created_at}));
 await assert.rejects(recoverInterruptedWriter(root,{expectedPid:process.pid,expectedCreatedAt:created_at}),/alive/);
 await writeFile(join(lock,'owner.json'),JSON.stringify({pid:2147483647,host:hostname(),created_at}));
 assert.equal((await recoverInterruptedWriter(root,{expectedPid:2147483647,expectedCreatedAt:created_at})).events_preserved,true);
});

test('export rejects private optional trace IDs and record enums',()=>{
 const e=traceEvent({task,kind:'span_start'});
 for(const key of ['attempt_id','parent_span_id'])assert.throws(()=>sanitizeExport({repository:task.repository,events:[{...e,[key]:'/home/private/SECRET'}]}),/identifier/);
 assert.throws(()=>sanitizeExport({repository:task.repository,records:[{schema_version:1,record_type:'attempt',id:'attempt_1',repository:task.repository,revision:task.revision,failure_category:'/home/private/SECRET'}]}),/enum/);
});
