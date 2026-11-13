import type { ExperienceMotionPort, ExperiencePose } from '../../application-contract/motion.ts';

export type ConversationPickerOption = { value:string;label:string;disabled?:boolean;description?:string };
export interface ConversationPicker {
  readonly element:HTMLElement;
  readonly trigger:HTMLButtonElement;
  update(input:{items:readonly ConversationPickerOption[];value:string;disabled?:boolean}):void;
  open():void;
  close(restoreFocus?:boolean):void;
  frame():void;
  dispose():void;
}
let serial=0;
const pose=(patch:Partial<ExperiencePose>={}):ExperiencePose=>({x:0,y:0,w:0,h:0,lift:0,yaw:0,opacity:1,...patch});
const css=(node:HTMLElement,name:string,value:string)=>{const style=node.style as unknown as Record<string,string>,previous=node.style.getPropertyValue?node.style.getPropertyValue(name):style[name];if(previous!==value){if(node.style.setProperty)node.style.setProperty(name,value);else style[name]=value;}};
const make=<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className='')=>{const node=document.createElement(tag);node.textContent=text;node.className=className;return node;};

/** Presentation only. The host supplies current authorized labels and owns the
 * selected value/dispatch. No provider, resource, draft or permission store. */
export function mountConversationPicker(container:HTMLElement,options:{motion:ExperienceMotionPort;viewId:string;label:string;identity?:string;itemsOnOpen?():readonly ConversationPickerOption[];onSelect(value:string):void|Promise<void>;onError?(error:unknown):void}):ConversationPicker{
  if(!options.motion||!options.viewId?.trim())throw new Error('conversation_picker_motion_required');
  const motion=options.motion,key='conversation-picker:'+options.viewId,ariaId='cp-picker-'+ ++serial;
  const root=make('span','','cp-picker'),trigger=make('button','','cp-picker-trigger'),caption=make('span','','cp-picker-label'),chevron=make('span','⌄','cp-picker-chevron');
  const panel=make('div','','cp-picker-panel'),search=make('input','','cp-picker-search'),list=make('div','','cp-picker-list'),count=make('small','','cp-picker-count');
  trigger.type='button';trigger.dataset.aerynthMotionControl='true';trigger.dataset.cpPickerFor=options.label;trigger.dataset.cpControl=options.identity??'action';trigger.setAttribute('aria-label',options.label);trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls',ariaId);chevron.setAttribute('aria-hidden','true');trigger.append(caption,chevron);
  list.id=ariaId;list.setAttribute('role','listbox');list.setAttribute('aria-label',options.label);search.type='search';search.placeholder='Find an option';search.setAttribute('aria-label','Find '+options.label.toLocaleLowerCase());search.dataset.aerynthMotionControl='true';search.maxLength=200;
  panel.hidden=true;panel.inert=true;panel.append(search,list,count);root.append(trigger,panel);container.append(root);
  let disposed=false,opened=false,selected='',disabled=false,items:readonly ConversationPickerOption[]=[],signature='',focusedValue:string|undefined,menuHeight=0;
  const rows=new Map<string,{node:HTMLButtonElement;mark:HTMLElement;caption:HTMLElement;key:string;signature:string}>();
  motion.add(key,pose({opacity:0,y:5}));css(panel,'--cp-picker-opacity','0');css(panel,'--cp-picker-y','5px');
  const filtered=()=>{const needle=search.value.toLocaleLowerCase();return items.filter(item=>!needle||item.label.toLocaleLowerCase().includes(needle));};
  const focusOption=(value:string|undefined)=>{if(value===undefined)return;focusedValue=value;renderRows();const node=rows.get(value)?.node;if(!node)return;node.focus({preventScroll:true});const box=list.getBoundingClientRect(),row=node.getBoundingClientRect();if(row.top<box.top)list.scrollTop+=row.top-box.top;else if(row.bottom>box.bottom)list.scrollTop+=row.bottom-box.bottom;};
  const move=(from:string|undefined,direction:number,end?:boolean)=>{const enabled=filtered().filter(item=>!item.disabled);if(!enabled.length)return;const index=enabled.findIndex(item=>item.value===from),next=end?(direction<0?0:enabled.length-1):index<0?(direction<0?enabled.length-1:0):Math.max(0,Math.min(enabled.length-1,index+direction));focusOption(enabled[next].value);};
  const close=(restoreFocus=false)=>{if(disposed||!opened)return;opened=false;root.dataset.open='false';trigger.setAttribute('aria-expanded','false');panel.inert=true;motion.target(key,pose({opacity:0,y:5}),'conversation picker close');motion.wake();if(restoreFocus)trigger.focus({preventScroll:true});if(options.itemsOnOpen){items=[];renderRows();}};
  const fit=()=>{const host=root.closest<HTMLElement>('.cp-chat')??root.closest<HTMLElement>('.cp-manager')??root.parentElement;if(!host)return;const height=Math.max(36,Math.min(260,host.getBoundingClientRect().bottom-trigger.getBoundingClientRect().bottom-24-(search.hidden?0:42)));if(Math.abs(height-menuHeight)>.5){menuHeight=height;motion.target(key,pose({opacity:1,y:0,h:height}),'conversation picker fit host');motion.wake();}};
  function choose(item:ConversationPickerOption){
    if(disposed||disabled||item.disabled||!opened)return;
    close(true);if(item.value===selected)return;
    try{void Promise.resolve(options.onSelect(item.value)).catch(error=>{if(!disposed)options.onError?.(error);});}catch(error){options.onError?.(error);}
  }
  function renderRows(){
    const matches=filtered(),at=Math.max(0,matches.findIndex(item=>item.value===focusedValue)),start=Math.max(0,at-32),visible=matches.slice(start,start+64),live=new Set(visible.map(item=>item.value));
    for(const[value,row]of rows)if(!live.has(value)){row.node.remove();motion.remove(row.key);rows.delete(value);}
    for(const item of visible){let row=rows.get(item.value);if(!row){const button=make('button','','cp-picker-option'),mark=make('span','✓','cp-picker-selected'),label=make('span','','cp-picker-option-label'),rowKey=key+':option:'+item.value;button.type='button';button.dataset.aerynthMotionControl='true';button.dataset.cpOptionValue=item.value;button.setAttribute('role','option');mark.setAttribute('aria-hidden','true');button.append(label,mark);motion.add(rowKey,pose({x:Number(item.value===selected)}));row={node:button,mark,caption:label,key:rowKey,signature:''};rows.set(item.value,row);button.addEventListener('click',()=>{const current=items.find(option=>option.value===item.value);if(current)choose(current);});button.addEventListener('focus',()=>{focusedValue=item.value;});button.addEventListener('keydown',event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'||event.key==='Home'||event.key==='End'){event.preventDefault();move(item.value,event.key==='ArrowUp'||event.key==='Home'?-1:1,event.key==='Home'||event.key==='End');}else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}});}
      row.caption.textContent=item.label;row.node.disabled=disabled||item.disabled===true;row.node.title=item.description??'';row.node.setAttribute('aria-selected',String(item.value===selected));const next=String(item.value===selected);if(row.signature!==next){row.signature=next;motion.target(row.key,pose({x:Number(item.value===selected)}),'conversation picker selection');}list.append(row.node);
    }
    count.textContent=matches.length>64?`${start+1}–${Math.min(matches.length,start+64)} of ${matches.length} · type to find` :matches.length?'':'No matching options';count.hidden=!!matches.length&&matches.length<=64;
    search.hidden=items.length<=12&&!search.value;
  }
  const open=()=>{if(disposed||disabled||opened)return;if(options.itemsOnOpen){items=options.itemsOnOpen();search.value='';focusedValue=undefined;}opened=true;root.dataset.open='true';trigger.setAttribute('aria-expanded','true');panel.hidden=false;panel.inert=false;renderRows();menuHeight=0;fit();motion.wake();if(!search.hidden)search.focus({preventScroll:true});else focusOption(items.find(item=>item.value===selected&&!item.disabled)?.value??items.find(item=>!item.disabled)?.value);};
  trigger.addEventListener('click',()=>opened?close(true):open());trigger.addEventListener('keydown',event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();open();move(selected,event.key==='ArrowUp'?-1:1);}else if(event.key==='Escape'&&opened){event.preventDefault();event.stopPropagation();close(true);}});
  search.addEventListener('input',()=>{focusedValue=undefined;renderRows();motion.wake();});search.addEventListener('keydown',event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();move(undefined,event.key==='ArrowUp'?-1:1);}else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}});
  const outside=(event:Event)=>{if(opened&&!root.contains(event.target as Node))close();};root.ownerDocument.addEventListener?.('pointerdown',outside);
  return {element:root,trigger,open,close,update(input){if(disposed)return;const next=JSON.stringify(input);if(next===signature)return;signature=next;if(!options.itemsOnOpen)items=input.items;selected=input.value;disabled=input.disabled===true;trigger.disabled=disabled;caption.textContent=items.find(item=>item.value===selected)?.label??options.label;if(disabled)close();renderRows();motion.wake();},frame(){if(disposed)return;if(opened)fit();const current=motion.pose(key);css(panel,'--cp-picker-opacity',String(Math.max(0,Math.min(1,current.opacity))));css(trigger,'--cp-picker-open',String(Math.max(0,Math.min(1,current.opacity))));css(panel,'--cp-picker-y',current.y+'px');css(list,'--cp-picker-height',Math.max(0,current.h)+'px');if(!opened&&current.opacity<.001)panel.hidden=true;for(const row of rows.values())css(row.node,'--cp-option-selected',String(Math.max(0,Math.min(1,motion.pose(row.key).x))));},dispose(){if(disposed)return;disposed=true;panel.inert=true;root.ownerDocument.removeEventListener?.('pointerdown',outside);motion.remove(key);for(const row of rows.values())motion.remove(row.key);rows.clear();root.remove();}};
}

