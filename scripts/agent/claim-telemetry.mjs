import { isAbsolute, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { hostname } from 'node:os';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { appendEvent, traceEvent } from './journal.mjs';
import { startObservatorySync } from './observatory-sync.mjs';
import { sanitizeExport } from './telemetry-export.mjs';
import { validateRecord, validateTraceEvent } from './validate-record.mjs';

const identity = /^[A-Za-z0-9_.:-]{1,160}$/;
const revision = /^[a-f0-9]{40}$/;
const recoveryKeyPattern = /^[a-f0-9]{64}$/;
const recoveryOperationPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const claimMarker = /^active-(attempt_[a-f0-9-]{36})\.json$/;
const terminalStates = new Set(['completed', 'failed', 'interrupted', 'cancelled']);
const codexTurnSources = new Set(['codex_exec_json_turn_completed', 'not_exposed_by_usage_event',
  'codex_app_server_token_usage_updated', 'codex_app_server_turn_profile']);

export function processHasExited(pid) {
  if (!Number.isSafeInteger(pid) || pid<=0 || pid>0x7fff_ffff) return false;
  try { process.kill(pid,0); return false; }
  catch (error) { return error.code==='ESRCH'; }
}

export async function readInterruptedClaim(directory, taskId, attemptId) {
  if (!directory || !claimMarker.test('active-'+attemptId+'.json')) return null;
  try {
    if (!(await lstat(directory)).isDirectory() || await realpath(directory)!==directory) return null;
  } catch(error) { if(error.code==='ENOENT')return null; throw error; }
  for (const prefix of ['active-', 'interrupted-']) {
    const path=join(directory,prefix+attemptId+'.json');
    try {
      const info=await lstat(path);
      if (!info.isFile() || info.size>8192) return null;
      const marker=JSON.parse(await readFile(path,'utf8'));
      return marker.host===hostname() && marker.taskId===taskId && marker.attemptId===attemptId ? marker : null;
    } catch(error) { if(error.code!=='ENOENT')throw error; }
  }
  return null;
}

// The marker carries exact local recovery identities without a lease or source contents.
export async function retainActiveClaim(directory, { task, attempt, recoveryKey }) {
  if (!claimMarker.test('active-'+attempt.id+'.json')) throw Error('Invalid active claim identity');
  await mkdir(directory,{recursive:true,mode:0o700});
  if (!(await lstat(directory)).isDirectory() || await realpath(directory)!==directory) {
    throw Error('Claim telemetry directory must be local');
  }
  const path=join(directory,'active-'+attempt.id+'.json');
  let marker={taskId:task.id,attemptId:attempt.id,revision:attempt.revision,pid:process.pid,host:hostname(),
    ...(recoveryKeyPattern.test(recoveryKey ?? '')?{recoveryKey}: {})};
  async function write(destination, value) {
    const file=await open(destination,'wx',0o600);
    try {
      await file.writeFile(JSON.stringify(value));
      await file.sync();
    } finally { await file.close(); }
  }
  await write(path,marker);
  return {
    async update({workspace,branch,sessionId,turnId,providerPid,candidateRevision,terminalOperationId,recoveryOperationId,settled}){
      const details=Object.fromEntries(Object.entries({
        workspace,branch,sessionId,turnId,providerPid,candidateRevision,terminalOperationId,recoveryOperationId,settled,
      }).filter(([,value])=>value!==undefined));
      const next={...marker,...details,updatedAt:new Date().toISOString()};
      const temporary=path+'.'+randomUUID()+'.tmp';
      try {
        await write(temporary,next);
        await rename(temporary,path);
        marker=next;
      } finally { await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;}); }
    },
    clear:()=>unlink(path),
  };
}

