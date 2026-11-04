import type { TemplateService } from '../../block-library/service.mts';
import type { BlockKind, WorkspaceTemplate } from '../../block-library/contracts.ts';
import { blockDefinition } from '../../block-library/registry.ts';
import type { Geometry, Presentation, WorkspaceProjection } from '../../workspace-engine/contracts.mts';
import { limits as geometryLimits, presentation } from '../../workspace-engine/geometry.mts';
import type { HostActionResult, ResourceRef, VelaWorkspaceConstructionReceipt } from '../../vela-core/src/contracts.ts';
import type { VelaOperationProjection, VelaOperationsPacket } from '../../vela-core/src/operational-context.mts';
import { historyDigest } from '../../vela-core/src/bounded-history.mts';
import { identifier } from '../../vela-core/src/capabilities.ts';
import { ensure } from './contracts.mts';

export interface VelaWorkspaceRepairAction { type: 'repairWorkspace'; workspaceId: string; receiptId: string; resourceIds: string[] }
export interface WorkspaceRepairHost {
  templates: Pick<TemplateService, 'attachBlock' | 'getTemplate'>;
  operationContext(): VelaOperationsPacket;
  validateOperationContext(packet: VelaOperationsPacket): void;
  /** Current owning-service authorization must be enforced by all three canonical read callbacks. */
  inspectWorkspace(id: string): WorkspaceProjection;
  resource(id: string): ResourceRef | null;
  /** Raw canonical entity version for attachBlock; not a composite conversation/message version token. */
  resourceVersion(id: string): number | null;
  atomic<T>(work: () => T): T;
  once(commandId: string, input: unknown, work: () => HostActionResult): HostActionResult;
  record(workspaceId: string, receipt: VelaWorkspaceConstructionReceipt, sourceReceiptId: string): void;
}
type Resource = { ref: ResourceRef; rawVersion: number; kind: BlockKind };
type Binding = { role: string; resourceId: string; blockId?: string; presentation?: Presentation };
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const version = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const geometryFields = ['x', 'y', 'width', 'height', 'zIndex', 'shape', 'rotation', 'minimized', 'locked', 'materialVariant'] as const;
const sorted = (values: readonly string[]) => [...values].sort(compare);
const same = (a: unknown, b: unknown) => historyDigest(a) === historyDigest(b);
function box(item: Geometry & { rotation?: number }): Geometry {
  const angle = (item.rotation ?? 0) * Math.PI / 180;
  const width = Math.abs(Math.cos(angle)) * item.width + Math.abs(Math.sin(angle)) * item.height;
  const height = Math.abs(Math.sin(angle)) * item.width + Math.abs(Math.cos(angle)) * item.height;
  return { x: item.x + (item.width - width) / 2, y: item.y + (item.height - height) / 2, width, height };
}
function overlaps(a: Geometry, b: Geometry, gap = 24) {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}
function preservedBlock(block: WorkspaceProjection['blocks'][number]) {
  return { blockId: block.blockId, resourceId: block.resourceId, subject: block.subject,
    ...Object.fromEntries(geometryFields.map(field => [field, block[field]])) };
}
function actionValue(action: VelaWorkspaceRepairAction): VelaWorkspaceRepairAction {
  ensure(action && Object.keys(action).every(key => ['type', 'workspaceId', 'receiptId', 'resourceIds'].includes(key)) &&
    action.type === 'repairWorkspace' && identifier(action.workspaceId) && identifier(action.receiptId) &&
    Array.isArray(action.resourceIds) && action.resourceIds.length > 0 && action.resourceIds.length <= 64 &&
    action.resourceIds.every(identifier) && new Set(action.resourceIds).size === action.resourceIds.length, 'vela_repair_invalid_action');
  return { type: 'repairWorkspace', workspaceId: action.workspaceId, receiptId: action.receiptId, resourceIds: sorted(action.resourceIds) };
}

/** Restores references only. The caller supplies the real canonical transaction, library, operation proofs and grants. */
export class VelaWorkspaceRepair {
  private readonly host: WorkspaceRepairHost;
  constructor(host: WorkspaceRepairHost) { this.host = host; }

