#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { codexTurnObservation, independentCodexTurn, linkedCodexThread } from '../../agent-system/observatory/codex-turn-observation.mjs';
import { telemetryTaskId } from '../../agent-system/observatory/telemetry-delta.mjs';
import { openObservatoryConnector } from './observatory-connector.mjs';

const engine = 'aetherwake_engineering_observatory.task_engine_v1';
const digest = value => createHash('sha256').update(value).digest('hex');

export async function syncDesktopHistory(connection, { taskId, threadId, verification }) {
  if (!telemetryTaskId.test(taskId ?? '')) throw Error('Task ID required');
  const scope = verification ? {verification} : {};
  const {task,attempts} = await connection.call({request:{op:'get',task_id:taskId},...scope},engine);
  if (task.id!==taskId) throw Error('Task identity mismatch');
  const sessions = [...new Set(attempts.map(attempt=>attempt.session_id).filter(Boolean))];
  const thread = threadId ?? (sessions.length===1 ? sessions[0] : null);
  if (!linkedCodexThread(attempts,thread)) throw Error('Choose a persisted thread linked to this Task');
  const args = {task_id:taskId,...scope};
  const {baseline} = await connection.call(args);
  const existing = new Set((baseline?.projection?.events ?? []).map(event=>event.event_id));
  const observed = [];
  let cursor = null;
  for (let pageNumber=0;pageNumber<3;pageNumber++) {
    const page = await connection.readThreadTurns(thread,cursor);
    for (const turn of page.data) {
      const id = 'codex-turn:'+thread+':'+turn.id;
      if (existing.has(id) || !['completed','failed','interrupted'].includes(turn.status) ||
          !Number.isSafeInteger(turn.startedAt) || !Number.isSafeInteger(turn.completedAt) ||
          !independentCodexTurn(task,attempts,thread,turn.startedAt*1000,turn.completedAt*1000)) continue;
      const items = await connection.readThreadTurnItems(thread,turn.id);
      if (!Array.isArray(items.data)||items.data.length>50||items.data.some(row=>row.turnId!==turn.id)) {
        throw Error('Codex item history did not match its requested turn');
      }
      const event = codexTurnObservation(task,attempts,thread,turn,items.data,Boolean(items.nextCursor),digest(id));
      if (event) { observed.push(event); existing.add(id); }
    }
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  if (!observed.length) return {taskId,threadId:thread,observed:0,historyLimited:Boolean(cursor)};
  const generated = Math.max(Date.now(), Date.parse(baseline?.projection?.generated_at ?? '')+1 || 0);
  const receipt = await connection.call({...args,change:{
    base:baseline?.digest ?? null,generated_at:new Date(generated).toISOString(),
    records:baseline ? [] : [{...task,state:'proposed',owner_acceptance:'not_reviewed'}],events:observed,
  }});
  return {taskId,threadId:thread,observed:observed.length,historyLimited:Boolean(cursor),receivedAt:receipt.received_at};
}

function checkoutReconciliation(task, attempts) {
  const prior = attempts.findLast(attempt=>attempt.session_id);
  const pin = prior?.revision ?? task.revision;
  if (!/^[a-f0-9]{40}$/.test(pin)) throw Error('Task execution revision is unavailable');
  const git = (...args) => {
    const result = spawnSync('git',args,{encoding:'utf8',timeout:10000,windowsHide:true,maxBuffer:1024*1024});
    if (result.status!==0) throw Error('Could not inspect the local checkout for this Task');
    return result.stdout.trim();
  };
  const head = git('rev-parse','HEAD');
  const branch = git('branch','--show-current');
  const dirty = Boolean(git('status','--porcelain'));
  const changedPaths = head===pin ? 0 : git('diff','--name-only',pin,head).split(/\r?\n/).filter(Boolean).length;
  return {taskId:task.id,pin,head,branch,dirty,changedPaths,
    cleanPinnedTaskBranch:head===pin&&!dirty&&branch==='codex/aads-'+task.id.replace('_','-')};
}

async function main() {
  const {values} = parseArgs({options:{
    'task-id':{type:'string'},'thread-id':{type:'string'},verification:{type:'string'},
    watch:{type:'boolean'},reconcile:{type:'boolean'},'codex-bin':{type:'string'},
  }});
  const controller = new AbortController();
  process.once('SIGINT',()=>controller.abort());
  process.once('SIGTERM',()=>controller.abort());
  const connection = openObservatoryConnector({signal:controller.signal,executable:values['codex-bin']});
  try {
    if (values.reconcile) {
      if (values.watch || !telemetryTaskId.test(values['task-id'] ?? '')) throw Error('Reconciliation requires one Task ID');
      const result = await connection.call({request:{op:'get',task_id:values['task-id']},
        ...(values.verification?{verification:values.verification}:{})},engine);
      if (result.task.id!==values['task-id']) throw Error('Task identity mismatch');
      console.log(JSON.stringify(checkoutReconciliation(result.task,result.attempts)));
      return;
    }
    do {
      const args = {taskId:values['task-id'],threadId:values['thread-id'],verification:values.verification};
      try {
        let result;
        try { result = await syncDesktopHistory(connection,args); }
        catch (error) {
          if (error.status!==409) throw error;
          // A managed worker can publish between baseline read and delivery.
          // Re-read the canonical attempts and receipt before retrying once.
          result = await syncDesktopHistory(connection,args);
        }
        console.log(JSON.stringify(result));
      } catch (error) {
        if (!values.watch || !(error.status>=500 || error.status===409)) throw error;
        console.error(JSON.stringify({status:'sync_deferred',httpStatus:error.status}));
      }
      if (values.watch) await sleep(30000,undefined,{signal:controller.signal});
    } while (values.watch && !controller.signal.aborted);
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally { connection.close(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1])) {
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
