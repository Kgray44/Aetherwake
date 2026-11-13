import type { BranchPolicy, Collection, ConversationProductPort, ConversationSummary, ConversationView, Detail, FidelityStatus, NativeChatGPTFidelityDescriptor, ProductCommandMap, SearchHit, SearchQuery, Share } from './contracts.ts';
import { ConversationDraftSession, flushConversationDraftSessions } from './draft-session.ts';
import { mountConversationChat, decorateConversationControl, decorateConversationDisclosure, type ConversationChat, type ConversationExecutionPort, type ConversationControlIdentity, type ConversationControlPresentation, type ConversationProviderChange, type ConversationModelControls } from './chat.ts';
import type { ExperienceMotionPort } from '../../application-contract/motion.ts';
import { enhanceConversationSelect, conversationControlStates, conversationDisclosures, conversationHistoryDrawer, conversationDetailReveal } from './picker.ts';
import type { ConversationViewPersistence } from './view-persistence.ts';
export { acceptedConversationSubmission } from './chat.ts';

export type ManagerState = { selectedResourceId: string | null; drafts: Record<string,string>; scroll: Record<string,number>; query: SearchQuery; messageOffset: Record<string,number> };
export type ManagerOptions = { models?: ConversationModelControls; embedded?: boolean; motion?:ExperienceMotionPort;viewId?:string;execution?: ConversationExecutionPort; draftSession?: (resourceId: string) => ConversationDraftSession; state?: ManagerState; resourceId?: string; initialMessageId?:string;viewPersistence?:ConversationViewPersistence;onClose?: () => void; onResource?: (resourceId: string, messageId?: string) => void; onState?: (state: ManagerState) => void; copy?: (text: string) => Promise<void>; download?: (name: string, content: string) => void; /** Explicit host-owned creation using this canonical conversation resource; no workspace or transcript mutation here. */ onCreateChecklist?: (canonicalConversationResourceId: string) => void | Promise<void>; /** Explicit ChatGPT site/reviewed documentation navigation only; host revalidates an exact allowlist. Never account connection or sync. */ onOpenChatGPT?: (reference?: string) => Promise<{status:'requested'|'unknown'|'unavailable'}> };
export const createManagerState = (): ManagerState => ({selectedResourceId:null,drafts:{},scroll:{},query:{},messageOffset:{}});
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, label?: string, className?: string): HTMLElementTagNameMap[K] => { const node=document.createElement(tag); if(label!==undefined)node.textContent=label;if(className)node.className=className;return node; };
const button = (label: string, action: () => void | Promise<void>, presentation: ConversationControlPresentation={identity:'action'}) => { const b=el('button',label);b.type='button';decorateConversationControl(b,presentation);b.addEventListener('click',()=>{if(!b.disabled)void action();});return b; };
const field = (label: string, input: HTMLElement) => {const l=el('label',undefined,'cp-field');l.append(el('span',label),input);return l;};
const select = (items: {value:string;label:string;disabled?:boolean}[], value='') => {const node=el('select');node.className='cp-native-select';for(const item of items){const option=el('option',item.label);option.value=item.value;option.disabled=!!item.disabled;node.append(option);}node.value=value;return node;};
const disclosure = (label:string,className:string) => {
 const node=el('details',undefined,'cp-disclosure '+className),summary=el('summary',label),panel=el('div',undefined,'cp-disclosure-panel');node.append(summary,panel);
 const identities:Record<string,ConversationControlIdentity>={'cp-new-chat':'new-chat','cp-switcher':'history','cp-branch-navigator':'lineage','cp-filters':'filters','cp-history-tools':'organize','cp-chat-options':'chat-options','cp-shares':'shares','cp-chatgpt-compatibility':'providers','cp-fidelity-aim':'providers','cp-fidelity-related-row':'providers'};decorateConversationDisclosure(node,summary,identities[className]??'action',panel);return {node,summary,panel};
};

const fidelityStatusLabel=(status:FidelityStatus)=>status==='RequiresAdditionalAuthorization'?'Requires additional authorization':status;
const executionLabel=(state:NonNullable<ConversationSummary['execution']>['state'])=>({dispatching:'Starting',running:'Running',provider_completed:'Provider completed · task unverified',failed:'Failed',interrupted:'Interrupted',unknown:'Outcome unconfirmed'}[state]);
const officialEvidenceURL=(value:string):string|null=>{
 try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&(['developers.openai.com','learn.chatgpt.com'].includes(url.hostname)||url.hostname==='github.com'&&url.pathname.startsWith('/openai/'))?url.href:null;}catch{return null;}
};
const renderChatGPTCompatibility=(report:NativeChatGPTFidelityDescriptor,onOpenEvidence?: (url:string)=>void)=>{
 const view=disclosure('ChatGPT compatibility','cp-chatgpt-compatibility');view.node.dataset.fidelityId=report.id;view.node.dataset.providerId=report.providerId;
 view.panel.append(el('p',`Documentation checked ${report.review.dateUtc} · Runtime account access unverified.`, 'cp-fidelity-review'),el('p',report.reason,'cp-fidelity-note'));
 const row=(label:string,status:FidelityStatus,interfaceName:string,scope:string,reason:string,evidence:NativeChatGPTFidelityDescriptor['aims'][number]['evidence'],className:string)=>{
  const item=disclosure(label,className),badge=el('span',fidelityStatusLabel(status),'cp-fidelity-status');item.node.dataset.status=status;item.summary.append(badge);
  const facts=el('dl',undefined,'cp-fidelity-facts');for(const [name,value] of [['Reviewed interface',interfaceName],['Scope',scope],['Reason',reason],['Status meaning',report.statusDefinitions[status]]])facts.append(el('dt',name),el('dd',value));item.panel.append(facts);
  const sources=el('ul',undefined,'cp-fidelity-evidence');sources.setAttribute('aria-label','Official evidence');
  for(const source of evidence){const entry=el('li'),href=officialEvidenceURL(source.url);if(href){const link=el('a',source.section+' · '+new URL(href).hostname);link.href=href;link.target='_blank';link.rel='noopener noreferrer';if(onOpenEvidence)link.addEventListener('click',event=>{event.preventDefault();onOpenEvidence(href);});entry.append(link);}else entry.append(el('span',source.section+' · Evidence link unavailable'));sources.append(entry);}
  item.panel.append(sources);return item;
 };
 const aims=el('ol',undefined,'cp-fidelity-aims');aims.setAttribute('aria-label','Native ChatGPT account requirements');
 for(const aim of report.aims){const entry=el('li'),item=row(aim.label,aim.status,aim.interfaceName,aim.statusScope,aim.reason,aim.evidence,'cp-fidelity-aim');item.node.dataset.aimId=aim.id;item.node.dataset.reasonCode=aim.reasonCode;
  if(aim.otherNativeInterfaces)item.panel.append(el('p','Other native-account interfaces: Unverified. This interface exclusion does not prove they are impossible.','cp-fidelity-alternative'));
  entry.append(item.node);aims.append(entry);
 }
 const related=el('section',undefined,'cp-fidelity-related');related.setAttribute('aria-label','Separate capabilities');related.append(el('h4','Separate capabilities'),el('p','These do not establish native ChatGPT account fidelity.'));
 for(const capability of report.relatedCapabilities){const reason=capability.reason??(capability.implementation==='in-progress'?'Implementation in progress; account authorization and live inference remain unverified.':capability.implementation==='on-hold'?'Inference implementation is on hold.':'Source-tested navigation seam; native host is not wired.'),item=row(capability.label,capability.status,capability.interfaceName,capability.statusScope,reason,capability.evidence,'cp-fidelity-related-row');item.node.dataset.relatedCapabilityId=capability.id;related.append(item.node);}
 view.panel.append(aims,related);return view;
};

