import type { ConversationProductPort, Detail, MessageView } from './contracts.ts';
import { ConversationDraftSession, type DraftSessionSnapshot } from './draft-session.ts';
import { renderMarkdown } from './markdown.ts';

export type ConversationExecution = { id: string; resourceId: string; providerId: string; commandId: string; state: 'dispatching'|'running'|'provider_completed'|'failed'|'interrupted'|'unknown'; startedAt: string; endedAt: string|null; taskVerified: false; errorCode?: string };
/** The host translates only observed assistant text deltas; never reasoning/tool summaries or fabricated approval events. */
export type ConversationExecutionObservation = { execution?: ConversationExecution; connection?: 'available'|'unavailable'; delta?: { eventId: string; cursor: number; text: string } };
export interface ConversationExecutionPort {
  observe(resourceId: string, listener: (observation: ConversationExecutionObservation) => void): () => void;
  cancel(executionId: string): Promise<unknown>;
}
export type MessageSelection = { start: number; end: number; text: string };
export type ConversationMessageAction = { action: 'branch'|'source'|'publish'; message: MessageView; selection?: MessageSelection };
export interface ConversationChatOptions {
  port: ConversationProductPort; resourceId: string;
  /** Externally supplied sessions remain owned by the caller. */
  draftSession?: ConversationDraftSession; initialDraft?: string; initialScroll?: number; initialOffset?: number;
  execution?: ConversationExecutionPort; copy?: (text: string) => Promise<void>;
  onDetail?: (detail: Detail) => void; onUnavailable?: () => void; onChanged?: () => void | Promise<void>;
  onMessageAction?: (event: ConversationMessageAction) => void | Promise<void>;
  onViewState?: (state: { resourceId: string; content: string; scroll: number; offset: number }) => void;
}
export interface ConversationChat {
  ready: Promise<void>; refresh(options?: { aroundMessageId?: string; latest?: boolean }): Promise<void>;
  focusComposer(): void; flush(): Promise<void>; dispose(): Promise<void>;
}
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
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
  if (options.draftSession && options.draftSession.resourceId !== resourceId) throw new Error('draft_resource_mismatch');
  const root = el('section', undefined, 'cp-chat'); root.dataset.resourceId = resourceId; root.setAttribute('aria-label', 'Chat');
  const messages = el('div', undefined, 'cp-messages'); messages.tabIndex = 0; messages.setAttribute('aria-label', 'Conversation messages');
  const paging = el('div', undefined, 'cp-paging'), stream = el('article', undefined, 'cp-stream'), streamText = el('pre', '', 'cp-stream-text'); stream.append(el('p', 'Observed live output', 'cp-message-source'), streamText); stream.hidden = true;
  const status = el('p', '', 'cp-chat-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const composer = el('form', undefined, 'cp-composer'), textarea = el('textarea'), tools = el('div', undefined, 'cp-composer-tools'), provider = el('span', '', 'cp-composer-provider'), send = el('button', 'Send'), stop = el('button', 'Stop'), hint = el('span', 'Enter to send · Shift+Enter for a new line', 'cp-composer-hint');
  textarea.setAttribute('aria-label', 'Message'); textarea.placeholder = 'Ask anything, or share an idea'; textarea.rows = 2;
  send.type = 'submit'; send.setAttribute('aria-label', 'Send message'); stop.type = 'button'; stop.hidden = true; tools.append(provider, hint, stop, send); composer.append(textarea, tools);
  const capabilityNote=el('p','','cp-capability-note'),contextNote=el('p','','cp-context-note'),draftStatus = el('p', '', 'cp-draft-status'), recovery = el('div', undefined, 'cp-draft-recovery'); draftStatus.setAttribute('role', 'status');
  const recoveryDetails = el('details', undefined, 'cp-draft-conflict'), recoverySummary = el('summary', 'Review draft conflict'), localText = el('pre'), storedText = el('pre');
  const keep = el('button', 'Keep this editor’s draft'), useStored = el('button', 'Use the stored draft'), retry = el('button', 'Retry draft recovery'), reviewed = el('button', 'I reviewed the send outcome');
  for (const b of [keep,useStored,retry,reviewed]) b.type = 'button';
  recoveryDetails.append(recoverySummary, el('p','This editor'),localText,el('p','Stored draft'),storedText,keep,useStored);
  root.append(messages,paging,stream,status,composer,capabilityNote,contextNote,draftStatus,recovery); container.append(root);
  let disposed = false, generation = 0, current: Detail|null = null, offset = options.initialOffset, sending = false, uncertain = false, recovering = false, composing = false;
  let sendTask: Promise<void>|null = null, cancelPending = false, streamLimited = false, accessRevoked = false;
  let execution: ConversationExecution|null = null, unsubscribeExecution: (()=>void)|undefined, streamExecution = '', lastCursor = -1, connection: 'available'|'unavailable' = 'available';
  const seenEvents = new Set<string>(), cache = new Map<string,{signature:string;node:HTMLElement}>();
  const session = options.draftSession ?? new ConversationDraftSession({ resourceId, port, ...(options.initialDraft === undefined ? {} : { initialContent: options.initialDraft }) });
  const copy = options.copy ?? (text => navigator.clipboard.writeText(text));
  const report = (text: string) => { if (!disposed) status.textContent = text; };
  const active = () => execution && ['dispatching','running'].includes(execution.state);
  const viewState = () => options.onViewState?.({resourceId,content:textarea.value,scroll:messages.scrollTop,offset:current?.messages.offset??offset??0});
  const resize = () => { textarea.style.height = 'auto'; textarea.style.height = Math.min(200,Math.max(56,textarea.scrollHeight))+'px'; };
  function renderDraft(snapshot: DraftSessionSnapshot = session.snapshot()) {
    if (disposed) return;
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
    stop.hidden = !active() || !options.execution; stop.disabled = cancelPending || connection==='unavailable';composer.hidden = !current || current.conversation.state === 'archived'; recovery.hidden = draftStatus.hidden = !current; viewState();
  }
  const unsubscribeDraft = session.subscribe(renderDraft);
  async function recover(work: ()=>Promise<void>) { if (recovering) return; recovering = true; renderDraft(); try { await work(); } catch (error) { report(errorText(error)); } finally { recovering = false; renderDraft(); } }
  keep.addEventListener('click', () => { const remote = session.snapshot().remote; if (remote) void recover(()=>session.resolve('keep-local',remote.version)); });
  useStored.addEventListener('click', () => { const remote = session.snapshot().remote; if (remote) void recover(()=>session.resolve('use-stored',remote.version)); });
  retry.addEventListener('click', () => { void recover(async()=>{await session.reload();await session.flush();}); });
  reviewed.addEventListener('click', () => { uncertain = false; recovery.replaceChildren(); renderDraft(); });
  textarea.addEventListener('input', () => { session.update(textarea.value); resize(); });
  textarea.addEventListener('compositionstart',()=>{composing=true;});textarea.addEventListener('compositionend',()=>{composing=false;});
  textarea.addEventListener('keydown', event => { if (!composing && composerShouldSubmit(event)) { event.preventDefault(); if (!send.disabled) composer.requestSubmit(); } });
  messages.addEventListener('scroll', viewState, {passive:true});
  const doAction = (event: ConversationMessageAction) => { Promise.resolve(options.onMessageAction?.(event)).catch(error=>report(errorText(error))); };
  function messageNode(message: MessageView): HTMLElement {
    const signature = JSON.stringify(message), cached = cache.get(message.id); if (cached?.signature === signature) return cached.node;
    const article = el('article', undefined, 'cp-message cp-message-'+message.role); article.dataset.messageId = message.id; article.dataset.sourceResourceId = message.resourceId;
    // MessageView has no per-message provider binding: never relabel old assistant output after a provider change.
    const attribution = message.role === 'user' ? 'You' : message.role === 'assistant' ? (message.provenance==='mock_adapter'?'Assistant · simulated source':'Assistant') : message.role;
    const by = el('p', attribution+(message.inherited?' · inherited source':''), 'cp-message-source'); by.title = message.provenance+' · '+message.createdAt;
    const content = message.role === 'assistant' ? renderMarkdown(message.content,copy,report) : el('div',message.content); content.classList.add('cp-message-content');
    const actions = el('details', undefined, 'cp-message-actions'), summary = el('summary','Message actions'), panel = el('div',undefined,'cp-disclosure-panel'); actions.append(summary,panel);
    const action = (label:string, work:()=>void|Promise<void>) => { const b = el('button',label); b.type='button'; b.addEventListener('click',()=>{Promise.resolve(work()).catch(error=>report(errorText(error)));});panel.append(b);return b; };
    action('Copy',async()=>{await copy(message.content);report('Copied');actions.open=false;});
    action('Quote',()=>{session.update(session.snapshot().content+(session.snapshot().content?'\n\n':'')+`> ${message.content.replaceAll('\n','\n> ')}\n`);actions.open=false;textarea.focus();});
    if (options.onMessageAction) {
      action('Source',()=>doAction({action:'source',message})); action('Branch from here',()=>{actions.open=false;doAction({action:'branch',message});});
      const source = el('pre',message.content,'cp-message-raw'), note = el('p','Select an exact source passage below to publish an excerpt. Markdown source offsets are preserved.','cp-selection-note');
      const sourceDisclosure = el('details'), sourceSummary = el('summary','Select source excerpt'); sourceDisclosure.append(sourceSummary,note,source);panel.append(sourceDisclosure);
      let selection: MessageSelection|null = null;
      const publish = action('Publish selected excerpt',()=>{if(selection&&message.content.slice(selection.start,selection.end)===selection.text)doAction({action:'publish',message,selection});});publish.disabled=true;
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
  function render(detail: Detail, around?:string) {
    const nearBottom = messages.scrollHeight-messages.scrollTop-messages.clientHeight < 80, scroll = messages.scrollTop;
    current=detail; const nodes=detail.messages.items.map(messageNode);
    if (!nodes.length) nodes.push(el('div',detail.conversation.providerId==='local'||detail.conversation.providerId==='mock-ordinary'?'A place to think. Your messages stay in this local chat.':'Start a conversation with Codex. Each send uses the native approval path.','cp-chat-empty'));
    for(const child of [...messages.children])if(!nodes.includes(child as HTMLElement))child.remove();
    nodes.forEach((node,i)=>{if(messages.children[i]!==node)messages.insertBefore(node,messages.children[i]??null);});
    for(const [id,value]of cache)if(!nodes.includes(value.node))cache.delete(id);
    provider.textContent=detail.providers.find(p=>p.id===detail.conversation.providerId)?.label??detail.conversation.providerId;
    const local=['local','mock-ordinary'].includes(detail.conversation.providerId);textarea.placeholder=local?'Write a message…':'Ask Codex anything…';send.textContent=local?'Record message':'Send';
    provider.title=detail.providers.find(p=>p.id===detail.conversation.providerId)?.reason??(local?'Local recording · no model execution':'Native approval is required before a provider turn');
    capabilityNote.textContent=detail.providers.find(p=>p.id===detail.conversation.providerId)?.reason??(local?'Local recording · no model responses':'Each send requires native approval.');
    const attached=detail.shares.filter(s=>s.attached&&s.status==='current').length;contextNote.textContent=attached?`${attached} source excerpt${attached===1?'':'s'} attached for send review. Attachment is not proof of model supply.`:'';
    const before=el('button','Earlier messages'),after=el('button','Later messages');before.type=after.type='button';before.disabled=detail.messages.offset===0;after.disabled=!detail.messages.hasMore;
    before.addEventListener('click',()=>{offset=Math.max(0,detail.messages.offset-50);void refresh().catch(error=>report(errorText(error)));});after.addEventListener('click',()=>{offset=detail.messages.offset+50;void refresh().catch(error=>report(errorText(error)));});
    paging.replaceChildren(before,el('span',`${detail.messages.total?detail.messages.offset+1:0}–${detail.messages.offset+detail.messages.items.length} of ${detail.messages.total}`),after);paging.hidden=detail.messages.total<=detail.messages.limit;
    renderDraft();options.onDetail?.(detail);
    if(around){messages.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(around)}"]`)?.scrollIntoView({block:'center'});}
    else messages.scrollTop=nearBottom?messages.scrollHeight:scroll;
  }
  async function refresh(input: {aroundMessageId?:string;latest?:boolean}={}) {
    const request=++generation;
    let d: Detail;
    try { d=await port.command('detail',{resourceId,limit:50,...(input.aroundMessageId?{aroundMessageId:input.aroundMessageId}:offset===undefined||input.latest?{offset:Math.max(0,(current?.conversation.messageCount??50)-50)}:{offset})}); }
    catch(error){if(!disposed&&request===generation&&/source_unavailable|access_denied|not_found/.test(errorText(error))){accessRevoked=true;current=null;cache.clear();messages.replaceChildren();streamText.textContent='';stream.hidden=true;paging.hidden=true;capabilityNote.textContent=contextNote.textContent='';renderDraft();options.onUnavailable?.();report('This conversation is no longer available. Its draft is retained.');}throw error;}
    if(disposed||request!==generation)return;
    // Opening uses a bounded page, then fetches the actual latest page when count was not known.
    if((offset===undefined||input.latest)&&!input.aroundMessageId&&d.messages.hasMore){offset=Math.max(0,d.conversation.messageCount-50);await refresh();return;}
    accessRevoked=false;offset=d.messages.offset;render(d,input.aroundMessageId);
  }
  composer.addEventListener('submit',event=>{event.preventDefault();if(send.disabled||!current)return;const before=current,content=textarea.value,commandId=crypto.randomUUID();sending=true;renderDraft();report(['local','mock-ordinary'].includes(before.conversation.providerId)?'Saving message…':'Waiting for native send review. Your draft remains saved.');
    sendTask=(async()=>{
      const checkpoint=await session.checkpoint();
      const result=await port.command('send',{resourceId,content:checkpoint.record.content,expectedRevision:before.conversation.revision,commandId});
      let evidence:Detail|undefined;
      const input={resourceId,providerId:before.conversation.providerId,content,commandId,revision:before.conversation.revision,priorMessageIds:before.messages.items.map(m=>m.id)};
      if(!acceptedConversationSubmission(input,result))evidence=await port.command('detail',{resourceId,limit:50,offset:Math.max(0,before.conversation.messageCount-1)});
      if(acceptedConversationSubmission(input,result,evidence)) { const cleared=await session.acknowledgeSent(checkpoint);report(cleared?'Message accepted.':'Message accepted. Later draft edits were retained.'); }
      else { uncertain=true;report('Send acceptance is not confirmed. Inspect the chat before retrying.'); }
      await refresh({latest:true});await options.onChanged?.();
    })().catch(error=>{if(errorText(error)==='authorization_cancelled')report('Send cancelled. Your saved draft was retained.');else{uncertain=true;report('Send could not be confirmed: '+errorText(error));}}).finally(()=>{sending=false;sendTask=null;renderDraft();});
  });
  stop.addEventListener('click',()=>{if(!execution||!options.execution||!active()||cancelPending||connection==='unavailable')return;cancelPending=true;renderDraft();const id=execution.id;void options.execution.cancel(id).then(()=>report('Stop requested. Waiting for the provider to confirm.'),error=>report('Stop could not be requested: '+errorText(error))).finally(()=>{cancelPending=false;renderDraft();});});
  if(options.execution)unsubscribeExecution=options.execution.observe(resourceId,observation=>{
    if(disposed||accessRevoked)return;
    if(observation.execution&&observation.execution.resourceId!==resourceId)return;
    if(observation.connection)connection=observation.connection;
    if(connection==='unavailable'){report('Connection unavailable. '+(execution?'Last observed: '+execution.state+'. Outcome unconfirmed.':'Execution state is unavailable.'));renderDraft();}
    const next=observation.execution;if(!next)return;
    if(execution&&next.id!==execution.id&&next.startedAt<execution.startedAt)return;
    if(execution?.id===next.id&&!['dispatching','running'].includes(execution.state)&&['dispatching','running'].includes(next.state))return;
    execution=next;
    if(streamExecution!==next.id){streamExecution=next.id;streamText.textContent='';seenEvents.clear();lastCursor=-1;streamLimited=false;}
    const delta=observation.delta;
    if(delta&&!streamLimited&&Number.isSafeInteger(delta.cursor)&&delta.cursor>lastCursor&&!seenEvents.has(delta.eventId)){
      seenEvents.add(delta.eventId);lastCursor=delta.cursor;const text=(streamText.textContent??'')+delta.text;streamText.textContent=text.slice(0,1048576);streamLimited=text.length>1048576||seenEvents.size>=65536;
    }
    root.dataset.executionState=next.state;stream.hidden=!streamText.textContent||!active();
    const label=current?.providers.find(p=>p.id===next.providerId)?.label??next.providerId;
    report(connection==='unavailable'?'Connection unavailable. Last observed: '+next.state+'. Outcome unconfirmed.':next.state==='running'?label+' is running':next.state==='dispatching'?'Sending to '+label+'…':next.state==='provider_completed'?'Provider turn completed':next.state==='interrupted'?'Provider confirmed the turn stopped':next.state==='unknown'?'Execution outcome is unknown. Inspect history before retrying.':'Provider turn failed'+(next.errorCode?': '+next.errorCode:''));renderDraft();
    if(streamLimited)report(status.textContent+' · Live preview limit reached; canonical history remains available.');
    if(!active())void refresh({latest:true}).catch(error=>report(errorText(error)));
  });
  const ready=(async()=>{await session.ready;renderDraft();await refresh();messages.scrollTop=options.initialScroll??messages.scrollHeight;resize();})().catch(error=>{report(errorText(error));throw error;});
  root.addEventListener('keydown',event=>{if(event.key!=='Escape')return;const details=(event.target as HTMLElement).closest<HTMLDetailsElement>('details[open]');if(details&&root.contains(details)){event.preventDefault();event.stopPropagation();details.open=false;details.querySelector('summary')?.focus();}});
  const flush=async()=>{await session.flush();await sendTask;await session.flush();viewState();};
  return {ready,refresh,focusComposer:()=>textarea.focus(),flush,async dispose(){if(disposed)return;await flush();if(!options.draftSession)await session.dispose();disposed=true;generation++;unsubscribeDraft();unsubscribeExecution?.();viewState();root.remove();}};
}
