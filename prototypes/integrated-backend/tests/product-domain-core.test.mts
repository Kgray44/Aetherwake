import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,relative,isAbsolute } from 'node:path';
import { BackendCore } from '../src/core.mts';
import type { AgentMutationReceipt,AgentProfile } from '../../agent-product/contracts.ts';
import type { ChecklistDocument,ChecklistMutationResult } from '../../application-contract/checklist.ts';
import type { StreamEvent } from '../src/contracts.mts';

function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'aerynth-domain-core-')),path=join(dir,'canonical.sqlite'),events:StreamEvent[]=[];
  let core=new BackendCore({path,provider:'fixture',contentPolicy:'synthetic-only'},event=>events.push(event));
  return {get core(){return core;},get owner(){return core as any;},events,
    async reopen(){await core.command('close',{});core=new BackendCore({path,provider:'fixture',contentPolicy:'synthetic-only'},event=>events.push(event));},
    async close(){await core.command('close',{});const target=resolve(dir),part=relative(resolve(tmpdir()),target);assert(part.startsWith('aerynth-domain-core-')&&!part.startsWith('..')&&!isAbsolute(part));rmSync(target,{recursive:true,force:true});},
  };
}
const counts=(f:ReturnType<typeof fixture>)=>Object.fromEntries(['resources','notes','workspaces','blocks'].map(table=>[table,Number(f.owner.db.prepare('SELECT count(*) n FROM '+table).get().n)]));

test('real Core commands preserve standalone agent identity, versions, archive restoration and native event provenance across restart',async()=>{
  const f=fixture();try{
    const page=await f.core.command('agents',{name:'list',input:{}});assert.deepEqual((page.result as any).items,[]);
    assert.equal(f.owner.db.prepare("SELECT 1 FROM sqlite_master WHERE name='agent_product_schema'").get(),undefined,'metadata-only empty read must not initialize domain storage');
    const templates=(await f.core.command('agents',{name:'templates',input:{}})).result as any[];assert.equal(templates.length,8);
    const before=counts(f),input={commandId:'synthetic-agent-create',title:'Synthetic Researcher',projectId:null,profile:templates.find(t=>t.id==='researcher').profile};
    const created=(await f.core.command('agents',{name:'create',input})).result as AgentMutationReceipt;
    assert.deepEqual(counts(f),{...before,resources:before.resources+1});
    const original=(await f.core.command('agents',{name:'inspect',input:{resourceId:created.agent.resourceId}})).result as AgentProfile;
    const effective=(await f.core.command('agents',{name:'effective',input:{agent:original.ref}})).result as any;
    assert.equal(effective.configurationState,'needs-setup');assert.equal(effective.settings.providerId,null);assert.equal(effective.verification,'catalog-only');
    assert.deepEqual((await f.core.command('agents',{name:'catalog',input:{}})).result,{revision:'aerynth.provider-observations:unobserved',providers:[]});
    assert.deepEqual((await f.core.command('agents',{name:'create',input})).result,created);
    const profile=structuredClone(original.profile);profile.purpose='Synthetic bounded review role';profile.settings.additionalInstructions={source:'override',value:'Synthetic configuration, no execution authorized.'};
    const changed=(await f.core.command('agents',{name:'update',input:{commandId:'synthetic-agent-edit',agent:original.ref,title:original.resource.title,profile}})).result as AgentMutationReceipt;
    assert.equal(changed.agent.profileVersion,original.ref.profileVersion+1);assert.equal(changed.agent.resourceVersion,original.ref.resourceVersion+1);
    const event=f.events.find(e=>e.type==='agent.changed')!;assert.equal(event.providerId,'aerynth-native');assert.equal(event.resourceId,original.resource.id);assert.equal(event.executionId,null);assert.equal(event.threadId,null);assert.equal(event.payload.application!.resourceVersion,changed.agent.resourceVersion);assert(!JSON.stringify(event).includes(profile.purpose));
    const archived=(await f.core.command('agents',{name:'archive',input:{commandId:'synthetic-agent-archive',agent:changed.agent,archived:true}})).result as AgentMutationReceipt;
    const listed=(await f.core.command('agents',{name:'list',input:{includeArchived:true}})).result as any;
    assert.equal(listed.items[0].resource.id,original.resource.id);assert.equal(listed.items[0].resource.state,'archived');assert.equal(listed.items[0].profile,undefined);
    assert.equal((await f.core.command('openResource',{resourceId:original.resource.id})).status,'unavailable');
    await f.core.command('agents',{name:'archive',input:{commandId:'synthetic-agent-restore',agent:archived.agent,archived:false}});
    const expected=(await f.core.command('agents',{name:'inspect',input:{resourceId:original.resource.id}})).result;
    const opened=await f.core.command('openResource',{resourceId:original.resource.id});assert.equal(opened.status,'ready');if(opened.status==='ready')assert.deepEqual(opened.presentation,{kind:'agent',mode:'direct'});
    const w=await f.core.command('workspace',{title:'Synthetic explicit workspace'});
    await f.core.command('desktop',{type:'attach',resourceId:original.resource.id,workspaceId:w.id});
    const placement=f.owner.db.prepare('SELECT * FROM blocks WHERE resource_id=?').get(original.resource.id);assert.equal(placement.width,400);assert.equal(placement.height,460);
    await f.core.command('desktop',{type:'detach',blockId:placement.id,expectedVersion:placement.version});
    assert.deepEqual((await f.core.command('agents',{name:'inspect',input:{resourceId:original.resource.id}})).result,expected);
    await f.reopen();assert.deepEqual((await f.core.command('agents',{name:'inspect',input:{resourceId:original.resource.id}})).result,expected);
    assert.deepEqual(await f.core.command('providerActivity',{}),{codexConnections:0,providerRequests:0,systemMemoryReads:0,scope:'process-session-native-attempts'});
  }finally{await f.close();}
});

