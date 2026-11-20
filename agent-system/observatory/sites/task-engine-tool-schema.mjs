import {requirementKinds} from '../intake.mjs';

const string = (maxLength,description) => ({type:'string',minLength:1,maxLength,...(description?{description}:{})});
const strings = (count,length) => ({type:'array',maxItems:count,items:string(length)});
const object = (properties,required=[]) => ({type:'object',additionalProperties:false,properties,...(required.length?{required}:{})});
const revision = {type:'string',pattern:'^[a-f0-9]{40}$'};
const uuid = {type:'string',format:'uuid'};
const taskId = string(128,'Exact Task ID returned by register or list.');
const taskFields = object({
  title:string(160),objective:string(6000),
  primary:{type:'string',enum:['visual','bug','backend','performance','security','research','documentation','feature','maintenance','integration']},
  profile_id:string(100),criteria:strings(50,1000),dependencies:strings(100,128),
  capabilities:strings(100,128),deliverables:strings(30,500),
  priority:{type:'string',enum:['low','normal','high','urgent']},
  requirements:{type:'array',maxItems:50,items:object({
    kind:{type:'string',enum:requirementKinds},uri:string(1000),revision:string(128),
  },['kind','uri'])},
},['title','objective','primary','profile_id','criteria']);
const ownerCommands = ['admit','configure_execution','pause','resume','cancel'];
export const mcpOwnerCommands = new Set(ownerCommands);

export const taskEngineToolSchema = object({
  request:object({
    op:{type:'string',enum:['list','get','register','command','claim','report']},
    operation_id:{...uuid,description:'Required for register, command, claim and report. Generate a UUID v4 once per write and reuse it only to replay the same request.'},
    task_id:taskId,
    expected_version:{type:'integer',minimum:1,description:'Required for command. Use the current version returned by get.'},
    include_archived:{type:'boolean'},state:string(32,'Optional lifecycle state filter for list.'),
    fields:taskFields,
    action:object({
      type:{type:'string',enum:['edit','associate',...ownerCommands],
        description:'admit dispatches a proposed Task to the Codex queue. Use start_at to schedule it.'},
      fields:taskFields,
      executor:{type:'string',enum:['codex']},
      start_at:{type:['string','null'],description:'ISO 8601 datetime with offset. Null clears an existing schedule on configure_execution.'},
      max_attempt_minutes:{type:'integer',minimum:1,maximum:30},
      cancel_with_dependency:{type:'boolean'},
      prerequisites:strings(100,128),
      reference:object({kind:string(32),uri:string(1000),revision},['kind','uri','revision']),
    },['type']),
    task_ids:{type:'array',maxItems:500,items:taskId},
    conversation_continuation:{type:'boolean',description:'Worker supports clean-checkout continuation of stored Codex conversations.'},
    attempt_id:string(160),lease:string(256),
    report:object({
      type:{type:'string',enum:['heartbeat','finished','failed','stopped']},
      session_id:uuid,branch:string(200),revision,result:{type:'string',enum:['candidate']},failure:string(500),
      execution_identity:object({
        model:string(100),provider:string(100),source:{type:'string',enum:['codex_app_server_thread_start']},
      },['model','provider','source']),
    },['type']),
  },['op']),
  verification:{...uuid,description:'Optional isolated verification namespace. Independent of request.operation_id.'},
  worker_key:{type:'string',minLength:32,maxLength:256,description:'Configured executor credential for claim and report only. Do not include it for owner operations.'},
},['request']);
