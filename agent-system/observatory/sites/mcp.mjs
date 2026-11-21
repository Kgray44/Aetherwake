import { readBounded } from './github.mjs';
import { MAX_SYNC_BYTES, validateProjection, storeProjection } from './sync.mjs';
import { isTaskWorkerKey, taskOperation } from './task-engine.mjs';
import { ingestTaskTelemetry, telemetryBaseline, sha256 } from './task-telemetry.mjs';
import { telemetryTaskId } from '../telemetry-delta.mjs';
import { mcpOwnerCommands,taskEngineToolSchema } from './task-engine-tool-schema.mjs';
import { integrationAccess, integrationOperation, integrationWorkerOps } from './integration-runs.mjs';
import { githubIntegration } from './github-integration.mjs';
import { integrationCIRerunner } from './ci-controls.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const tools=[
 {name:'task_engine_v1',description:'List, inspect, register and edit canonical engineering Tasks. The authenticated owner can amend admitted Tasks, append exact-attempt addenda, schedule, dispatch, pause, resume, retry and cancel. Executor claim and reporting require a worker credential.',
  inputSchema:taskEngineToolSchema},
 {name:'project_execution_snapshot',description:'Store a bounded sanitized private execution projection. Does not execute, approve or verify work.',inputSchema:{type:'object',additionalProperties:false,required:['projection'],properties:{projection:{type:'object'},verification:{type:'string',format:'uuid'}}}},
 {name:'read_execution_projection',description:'Read the caller-owned execution projection and its digest. Imported evidence is not independent proof.',inputSchema:{type:'object',additionalProperties:false,properties:{verification:{type:'string',format:'uuid'}}}},
 {name:'sync_task_telemetry',description:'Read a private Task telemetry baseline or append a sanitized incremental update as the authenticated Site visitor. Returns a durable delivery receipt. No execution or approval.',
  inputSchema:{type:'object',additionalProperties:false,required:['task_id'],properties:{
   task_id:{type:'string',pattern:telemetryTaskId.source},verification:{type:'string',format:'uuid'},
   change:{type:'object',additionalProperties:false,required:['base','generated_at','records','events'],properties:{
    base:{type:['string','null']},generated_at:{type:'string'},records:{type:'array',items:{type:'object'}},events:{type:'array',items:{type:'object'}}
   }}
  }}}
];
async function receipt(projection){
 const bytes=new TextEncoder().encode(JSON.stringify(projection));
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 return {generated_at:projection.generated_at,digest:'sha256:'+digest,records:projection.records.length,events:projection.events.length,authority:projection.authority,acceptance:'not-granted'};
}
export async function mcp(request,env,{validate,validateEvent,taskRevision,fetcher = fetch}){
 const reply=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'private, no-store','x-content-type-options':'nosniff'}});
 const owner=request.headers.get('oai-authenticated-user-id');
 if(!owner)return reply({error:'Authenticated caller required'},401);
 if(request.method!=='POST')return reply({error:'Method not allowed'},405);
 const origin=request.headers.get('origin');
 if((origin!==null&&origin!==new URL(request.url).origin)||!['same-origin','none',null].includes(request.headers.get('sec-fetch-site')))return reply({error:'Cross-origin request rejected'},403);
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return reply({error:'Expected JSON'},415);
 let message;
 try{message=JSON.parse(await readBounded(request.body,MAX_SYNC_BYTES));}catch{return reply({error:'Invalid or oversized request'},400);}
 const id=message?.id;
 if(!message||Array.isArray(message)||message.jsonrpc!=='2.0'||!['string','number'].includes(typeof id))return reply({error:'Invalid RPC envelope'},400);
 const rpc=result=>reply({jsonrpc:'2.0',id,result});
 const fail=(code,text)=>reply({jsonrpc:'2.0',id,error:{code,message:text}});
 if(message.method==='server/discover')return rpc({supportedVersions:['2026-07-28'],capabilities:{tools:{}}});
 if(message.method==='tools/list')return rpc({tools});
 if(message.method!=='tools/call')return fail(-32601,'Method not found');
 const name=message.params?.name,args=message.params?.arguments??{};
 if(!tools.some(t=>t.name===name))return fail(-32601,'Tool not found');
 const fields = name==='task_engine_v1' ? ['request','worker_key'] : name==='project_execution_snapshot' ? ['projection'] : name==='sync_task_telemetry' ? ['task_id','change'] : [];
 if(!args||Array.isArray(args)||typeof args!=='object'||Object.keys(args).some(k=>!['verification',...fields].includes(k)))return fail(-32602,'Invalid arguments');
 if(args.verification!==undefined&&!UUID.test(args.verification))return fail(-32602,'Invalid verification namespace');
 const namespace=args.verification?'verification:'+args.verification:'live';
 const result=(data,isError=false)=>rpc({content:[{type:'text',text:JSON.stringify(data)}],isError,
  ...(name==='task_engine_v1'?{structuredContent:data}:{})});
 if(!env.DB)return result({error:'Storage unavailable'},true);
 try{
  if(name==='task_engine_v1'){
   const isOwnerOperation = ['get','list'].includes(args.request?.op) ||
    args.request?.op==='command'&&mcpOwnerCommands.has(args.request.action?.type);
   let access = owner===env.OBSERVATORY_TASK_ENGINE_OWNER_ID&&isOwnerOperation?'owner':'agent';
   if(args.worker_key !== undefined) {
    if(owner !== env.OBSERVATORY_TASK_ENGINE_OWNER_ID || !isTaskWorkerKey(args.worker_key) ||
      !isTaskWorkerKey(env.OBSERVATORY_TASK_WORKER_KEY) ||
      await sha256(args.worker_key) !== await sha256(env.OBSERVATORY_TASK_WORKER_KEY)) {
     return result({status:403,error:'Executor authorization required'},true);
    }
    access = 'worker';
   }
   const rerunJob = args.request?.op === 'ci_tick' && access === 'worker'
     ? integrationCIRerunner({env,owner,verification:args.verification ?? null,fetcher}) : undefined;
   const response = integrationWorkerOps.has(args.request?.op)
     ? await integrationOperation({ db: env.DB, owner, namespace, body: args.request, worker: access === 'worker',
       access:{...integrationAccess(env,owner,namespace),ci_enabled:Boolean(rerunJob)},rerunJob,
       github:githubIntegration(fetcher,env.GITHUB_READ_TOKEN) })
     : await taskOperation({ db: env.DB, owner, namespace, body: args.request, validate, access, revision: taskRevision });
   return result({status:response.status,...response.body},response.status>=400);
  }
  if(name==='sync_task_telemetry'){
   if(typeof args.task_id!=='string'||!telemetryTaskId.test(args.task_id))return fail(-32602,'Invalid Task ID');
   if(args.change===undefined)return result({baseline:await telemetryBaseline(env.DB,owner,namespace,args.task_id)});
   const response=await ingestTaskTelemetry({db:env.DB,owner,namespace,id:args.task_id,body:args.change,validate,validateEvent});
   return result({status:response.status,...response.body});
  }
  if(name==='project_execution_snapshot'){
   const projection=validateProjection(args.projection,validate,validateEvent);
   if(!await storeProjection(env.DB,owner,namespace,projection))return result({error:'Older/conflicting projection or verification namespace limit reached'},true);
   return result(await receipt(projection));
  }
  const row=await env.DB.prepare('SELECT payload FROM private_projection WHERE owner_id = ? AND namespace = ?').bind(owner,namespace).first();
  if(!row)return result({projection:null,acceptance:'not-granted'});
  const projection=JSON.parse(row.payload);return result({projection,receipt:await receipt(projection)});
 }catch{return name==='task_engine_v1'?result({status:503,error:'Task Engine storage unavailable. Read current state before retrying the same operation ID.'},true)
  :result({error:'Projection rejected or storage unavailable'},true);}
}