test('real Core creates and edits a conversation-linked checklist without a workspace, Note or provider execution and restores exact state',async()=>{
  const f=fixture();try{
    const conversation=await f.core.command('conversation',{name:'create',input:{commandId:'synthetic-chat-create',title:'Synthetic checklist source',providerId:'local'}}) as {resourceId:string};
    const before=counts(f),created=(await f.core.command('checklists',{name:'create',input:{commandId:'synthetic-checklist-create',title:'Synthetic reviewed steps',conversationId:conversation.resourceId}})).result as ChecklistMutationResult;
    assert.deepEqual(counts(f),{...before,resources:before.resources+1});
    const change={commandId:'synthetic-checklist-add',resourceId:created.resourceId,expectedVersion:created.version,operations:[{type:'addEntry' as const,key:'first',entry:{text:'Synthetic manually approved step'}}]};
    const added=(await f.core.command('checklists',{name:'mutate',input:change})).result as ChecklistMutationResult;
    assert.deepEqual((await f.core.command('checklists',{name:'mutate',input:change})).result,added);
    await f.core.command('checklists',{name:'mutate',input:{commandId:'synthetic-checklist-check',resourceId:created.resourceId,expectedVersion:added.version,operations:[{type:'setChecked',entryId:added.createdIds.first,checked:true}]}});
    const expected=(await f.core.command('checklists',{name:'read',input:{resourceId:created.resourceId}})).result as ChecklistDocument;
    assert.equal(expected.references[0].target?.kind,'conversation');assert.equal(expected.entries[0].completion!.basis,'manual');assert.equal(expected.entries[0].completion!.actor.kind,'user');assert.equal(expected.syncPolicy,'manual');
    const opened=await f.core.command('openResource',{resourceId:created.resourceId});assert.equal(opened.status,'ready');if(opened.status==='ready')assert.equal(opened.resource.kind,'checklist');
    for(const event of f.events.filter(e=>e.type.startsWith('checklist.'))){assert.equal(event.resourceId,created.resourceId);assert.equal(event.executionId,null);assert.equal(event.providerId,'aerynth-native');assert(!JSON.stringify(event).includes('Synthetic manually approved step'));}
    await f.reopen();assert.deepEqual((await f.core.command('checklists',{name:'read',input:{resourceId:created.resourceId}})).result,expected);assert.equal(counts(f).workspaces,0);assert.equal(counts(f).notes,0);
    assert.equal((await f.core.command('providerActivity',{})).providerRequests,0);
  }finally{await f.close();}
});