export async function reconcileAbandonedClaim({directory,taskId,readTask,recoverCandidate}) {
  try { if (!(await lstat(directory)).isDirectory() || await realpath(directory)!==directory) return; }
  catch(error) { if(error.code==='ENOENT')return; throw error; }
  const entries=await readdir(directory,{withFileTypes:true}).catch(error=>{
    if(error.code==='ENOENT')return [];
    throw error;
  });
  for (const file of entries.filter(entry=>entry.isFile()&&claimMarker.test(entry.name)).slice(0,8)) {
    const path=join(directory,file.name);
    const marker=JSON.parse(await readFile(path,'utf8'));
    if (marker.host!==hostname() || marker.taskId!==taskId || marker.attemptId!==file.name.match(claimMarker)[1] ||
        !revision.test(marker.revision) || !Number.isSafeInteger(marker.pid) || marker.pid<=0) continue;
    if (marker.settled!==true && !processHasExited(marker.pid)) continue;
    const detail=await readTask(taskId);
    const attempt=detail.attempts?.find(item=>item.id===marker.attemptId);
    if (detail.task?.id!==taskId || detail.task.repository!=='Kgray44/Aetherwake' || attempt?.revision!==marker.revision ||
        !attempt.finished_at || ['running','pausing','cancelling'].includes(attempt.state)) continue;
    if(attempt.state==='orphaned'){
      const spanId='codex-'+attempt.id+'-worker_exit_recovery';
      const sessionId=attempt.session_id ?? (identity.test(marker.sessionId ?? '') ? marker.sessionId : undefined);
      const entry=traceEvent({task:{...detail.task,revision:attempt.revision},attemptId:attempt.id,sessionId,
        spanId,eventId:spanId,kind:'lifecycle',phase:'other',state:'interrupted',occurredAt:attempt.finished_at});
      if(validateTraceEvent(entry).length)throw Error('Invalid abandoned claim recovery event');
      await appendEvent(join(directory,'claimed-execution.journal'),entry);
      if (!marker.candidateRevision && marker.workspace && marker.sessionId && marker.providerPid) {
        await rename(path,join(directory,'interrupted-'+attempt.id+'.json')).catch(error=>{
          if(error.code!=='ENOENT')throw error;
        });
        continue;
      }
    }
    // Retain a verified local candidate until the canonical attempt records
    // that exact revision. This readback never turns a local result into acceptance.
    if (revision.test(marker.candidateRevision ?? '') && marker.candidateRevision!==attempt.candidate_revision) {
      if (!recoverCandidate || detail.lifecycle?.stored_state!=='failed' || detail.attempts.at(-1)?.id!==attempt.id ||
          attempt.state!=='orphaned' || !recoveryKeyPattern.test(marker.recoveryKey ?? '') ||
          !recoveryOperationPattern.test(marker.recoveryOperationId ?? '') ||
          !recoveryOperationPattern.test(marker.terminalOperationId ?? '') || !identity.test(marker.turnId ?? '') ||
          !Number.isFinite(attempt.recovery_until) || Date.now()>=attempt.recovery_until ||
          marker.branch!==attempt.branch || marker.sessionId!==attempt.session_id ||
          !await recoverCandidate(marker)) continue;
    }
    await unlink(path).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
}

/** Observe a claimed execution without owning its lifecycle or making an executor call. */
export function createClaimTelemetry({ journal, task, attempt, deliveryDirectory, verificationNamespace,
  providerStream = 'codex_exec_jsonl' },
  { startDelivery = startObservatorySync, managedConnection } = {}) {
  if (!isAbsolute(journal) || (deliveryDirectory !== undefined && !isAbsolute(deliveryDirectory)) ||
      task?.record_type !== 'task' || validateRecord(task).length || !identity.test(task.id) || !identity.test(attempt?.id ?? '') ||
      !revision.test(attempt?.revision ?? '') || !['codex_exec_jsonl','codex_app_server'].includes(providerStream)) {
    throw Error('Invalid claim telemetry configuration');
  }

  const executionTask = { ...task, revision:attempt.revision };
  const spanId = 'codex-' + attempt.id;
  let startedAt, delivery, closing, opening;
  function event(kind, measurements, { state, eventId, phase='implementation', span=spanId, occurredAt, sessionId, note } = {}) {
    const entry = traceEvent({task:executionTask,attemptId:attempt.id,spanId:span,kind,phase,state,eventId,measurements,occurredAt,sessionId});
    if (note) entry.development_note = note;
    const sanitized = sanitizeExport({repository:task.repository,events:[entry]}).events[0];
    if (validateTraceEvent(sanitized).length) throw Error('Invalid claim telemetry event');
    return sanitized;
  }

  function beginDelivery() {
    opening ??= deliveryDirectory ? startDelivery({task,journal,directory:deliveryDirectory,verificationNamespace,
      ...(managedConnection ? { managedConnection } : {})}).then(value=>{delivery=value;}).catch(() => {}) : Promise.resolve();
    return opening;
  }
  function recordStageStart({name,phase,startAt}) {
    const span = spanId + '-' + name;
    return appendEvent(journal,event('span_start',[],{phase,span,occurredAt:startAt,state:'started',eventId:span + '-start'}));
  }

  return {
    async recordStageStart(stage) {
      await recordStageStart(stage);
      await beginDelivery();
    },
    async start() {
      if (startedAt !== undefined) throw Error('Claim telemetry already exists');
      const requested = {
        name:'provider_stream_requested',availability:'observed',unit:'boolean',value:1,
        source:providerStream,method:'observer_configuration',
      };
      const start = event('span_start',[requested],{state:'started',eventId:spanId + '-start'});
      if (!await appendEvent(journal,start)) throw Error('Claim telemetry already exists');
      startedAt = performance.now();
      // The worker's credential stays with the engine. Only the configured
      // Observatory connection can deliver a projection.
      await beginDelivery();
    },
    async onUsage(measurements, {sessionId,occurredAt} = {}) {
      if (startedAt === undefined || closing) throw Error('Claim telemetry is not recording');
      if (!Array.isArray(measurements) || measurements.length > 64 ||
          measurements.some(row => !codexTurnSources.has(row?.source))) throw Error('Invalid Codex turn measurements');
      await appendEvent(journal,event('measurement',measurements,{sessionId,occurredAt}));
    },
    async onDevelopmentNote({itemId,sessionId,note,occurredAt}) {
      if (startedAt===undefined||closing) return;
      const eventId='note_'+createHash('sha256').update(JSON.stringify([attempt.id,sessionId,itemId])).digest('hex');
      await appendEvent(journal,event('development_note',[],{eventId,sessionId,note,occurredAt}));
    },
    async recordStage({ name, phase, startAt, endAt, durationMs, state }) {
      if (closing) throw Error('Claim telemetry is not recording');
      const span = spanId + '-' + name;
      await recordStageStart({name,phase,startAt});
      await appendEvent(journal,event('span_end',[{
        name:'elapsed_wall_ms',availability:'observed',unit:'ms',value:durationMs,
        source:'local_monotonic_clock',method:name,
      }],{phase,span,occurredAt:endAt,state,eventId:span + '-end'}));
    },
    finish({ measurements = [], state, executionEnd }) {
      if (closing) return closing;
      if (!terminalStates.has(state) || !Array.isArray(measurements) ||
          measurements.length > 64 || measurements.some(row => row?.source !== providerStream)) {
        throw Error('Invalid claim telemetry completion');
      }
      closing = (async () => {
        try {
          if (startedAt !== undefined) {
            const duration = {
              name:'elapsed_wall_ms',availability:'observed',unit:'ms',value:(executionEnd?.monotonic ?? performance.now()) - startedAt,
              source:'local_monotonic_clock',method:'worker_capture_interval',
            };
            await appendEvent(journal,event('span_end',[...measurements,duration],{state,occurredAt:executionEnd?.at,eventId:spanId + '-end'}));
          }
        } finally {
          await delivery?.finish().catch(() => {});
        }
      })();
      return closing;
    },
  };
}

/** Per-claim worker hooks. The dedicated checkout is already storage-admitted. */
export function createClaimTelemetryHooks(workspace, delivery = {}, telemetryDirectory) {
  if (!isAbsolute(workspace)) throw Error('Claim telemetry requires an absolute workspace');
  const directory = telemetryDirectory ?? join(workspace, '.git', 'agent-harness');
  let observer;
  function observe({task,attempt,verificationNamespace,providerStream}) {
    observer ??= createClaimTelemetry({
        task,attempt,journal:join(directory, 'claimed-execution.journal'),
        deliveryDirectory:join(directory, 'observatory-sync'), verificationNamespace,providerStream,
      }, delivery);
    return observer;
  }
  return {
    onTelemetryStageStart(input) {
      return observe(input).recordStageStart(input);
    },
    onTelemetryStart(input) {
      return observe(input).start();
    },
    async onUsage({ measurements,sessionId,occurredAt }) {
      if (!observer) throw Error('Claim telemetry did not start');
      await observer.onUsage(measurements,{sessionId,occurredAt});
    },
    onDevelopmentNote(input) {
      return observer?.onDevelopmentNote(input);
    },
    async onTelemetryStage(stage) {
      await observer?.recordStage(stage);
    },
    async onTelemetryEnd({ measurements, state, executionEnd }) {
      await observer?.finish({measurements,state,executionEnd});
    },
  };
}
