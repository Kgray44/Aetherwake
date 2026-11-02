import type { ConversationProductPort, Detail, MessageView } from './contracts.ts';
import type { PublicConversationExecution } from '../../application-contract/contracts.ts';
import { ConversationDraftSession, type DraftSessionSnapshot } from './draft-session.ts';
import { renderMarkdown } from './markdown.ts';
import type { ExperienceMotionPort, ExperiencePose } from '../../application-contract/motion.ts';
import { mountConversationPicker, conversationControlStates, type ConversationPicker } from './picker.ts';
let chatSerial=0;

export type ConversationExecution = PublicConversationExecution;
export type ConversationControlIdentity = 'action'|'new-chat'|'create-chat'|'history'|'close'|'search'|'clear-search'|'filters'|'organize'|'chat-options'|'branches'|'branch-policy'|'lineage'|'providers'|'shares'|'new-folder'|'manage-folder'|'favorite'|'history-result'|'previous'|'next'|'send'|'stop'|'message-actions'|'copy'|'quote'|'source'|'branch'|'publish'|'source-excerpt'|'draft-conflict'|'draft-recovery';
export type ConversationControlPresentation = { identity: ConversationControlIdentity; emphasis?: 'primary'|'secondary'|'quiet'|'danger'; label?: string };
/** Semantic styling hooks only. Native buttons/summaries retain their actual keyboard and disabled behavior. */
export function decorateConversationControl(node: HTMLElement, presentation: ConversationControlPresentation): void {
  const label=presentation.label??node.textContent??'',glyph=document.createElement('span'),caption=document.createElement('span');
  glyph.className='cp-control-glyph';glyph.dataset.glyph=presentation.identity;glyph.setAttribute('aria-hidden','true');caption.className='cp-control-label';caption.textContent=label;
  node.classList.add('cp-control');node.dataset.cpControl=presentation.identity;node.dataset.emphasis=presentation.emphasis??'quiet';node.replaceChildren(glyph,caption);
  node.dataset.aerynthMotionControl='true';
  if(presentation.identity==='copy')node.dataset.nativeCopyControl='true';
}
export function setConversationControlLabel(node: HTMLElement, label: string): void {
  const caption=node.querySelector<HTMLElement>('.cp-control-label');if(caption)caption.textContent=label;else node.textContent=label;
}
let disclosureId=0;
export function decorateConversationDisclosure(node: HTMLDetailsElement, summary: HTMLElement, identity: ConversationControlIdentity, panel?: HTMLElement): void {
  node.dataset.cpDisclosure=identity;node.dataset.open=String(node.open);decorateConversationControl(summary,{identity,emphasis:'secondary'});
  if(panel){panel.id||=`cp-control-group-${++disclosureId}`;panel.dataset.cpGroup=identity;panel.setAttribute('role','group');panel.setAttribute('aria-label',summary.textContent??identity);summary.setAttribute('aria-controls',panel.id);}
  node.addEventListener('toggle',()=>{node.dataset.open=String(node.open);});
}
/** The host translates only observed assistant text deltas; never reasoning/tool summaries or fabricated approval events. */
export type ConversationExecutionObservation = {
  execution?: ConversationExecution; connection?: 'available'|'unavailable'; resourceAvailable?: boolean;
  /** Complete, access-checked live buffer from the same canonical execution, through cursor. */
  preview?: { executionId: string; cursor: number; text: string };
  delta?: { eventId: string; cursor: number; text: string };
};
export interface ConversationExecutionPort {
  observe(resourceId: string, listener: (observation: ConversationExecutionObservation) => void): () => void;
  cancel(executionId: string): Promise<unknown>;
}
export type MessageSelection = { start: number; end: number; text: string };
export type ConversationMessageAction = { action: 'branch'|'source'|'publish'; message: MessageView; selection?: MessageSelection };
export type ConversationChatPresentation = 'workspace'|'focused';
export type ConversationProviderChange = {resourceId:string;targetProviderId:string;expectedRevision:number;mode:'empty'|'continuation'};
export interface ConversationChatOptions {
  port: ConversationProductPort; resourceId: string;
  presentation?: ConversationChatPresentation;
  /** Externally sized ancestor (for example the canonical folio), never an auto-sized chat/content node. */
  layoutHost?: HTMLElement;
  /** Externally supplied sessions remain owned by the caller. */
  draftSession?: ConversationDraftSession; initialDraft?: string; initialScroll?: number; initialOffset?: number;
  execution?: ConversationExecutionPort; copy?: (text: string) => Promise<void>;
  motion?:ExperienceMotionPort;viewId?:string;
  /** Presentation hint only. Canonical source/binding/revision checks stay in the host. */
  onProviderChange?:(event:ConversationProviderChange)=>void|Promise<void>;
  onDetail?: (detail: Detail) => void; onUnavailable?: () => void; onChanged?: () => void | Promise<void>;
  onMessageAction?: (event: ConversationMessageAction) => void | Promise<void>;
  onViewState?: (state: { resourceId: string; content: string; scroll: number; offset: number }) => void;
}
export interface ConversationChat {
  ready: Promise<void>; refresh(options?: { aroundMessageId?: string; latest?: boolean }): Promise<void>;
  focusComposer(): void; flush(): Promise<void>; dispose(): Promise<void>;
  setPresentation(mode: ConversationChatPresentation): void;
  frame():void;
  /** Explicit receipt/lifecycle observation only. Closing or editor draining must not await a provider turn. */
  whenSubmissionSettled(): Promise<void>;
}
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
/** Copy follows the actual provider ID, never the first executable catalog row. */
function providerCopy(id:string){
  const local=id==='local'||id==='mock-ordinary',codex=id==='codex-app-server'||id==='fixture-codex',plan=id==='chatgpt-plan-responses';
  return {local,empty:local?'A place to think. Your messages stay in this local chat.':codex?'Start a conversation with Codex. Each send uses the native approval path.':plan?'Start a conversation. History is saved in Aerynth.':'Start a conversation.',
   placeholder:local?'Write a message…':codex?'Ask Codex anything…':'Ask anything…',
   title:local?'Local recording · no model execution':codex?'Native approval is required before a Codex turn':plan?'ChatGPT plan · history saved in Aerynth':'Provider availability is checked before send',
   capability:local?'Local recording · no model responses':codex?'Each send requires native approval.':plan?'ChatGPT plan access · history saved in Aerynth':'Availability is checked before send.',
   kind:codex?'native-approval':plan?'ordinary-plan':'provider-connection',pending:local?'Saving message…':plan?'Preparing your message. Your draft remains saved.':'Waiting for native send review. Your draft remains saved.'};
}
function canonicalClock(createdAt:string,formats:{parts:Intl.DateTimeFormat;day:Intl.DateTimeFormat;time:Intl.DateTimeFormat}){
  const instant=new Date(createdAt);
  if(!Number.isFinite(instant.getTime()))return {day:'unavailable',dayLabel:'Date unavailable',time:'Time unavailable'};
  const parts=formats.parts.formatToParts(instant),part=(type:string)=>parts.find(p=>p.type===type)?.value??'';
  return {day:`${part('year')}-${part('month')}-${part('day')}`,dayLabel:formats.day.format(instant),time:formats.time.format(instant)};
}
export function composerShouldSubmit(event: Pick<KeyboardEvent, 'key'|'shiftKey'|'isComposing'|'altKey'|'ctrlKey'|'metaKey'>): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing && !event.altKey && (!event.ctrlKey || !event.metaKey);
}
/** A successful RPC or execution receipt alone is insufficient to discard a durable draft. */
export function acceptedConversationSubmission(input: { resourceId:string;providerId:string;content:string;commandId:string;revision:number;priorMessageIds:readonly string[] }, result: unknown, after?: {conversation:{resourceId:string;revision:number};messages:{items:{id:string;resourceId:string;inherited:boolean;role:string;content:string}[]}}): boolean {
  if (!result || typeof result !== 'object') return false; const value = result as Record<string, unknown>;
  if (value.resourceId !== input.resourceId || typeof value.id !== 'string') return false;
  if (value.role === 'user' && value.content === input.content && typeof value.revision === 'number' && value.revision > input.revision) return true;
  return value.commandId === input.commandId && value.providerId === input.providerId && ['running','provider_completed'].includes(String(value.state)) && after?.conversation.resourceId === input.resourceId && after.conversation.revision > input.revision && after.messages.items.some(m => m.resourceId === input.resourceId && !m.inherited && m.role === 'user' && m.content === input.content && !input.priorMessageIds.includes(m.id)) === true;
}