test('outer Core persistence failure rolls domain schema/resource/receipt/events back and a same-command retry remains valid',async()=>{
  const f=fixture();try{
    const before=counts(f),start=f.events.length,save=f.owner.save;
    f.owner.save=()=>{throw Error('synthetic final Core persistence failure');};
    const request={name:'create' as const,input:{commandId:'synthetic-checklist-rollback',title:'Synthetic rollback checklist'}};
    await assert.rejects(f.core.command('checklists',request),/synthetic final Core persistence failure/);f.owner.save=save;
    assert.deepEqual(counts(f),before);assert.equal(f.events.length,start);assert.equal(f.owner.db.prepare("SELECT 1 FROM sqlite_master WHERE name='checklist_schema'").get(),undefined);
    const result=(await f.core.command('checklists',request)).result as ChecklistMutationResult;
    assert.equal(((await f.core.command('checklists',{name:'read',input:{resourceId:result.resourceId}})).result as ChecklistDocument).resource.id,result.resourceId);
    assert.equal(f.events.filter(e=>e.type==='checklist.created').length,1);
  }finally{await f.close();}
});

test('real library Checklist creation and multi-workspace attachment preserve one generic identity and retain entries after detaching',async()=>{
  const f=fixture();try{
    let desktop=await f.core.command('desktop',{type:'createWorkspace',title:'Synthetic Checklist workspace A',projectId:null});
    const first=desktop.activeWorkspaceId!;
    const created=(await f.core.command('library',{name:'createBlock',input:{commandId:'synthetic-library-checklist',workspaceId:first,expectedLayoutVersion:desktop.layoutVersion,kind:'checklist',title:'Synthetic shared steps'}})).result as any;
    const row=f.owner.db.prepare('SELECT kind FROM resources WHERE id=?').get(created.resourceId);assert.equal(row.kind,'generic');assert.equal(counts(f).notes,0);
    const document=(await f.core.command('checklists',{name:'read',input:{resourceId:created.resourceId}})).result as ChecklistDocument;
    await f.core.command('checklists',{name:'mutate',input:{commandId:'synthetic-shared-add',resourceId:created.resourceId,expectedVersion:document.resource.version,operations:[{type:'addEntry',key:'first',entry:{text:'Synthetic retained manual step'}}]}});
    const expected=(await f.core.command('checklists',{name:'read',input:{resourceId:created.resourceId}})).result as ChecklistDocument;
    desktop=await f.core.command('desktop',{type:'createWorkspace',title:'Synthetic Checklist workspace B',projectId:null});
    const second=desktop.activeWorkspaceId!;
    await f.core.command('library',{name:'attachBlock',input:{commandId:'synthetic-library-checklist-attach',workspaceId:second,expectedLayoutVersion:desktop.layoutVersion,resourceId:created.resourceId,expectedResourceVersion:expected.resource.version,kind:'checklist'}});
    const placements=f.owner.db.prepare('SELECT * FROM blocks WHERE resource_id=? ORDER BY id').all(created.resourceId);assert.equal(placements.length,2);assert(placements.every((p:any)=>p.width===460&&p.height===500));
    const original=placements.find((p:any)=>p.workspace_id===first);await f.core.command('desktop',{type:'detach',blockId:original.id,expectedVersion:original.version});
    assert.deepEqual((await f.core.command('checklists',{name:'read',input:{resourceId:created.resourceId}})).result,expected);
    assert.equal(f.owner.db.prepare('SELECT count(*) n FROM blocks WHERE resource_id=?').get(created.resourceId).n,1);
    await f.reopen();assert.deepEqual((await f.core.command('checklists',{name:'read',input:{resourceId:created.resourceId}})).result,expected);assert.equal(counts(f).notes,0);
  }finally{await f.close();}
});
