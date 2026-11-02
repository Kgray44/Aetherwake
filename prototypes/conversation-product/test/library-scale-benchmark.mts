/**
 * Opt-in, HEAD-bound synthetic canonical-library benchmark. Not a test glob,
 * provider qualification, Electron input/paint measurement or user-data tool.
 * Commit this file and the released canonical read API before running:
 *   node test/library-scale-benchmark.mts --candidate=<HEAD> --datasets=small
 * --describe is read-only. No npm installs, external providers or GUI are used.
 */
import assert from 'node:assert/strict';
import { fork, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { BackendCore } from '../../integrated-backend/src/core.mts';
import type { ProviderPort, ConversationProductRequest } from '../../integrated-backend/src/contracts.mts';
import type { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import type { ConversationGraph, GraphData } from '../../connected-conversations/src/graph.ts';
import type { ConversationProduct, CanonicalConversationHost } from '../src/service.mts';

const MiB=1024*1024,DISK_BOUND=64*MiB,DB_BOUND=15*MiB,STATE_BOUND=6*MiB;
const OUTPUT_BOUND=256*1024,MAX_DATASET_MS=90_000,SLOW_SAMPLE_MS=2_000,RSS_CHECKPOINT_BOUND=256*MiB;
// Keep the V8 heap below the separate RSS admission ceiling. These are not
// explicit collections and do not turn RSS checkpoints into an OS quota.
const WORKER_HEAP_FLAGS=['--max-old-space-size=128','--max-semi-space-size=8'];
const HERE=fileURLToPath(import.meta.url),REPO=resolve(dirname(HERE),'../../..');
const OUTPUT_ROOT=join(REPO,'prototypes/visual-experience/cinematic-v3/.runtime/application-evidence');
const SOURCE_FILES=[
 'prototypes/conversation-product/test/library-scale-benchmark.mts','prototypes/conversation-product/src/contracts.ts',
 'prototypes/conversation-product/src/service.mts','prototypes/conversation-product/src/canonical-host.mts',
 'prototypes/integrated-backend/src/core.mts','prototypes/integrated-backend/src/desktop.mts',
 'prototypes/connected-conversations/src/graph.ts','prototypes/workspace-kernel/kernel.mts',
];
const DATASETS={small:{conversations:100,messages:2000},medium:{conversations:500,messages:8000},large:{conversations:1000,messages:12000}} as const;
type Dataset=keyof typeof DATASETS;
type Entry={resourceId:string;graphId:string;title:string;projectId:string;createdAt:string;lastActivityAt:string;messageIds:string[];archived:boolean};
type FixtureOwner={db:DatabaseSync;kernel:WorkspaceKernel;graph:ConversationGraph;port:ProviderPort;conversations:ConversationProduct;
 state:{graph:GraphData;resources:Record<string,string>;revisions:Record<string,number>;[key:string]:unknown};
 atomic<T>(work:()=>T):T;save():void};
type ReadRequest=Extract<ConversationProductRequest,{name:'list'|'search'|'detail'|'collections'}>;
type Operation=ReadRequest&{id:string;check(value:unknown):void};
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const jsonBytes=(value:unknown)=>Buffer.byteLength(JSON.stringify(value));
const digestIds=(ids:string[])=>hash(JSON.stringify([...ids].sort()));
const serializeError=(error:unknown)=>({name:error instanceof Error?error.name:'Error',message:String(error instanceof Error?error.message:error).slice(0,500)});
const parsed=new Map(process.argv.slice(2).map(arg=>{assert(arg.startsWith('--'),'invalid_argument');const n=arg.indexOf('=');return n<0?[arg.slice(2),'true']:[arg.slice(2,n),arg.slice(n+1)];}));
const git=(...args:string[])=>execFileSync('git',args,{cwd:REPO,encoding:'utf8',windowsHide:true,maxBuffer:2*MiB}).trim();
function directoryBytes(root:string):number{let count=0,total=0;const visit=(dir:string)=>{for(const e of readdirSync(dir,{withFileTypes:true})){assert(++count<=256,'fixture_file_bound');const p=join(dir,e.name);if(e.isDirectory())visit(p);else{assert(e.isFile()&&!e.isSymbolicLink(),'unexpected_fixture_entry');total+=statSync(p).size;}}};visit(root);return total;}
function writeReceipt(file:string,value:unknown){const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');assert(bytes.length<=OUTPUT_BOUND,'receipt_capacity');writeFileSync(file,bytes,{flag:'wx'});}
function sourceBinding(candidate:string){
 assert(/^[a-f0-9]{40}$/.test(candidate)&&git('rev-parse','HEAD')===candidate,'candidate_changed');
 assert.equal(git('status','--porcelain'),'','source_dirty');
 const hashes=Object.fromEntries(SOURCE_FILES.map(file=>{git('ls-files','--error-unmatch',file);return [file,hash(readFileSync(join(REPO,file)))];}));
 return {candidate,tree:git('rev-parse','HEAD^{tree}'),hashes,node:process.version,platform:process.platform,arch:process.arch};
}
function readApiReleased(){
 const service=readFileSync(join(REPO,'prototypes/conversation-product/src/service.mts'),'utf8');
 const core=readFileSync(join(REPO,'prototypes/integrated-backend/src/core.mts'),'utf8');
 assert(service.includes('canonicalReadView')&&core.includes('canonicalReadView'),'released_canonical_read_view_required');
}
function guard(){
 assert(process.platform==='win32'&&process.env.LOCALAPPDATA,'windows_reserve_guard_required');
 const file=join(process.env.LOCALAPPDATA,'AeroStorageWatch','ReserveGuard.ps1');
 const result=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-File',file,'-EstimatedCBytes',String(DISK_BOUND),'-EstimatedDBytes','0'],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:65536}));
 assert(result.allowed===true,'storage_reserve_denied');return result;
}
function fixtureFence(session:string,profile:string,started:number){
 const part=relative(session,profile);assert(part&&!isAbsolute(part)&&!part.startsWith('..'),'fixture_outside_owned_session');
 assert(performance.now()-started<MAX_DATASET_MS,'dataset_deadline');
 assert(directoryBytes(session)<=DISK_BOUND,'owned_disk_envelope');
 assert(process.memoryUsage().rss<=RSS_CHECKPOINT_BOUND,'sampled_rss_admission_exceeded');
}
function page(value:unknown):{items:Record<string,unknown>[];total?:number}{
 assert(value&&typeof value==='object'&&Array.isArray((value as {items?:unknown}).items),'unexpected_page_shape');
 return value as {items:Record<string,unknown>[];total?:number};
}

async function worker(dataset:Dataset,session:string,candidate:string){
 const started=performance.now(),binding=sourceBinding(candidate);readApiReleased();
 const custody=relative(OUTPUT_ROOT,resolve(session));assert(custody&&!isAbsolute(custody)&&!custody.startsWith('..')&&/^library-scale-\d+-[a-f0-9]{8}$/.test(custody),'unowned_session_location');
 const marker=JSON.parse(readFileSync(join(session,'owner.json'),'utf8'));
 assert(marker.contract==='aerynth.library-scale-owner@1'&&marker.candidate===candidate,'unowned_session');
 const profile=join(session,dataset);assert(!readdirSync(session).includes(dataset),'fresh_profile_required');mkdirSync(profile);
 const file=join(profile,'canonical.sqlite'),requested=DATASETS[dataset];let core:BackendCore|undefined,providerCalls=0;
 const receipt:Record<string,unknown>={contract:'aerynth.library-scale@1',synthetic:true,binding,dataset:{name:dataset,requested},passed:false,
  tiers:{structural:'instrumented canonical reads; excluded from timing',timing:'in-process Core/conversation service only; excludes Electron/IPC/render/presentation'},
  bounds:{ownedDiskBytes:DISK_BOUND,databaseBytes:DB_BOUND,canonicalStateBytes:STATE_BOUND,deadlineMs:MAX_DATASET_MS,sampledRssBytes:RSS_CHECKPOINT_BOUND,workerHeapFlags:WORKER_HEAP_FLAGS},
  limitations:['Fresh synthetic local messages, not model output or account history.','Old-heap flag and RSS checkpoints are not an OS total-memory quota.','Counts/data sizes and work are measured separately from timing.','No native input/paint/presentation latency, accessibility or artistic acceptance.']};
 try{
  core=new BackendCore({path:file,privateRoot:profile,contentPolicy:'synthetic-only',provider:'fixture'});
  const owner=core as unknown as FixtureOwner,db=owner.db;
  assert.equal(db.prepare('PRAGMA journal_mode').get()!.journal_mode,'delete');
  db.exec('PRAGMA max_page_count='+Math.floor(DB_BOUND/Number(db.prepare('PRAGMA page_size').get()!.page_size)));
  for(const name of ['connect','capabilities','open','resume','read','items','turn','terminal','interrupt'] as const)
   (owner.port as unknown as Record<string,unknown>)[name]=async()=>{providerCalls++;throw Error('provider_forbidden_in_local_scale_fixture');};
  const originalSave=owner.save.bind(owner);
  owner.save=()=>{assert(jsonBytes({...owner.state,graph:owner.graph.snapshot()})<=STATE_BOUND,'synthetic_state_capacity');originalSave();};
  const entries:Entry[]=[],projects:string[]=[],rareMarker='SYNTHETIC_RARE_LIBRARY_TOKEN',rootMessages=Math.min(1000,Math.floor(requested.messages/4));
  owner.atomic(()=>{for(let i=0;i<4;i++)projects.push(String(owner.kernel.createProject('Synthetic benchmark project '+i).id));});
  let seededMessages=0,capped=false;
  for(let start=0;start<requested.conversations;start+=20){
   fixtureFence(session,profile,started);const pending:Entry[]=[];
   try{owner.atomic(()=>{for(let i=start;i<Math.min(start+20,requested.conversations);i++){
    const projectId=projects[i%projects.length],title=i%9===0?'Synthetic duplicate title':'Synthetic conversation '+String(i).padStart(4,'0');
    const resource=owner.kernel.createConversationRef(title,projectId),conversation=owner.graph.createChat('ordinary','local',title);
    owner.state.resources[resource.id]=conversation.id;owner.state.revisions[resource.id]=1;
    const remaining=requested.messages-rootMessages,count=i===0?rootMessages:Math.floor(remaining/(requested.conversations-1))+(i-1<remaining%(requested.conversations-1)?1:0),messageIds:string[]=[];
    let lastActivityAt=conversation.createdAt;
    for(let n=0;n<count;n++){
     const size=n===0&&i%31===0?4096:128,token=i===2&&n===0?rareMarker:n%13===0?'SYNTHETIC_UNICODE_星_é':'synthetic common library';
     const body=('Synthetic local message '+i+'/'+n+' '+token+' ').padEnd(size,'x');
     const message=owner.graph.addMessage(conversation.id,'user',body,{provenance:'user'});messageIds.push(message.id);lastActivityAt=message.createdAt;owner.state.revisions[resource.id]++;
    }
    const archived=i>0&&i!==2&&i%19===0;if(archived)owner.kernel.setResourceArchived(resource.id,true,resource.version);
    pending.push({resourceId:resource.id,graphId:conversation.id,title,projectId,createdAt:conversation.createdAt,lastActivityAt,messageIds,archived});
   }});entries.push(...pending);seededMessages+=pending.reduce((n,e)=>n+e.messageIds.length,0);}
   catch(error){if(String(error).includes('synthetic_state_capacity')||String(error).includes('database or disk is full')){capped=true;break;}throw error;}
  }
  assert(entries.length>=3,'insufficient_fixture');
  const notes:string[]=[];let noteBytes=0;const noteMarker='SYNTHETIC_NOTE_RESOURCE_TOKEN';
  owner.atomic(()=>{for(let i=0;i<8;i++){const body=(noteMarker+' Synthetic local note '+i+' ').padEnd(2048,'n');noteBytes+=Buffer.byteLength(body);assert(noteBytes<=2*MiB);notes.push(owner.kernel.createNote('Synthetic note '+i,body,projects[i%4]).id);}});
  const fanout:Entry[]=[],chain:Entry[]=[];
  const makeBranch=async(parent:Entry,anchor:string,label:string)=>{
   fixtureFence(session,profile,started);
   const result=await core!.command('branch',{resourceId:parent.resourceId,messageId:anchor,includeMessageIds:[anchor],providerId:'local',title:'Synthetic '+label,tokenBudget:32768,commandId:randomUUID()});
   const resourceId=result.conversation.resourceId,graphId=owner.state.resources[resourceId],graphConversation=owner.graph.snapshot().conversations.find(c=>c.id===graphId)!;
   const record:Entry={resourceId,graphId,title:graphConversation.title,projectId:parent.projectId,createdAt:graphConversation.createdAt,lastActivityAt:graphConversation.createdAt,messageIds:[],archived:false};entries.push(record);
   let accepted:{id:string;createdAt:string}|undefined;
   owner.atomic(()=>{accepted=owner.graph.addMessage(graphId,'user','Synthetic local branch message '+label,{provenance:'user'});owner.state.revisions[resourceId]++;});
   assert(accepted);record.messageIds.push(accepted.id);record.lastActivityAt=accepted.createdAt;return record;
  };
  try{
   for(let i=0;i<8;i++)fanout.push(await makeBranch(entries[3],entries[3].messageIds[0],'fanout '+i));
   let parent=entries[0],anchor=parent.messageIds[Math.floor(parent.messageIds.length/2)];
   for(let i=0;i<64;i++){const child=await makeBranch(parent,anchor,'chain '+i);chain.push(child);parent=child;anchor=child.messageIds[0];}
  }catch(error){if(String(error).includes('synthetic_state_capacity'))capped=true;else throw error;}
  // Use the actual product's injected policy boundary, exactly as canonical
  // permission fixtures do. This only DENIES the synthetic parent; no authority
  // is granted and no real user's policy/provider/account is involved.
  const denied=new Set([entries[3].resourceId]),host=(owner.conversations as unknown as {host:CanonicalConversationHost}).host,originalAccess=host.access;
  host.access=(id,messageId)=>!denied.has(id)&&originalAccess?.(id,messageId)!==false;
  // Canonical source revocation also applies to every inherited reference.
  owner.atomic(()=>{owner.graph.markUnavailable(entries[0].messageIds[1]);owner.graph.markUnavailable(entries[0].messageIds.at(-1)!);});
  const manual=owner.kernel.createCollection('Synthetic manual collection',projects[1]),smart=owner.kernel.createCollection('Synthetic smart collection',null),nested=owner.kernel.createCollection('Synthetic nested collection',projects[1]);
  const pinned=entries.filter(e=>!e.archived&&!denied.has(e.resourceId)&&e.projectId===projects[1]).slice(0,8);
  owner.kernel.withTransaction(()=>{for(const entry of pinned)owner.kernel.addToCollection(manual.id,entry.resourceId);});
  await core.command('conversation',{name:'collectionRule',input:{collectionId:smart.id,parentId:null,rule:{text:rareMarker},expectedVersion:smart.version,expectedRuleRevision:0}});
  await core.command('conversation',{name:'collectionRule',input:{collectionId:nested.id,parentId:manual.id,rule:null,expectedVersion:nested.version,expectedRuleRevision:0}});
  const favoriteIds=entries.filter(e=>!e.archived&&!denied.has(e.resourceId)).slice(0,5).map(e=>e.resourceId);
  for(const resourceId of favoriteIds)await core.command('conversation',{name:'favorite',input:{resourceId,favorite:true}});
  const stateBytes=jsonBytes(owner.state),graph=owner.graph.snapshot();
  assert.equal(entries.length,graph.conversations.length,'fixture_identity_count_mismatch');
  receipt.dataset={name:dataset,requested,actual:{conversations:entries.length,baseOwnMessages:seededMessages,graphMessages:graph.messages.length,revokedMessages:graph.unavailableMessageIds.length,deniedSources:denied.size,fanout:fanout.length,chainDepth:chain.length,projects:projects.length,notes:notes.length,collections:3,favorites:favoriteIds.length},capped,canonicalStateBytes:stateBytes,sqliteBytes:statSync(file).size,graphBodyBytes:graph.messages.reduce((n,m)=>n+Buffer.byteLength(m.content),0),noteBodyBytes:noteBytes,fixtureIdentityDigest:digestIds(entries.map(e=>e.resourceId)),permissionFixtureDigest:digestIds([...denied])};
  const active=entries.filter(e=>!e.archived&&!denied.has(e.resourceId)),activeIds=new Set(active.map(e=>e.resourceId)),rare=entries[2],scope=projects[1];
  const invoke=async(operation:Operation)=>core!.command('conversation',{name:operation.name,input:operation.input} as ReadRequest);
  const listActivity={limit:50,sort:'activity' as const},empty={text:'',limit:50},rareSearch={text:rareMarker,searchMode:'conversations' as const,limit:50},commonSearch={text:'synthetic common library',searchMode:'conversations' as const,limit:50},scopedList={projectId:scope,sort:'title' as const,limit:50},resourceSearch={text:noteMarker,searchMode:'resources' as const,limit:50},operations:Operation[]=[
   {id:'recent-metadata',name:'list',input:listActivity,check:value=>{const p=page(value);assert.equal(p.items.length,Math.min(50,active.length));if(typeof p.total==='number')assert.equal(p.total,active.length);let previous:string|undefined;for(const row of p.items){assert(activeIds.has(String(row.resourceId)));assert(Object.hasOwn(row,'lastActivityAt'),'activity_metadata_unavailable');const at=String(row.lastActivityAt??row.createdAt);if(previous)assert(previous>=at,'activity_order_mismatch');previous=at;}}},
   {id:'empty-conversation-browse',name:'search',input:empty,check:value=>{for(const row of page(value).items){assert.equal(row.kind,'conversation');assert(activeIds.has(String(row.resourceId)));}}},
   {id:'rare-body-match',name:'search',input:rareSearch,check:value=>{assert.deepEqual([...new Set(page(value).items.map(row=>String(row.resourceId)))],[rare.resourceId]);}},
   {id:'common-body-match',name:'search',input:commonSearch,check:value=>{for(const row of page(value).items)assert(activeIds.has(String(row.resourceId)));}},
   {id:'absent-match',name:'search',input:{text:'SYNTHETIC_NEVER_PRESENT_098765',limit:50},check:value=>assert.equal(page(value).items.length,0)},
   {id:'scoped-project',name:'list',input:scopedList,check:value=>{for(const row of page(value).items)assert.equal(row.projectId,scope);}},
   {id:'manual-membership',name:'list',input:{collectionId:manual.id,limit:50},check:value=>assert.deepEqual(page(value).items.map(row=>String(row.resourceId)).sort(),pinned.map(e=>e.resourceId).sort())},
   {id:'smart-membership',name:'list',input:{collectionId:smart.id,limit:50},check:value=>assert.deepEqual(page(value).items.map(row=>String(row.resourceId)),[rare.resourceId])},
   {id:'favorites',name:'list',input:{favorite:true,limit:50},check:value=>assert.deepEqual(page(value).items.map(row=>String(row.resourceId)).sort(),[...favoriteIds].sort())},
   {id:'explicit-resource-search',name:'search',input:resourceSearch,check:value=>assert.deepEqual([...new Set(page(value).items.map(row=>String(row.resourceId)))].sort(),[...notes].sort())},
   {id:'around-long-conversation',name:'detail',input:{resourceId:entries[0].resourceId,aroundMessageId:entries[0].messageIds.at(-2),limit:50},check:value=>{assert(value&&typeof value==='object');const detail=value as {messages:{items:{id:string}[]}};assert(detail.messages.items.some(m=>m.id===entries[0].messageIds.at(-2)));assert(!detail.messages.items.some(m=>m.id===entries[0].messageIds.at(-1)));assert(detail.messages.items.length<=50);}},
  ];
  if(fanout.length)operations.push({id:'denied-inherited-source',name:'detail',input:{resourceId:fanout[0].resourceId,limit:50},check:value=>{const detail=value as {messages:{items:{resourceId:string;id:string}[]}};assert(detail.messages.items.every(m=>m.resourceId!==entries[3].resourceId));assert(detail.messages.items.some(m=>m.id===fanout[0].messageIds[0]));}});
  if(chain.length)operations.push({id:'deep-chain-detail',name:'detail',input:{resourceId:chain.at(-1)!.resourceId,aroundMessageId:chain.at(-1)!.messageIds[0],limit:50},check:value=>{const detail=value as {messages:{items:{id:string}[]}};assert(detail.messages.items.some(m=>m.id===chain.at(-1)!.messageIds[0]));assert(!detail.messages.items.some(m=>m.id===entries[0].messageIds[1]));assert(detail.messages.items.length<=50);}});
  const observations:unknown[]=[];receipt.operations=observations;
  owner.save=originalSave;
  for(const operation of operations){
   fixtureFence(session,profile,started);
   const work={graphSnapshotCalls:0,visibleMessageCalls:0,visibleRows:0,bodyContentGetterReads:0,kernelNoteBodiesReturned:0,responseBytes:0,sqliteChanges:0,providerCalls:0};
   const originalSnapshot=owner.graph.snapshot.bind(owner.graph),originalVisible=owner.graph.visibleMessages.bind(owner.graph),restores:(()=>void)[]=[];
   const originalResource=owner.kernel.getResource.bind(owner.kernel);owner.kernel.getResource=id=>{const value=originalResource(id);if(value.note)work.kernelNoteBodiesReturned++;return value;};
   owner.graph.snapshot=()=>{work.graphSnapshotCalls++;return originalSnapshot();};
   owner.graph.visibleMessages=id=>{work.visibleMessageCalls++;const rows=originalVisible(id);work.visibleRows+=rows.length;return rows;};
   const stores=[owner.state.graph,(owner.graph as unknown as {data:GraphData}).data],seen=new Set<object>();
   for(const store of stores)for(const message of store.messages){if(seen.has(message))continue;seen.add(message);const descriptor=Object.getOwnPropertyDescriptor(message,'content')!;assert(Object.hasOwn(descriptor,'value'));Object.defineProperty(message,'content',{enumerable:descriptor.enumerable,configurable:descriptor.configurable,get(){work.bodyContentGetterReads++;return descriptor.value;}});restores.push(()=>Object.defineProperty(message,'content',descriptor));}
   const before=Number(db.prepare('SELECT total_changes() AS n').get()!.n);
   let value:unknown;
   try{value=await invoke(operation);operation.check(value);work.responseBytes=jsonBytes(value);}
   finally{restores.forEach(restore=>restore());owner.graph.snapshot=originalSnapshot;owner.graph.visibleMessages=originalVisible;owner.kernel.getResource=originalResource;}
   work.sqliteChanges=Number(db.prepare('SELECT total_changes() AS n').get()!.n)-before;work.providerCalls=providerCalls;assert.equal(work.sqliteChanges,0);assert.equal(providerCalls,0);
   const actual=operation.name==='detail'?(value as {messages:{items:{id:string}[]}}).messages.items.map(row=>row.id):page(value).items.map(row=>String(row.resourceId));
   const observation:Record<string,unknown>={id:operation.id,kind:operation.name,queryClass:operation.id,limit:50,work,instrumentationCoverage:['same canonical graph/state message content getters','graph snapshot/visibleMessages entry points','kernel.getResource note-return counter; direct SQL note reads not counted'],correctness:{passed:true,resultIdentityDigest:digestIds(actual)},timing:{tier:'in-process-Core-CP-read',warmups:0,samplesMs:[]}};observations.push(observation);
   const samples:number[]=[],timing=observation.timing as {tier:string;warmups:number;samplesMs:number[];medianMs?:number;p95Ms?:number;complete?:boolean;stopped?:string};
   for(let n=0;n<25;n++){
    fixtureFence(session,profile,started);const time=performance.now(),result=await invoke(operation),elapsed=performance.now()-time;operation.check(result);
    if(n<5)timing.warmups++;else samples.push(elapsed);
    if(elapsed>SLOW_SAMPLE_MS){timing.stopped='slow_sample';break;}
   }
   timing.samplesMs=samples;timing.complete=samples.length===20;if(samples.length){const sorted=[...samples].sort((a,b)=>a-b);timing.medianMs=sorted[Math.floor((sorted.length-1)/2)];timing.p95Ms=sorted[Math.ceil(sorted.length*.95)-1];}
  }
  assert.equal(providerCalls,0);receipt.providerCalls=providerCalls;receipt.passed=true;
  receipt.timingComplete=observations.every(value=>(value as {timing:{complete?:boolean}}).timing.complete===true);receipt.presentationPerformanceQualified=false;
 }catch(error){receipt.error=serializeError(error);}
 finally{if(core)await core.command('close',{});receipt.elapsedMs=performance.now()-started;receipt.processMemory=process.memoryUsage();receipt.ownedDiskBytes=directoryBytes(session);writeReceipt(join(session,dataset+'.json'),receipt);}
 return receipt;
}

async function main(){
 const allowed=new Set(['candidate','datasets','describe','worker','session','dataset']);for(const key of parsed.keys())assert(allowed.has(key),'unknown_argument');
 if(parsed.has('describe')){console.log(JSON.stringify({contract:'aerynth.library-scale-plan@1',datasets:DATASETS,bounds:{disk:DISK_BOUND,db:DB_BOUND,state:STATE_BOUND,receipt:OUTPUT_BOUND,perDatasetMs:MAX_DATASET_MS},providerCalls:0,qualification:'No benchmark performed by --describe'}));return;}
 const candidate=parsed.get('candidate');assert(candidate,'explicit_candidate_required');
 if(parsed.has('worker')){assert(parsed.get('session')&&parsed.get('dataset'));const dataset=parsed.get('dataset') as Dataset;assert(Object.hasOwn(DATASETS,dataset));const result=await worker(dataset,parsed.get('session')!,candidate);process.exitCode=result.passed?0:1;return;}
 const names=(parsed.get('datasets')??'small').split(',') as Dataset[];assert(names.length>=1&&names.length<=3&&new Set(names).size===names.length&&names.every(n=>Object.hasOwn(DATASETS,n)),'invalid_datasets');
 const binding=sourceBinding(candidate);readApiReleased();const reserve=guard(),session=join(OUTPUT_ROOT,'library-scale-'+Date.now()+'-'+randomUUID().slice(0,8));mkdirSync(session,{recursive:true});writeReceipt(join(session,'owner.json'),{contract:'aerynth.library-scale-owner@1',candidate,binding,reserve});
 const stages:unknown[]=[];
 for(const dataset of names){
  guard();assert(directoryBytes(session)<DISK_BOUND-DB_BOUND*2-OUTPUT_BOUND,'insufficient_owned_envelope');
  const result=await new Promise<{dataset:string;code:number|null;signal:string|null;deadline:boolean}>((done,reject)=>{
   const child=fork(HERE,['--worker','--candidate='+candidate,'--session='+session,'--dataset='+dataset],{cwd:REPO,execArgv:WORKER_HEAP_FLAGS,env:{...process.env,NODE_DISABLE_COMPILE_CACHE:'1'},silent:true,windowsHide:true});let deadline=false,output=0;
   const timer=setTimeout(()=>{deadline=true;child.kill();},MAX_DATASET_MS+3000);
   for(const stream of [child.stdout,child.stderr])stream?.on('data',(data:Buffer)=>{output+=data.length;if(output>65536){deadline=true;child.kill();}});
   child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',(code,signal)=>{clearTimeout(timer);done({dataset,code,signal,deadline});});
  });stages.push(result);if(result.code!==0||result.deadline)break;
 }
 const passed=stages.length===names.length&&stages.every(stage=>(stage as {code:number|null}).code===0);writeReceipt(join(session,'summary.json'),{contract:'aerynth.library-scale-runner@1',binding,passed,stages,ownedDiskBytes:directoryBytes(session),limits:['Headless in-process only.','No real UI/account/provider activity.','Old heap is bounded; total RSS is checked at operation boundaries, not hard OS quota.','Synthetic fixture retained; never clean up another profile.']});console.log(JSON.stringify({passed,session,stages}));process.exitCode=passed?0:1;
}
if(process.argv[1]&&resolve(process.argv[1])===HERE)void main().catch(error=>{console.error(JSON.stringify({passed:false,error:serializeError(error)}));process.exitCode=1;});
