import {requirementKinds,TASK_OBJECTIVE_MAX} from '../intake.mjs';
import {checkoutDiagnosticSchema} from '../checkout-diagnostic.mjs';
import {executionFailureCategories} from '../execution-failure.mjs';

const string = (maxLength,description) => ({type:'string',minLength:1,maxLength,...(description?{description}:{})});
const strings = (count,length) => ({type:'array',maxItems:count,items:string(length)});
const object = (properties,required=[]) => ({type:'object',additionalProperties:false,properties,...(required.length?{required}:{})});
const revision = {type:'string',pattern:'^[a-f0-9]{40}$'};
const uuid = {type:'string',format:'uuid'};
const taskId = string(128,'Exact Task ID returned by register or list.');
const taskFields = object({
  title:string(160),objective:{type:'string',minLength:12,maxLength:TASK_OBJECTIVE_MAX},
  primary:{type:'string',enum:['visual','bug','backend','performance','security','research','documentation','feature','maintenance','integration']},
  profile_id:string(100),criteria:strings(50,1000),dependencies:strings(100,128),merged_dependencies:strings(100,128),
  capabilities:strings(100,128),deliverables:strings(30,500),
  priority:{type:'string',enum:['low','normal','high','urgent']},
  requirements:{type:'array',maxItems:50,items:object({
    kind:{type:'string',enum:requirementKinds},uri:string(1000),revision:string(128),
  },['kind','uri'])},
},['title','objective','primary','profile_id','criteria']);
const ownerCommands = ['edit','addendum','admit','configure_execution','pause','resume','cancel','retry','continue_candidate'];
export const mcpOwnerCommands = new Set(ownerCommands);

export const taskEngineToolSchema = object({
  request:object({
    op:{type:'string',enum:['list','get','register','command','claim','report','worker_pulse','recover_worker_candidate','integration_claim','integration_begin','integration_report',
      'repair_tick','repair_claim','repair_begin','repair_status','repair_report','ci_tick']},
    id:uuid,claim_id:uuid,repair_id:uuid,tree_sha:revision,shallow_base:revision,candidate_sha:revision,session_id:uuid,turn_id:uuid,
    changed_paths:strings(12,240),
    usage:object({input_tokens:{type:'integer',minimum:0},cached_input_tokens:{type:'integer',minimum:0},
      output_tokens:{type:'integer',minimum:0},total_tokens:{type:'integer',minimum:0},
      cache_write_input_tokens:{type:'integer',minimum:0},
      complete:{type:'boolean'},source:{const:'codex_app_server_fresh_thread'}},
    ['input_tokens','cached_input_tokens','output_tokens','total_tokens','complete','source']),
    status:{type:'string',enum:['submitted','failed','unknown','candidate']},
    execution_identity:object({model:string(100),provider:string(100),source:{const:'codex_app_server_thread_start'}},
      ['model','provider','source']),
    worker_id:{type:'string',description:'Worker UUID for authenticated liveness observations.'},
    worker_state:{type:'string',enum:['available','busy','claim_rejected','task_connection_unavailable','storage_guard_timeout','storage_reserve_denied','storage_guard_unavailable']},
    operation_id:{...uuid,description:'Required for register, command, claim and report. Generate a UUID v4 once per write and reuse it only to replay the same request.'},
    task_id:taskId,
    expected_version:{type:'integer',minimum:1,description:'Required for command. Use the current version returned by get.'},
    include_archived:{type:'boolean'},state:string(32,'Optional lifecycle state filter for list.'),
    fields:taskFields,
    action:object({
      type:{type:'string',enum:['associate',...ownerCommands],
        description:'admit dispatches a proposed Task to the Codex queue. Use start_at to schedule it.'},
      fields:taskFields,
      text:string(2000,'Authenticated owner instructions for the chosen attempt.'),
      target:{type:'string',enum:['active_attempt','next_attempt']},
      attempt_id:string(160),
      revision,
      feedback:string(2000,'Owner instructions for continuing the exact candidate.'),
      changed_assumption:string(500,'Required for retry of a failed Task. Explain what changed since the failed attempt.'),
      executor:{type:'string',enum:['codex']},
      start_at:{type:['string','null'],description:'ISO 8601 datetime with offset. Null clears an existing schedule on configure_execution.'},
      max_attempt_minutes:{type:'integer',minimum:1,maximum:30},
      cancel_with_dependency:{type:'boolean'},
      prerequisites:strings(100,128),
      reference:object({kind:string(32),uri:string(1000),revision},['kind','uri','revision']),
    },['type']),
    task_ids:{type:'array',maxItems:500,items:taskId},
    conversation_continuation:{type:'boolean',description:'Worker supports clean-checkout continuation of stored Codex conversations.'},
    separate_execution_notes:{type:'boolean',description:'Worker receives owner follow-up notes separately from the canonical objective.'},
    live_addenda:{type:'boolean',description:'Worker supports a fenced addendum checkpoint on the persisted Codex conversation.'},
    recovery_commitment:{type:'string',pattern:'^[a-f0-9]{64}$',description:'SHA-256 commitment to a worker-held candidate recovery key.'},
    candidate_recovery:object({
      key:{type:'string',pattern:'^[a-f0-9]{64}$'},revision,session_id:uuid,branch:string(200),
    },['key','revision','session_id','branch']),
    attempt_id:string(160),lease:string(256),
    report:object({
      checkout_diagnostic:checkoutDiagnosticSchema,
      failure_kind:{type:'string',enum:Object.keys(executionFailureCategories)},
      type:{type:'string',enum:['heartbeat','finished','failed','stopped','addenda_take','addenda_delivered','addenda_acknowledged']},
      turn_id:uuid,reservation_id:uuid,
      session_id:uuid,branch:string(200),revision,result:{type:'string',enum:['candidate']},failure:string(500),
      execution_identity:object({
        model:string(100),provider:string(100),source:{type:'string',enum:['codex_app_server_thread_start']},
      },['model','provider','source']),
    },['type']),
  },['op']),
  verification:{...uuid,description:'Optional isolated verification namespace. Independent of request.operation_id.'},
  worker_key:{type:'string',minLength:32,maxLength:256,description:'Configured executor credential for claim, report and worker liveness. Do not include it for owner operations.'},
},['request']);