  private source(action: VelaWorkspaceRepairAction, packet: VelaOperationsPacket): VelaOperationProjection {
    this.host.validateOperationContext(packet);
    const candidates = packet.operations.filter(operation => operation.receiptId === action.receiptId);
    ensure(candidates.length === 1, candidates.length ? 'vela_repair_ambiguous_receipt' : 'vela_repair_receipt_unavailable');
    const operation = candidates[0], proof = operation.recordedConstruction?.receipt;
    ensure(operation.state === 'applied' && proof && operation.recordedConstruction?.evidence === 'historical-host-receipt' &&
      operation.expected.workspaceId === action.workspaceId && proof.workspaceId === action.workspaceId &&
      operation.observed?.workspace.id === action.workspaceId && operation.verification.state !== 'unavailable', 'vela_repair_receipt_unavailable');
    ensure(same(sorted([...new Set(proof.resources.map(resource => resource.resourceId))]), action.resourceIds), 'vela_repair_resource_manifest_mismatch');
    ensure(proof.resources.length === action.resourceIds.length && proof.placements.length === action.resourceIds.length &&
      new Set(proof.placements.map(placement => placement.resourceId)).size === proof.placements.length &&
      same(sorted(proof.placements.map(placement => placement.resourceId)), action.resourceIds), 'vela_repair_ambiguous_bindings');
    return operation;
  }
  private resources(ids: readonly string[]): Resource[] {
    return ids.map(id => {
      const ref = this.host.resource(id), rawVersion = this.host.resourceVersion(id);
      ensure(ref?.id === id && ref.kind === 'resource' && ref.state !== 'archived' && version(ref.version) &&
        version(rawVersion) && typeof ref.resourceKind === 'string', 'vela_repair_resource_unavailable');
      const kind = ref.resourceKind as BlockKind;
      blockDefinition(kind);
      return { ref: structuredClone(ref), rawVersion, kind };
    });
  }
  private layout(action: VelaWorkspaceRepairAction, operation: VelaOperationProjection): WorkspaceProjection {
    const layout = this.host.inspectWorkspace(action.workspaceId), proof = operation.recordedConstruction!.receipt;
    ensure(layout.workspaceId === action.workspaceId && layout.projectId === proof.projectId && layout.blocks.length <= 128 &&
      layout.blocks.length === operation.observed!.placementCount &&
      new Set(layout.blocks.map(block => block.blockId)).size === layout.blocks.length &&
      same(sorted(layout.blocks.filter(block => block.resourceId).map(block => block.blockId + ':' + block.resourceId)),
        sorted(operation.observed!.placements.map(block => block.blockId + ':' + block.resourceId))), 'vela_repair_workspace_changed');
    ensure([layout.presence.x, layout.presence.y, layout.presence.width, layout.presence.height].every(Number.isFinite), 'vela_repair_geometry_unavailable');
    return structuredClone(layout);
  }
  private template(proof: VelaWorkspaceConstructionReceipt): WorkspaceTemplate | null {
    try {
      const template = this.host.templates.getTemplate(proof.templateId);
      return template.version === proof.templateVersion ? structuredClone(template) : null;
    } catch { return null; }
  }
  private bindings(layout: WorkspaceProjection, proof: VelaWorkspaceConstructionReceipt, resources: Resource[], template: WorkspaceTemplate | null): Binding[] {
    const occupied = [...layout.blocks.map(box), box(layout.presence)], bindings: Binding[] = [];
    let nextLayer = Math.max(0, ...layout.blocks.map(block => block.zIndex));
    for (const declared of proof.placements) {
      const resource = resources.find(item => item.ref.id === declared.resourceId)!;
      const candidates = layout.blocks.filter(block => block.resourceId === declared.resourceId && block.resourceState === 'active')
        .sort((a, b) => compare(a.blockId, b.blockId));
      const existing = candidates.find(block => block.blockId === declared.blockId) ?? candidates[0];
      if (existing) { bindings.push({ role: declared.role, resourceId: declared.resourceId, blockId: existing.blockId }); continue; }
      const definition = blockDefinition(resource.kind);
      const historical = template?.body.placements.find(placement => placement.key === declared.role)?.presentation;
      const base = presentation(historical ?? definition.defaultPresentation);
      ensure(base.width >= definition.minimumSize.width && base.height >= definition.minimumSize.height, 'vela_repair_geometry_unavailable');
      let chosen = base;
      if (!historical || occupied.some(obstacle => overlaps(box(chosen), obstacle))) {
        chosen = presentation({ ...base, x: 24, y: Math.max(0, ...occupied.map(obstacle => obstacle.y + obstacle.height)) + 24,
          rotation: 0, zIndex: ++nextLayer });
      }
      const bounds = box(chosen);
      ensure([bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) &&
        Math.abs(chosen.x) <= geometryLimits.coordinate && Math.abs(chosen.y) <= geometryLimits.coordinate &&
        !occupied.some(obstacle => overlaps(bounds, obstacle)), 'vela_repair_geometry_unavailable');
      occupied.push(bounds); bindings.push({ role: declared.role, resourceId: declared.resourceId, presentation: chosen });
    }
    return bindings;
  }
  async prepare(input: VelaWorkspaceRepairAction, commandId: string, signal: AbortSignal): Promise<() => HostActionResult> {
    const action = actionValue(input);
    ensure(identifier(commandId) && !signal.aborted, 'vela_repair_cancelled');
    const packet = this.host.operationContext(), operation = this.source(action, packet), proof = operation.recordedConstruction!.receipt;
    const before = this.layout(action, operation), resources = this.resources(action.resourceIds), template = this.template(proof);
    const bindings = this.bindings(before, proof, resources, template);
    const snapshot = historyDigest({ before, resources, template });
    this.host.validateOperationContext(packet);
    return () => this.host.atomic(() => {
      ensure(!signal.aborted, 'vela_repair_cancelled');
      // A replay still requires current access, but its own successful placement changes must not invalidate
      // the domain receipt. Frozen source/version checks apply inside once, immediately before new writes.
      this.source(action, this.host.operationContext());
      return this.host.once(commandId, { type: 'velaWorkspaceRepair', action }, () => {
        this.source(action, packet);
        ensure(snapshot === historyDigest({ before: this.layout(action, operation), resources: this.resources(action.resourceIds), template: this.template(proof) }), 'vela_repair_sources_changed');
        let current = before, attached = 0;
        const actualBindings: { role: string; blockId: string; resourceId: string }[] = [];
        for (const [index, binding] of bindings.entries()) {
          let blockId = binding.blockId;
          if (!blockId) {
            const resource = resources.find(item => item.ref.id === binding.resourceId)!;
            const result = this.host.templates.attachBlock({
              commandId: 'vela-repair-attach:' + historyDigest({ commandId, index }), workspaceId: action.workspaceId,
              expectedLayoutVersion: current.revision, kind: resource.kind, resourceId: resource.ref.id,
              expectedResourceVersion: resource.rawVersion, presentation: binding.presentation,
            });
            ensure(result.workspaceId === action.workspaceId && result.resourceId === binding.resourceId && identifier(result.placementId), 'vela_repair_binding_mismatch');
            blockId = result.placementId; attached++;
            current = this.host.inspectWorkspace(action.workspaceId);
          }
          actualBindings.push({ role: binding.role, blockId, resourceId: binding.resourceId });
        }
        const actual = this.host.inspectWorkspace(action.workspaceId);
        ensure(actual.workspaceId === before.workspaceId && actual.projectId === before.projectId &&
          actual.blocks.length === before.blocks.length + attached && same(actual.viewport, before.viewport) && same(actual.presence, before.presence) &&
          before.blocks.every(block => { const found = actual.blocks.find(candidate => candidate.blockId === block.blockId); return found && same(preservedBlock(found), preservedBlock(block)); }),
        'vela_repair_preservation_failed');
        for (const binding of actualBindings) {
          const block = actual.blocks.find(item => item.blockId === binding.blockId), resource = resources.find(item => item.ref.id === binding.resourceId)!;
          const minimum = blockDefinition(resource.kind).minimumSize;
          ensure(block?.resourceId === binding.resourceId && block.resourceState === 'active' &&
            [block.x, block.y, block.width, block.height].every(Number.isFinite) && block.width >= minimum.width && block.height >= minimum.height,
          'vela_repair_postcondition_failed');
          const planned = bindings.find(item => item.role === binding.role)!;
          if (planned.presentation) {
            ensure(geometryFields.every(field => block[field] === planned.presentation![field]) &&
              !actual.blocks.some(other => other.blockId !== block.blockId && overlaps(box(block), box(other))) && !overlaps(box(block), box(actual.presence)),
            'vela_repair_geometry_mismatch');
          }
        }
        const finalResources = this.resources(action.resourceIds);
        ensure(same(finalResources, resources), 'vela_repair_sources_changed');
        const repaired: VelaWorkspaceConstructionReceipt = { contract: 'aerynth.vela-workspace-construction@1',
          workspaceId: actual.workspaceId, projectId: actual.projectId, workspaceVersion: actual.workspaceVersion, layoutVersion: actual.revision,
          templateId: proof.templateId, templateVersion: proof.templateVersion, observedAt: new Date().toISOString(),
          resources: proof.resources.map(resource => ({ role: resource.role, resourceId: resource.resourceId,
            version: finalResources.find(item => item.ref.id === resource.resourceId)!.ref.version, reused: true })),
          placements: actualBindings, verification: { workspaceExists: true, projectMatches: true, bindingsMatch: true, geometryValid: true } };
        this.host.record(actual.workspaceId, repaired, action.receiptId);
        return { status: 'applied', receiptId: commandId, workspaceConstruction: repaired,
          responseText: attached ? `Restored ${attached} missing block${attached === 1 ? '' : 's'} in this workspace.` : 'Verified the existing workspace blocks; no duplicates were needed.' };
      });
    });
  }
}