/** Existing native control state is immediate; only its material highlight is
 * sampled through the borrowed coordinator. No state/permission authority. */
export function conversationControlStates(root:HTMLElement,options:{motion:ExperienceMotionPort;viewId:string}){
 let serial=0,disposed=false;const entries=new Map<HTMLElement,{key:string;selected:boolean;previous:string|undefined}>();
 const release=(node:HTMLElement,entry:{key:string;previous:string|undefined})=>{options.motion.remove(entry.key);if(entry.previous)css(node,'--cp-control-selected',entry.previous);else if(node.style.removeProperty)node.style.removeProperty('--cp-control-selected');else delete(node.style as unknown as Record<string,string>)['--cp-control-selected'];};
 return {frame(){if(disposed)return;for(const[node,entry]of entries)if(!root.contains(node)){release(node,entry);entries.delete(node);}for(const node of root.querySelectorAll<HTMLElement>('.cp-control')){if(!root.matches('.cp-chat')&&node.closest('.cp-chat'))continue;const pressed=node.getAttribute('aria-pressed'),current=node.getAttribute('aria-current'),expanded=node.getAttribute('aria-expanded'),details=node.tagName==='SUMMARY'&&node.parentElement?.tagName==='DETAILS'?node.parentElement as HTMLDetailsElement:null;if(pressed===null&&current===null&&expanded===null&&!details)continue;const selected=pressed==='true'||current==='true'||expanded==='true'||!!details?.open;let entry=entries.get(node);if(!entry){entry={key:options.viewId+':control-state:'+ ++serial,selected,previous:node.style.getPropertyValue?node.style.getPropertyValue('--cp-control-selected'):(node.style as unknown as Record<string,string>)['--cp-control-selected']};entries.set(node,entry);options.motion.add(entry.key,pose({x:Number(selected)}));}if(entry.selected!==selected){entry.selected=selected;options.motion.target(entry.key,pose({x:Number(selected)}),'conversation control selection');options.motion.wake();}css(node,'--cp-control-selected',String(Math.max(0,Math.min(1,options.motion.pose(entry.key).x))));}},dispose(){if(disposed)return;disposed=true;for(const[node,entry]of entries)release(node,entry);entries.clear();}};
}

