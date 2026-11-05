import type { TimelineDocument, TimelinePort, TimelinePlanningItem, TimelinePlanningValues, TimelinePlanningRequest } from '../timeline-product/contracts.ts';
import type { ExperienceMotionPort, ExperiencePose } from '../application-contract/motion.ts';
import { planningInstant, planningInterval, planningSnap, type TemporalOrientation } from './temporal-projection.ts';

/** Authorized planning projection. Retained evidence is never an editable item. */
export function mountTemporalPlanning(root: HTMLElement, track: HTMLElement, port: TimelinePort, options: {
  document(): TimelineDocument | null; enabled(): boolean; refresh(): Promise<void>; onBusy(): void;
  layout(): { orientation: TemporalOrientation; extent: number; historyHeight: number };
  motion: ExperienceMotionPort; prefix: string;
}) {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '') => { const n = document.createElement(tag); n.textContent = text; n.className = cls; return n; };
  const panel = el('details', '', 'aw-timeline-planning'), summary = el('summary', 'Planning items'), status = el('p'), form = el('form'), title = el('input'), start = el('input'), duration = el('input'), zone = el('input'), lane = el('input'), snap = el('select');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const label = (text: string, input: HTMLElement) => { const n = el('label', text); input.setAttribute('aria-label', text); n.append(input); return n; };
  const button = (text: string, run: () => void | Promise<void>) => { const n = el('button', text); n.type = 'button'; n.onclick = () => { if (!disposed) void Promise.resolve(run()).catch(error => { status.textContent = error.message; }); }; n.dataset.aerynthMotionControl = 'true'; return n; };
  let disposed = false, loading = false, writable = false, generation = 0, version = 0, selected: string | null = null;
  let items: TimelinePlanningItem[] = [], pending: Exclude<TimelinePlanningRequest,{op:'list'}> | null = null, operation: Promise<void> | null = null;
  const undoIds: string[] = [], bands = new Map<string, { item: TimelinePlanningItem; node: HTMLElement; button: HTMLButtonElement; handle: HTMLButtonElement; key: string }>();
  const pose = (patch: Partial<ExperiencePose> = {}): ExperiencePose => ({x:0,y:0,w:0,h:0,lift:0,yaw:0,opacity:1,...patch});
  const allowed = () => !!port.planning && writable && !loading && !pending && !operation && options.enabled() && options.document()?.resource.version === version;
  function controls() {
    const enabled = allowed(); for (const input of [title,start,duration,zone,lane,snap,save,create]) input.disabled = !enabled;
    remove.disabled = !enabled || !selected; undo.disabled = !enabled || !undoIds.length;
    retry.hidden = !pending; retry.disabled = !pending || loading || !!operation || !options.enabled();
    for (const band of bands.values()) band.button.disabled = band.handle.disabled = !enabled;
  }
  function draft(item?: TimelinePlanningItem) {
    selected = item?.id ?? null; title.value = item?.title ?? ''; start.value = item?.startAt ?? options.document()?.view.viewport.from ?? '';
    duration.value = String(item?.durationMs ?? 60000); zone.value = item?.timeZone ?? options.document()?.view.viewport.displayTimeZone ?? 'UTC'; lane.value = item?.laneId ?? 'Plans';
    panel.open = true; save.textContent = item ? 'Update planning item' : 'Create planning item'; controls();
  }
  function values(): TimelinePlanningValues {
    const durationMs = Number(duration.value);
    if (!title.value.trim()) throw Error('Enter a planning title.');
    if (!Number.isSafeInteger(durationMs) || durationMs < 0) throw Error('Duration must be a non-negative whole number of milliseconds.');
    return { title: title.value.trim(), startAt: planningInstant(start.value.trim(), zone.value.trim()), durationMs, timeZone: zone.value.trim(), laneId: lane.value.trim() || 'Plans' };
  }
  const create = button('New planning item', () => { if (allowed()) draft(); });
  const save = button('Create planning item', () => { if (!allowed()) return; try { return mutate(selected ? {op:'update',itemId:selected,values:values()} : {op:'create',values:values()}); } catch (error) { status.textContent = (error as Error).message; } });
  const remove = button('Delete planning item', () => { if (allowed() && selected) return mutate({op:'delete',itemId:selected}); });
  const undo = button('Undo planning change', () => { if (allowed() && undoIds.length) return mutate({op:'undo',targetCommandId:undoIds.at(-1)!}); });
  const retry = button('Retry planning change', () => send());
  for (const [value,text] of [[1000,'1 second'],[60000,'1 minute'],[900000,'15 minutes'],[3600000,'1 hour']] as const) { const n = el('option',text); n.value = String(value); snap.append(n); } snap.value = '60000';
  start.placeholder = '2026-11-01T01:30:00-04:00 or 2026-11-01T05:30:00Z'; duration.type = 'number'; duration.min = '0'; duration.step = '1';
  form.append(label('Plan title',title),label('Plan start (ISO with UTC offset)',start),label('Plan duration (milliseconds)',duration),label('Plan timezone (IANA)',zone),label('Plan lane',lane),label('Drag / keyboard snap',snap),save,remove);
  form.onsubmit = event => { event.preventDefault(); save.click(); };
  panel.append(summary,el('p','Plans are editable intentions, separate from immutable retained history. Enter Z or an explicit offset to disambiguate daylight-saving transitions. The IANA zone controls display; the explicit offset defines the saved instant.'),create,undo,retry,form,status);root.append(panel);
  const mutationBase = () => ({ commandId:'timeline-plan:'+crypto.randomUUID(), resourceId:options.document()!.resource.id, expectedVersion:version });
  type Change = {op:'create';values:TimelinePlanningValues}|{op:'update';itemId:string;values:TimelinePlanningValues}|{op:'delete';itemId:string}|{op:'undo';targetCommandId:string};
  function mutate(change: Change) { if (!allowed()) return Promise.resolve(); pending = {...mutationBase(),...change}; return send(); }
  async function send() {
    if (!pending || !port.planning || operation || loading || !options.enabled()) return;
    const attempt = structuredClone(pending);
    const run = (async () => {
      try {
        const result = await port.planning!(attempt);
        if (!('operationId' in result)) throw Error('Planning acknowledgment unavailable');
        pending = null;
        if (attempt.op === 'undo') undoIds.pop(); else undoIds.push(attempt.commandId);
        if (undoIds.length > 20) undoIds.shift();
        status.textContent = 'Planning change saved. Refreshing canonical timeline.';
        selected = result.item?.id ?? null;
        await options.refresh();
        if (!disposed && options.document()) { const selectedItem = items.find(item => item.id === selected); draft(selectedItem); status.textContent = 'Planning change saved.'; }
      } catch (error) {
        const code = (error as {code?:string}).code ?? (/^timeline_[a-z_]+$/.test((error as Error).message) ? (error as Error).message : undefined);
        if (code?.startsWith('timeline_')) { pending = null; status.textContent = 'Planning change rejected. Refresh and review current access or competing changes.'; await options.refresh().catch(() => {}); status.textContent = 'Planning change rejected. Current items were refreshed; review them before submitting another change.'; }
        else status.textContent = 'Planning change is unconfirmed. Retry checks the same command; no success is assumed.';
      }
    })(); operation = run; options.onBusy(); controls(); await run; if (operation === run) operation = null; options.onBusy(); controls();
  }
  function select(item: TimelinePlanningItem) { if (!allowed()) return; draft(item); layout(); }
  function place(band: typeof bands extends Map<string,infer T> ? T : never, position: number, length: number, y: number, vertical: boolean) {
    options.motion.target(band.key,pose({x:vertical?180:position+14,y:vertical?position+27:y,w:vertical?160:length,h:vertical?length:30}),'timeline-planning-layout'); options.motion.wake();
  }
  function layout() {
    if (disposed) return; const document = options.document(), geometry = options.layout(); if (!document) return;
    const live = new Set(items.map(item=>item.id));
    for (const [id,band] of bands) if (!live.has(id)) { band.node.remove(); options.motion.remove(band.key); bands.delete(id); }
    const lanes = [...new Set(items.map(item=>item.laneId))].sort(), vertical = geometry.orientation === 'vertical';
    let count = 0;
    for (const item of items) {
      let band = bands.get(item.id);
      if (!band) {
        const n = el('div','','aw-timeline-plan-band'), b = button('',()=>select(bands.get(item.id)!.item)), handle = button('Resize',()=>select(bands.get(item.id)!.item)),key=options.prefix+':plan:'+item.id;
        n.dataset.plannedId=item.id; n.append(b,handle); track.append(n);options.motion.add(key,pose({opacity:0})); band={item,node:n,button:b,handle,key};bands.set(item.id,band);
        b.onkeydown = event => { const current = bands.get(item.id)?.item;if(!current||!allowed())return;
          if(event.key==='Delete'){event.preventDefault();void mutate({op:'delete',itemId:current.id});return;}
          if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const delta=(event.key==='ArrowLeft'||event.key==='ArrowUp'?-1:1)*Number(snap.value);
          void mutate({op:'update',itemId:current.id,values:{title:current.title,timeZone:current.timeZone,laneId:current.laneId,startAt:new Date(Date.parse(current.startAt)+(event.altKey?0:delta)).toISOString(),durationMs:event.altKey?Math.max(0,current.durationMs+delta):current.durationMs}});
        };
        handle.onkeydown = event => b.onkeydown?.call(b, {key:event.key,altKey:true,preventDefault:()=>event.preventDefault()} as KeyboardEvent);
        for(const [control,resize] of [[b,false],[handle,true]] as const) {
          let drag: {origin:number;item:TimelinePlanningItem;version:number;delta:number;pointerId:number}|null=null;
          control.onpointerdown=event=>{if(!allowed()||event.button!==0)return;event.stopPropagation();const current=bands.get(item.id)!.item;drag={origin:options.layout().orientation==='vertical'?event.clientY:event.clientX,item:structuredClone(current),version,delta:0,pointerId:event.pointerId};control.setPointerCapture?.(event.pointerId);};
          control.onpointermove=event=>{if(!drag)return;const geometry=options.layout(),doc=options.document();if(!doc)return;const delta=(geometry.orientation==='vertical'?event.clientY:event.clientX)-drag.origin;drag.delta=planningSnap(delta/geometry.extent*(Date.parse(doc.view.viewport.to)-Date.parse(doc.view.viewport.from)),Number(snap.value));control.title=(resize?'Duration ':'Move by ')+drag.delta+' milliseconds (preview)'; const preview=planningInterval(Date.parse(drag.item.startAt)+(resize?0:drag.delta),resize?Math.max(0,drag.item.durationMs+drag.delta):drag.item.durationMs,Date.parse(doc.view.viewport.from),Date.parse(doc.view.viewport.to),geometry.extent);const band=bands.get(item.id)!;place(band,preview.position,preview.length,options.motion.pose(band.key).y,geometry.orientation==='vertical');};
          const cancel = (pointerId?: number) => { const captured=pointerId??drag?.pointerId;drag=null; if(captured!==undefined){try{control.releasePointerCapture?.(captured);}catch{/* Capture may already have ended. */}} layout(); };
          control.onpointercancel=event=>cancel(event.pointerId); control.onlostpointercapture=()=>cancel();
          const keyboard=control.onkeydown; control.onkeydown=event=>{if(event.key==='Escape'&&drag){event.preventDefault();event.stopPropagation();cancel();return;}keyboard?.call(control,event);};
          control.onpointerup=event=>{if(!drag)return;const gesture=drag;drag=null;try{control.releasePointerCapture?.(event.pointerId);}catch{/* Capture may already have ended. */}if(!gesture.delta||gesture.version!==version||!allowed()){layout();return;}void mutate({op:'update',itemId:gesture.item.id,values:{title:gesture.item.title,startAt:new Date(Date.parse(gesture.item.startAt)+(resize?0:gesture.delta)).toISOString(),durationMs:resize?Math.max(0,gesture.item.durationMs+gesture.delta):gesture.item.durationMs,timeZone:gesture.item.timeZone,laneId:gesture.item.laneId}});};
        }
      }
      band.item=item;band.button.textContent='Planned: '+item.title+' / '+item.laneId;band.button.setAttribute('aria-pressed',String(selected===item.id));band.button.title=item.startAt+' / '+item.durationMs+' ms / '+item.timeZone+' / '+item.laneId+'. Arrow keys move; Alt+arrow changes duration; Delete removes.';
      band.handle.setAttribute('aria-label','Resize planned duration: '+item.title);
      const interval=planningInterval(Date.parse(item.startAt),item.durationMs,Date.parse(document.view.viewport.from),Date.parse(document.view.viewport.to),geometry.extent);band.node.hidden=!interval.visible;
      place(band,interval.position,interval.length,geometry.historyHeight+count*38,vertical);count++;
    }
    if(!vertical&&count) track.style.height=geometry.historyHeight+count*38+12+'px';
    controls();
  }
  async function reload(document:TimelineDocument) {
    const token=++generation;
    if(!port.planning){clear();status.textContent='Planning is unavailable from this host. Retained history remains read-only.';return;}
    loading=true;controls();
    try {const projection=await port.planning({op:'list',resourceId:document.resource.id,expectedVersion:document.resource.version});
      if(disposed||token!==generation||options.document()?.resource.version!==document.resource.version)return;
      if(!('items' in projection)||projection.resourceId!==document.resource.id||projection.resourceVersion!==document.resource.version)throw Error('Planning projection identity mismatch');
      items=projection.items;version=projection.resourceVersion;writable=projection.canEdit;status.textContent=items.length+' saved planning items. Historical evidence is separate.';layout();
    }catch{if(token===generation){clear();status.textContent='Planning items could not be read under current access.';}}
    finally{if(token===generation){loading=false;controls();}}
  }
  function clear(){generation++;loading=false;writable=false;items=[];selected=null;for(const band of bands.values()){band.node.remove();options.motion.remove(band.key);}bands.clear();for(const input of [title,start,duration,zone,lane])input.value='';controls();}
  controls();
  return {reload,clear,layout,controls,busy:()=>!!pending||!!operation,
    frame(){for(const band of bands.values()){const p=options.motion.pose(band.key);band.node.style.transform=`translate(${p.x}px,${p.y}px)`;band.node.style.width=p.w+'px';band.node.style.height=p.h+'px';band.node.style.opacity=String(p.opacity);}},
    async flush(){if(operation)await operation;if(pending)throw Error('Planning change needs confirmation before leaving.');},
    dispose(){disposed=true;clear();panel.remove();}
  };
}
