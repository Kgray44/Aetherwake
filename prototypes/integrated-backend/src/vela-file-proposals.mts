import { createHash, randomUUID } from 'node:crypto';
import { lstat, realpath, opendir } from 'node:fs/promises';
import { openSync,closeSync,fstatSync,lstatSync,realpathSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, sep } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { VelaFileProposal, VelaFileProposalCommand, VelaRequest } from '../../vela-core/src/contracts.ts';
import type {FolderBrowseResponse} from '../../application-contract/folder.ts';
import { inspectMediaSelection,mediaSourceRevision,type MediaSource } from './media-sources.mts';
import { ensure,ServiceError } from './contracts.mts';

export const LOCAL_FILE_PROPOSAL_LIMITS=Object.freeze({files:128,entries:4096,depth:8,metadataBytes:196608,lifetimeMs:15*60*1000,proposals:256});
export const localSourceAttachmentIntent=(intent:string)=>typeof intent==='string'&&intent.length<=16000&&/^\s*(?:vela[,:]?\s+)?(?:(?:please|(?:can|could|would) you|I want(?: you)? to|I(?: would|'d) like(?: you)? to)\s+)*(?:add|attach|import|bring|put|load)\b[\s\S]*\b(?:docs?|documents?|files?|folders?|sources?|resources?|results?|these|those|them)\b[\s\S]*\b(?:(?:this|current|the)\s+)?workspace\b/iu.test(intent);
export const localFolderListIntent=(intent:string)=>typeof intent==='string'&&/^\s*(?:vela[,:]?\s+)?(?:(?:please|(?:can|could|would) you)\s+)*(?:(?:what(?:'s| is)\s+in\s+(?:this|the selected)\s+folder)|(?:what\s+(?:files|folders|items)\s+(?:are\s+)?(?:in|inside)\s+(?:this|the selected)\s+folder)|(?:(?:list|show)\s+(?:(?:the\s+)?(?:files|folders|items|contents)\s+(?:in|of|inside)\s+)?(?:this|the selected)\s+folder(?:['’]s\s+contents)?))[.!?]*\s*$/iu.test(intent);
/** Whole untrusted labels only; never clip a filename or imply this page is the whole folder. */
export function folderListingAnswer(name:string,listing:FolderBrowseResponse):string{
  const header='In “'+name+'”:\n',footer='\nThis is a bounded preview; open the folder to browse more entries.',lines:string[]=[];
  for(const entry of listing.entries.slice(0,12)){const line='• '+JSON.stringify(entry.name)+(entry.kind==='folder'?' (folder)':entry.kind==='unsupported'?' (unsupported)':'');
    if(Buffer.byteLength(header+[...lines,line].join('\n')+footer)>1800)break;lines.push(line);}
  const more=lines.length<listing.entries.length||listing.cursor!==null||listing.truncated;
  const answer=lines.length?header+lines.join('\n')+(more?footer:''):'I found no visible entries in “'+name+'” in this metadata listing.'+(more?footer:'');
  ensure(Buffer.byteLength(answer)<=1800,'folder_listing_capacity');return answer;
}
export function localDocumentIntent(intent:string):{projectName?:string}|null{
  if(typeof intent!=='string'||intent.length>16000||! /^\s*(?:vela[,:]?\s+)?(?:(?:please|(?:can|could|would) you|I want(?: you)? to|I(?: would|'d) like(?: you)? to)\s+)*(?:add|attach|import|bring|put|load)\b[\s\S]*\b(?:docs?|documents?|files?|(?:folder\s+)?contents?)\b[\s\S]*\b(?:(?:this|current|the)\s+)?workspace\b/iu.test(intent))return null;
  const quoted=/["“]([^"”\r\n]{1,120})["”]\s+(?:project\s+)?(?:docs?|documents?|files?)/iu.exec(intent);
  const unquoted=/\b(?:add|attach|import|bring|put|load)\s+(?:the\s+)?([^\r\n]{1,120}?)\s+project\s+(?:docs?|documents?|files?)\b/iu.exec(intent);
  return quoted?{projectName:quoted[1].trim()}:unquoted&&!/^(?:my|this|current|the)$/iu.test(unquoted[1])?{projectName:unquoted[1].trim()}:{};
}
type Target=VelaFileProposal['target'];
type PrivateFile={id:string;relativePath:string;source:MediaSource};
interface Stored {proposal:VelaFileProposal;scopeStamp:string;root:string;rootIdentity:string;files:PrivateFile[];folder?:{id:string;binding:string}}
export interface VelaFileProposalHost {
  db:DatabaseSync;atomic<T>(work:()=>T):T;scopeStamp():string;rootScopeStamp():string;target():Target|null;allowed(target:Target):boolean;
  privateRoot?:string;
  /** An existing canonical Folder grant is reused; this does not mint another root grant. */
  folderRoot?(id:string):Promise<{path:string;binding:string}>;
  folderCurrent?(id:string,binding:string):boolean;
  response(intent:string,content:string,kind:'answer'|'clarification'|'inability'):VelaRequest;
  result(requestId:string,content:string,kind:'answer'|'clarification'|'inability'):VelaRequest;
  /** One canonical transaction; all sources are inspected and exact-version fenced before this call. */
  importAndAttach(id:string,target:Target,sources:readonly MediaSource[]):{importedCount:number;reusedCount:number;verified:boolean;workspaceId:string};
  observe(state:string,id:string,count:number):void;
}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const same=(a:string,b:string)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const within=(root:string,path:string)=>{const part=relative(root,path);return part!==''&&part!=='..'&&!part.startsWith('..'+sep)&&!isAbsolute(part);};
const exact=(v:any,keys:string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(key=>Object.hasOwn(v,key));
const display=(value:string,max=240)=>value.replace(/[\x00-\x1f\x7f\p{Bidi_Control}]/gu,'').slice(0,max);
const alias=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const excluded=new Set(['.git','.codex','.aerynth','node_modules','appdata','target','dist','build','.venv','venv','__pycache__']);
const formats=new Set(['.md','.markdown','.txt','.pdf','.docx']);
/** Local metadata discovery only. Files are never copied into prompts or a second content store. */
export class VelaFileProposals {
  private readonly host:VelaFileProposalHost;private readonly busy=new Set<string>();
  static migrate(db:DatabaseSync){ensure(db.isTransaction,'file_proposal_storage_unavailable');db.exec(`CREATE TABLE IF NOT EXISTS vela_file_roots(alias TEXT NOT NULL,scope_stamp TEXT NOT NULL,path TEXT NOT NULL,identity TEXT NOT NULL,PRIMARY KEY(alias,scope_stamp));
    CREATE TABLE IF NOT EXISTS vela_file_proposals(id TEXT PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,json TEXT NOT NULL);`);}
  constructor(host:VelaFileProposalHost){this.host=host;}
  private async rootIdentity(root:string){const info=await lstat(root,{bigint:true});ensure(info.isDirectory()&&!info.isSymbolicLink(),'file_proposal_root_unavailable');return hash([String(info.dev),String(info.ino)]);}
  private stored(id:string):Stored{ensure(typeof id==='string'&&/^[a-f0-9-]{36}$/u.test(id),'file_proposal_invalid');const row=this.host.db.prepare('SELECT json FROM vela_file_proposals WHERE id=?').get(id);ensure(row,'file_proposal_unavailable');return JSON.parse(String(row.json));}
  private write(value:Stored){ensure(Buffer.byteLength(JSON.stringify(value))<=LOCAL_FILE_PROPOSAL_LIMITS.metadataBytes,'file_proposal_capacity');this.host.db.prepare('INSERT INTO vela_file_proposals VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(value.proposal.id,value.proposal.requestId,JSON.stringify(value));}
  private requireTarget(target:Target){const current=this.host.target();ensure(current&&current.workspaceId===target.workspaceId&&current.projectId===target.projectId&&this.host.allowed(target),'file_proposal_scope_changed');return current;}
  list():VelaFileProposal[]{return this.host.db.prepare('SELECT json FROM vela_file_proposals ORDER BY rowid DESC LIMIT 32').all().flatMap(row=>{const value=JSON.parse(String(row.json)) as Stored;
    if(!this.host.allowed(value.proposal.target))return [];const proposal=structuredClone(value.proposal);
    const current=this.host.target();if(proposal.state==='proposed'&&(Date.parse(proposal.expiresAt)<=Date.now()||!current||current.workspaceVersion!==proposal.target.workspaceVersion||current.layoutVersion!==proposal.target.layoutVersion))proposal.state='stale';return [proposal];});}
  async prepare(input:{intent:string;selectedDirectory?:string;folderResourceId?:string}):Promise<VelaRequest>{
    ensure(input&&Object.keys(input).every(key=>['intent','selectedDirectory','folderResourceId'].includes(key))&&localDocumentIntent(input.intent)&&!(input.selectedDirectory!==undefined&&input.folderResourceId!==undefined),'file_proposal_intent_required');
    const target=this.host.target();ensure(target&&this.host.allowed(target),'file_proposal_workspace_required');
    const match=localDocumentIntent(input.intent)!,scopeStamp=this.host.scopeStamp(),rootScopeStamp=this.host.rootScopeStamp(),key=alias(match.projectName??'selected project documents');
    const previous=this.host.db.prepare('SELECT path,identity FROM vela_file_roots WHERE alias=? AND scope_stamp=?').get(key,rootScopeStamp);
    const connected=input.folderResourceId!==undefined?await this.host.folderRoot?.(input.folderResourceId):undefined;
    ensure(input.folderResourceId===undefined||connected,'file_proposal_scope_changed');
    const folder=connected?{id:input.folderResourceId!,binding:connected.binding}:undefined;
    const folderCurrent=()=>!folder||this.host.folderCurrent?.(folder.id,folder.binding)===true;
    ensure(connected||input.selectedDirectory!==undefined||previous,'file_proposal_root_required');
    const supplied=connected?.path??input.selectedDirectory??String(previous!.path);
    ensure(typeof supplied==='string'&&isAbsolute(supplied)&&!supplied.includes('\0')&&(process.platform!=='win32'||/^[a-z]:[\\/][^:]*$/iu.test(supplied)),'file_proposal_root_unavailable');
    const suppliedInfo=await lstat(supplied);ensure(!suppliedInfo.isSymbolicLink(),'file_proposal_root_unavailable');
    const root=await realpath(supplied),rootIdentity=await this.rootIdentity(root);
    ensure(!this.host.privateRoot||!same(root,this.host.privateRoot)&&!within(this.host.privateRoot,root),'file_proposal_root_unavailable');
    if(!connected&&input.selectedDirectory===undefined)ensure(previous!.identity===rootIdentity,'file_proposal_root_changed');
    const files:PrivateFile[]=[],publicFiles:VelaFileProposal['files']=[];let visited=0;
    const walk=async(directory:string,depth:number):Promise<void>=>{
      if(this.host.privateRoot&&(same(directory,this.host.privateRoot)||within(this.host.privateRoot,directory)))return;
      ensure(depth<=LOCAL_FILE_PROPOSAL_LIMITS.depth,'file_discovery_scope_too_large');
      for await(const entry of await opendir(directory)){
        ensure(++visited<=LOCAL_FILE_PROPOSAL_LIMITS.entries,'file_discovery_scope_too_large');
        if(excluded.has(entry.name.toLowerCase())||entry.isSymbolicLink())continue;
        const path=join(directory,entry.name);if(entry.isDirectory()){if(!entry.name.startsWith('.'))await walk(path,depth+1);continue;}
        if(!entry.isFile()||!formats.has(extname(entry.name).toLowerCase()))continue;
        ensure(files.length<LOCAL_FILE_PROPOSAL_LIMITS.files,'file_discovery_scope_too_large');
        const actual=await realpath(path);ensure(within(root,actual)&&same(path,actual),'file_proposal_source_changed');
        const source=await inspectMediaSelection({kind:'file',path:actual},'document');ensure(source.metadata.source==='file','file_proposal_source_changed');
        const relativePath=relative(root,actual).split(sep).join('/');ensure(relativePath.length<=512,'file_discovery_scope_too_large');
        const id=randomUUID();files.push({id,relativePath,source});publicFiles.push({id,displayName:display(source.metadata.name),relativePath:display(relativePath,512),kind:source.metadata.format,bytes:source.metadata.byteLength,versionDigest:source.metadata.sourceRevision});
      }
    };
    await walk(root,0);files.sort((a,b)=>a.relativePath.localeCompare(b.relativePath));publicFiles.sort((a,b)=>a.relativePath.localeCompare(b.relativePath));
    ensure(this.host.scopeStamp()===scopeStamp&&await this.rootIdentity(root)===rootIdentity&&folderCurrent(),'file_proposal_scope_changed');
    const current=this.requireTarget(target);ensure(current.workspaceVersion===target.workspaceVersion&&current.layoutVersion===target.layoutVersion,'file_proposal_target_changed');
    return this.host.atomic(()=>{
      ensure(this.host.scopeStamp()===scopeStamp&&folderCurrent(),'file_proposal_scope_changed');
      if(!folder)this.host.db.prepare('INSERT INTO vela_file_roots VALUES(?,?,?,?) ON CONFLICT(alias,scope_stamp) DO UPDATE SET path=excluded.path,identity=excluded.identity').run(key,rootScopeStamp,root,rootIdentity);
      if(!files.length)return this.host.response(input.intent,`I didn’t find supported project documents in “${display(basename(root))}”. No files were added. Choose the folder containing the project’s documents.`,'clarification');
      ensure(Number(this.host.db.prepare('SELECT count(*) AS n FROM vela_file_proposals').get()!.n)<LOCAL_FILE_PROPOSAL_LIMITS.proposals,'file_proposal_capacity');
      const request=this.host.response(input.intent,'I found these files that seem to match. Want me to add them to this workspace?','clarification');
      const id=randomUUID(),expiresAt=new Date(Date.now()+LOCAL_FILE_PROPOSAL_LIMITS.lifetimeMs).toISOString(),summary=`Add ${files.length} project document${files.length===1?'':'s'} to ${target.workspaceTitle?`“${target.workspaceTitle}”`:'this workspace'}.`;
      const publicInput={kind:'local-file-proposal' as const,id,requestId:request.id,version:1,target,source:{displayRoot:display(basename(root))},files:publicFiles,count:files.length,summary,state:'proposed' as const,expiresAt};
      this.write({proposal:{...publicInput,digest:hash(publicInput)},scopeStamp,root,rootIdentity,files,...(folder?{folder}:{})});this.host.observe('proposed',id,files.length);return request;
    });
  }
  async command(command:VelaFileProposalCommand):Promise<{proposal:VelaFileProposal;request:VelaRequest}>{
    ensure(command&&exact(command,['name','input'])&&['accept','cancel'].includes(command.name)&&exact(command.input,['id','digest','expectedVersion']),'file_proposal_invalid');
    const {id,digest,expectedVersion}=command.input;ensure(!this.busy.has(id),'file_proposal_busy');this.busy.add(id);
    try{const value=this.stored(id),proposal=value.proposal;this.requireTarget(proposal.target);
      ensure(typeof digest==='string'&&digest===proposal.digest&&expectedVersion===proposal.version,'file_proposal_changed');
      ensure(proposal.state==='proposed','file_proposal_already_resolved');
      if(command.name==='cancel')return this.host.atomic(()=>{proposal.state='cancelled';proposal.version++;this.write(value);const request=this.host.result(proposal.requestId,'No files were added.','answer');this.host.observe('cancelled',id,proposal.count);return {proposal:structuredClone(proposal),request};});
      ensure(Date.parse(proposal.expiresAt)>Date.now()&&this.host.scopeStamp()===value.scopeStamp,'file_proposal_stale');
      const folderCurrent=()=>!value.folder||this.host.folderCurrent?.(value.folder.id,value.folder.binding)===true;
      ensure(folderCurrent(),'file_proposal_scope_changed');
      const target=this.requireTarget(proposal.target);ensure(target.workspaceVersion===proposal.target.workspaceVersion&&target.layoutVersion===proposal.target.layoutVersion,'file_proposal_target_changed');
      ensure(await this.rootIdentity(value.root)===value.rootIdentity,'file_proposal_root_changed');
      for(const file of value.files){ensure(file.source.path&&within(value.root,file.source.path),'file_proposal_source_changed');
        const info=await lstat(file.source.path);ensure(info.isFile()&&!info.isSymbolicLink()&&same(await realpath(file.source.path),file.source.path),'file_proposal_source_changed');
        const current=await inspectMediaSelection({kind:'file',path:file.source.path},'document');ensure(hash(current)===hash(file.source),'file_proposal_source_changed');}
      return this.host.atomic(()=>{const current=this.stored(id);ensure(current.proposal.state==='proposed'&&current.proposal.version===expectedVersion&&this.host.scopeStamp()===value.scopeStamp,'file_proposal_changed');
        ensure(folderCurrent(),'file_proposal_scope_changed');
        const target=this.requireTarget(proposal.target);ensure(target.workspaceVersion===proposal.target.workspaceVersion&&target.layoutVersion===proposal.target.layoutVersion,'file_proposal_target_changed');
        const descriptors:{fd:number;file:PrivateFile}[]=[];
        const verifySources=()=>{for(const {fd,file} of descriptors){const path=file.source.path!,entry=lstatSync(path,{bigint:true});ensure(entry.isFile()&&!entry.isSymbolicLink()&&same(realpathSync(path),path)&&
          mediaSourceRevision(entry)===file.source.metadata.sourceRevision&&mediaSourceRevision(fstatSync(fd,{bigint:true}))===file.source.metadata.sourceRevision,'file_proposal_source_changed');}};
        try{for(const file of value.files){descriptors.push({fd:openSync(file.source.path!,'r'),file});}verifySources();
        const result=this.host.importAndAttach(id,proposal.target,value.files.map(file=>file.source));ensure(result.verified&&result.workspaceId===proposal.target.workspaceId,'file_proposal_verification_failed');
        verifySources();ensure(folderCurrent(),'file_proposal_scope_changed');
        proposal.state='applied';proposal.version++;proposal.result=result;this.write(value);
        const request=this.host.result(proposal.requestId,`${proposal.count} document${proposal.count===1?' is':'s are'} now in ${proposal.target.workspaceTitle?`“${proposal.target.workspaceTitle}”`:'this workspace'}.`,'answer');
        this.host.observe('applied',id,proposal.count);return {proposal:structuredClone(proposal),request};
        }finally{for(const {fd} of descriptors)closeSync(fd);}});
    }catch(error){const failure=error instanceof ServiceError?error:new ServiceError(['ENOENT','ENOTDIR','EACCES','EPERM','ELOOP'].includes(String((error as NodeJS.ErrnoException)?.code))?'file_proposal_source_changed':'file_proposal_unavailable'),code=failure.code;
      if(typeof code==='string'&&/^file_proposal_(?:source_changed|existing_source_changed|root_changed|target_changed|stale|scope_changed)$/u.test(code)){
        this.host.atomic(()=>{const stored=this.stored(id);if(stored.proposal.state==='proposed'&&this.host.allowed(stored.proposal.target)){stored.proposal.state='stale';stored.proposal.version++;this.write(stored);this.host.observe('stale',id,stored.proposal.count);}});
      }throw failure;
    }finally{this.busy.delete(id);}
  }
}