/** Native <details>.open remains semantic authority. The actual Chromium
 * details-content box is kept paintable by picker.css while this one borrowed
 * channel reveals a stable wrapper; no cloned forms, synthetic toggle or clock. */
export function conversationDisclosures(root:HTMLElement,options:{motion:ExperienceMotionPort;viewId:string}){
 type Entry={node:HTMLDetailsElement;summary:HTMLElement;body:HTMLElement;content:HTMLElement;key:string;open:boolean;height:number;aria:string|null;onToggle:()=>void};
 const entries=new Map<HTMLDetailsElement,Entry>();let serial=0,disposed=false;
 const owns=(node:HTMLElement)=>root.matches('.cp-chat')||!node.closest('.cp-chat');
 const move=(content:HTMLElement,node:HTMLElement)=>{const stable=content as HTMLElement&{moveBefore?(node:Node,before:Node|null):void};if(stable.moveBefore&&node.isConnected)stable.moveBefore(node,null);else content.append(node);};
 const reconcile=(entry:Entry)=>{const opened=entry.node.open;entry.summary.setAttribute('aria-expanded',String(opened));entry.body.inert=!opened;entry.node.dataset.open=String(opened);if(opened)entry.body.hidden=false;
  const overlay=entry.node.matches('.cp-new-chat')||entry.node.matches('.cp-switcher')||entry.node.matches('.cp-filters')||entry.node.matches('.cp-history-tools')||entry.node.matches('.cp-chat-options')||entry.node.matches('.cp-chat-extras');
  entry.node.dataset.cpDisclosureLayout=overlay?'menu':'flow';
  let height=0;if(opened){const measured=entry.content.getBoundingClientRect().height||entry.content.scrollHeight,natural=Number.isFinite(measured)?Math.max(0,measured):0;if(overlay){const room=root.getBoundingClientRect().bottom-entry.summary.getBoundingClientRect().bottom-12,cap=Number.isFinite(room)?Math.max(36,Math.min(360,room)):36;css(entry.content,'--cp-disclosure-cap',cap+'px');height=Math.min(cap,natural);}else height=natural;}
  if(opened!==entry.open||Math.abs(height-entry.height)>.5){entry.open=opened;entry.height=height;options.motion.target(entry.key,pose({h:height,opacity:Number(opened)}),'conversation disclosure '+(opened?'open/content':'close'));options.motion.wake();}
 };
 const release=(entry:Entry)=>{options.motion.remove(entry.key);entry.node.removeEventListener?.('toggle',entry.onToggle);for(const child of [...entry.content.children])entry.node.insertBefore(child,entry.body);entry.body.remove();if(entry.node.style.removeProperty)entry.node.style.removeProperty('--cp-disclosure-open');else delete(entry.node.style as unknown as Record<string,string>)['--cp-disclosure-open'];delete entry.node.dataset.cpMotionDisclosure;delete entry.node.dataset.cpDisclosureLayout;delete entry.node.dataset.cpDisclosureState;if(entry.aria===null)entry.summary.removeAttribute('aria-expanded');else entry.summary.setAttribute('aria-expanded',entry.aria);};
 const sync=()=>{if(disposed)return;for(const[node,entry]of entries)if(!root.contains(node)){release(entry);entries.delete(node);}for(const node of root.querySelectorAll<HTMLDetailsElement>('details')){if(!owns(node))continue;let entry=entries.get(node);if(!entry){const summary=[...node.children].find(child=>child.tagName==='SUMMARY') as HTMLElement|undefined;if(!summary)continue;
    // Older browser fallbacks must not reparent an active IME/editor subtree.
    const active=node.ownerDocument.activeElement;if(active&&active!==summary&&node.contains(active)&&!(typeof HTMLElement!=='undefined'&&'moveBefore' in HTMLElement.prototype))continue;
    const body=make('div','','cp-motion-disclosure-body'),content=make('div','','cp-motion-disclosure-content');body.append(content);body.inert=!node.open;body.hidden=!node.open;css(body,'height','0px');css(body,'opacity','0');node.dataset.cpMotionDisclosure='true';
    node.append(body);for(const child of [...node.children])if(child!==summary&&child!==body)move(content,child as HTMLElement);const key=options.viewId+':disclosure:'+ ++serial;options.motion.add(key,pose({opacity:0}));entry={node,summary,body,content,key,open:false,height:0,aria:summary.getAttribute('aria-expanded'),onToggle:()=>{}};entry.onToggle=()=>{if(!disposed&&entries.get(node)===entry)reconcile(entry!);};node.addEventListener('toggle',entry.onToggle);entries.set(node,entry);
   }else for(const child of [...node.children])if(child!==entry.summary&&child!==entry.body)move(entry.content,child as HTMLElement);
   reconcile(entry);
  }};
 return {sync,frame(){if(disposed)return;sync();for(const entry of [...entries.values()].reverse()){reconcile(entry);const current=options.motion.pose(entry.key);css(entry.body,'height',Math.max(0,current.h)+'px');const opacity=String(Math.max(0,Math.min(1,current.opacity)));css(entry.body,'opacity',opacity);css(entry.node,'--cp-disclosure-open',opacity);entry.node.dataset.cpDisclosureState=entry.open?'open':current.opacity<.001?'closed':'closing';if(!entry.open&&current.opacity<.001)entry.body.hidden=true;}},dispose(){if(disposed)return;disposed=true;for(const entry of [...entries.values()].reverse())release(entry);entries.clear();}};
}

