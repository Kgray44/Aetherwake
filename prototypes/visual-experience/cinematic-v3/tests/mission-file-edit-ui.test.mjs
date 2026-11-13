import test from 'node:test';
import assert from 'node:assert/strict';
import {createVelaClient} from '../src/vela-client.ts';
import {mountVelaPanel} from '../../../vela-core/src/panel.ts';
import {blockDocument} from '../../../block-library/tests/component-dom.mts';
import {until,named} from '../../../conversation-product/test/component-dom.mts';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const id='11111111-1111-4111-8111-111111111111';
test('actual isolated desktop preload refuses every M3 private RPC before IPC',async()=>{
  const {PRIVATE_MISSION_FILE_EDIT_COMMANDS}=createRequire(import.meta.url)('../native/mission-file-edit-broker.cjs');let host,calls=0;
  vm.runInNewContext(readFileSync(new URL('../native/desktop-preload.cjs',import.meta.url),'utf8'),{process:{argv:[]},navigator:{userActivation:{isActive:true}},require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(_name,value)=>{host=value;}},ipcRenderer:{invoke:async()=>{calls++;return {ok:true,result:null};}}};}});
  for(const command of PRIVATE_MISSION_FILE_EDIT_COMMANDS)await assert.rejects(host.command(command,{decision:'yes',authority:'forged'}),/unsupported_command/);
  assert.equal(calls,0);
});
test('actual Vela request bridge reaches the selected-file native API path before any legacy provider or Codex probe',async()=>{
  const {velaCommand}=createRequire(import.meta.url)('../native/vela-broker.cjs'),calls=[],ref={id:'file-1',kind:'resource',version:2,title:'source.mjs',resourceKind:'file'},result={id:'request-1'};
  const value=await velaCommand({win:{isDestroyed:()=>false,webContents:{isDestroyed:()=>false}},input:{name:'request',input:{intent:'Fix this selected file',resourceIds:['file-1'],resourceRefs:[ref],authorizeProvider:true}},routeNative:true,directMessageSend:true,
    call:async(name,input)=>{calls.push(name);assert.equal(name,'velaRouteNative');return {matched:false,apiFileEdit:true,selectedEditSource:ref};},
    missionFileEditRequest:async input=>{assert.deepEqual(input,{intent:'Fix this selected file',resourceIds:['file-1'],resourceRefs:[ref]});return result;}});
  assert.equal(value,result);assert.deepEqual(calls,['velaRouteNative']);
});

test('actual Main native review gate serializes review presentation and releases ownership after rejection',async()=>{
  const source=readFileSync(new URL('../native/desktop-main.cjs',import.meta.url),'utf8'),start=source.indexOf('let nativeReviewBusy=false;'),end=source.indexOf('const reviewProvider=',start);
  assert.ok(start>0&&end>start);
  let admitted = false;
  const gate = Function('checkDesktopTest', source.slice(start,end)+'return nativeReviewGate;')(() => {
    if (!admitted) throw Error('synthetic desktop admission denied');
  });
  await assert.rejects(gate(() => assert.fail('review opened without admission')), /synthetic desktop admission denied/);
  admitted = true;
  let release;const held=new Promise(resolve=>{release=resolve;});
  const first=gate(()=>held);await assert.rejects(gate(()=>Promise.resolve()),/native_review_busy/);release();await first;
  await assert.rejects(gate(()=>Promise.reject(Error('synthetic failed review'))),/synthetic failed review/);assert.equal(await gate(()=>Promise.resolve('ready')),'ready');
});
test('M3 client uses the public Vela broker action with only type and operation ID, and refreshes canonical state',async()=>{
  const calls=[],changed=[];const client=createVelaClient({command:async(name,input)=>{calls.push({name,input});return {id};},changed:async(...args)=>{changed.push(args);},observed:()=>{}});
  await client.missionFileEdit({type:'apply',operationId:id});await client.missionFileEdit({type:'verify',operationId:id});
  assert.deepEqual(calls,[{name:'vela',input:{name:'missionFileEdit',input:{type:'apply',operationId:id}}},{name:'vela',input:{name:'missionFileEdit',input:{type:'verify',operationId:id}}}]);
  assert.equal(changed.length,2);assert.ok(!JSON.stringify(calls).includes('Native'));
});

