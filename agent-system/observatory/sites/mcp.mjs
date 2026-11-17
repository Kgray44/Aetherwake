import { readBounded } from './github.mjs';
import { MAX_SYNC_BYTES, validateProjection, storeProjection } from './sync.mjs';
import { ingestTaskTelemetry, telemetryBaseline } from './task-telemetry.mjs';
import { telemetryTaskId } from '../telemetry-delta.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const tools=[
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
export async function mcp(request,env,{validate,validateEvent}){
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
 const fields = name==='project_execution_snapshot' ? ['projection'] : name==='sync_task_telemetry' ? ['task_id','change'] : [];
 if(!args||Array.isArray(args)||typeof args!=='object'||Object.keys(args).some(k=>!['verification',...fields].includes(k)))return fail(-32602,'Invalid arguments');
 if(args.verification!==undefined&&!UUID.test(args.verification))return fail(-32602,'Invalid verification namespace');
 const namespace=args.verification?'verification:'+args.verification:'live';
 const result=(data,isError=false)=>rpc({content:[{type:'text',text:JSON.stringify(data)}],isError});
 if(!env.DB)return result({error:'Storage unavailable'},true);
 try{
  if(name==='sync_task_telemetry'){
   if(typeof args.task_id!=='string'||!telemetryTaskId.test(args.task_id))return fail(-32602,'Invalid Task ID');
   if(args.change===undefined)return result({baseline:await telemetryBaseline(env.DB,owner,namespace,args.task_id)});
   const response=await ingestTaskTelemetry({db:env.DB,owner,namespace,id:args.task_id,body:args.change,validate,validateEvent});
   return result({status:response.status,...response.body},response.status!==200);
  }
  if(name==='project_execution_snapshot'){
   const projection=validateProjection(args.projection,validate,validateEvent);
   if(!await storeProjection(env.DB,owner,namespace,projection))return result({error:'Older/conflicting projection or verification namespace limit reached'},true);
   return result(await receipt(projection));
  }
  const row=await env.DB.prepare('SELECT payload FROM private_projection WHERE owner_id = ? AND namespace = ?').bind(owner,namespace).first();
  if(!row)return result({projection:null,acceptance:'not-granted'});
  const projection=JSON.parse(row.payload);return result({projection,receipt:await receipt(projection)});
 }catch{return result({error:'Projection rejected or storage unavailable'},true);}
}
