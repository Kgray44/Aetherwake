import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSnapshot, checkFreshness } from "../scripts/agent/context.mjs";
import { runObserved } from "../scripts/agent/telemetry.mjs";

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "aetherwake-agent-c-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  function git(...args) { return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim(); }
  git("init", "-q");
  git("config", "user.name", "Agent test");
  git("config", "user.email", "agent-test@example.invalid");
  await mkdir(join(dir, "docs"));
  await writeFile(join(dir, "docs", "authority.md"), "canonical content\n");
  git("add", ".");
  git("commit", "-qm", "test fixture");
  const revision = git("rev-parse", "HEAD");
  const task = {
    schema_version: 1, record_type: "task", id: "task_fixture",
    repository: "example/repo", revision,
    created_at: new Date().toISOString(), title: "Fixture task", objective: "Verify Phase C",
    classification: { primary: "backend", secondary: [] },
    prerequisites: { task_ids: [], capabilities: [] },
    acceptance: { profile_id: "backend-test", criteria: [{ id: "verify", description: "Pass fixture checks" }] },
    state: "ready",
    requirements: [{ kind: "document", uri: "docs/authority.md" }]
  };
  const snapshot=await createSnapshot({root:dir,task,repository:task.repository,owners:['docs=docs/authority.md']});
  return { dir, git, revision, task, snapshot };
}
test("context pins Git revision and hashed tracked sources, without inventing owners", async t => {
  const f = await fixture(t);
  const snapshot = await createSnapshot({ root: f.dir, task: f.task, context:f.snapshot, repository: f.task.repository, owners: ["docs=docs/authority.md"] });
  assert.equal(snapshot.record_type, "context_snapshot");
  assert.equal(snapshot.revision, f.revision);
  assert.equal(snapshot.freshness, "current");
  assert.match(snapshot.requirements[0].revision, /^[a-f0-9]{64}$/);
  assert.equal(snapshot.components[0].name, "docs");
  assert.equal(await checkFreshness(snapshot, f.task, f.revision, f.dir), true);
  assert.equal(await checkFreshness(snapshot, f.task, "0".repeat(40), f.dir), false);
  const missing = await createSnapshot({ root: f.dir, task: f.task, context:f.snapshot, repository: f.task.repository, owners: [] });
  assert.equal(missing.freshness, "unverified");
  await assert.rejects(() => createSnapshot({ root: f.dir, task: f.task, context:f.snapshot, repository: f.task.repository, owners: ["bad=../outside"] }), /outside/);
});
test("context refuses obsolete task revisions", async t => {
  const f = await fixture(t);
  const task = { ...f.task, revision: "0".repeat(40) };
  const snapshot = await createSnapshot({ root: f.dir, task, repository: task.repository, owners: ["docs=docs/authority.md"] });
  assert.equal(snapshot.freshness, "stale");
});
test("telemetry writes observed process events and explicitly unavailable provider metrics", async t => {
  const f = await fixture(t);
  const previous = process.cwd();
  process.chdir(f.dir);
  t.after(() => process.chdir(previous));
  const out = join(f.dir, "events.jsonl");
  const r = await runObserved({
    task: f.task, context:f.snapshot, repository: f.task.repository, phase: "verification", out,
    command: [process.execPath, "-e", "process.exit(0)"]
  });
  assert.equal(r.exitCode, 0);
  const lines = (await readFile(out, "utf8")).trim().split("\n").map(x => JSON.parse(x));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].record_type, "attempt");
  assert.equal(lines[0].state, "succeeded");
  assert.equal(lines[1].record_type, "telemetry");
  assert.equal(lines[1].measurements.find(x => x.name === "elapsed_wall_ms").availability, "observed");
  assert.equal(lines[1].measurements.find(x => x.name === "provider_quota_consumption").availability, "unavailable");
});


test('context rejects changed source bytes and task semantics at use time', async t => {
 const f = await fixture(t);
 const s = await createSnapshot({root:f.dir,task:f.task,context:f.snapshot,repository:f.task.repository,owners:['docs=docs/authority.md']});
 assert.equal(await checkFreshness(s,{...f.task,title:'Changed scope'},f.revision,f.dir),false);
 await writeFile(join(f.dir,'docs/authority.md'),'changed');
 assert.equal(await checkFreshness(s,f.task,f.revision,f.dir),false);
});