/** One canonical chat, independent of its block/panel placement. No store, provider connection or authorization issuance. */
export function mountConversationChat(container: HTMLElement, options: ConversationChatOptions): ConversationChat {
  const { port, resourceId } = options;
  if(options.motion&&!options.viewId?.trim())throw new Error('conversation_motion_identity_required');
  let presentation=options.presentation??'focused';if(presentation!=='workspace'&&presentation!=='focused')throw new Error('invalid_chat_presentation');
  const layoutHost=options.layoutHost??container.closest<HTMLElement>('.cp-manager');
  if(layoutHost&&(!layoutHost.contains(container)||layoutHost.matches('.cp-chat')||(layoutHost.style.height??'').trim()==='auto'||!Number.isFinite(layoutHost.clientHeight)||layoutHost.clientHeight<0||(layoutHost.clientWidth!==undefined&&(!Number.isFinite(layoutHost.clientWidth)||layoutHost.clientWidth<0))))throw new Error('invalid_chat_layout_host');
  if (options.draftSession && options.draftSession.resourceId !== resourceId) throw new Error('draft_resource_mismatch');
  const root = el('section', undefined, 'cp-chat aw-optical-controls'); root.dataset.resourceId = resourceId; root.setAttribute('aria-label', 'Chat');
  const top=el('div',undefined,'cp-chat-top'),providerSlot=el('div',undefined,'cp-chat-provider-slot');top.append(providerSlot);
  const messages = el('div', undefined, 'cp-messages'); messages.tabIndex = 0; messages.setAttribute('aria-label', 'Conversation messages');
  const paging = el('div', undefined, 'cp-paging'), stream = el('article', undefined, 'cp-stream'), streamText = el('pre', '', 'cp-stream-text'); stream.append(el('p', 'Observed live output', 'cp-message-source'), streamText); stream.hidden = true;
  const status = el('p', '', 'cp-chat-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const composer = el('form', undefined, 'cp-composer'), textarea = el('textarea'), tools = el('div', undefined, 'cp-composer-tools'), provider = el('span', '', 'cp-composer-provider'), send = el('button', 'Send'), stop = el('button', 'Stop'), hint = el('span', 'Enter to send · Shift+Enter for a new line', 'cp-composer-hint');
  textarea.setAttribute('aria-label', 'Message'); textarea.placeholder = 'Ask anything, or share an idea'; textarea.rows = 2;
  send.type = 'submit'; send.setAttribute('aria-label', 'Send message'); stop.type = 'button'; stop.hidden = true; tools.append(hint, stop, send); composer.append(textarea, tools);providerSlot.append(provider);provider.classList.add('cp-chat-provider-label');
  decorateConversationControl(send,{identity:'send',emphasis:'primary'});decorateConversationControl(stop,{identity:'stop',emphasis:'secondary'});tools.dataset.cpGroup='composer';tools.setAttribute('role','group');tools.setAttribute('aria-label','Message controls');
  const capabilityNote=el('p','','cp-capability-note'),contextNote=el('p','','cp-context-note'),draftStatus = el('p', '', 'cp-draft-status'), recovery = el('div', undefined, 'cp-draft-recovery'); draftStatus.setAttribute('role', 'status');
  const recoveryDetails = el('details', undefined, 'cp-draft-conflict'), recoverySummary = el('summary', 'Review draft conflict'), localText = el('pre'), storedText = el('pre');
  const keep = el('button', 'Keep this editor’s draft'), useStored = el('button', 'Use the stored draft'), retry = el('button', 'Retry draft recovery'), reviewed = el('button', 'I reviewed the send outcome');
  for (const b of [keep,useStored,retry,reviewed]) b.type = 'button';
  for (const b of [keep,useStored,retry,reviewed])decorateConversationControl(b,{identity:'draft-recovery',emphasis:'secondary'});
  recoveryDetails.append(recoverySummary, el('p','This editor'),localText,el('p','Stored draft'),storedText,keep,useStored);
  decorateConversationDisclosure(recoveryDetails,recoverySummary,'draft-conflict');
  const feedback=el('div',undefined,'cp-chat-feedback'),feedbackLine=el('div',undefined,'cp-feedback-line'),feedbackToggle=el('button','Details','cp-feedback-toggle'),feedbackBody=el('div',undefined,'cp-chat-inspection'),feedbackContents=el('div',undefined,'cp-chat-inspection-content'),statusDetail=el('p','','cp-status-detail');
  feedbackToggle.type='button';feedbackToggle.dataset.aerynthMotionControl='true';feedbackToggle.setAttribute('aria-expanded','false');feedbackToggle.setAttribute('aria-label','Conversation status, context and draft details');feedbackBody.id='cp-chat-inspection-'+ ++chatSerial;feedbackToggle.setAttribute('aria-controls',feedbackBody.id);feedbackBody.hidden=true;feedbackBody.inert=true;feedbackContents.append(statusDetail,capabilityNote,contextNote,draftStatus,recovery);feedbackBody.append(feedbackContents);feedbackLine.append(status,feedbackToggle);feedback.append(feedbackLine);
  root.append(top,messages,paging,feedback,composer);messages.append(stream,feedbackBody);container.append(root);
  let disposed = false, generation = 0, current: Detail|null = null, offset = options.initialOffset, sending = false, uncertain = false, recovering = false, composing = false;
  let sendTask: Promise<void>|null = null, cancelPending = false, streamLimited = false, accessRevoked = false;
  let pendingFollow:{messageId?:string}|null=null;
  let execution: ConversationExecution|null = null, unsubscribeExecution: (()=>void)|undefined, streamExecution = '', lastCursor = -1, connection: 'available'|'unavailable' = 'available';
  const seenEvents = new Set<string>(), cache = new Map<string,{signature:string;node:HTMLElement}>();
  const days = new Map<string,{day:string;node:HTMLElement}>();
  const controlStates=options.motion?conversationControlStates(root,{motion:options.motion,viewId:options.viewId!}):null;
  let feedbackOpen=false,feedbackHeight=0,feedbackBarHeight=-1,inspectionFollow=false,liveFollow=false,inspectionReturn:number|null=null;
  const feedbackKey=options.viewId+':feedback',feedbackBarKey=options.viewId+':feedback-bar',feedbackPose=(h:number,opacity:number):ExperiencePose=>({x:0,y:0,w:0,h,lift:0,yaw:0,opacity});
  options.motion?.add(feedbackKey,feedbackPose(0,0));options.motion?.add(feedbackBarKey,feedbackPose(0,0));
  const reconcileFeedback=()=>{if(feedbackOpen){const height=feedbackContents.scrollHeight;if(height!==feedbackHeight){feedbackHeight=height;options.motion?.target(feedbackKey,feedbackPose(height,1),'conversation feedback content');options.motion?.wake();}}};
  const renderFeedback=()=>{const phase=session.snapshot().phase,notice=!!status.textContent&&status.dataset.statusKind!=='send-accepted';feedbackToggle.textContent=phase==='conflict'?'Review draft conflict':phase==='error'?'Review draft recovery':uncertain?'Review send outcome':'Details';feedbackToggle.hidden=!feedbackOpen&&!uncertain&&phase==='clean'&&!notice&&!contextNote.textContent&&current?.providers.find(p=>p.id===current?.conversation.providerId)?.available!==false;const cap=presentation==='workspace'?22:availableHeight>0&&availableHeight<280?28:48,height=feedbackToggle.hidden&&!status.textContent?0:Math.min(cap,feedbackLine.scrollHeight);if(height!==feedbackBarHeight){feedbackBarHeight=height;options.motion?.target(feedbackBarKey,feedbackPose(height,Number(height>0)),'conversation feedback summary');options.motion?.wake();}reconcileFeedback();};
  feedbackToggle.addEventListener('click',()=>{feedbackOpen=!feedbackOpen;feedbackToggle.setAttribute('aria-expanded',String(feedbackOpen));feedbackBody.inert=!feedbackOpen;liveFollow=false;if(feedbackOpen){inspectionReturn=messages.scrollTop;inspectionFollow=true;feedbackBody.hidden=false;feedbackHeight=0;reconcileFeedback();}else{inspectionFollow=false;if(inspectionReturn!==null)messages.scrollTop=inspectionReturn;inspectionReturn=null;if(options.motion){options.motion.target(feedbackKey,feedbackPose(0,0),'conversation feedback close');options.motion.wake();}else feedbackBody.hidden=true;}renderFeedback();});
  feedbackBody.addEventListener('focusin',()=>{inspectionFollow=false;inspectionReturn=null;});
  feedbackBody.addEventListener('toggle',()=>{reconcileFeedback();},true);
  let providerPicker:ConversationPicker|null=null;
  if(options.motion&&options.onProviderChange){provider.hidden=true;providerPicker=mountConversationPicker(providerSlot,{motion:options.motion,viewId:options.viewId!+':provider',label:'Conversation provider',identity:'providers',async onSelect(targetProviderId){
    const before=current;if(!before||accessRevoked||sending||active()||before.conversation.state==='archived')return;
    const empty=before.messages.total===0&&before.messages.items.length===0&&['local','mock-ordinary','chatgpt-plan-responses'].includes(before.conversation.providerId),mode=empty?'empty':'continuation';
    await options.onProviderChange!({resourceId,targetProviderId,expectedRevision:before.conversation.revision,mode});
    if(!disposed&&mode==='empty')textarea.focus({preventScroll:true});
  },onError:()=>report('Provider selection could not be confirmed. Refresh this conversation before retrying.')});}
  const session = options.draftSession ?? new ConversationDraftSession({ resourceId, port, ...(options.initialDraft === undefined ? {} : { initialContent: options.initialDraft }) });
  const copy = options.copy ?? (text => navigator.clipboard.writeText(text));
  const report = (text: string,kind:'notice'|'send-accepted'='notice') => { if (!disposed){status.textContent=statusDetail.textContent=text;status.dataset.statusKind=kind;renderFeedback();} };
  const active = () => execution && ['dispatching','running'].includes(execution.state);
  const viewState = () => options.onViewState?.({resourceId,content:textarea.value,scroll:messages.scrollTop,offset:current?.messages.offset??offset??0});
  let measuredHeight=layoutHost?.clientHeight??0,measuredWidth=layoutHost?.clientWidth??0,availableHeight=measuredHeight,layoutHidden=!!layoutHost&&measuredHeight===0;
  let measureKey='',naturalHeight=0,resizeFrame:number|undefined,resizeTimer:ReturnType<typeof setTimeout>|undefined;
  const cancelResize=()=>{if(resizeFrame!==undefined){if(typeof cancelAnimationFrame==='function')cancelAnimationFrame(resizeFrame);resizeFrame=undefined;}if(resizeTimer!==undefined){clearTimeout(resizeTimer);resizeTimer=undefined;}};
  const resize = () => {
    if(disposed||layoutHidden)return;
    // Bounds belong to the external host. Reading our auto-sized root here creates a feedback edge.
    let height=measuredHeight;const manager=layoutHost?.matches('.cp-manager');
    if(layoutHost&&height>0){const host=layoutHost.getBoundingClientRect(),slot=container.getBoundingClientRect(),scale=host.height/(layoutHost.offsetHeight||layoutHost.clientHeight||height);if(Number.isFinite(scale)&&scale>0)height=Math.max(0,height-Math.max(0,(slot.top-host.top)/scale));}
    availableHeight=height;const compact=presentation==='workspace'||(measuredHeight>0&&height<(manager?420:280));
    if(root.dataset.presentation!==presentation){root.dataset.presentation=presentation;root.classList.add('cp-chat-'+presentation);root.classList.remove('cp-chat-'+(presentation==='workspace'?'focused':'workspace'));}
    const wasCompact=root.className.split(/\s+/).includes('cp-chat-compact');if(wasCompact!==compact){if(compact)root.classList.add('cp-chat-compact');else root.classList.remove('cp-chat-compact');}
    const rows=compact?1:2;if(textarea.rows!==rows)textarea.rows=rows;
    const font=typeof getComputedStyle==='function'?getComputedStyle(textarea):null;
    const key=JSON.stringify([textarea.value,textarea.clientWidth,rows,font?.font,font?.lineHeight,font?.letterSpacing,font?.paddingTop,font?.paddingBottom]);
    if(key!==measureKey){
      // Only content/width/type changes require a temporary shrink to measure natural height.
      // This never runs in ResizeObserver delivery and repeated unchanged frames do not write.
      if(textarea.style.height!=='0px')textarea.style.height='0px';naturalHeight=textarea.scrollHeight;measureKey=key;
    }
    const minimum=compact?34:56,cap=compact?96:200,maximum=height>0?Math.max(minimum,Math.min(cap,height*(compact ? .25 : .35))):cap;
    const next=Math.floor(Math.min(maximum,Math.max(minimum,naturalHeight)))+'px';if(textarea.style.height!==next)textarea.style.height=next;
    renderFeedback();
  };
  const scheduleResize=()=>{if(disposed||layoutHidden||resizeFrame!==undefined||resizeTimer!==undefined)return;const reconcile=()=>{resizeFrame=undefined;resizeTimer=undefined;resize();drainPendingFollow();};if(typeof requestAnimationFrame==='function')resizeFrame=requestAnimationFrame(reconcile);else resizeTimer=setTimeout(reconcile,0);};
  let observedHost=false;
  const resizeObserver=!layoutHost||typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(entries=>{
    const entry=entries.find(value=>value.target===layoutHost);if(disposed||!entry)return;
    const {height,width}=entry.contentRect;if(!Number.isFinite(height)||!Number.isFinite(width)||height<=0||width<=0){layoutHidden=true;cancelResize();return;}
    const changed=!observedHost||layoutHidden||height!==measuredHeight||width!==measuredWidth;observedHost=true;layoutHidden=false;measuredHeight=height;measuredWidth=width;if(changed)scheduleResize();
  });
  if(layoutHost)resizeObserver?.observe(layoutHost);
  function revokeView() {
    const notify=!accessRevoked;accessRevoked=true;generation++;pendingFollow=null;inspectionFollow=liveFollow=false;inspectionReturn=null;root.dataset.resourceAvailable='false';current=null;cache.clear();days.clear();messages.replaceChildren(stream,feedbackBody);
    streamText.textContent='';stream.hidden=true;paging.hidden=true;capabilityNote.textContent=contextNote.textContent='';seenEvents.clear();lastCursor=-1;streamLimited=false;
    renderDraft();if(notify)options.onUnavailable?.();report('This conversation is no longer available. Its draft is retained.');
  }
  function renderDraft(snapshot: DraftSessionSnapshot = session.snapshot()) {
    if (disposed) return;
    if(providerPicker){providerPicker.update({items:current?.providers.map(item=>({value:item.id,label:item.label,disabled:!item.available||!item.record,description:item.reason}))??[],value:current?.conversation.providerId??'',disabled:!current||accessRevoked||sending||!!active()||current.conversation.state==='archived'});}
    // Do not assign equal values: native caret, selection and composition remain intact.
    if (textarea.value !== snapshot.content) { const start = textarea.selectionStart, end = textarea.selectionEnd; textarea.value = snapshot.content; if (document.activeElement === textarea) textarea.setSelectionRange(Math.min(start,snapshot.content.length),Math.min(end,snapshot.content.length)); resize(); }
    draftStatus.dataset.phase = draftStatus.dataset.draftState = snapshot.phase; draftStatus.dataset.version = snapshot.version === null ? '' : String(snapshot.version);
    draftStatus.textContent = snapshot.phase === 'clean' ? (snapshot.content ? 'Draft saved' : '') : snapshot.phase === 'saving' ? 'Saving draft…' : snapshot.phase === 'dirty' ? 'Unsaved changes' : snapshot.phase === 'loading' ? 'Loading saved draft…' : snapshot.phase === 'conflict' ? 'This draft changed in another view. Choose which text to keep.' : 'Draft recovery needs attention: '+snapshot.error;
    if (snapshot.remote) {
      localText.textContent = snapshot.content; storedText.textContent = snapshot.remote.content;
      if (recoveryDetails.parentNode !== recovery) { recovery.replaceChildren(recoveryDetails); recoveryDetails.open = true; }
    } else if (snapshot.phase === 'error') { if (retry.parentNode !== recovery) recovery.replaceChildren(retry); }
    else if (!uncertain) recovery.replaceChildren();
    if (uncertain && reviewed.parentNode !== recovery) recovery.append(el('p','Send acceptance is not confirmed. Your draft is retained; inspect the chat before retrying.'),reviewed);
    keep.disabled = useStored.disabled = retry.disabled = recovering;
    send.disabled = sending || !!active() || uncertain || !current || current.conversation.state !== 'active' || ['loading','conflict','error'].includes(snapshot.phase) || !snapshot.content.trim();
    send.dataset.state=uncertain?'review-required':sending?'pending':active()?'executing':send.disabled?'unavailable':'ready';stop.dataset.state=cancelPending?'requested':active()?'available':'inactive';
    stop.hidden = !active() || !options.execution; stop.disabled = cancelPending || connection==='unavailable';composer.hidden = !current || current.conversation.state === 'archived'; recovery.hidden = draftStatus.hidden = !current; renderFeedback();viewState();
  }
  const unsubscribeDraft = session.subscribe(renderDraft);
  async function recover(work: ()=>Promise<void>) { if (recovering) return; recovering = true; renderDraft(); try { await work(); } catch (error) { report(errorText(error)); } finally { recovering = false; renderDraft(); } }
  keep.addEventListener('click', () => { const remote = session.snapshot().remote; if (remote) void recover(()=>session.resolve('keep-local',remote.version)); });
  useStored.addEventListener('click', () => { const remote = session.snapshot().remote; if (remote) void recover(()=>session.resolve('use-stored',remote.version)); });
  retry.addEventListener('click', () => { void recover(async()=>{await session.reload();await session.flush();}); });
  reviewed.addEventListener('click', () => { uncertain = false; recovery.replaceChildren(); renderDraft(); });
  textarea.addEventListener('input', () => { if(status.dataset.statusKind==='send-accepted'&&textarea.value!==session.snapshot().content)report('');session.update(textarea.value);resize(); });
  textarea.addEventListener('compositionstart',()=>{composing=true;});textarea.addEventListener('compositionend',()=>{composing=false;});
  textarea.addEventListener('keydown', event => { if (!composing && composerShouldSubmit(event)) { event.preventDefault(); if (!send.disabled) composer.requestSubmit(); } });
  messages.addEventListener('scroll', viewState, {passive:true});
  for(const name of ['wheel','pointerdown','touchstart'])messages.addEventListener(name,()=>{pendingFollow=null;inspectionFollow=liveFollow=false;inspectionReturn=null;},{passive:true});
  messages.addEventListener('keydown',event=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key)){pendingFollow=null;inspectionFollow=liveFollow=false;inspectionReturn=null;}});
  const doAction = (event: ConversationMessageAction) => { Promise.resolve(options.onMessageAction?.(event)).catch(error=>report(errorText(error))); };
  function messageNode(message: MessageView,clock:ReturnType<typeof canonicalClock>): HTMLElement {
    const signature = JSON.stringify([message,clock]), cached = cache.get(message.id); if (cached?.signature === signature) return cached.node;
    const article = el('article', undefined, 'cp-message cp-message-'+message.role); article.dataset.messageId = message.id; article.dataset.sourceResourceId = message.resourceId;
    // MessageView has no per-message provider binding: never relabel old assistant output after a provider change.
    const attribution = message.role === 'user' ? 'You' : message.role === 'assistant' ? (message.provenance==='mock_adapter'?'Assistant · simulated source':'Assistant') : message.role;
    const by = el('p', attribution+(message.inherited?' · inherited source':'')+(message.outputState==='partial'?' · partial response':''), 'cp-message-source'); by.title = message.provenance+' · '+message.createdAt;article.dataset.outputState=message.outputState??'';
    const time=el('time',clock.time,'cp-message-time');if(clock.day!=='unavailable')time.setAttribute('datetime',message.createdAt);by.append(document.createTextNode(' · '),time);
    const content = message.role === 'assistant' ? renderMarkdown(message.content,copy,report) : el('div',message.content); content.classList.add('cp-message-content');
    const actions = el('details', undefined, 'cp-message-actions'), summary = el('summary','Message actions'), panel = el('div',undefined,'cp-disclosure-panel'); actions.append(summary,panel);
    decorateConversationDisclosure(actions,summary,'message-actions',panel);
    const action = (label:string, work:()=>void|Promise<void>,identity:ConversationControlIdentity='action') => { const b = el('button',label); b.type='button';decorateConversationControl(b,{identity}); b.addEventListener('click',()=>{if(!b.disabled)Promise.resolve(work()).catch(error=>report(errorText(error)));});panel.append(b);return b; };
    action('Copy',async()=>{await copy(message.content);report('Copied');actions.open=false;},'copy');
    action('Quote',()=>{session.update(session.snapshot().content+(session.snapshot().content?'\n\n':'')+`> ${message.content.replaceAll('\n','\n> ')}\n`);actions.open=false;textarea.focus();},'quote');
    if (options.onMessageAction) {
      action('Source',()=>doAction({action:'source',message}),'source'); action('Branch from here',()=>{actions.open=false;doAction({action:'branch',message});},'branch');
      const source = el('pre',message.content,'cp-message-raw'), note = el('p','Select an exact source passage below to publish an excerpt. Markdown source offsets are preserved.','cp-selection-note');
      const sourceDisclosure = el('details'), sourceSummary = el('summary','Select source excerpt'); sourceDisclosure.append(sourceSummary,note,source);panel.append(sourceDisclosure);
      decorateConversationDisclosure(sourceDisclosure,sourceSummary,'source-excerpt');
      let selection: MessageSelection|null = null;
      const publish = action('Publish selected excerpt',()=>{if(selection&&message.content.slice(selection.start,selection.end)===selection.text)doAction({action:'publish',message,selection});},'publish');publish.disabled=true;
      const capture = () => {
        const selected=window.getSelection();selection=null;
        if (selected && !selected.isCollapsed && selected.rangeCount && selected.anchorNode && selected.focusNode && source.contains(selected.anchorNode) && source.contains(selected.focusNode)) {
          const range=selected.getRangeAt(0),before=document.createRange();before.selectNodeContents(source);before.setEnd(range.startContainer,range.startOffset);
          const start=before.toString().length,text=range.toString();if(text&&message.content.slice(start,start+text.length)===text)selection={start,end:start+text.length,text};
        }
        publish.disabled=!selection;
      };
      source.addEventListener('mouseup',capture);source.addEventListener('keyup',capture);publish.addEventListener('pointerdown',capture);
    }
    article.append(by,content,actions); cache.set(message.id,{signature,node:article});return article;
  }
  function followLatestContent(messageId?:string):boolean {
    const viewport=messages.getBoundingClientRect();if(messages.clientHeight<=0||viewport.height<=0)return false;
    if(presentation!=='workspace'&&!messageId){messages.scrollTop=messages.scrollHeight;return true;}
    const content=messageId?messages.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`)?.querySelector<HTMLElement>('.cp-message-content'):[...messages.querySelectorAll<HTMLElement>('.cp-message-content')].at(-1);if(!content)return !messageId&&current?.messages.items.length===0;
    const box=content.getBoundingClientRect(),scale=viewport.height/(messages.offsetHeight||messages.clientHeight);
    if(!Number.isFinite(scale)||scale<=0||box.height<=0)return false;
    // Action summaries/margins follow the text in flow. Following scrollHeight can show only
    // that footer in a short card. Move this scroller alone to the canonical content's end.
    const bottom=viewport.top+((messages.clientTop||0)+messages.clientHeight)*scale;
    messages.scrollTop=Math.max(0,Math.min(messages.scrollHeight-messages.clientHeight,messages.scrollTop+(box.bottom-bottom)/scale));
    return true;
  }
  function drainPendingFollow(){if(pendingFollow&&followLatestContent(pendingFollow.messageId))pendingFollow=null;}
  function render(detail: Detail, around?:string,followMessageId?:string) {
    const nearBottom = messages.scrollHeight-messages.scrollTop-messages.clientHeight < 80, scroll = messages.scrollTop;
    current=detail; const nodes:HTMLElement[]=[],formats={parts:new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit'}),day:new Intl.DateTimeFormat(undefined,{year:'numeric',month:'long',day:'numeric'}),time:new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'})};let previousDay:string|undefined;
    for(const message of detail.messages.items){const clock=canonicalClock(message.createdAt,formats);if(clock.day!==previousDay){let cached=days.get(message.id);if(!cached||cached.day!==clock.day){const divider=el('div',undefined,'cp-chat-day'),label=el('span',clock.dayLabel),line=el('hr');divider.dataset.day=clock.day;divider.dataset.beforeMessageId=message.id;divider.setAttribute('role','separator');divider.setAttribute('aria-label',clock.dayLabel);label.setAttribute('aria-hidden','true');line.setAttribute('aria-hidden','true');divider.append(label,line);cached={day:clock.day,node:divider};days.set(message.id,cached);}nodes.push(cached.node);previousDay=clock.day;}nodes.push(messageNode(message,clock));}
    const copy=providerCopy(detail.conversation.providerId);
    if (!nodes.length) nodes.push(el('div',copy.empty,'cp-chat-empty'));
    nodes.push(stream,feedbackBody);
    for(const child of [...messages.children])if(!nodes.includes(child as HTMLElement))child.remove();
    nodes.forEach((node,i)=>{if(messages.children[i]!==node)messages.insertBefore(node,messages.children[i]??null);});
    for(const [id,value]of cache)if(!nodes.includes(value.node))cache.delete(id);
    for(const [id,value]of days)if(!nodes.includes(value.node))days.delete(id);
    provider.textContent=detail.providers.find(p=>p.id===detail.conversation.providerId)?.label??detail.conversation.providerId;
    provider.dataset.providerId=detail.conversation.providerId;
    const local=copy.local;textarea.placeholder=copy.placeholder;setConversationControlLabel(send,local?'Record message':'Send');
    provider.title=detail.providers.find(p=>p.id===detail.conversation.providerId)?.reason??copy.title;
    const capability=detail.providers.find(p=>p.id===detail.conversation.providerId),normalLocal=detail.conversation.providerId==='local'&&capability?.available&&capability.record&&!capability.execute&&!capability.simulated;
    capabilityNote.dataset.capabilityKind=normalLocal?'local-recording':capability?.reason||capability?.available===false?'provider-reason':local?'local-compatibility':copy.kind;
    capabilityNote.textContent=capability?.reason??(capability?.available===false?'This provider is unavailable for new turns.':copy.capability);
    const attached=detail.shares.filter(s=>s.attached&&s.status==='current').length;contextNote.textContent=attached?`${attached} source excerpt${attached===1?'':'s'} attached for send review. Attachment is not proof of model supply.`:'';
    const before=el('button','Earlier messages'),after=el('button','Later messages');before.type=after.type='button';before.disabled=detail.messages.offset===0;after.disabled=!detail.messages.hasMore;
    decorateConversationControl(before,{identity:'previous'});decorateConversationControl(after,{identity:'next'});paging.dataset.cpGroup='transcript-navigation';
    before.addEventListener('click',()=>{offset=Math.max(0,detail.messages.offset-50);void refresh().catch(error=>report(errorText(error)));});after.addEventListener('click',()=>{offset=detail.messages.offset+50;void refresh().catch(error=>report(errorText(error)));});
    paging.replaceChildren(before,el('span',`${detail.messages.total?detail.messages.offset+1:0}–${detail.messages.offset+detail.messages.items.length} of ${detail.messages.total}`),after);paging.hidden=detail.messages.total<=detail.messages.limit;
    renderDraft();options.onDetail?.(detail);
    if(followMessageId){pendingFollow={messageId:followMessageId};drainPendingFollow();}
    else if(around){pendingFollow=null;messages.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(around)}"]`)?.scrollIntoView({block:'center'});}
    else if(pendingFollow)drainPendingFollow();else if(nearBottom)followLatestContent();else messages.scrollTop=scroll;
  }
  async function refresh(input: {aroundMessageId?:string;latest?:boolean;followMessageId?:string}={}) {
    const request=++generation;
    const around=input.followMessageId??input.aroundMessageId;
    let d: Detail;
    try { d=await port.command('detail',{resourceId,limit:50,...(around?{aroundMessageId:around}:offset===undefined||input.latest?{offset:Math.max(0,(current?.conversation.messageCount??50)-50)}:{offset})}); }
    catch(error){if(!disposed&&request===generation&&/source_unavailable|access_denied|not_found/.test(errorText(error)))revokeView();throw error;}
    if(disposed||request!==generation)return;
    // Opening uses a bounded page, then fetches the actual latest page when count was not known.
    if((offset===undefined||input.latest)&&!around&&d.messages.hasMore){offset=Math.max(0,d.conversation.messageCount-50);await refresh();return;}
    accessRevoked=false;root.dataset.resourceAvailable='true';offset=d.messages.offset;render(d,input.aroundMessageId,input.followMessageId);
  }
  composer.addEventListener('submit',event=>{event.preventDefault();if(send.disabled||!current)return;const before=current,content=textarea.value,commandId=crypto.randomUUID();sending=true;renderDraft();report(providerCopy(before.conversation.providerId).pending);
    sendTask=(async()=>{
      const checkpoint=await session.checkpoint();
      const result=await port.command('send',{resourceId,content:checkpoint.record.content,expectedRevision:before.conversation.revision,commandId});
      let evidence:Detail|undefined;
      const input={resourceId,providerId:before.conversation.providerId,content,commandId,revision:before.conversation.revision,priorMessageIds:before.messages.items.map(m=>m.id)};
      if(!acceptedConversationSubmission(input,result))evidence=await port.command('detail',{resourceId,limit:50,offset:Math.max(0,before.conversation.messageCount-1)});
      let followMessageId:string|undefined;
      if(acceptedConversationSubmission(input,result,evidence)) { const receipt=result as Record<string,unknown>;followMessageId=receipt.role==='user'?String(receipt.id):evidence?.messages.items.find(m=>m.resourceId===resourceId&&!m.inherited&&m.role==='user'&&m.content===content&&!input.priorMessageIds.includes(m.id))?.id;const cleared=await session.acknowledgeSent(checkpoint);report(cleared?'Message accepted.':'Message accepted. Later draft edits were retained.','send-accepted'); }
      else { uncertain=true;report('Send acceptance is not confirmed. Inspect the chat before retrying.'); }
      if(!disposed){await refresh({latest:true,...(followMessageId?{followMessageId}:{})});if(!disposed)await options.onChanged?.();}
    })().catch(error=>{if(errorText(error)==='authorization_cancelled')report('Send cancelled. Your saved draft was retained.');else{uncertain=true;report('Send could not be confirmed: '+errorText(error));}}).finally(()=>{sending=false;sendTask=null;renderDraft();});
  });
  stop.addEventListener('click',()=>{if(!execution||!options.execution||!active()||cancelPending||connection==='unavailable')return;cancelPending=true;renderDraft();const id=execution.id;void options.execution.cancel(id).then(()=>report('Stop requested. Waiting for the provider to confirm.'),error=>report('Stop could not be requested: '+errorText(error))).finally(()=>{cancelPending=false;renderDraft();});});
  if(options.execution)unsubscribeExecution=options.execution.observe(resourceId,observation=>{
    const previousPreview=streamText.textContent,wasFollowing=messages.scrollHeight-messages.scrollTop-messages.clientHeight<80;
    if(disposed)return;
    if(observation.execution&&observation.execution.resourceId!==resourceId)return;
    if(observation.resourceAvailable===false){revokeView();return;}
    // An activity signal cannot grant access. Only a later successful canonical detail read restores it.
    if(accessRevoked)return;
    if(observation.connection)connection=observation.connection;
    if(connection==='unavailable'){report('Connection unavailable. '+(execution?'Last observed: '+execution.state+'. Outcome unconfirmed.':'Execution state is unavailable.'));renderDraft();}
    const next=observation.execution??execution;if(!next)return;
    if(execution&&next.id!==execution.id&&next.startedAt<execution.startedAt)return;
    if(execution?.id===next.id&&!['dispatching','running'].includes(execution.state)&&['dispatching','running'].includes(next.state))return;
    execution=next;
    if(streamExecution!==next.id){streamExecution=next.id;streamText.textContent='';seenEvents.clear();lastCursor=-1;streamLimited=false;liveFollow=false;}
    const preview=observation.preview;
    if(preview&&active()&&preview.executionId===next.id&&Number.isSafeInteger(preview.cursor)&&preview.cursor>=0&&preview.cursor>=lastCursor){
      // A complete snapshot supersedes only output through its cursor. Earlier/equal deltas are then covered.
      const text=preview.text.slice(0,1048576);if(streamText.textContent!==text)streamText.textContent=text;lastCursor=preview.cursor;seenEvents.clear();streamLimited=preview.text.length>1048576;
    }
    const delta=observation.delta;
    if(delta&&!streamLimited&&Number.isSafeInteger(delta.cursor)&&delta.cursor>lastCursor&&!seenEvents.has(delta.eventId)){
      seenEvents.add(delta.eventId);lastCursor=delta.cursor;const text=(streamText.textContent??'')+delta.text;streamText.textContent=text.slice(0,1048576);streamLimited=text.length>1048576||seenEvents.size>=65536;
    }
    root.dataset.executionState=next.state;stream.hidden=!streamText.textContent||!active();
    if(!active())liveFollow=false;
    if(streamText.textContent!==previousPreview&&wasFollowing&&!feedbackOpen&&!stream.hidden){liveFollow=true;options.motion?.wake();}
    const label=current?.providers.find(p=>p.id===next.providerId)?.label??next.providerId;
    report(connection==='unavailable'?'Connection unavailable. Last observed: '+next.state+'. Outcome unconfirmed.':next.state==='running'?label+' is running':next.state==='dispatching'?'Sending to '+label+'…':next.state==='provider_completed'?'Provider turn completed':next.state==='interrupted'?'Provider confirmed the turn stopped':next.state==='unknown'?'Execution outcome is unknown. Inspect history before retrying.':'Provider turn failed'+(next.errorCode?': '+next.errorCode:''));renderDraft();
    if(streamLimited)report(status.textContent+' · Live preview limit reached; canonical history remains available.');
    if(!active())void refresh({latest:true}).catch(error=>report(errorText(error)));
  });
  const ready=(async()=>{await session.ready;renderDraft();await refresh();resize();if(options.initialScroll!==undefined){pendingFollow=null;messages.scrollTop=options.initialScroll;}else{pendingFollow={};drainPendingFollow();}})().catch(error=>{report(errorText(error));throw error;});
  root.addEventListener('keydown',event=>{if(event.key!=='Escape')return;const details=(event.target as HTMLElement).closest<HTMLDetailsElement>('details[open]');if(details&&root.contains(details)){event.preventDefault();event.stopPropagation();details.open=false;details.querySelector('summary')?.focus();}});
  // The send RPC can remain pending through the entire native provider turn. Draft durability
  // must be independent so a pane can close and the host can offer interruption on quit.
  const flush=async()=>{await session.flush();viewState();};
  const frame=()=>{if(disposed)return;providerPicker?.frame();controlStates?.frame();let settled=true;if(options.motion){const p=options.motion.pose(feedbackKey),bar=options.motion.pose(feedbackBarKey),height=Math.max(0,p.h)+'px',barHeight=Math.max(0,bar.h)+'px';if(feedbackBody.style.height!==height)feedbackBody.style.height=height;if(feedbackBody.style.opacity!==String(p.opacity))feedbackBody.style.opacity=String(p.opacity);if(feedback.style.height!==barHeight)feedback.style.height=barHeight;if(feedback.style.opacity!==String(bar.opacity))feedback.style.opacity=String(bar.opacity);if(!feedbackOpen&&p.opacity<.001)feedbackBody.hidden=true;settled=Math.abs(p.h-feedbackHeight)<1&&p.opacity>.995;}
    if(inspectionFollow&&feedbackOpen&&messages.clientHeight>0){const box=messages.getBoundingClientRect(),body=feedbackBody.getBoundingClientRect(),scale=box.height/(messages.offsetHeight||messages.clientHeight);if(Number.isFinite(scale)&&scale>0&&body.height>0){const next=Math.max(0,Math.min(messages.scrollHeight-messages.clientHeight,messages.scrollTop+(body.top-box.top)/scale));if(messages.scrollTop!==next)messages.scrollTop=next;if(settled)inspectionFollow=false;}}
    if(liveFollow&&!feedbackOpen&&!stream.hidden&&messages.clientHeight>0){const next=Math.max(0,messages.scrollHeight-messages.clientHeight);if(messages.scrollTop!==next)messages.scrollTop=next;liveFollow=false;}
  };
  return {ready,refresh,focusComposer:()=>textarea.focus(),frame,setPresentation(mode){if(mode!=='workspace'&&mode!=='focused')throw new Error('invalid_chat_presentation');if(disposed)return;const scroll=messages.scrollTop;presentation=mode;resize();messages.scrollTop=scroll;drainPendingFollow();},flush,whenSubmissionSettled:()=>sendTask??Promise.resolve(),async dispose(){
    if(disposed)return;await flush();disposed=true;generation++;pendingFollow=null;unsubscribeDraft();unsubscribeExecution?.();providerPicker?.dispose();controlStates?.dispose();options.motion?.remove(feedbackKey);options.motion?.remove(feedbackBarKey);cancelResize();resizeObserver?.disconnect();viewState();root.remove();
    if(!options.draftSession){
      if(sendTask){void sendTask.then(()=>session.dispose(),()=>session.dispose()).catch(()=>{/* Existing durable recovery is untouched; never overwrite or replay a conflict. */});}
      else await session.dispose();
    }
  }};
}