/** Same native form value/change handlers, upgraded only when the actual host
 * supplies motion. The hidden select supplies no authority or duplicate data. */
export function enhanceConversationSelect(select:HTMLSelectElement,options:{motion:ExperienceMotionPort;viewId:string;onError?(error:unknown):void}){
  const parent=select.parentElement;if(!parent)throw new Error('conversation_select_parent_required');
  const label=select.getAttribute('aria-label')??parent.firstChild?.textContent?.trim()??'Choose option',host=make('span','','cp-picker-host');parent.insertBefore(host,select);
  const previous={hidden:select.hidden,tabIndex:select.tabIndex,aria:select.getAttribute('aria-hidden'),marker:select.dataset.cpNativePicker};select.hidden=true;select.tabIndex=-1;select.setAttribute('aria-hidden','true');select.dataset.cpNativePicker='true';
  const picker=mountConversationPicker(host,{...options,label,onSelect(value){select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));}});
  let dirty=true,disposed=false,items:ConversationPickerOption[]=[],value:string|undefined,disabled:boolean|undefined;
  // DOM metadata only: avoid rescanning every collection option on every host
  // frame. This observer owns no schedule; property selection is still read live.
  const observer=typeof MutationObserver==='function'?new MutationObserver(()=>{if(!disposed){dirty=true;options.motion.wake();}}):null;
  observer?.observe(select,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['value','label','disabled']});
  const sync=(force=true)=>{if(disposed)return;if(force||dirty||!observer){items=[...select.options].map(option=>({value:option.value,label:option.textContent??'',disabled:option.disabled}));dirty=false;}else if(value===select.value&&disabled===select.disabled)return;value=select.value;disabled=select.disabled;picker.update({items,value,disabled});};sync();
  return {sync:()=>sync(),frame(){sync(false);picker.frame();},dispose(){if(disposed)return;disposed=true;observer?.disconnect();picker.dispose();host.remove();select.hidden=previous.hidden;select.tabIndex=previous.tabIndex;if(previous.aria===null)select.removeAttribute('aria-hidden');else select.setAttribute('aria-hidden',previous.aria);if(previous.marker===undefined)delete select.dataset.cpNativePicker;else select.dataset.cpNativePicker=previous.marker;},picker};
}