/** Temporary surface: the host decides placement, focus transition, and shared Motion Coordinator. */
export function mountConversationManager(container: HTMLElement, port: ConversationProductPort, options: ManagerOptions = {}) {
 if(options.motion&&!options.viewId?.trim())throw new Error('conversation_motion_identity_required');
 const state=options.state??createManagerState();if(options.resourceId)state.selectedResourceId=options.resourceId;
 const root=el('section',undefined,'cp-manager aw-optical-controls'+(options.embedded===false?' cp-standalone':' cp-embedded'));root.dataset.awOptics='workspace';root.setAttribute('role','region');root.setAttribute('aria-label','Conversations');
 const pickers=new Map<HTMLSelectElement,ReturnType<typeof enhanceConversationSelect>>();let pickerSerial=0;
 const controlStates=options.motion?conversationControlStates(root,{motion:options.motion,viewId:options.viewId!}):null;
 const disclosures=options.motion?conversationDisclosures(root,{motion:options.motion,viewId:options.viewId!}):null;
 function syncPickers(syncExisting=true){if(!options.motion)return;disclosures?.sync();for(const[select,picker]of pickers)if(!root.contains(select)){picker.dispose();pickers.delete(select);}for(const select of root.querySelectorAll<HTMLSelectElement>('select')){if(!pickers.has(select))pickers.set(select,enhanceConversationSelect(select,{motion:options.motion,viewId:options.viewId!+':select:'+ ++pickerSerial,onError:error=>{status.textContent=error instanceof Error?error.message:String(error);}}));else if(syncExisting)pickers.get(select)!.sync();}}
 const header=el('header'),heading=el('h2','Conversations'),status=el('p','', 'cp-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const historyToggle=button('History',()=>{const open=root.classList.toggle('cp-history-open');historyToggle.setAttribute('aria-expanded',String(open));},{identity:'history'}),close=button('Close',()=>closeManager(),{identity:'close'}),headerActions=el('div',undefined,'cp-header-actions'),newChat=disclosure('New chat','cp-new-chat'),switcher=disclosure('Switch chat','cp-switcher');historyToggle.classList.add('cp-history-toggle');historyToggle.setAttribute('aria-expanded','false');headerActions.dataset.cpGroup='surface';headerActions.setAttribute('role','group');headerActions.setAttribute('aria-label','Conversation controls');headerActions.append(newChat.node,switcher.node,historyToggle,close);header.append(heading,headerActions);
 const switchQuery=el('input'),switchMode=select([{value:'recent',label:'Recent chats'},{value:'favorite',label:'Favorites'},{value:'running',label:'Running chats'}]),switchStatus=el('p','', 'cp-switcher-status'),switchResults=el('div',undefined,'cp-switcher-results');switchQuery.type='search';switchQuery.placeholder='Find a conversation';switchQuery.maxLength=1000;switchQuery.setAttribute('aria-label','Find a conversation to switch to');switchMode.setAttribute('aria-label','Quick conversation group');switchStatus.setAttribute('role','status');switcher.panel.append(switchQuery,switchMode,switchStatus,switchResults);
 const toolbar=el('div',undefined,'cp-toolbar'),query=el('input'),project=el('select'),collection=el('select'),archive=select([{value:'active',label:'Active'},{value:'archived',label:'Archived'}],state.query.archived?'archived':'active'),favorite=el('input');
 const sort=select([{value:'activity',label:'Recent activity'},{value:'created',label:'Newest created'},{value:'title',label:'Title'},{value:'active',label:'Running first'}],state.query.sort??'activity'),searchMode=select([{value:'all',label:'All matches'},{value:'conversations',label:'Conversations'},{value:'messages',label:'Messages'},{value:'resources',label:'Resources'}],state.query.searchMode??'all');sort.setAttribute('aria-label','Sort conversations');searchMode.setAttribute('aria-label','Search result type');
 query.type='search';query.placeholder='Search chats';query.value=state.query.text??'';query.setAttribute('aria-label','Search conversation history');favorite.type='checkbox';favorite.checked=!!state.query.favorite;
 const clearSearch=button('Clear history search',()=>{clearTimeout(searchTimer);query.value='';filter();query.focus();},{identity:'clear-search'});clearSearch.hidden=!query.value;query.dataset.cpControl='search';clearSearch.setAttribute('aria-label','Clear history search');
 const filters=disclosure('Filters','cp-filters');filters.panel.append(field('Project',project),field('Folder or collection',collection),field('History',archive),field('Favorites',favorite),field('Search result type',searchMode));toolbar.dataset.cpGroup='search';toolbar.append(query,clearSearch,sort,filters.node);
 const filterCount=el('span',undefined,'cp-control-count');filterCount.setAttribute('aria-hidden','true');filters.summary.append(filterCount);project.className=collection.className='cp-native-select';
 const createForm=el('form',undefined,'cp-create'),newTitle=el('input'),newProvider=el('select'),createButton=el('button','Create conversation');newTitle.placeholder='Optional title';newTitle.setAttribute('aria-label','New conversation title');newProvider.setAttribute('aria-label','New conversation provider');createForm.append(field('Title (optional)',newTitle),field('Provider',newProvider),createButton);newChat.panel.append(createForm);
 decorateConversationControl(createButton,{identity:'create-chat',emphasis:'primary'});newProvider.className='cp-native-select';
 let explicitNewProvider:string|null=null,newProviderCatalog:ProductCommandMap['providers']['output']=[];
 const syncNewProvider=()=>{const chosen=newProviderCatalog.find(p=>p.id===newProvider.value);createButton.disabled=!chosen?.record||chosen.execute&&!chosen.available;};
 newProvider.addEventListener('change',()=>{explicitNewProvider=newProvider.value;syncNewProvider();});
 switcher.panel.append(button('New local conversation',()=>run(async()=>{const providerId=[...newProvider.options].find(option=>option.value==='local'||option.value==='mock-ordinary')?.value??'local',created=await call('create',{title:'New conversation',providerId,commandId:crypto.randomUUID()});switcher.node.open=false;await open(created.resourceId);await refresh();chat?.focusComposer();}),{identity:'create-chat'}));
 newChat.node.addEventListener('toggle',()=>{if(newChat.node.open)newTitle.focus();});
 const createFolder=el('form',undefined,'cp-create'),folderTitle=el('input'),folderButton=el('button','New folder');folderTitle.placeholder='Folder title';folderTitle.setAttribute('aria-label','New folder title');createFolder.append(folderTitle,folderButton);
 decorateConversationControl(folderButton,{identity:'new-folder',emphasis:'secondary'});
 const folderEditor=el('div',undefined,'cp-folder-editor');
 const manageFolder=button('Manage selected folder',()=>{
  const c=collections.find(c=>c.id===collection.value);if(!c){status.textContent='Select a folder or collection first';return;}
  const title=el('input'),parent=select([{value:'',label:'Top level'},...collections.filter(p=>p.id!==c.id).map(p=>({value:p.id,label:p.title}))],c.parentId??'');title.value=c.title;
  folderEditor.replaceChildren(field('Folder title',title),button('Rename folder',async()=>run(async()=>{await call('organize',{type:'renameCollection',collectionId:c.id,title:title.value,expectedVersion:c.version});folderEditor.replaceChildren();await refresh();})),field('Parent folder',parent),button('Save parent folder',async()=>run(async()=>{await call('collectionRule',{collectionId:c.id,parentId:parent.value||null,rule:c.rule,expectedVersion:c.version,expectedRuleRevision:c.ruleRevision});folderEditor.replaceChildren();await refresh();})),button('Archive folder; keep its resources',async()=>run(async()=>{await call('organize',{type:'archiveCollection',collectionId:c.id,archived:true,expectedVersion:c.version});if(state.query.collectionId===c.id)state.query.collectionId=undefined;collection.value='';folderEditor.replaceChildren();await refresh();})),button('Close folder controls',()=>folderEditor.replaceChildren()));title.focus();
 },{identity:'manage-folder'});createFolder.append(manageFolder);manageFolder.disabled=true;
 const createdCollection=(value:unknown)=>{const id=(value as {id?:unknown}|null)?.id;if(typeof id!=='string'||!id)throw new Error('Created collection ID unavailable');const c=collections.find(c=>c.id===id);if(!c)throw new Error('Created collection not found');return c;};
 const saveSearch=button('Save as smart conversation collection',async()=>run(async()=>{const title=folderTitle.value.trim();if(!title)throw new Error('Enter a folder title first');const created=await call('organize',{type:'createCollection',title,projectId:state.query.projectId??null});await reloadCollections();const c=createdCollection(created);const {offset,limit,collectionId,searchMode,sort,...rule}=state.query;await call('collectionRule',{collectionId:c.id,parentId:null,rule:{...rule,searchMode:'conversations'},expectedVersion:c.version,expectedRuleRevision:c.ruleRevision});await refresh();}));saveSearch.title='Smart rules match conversations; manual collection membership is preserved.';createFolder.append(saveSearch);
 const historyTools=disclosure('Organize history','cp-history-tools');historyTools.panel.append(createFolder,folderEditor);
 const body=el('div',undefined,'cp-body'),catalog=el('nav',undefined,'cp-catalog'),libraryScroll=el('div',undefined,'cp-library-scroll'),tree=el('nav',undefined,'cp-library-tree'),results=el('div',undefined,'cp-results'),resultCount=el('p'),paging=el('div',undefined,'cp-paging');tree.setAttribute('aria-label','Projects and collections');catalog.setAttribute('aria-label','Conversation history');libraryScroll.append(tree,results);catalog.append(toolbar,historyTools.node,resultCount,libraryScroll,paging);if(!state.selectedResourceId){root.classList.add('cp-history-open');historyToggle.setAttribute('aria-expanded','true');}
 const detail=el('section',undefined,'cp-detail'),detailHeader=el('div',undefined,'cp-detail-header'),chatHost=el('div',undefined,'cp-chat-host'),secondary=el('div',undefined,'cp-secondary'),extras=el('details',undefined,'cp-chat-extras'),extrasSummary=el('summary','Branches and context');extras.append(extrasSummary,secondary);decorateConversationDisclosure(extras,extrasSummary,'branches',secondary);detailHeader.append(extras);detail.append(detailHeader,chatHost);body.append(catalog,detail);root.append(header,status,body);container.append(root);
 const drawer=options.motion?conversationHistoryDrawer(root,catalog,{motion:options.motion,viewId:options.viewId!}):null;
 const detailReveal=options.motion?conversationDetailReveal(detail,{motion:options.motion,viewId:options.viewId!}):null;
 let disposed=false,request=0,current:Detail|null=null,collections:Collection[]=[],busy=false,searchTimer:ReturnType<typeof setTimeout>|undefined,closing=false,filterQueued=false;
 let chat:ConversationChat|null=null,chatResource:string|null=null,selectedMessageId=options.initialMessageId,restoredView:ConversationView|null=null,viewNavigation=0;
 root.addEventListener('pointerdown',()=>{viewNavigation++;},{passive:true});root.addEventListener('keydown',()=>{viewNavigation++;});
 let running:Promise<void>|null=null,collectionOpening:Promise<void>=Promise.resolve(),openingChatGPT=false,openIntent=0,switchGeneration=0,switchLoading=false,switchTimer:ReturnType<typeof setTimeout>|undefined;
 let providerLabels=new Map<string,string>();
 let creatingChecklist=false,checklistControl:HTMLButtonElement|null=null;
 const expandedTree=new Set<string>();
 async function createLinkedChecklist(resourceId:string){
  if(!options.onCreateChecklist||creatingChecklist||disposed||closing||current?.conversation.resourceId!==resourceId||state.selectedResourceId!==resourceId)return;
  creatingChecklist=true;if(checklistControl)checklistControl.disabled=true;
  try{await options.onCreateChecklist(resourceId);}
  catch(error){if(!disposed)status.textContent='Could not create linked checklist: '+(error instanceof Error?error.message:String(error));}
  finally{creatingChecklist=false;if(!disposed&&checklistControl)checklistControl.disabled=false;}
 }
 async function openFirstParty(reference?:string){
  if(!options.onOpenChatGPT||openingChatGPT||disposed)return;openingChatGPT=true;
  for(const control of root.querySelectorAll<HTMLButtonElement>('[data-first-party-target="chatgpt-home"]'))control.disabled=true;
  try{const receipt=await options.onOpenChatGPT(reference);if(!disposed)status.textContent=receipt.status==='requested'?(reference?'Reference open requested.':'Open requested. Continue in ChatGPT.'):receipt.status==='unavailable'?'ChatGPT navigation is unavailable here.':'The open request could not be confirmed. Check your browser before trying again.';}
  catch{if(!disposed)status.textContent='The open request could not be confirmed. Check your browser before trying again.';}
  finally{openingChatGPT=false;if(!disposed)for(const control of root.querySelectorAll<HTMLButtonElement>('[data-first-party-target="chatgpt-home"]'))control.disabled=false;}
 }
 const draftSessions=new Map<string,ConversationDraftSession>();
 const ownedDraftSessions=new Set<ConversationDraftSession>();
 const detachedSubmissions=new Set<Promise<void>>();
 const call=<K extends keyof ProductCommandMap>(name:K,input:ProductCommandMap[K]['input'])=>port.command(name,input);
 const syncFilterControls=()=>{const q=state.query,count=Number(q.projectId!==undefined)+Number(!!q.collectionId)+Number(!!q.favorite)+Number(!!q.archived)+Number(!!q.providerId)+Number(!!q.familyOf)+Number(!!q.after)+Number(!!q.before)+Number(!!q.searchMode&&q.searchMode!=='all');filters.node.dataset.active=String(count>0);filterCount.hidden=count===0;filterCount.textContent=count?String(count):'';filters.summary.setAttribute('aria-label',count?`Filters · ${count} active`:'Filters');clearSearch.hidden=!query.value;sort.value=q.sort??'activity';searchMode.value=q.searchMode??'all';manageFolder.disabled=!collections.some(c=>c.id===collection.value);saveSearch.disabled=!!q.collectionId||q.searchMode==='resources';saveSearch.title=q.collectionId?'A search within one folder cannot be saved as a smart rule yet. Choose all conversations or a project first.':q.searchMode==='resources'?'Smart rules match conversations, not resource-only results.':'Smart rules match conversations; manual collection membership is preserved.';};
 const save=()=>{if(!disposed){options.onState?.(state);syncPickers();options.motion?.wake();}};
 const flush=async()=>{if(disposed)return;await chat?.flush();await flushConversationDraftSessions(()=>draftSessions.values(),save);try{await options.viewPersistence?.flush();}catch{status.textContent='Conversation view could not be saved. Drafts remain saved.';}};
 const saveSelection=async(resourceId:string|null)=>{try{await options.viewPersistence?.select(resourceId);}catch{if(!disposed)status.textContent='Selected conversation could not be saved. Drafts remain saved.';}};
 const detachChat=async()=>{if(!chat)return;const previous=chat,pending=previous.whenSubmissionSettled();await previous.dispose();chat=null;chatResource=null;detachedSubmissions.add(pending);void pending.finally(()=>detachedSubmissions.delete(pending)).catch(()=>{});};
 async function closeManager(){if(closing||disposed)return;closing=true;openIntent++;request++;switchGeneration++;close.disabled=true;try{await flush();options.onClose?.();}catch(error){status.textContent='Draft recovery needs attention before closing: '+(error instanceof Error?error.message:String(error));}finally{closing=false;close.disabled=false;}}
 const run=(action:()=>Promise<void>,propagate=false):Promise<void>=>{if(disposed)return Promise.resolve();const previous=running;busy=true;root.setAttribute('aria-busy','true');const operation=(previous??Promise.resolve()).catch(()=>{}).then(async()=>{if(disposed)return;status.textContent='';await action();}).catch(error=>{if(!disposed)status.textContent=error instanceof Error?error.message:String(error);if(propagate)throw error;}).finally(()=>{if(running!==operation)return;busy=false;running=null;root.removeAttribute('aria-busy');save();if(filterQueued&&!disposed){filterQueued=false;void run(refresh);}});running=operation;return operation;};
 const bindChat=async(resourceId:string,aroundMessageId?:string,stillRequested?:()=>boolean)=>{
  if(chatResource===resourceId&&chat){await chat.refresh({aroundMessageId,stillRequested});return;}
  await detachChat();
  if(disposed||closing)return;
  let session=draftSessions.get(resourceId);
  if(!session){if(options.draftSession)session=options.draftSession(resourceId);else{session=new ConversationDraftSession({resourceId,port,...(Object.hasOwn(state.drafts,resourceId)?{initialContent:state.drafts[resourceId]}:{})});ownedDraftSessions.add(session);}if(session.resourceId!==resourceId)throw new Error('draft_resource_mismatch');draftSessions.set(resourceId,session);}else await session.reload();
  const initialView=restoredView?.resourceId===resourceId?restoredView:undefined;restoredView=null;
  chatResource=resourceId;chat=mountConversationChat(chatHost,{port,resourceId,draftSession:session,execution:options.execution,copy:options.copy,motion:options.motion,models:options.models,viewId:options.viewId?options.viewId+':chat:'+resourceId:undefined,onProviderChange:requestProviderChange,initialScroll:options.viewPersistence?undefined:state.scroll[resourceId],initialOffset:options.viewPersistence?undefined:state.messageOffset[resourceId],viewPersistence:options.viewPersistence,initialView,initialAroundMessageId:aroundMessageId,
   onViewState:view=>{state.drafts[view.resourceId]=view.content;state.scroll[view.resourceId]=view.scroll;state.messageOffset[view.resourceId]=view.offset;save();},onDetail:renderDetail,onUnavailable:()=>{current=null;detailHeader.replaceChildren();secondary.replaceChildren();extras.open=false;},onChanged:refresh,
   onMessageAction:async event=>{if(event.action==='source'){options.onResource?.(event.message.resourceId,event.message.id);return;}if(event.action==='branch'){if(current)showBranch(current,event.message.id);return;}
    const selection=event.selection;if(!selection||event.message.content.slice(selection.start,selection.end)!==selection.text)throw new Error('Select a current source excerpt');
    await run(async()=>{await call('publish',{sourceResourceId:event.message.resourceId,sourceMessageId:event.message.id,range:{start:selection.start,end:selection.end},evidence:'excerpt'});status.textContent='Excerpt published for authorized branch discovery';await loadDetail();});
   }});await chat.ready;
 };
 const open=async(resourceId:string,messageId?:string,intent?:number,stillRequested?:()=>boolean)=>{
  const canOpen=()=>!disposed&&!closing&&(intent===undefined||intent===openIntent)&&(stillRequested?.()??true);
  await flush();
  if(!canOpen())return;
  const previousResourceId=state.selectedResourceId,previousMessageId=selectedMessageId;
  const restorePrevious=async(rebind=true)=>{
   if(!disposed&&!closing&&(intent===undefined||intent===openIntent)&&(previousResourceId!==resourceId||previousMessageId!==messageId)){
    state.selectedResourceId=previousResourceId;selectedMessageId=previousMessageId;
    if(!rebind)return;
    if(previousResourceId)await bindChat(previousResourceId,previousMessageId).catch(()=>{});
    else await detachChat();
   }
  };
  state.selectedResourceId=resourceId;selectedMessageId=messageId;
  try{await bindChat(resourceId,messageId,canOpen);}catch(error){
   await restorePrevious();
   throw error;
  }
  if(!canOpen()){await restorePrevious(previousResourceId!==resourceId);return;}
  root.classList.remove('cp-history-open');historyToggle.setAttribute('aria-expanded','false');
  if(current?.conversation.resourceId===resourceId&&current.conversation.state==='active')await saveSelection(resourceId);
  if(canOpen())options.onResource?.(resourceId,messageId);
 };
 const requestOpen=(resourceId:string,messageId?:string,stillRequested?:()=>boolean)=>{if(disposed)return Promise.reject(new Error('conversation_manager_closed'));const intent=++openIntent;request++;return run(async()=>{if(intent!==openIntent)return;await open(resourceId,messageId,intent,stillRequested);},true);};
 const scopeProject=(projectId:string|undefined)=>{request++;setHistoryQuery({...(projectId?{projectId}:{}),sort:state.query.sort??'activity',offset:0});query.value='';project.value=projectId??'';collection.value='';archive.value='active';favorite.checked=false;searchMode.value='all';root.classList.add('cp-history-open');historyToggle.setAttribute('aria-expanded','true');return run(refresh);};
 const renderTree=(projects:ProductCommandMap['projects']['output'])=>{
  const visible=new Map(collections.map(c=>[c.id,c])),rendered=new Set<string>(),selected=collections.find(c=>c.id===state.query.collectionId);let cursor=selected;const activePath=new Set<string>();while(cursor&&!activePath.has(cursor.id)){activePath.add(cursor.id);cursor=cursor.parentId?visible.get(cursor.parentId):undefined;}
  const group=(title:string,key:string)=>{const node=el('details',undefined,'cp-tree-group'),summary=el('summary',title),panel=el('div',undefined,'cp-tree-children');node.open=expandedTree.has(key)||activePath.has(key);node.dataset.treeKey=key;node.append(summary,panel);decorateConversationDisclosure(node,summary,'organize',panel);node.addEventListener('toggle',()=>node.open?expandedTree.add(key):expandedTree.delete(key));return {node,panel};};
  const folder=(c:Collection,path:Set<string>):HTMLElement|null=>{if(path.has(c.id)||rendered.has(c.id))return null;rendered.add(c.id);const branch=group(c.title,c.id);branch.node.dataset.collectionId=c.id;branch.node.dataset.collectionKind=c.rule?'smart':'manual';const openFolder=button(c.rule?'View smart collection':'Open folder',()=>openCollection(c.id),{identity:'history-result'});openFolder.setAttribute('aria-current',String(c.id===state.query.collectionId));branch.panel.append(el('p',c.rule?`${c.pinnedIds.length} manual · ${c.memberIds.filter(id=>!c.pinnedIds.includes(id)).length} smart matches`:`${c.memberIds.length} members`,'cp-tree-meta'),openFolder);for(const child of collections.filter(item=>item.parentId===c.id)){const nested=folder(child,new Set([...path,c.id]));if(nested)branch.panel.append(nested);}return branch.node;};
  const all=button('All conversations',()=>scopeProject(undefined),{identity:'history-result'});all.setAttribute('aria-current',String(state.query.projectId===undefined&&!state.query.collectionId));tree.replaceChildren(all);
  const roots=collections.filter(c=>!c.parentId||!visible.has(c.parentId));for(const p of projects){const branch=group(p.title,'project:'+p.id);branch.node.dataset.projectId=p.id;if(state.query.projectId===p.id||roots.some(c=>c.projectId===p.id&&activePath.has(c.id)))branch.node.open=true;branch.node.dataset.open=String(branch.node.open);branch.panel.append(button('Browse project conversations',()=>scopeProject(p.id),{identity:'history-result'}));for(const c of roots.filter(c=>c.projectId===p.id)){const node=folder(c,new Set());if(node)branch.panel.append(node);}tree.append(branch.node);}
  const unscoped=roots.filter(c=>!c.projectId||!projects.some(p=>p.id===c.projectId));if(unscoped.length){const branch=group('Collections','collections');if(unscoped.some(c=>activePath.has(c.id)))branch.node.open=true;branch.node.dataset.open=String(branch.node.open);for(const c of unscoped){const node=folder(c,new Set());if(node)branch.panel.append(node);}tree.append(branch.node);}
  if(rendered.size<collections.length)tree.append(el('p','Some collection hierarchy is unavailable. Use the folder filter to inspect a visible collection.','cp-tree-meta'));
 };
 const historyRow=(hit:SearchHit,label:string)=>{const row=button(label,()=>hit.kind==='resource'?run(async()=>{options.onResource?.(hit.resourceId,hit.messageId);}):requestOpen(hit.resourceId,hit.messageId),{identity:'history-result'});row.dataset.resourceId=hit.resourceId;row.dataset.resultKind=hit.kind;if(hit.messageId)row.dataset.messageId=hit.messageId;row.setAttribute('aria-current',String(hit.resourceId===state.selectedResourceId&&(hit.kind!=='message'||hit.messageId===selectedMessageId)));return row;};
 const renderMatches=(list:ProductCommandMap['search']['output'],providers:ProductCommandMap['providers']['output'])=>{
  const groups=new Map<string,SearchHit[]>(),resources:SearchHit[]=[];for(const hit of list.items){if(hit.kind==='resource')resources.push(hit);else groups.set(hit.resourceId,[...groups.get(hit.resourceId)??[],hit]);}results.replaceChildren();
  for(const [id,hits]of groups){const representative=hits.find(hit=>hit.kind==='conversation')??hits[0],section=el('article',undefined,'cp-result-group'),heading=historyRow({...representative,kind:'conversation',messageId:undefined},representative.title),summary=representative.summary,c=collections.find(c=>c.id===state.query.collectionId),membership=c?(c.pinnedIds.includes(id)?'Manual member':c.rule?'Smart match':'Member'):'';
   const providerId=summary?.providerId??representative.providerId,providerLabel=providers.find(p=>p.id===providerId)?.label??'',activity=summary?.lastActivityAt??representative.sourceTime,observed=summary?.execution,metadata=[summary?.favorite?'Favorite':'',membership,providerLabel,observed?executionLabel(observed.state):'',activity?activity.slice(0,10):summary?.historyMetadataStatus&&summary.historyMetadataStatus!=='complete'?'History metadata unavailable':''].filter(Boolean).join(' · ');section.dataset.groupResourceId=id;heading.querySelector('.cp-control-label')!.classList.add('cp-result-title');heading.title=metadata;heading.setAttribute('aria-description',metadata);section.append(heading);
   const matches=hits.filter(hit=>hit.kind==='message');for(const hit of matches.slice(0,3))section.append(historyRow(hit,hit.excerpt));if(matches.length>3){const more=disclosure(`More matching messages · ${matches.length-3}`,'cp-search-matches');for(const hit of matches.slice(3))more.panel.append(historyRow(hit,hit.excerpt));section.append(more.node);}results.append(section);
  }
  if(resources.length){const other=disclosure(`Resources · ${resources.length}`,'cp-resource-matches');other.node.open=groups.size===0;for(const hit of resources)other.panel.append(historyRow(hit,hit.title+'\n'+hit.excerpt));results.append(other.node);}
  if(!list.items.length)results.append(el('p',query.value?'No authorized matches. Try another phrase or result type.':'No conversations in this view. Start a new chat or choose another collection.','cp-library-empty'));
  resultCount.textContent=query.value?`${list.total} matching locations · ${groups.size} conversations on this page`:`${groups.size}${list.hasMore?' shown':''} conversations${resources.length?' · resources available':''}`;
 };
 const readMatches=async(scope:SearchQuery):Promise<ProductCommandMap['search']['output']>=>{const request={...scope,offset:scope.offset??0,limit:50};if(!scope.text?.trim()&&!scope.collectionId&&(!scope.searchMode||['all','conversations'].includes(scope.searchMode))){const page=await call('list',request);return {...page,items:page.items.map(summary=>({kind:'conversation' as const,resourceId:summary.resourceId,title:summary.title,excerpt:'',providerId:summary.providerId,summary,sourceTime:summary.lastActivityAt??undefined}))};}return call('search',{...request,searchMode:scope.searchMode??'all'});};
 const invalidateSwitcher=()=>{
  clearTimeout(switchTimer);
  switchTimer=undefined;
  if(switcher.node.open&&switchResults.contains(document.activeElement))switchQuery.focus();
  switchResults.replaceChildren();
  switchStatus.textContent='Finding conversations…';
  return ++switchGeneration;
 };
 let switchOpen:{generation:number;intent:number}|undefined;
 let switchFailedGeneration:number|undefined;
 let switchComposing=false;
 let switchText='';
 const loadSwitcher=async(openFirst=false)=>{
  const generation=invalidateSwitcher(),text=switchQuery.value.trim(),mode=switchMode.value;
  switchText=text;
  if(openFirst)switchOpen={generation,intent:openIntent};
  const stillCurrent=()=>!disposed&&!closing&&generation===switchGeneration&&switcher.node.open;
  const scope:SearchQuery={projectId:state.query.projectId,...(mode==='favorite'?{favorite:true}:{}),sort:mode==='running'?'active':'activity',limit:12};
  switchLoading=true;
  try{
   // The Running group uses the canonical execution summary from the list projection.
   const exact=!!text&&mode!=='running';
   const page=exact?await call('search',{...scope,text,searchMode:'chat-history'}):await call('list',{...scope,...(text?{text}:{})});
   if(!stillCurrent())return;
   const hits:SearchHit[]=(page.items as (SearchHit|ConversationSummary)[]).flatMap(item=>{
    if('kind' in item)return item.kind==='resource'?[]:[item];
    if(mode==='running'&&item.execution?.state!=='dispatching'&&item.execution?.state!=='running')return [];
    return [{kind:'conversation',resourceId:item.resourceId,title:item.title,excerpt:'',summary:item,providerId:item.providerId}];
   });
   let opening=false;
   const rows=hits.map(hit=>{
    const row=button(hit.title,async()=>{
     if(!stillCurrent()||opening)return;
     opening=true;
     const pending=requestOpen(hit.resourceId,hit.messageId,stillCurrent),intent=openIntent;
     try{
      await pending;
      if(stillCurrent()&&intent===openIntent){
       const returnFocus=switcher.node.contains(document.activeElement);
       switcher.node.open=false;
       if(returnFocus)switcher.summary.focus();
      }
     }catch(error){
      if(stillCurrent()&&intent===openIntent){
       if(switcher.node.contains(document.activeElement))switchQuery.focus();
       const code=error instanceof Error?error.message:String(error);
       if(/(?:^|: )(?:message_unavailable|message_missing|source_unavailable|source_revoked|access_denied|conversation_missing|conversation_not_found)$/.test(code))await loadSwitcher();
       else switchStatus.textContent='Couldn’t open the conversation. Choose a result to try again.';
      }
     }finally{opening=false;}
    },{identity:'history-result'});
    row.dataset.resourceId=hit.resourceId;
    if(hit.messageId){
     row.dataset.messageId=hit.messageId;
     row.append(el('span',hit.excerpt,'cp-switcher-excerpt'));
    }
    row.setAttribute('aria-current',String(hit.resourceId===state.selectedResourceId&&(!hit.messageId||hit.messageId===selectedMessageId)));
    const providerId=hit.summary?.providerId??hit.providerId;
    row.title=[hit.summary?.favorite?'Favorite':'',providerId?(providerLabels.get(providerId)??providerId):'',hit.summary?.execution?.state??''].filter(Boolean).join(' · ');
    row.setAttribute('aria-description',row.title);
    return row;
   });
   for(const [index,row]of rows.entries())row.addEventListener('keydown',event=>{
    if(event.key!=='ArrowDown'&&event.key!=='ArrowUp')return;
    event.preventDefault();
    if(index===0&&event.key==='ArrowUp')switchQuery.focus();
    else rows[Math.min(rows.length-1,index+(event.key==='ArrowDown'?1:-1))].focus();
   });
   switchResults.replaceChildren(...rows);
   switchStatus.textContent=rows.length?`${rows.length} ${exact?'matches':'conversations'}${page.hasMore?' · more in history':''}`:text?'No matches in this group.':'No conversations in this group.';
   if(switchOpen?.generation===generation&&switchOpen.intent===openIntent)rows[0]?.click();
  }catch{
   if(stillCurrent()){
    switchFailedGeneration=generation;
    switchStatus.textContent='Couldn’t load conversations. Press Enter to retry.';
    const retry=button('Retry search',()=>{
     if(!stillCurrent()||switchFailedGeneration!==generation)return;
     switchQuery.focus();
     return loadSwitcher();
    });
    retry.addEventListener('keydown',event=>{
     if(event.key!=='ArrowUp'||!stillCurrent())return;
     event.preventDefault();
     switchQuery.focus();
    });
    switchResults.append(retry);
   }
  }
  finally{if(generation===switchGeneration)switchLoading=false;}
 };
 const openSwitcher=()=>{if(disposed)return Promise.reject(new Error('conversation_manager_closed'));switcher.node.open=true;switchQuery.focus();return loadSwitcher();};
 const resetSwitcher=()=>{invalidateSwitcher();switchLoading=false;switchOpen=undefined;switchComposing=false;};
 switcher.node.addEventListener('toggle',()=>{if(switcher.node.open){switchQuery.focus();if(!switchLoading&&switchTimer===undefined&&!switchComposing)void loadSwitcher();}else resetSwitcher();});
 const scheduleSwitcher=()=>{switchText=switchQuery.value.trim();invalidateSwitcher();if(switcher.node.open&&!switchComposing)switchTimer=setTimeout(()=>void loadSwitcher(),120);};
 const setHistoryQuery=(next:SearchQuery)=>{
  const projectChanged=next.projectId!==state.query.projectId;
  state.query=next;
  if(projectChanged&&switcher.node.open){
   if(switchComposing)invalidateSwitcher();
   else void loadSwitcher();
  }
 };
 switchQuery.addEventListener('compositionstart',()=>{switchComposing=true;invalidateSwitcher();});
 switchQuery.addEventListener('compositionend',()=>{switchComposing=false;scheduleSwitcher();});
 switchQuery.addEventListener('input',event=>{if(!(event as InputEvent).isComposing&&switchQuery.value.trim()!==switchText)scheduleSwitcher();});
 switcher.node.addEventListener('keydown',event=>{
  if(event.key!=='Escape'||!switcher.node.open)return;
  event.stopPropagation();
  if(event.isComposing||switchComposing)return;
  event.preventDefault();
  switcher.node.open=false;
  resetSwitcher();
  switcher.summary.focus();
 });
 switchMode.addEventListener('change',()=>{if(!switchComposing)void loadSwitcher();});
 switchQuery.addEventListener('keydown',event=>{
  if(event.isComposing||switchComposing||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
  const first=switchResults.querySelector('button');
  if(event.key==='ArrowDown'){event.preventDefault();first?.focus();}
  if(event.key!=='Enter'||!switcher.node.open)return;
  event.preventDefault();
  if(switchFailedGeneration===switchGeneration)void loadSwitcher(true);
  else if(first)first.click();
  else if(switchTimer!==undefined)void loadSwitcher(true);
  else if(switchLoading)switchOpen={generation:switchGeneration,intent:openIntent};
 });
 const renderBranchNavigator=(d:Detail)=>{
  const view=disclosure('Branch lineage','cp-branch-navigator');view.node.dataset.resourceId=d.conversation.resourceId;let generation=0;
  view.node.addEventListener('toggle',()=>{if(!view.node.open){generation++;return;}const token=++generation;view.panel.replaceChildren(el('p',d.lineage.length?'Loading branch family…':'No linked branches.'));
   if(!d.lineage.length)return;void call('list',{familyOf:d.conversation.resourceId,sort:'activity',limit:100}).then(page=>{if(disposed||!view.node.open||token!==generation||current?.conversation.resourceId!==d.conversation.resourceId)return;const summaries=new Map(page.items.map(item=>[item.resourceId,item]));summaries.set(d.conversation.resourceId,d.conversation);view.panel.replaceChildren();
    const parentEdge=d.lineage.find(edge=>edge.childResourceId===d.conversation.resourceId),children=d.lineage.filter(edge=>edge.parentResourceId===d.conversation.resourceId),siblings=parentEdge?d.lineage.filter(edge=>edge.parentResourceId===parentEdge.parentResourceId&&edge.childResourceId!==d.conversation.resourceId):[];
    const branch=(label:string,id:string,edge?:Detail['lineage'][number])=>{const summary=summaries.get(id),entry=el('article',undefined,'cp-branch-row');entry.dataset.relation=label.toLowerCase();entry.dataset.resourceId=id;entry.append(el('span',label,'cp-branch-relation'));if(!summary){entry.append(el('p','Branch unavailable in this authorized window.'));return entry;}const openBranch=button(summary.title,()=>requestOpen(id),{identity:'history-result'});openBranch.disabled=id===d.conversation.resourceId;openBranch.setAttribute('aria-current',String(id===d.conversation.resourceId));entry.append(openBranch,el('p',[providerLabels.get(summary.providerId)??summary.providerId,summary.execution?.state??''].filter(Boolean).join(' · '),'cp-result-meta'));if(edge){entry.dataset.lineageMode=edge.mode;entry.append(el('p',edge.mode==='native_fork'?'Native provider fork':'Application context continuation','cp-result-meta'),button('Fork source',()=>requestOpen(edge.parentResourceId,edge.sourceMessageId),{identity:'source'}));}return entry;};
    if(parentEdge)view.panel.append(branch('Parent',parentEdge.parentResourceId,parentEdge));view.panel.append(branch('Current',d.conversation.resourceId));for(const edge of children)view.panel.append(branch('Child',edge.childResourceId,edge));for(const edge of siblings)view.panel.append(branch('Sibling',edge.childResourceId,edge));view.panel.append(el('p',`${d.shares.filter(share=>share.status==='current').length} current source records · inspection, attachment and actual supply remain distinct.`,'cp-result-meta'),button(page.hasMore?'Browse remaining family conversations':'Browse family conversations',()=>{request++;setHistoryQuery({familyOf:d.conversation.resourceId,sort:'activity',offset:0});query.value='';project.value='';collection.value='';archive.value='active';favorite.checked=false;sort.value='activity';searchMode.value='all';syncFilterControls();root.classList.add('cp-history-open');historyToggle.setAttribute('aria-expanded','true');return run(refresh);},{identity:'history'}));
   }).catch(error=>{if(!disposed&&token===generation)view.panel.replaceChildren(el('p',error instanceof Error?error.message:String(error)));});
  });return view.node;
 };
 const showBranch=(d:Detail,messageId:string,targetProviderId=d.conversation.providerId)=>{
  extras.open=true;secondary.replaceChildren();const form=el('form'),title=el('input'),providers=select(d.providers.filter(p=>p.record).map(p=>({value:p.id,label:p.label,disabled:!p.available})),targetProviderId),selection=el('fieldset'),legend=el('legend','Select source messages to prepare for review');title.value=d.conversation.title+' · branch';title.setAttribute('aria-label','Branch title');providers.setAttribute('aria-label','Branch provider');selection.append(legend);
  let reached=false;const chosen=new Set([messageId]);for(const m of d.messages.items){if(reached)break;const box=el('input');box.type='checkbox';box.checked=m.id===messageId;box.addEventListener('change',()=>box.checked?chosen.add(m.id):chosen.delete(m.id));selection.append(field(`${m.role}: ${m.content.slice(0,100)}`,box));if(m.id===messageId)reached=true;}
  const note=el('p','Application continuation: selected source references are prepared for review. Creating a branch does not send a model turn.'),create=el('button','Create branch and review context');decorateConversationControl(create,{identity:'branch',emphasis:'primary'});selection.dataset.cpGroup='branch-source-review';form.append(field('Title',title),field('Provider',providers),selection,note,create);form.addEventListener('submit',event=>{event.preventDefault();void run(async()=>{const b=await call('branch',{resourceId:d.conversation.resourceId,messageId,includeMessageIds:[...chosen],providerId:providers.value,title:title.value,commandId:crypto.randomUUID(),tokenBudget:32768,expectedRevision:d.conversation.revision});secondary.replaceChildren(el('p','Branch created; source context is prepared, awaiting your review.'),button('Approve selected context',async()=>run(async()=>{await call('reviewBranch',{handoffId:b.handoffId,fingerprint:b.fingerprint,approve:true});await open(b.resourceId);await refresh();})),button('Reject context',async()=>run(async()=>{await call('reviewBranch',{handoffId:b.handoffId,fingerprint:b.fingerprint,approve:false});await open(b.resourceId);await refresh();})));});});secondary.append(form);syncPickers();options.motion?.wake();title.focus();
 };
 const beginProviderContinuation=(targetProviderId:string)=>run(async()=>{await flush();const id=state.selectedResourceId;if(!id)throw new Error('Open a conversation before continuing with another provider.');await loadDetail();const detail=current;if(!detail||detail.conversation.resourceId!==id||!detail.providers.some(p=>p.id===targetProviderId&&p.available&&p.record))throw new Error('That provider is unavailable for this conversation.');const anchor=detail.messages.items.find(m=>m.id===selectedMessageId)??detail.messages.items.at(-1);if(!anchor)throw new Error('No authorized source message is available to continue from. Start a new conversation instead.');showBranch(detail,anchor.id,targetProviderId);},true);
 async function requestProviderChange(event:ConversationProviderChange){if(event.mode==='continuation'){if(state.selectedResourceId!==event.resourceId)throw new Error('The selected conversation changed.');return beginProviderContinuation(event.targetProviderId);}return run(async()=>{if(state.selectedResourceId!==event.resourceId||current?.conversation.revision!==event.expectedRevision)throw new Error('The conversation changed. Refresh before choosing its provider.');await flush();await call('selectProvider',{resourceId:event.resourceId,providerId:event.targetProviderId,expectedRevision:event.expectedRevision});await loadDetail();},true);}
 const renderPolicy=(d:Detail)=>{
  const panel=el('details'),summary=el('summary','Connected Branches and source scopes'),form=el('form'),mode=select([{value:'independent',label:'Independent — explicit discovery only'},{value:'connected',label:'Connected — scoped retrieval allowed'},{value:'collaborative',label:'Collaborative — approved publication categories'}],d.policy.mode),scope=el('input'),sensitivity=select([{value:'public',label:'Public'},{value:'internal',label:'Internal'},{value:'sensitive',label:'Sensitive with explicit publication consent'}],d.policy.maxSensitivity),cross=el('input');scope.value=d.policy.allowedSourceIds.join(', ');scope.placeholder='All authorized family branches';cross.type='checkbox';cross.checked=d.policy.allowCrossProject;
  const savePolicy=el('button','Save policy');decorateConversationControl(savePolicy,{identity:'branch-policy',emphasis:'primary'});form.append(field('Mode',mode),field('Allowed source resource IDs (comma separated)',scope),field('Maximum source sensitivity',sensitivity),field('Allow cross-project sharing when source also permits',cross),el('p','Modes govern eligible discovery. This phase performs explicit user-directed publication, inspection, and attachment; it runs no automatic model turns.'),savePolicy);
  form.addEventListener('submit',event=>{event.preventDefault();void run(async()=>{await call('policy',{...d.policy,expectedRevision:d.policy.revision,mode:mode.value as BranchPolicy['mode'],allowedSourceIds:scope.value.split(',').map(s=>s.trim()).filter(Boolean),maxSensitivity:sensitivity.value as BranchPolicy['maxSensitivity'],allowCrossProject:cross.checked});await loadDetail();});});decorateConversationDisclosure(panel,summary,'branch-policy',form);panel.append(summary,form,button('Discover branch excerpts',async()=>run(async()=>{const shares=await call('discover',{resourceId:d.conversation.resourceId});const list=el('div');if(!shares.length)list.append(el('p','No authorized current excerpts found.'));for(const share of shares)list.append(renderShare(share,d));panel.append(list);})));return panel;
 };
 const renderShare=(share:Share,d:Detail)=>{
  const row=el('article',undefined,'cp-share');row.append(el('p',`${share.evidence} · ${share.state} · ${share.attached?'currently attached':'not attached'} · ${share.status} · source ${share.sourceResourceId} / ${share.sourceMessageId}${share.supersedes?' · supersedes '+share.supersedes:''}${share.supersededBy.length?' · superseded by '+share.supersededBy.join(', '):''}`));
  if(share.status==='current')row.append(button('Inspect source excerpt',async()=>run(async()=>{const inspected=await call('inspectShare',{resourceId:d.conversation.resourceId,shareId:share.id});row.append(el('blockquote',inspected.content),button('Attach to future context',async()=>run(async()=>{await call('attachShare',{resourceId:d.conversation.resourceId,shareId:share.id,attach:true});await loadDetail();})));})),button('Detach',async()=>run(async()=>{await call('attachShare',{resourceId:d.conversation.resourceId,shareId:share.id,attach:false});await loadDetail();})));
  if(share.sourceResourceId===d.conversation.resourceId)row.append(button('Revoke publication',async()=>run(async()=>{await call('revokeShare',{shareId:share.id});await loadDetail();})));return row;
 };
 const renderDetail=(d:Detail)=>{
  const id=d.conversation.resourceId;
  const sameResource=root.dataset.resourceId===id,optionsOpen=sameResource&&!!detailHeader.querySelector<HTMLDetailsElement>('.cp-chat-options')?.open;
  const providerOpen=sameResource&&!!secondary.querySelector<HTMLDetailsElement>('.cp-provider-capabilities')?.open,previousCompatibility=sameResource?secondary.querySelector<HTMLDetailsElement>('.cp-chatgpt-compatibility'):null,compatibilityOpen=!!previousCompatibility?.open;
  const openFidelityRows=new Set(previousCompatibility?[...previousCompatibility.querySelectorAll<HTMLDetailsElement>('details')].filter(item=>item.open).map(item=>item.dataset.aimId??item.dataset.relatedCapabilityId):[]);
  current=d;root.dataset.resourceId=id;detailReveal?.show(id);
  const chatOptions=disclosure('Chat options','cp-chat-options');chatOptions.node.open=optionsOpen;
  const title=el('input');title.value=d.conversation.title;title.setAttribute('aria-label','Conversation title');const folder=select([{value:'',label:'Choose folder'},...collections.map(c=>({value:c.id,label:c.title}))]),projectSelect=select([{value:'',label:'No project'},...[...project.options].filter(p=>p.value&&p.value!=='__none').map(p=>({value:p.value,label:p.text}))],d.conversation.projectId??'');
  const favoriteControl=button(d.conversation.favorite?'Unfavorite':'Favorite',async()=>run(async()=>{await call('favorite',{resourceId:id,favorite:!d.conversation.favorite});await refresh();}),{identity:'favorite'});favoriteControl.setAttribute('aria-pressed',String(d.conversation.favorite));
  chatOptions.panel.append(field('Title',title),button('Rename',async()=>run(async()=>{await call('organize',{type:'renameConversation',resourceId:id,title:title.value,expectedRevision:d.conversation.revision,expectedVersion:d.conversation.version});await refresh();})),favoriteControl,button(d.conversation.state==='archived'?'Restore conversation':'Archive conversation',async()=>run(async()=>{await flush();await call('archive',{resourceId:id,archived:d.conversation.state!=='archived',expectedVersion:d.conversation.version});await refresh();})),field('Project association',projectSelect),button('Associate project',async()=>run(async()=>{await call('organize',{type:'associateProject',resourceId:id,projectId:projectSelect.value||null,expectedVersion:d.conversation.version});await refresh();})),field('Folder',folder),button('Add to folder',async()=>run(async()=>{const c=collections.find(c=>c.id===folder.value);if(!c)throw new Error('Choose a folder');await call('organize',{type:'membership',collectionId:c.id,resourceId:id,member:true,expectedVersion:c.version});await refresh();})),button('Remove from folder',async()=>run(async()=>{const c=collections.find(c=>c.id===folder.value);if(!c)throw new Error('Choose a folder');await call('organize',{type:'membership',collectionId:c.id,resourceId:id,member:false,expectedVersion:c.version});await refresh();})),button('Export conversation',async()=>run(async()=>{const data=await call('export',{resourceId:id});const json=JSON.stringify(data,null,2);if(options.download)options.download('conversation.json',json);else{const url=URL.createObjectURL(new Blob([json],{type:'application/json'})),link=el('a','Download export');link.href=url;link.download='conversation.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}})));
  checklistControl=null;if(options.onCreateChecklist){checklistControl=button('Create linked checklist',()=>createLinkedChecklist(id));checklistControl.dataset.aerynthMotionControl='true';checklistControl.disabled=creatingChecklist;chatOptions.panel.append(checklistControl);}
  const identity=el('div',undefined,'cp-chat-identity');identity.append(el('h3',d.conversation.title),el('p',`${d.providers.find(p=>p.id===d.conversation.providerId)?.label??d.conversation.providerId} · ${d.conversation.state}${d.conversation.favorite?' · favorite':''}`));detailHeader.replaceChildren(identity,chatOptions.node,extras);
  const lineage=renderBranchNavigator(d);
  const providers=el('details',undefined,'cp-provider-capabilities'),providerSummary=el('summary','Provider capabilities');providers.open=providerOpen;providers.append(providerSummary);decorateConversationDisclosure(providers,providerSummary,'providers');
  for(const p of d.providers){const fidelity=p.id==='chatgpt'&&p.accountFidelity?.providerId===p.id&&p.accountFidelity.schemaVersion===1?p.accountFidelity:undefined;providers.append(el('p',`${p.label}: ${p.available?'available':'unavailable'} · ${p.execute?'execution supported':'no model execution'}${p.reason&&!fidelity?' · '+p.reason:''}`,'cp-provider-summary'));
   if(fidelity){const compatibility=renderChatGPTCompatibility(fidelity,options.onOpenChatGPT?url=>void openFirstParty(url):undefined);compatibility.node.open=compatibilityOpen;compatibility.node.dataset.open=String(compatibilityOpen);for(const item of compatibility.node.querySelectorAll<HTMLDetailsElement>('details')){item.open=openFidelityRows.has(item.dataset.aimId??item.dataset.relatedCapabilityId);item.dataset.open=String(item.open);}
    if(options.onOpenChatGPT){const open=button('Open ChatGPT',()=>openFirstParty(),{identity:'providers'});open.disabled=openingChatGPT;open.title='Open the official ChatGPT site in your browser';open.dataset.firstPartyTarget='chatgpt-home';compatibility.panel.append(open);}
    providers.append(compatibility.node);}
  }
  const shares=disclosure('Published and attached excerpts · '+d.shares.length,'cp-shares');shares.panel.append(...d.shares.map(s=>renderShare(s,d)));
  secondary.replaceChildren(renderPolicy(d),lineage,providers,...(d.shares.length?[shares.node]:[]));
 };
 const loadDetail=async(aroundMessageId?:string)=>{const id=state.selectedResourceId;if(!id){const selected=collections.find(c=>c.id===state.query.collectionId&&c.state==='active');if(selected){root.dataset.collectionId=selected.id;detailHeader.replaceChildren(el('h3',selected.title),el('p','Choose a conversation or resource from this collection.'));}else{delete root.dataset.collectionId;detailHeader.replaceChildren(el('p','Open or create a conversation.'));}return;}delete root.dataset.collectionId;await bindChat(id,aroundMessageId);};
 const reloadCollections=async(provided?:Collection[])=>{collections=provided??await call('collections',{});const previous=collection.value;collection.replaceChildren(el('option','All collections'));collection.options[0].value='';for(const c of collections){const o=el('option',`${c.parentId?'↳ ':''}${c.title}${c.rule?' (smart)':''}`);o.value=c.id;collection.append(o);}collection.value=state.query.collectionId??previous;syncFilterControls();};
 type CatalogRead={collections:Collection[];list:ProductCommandMap['search']['output'];providers:ProductCommandMap['providers']['output'];projects:ProductCommandMap['projects']['output']};
 const refresh=async(provided?:CatalogRead)=>{
  const generation=++request,scope={...state.query};save();const visible=provided?.collections??await call('collections',{});
  const [list,providers,projects]=provided?[provided.list,provided.providers,provided.projects]:await Promise.all([readMatches(scope),call('providers',{}),call('projects',{})]);if(disposed||generation!==request)return;
  await reloadCollections(visible);if(disposed||generation!==request)return;
  newProviderCatalog=providers;newProvider.replaceChildren();for(const p of providers.filter(p=>p.record||p.id===explicitNewProvider)){const o=el('option',p.label+(p.record?'':' · unavailable'));o.value=p.id;o.disabled=!p.record;newProvider.append(o);}
  const preferred=explicitNewProvider??providers.find(p=>p.default&&p.available&&p.execute&&p.record)?.id??providers.find(p=>p.record&&!p.execute)?.id;
  if(preferred){if(![...newProvider.options].some(o=>o.value===preferred)){const missing=el('option','Selected provider · unavailable');missing.value=preferred;missing.disabled=true;newProvider.append(missing);}newProvider.value=preferred;}syncNewProvider();providerLabels=new Map(providers.map(provider=>[provider.id,provider.label]));renderTree(projects);renderMatches(list,providers);
  const previous=button('Previous results',async()=>run(async()=>{state.query.offset=Math.max(0,list.offset-50);await refresh();}),{identity:'previous'}),next=button('More results',async()=>run(async()=>{if(list.hasMore){state.query.offset=list.offset+50;await refresh();}}),{identity:'next'});previous.disabled=list.offset===0;next.disabled=!list.hasMore;paging.dataset.cpGroup='history-navigation';paging.replaceChildren(previous,next);paging.hidden=list.total<=50;
  // Available project IDs come from visible canonical summaries; host may also provide its normal project picker.
  const prior=project.value;project.replaceChildren();for(const p of [{value:'',label:'All projects'},{value:'__none',label:'No project'},...projects.map(p=>({value:p.id,label:p.title}))]){const o=el('option',p.label);o.value=p.value;project.append(o);}project.value=prior|| (state.query.projectId===null?'__none':state.query.projectId??'');await loadDetail(chatResource===null?selectedMessageId:undefined);
 };
 const openCollection=(collectionId:string):Promise<void>=>{
  const intent=++openIntent;request++;const operation=collectionOpening.then(async()=>{await ready;while(running)await running;if(disposed)throw new Error('conversation_manager_closed');if(intent!==openIntent)return;
   await run(async()=>{
    if(typeof collectionId!=='string'||!collectionId)throw new Error('collection_missing');
    const check=(items:Collection[])=>{if(!items.some(c=>c.id===collectionId&&c.state==='active'))throw new Error('collection_missing');};
    check(await call('collections',{}));await flush();const visible=await call('collections',{});check(visible);
    const next:SearchQuery={collectionId,offset:0},[list,providers,projects]=await Promise.all([readMatches(next),call('providers',{}),call('projects',{})]);
    if(disposed)throw new Error('conversation_manager_closed');if(intent!==openIntent)return;await detachChat();if(disposed)throw new Error('conversation_manager_closed');
    clearTimeout(searchTimer);filterQueued=false;state.selectedResourceId=null;selectedMessageId=undefined;current=null;delete root.dataset.resourceId;setHistoryQuery(next);
    query.value='';project.value='';collection.value=collectionId;archive.value='active';favorite.checked=false;folderEditor.replaceChildren();secondary.replaceChildren();extras.open=false;
    root.classList.add('cp-history-open');historyToggle.setAttribute('aria-expanded','true');await refresh({collections:visible,list,providers,projects});if(!disposed&&intent===openIntent){await saveSelection(null);if(!disposed&&intent===openIntent)query.focus();}
   },true);
  });collectionOpening=operation.catch(()=>{});return operation;
 };
 const filter=()=>{request++;setHistoryQuery({...state.query,text:query.value,projectId:project.value==='__none'?null:project.value||undefined,collectionId:collection.value||undefined,archived:archive.value==='archived',favorite:favorite.checked,sort:sort.value as SearchQuery['sort'],searchMode:searchMode.value as SearchQuery['searchMode'],offset:0});syncFilterControls();if(busy)filterQueued=true;else void run(refresh);};
 query.addEventListener('input',()=>{request++;clearSearch.hidden=!query.value;clearTimeout(searchTimer);searchTimer=setTimeout(filter,180);});for(const control of [project,collection,archive,favorite,sort,searchMode])control.addEventListener('change',filter);
 createForm.addEventListener('submit',event=>{event.preventDefault();void run(async()=>{const c=await call('create',{title:newTitle.value.trim()||'New conversation',...(explicitNewProvider?{providerId:explicitNewProvider}:{}),commandId:crypto.randomUUID()});newTitle.value='';newChat.node.open=false;await open(c.resourceId);await refresh();chat?.focusComposer();});});
 createFolder.addEventListener('submit',event=>{event.preventDefault();void run(async()=>{const parentId=state.query.collectionId,created=await call('organize',{type:'createCollection',title:folderTitle.value,projectId:state.query.projectId??collections.find(item=>item.id===parentId)?.projectId??null});await reloadCollections();const c=createdCollection(created);if(parentId)await call('collectionRule',{collectionId:c.id,parentId,rule:null,expectedVersion:c.version,expectedRuleRevision:c.ruleRevision});folderTitle.value='';await refresh();});});
 root.addEventListener('toggle',event=>{const opened=event.target as HTMLDetailsElement;if(opened.tagName!=='DETAILS'||!opened.open||opened.closest('.cp-library-tree'))return;for(const other of root.querySelectorAll<HTMLDetailsElement>('details[open]'))if(!other.closest('.cp-library-tree')&&other!==opened&&!other.contains(opened)&&!opened.contains(other))other.open=false;},true);
 root.addEventListener('keydown',event=>{if(event.key==='Escape'){
  const target=event.target as HTMLElement,active=target.closest<HTMLDetailsElement>('details[open]')??[...root.querySelectorAll<HTMLDetailsElement>('details[open]')].at(-1);
  event.preventDefault();event.stopPropagation();if(active){active.open=false;active.querySelector('summary')?.focus();return;}void closeManager();
 }});
 const ready=run(async()=>{
  if(options.viewPersistence&&!state.selectedResourceId&&!state.query.text&&!state.query.collectionId&&state.query.projectId===undefined&&openIntent===0&&viewNavigation===0){const generation=request,nav=viewNavigation;try{const saved=await options.viewPersistence.restore();if(!disposed&&!closing&&request===generation&&openIntent===0&&viewNavigation===nav&&saved.selected.resourceId){state.selectedResourceId=saved.selected.resourceId;restoredView=saved.view;root.classList.remove('cp-history-open');historyToggle.setAttribute('aria-expanded','false');}}catch{if(!disposed)status.textContent='Saved conversation selection is unavailable.';}}
  if(disposed||closing)return;await refresh();if(options.resourceId&&openIntent===0&&current?.conversation.resourceId===options.resourceId&&current.conversation.state==='active')await saveSelection(options.resourceId);
 });return {ready,state,flush,frame(){if(disposed)return;syncPickers(false);disclosures?.frame();for(const picker of pickers.values())picker.frame();controlStates?.frame();drawer?.frame();detailReveal?.frame();chat?.frame();},beginProviderContinuation,refresh:()=>run(refresh),open:requestOpen,openCollection,openSwitcher,async dispose(){if(disposed)return;viewNavigation++;openIntent++;await flush();await detachChat();disposed=true;for(const picker of pickers.values())picker.dispose();pickers.clear();controlStates?.dispose();disclosures?.dispose();drawer?.dispose();detailReveal?.dispose();request++;switchGeneration++;clearTimeout(searchTimer);clearTimeout(switchTimer);root.remove();
  if(detachedSubmissions.size)void Promise.allSettled([...detachedSubmissions]).then(()=>Promise.allSettled([...ownedDraftSessions].map(session=>session.dispose()))).catch(()=>{});
  else await Promise.all([...ownedDraftSessions].map(session=>session.dispose()));
 }};
}