test('multiple commands retain one Attempt and do not finish it', async t=>{
 const f=await fixture(t);const previous=process.cwd();process.chdir(f.dir);t.after(()=>process.chdir(previous));const out=join(f.dir,'events.jsonl');
 for(let i=0;i<2;i++){
  const r=await runObserved({task:f.task,context:f.snapshot,repository:f.task.repository,attemptId:'attempt_shared',out,command:[process.execPath,'-e','process.exit(0)']});
  assert.equal(r.attempt.state,'running');assert.equal(r.attempt.finished_at,undefined);
 }
 const records=(await readFile(out,'utf8')).trim().split('\n').map(JSON.parse);assert.equal(records.length,2);assert.ok(records.every(r=>r.record_type==='telemetry'&&r.attempt_id==='attempt_shared'));
});
test('wrapper rejects stale Task before launching child', async t=>{
 const f=await fixture(t);const previous=process.cwd();process.chdir(f.dir);t.after(()=>process.chdir(previous));
 await assert.rejects(runObserved({task:{...f.task,revision:'0'.repeat(40)},repository:f.task.repository,command:[process.execPath,'-e','process.exit(0)']}),/Stale Task/);
});

test('context cannot omit authoritative requirements',async t=>{
 const f=await fixture(t);
 assert.equal(await checkFreshness({...f.snapshot,requirements:[]},f.task,f.revision,f.dir),false);
});
test('wrapper refuses missing or stale context before execution',async t=>{
 const f=await fixture(t);const previous=process.cwd();process.chdir(f.dir);t.after(()=>process.chdir(previous));
 await assert.rejects(runObserved({task:f.task,repository:f.task.repository,command:[process.execPath,'-e','process.exit(0)']}),/context/);
 await writeFile(join(f.dir,'docs/authority.md'),'changed');
 await assert.rejects(runObserved({task:f.task,context:f.snapshot,repository:f.task.repository,command:[process.execPath,'-e','process.exit(0)']}),/context/);
});

test('durable Attempt start reconstructs after actual observer process termination',async t=>{
 const {spawn}=await import('node:child_process');
 const {reconstructAttempts}=await import('../scripts/agent/record-journal.mjs');
 const {readdir}=await import('node:fs/promises');
 const f=await fixture(t);const out=join(f.dir,'interrupted.jsonl');
 const script=`import {runObserved} from ${JSON.stringify(new URL('../scripts/agent/telemetry.mjs',import.meta.url).href)};process.chdir(${JSON.stringify(f.dir)});await runObserved({task:${JSON.stringify(f.task)},context:${JSON.stringify(f.snapshot)},repository:'example/repo',out:${JSON.stringify(out)},command:[process.execPath,'-e','setTimeout(()=>{},300)']});`;
 const child=spawn(process.execPath,['--input-type=module','-e',script],{stdio:'ignore'});
 let found=false;
 for(let i=0;i<100;i++){try{found=(await readdir(out+'.journal/records')).some(n=>n.endsWith('.json'));}catch{}if(found)break;await new Promise(r=>setTimeout(r,10));}
 assert.ok(found,'running canonical Attempt persisted before execution');
 const closed=new Promise(r=>child.once('close',r));child.kill('SIGKILL');await closed;
 const result=await reconstructAttempts(out+'.journal');
 assert.equal(result.attempts.length,1);assert.equal(result.attempts[0].state,'running');
 assert.equal(result.coverage[0].execution_liveness,'unknown');assert.equal(result.coverage[0].coverage,'partial');
});
test('observed Attempt captures actual tool callback phases without accepting Task',async t=>{
 const {observeAttempt,reconstructAttempts}=await import('../scripts/agent/record-journal.mjs');
 const f=await fixture(t);const previous=process.cwd();process.chdir(f.dir);t.after(()=>process.chdir(previous));const directory=join(f.dir,'observed');
 const result=await observeAttempt({directory,task:f.task,context:f.snapshot,attemptId:'attempt_actual',run:async({observe})=>{
  return observe('verification',async()=>execFileSync(process.execPath,['-e','process.stdout.write("verified tool ran")'],{encoding:'utf8'}));
 }});
 assert.equal(result.value,'verified tool ran');assert.equal(result.attempt.state,'succeeded');
 const rebuilt=await reconstructAttempts(directory);assert.equal(rebuilt.attempts[0].state,'succeeded');assert.equal(rebuilt.coverage[0].unfinished_span_count,0);
 assert.equal(f.task.state,'ready');
});

test('observed Attempt preserves falsy thrown failures and refuses replay',async t=>{
 const {observeAttempt,reconstructAttempts}=await import('../scripts/agent/record-journal.mjs');
 const f=await fixture(t);const previous=process.cwd();process.chdir(f.dir);t.after(()=>process.chdir(previous));const directory=join(f.dir,'failed-attempt');
 let invoked=0,caught=false;
 try{await observeAttempt({directory,task:f.task,context:f.snapshot,attemptId:'attempt_failed',run:async()=>{invoked++;throw null;}});}catch(e){caught=true;assert.equal(e,null);}
 assert.equal(caught,true);assert.equal((await reconstructAttempts(directory)).attempts[0].state,'failed');
 await assert.rejects(observeAttempt({directory,task:f.task,context:f.snapshot,attemptId:'attempt_failed',run:async()=>{invoked++;}}),/already exists/);
 assert.equal(invoked,1);
});

