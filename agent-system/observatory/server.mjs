#!/usr/bin/env node
// Aetherwake engineering observatory: read-only contract projection + explicit local task creation.
// No third-party dependencies. Bind only to loopback. Never publish local records by default.
import http from 'node:http';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,'../..');
const localDir=resolve(process.env.AETHERWAKE_OBSERVATORY_DATA_DIR || join(homedir(),'.aetherwake','engineering-observatory'));
const port=Number(process.env.PORT || 4178);
const distDir=join(here,'dist');
const HOST='127.0.0.1';
const MAX_BODY=64*1024;
const allowedTypes=new Set(['task','attempt','evidence','telemetry','context_snapshot','verification_profile']);
const validClasses=new Set(['visual','bug','backend','performance','security','research','documentation','feature','maintenance','integration']);
const validStates=new Set(['proposed','ready','running','verifying','blocked','failed','accepted','cancelled','superseded']);
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
let schema=null;

function revision(){try{return execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',timeout:2000}).trim()}catch{return null}}
function reply(res,status,data){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data))}
async function scan(dir,out,depth=0){
  if(depth>4 || !existsSync(dir))return;
  for(const ent of await readdir(dir,{withFileTypes:true})){
    const p=join(dir,ent.name);
    if(ent.isDirectory())await scan(p,out,depth+1);
    else if(ent.isFile()&&ent.name.endsWith('.json')&&out.length<15000){
      try{
        const value=JSON.parse(await readFile(p,'utf8'));
        const items=Array.isArray(value)?value:[value];
        for(const item of items)if(item&&item.schema_version===1&&allowedTypes.has(item.record_type)&&typeof item.id==='string')out.push(item);
      }catch{/* malformed/partial record never crashes page */}
    }
  }
}
async function allRecords(){
  const out=[];
  // Phase C may populate a canonical feed here. Local operator records are separate.
  for(const dir of [join(root,'agent-system','records'),join(root,'agent-system','observatory','records'),localDir])await scan(dir,out);
  const seen=new Map();
  for(const r of out)seen.set(r.record_type+':'+r.id,r);
  return [...seen.values()];
}
function cleanString(v,max=1000){return typeof v==='string'?v.trim().slice(0,max):''}
function validateNewTask(b){
  if(!b||typeof b!=='object'||Array.isArray(b))throw Error('Task body must be an object');
  const title=cleanString(b.title,160), objective=cleanString(b.objective,6000);
  const primary=cleanString(b.primary,32),profile=cleanString(b.profile_id,100);
  if(title.length<4||objective.length<12)throw Error('Title (4+) and objective (12+) are required');
  if(!validClasses.has(primary))throw Error('Unsupported task classification');
  if(!profile)throw Error('Verification profile is required');
  const deps=Array.isArray(b.dependencies)?b.dependencies:[];
  const criteria=Array.isArray(b.criteria)?b.criteria:[];
  const capabilities=Array.isArray(b.capabilities)?b.capabilities:[];
  if(deps.length>100||criteria.length>50||capabilities.length>100)throw Error('Too many dependencies or criteria');
  const ids=deps.map(x=>cleanString(x,128)).filter(Boolean);
  const accept=criteria.map((x,i)=>({id:'criterion-'+(i+1),description:cleanString(x,1000)})).filter(x=>x.description);
  if(!accept.length)throw Error('At least one acceptance criterion is required');
  return {title,objective,primary,profile,ids,accept,capabilities:capabilities.map(x=>cleanString(x,128)).filter(Boolean)};
}
async function createTask(body){
  const v=validateNewTask(body),rev=revision();
  if(!rev||!/^[0-9a-f]{40}$/.test(rev))throw Error('A checked-out Git revision is required to create a task');
  const now=new Date().toISOString(),id='task_'+randomUUID();
  const task={schema_version:1,record_type:'task',id,created_at:now,repository:'Kgray44/Aetherwake',revision:rev,title:v.title,objective:v.objective,classification:{primary:v.primary,secondary:[]},prerequisites:{task_ids:v.ids,capabilities:v.capabilities},acceptance:{profile_id:v.profile,criteria:v.accept},state:'proposed',owner_acceptance:'not_reviewed',artifacts:[]};
  // Validate required fields from the checked-in contract; do not invent extra business state.
  if(schema){
    const d=schema.$defs?.Task;
    for(const prop of d?.required||[])if(!(prop in task))throw Error('Contract missing '+prop);
  }
  await mkdir(join(localDir,'tasks'),{recursive:true,mode:0o700});
  await writeFile(join(localDir,'tasks',id+'.json'),JSON.stringify(task,null,2)+'\n',{flag:'wx',mode:0o600});
  return task;
}
async function handler(req,res){
  const url=new URL(req.url,'http://localhost');
  const host=String(req.headers.host||'').split(':')[0];
  if(!['127.0.0.1','localhost'].includes(host)){return reply(res,403,{error:'Local requests only'})}
  const origin=req.headers.origin;
  if(req.method==='POST'&&origin){try{const target=new URL(origin);if(!['127.0.0.1','localhost'].includes(target.hostname)||target.port!==String(port)||target.protocol!=='http:')return reply(res,403,{error:'Origin not allowed'})}catch{return reply(res,403,{error:'Invalid origin'})}}
  if(req.method==='GET'&&url.pathname==='/api/overview'){
    const records=await allRecords();
    return reply(res,200,{schema_version:1,revision:revision(),generated_at:new Date().toISOString(),records,source:'repository + private local records',telemetry_note:'Unavailable measurements are not zero; PR merge does not imply task acceptance.'});
  }
  if(req.method==='POST'&&url.pathname==='/api/tasks'){
    let raw='';
    try{
      if(!req.headers['content-type']?.startsWith('application/json'))return reply(res,415,{error:'Expected application/json'});
      for await(const chunk of req){raw+=chunk;if(raw.length>MAX_BODY)return reply(res,413,{error:'Payload too large'})}
      const task=await createTask(JSON.parse(raw));
      return reply(res,201,{task,storage:'private-local',note:'Task is proposed. No execution or owner approval has been initiated.'});
    }catch(e){return reply(res,400,{error:e.message})}
  }
  if(req.method!=='GET')return reply(res,405,{error:'Method not allowed'});
  // Serve only files from the Vite production build. Never allow arbitrary filesystem access.
  let name;
  try { name=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname) }
  catch { return reply(res,400,{error:'Malformed path'}) }
  if(name.includes('\0')||name.includes('\\'))return reply(res,404,{error:'Not found'});
  const target=resolve(distDir,'.'+name);
  if(target!==join(distDir,'index.html')&&!target.startsWith(distDir+sep))return reply(res,404,{error:'Not found'});
  try {
    const data=await readFile(target);
    res.writeHead(200,{'content-type':mime[extname(target)]||'application/octet-stream','x-content-type-options':'nosniff','cache-control':'no-store','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});
    res.end(data);
  }catch{return reply(res,404,{error:'Build the React UI first: npm install && npm run build'})}
}
try{schema=JSON.parse(await readFile(join(root,'agent-system','contracts','v1.schema.json'),'utf8'))}catch{console.warn('Contract schema unavailable; required field guard disabled')}
if(!process.env.OBSERVATORY_NO_LISTEN){
  http.createServer((req,res)=>{handler(req,res).catch(e=>reply(res,500,{error:'Internal error',detail:e.message}))}).listen(port,HOST,()=>console.log('Aetherwake Engineering Observatory http://'+HOST+':'+port));
}
export {validateNewTask,createTask,allRecords,handler};