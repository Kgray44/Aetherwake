'use strict';
const {randomUUID,createHash}=require('node:crypto');
const {createMissionFileEditBroker}=require('./mission-file-edit-broker.cjs');
const {startReviewedMission}=require('./mission-start-broker.cjs');
const {velaCommand}=require('./vela-broker.cjs');
const {safeHostOperationView}=require('./host-operation-view.cjs');
const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
/** Reuses source owners' review/apply paths. The canonical claim grants no owner authority. */
async function reviewVelaOwner({binding,win,event,localURL,call,dialog,storage,canAct,reviewGate,runtime,nodeExecutable}){
 if(binding?.contract!=='aerynth.vela.owner-review@1'||!['application-plan','selected-file-edit','codex-inspection','specialist-mission'].includes(binding.owner)||
   !binding.ownerRef||typeof binding.ownerRef.id!=='string'||!hex(binding.ownerRef.digest)||!hex(binding.operationDigest))throw Error('invalid_owner_review');
 let identityDigest=binding.ownerRef.digest,claim=null,declined=false;
 const authorizeEffect=async(name,input)=>{
   if(claim)throw Error('host_operation_already_dispatched');
   if(!await canAct(binding))throw Error('host_operation_scope_changed');
   const approvalDigest=sha({operationDigest:binding.operationDigest,owner:binding.owner,ownerRef:binding.ownerRef,name,inputDigest:sha(input)});
   const next=await call('hostOperationDispatchNative',{binding,identityDigest,approvalDigest});
   if(!next||next.operationId!==binding.operationId||next.operationDigest!==binding.operationDigest||next.identityDigest!==identityDigest||next.approvalDigest!==approvalDigest||typeof next.claimId!=='string')throw Error('invalid_host_operation_claim');
   claim=next;
   if(!await canAct(binding))throw Error('host_operation_scope_changed');
 };
 const guardedCall=async(name,input)=>{
   if(['missionFileEditApplyNative','missionFileEditCheckRunNative'].includes(name)){
     if(input?.operationId!==binding.ownerRef.id)throw Error('owner_review_changed');
     await authorizeEffect(name,input);
   }
   return call(name,input);
 };
 let error;
 try{
   if(!await canAct(binding))throw Error('host_operation_scope_changed');
   if(binding.owner==='selected-file-edit'){
     if(!['apply','verify'].includes(binding.ownerRef.action))throw Error('invalid_owner_review');
     const broker=createMissionFileEditBroker({win,trustedDocumentUrl:localURL,call:guardedCall,runtime,nodeExecutable,reviewGate});
     await broker.command(event,{type:binding.ownerRef.action,operationId:binding.ownerRef.id});
   }else if(binding.owner==='specialist-mission'){
     const input={name:'start',input:{objective:binding.ownerRef.objective,proposalId:binding.ownerRef.id,fingerprint:binding.ownerRef.digest,requestId:binding.ownerRef.id}};
     await startReviewedMission({win,event,localURL,storage,call,dialog,input,beforeStart:()=>authorizeEffect('missionStartReviewed',input.input)});
   }else if(binding.owner==='application-plan'){
     const state=await call('vela',{name:'state',input:{}}),plan=state.plans?.find(p=>p.id===binding.ownerRef.id&&p.fingerprint===binding.ownerRef.digest&&p.requestId===binding.requestId&&p.state==='prepared');
     if(!plan)throw Error('owner_review_changed');
     const labels=plan.steps.map(step=>state.capabilities?.find(cap=>cap.id===step.action.type)?.label||step.action.type);
     const choice=await dialog.showMessageBox(win,{type:'question',title:'Vela',message:plan.summary,
       detail:labels.join('\n')+(plan.targets?.length?'\n\n'+plan.targets.map(target=>target.title).join('\n'):''),
       buttons:['Cancel','Apply these changes'],defaultId:0,cancelId:0,noLink:true});
     if(choice.response!==1)declined=true;
     else{
       if(!await canAct(binding))throw Error('host_operation_scope_changed');
       await velaCommand({win,dialog,call,input:{name:'review',input:{planId:plan.id,fingerprint:plan.fingerprint,decision:'approve'}}});
       await authorizeEffect('vela.apply',{planId:plan.id,fingerprint:plan.fingerprint});
       await velaCommand({win,dialog,call,input:{name:'apply',input:plan.id}});
     }
   }else if(binding.owner==='codex-inspection'){
     if(!binding.ownerRef.directory){
       const selected=await dialog.showOpenDialog(win,{title:'Choose the repository for Vela to inspect',properties:['openDirectory']});
       if(selected.canceled||selected.filePaths?.length!==1)declined=true;
       else{
         if(!await canAct(binding))throw Error('host_operation_scope_changed');
         const next=await call('hostOperationReviewNative',{operationId:binding.operationId,selection:{kind:'codex-directory',directory:selected.filePaths[0]}});
         if(next?.contract!==binding.contract||next.operationId!==binding.operationId||next.requestId!==binding.requestId||next.workflowId!==binding.workflowId||next.owner!==binding.owner||next.ownerRef?.id!==binding.ownerRef.id||!hex(next.ownerRef.digest)||typeof next.ownerRef.directory!=='string')throw Error('owner_review_changed');
         binding=next;identityDigest=next.ownerRef.digest;
       }
     }
     if(!declined){
       if(!await canAct(binding))throw Error('host_operation_scope_changed');
       const choice=await dialog.showMessageBox(win,{type:'question',title:'Vela',message:'Check access to this repository?',
         detail:`${binding.ownerRef.directory}\n\nVela requires an enforced repository read boundary. This checks whether that capability is available. It grants no file writes, shell commands or unrestricted computer access. No Codex request is sent if that boundary is unavailable.`,
         buttons:['Cancel','Check access'],defaultId:0,cancelId:0,noLink:true});
       if(choice.response!==1)declined=true;
       else await authorizeEffect('codex.inspect',{directory:binding.ownerRef.directory});
     }
   }else throw Error('owner_review_surface_required');
 }catch(e){error=e;}
 if(error&&!claim)throw error;
 if(!claim){
   const state=await call('vela',{name:'state',input:{}});
   return safeHostOperationView(state.hostOperations?.find(operation=>operation.id===binding.operationId&&operation.requestId===binding.requestId&&operation.workflowId===binding.workflowId));
 }
 const receipt={contract:'aerynth.vela.owner-receipt@1',id:randomUUID(),operationId:binding.operationId,operationDigest:binding.operationDigest,
   owner:binding.owner,ownerReceiptRef:{id:binding.ownerRef.id,digest:binding.ownerRef.digest},
   claimId:claim?.claimId??null,identityDigest:claim?.identityDigest??null,approvalDigest:claim?.approvalDigest??null,
   state:error?'unknown':declined?'denied':claim?'observed':'no-op'};
 return safeHostOperationView(await call('hostOperationResultNative',{binding,receipt}));
}
module.exports={reviewVelaOwner};
