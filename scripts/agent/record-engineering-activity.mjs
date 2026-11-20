#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {appendEvent} from './journal.mjs';
import {readTask} from './export-journal.mjs';
import {startObservatorySync} from './observatory-sync.mjs';
import {sanitizeExport} from './telemetry-export.mjs';
import {validateRecord,validateTraceEvent} from './validate-record.mjs';

const fields = new Set(['kind','source','source_id','revision','occurred_at','outcome','artifact_digest','session_id','attempt_id']);
const phaseByKind = {commit:'integration',review:'review',test:'verification',benchmark:'verification',
  verification:'verification',deployment:'integration',deployment_validation:'verification',executor_session:'implementation'};
const hash = values => createHash('sha256').update(JSON.stringify(values)).digest('hex');

export async function recordEngineeringActivity({task,directory,receipt,syncOptions}) {
  if (task?.record_type!=='task'||validateRecord(task).length) throw Error('Expected a valid existing Task');
  if (!receipt||Object.keys(receipt).some(key=>!fields.has(key))||
      typeof receipt.source_id!=='string'||!/^[-A-Za-z0-9_.:]{1,160}$/.test(receipt.source_id)||
      !Object.hasOwn(phaseByKind,receipt.kind)) throw Error('Invalid engineering activity receipt');
  if (syncOptions?.activityOnly && receipt.attempt_id) throw Error('Independent activity cannot bind an attempt');
  const operation = hash([task.repository,task.id,receipt.kind,receipt.source,receipt.source_id]);
  const stage = receipt.outcome==='started'?'started':'result';
  const event = {
    trace_version:1,event_id:'activity_'+operation+'_'+stage,task_id:task.id,
    trace_id:operation,span_id:operation,repository:task.repository,revision:receipt.revision,
    occurred_at:receipt.occurred_at,kind:'engineering_activity',phase:phaseByKind[receipt.kind],measurements:[],
    ...(receipt.session_id?{session_id:receipt.session_id}:{}),
    ...(receipt.attempt_id?{attempt_id:receipt.attempt_id}:{}),
    activity:{kind:receipt.kind,source:receipt.source,operation_id:operation,outcome:receipt.outcome,
      ...(receipt.artifact_digest?{artifact_digest:receipt.artifact_digest}:{})},
  };
  if (validateTraceEvent(event).length) throw Error('Invalid engineering trace');
  const safe = sanitizeExport({repository:task.repository,events:[event]}).events[0];
  const result = {event_id:safe.event_id,recorded:await appendEvent(directory,safe)};
  if (syncOptions===undefined) return result;
  try {
    const delivery = await startObservatorySync({...syncOptions,task,journal:directory});
    if (!delivery) return {...result,delivery:'not_configured'};
    const report = await delivery.finish();
    if (report?.last_success&&!report.error) {
      return {...result,delivery:'synchronized',projection_received_at:report.last_success};
    }
  } catch {
    // The source receipt is durable and may be retried without creating another event.
  }
  return {...result,delivery:'pending'};
}

if (process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  try {
    const [taskFlag,taskPath,journalFlag,directory,receiptFlag,receiptPath,...rest]=process.argv.slice(2);
    const sync = rest[0]==='--sync';
    const activityOnly = sync&&rest[1]==='--activity-only';
    if (rest.length!==(activityOnly?2:sync?1:0)||taskFlag!=='--task'||journalFlag!=='--journal'||receiptFlag!=='--receipt'||!taskPath||!directory||!receiptPath) {
      throw Error('Usage: node scripts/agent/record-engineering-activity.mjs --task PATH --journal DIRECTORY --receipt PATH [--sync [--activity-only]]');
    }
    const [task,receipt]=await Promise.all([readTask(taskPath),readTask(receiptPath)]);
    const result=await recordEngineeringActivity({task,directory,receipt,...(sync?{syncOptions:{activityOnly}}:{})});
    console.log(JSON.stringify(result));
    if (sync&&result.delivery!=='synchronized') process.exitCode=1;
  } catch (error) {
    console.error('Engineering activity: '+(error.code??error.message));
    process.exitCode=1;
  }
}
