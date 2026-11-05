import type {Resource} from '../application-contract/contracts.ts';
import type {FolderBrowseRequest,FolderBrowseResponse} from '../application-contract/folder.ts';
export interface FolderViewPort {
  list(input:FolderBrowseRequest):Promise<FolderBrowseResponse>;
  openExternal(input:{resourceId:string;entryId?:string}):Promise<unknown>;
}
/** A folder is one canonical source. Browsing returns ephemeral metadata rows;
 * it does not import children, create placements or send their contents. */
export function mountFolderExperience(root:HTMLElement,initial:Resource,port:FolderViewPort){
  const doc=root.ownerDocument;
  const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  const section=el('section');section.className='aw-folder';section.setAttribute('aria-label','Folder source');
  const title=el('h3'),status=el('p'),list=el('ul'),controls=el('div');status.setAttribute('role','status');list.setAttribute('aria-label','Folder contents');
  let resource=initial,active=true,disposed=false,pending=false,sequence=0,listing:FolderBrowseResponse|null=null;
  const history:{id?:string;name:string}[]=[];
  const button=(label:string,work:()=>Promise<unknown>)=>{const node=el('button',label);node.type='button';node.className='vela-core-button';node.addEventListener('click',()=>{if(!node.disabled)void run(work);});return node;};
  const browse=button('Browse folder',()=>read());
  const external=button('Open folder',()=>port.openExternal({resourceId:resource.id,...(listing?.entryId?{entryId:listing.entryId}:{})}));
  const back=button('Back',async()=>{history.pop();await read(history.at(-1)?.id);});
  const more=button('Load more',()=>read(listing?.entryId??undefined,listing?.cursor??undefined));
  controls.append(browse,external,back);section.append(title,controls,status,list,more);root.replaceChildren(section);
  function available(){return active&&!disposed&&resource.available!==false&&resource.visible!==false&&resource.state!=='archived'&&resource.kind==='folder'&&!!resource.folder;}
  function render(){
    title.textContent=listing?.name||resource.folder?.name||resource.title;
    browse.disabled=external.disabled=!available()||pending;browse.textContent=listing?'Refresh folder':'Browse folder';back.hidden=!listing?.entryId;back.disabled=pending;
    more.hidden=!listing?.cursor;more.disabled=pending;
    section.setAttribute('aria-busy',String(pending));
  }
  async function run(work:()=>Promise<unknown>){
    if(pending||!available())return;pending=true;status.textContent='';render();
    try{await work();}catch{if(!disposed)status.textContent='This folder is unavailable. Reconnect it from Resources.';}
    finally{pending=false;if(!disposed)render();}
  }
  async function read(entryId?:string,cursor?:string){
    const epoch=++sequence,id=resource.id,revision=resource.folder?.sourceRevision;
    const response=await port.list({resourceId:id,...(entryId?{entryId}:{}),...(cursor?{cursor}:{})});
    if(disposed||!available()||epoch!==sequence||id!==resource.id||resource.folder?.sourceRevision!==revision)return;
    if(response.resourceId!==id||response.scope!=='metadata-only'||!Array.isArray(response.entries)||response.entries.length>128)throw Error('folder_reply_invalid');
    if(!cursor){list.replaceChildren();if(!entryId)history.splice(0);if(history.at(-1)?.id!==entryId)history.push({id:entryId,name:response.name});}
    listing=response;
    for(const entry of response.entries){
      const row=el('li');row.className='aw-folder-entry';
      if(entry.kind==='folder'){const open=button(entry.name,()=>read(entry.id));open.dataset.folderEntry=entry.id;row.append(open);}
      else row.append(el('span',entry.name));
      list.append(row);
    }
    status.textContent=response.truncated?'More items are available.':list.children.length?'':'This folder is empty.';render();
  }
  render();
  return {update(next:Resource){if(next.id!==resource.id)throw Error('folder_resource_mismatch');const changed=resource.folder?.sourceRevision!==next.folder?.sourceRevision;resource=next;if(!available()||changed){sequence++;listing=null;history.splice(0);list.replaceChildren();status.textContent=available()?'':'Folder access is unavailable.';}render();},
    setActive(value:boolean){active=value;if(!value)sequence++;render();},async flush(){},dispose(){disposed=true;sequence++;listing=null;history.splice(0);list.replaceChildren();section.remove();}};
}