test('new observed Attempt refuses crash-before-lifecycle gap without repeating callback',async t=>{
 const {beginAttempt,observeAttempt}=await import('../scripts/agent/record-journal.mjs');
 const f=await fixture(t);const previous=process.cwd();process.chdir(f.dir);t.after(()=>process.chdir(previous));const directory=join(f.dir,'crash-gap');
 const now=new Date().toISOString();await beginAttempt(directory,{schema_version:1,record_type:'attempt',id:'attempt_gap',created_at:now,repository:f.task.repository,revision:f.revision,task_id:f.task.id,attempt_number:1,state:'running',started_at:now});
 let calls=0;await assert.rejects(observeAttempt({directory,task:f.task,context:f.snapshot,attemptId:'attempt_gap',run:async()=>{calls++;}}),/already exists/);assert.equal(calls,0);
});

test('bootstraps a Task with its existing source owner and reuses a fresh snapshot', async t => {
  const { prepareTask } = await import('../scripts/agent/task-router.mjs');
  const f = await fixture(t);
  const contextFile = join(f.dir, 'private', 'context.json');
  const options = {
    checkout: f.dir, paths: ['docs/authority.md'],
    owners: ['docs=docs/authority.md'], contextFile
  };
  const first = await prepareTask(f.task, options);
  assert.equal(first.context_reused, false);
  assert.equal(first.primary_class, 'backend');
  assert.equal(first.context_snapshot.freshness, 'current');
  assert.deepEqual(JSON.parse(await readFile(contextFile, 'utf8')), first.context_snapshot);
  const second = await prepareTask(f.task, options);
  assert.equal(second.context_reused, true);
  assert.equal(second.context_snapshot.id, first.context_snapshot.id);
  await assert.rejects(() => prepareTask(f.task, { ...options, owners: ['other=docs/authority.md'] }), /scope differs/);
  await writeFile(join(f.dir, 'docs', 'authority.md'), 'changed');
  await assert.rejects(() => prepareTask(f.task, options), /stale/);
  assert.deepEqual(JSON.parse(await readFile(contextFile, 'utf8')), first.context_snapshot);
});

test('batched context resolves literal tracked names and rejects untracked aliases', async t => {
  const f = await fixture(t);
  const literal = 'docs/[literal].md';
  await writeFile(join(f.dir, literal), 'tracked literal');
  f.git('add', '--', literal);
  f.git('commit', '-qm', 'track literal');
  const revision = f.git('rev-parse', 'HEAD');
  const task = { ...f.task, revision, requirements: [
    { kind: 'document', uri: literal },
    { kind: 'git', uri: 'docs/authority.md' }
  ] };
  const snapshot = await createSnapshot({ root: f.dir, task, repository: task.repository, owners: ['docs=' + literal] });
  assert.equal(snapshot.freshness, 'current');
  assert.equal(await checkFreshness(snapshot, task, revision, f.dir), true);
  await writeFile(join(f.dir, literal), 'modified');
  assert.equal(await checkFreshness(snapshot, task, revision, f.dir), false);
  const untracked = { ...task, requirements: [{ kind: 'git', uri: 'docs/*.md' }] };
  assert.equal((await createSnapshot({ root: f.dir, task: untracked, repository: task.repository, owners: ['docs=docs/authority.md'] })).freshness, 'unverified');
});

test('launch failure preserves the wrapper status and reports unavailable child measurements', async t => {
  const f = await fixture(t);
  const previous = process.cwd();
  process.chdir(f.dir);
  t.after(() => process.chdir(previous));
  const result = await runObserved({
    task: f.task, context: f.snapshot, repository: f.task.repository,
    out: join(f.dir, 'failed-launch.jsonl'), command: [join(f.dir, 'missing-executable')]
  });
  assert.equal(result.exitCode, 127);
  assert.equal(result.attempt.state, 'failed');
  const metrics=Object.fromEntries(result.telemetry.measurements.map(metric => [metric.name, metric]));
  assert.equal(metrics.process_exit_code.availability, 'unavailable');
  assert.equal(metrics.elapsed_wall_ms.availability, 'unavailable');
  assert.equal(metrics.process_launch_succeeded.value, 0);
  assert.equal(metrics.observer_cpu_system_ms.availability, 'observed');
});