/** The narrow history drawer is a second view over a retained chat. The host
 * samples its position and opacity on the same frame as the other surfaces. */
export function conversationHistoryDrawer(root:HTMLElement,catalog:HTMLElement,options:{motion:ExperienceMotionPort;viewId:string}){
 const {motion}=options,key=options.viewId+':history-drawer',media=root.ownerDocument.defaultView?.matchMedia?.('(max-width: 760px)');
 if(!media)return null;
 const open=()=>root.classList.contains('cp-history-open');
 const desired=()=>media.matches&&open();
 let shown=desired(),disposed=false;
 const drawerPose=(visible:boolean)=>pose({x:visible?0:-14,opacity:Number(visible)});
 motion.add(key,drawerPose(shown));root.dataset.cpHistoryMotion='true';
 const sync=()=>{if(disposed)return;const next=desired();catalog.inert=media.matches&&!open();if(next!==shown){shown=next;motion.target(key,drawerPose(shown),'conversation history drawer');motion.wake();}};
 const onResize=()=>{sync();motion.wake();};
 media.addEventListener('change',onResize);
 root.addEventListener('click',onResize);
 const frame=()=>{if(disposed)return;sync();const value=motion.pose(key);css(catalog,'--cp-history-drawer-x',value.x+'px');css(catalog,'--cp-history-drawer-opacity',String(Math.max(0,Math.min(1,value.opacity))));root.dataset.cpHistoryPaint=String(shown||value.opacity>.001);};
 frame();
 return {frame,dispose(){if(disposed)return;disposed=true;root.removeEventListener('click',onResize);media.removeEventListener('change',onResize);motion.remove(key);catalog.inert=false;delete root.dataset.cpHistoryMotion;delete root.dataset.cpHistoryPaint;css(catalog,'--cp-history-drawer-x','');css(catalog,'--cp-history-drawer-opacity','');}};
}

/** Reveal the current authorized conversation after it is ready. This owns no
 * transcript or focus state, and refreshes of the same chat do not restart it. */
export function conversationDetailReveal(detail:HTMLElement,options:{motion:ExperienceMotionPort;viewId:string}){
 const {motion}=options,key=options.viewId+':detail-reveal';
 let current:string|null=null,disposed=false,painted=true;
 motion.add(key,pose());
 return {show(resourceId:string){if(disposed||current===resourceId)return;current=resourceId;if(motion.reduced)return;motion.remove(key);motion.add(key,pose({y:7,opacity:.42}));motion.target(key,pose(),'conversation content reveal');painted=false;motion.wake();},
 frame(){if(disposed||painted)return;const value=motion.pose(key);css(detail,'--cp-detail-reveal-y',value.y+'px');css(detail,'--cp-detail-reveal-opacity',String(Math.max(.42,Math.min(1,value.opacity))));if(Math.abs(value.y)<.01&&value.opacity>=.999){painted=true;css(detail,'--cp-detail-reveal-y','');css(detail,'--cp-detail-reveal-opacity','');}},
 dispose(){if(disposed)return;disposed=true;motion.remove(key);css(detail,'--cp-detail-reveal-y','');css(detail,'--cp-detail-reveal-opacity','');}};
}
