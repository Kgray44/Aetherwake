import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createSnapshot } from '../scripts/agent/context.mjs';
import { readJournal } from '../scripts/agent/journal.mjs';
import { reconstructAttempts } from '../scripts/agent/record-journal.mjs';
import { sanitizeExport } from '../scripts/agent/telemetry-export.mjs';
import { observeCodexStream } from '../scripts/agent/provider-events.mjs';

const findings = rows => Object.fromEntries(rows.map(row => [row.name, row]));
const stream = chunks => Readable.from(chunks.map(chunk => Buffer.from(chunk)));
const line = event => JSON.stringify(event) + '\n';

test('observes Codex token usage incrementally and forwards stdout unchanged', async () => {
  const frames = [
    line({type:'thread.started',thread_id:'private-thread'}),
    line({type:'turn.started'}),
    line({type:'item.completed',item:{id:'private-item',type:'command_execution',status:'failed',exit_code:1,aggregated_output:'SECRET'}}),
    line({type:'turn.completed',usage:{input_tokens:12,cached_input_tokens:0,output_tokens:2}})
  ];
  const persisted = [];
  const forwarded = [];
  const rows = await observeCodexStream(stream([frames[0] + frames[1].slice(0,4),frames[1].slice(4) + frames[2],frames[3].trimEnd()]), {
    onUsage: async rows => { persisted.push(rows); },
    forward: async bytes => { forwarded.push(bytes); }
  });
  assert.equal(findings(rows).provider_stream_complete.value, 1);
  assert.equal(findings(rows).provider_command_failed_event_count.value, 1);
  assert.equal(persisted.length, 1);
  assert.equal(findings(persisted[0]).provider_input_tokens.value, 12);
  assert.equal(findings(persisted[0]).provider_cached_input_tokens.value, 0);
  assert.equal(findings(persisted[0]).provider_reasoning_output_tokens.availability, 'unavailable');
  assert.equal(Buffer.concat(forwarded).toString(), frames.join('').trimEnd());
  assert.doesNotMatch(JSON.stringify({rows,persisted}), /private-thread|private-item|SECRET/);
});

test('recovers after an oversized or malformed JSONL record and labels coverage partial', async () => {
  const persisted = [];
  const complete = line({type:'turn.completed',usage:{input_tokens:1}});
  const rows = findings(await observeCodexStream(stream([line({type:'turn.started'}),'x'.repeat(140),'y'.repeat(200) + '\n{broken}\n' + complete]), {
    maxLineBytes: 256,
    onUsage: async rows => { persisted.push(rows); }
  }));
  assert.equal(rows.provider_stream_complete.value, 0);
  assert.equal(rows.provider_stream_dropped_line_count.value, 2);
  assert.equal(persisted.length, 1);
});

test('does not convert failed, unfinished, or empty streams into complete usage', async () => {
  const failed = findings(await observeCodexStream(stream([
    line({type:'turn.started'}),
    line({type:'turn.failed',error:{message:'SECRET'}})
  ])));
  assert.equal(failed.provider_stream_complete.value, 1);
  assert.equal(failed.provider_turn_failed_event_count.value, 1);
  assert.equal(failed.provider_usage_complete.value, 0);
  assert.doesNotMatch(JSON.stringify(failed), /SECRET/);
  for (const frames of [[], [line({type:'turn.started'}), '{"type":"turn.completed"']]) {
    const rows = findings(await observeCodexStream(stream(frames)));
    assert.equal(rows.provider_stream_complete.value, 0);
    assert.equal(rows.provider_usage_complete.value, 0);
  }
});

test('reports journal callback failure and still consumes and forwards subsequent frames', async () => {
  const frames = [line({type:'turn.started'}),line({type:'turn.completed',usage:{input_tokens:1}}),line({type:'error',message:'SECRET'})];
  const forwarded = [];
  const rows = findings(await observeCodexStream(stream(frames), {
    onUsage: async () => { throw Error('private journal path'); },
    forward: async bytes => { forwarded.push(bytes); }
  }));
  assert.equal(rows.provider_stream_complete.value, 1);
  assert.equal(rows.provider_usage_complete.value, 0);
  assert.equal(rows.provider_usage_write_failure_count.value, 1);
  assert.equal(rows.provider_error_event_count.value, 1);
  assert.equal(Buffer.concat(forwarded).toString(), frames.join(''));
  assert.doesNotMatch(JSON.stringify(rows), /private journal path|SECRET/);
});

