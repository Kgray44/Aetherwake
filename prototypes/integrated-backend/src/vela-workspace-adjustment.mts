import type { Command, CommandResult, Geometry, LayoutPreview, LayoutPreviewRequest, PlacementUpdate, WorkspaceProjection } from '../../workspace-engine/contracts.mts';
import { limits } from '../../workspace-engine/geometry.mts';
import { blockDefinition } from '../../block-library/registry.ts';
import type { BlockKind } from '../../block-library/contracts.ts';
import type { HostActionResult, ResourceRef, VelaNativeAction, VelaWorkspaceAdjustmentReceipt } from '../../vela-core/src/contracts.ts';
import { historyDigest } from '../../vela-core/src/bounded-history.mts';
import { validateAction } from '../../vela-core/src/capabilities.ts';
import { ensure } from './contracts.mts';

export type WorkspaceAdjustmentAction=Extract<VelaNativeAction,{type:'adjustWorkspace'}>;
export interface WorkspaceAdjustmentHost {
  inspectWorkspace(id:string):WorkspaceProjection;
  preview(id:string,request:LayoutPreviewRequest):LayoutPreview;
  execute(command:Command):CommandResult;
  resource(id:string):ResourceRef|null;
  undoDepth(id:string):number;
  atomic<T>(work:()=>T):T;
  once(commandId:string,input:unknown,work:()=>HostActionResult):HostActionResult;
  record(receipt:VelaWorkspaceAdjustmentReceipt):void;
}
const same=(a:unknown,b:unknown)=>historyDigest(a)===historyDigest(b);
const geometry=(block:Geometry&{rotation?:number}):Geometry=>{
  const angle=(block.rotation??0)*Math.PI/180,width=Math.abs(Math.cos(angle))*block.width+Math.abs(Math.sin(angle))*block.height,
    height=Math.abs(Math.sin(angle))*block.width+Math.abs(Math.cos(angle))*block.height;
  return {x:block.x+(block.width-width)/2,y:block.y+(block.height-height)/2,width,height};
};
const overlaps=(a:Geometry,b:Geometry,gap:number)=>a.x<b.x+b.width+gap&&a.x+a.width+gap>b.x&&a.y<b.y+b.height+gap&&a.y+a.height+gap>b.y;
const fields=['x','y','width','height','rotation','shape','zIndex','locked','minimized','materialVariant'] as const;
const preserved=(block:WorkspaceProjection['blocks'][number])=>({blockId:block.blockId,resourceId:block.resourceId,subject:block.subject,
  ...Object.fromEntries(fields.map(field=>[field,block[field]]))});

/** Only the clear compound instruction is deterministic; other layouts remain semantic-tool work. */
export function matchWorkspaceAdjustment(intent:string,layout:WorkspaceProjection,resources:readonly ResourceRef[]):WorkspaceAdjustmentAction|null {
  const text=intent.normalize('NFKC').trim().replace(/^vela[,:]?\s+/iu,'').replace(/^(?:(?:please|(?:can|could|would) you)\s+)+/iu,'').replace(/[.!?]+$/u,'');
  if(!/^put (?:the )?(?:project )?tasks on the right,? and make (?:the )?notes (?:bigger|larger)$/iu.test(text))return null;
  const placed=new Set(layout.blocks.flatMap(block=>block.resourceId?[block.resourceId]:[]));
  const tasks=resources.filter(resource=>placed.has(resource.id)&&['task','task_group','task_objective','checklist'].includes(resource.resourceKind??'')),
    notes=resources.filter(resource=>placed.has(resource.id)&&resource.resourceKind==='note');
  ensure(tasks.length>0&&notes.length>0,'vela_adjustment_targets_missing');
  return {type:'adjustWorkspace',workspaceId:layout.workspaceId,adjustments:[
    {resourceIds:tasks.map(resource=>resource.id).sort(),position:'right',size:'keep'},
    {resourceIds:notes.map(resource=>resource.id).sort(),position:'keep',size:'larger'},
  ]};
}