test('actual Vela panel shows one concise review action, keeps metadata behind details, then requires a separate check and refuses unknown replay',async()=>{
  const dom=blockDocument(),restore=dom.install(),root=dom.root,proto=Object.getPrototypeOf(root);if(!Object.getOwnPropertyDescriptor(proto,'firstElementChild'))Object.defineProperty(proto,'firstElementChild',{get(){return this.children[0]??null;}});
  const time=new Date().toISOString(),context={id:'manifest-1',createdAt:time,policyVersion:'policy-1',discovered:[],included:[],omitted:[],contentBytes:0,coverage:'explicit-resources-only'};
  const request={id:'request-1',conversationId:'conversation-1',intent:'Fix selected file',state:'responded',providerId:null,createdAt:time,updatedAt:time,context,nativeResponse:{schemaVersion:1,classification:'observed'},response:{kind:'answer',messageId:'message-1',contentDigest:'a'.repeat(64)}};
  const operation={id,owner:{kind:'api-selected-file-intent',requestId:request.id},source:{resourceId:'file-1',version:1},title:'source.mjs',phase:'awaiting-native-review',patchDigest:'b'.repeat(64),verification:{state:'not-run',criterion:'reviewed-selected-node-test'},barrier:{kind:'native-patch-review',operationId:id,patchDigest:'b'.repeat(64)},updatedAt:time};
  const canonical={contract:'aerynth.vela@1',identity:{id:'system:vela',name:'Vela',role:'application-assistant'},conversation:{resourceId:'conversation-1',revision:1,messages:[{id:'message-1',requestId:request.id,role:'assistant',content:'I prepared one change. Review it before applying.',source:'vela-native',classification:'observed'}]},planner:{providerId:null,available:false,busy:false},capabilities:[],requests:[request],plans:[],receipts:[],preferences:{version:1,mode:'normal',monitoringEnabled:false,delegationEnabled:false,allowedEventTypes:[],minimumSeverity:'warning',maxInterruptionsPerHour:0,source:'default',updatedAt:time,learning:'disabled'},attention:[],lastPresenceAt:null,coverage:'authorized-app-events-only',missionFileEdits:[operation]};
  const calls=[],unused=async()=>{throw Error('unexpected panel command');};
  const client={state:async()=>canonical,open:async()=>canonical,request:unused,search:unused,native:unused,review:unused,apply:unused,cancel:unused,preferences:unused,reviewAttention:unused,missionFileEdit:async input=>{calls.push(input);operation.phase='applied';operation.verification.state='not-run';operation.barrier=null;return operation;}};
  let panel;try{panel=mountVelaPanel(root,client);await until(()=>!!named(root,'Review change'));
    assert.equal(root.querySelectorAll('button').filter(node=>node.textContent==='Review change').length,1);assert.equal(named(root,'Review required test'),undefined);
    const details=root.querySelectorAll('pre').find(node=>node.textContent.includes('patchDigest'));assert.ok(details);let hidden=false;for(let node=details;node;node=node.parentElement)if(node.hidden)hidden=true;assert.equal(hidden,true,'operation metadata remains behind the shared details control');
    named(root,'Review change').fire('click');await until(()=>!!named(root,'Review required test'));assert.deepEqual(calls,[{type:'apply',operationId:id}]);
    operation.verification={...operation.verification,state:'unknown',reason:'check-outcome-unconfirmed'};await panel.refresh();assert.equal(named(root,'Review change'),undefined);assert.equal(named(root,'Review required test'),undefined);
  }finally{panel?.dispose();restore();}
});
