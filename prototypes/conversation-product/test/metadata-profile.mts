/** Opt-in bounded diagnosis of a RETAINED SYNTHETIC library-scale fixture.
 * Copies its DB into fresh owned profiles. Never opens the original writable.
 * Instrumented work and uninstrumented timings are separate processes/copies.
 * No UI/provider/account activity and no native performance qualification.
 */
import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { BackendCore } from '../../integrated-backend/src/core.mts';
import type { ConversationGraph, GraphData } from '../../connected-conversations/src/graph.ts';
import type { CanonicalConversationHost, ConversationProduct } from '../src/service.mts';

const HERE=fileURLToPath(import.meta.url),REPO=resolve(dirname(HERE),'../../..'),MiB=1024*1024;
const LIMITS={disk:64*MiB,database:15*MiB,state:6*MiB,rss:256*MiB,deadlineMs:10000,receipt:256*1024};
const HEAP=['--max-old-space-size=128','--max-semi-space-size=8'];
const args=new Map(process.argv.slice(2).map(a=>{assert(a.startsWith('--'));const n=a.indexOf('=');return n<0?[a.slice(2),'true']:[a.slice(2,n),a.slice(n+1)];}));
const digest=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const git=(...a:string[])=>execFileSync('git',a,{cwd:REPO,encoding:'utf8',windowsHide:true,maxBuffer:MiB}).trim();
const json=(file:string,value:unknown)=>{const out=JSON.stringify(value,null,2)+'\n';assert(Buffer.byteLength(out)<=LIMITS.receipt);writeFileSync(file,out,{flag:'wx'});};
function binding(candidate:string){
 assert(/^[a-f0-9]{40}$/.test(candidate)&&candidate===git('rev-parse','HEAD'),'candidate_changed');assert.equal(git('status','--porcelain'),'','source_dirty');
 const files=['prototypes/conversation-product/test/metadata-profile.mts','prototypes/conversation-product/src/service.mts','prototypes/conversation-product/src/canonical-host.mts','prototypes/integrated-backend/src/core.mts','prototypes/connected-conversations/src/graph.ts'];
 return {candidate,tree:git('rev-parse','HEAD^{tree}'),node:process.version,hashes:Object.fromEntries(files.map(f=>[f,digest(readFileSync(join(REPO,f)))]))};
}
function sourceFixture(file:string){
 assert(isAbsolute(file)&&realpathSync(file)===resolve(file),'exact_source_path_required');assert.equal(statSync(file).size<=LIMITS.database,true);
 const marker=JSON.parse(readFileSync(join(dirname(dirname(file)),'owner.json'),'utf8'));assert.equal(marker.contract,'aerynth.library-scale-owner@1');
 const db=new DatabaseSync(file,{readOnly:true});try{
  const raw=String(db.prepare('SELECT json FROM integration_state WHERE id=1').get()!.json);assert(Buffer.byteLength(raw)<=LIMITS.state);
  const data=JSON.parse(raw) as {graph:GraphData};assert(data.graph.messages.every(m=>m.content.startsWith('Synthetic ')),'synthetic_source_only');
  return {fileSha256:digest(readFileSync(file)),originalCandidate:marker.candidate,conversations:data.graph.conversations.length,messages:data.graph.messages.length,edges:data.graph.edges.length,stateBytes:Buffer.byteLength(raw)};
 }finally{db.close();}
}
type Owner={db:DatabaseSync;graph:ConversationGraph;state:{graph:GraphData};port:Record<string,unknown>;conversations:ConversationProduct;conversationAccess:{access:(id:string,messageId?:string)=>boolean}};
async function child(){
 const mode=args.get('mode'),operation=args.get('operation'),profile=args.get('profile')!;assert(mode==='work'||mode==='timing');assert(operation==='list'||operation==='collections');
 const ownerMarker=JSON.parse(readFileSync(join(dirname(profile),'owner.json'),'utf8'));assert.equal(ownerMarker.contract,'aerynth.metadata-profile-owner@1');assert.equal(ownerMarker.binding.candidate,args.get('candidate'));
 const work={hostAccess:0,canonicalAccess:0,uniqueHostAccess:0,uniqueCanonicalAccess:0,metadataCalls:0,metadataAllow:0,uniqueMetadataAllow:0,sqlPrepare:0,sqlGet:0,sqlAll:0,sqlRun:0,graphSnapshot:0,visibleMessages:0,providerCalls:0};
 const sets={host:new Set<string>(),canonical:new Set<string>(),metadata:new Set<string>()},restores:(()=>void)[]=[];
 let core:BackendCore|undefined;const start=performance.now(),receipt:Record<string,unknown>={mode,operation,passed:false,work};
 const progress=()=>{work.uniqueHostAccess=sets.host.size;work.uniqueCanonicalAccess=sets.canonical.size;work.uniqueMetadataAllow=sets.metadata.size;process.send?.({elapsedMs:performance.now()-start,work:{...work},rss:process.memoryUsage().rss});};
 try{
  core=new BackendCore({path:join(profile,'canonical.sqlite'),privateRoot:profile,contentPolicy:'synthetic-only',provider:'fixture'});const o=core as unknown as Owner;
  for(const key of ['connect','capabilities','open','resume','read','items','turn','terminal','interrupt'])o.port[key]=async()=>{work.providerCalls++;throw Error('provider_forbidden');};
  const before=Number(o.db.prepare('SELECT total_changes() AS n').get()!.n);assert(process.memoryUsage().rss<=LIMITS.rss,'sampled_rss_admission_exceeded');
  if(mode==='work'){
   const host=(o.conversations as unknown as {host:CanonicalConversationHost}).host;
   for(const [target,key,label] of [[host,'access','host'],[o.conversationAccess,'access','canonical']] as const){
    const object=target as {access?:(id:string,messageId?:string)=>boolean},original=object[key]!;
    object[key]=function(id,messageId){work[label==='host'?'hostAccess':'canonicalAccess']++;sets[label].add(id+'\0'+(messageId??''));if((work.canonicalAccess&16383)===0)progress();return original.call(this,id,messageId);};restores.push(()=>{object[key]=original;});
   }
   const prepare=o.db.prepare.bind(o.db);o.db.prepare=((sql:string)=>{work.sqlPrepare++;const statement=prepare(sql);return new Proxy(statement,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;return (...params:unknown[])=>{if(key==='get')work.sqlGet++;if(key==='all')work.sqlAll++;if(key==='run')work.sqlRun++;return value.apply(target,params);};}});}) as typeof o.db.prepare;restores.push(()=>{o.db.prepare=prepare;});
   const metadata=o.graph.visibleMessageMetadata.bind(o.graph);o.graph.visibleMessageMetadata=(id,options)=>{work.metadataCalls++;return metadata(id,{...options,allow:m=>{work.metadataAllow++;sets.metadata.add(m.conversationId+'\0'+m.id);return options.allow(m);}});};restores.push(()=>{o.graph.visibleMessageMetadata=metadata;});
   const snapshot=o.graph.snapshot.bind(o.graph);o.graph.snapshot=()=>{work.graphSnapshot++;return snapshot();};restores.push(()=>{o.graph.snapshot=snapshot;});
   const visible=o.graph.visibleMessages.bind(o.graph);o.graph.visibleMessages=id=>{work.visibleMessages++;return visible(id);};restores.push(()=>{o.graph.visibleMessages=visible;});
  }
  const samples:number[]=[],count=mode==='work'?1:4;let value:unknown;
  for(let n=0;n<count;n++){const t=performance.now();value=operation==='list'?await core.command('conversation',{name:'list',input:{limit:50,sort:'activity'}}):await core.command('conversation',{name:'collections',input:{}});const elapsed=performance.now()-t;if(mode==='work'||n>0)samples.push(elapsed);assert(process.memoryUsage().rss<=LIMITS.rss,'sampled_rss_admission_exceeded');}
  restores.reverse().forEach(fn=>fn());restores.length=0;
  assert.equal(Number(o.db.prepare('SELECT total_changes() AS n').get()!.n)-before,0,'read_mutated_sql');assert.equal(work.providerCalls,0);
  receipt.samplesMs=samples;receipt.warmups=mode==='timing'?1:0;receipt.responseBytes=Buffer.byteLength(JSON.stringify(value));receipt.resultDigest=digest(JSON.stringify(value));receipt.passed=true;
 }catch(error){receipt.error=String(error instanceof Error?error.message:error).slice(0,400);}
 finally{restores.reverse().forEach(fn=>fn());progress();if(core)await core.command('close',{});receipt.elapsedMs=performance.now()-start;receipt.rss=process.memoryUsage().rss;process.send?.({terminal:receipt});}
}
async function main(){
 for(const key of args.keys())assert(['candidate','source','worker','mode','operation','profile','describe'].includes(key),'unknown_argument');
 if(args.has('describe')){console.log(JSON.stringify({contract:'aerynth.metadata-profile-plan@1',bounds:LIMITS,heap:HEAP,operations:['list','collections'],timing:'one warmup + three in-process samples; separate uninstrumented copies',nativeQualified:false}));return;}
 if(args.has('worker')){await child();return;}
 const candidate=args.get('candidate')!,source=args.get('source')!;assert(source&&candidate,'explicit_source_candidate_required');const bound=binding(candidate),original=sourceFixture(source);
 const reserve=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-File',join(process.env.LOCALAPPDATA!,'AeroStorageWatch','ReserveGuard.ps1'),'-EstimatedCBytes',String(LIMITS.disk),'-EstimatedDBytes','0'],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:65536}));assert.equal(reserve.allowed,true);
 const session=join(REPO,'prototypes/visual-experience/cinematic-v3/.runtime/application-evidence','metadata-profile-'+Date.now()+'-'+randomUUID().slice(0,8));mkdirSync(session,{recursive:true});json(join(session,'owner.json'),{contract:'aerynth.metadata-profile-owner@1',binding:bound,original,reserve});const results:unknown[]=[];
 for(const mode of ['work','timing'])for(const operation of ['list','collections']){
  const profile=join(session,mode+'-'+operation);mkdirSync(profile);copyFileSync(source,join(profile,'canonical.sqlite'));assert.equal(digest(readFileSync(join(profile,'canonical.sqlite'))),original.fileSha256);
  const result=await new Promise<Record<string,unknown>>((done,reject)=>{
   const options={cwd:REPO,execArgv:HEAP,env:{...process.env,NODE_DISABLE_COMPILE_CACHE:'1'},silent:true,windowsHide:true};
   const processChild=fork(HERE,['--worker','--candidate='+candidate,'--mode='+mode,'--operation='+operation,'--profile='+profile],options);let deadline=false,last:unknown,terminal:unknown,bytes=0;
   const timer=setTimeout(()=>{deadline=true;processChild.kill();},LIMITS.deadlineMs);processChild.on('message',(message:unknown)=>{const m=message as {terminal?:unknown};if(m.terminal)terminal=m.terminal;else last=m;});
   for(const stream of [processChild.stdout,processChild.stderr])stream?.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>65536)processChild.kill();});
   processChild.once('error',e=>{clearTimeout(timer);reject(e);});processChild.once('exit',(code,signal)=>{clearTimeout(timer);done({mode,operation,code,signal,deadline,terminal,last});});
  });results.push(result);json(join(session,mode+'-'+operation+'.json'),result);
 }
 assert.equal(digest(readFileSync(source)),original.fileSha256,'original_fixture_changed');json(join(session,'summary.json'),{contract:'aerynth.metadata-profile@1',binding:bound,original,results,originalUnchanged:true,nativePerformanceQualified:false,limitations:['Synthetic retained clone; not fresh setup cost or realistic uncapped library.','Instrumentation excluded from timing processes.','RSS checked at boundaries, heap cap not OS quota.','No Electron/input/paint/native/provider/account measurements.']});console.log(JSON.stringify({session,results}));
}
if(resolve(process.argv[1]??'')===HERE)void main().catch(e=>{console.error(String(e));process.exitCode=1;});