/** Canonical geometry only. No content, binding, stack, viewport or permission mutation is owned here. */
export class VelaWorkspaceAdjustment {
  private readonly host:WorkspaceAdjustmentHost;
  constructor(host:WorkspaceAdjustmentHost){this.host=host;}
  private resources(action:WorkspaceAdjustmentAction) {
    const ids=action.adjustments.flatMap(adjustment=>adjustment.resourceIds);
    ensure(new Set(ids).size===ids.length&&ids.length<=64,'vela_adjustment_ambiguous_targets');
    return ids.map(id=>{const ref=this.host.resource(id);ensure(ref?.kind==='resource'&&ref.state!=='archived'&&ref.resourceKind,'vela_adjustment_resource_unavailable');return structuredClone(ref);});
  }
  private plan(action:WorkspaceAdjustmentAction,before:WorkspaceProjection,resources:ResourceRef[]):PlacementUpdate[] {
    ensure(before.blocks.length<=128&&Number.isFinite(before.viewport.zoom)&&before.viewport.zoom>0,'vela_adjustment_layout_unavailable');
    const requested=new Set(resources.map(resource=>resource.id));
    for(const id of requested)ensure(before.blocks.some(block=>block.resourceId===id),'vela_adjustment_binding_unavailable');
    const targets=before.blocks.filter(block=>block.resourceId&&requested.has(block.resourceId));
    ensure(targets.length<=64&&targets.every(block=>!block.locked&&!block.minimized&&block.resourceState==='active'),'vela_adjustment_locked_or_unavailable');
    const gap=Math.max(24,before.organization.gap),top=before.viewport.y+144/before.viewport.zoom;
    const occupied=[...before.blocks.filter(block=>!targets.includes(block)).map(geometry),geometry(before.presence)];
    const updates:PlacementUpdate[]=[];
    const ordered=[...targets].sort((a,b)=>{
      const rank=(id:string)=>action.adjustments.find(item=>item.resourceIds.includes(id))!.position==='keep'?0:1;
      return rank(a.resourceId!)-rank(b.resourceId!)||a.blockId.localeCompare(b.blockId);
    });
    for(const block of ordered) {
      const adjustment=action.adjustments.find(item=>item.resourceIds.includes(block.resourceId!))!,ref=resources.find(resource=>resource.id===block.resourceId)!;
      const minimum=blockDefinition(ref.resourceKind as BlockKind).minimumSize,factor=adjustment.size==='larger'?1.25:adjustment.size==='smaller'?.8:1;
      const width=Math.max(minimum.width,Math.min(limits.maxSize,Math.ceil(block.width*factor/16)*16)),
        height=Math.max(minimum.height,Math.min(limits.maxSize,Math.ceil(block.height*factor/16)*16));
      ensure(adjustment.size==='keep'||adjustment.size==='larger'&&width>block.width&&height>block.height||adjustment.size==='smaller'&&(width<block.width||height<block.height),'vela_adjustment_size_limit');
      const next={...block,width:adjustment.size==='keep'?block.width:width,height:adjustment.size==='keep'?block.height:height};
      if(next.shape==='circle')next.height=next.width;
      let footprint=geometry(next);
      if(adjustment.position==='right')next.x=Math.max(before.presence.x+before.presence.width+gap,...occupied.map(box=>box.x+box.width+gap))+(footprint.width-next.width)/2;
      if(adjustment.position==='left')next.x=before.presence.x-gap-footprint.width+(footprint.width-next.width)/2;
      next.y=Math.max(next.y,top+(footprint.height-next.height)/2);
      if(adjustment.position==='keep'&&adjustment.size!=='keep'&&occupied.some(box=>overlaps(geometry(next),box,gap))) {
        // A joint instruction can vacate the task column. Prefer that free
        // horizontal space over pushing an enlarged note below the whole scene.
        const rightEdge=before.presence.x+before.presence.width+gap;
        const candidates=[rightEdge,...occupied.map(box=>box.x+box.width+gap)].filter(x=>x>=rightEdge).sort((a,b)=>a-b);
        for(const x of candidates) {
          const candidate={...next,x:x+(footprint.width-next.width)/2};
          if(!occupied.some(box=>overlaps(geometry(candidate),box,gap))){next.x=candidate.x;break;}
        }
      }
      // Only selected cards move. Search downward at the intended horizontal role;
      // every step clears at least one fixed/previously placed obstacle.
      for(let attempt=0;attempt<=occupied.length;attempt++) {
        footprint=geometry(next);const conflicts=occupied.filter(box=>overlaps(footprint,box,gap));if(!conflicts.length)break;
        next.y=Math.max(...conflicts.map(box=>box.y+box.height+gap))+(footprint.height-next.height)/2;
      }
      footprint=geometry(next);ensure(Math.abs(next.x)<=limits.coordinate&&Math.abs(next.y)<=limits.coordinate&&footprint.y>=top&&
        !occupied.some(box=>overlaps(footprint,box,gap)),'vela_adjustment_no_safe_geometry');
      occupied.push(footprint);updates.push({blockId:block.blockId,expectedVersion:block.version,presentation:{x:next.x,y:next.y,width:next.width,height:next.height}});
    }
    return updates;
  }
  private verify(before:WorkspaceProjection,actual:Pick<WorkspaceProjection,'blocks'|'presence'|'viewport'|'organization'>,updates:PlacementUpdate[]) {
    const ids=new Set(updates.map(update=>update.blockId)),gap=Math.max(24,before.organization.gap),top=before.viewport.y+144/before.viewport.zoom;
    ensure(actual.blocks.length===before.blocks.length&&same(actual.viewport,before.viewport)&&same(actual.presence,before.presence)&&
      actual.organization.mode===before.organization.mode&&actual.organization.gap===before.organization.gap,'vela_adjustment_preservation_failed');
    for(const old of before.blocks) {
      const block=actual.blocks.find(item=>item.blockId===old.blockId);ensure(block&&block.resourceId===old.resourceId&&same(block.subject,old.subject),'vela_adjustment_binding_mismatch');
      if(!ids.has(old.blockId)){ensure(same(preserved(block),preserved(old)),'vela_adjustment_unrelated_geometry_changed');continue;}
      const planned=updates.find(update=>update.blockId===block.blockId)!,box=geometry(block);
      ensure(Object.entries(planned.presentation).every(([key,value])=>block[key as keyof typeof block]===value)&&box.y>=top&&
        !actual.blocks.some(other=>other.blockId!==block.blockId&&overlaps(box,geometry(other),gap))&&!overlaps(box,geometry(actual.presence),gap),'vela_adjustment_geometry_mismatch');
      for(const field of fields.filter(field=>!['x','y','width','height'].includes(field)))ensure(block[field]===old[field],'vela_adjustment_presentation_changed');
    }
  }
  async prepare(input:WorkspaceAdjustmentAction,commandId:string,signal:AbortSignal):Promise<()=>HostActionResult> {
    const action=validateAction(input);ensure(action.type==='adjustWorkspace'&&!signal.aborted,'vela_adjustment_cancelled');
    const before=structuredClone(this.host.inspectWorkspace(action.workspaceId)),resources=this.resources(action),depth=this.host.undoDepth(action.workspaceId),
      updates=this.plan(action,before,resources),preview=this.host.preview(action.workspaceId,{expectedRevision:before.revision,placements:updates});
    this.verify(before,preview,updates);const stamp=historyDigest({before,resources});
    return ()=>this.host.atomic(()=>{
      ensure(!signal.aborted,'vela_adjustment_cancelled');this.resources(action);
      return this.host.once(commandId,{type:'velaWorkspaceAdjustment',action},()=>{
        ensure(stamp===historyDigest({before:this.host.inspectWorkspace(action.workspaceId),resources:this.resources(action)}),'vela_adjustment_sources_changed');
        this.host.execute({type:'saveLayout',commandId:'vela-layout:'+historyDigest(commandId),workspaceId:action.workspaceId,expectedRevision:before.revision,placements:updates});
        const actual=this.host.inspectWorkspace(action.workspaceId);this.verify(before,actual,updates);
        ensure(actual.revision===before.revision+1&&same(this.resources(action),resources)&&this.host.undoDepth(action.workspaceId)===Math.min(100,depth+1),'vela_adjustment_postconditions_failed');
        const receipt:VelaWorkspaceAdjustmentReceipt={contract:'aerynth.vela-workspace-adjustment@1',workspaceId:action.workspaceId,beforeLayoutVersion:before.revision,
          layoutVersion:actual.revision,changedBlockIds:updates.map(update=>update.blockId),verification:{bindingsPreserved:true,unrelatedGeometryPreserved:true,geometryValid:true,oneUndoEntry:true}};
        this.host.record(receipt);return {status:'applied',receiptId:commandId,workspaceAdjustment:receipt,responseText:`Adjusted ${updates.length} cards. The layout change can be undone.`};
      });
    });
  }
}