async function wrapperFixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'aetherwake-provider-observed-'));
  t.after(() => rm(cwd, { recursive:true, force:true }));
  const git = (...argv) => execFileSync('git', argv, { cwd, encoding:'utf8' }).trim();
  git('init', '-q');
  await writeFile(join(cwd, 'authority.md'), 'Canonical authority\n');
  git('add', 'authority.md');
  git('-c', 'user.name=Agent Test', '-c', 'user.email=agent-test@example.invalid', 'commit', '-qm', 'Fixture');
  const task = {
    schema_version:1, record_type:'task', id:'task_provider_fixture',
    repository:'example/repo', revision:git('rev-parse','HEAD'),
    created_at:new Date().toISOString(), title:'Provider fixture', objective:'Observe a supplied JSONL stream',
    classification:{primary:'integration',secondary:[]}, prerequisites:{task_ids:[],capabilities:[]},
    acceptance:{profile_id:'integration-test',criteria:[{id:'verify',description:'Observe the fixture'}]},
    state:'ready', owner_acceptance:'not_reviewed', requirements:[{kind:'document',uri:'authority.md'}]
  };
  const context = await createSnapshot({root:cwd,task,repository:task.repository,owners:['governance=authority.md']});
  const cli = fileURLToPath(new URL('../scripts/agent/telemetry.mjs', import.meta.url));
  const journalPath = join(cwd, 'events.jsonl.journal');
  const taskPath = join(cwd, 'task.json');
  const contextPath = join(cwd, 'context.json');
  await Promise.all([writeFile(taskPath, JSON.stringify(task)), writeFile(contextPath, JSON.stringify(context))]);
  const argv = command => [cli, 'run', '--task', taskPath, '--context', contextPath, '--repo', task.repository,
    '--event-stream', 'codex-exec-json', '--out', join(cwd, 'events.jsonl'), '--', process.execPath, '-e', command];
  return { cwd, journalPath, task, argv };
}

const usageFrames = line({type:'thread.started',thread_id:'private-thread'}) +
  line({type:'turn.started'}) +
  line({type:'item.completed',item:{id:'private-item',type:'file_change',changes:[{path:'secret-path'}]}}) +
  line({type:'turn.completed',usage:{input_tokens:15,cached_input_tokens:5,cache_write_input_tokens:0,output_tokens:2,reasoning_output_tokens:1}});

test('command wrapper journals selected usage and preserves the child stdout and exit status', async t => {
  const {cwd, journalPath, task, argv} = await wrapperFixture(t);
  const command = 'process.stdout.write(' + JSON.stringify(usageFrames) + ');process.exitCode=23';
  await assert.rejects(promisify(execFile)(process.execPath, argv(command), {cwd}), error => {
    assert.equal(error.code, 23);
    assert.equal(error.stdout, usageFrames);
    return true;
  });
  const events = await readJournal(journalPath);
  const start = events.find(event => event.kind === 'span_start');
  const usage = events.find(event => event.kind === 'measurement');
  const end = events.find(event => event.kind === 'span_end');
  assert.equal(usage.task_id, task.id);
  assert.equal(usage.revision, task.revision);
  assert.equal(usage.attempt_id, start.attempt_id);
  assert.equal(usage.span_id, start.span_id);
  assert.equal(findings(usage.measurements).provider_input_tokens.value, 15);
  assert.equal(findings(end.measurements).provider_usage_complete.value, 1);
  assert.equal(findings(end.measurements).process_exit_code.value, 23);
  const exported = sanitizeExport({repository:task.repository,events});
  assert.doesNotMatch(JSON.stringify(events), /private-thread|private-item|secret-path/);
  assert.deepEqual(exported.events.find(event => event.kind === 'measurement').measurements, usage.measurements);
});

test('completed usage survives observer interruption without claiming the Attempt completed', async t => {
  const {cwd, journalPath, argv} = await wrapperFixture(t);
  const command = 'process.stdout.write(' + JSON.stringify(usageFrames) + ');setTimeout(()=>{},3000)';
  const wrapper = spawn(process.execPath, argv(command), {cwd,stdio:'ignore',windowsHide:true});
  const closed = once(wrapper, 'close');
  let saved = false;
  try {
    for (let i=0; i<150; i++) {
      const events = await readJournal(journalPath).catch(error => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
      saved = events.some(event => event.kind === 'measurement');
      if (saved) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(saved, true, 'provider measurement persisted before child exit');
  } finally {
    wrapper.kill('SIGKILL');
    await closed;
  }
  const rebuilt = await reconstructAttempts(journalPath);
  assert.equal(rebuilt.attempts[0].state, 'running');
  assert.equal(rebuilt.coverage[0].coverage, 'partial');
  assert.equal(rebuilt.coverage[0].execution_liveness, 'unknown');
  const events = await readJournal(journalPath);
  assert.equal(findings(events.find(event => event.kind === 'measurement').measurements).provider_input_tokens.value, 15);
  assert.equal(events.some(event => event.kind === 'span_end'), false);
});
