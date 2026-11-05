import type { ConversationProductPort, ConversationView, ConversationViewPosition, ConversationViewSelection, ConversationViewState } from './contracts.ts';
import { CONVERSATION_VIEW_LIMITS } from './contracts.ts';

/** A measured view, never another draft or transcript. The host lends one
 * coordinator to all full/inline views of this canonical library. */
export type ConversationViewCapture = {resourceId:string;position:ConversationViewPosition|null;selection:ConversationViewSelection|null;draftReady:boolean};
type Pending = {capture:ConversationViewCapture;signature:string;intent:number};
const version=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const errorOf=(error:unknown)=>error instanceof Error?error:new Error(String(error));

export class ConversationViewPersistence {
 private readonly port:ConversationProductPort;
 private readonly onError?: (error:Error,resourceId:string|null)=>void;
 private readonly versions=new Map<string,number>();
 private readonly pending=new Map<string,Pending>();
 private readonly signatures=new Map<string,string>();
 private readonly failures=new Map<string,Error>();
 private readonly intents=new Map<string,number>();
 private intentSerial=0;
 private work:Promise<void>|null=null;
 private active:{id:string;signature:string}|null=null;
 private selectionWork:Promise<void>|null=null;
 private selectionVersion:number|undefined;
 private selectionFailure:Error|null=null;
 private selectionIntent=0;
 constructor(options:{port:ConversationProductPort;onError?:(error:Error,resourceId:string|null)=>void}){this.port=options.port;this.onError=options.onError;}
 private notify(error:Error,id:string|null){try{this.onError?.(error,id);}catch{/* Observer failure never changes a persistence receipt. */}}
 private fail(error:Error,id:string){this.failures.set(id,error);if(this.failures.size>CONVERSATION_VIEW_LIMITS.records)this.failures.delete(this.failures.keys().next().value!);this.notify(error,id);}
 private observe(view:ConversationView){
  if(!version(view.version)||typeof view.resourceId!=='string'||!view.resourceId)throw Error('invalid_conversation_view_response');
  const old=this.versions.get(view.resourceId);if(old!==undefined&&old>view.version)return;
  if(old!==undefined&&old<view.version)this.signatures.delete(view.resourceId);
  this.versions.delete(view.resourceId);this.versions.set(view.resourceId,view.version);
  if(this.versions.size>CONVERSATION_VIEW_LIMITS.records){const id=this.versions.keys().next().value!;this.versions.delete(id);this.signatures.delete(id);}
 }
 /** Always asks current policy. Only revisions, not reusable access grants or
  * previous view payloads, are retained after this read. */
 async restore(resourceId?:string):Promise<ConversationViewState>{
  const result=await this.port.command('readViewState',resourceId===undefined?{}:{resourceId});
  if(result?.contract!=='aerynth.conversation-view@1'||!version(result.selected?.version)||result.view&&result.view.resourceId!==(resourceId??result.selected.resourceId))throw Error('invalid_conversation_view_response');
  this.selectionVersion=Math.max(this.selectionVersion??0,result.selected.version);if(result.view)this.observe(result.view);return result;
 }
 /** Shared by inline and full views. An old draft ACK is not a newer user
  * interaction just because its subscriber happens to be called last. */
 beginIntent(resourceId:string):number{
  const intent=++this.intentSerial;this.intents.delete(resourceId);this.intents.set(resourceId,intent);this.pending.delete(resourceId);
  if(this.intents.size>CONVERSATION_VIEW_LIMITS.records){const id=this.intents.keys().next().value!;this.intents.delete(id);this.pending.delete(id);}return intent;
 }
 isCurrentIntent(resourceId:string,intent:number):boolean{return this.intents.get(resourceId)===intent;}
 /** Only a coherent draft ACK may carry selection. Coalesce new native intent
  * while the prior short metadata write is in flight; no timer or retry loop. */
 remember(capture:ConversationViewCapture,intent?:number):void{
  if(!capture.draftReady)return;
  const id=capture.resourceId;if(!id||id.length>CONVERSATION_VIEW_LIMITS.idUnits)return;
  const token=intent??this.beginIntent(id);if(!this.isCurrentIntent(id,token))return;
  const signature=JSON.stringify({position:capture.position,selection:capture.selection});
  const latest=this.pending.get(id)?.signature??(this.active?.id===id?this.active.signature:this.signatures.get(id));if(latest===signature)return;
  if(!this.pending.has(id)&&this.pending.size>=128){this.fail(Error('conversation_view_capture_capacity_exceeded'),id);return;}
  this.failures.delete(id);this.pending.set(id,{capture:structuredClone(capture),signature,intent:token});this.start();
 }
 private start(){
  if(this.work||!this.pending.size)return;
  this.work=Promise.resolve().then(async()=>{
   while(this.pending.size){
    const [id,first]=this.pending.entries().next().value!;let next=first;
    try{
     if(!this.versions.has(id))await this.restore(id);
     // A newer actual input/scroll can supersede the queued capture while the
     // first canonical version read is pending. Do not send the older payload.
     const latest=this.pending.get(id);if(!latest)continue;next=latest;this.pending.delete(id);if(!this.isCurrentIntent(id,next.intent))continue;
     const expectedVersion=this.versions.get(id);if(expectedVersion===undefined)throw Error('conversation_view_unavailable');
     if(this.signatures.get(id)===next.signature)continue;
     this.active={id,signature:next.signature};const saved=await this.port.command('saveViewState',{resourceId:id,expectedVersion,position:next.capture.position,selection:next.capture.selection});
     if(saved?.resourceId!==id||saved.version!==expectedVersion+1)throw Error('invalid_conversation_view_receipt');
     this.observe(saved);if(this.versions.get(id)===saved.version)this.signatures.set(id,next.signature);this.failures.delete(id);
    }catch(reason){
     const error=errorOf(reason);this.versions.delete(id);this.signatures.delete(id);this.fail(error,id);
     // Never replay the failed candidate. A distinct, later actual capture may
     // already be queued, and will get a fresh version before its own write.
     if(this.pending.get(id)===next)this.pending.delete(id);
    }finally{this.active=null;}
   }
  }).finally(()=>{this.work=null;this.start();});
 }
 /** Explicit selection is its own CAS; inline scroll/caret never changes it. */
 select(resourceId:string|null):Promise<void>{
  const intent=++this.selectionIntent,prior=this.selectionWork,operation=(prior??Promise.resolve()).catch(()=>{}).then(async()=>{
   if(intent!==this.selectionIntent)return;
   if(this.selectionVersion===undefined)await this.restore();
   if(intent!==this.selectionIntent)return;
   const expectedVersion=this.selectionVersion;if(expectedVersion===undefined)throw Error('conversation_view_selection_unavailable');
   const saved=await this.port.command('selectView',{resourceId,expectedVersion});
   if(saved?.resourceId!==resourceId||saved.version!==expectedVersion+1)throw Error('invalid_conversation_view_selection_receipt');
   this.selectionVersion=Math.max(this.selectionVersion??0,saved.version);this.selectionFailure=null;
  }).catch(reason=>{const error=errorOf(reason);this.selectionVersion=undefined;this.selectionFailure=error;this.notify(error,resourceId);throw error;});
  this.selectionWork=operation;void operation.catch(()=>{});return operation;
 }
 async flush(resourceId?:string):Promise<void>{
  for(;;){const work=this.work,selection=this.selectionWork;await work;await selection?.catch(()=>{});if(!this.work&&selection===this.selectionWork)break;}
  if(resourceId===undefined&&this.selectionFailure)throw this.selectionFailure;const failure=resourceId===undefined?this.failures.values().next().value:this.failures.get(resourceId);if(failure)throw failure;
 }
}
