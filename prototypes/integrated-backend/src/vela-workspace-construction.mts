import type { TemplateService } from '../../block-library/service.mts';
import type { WorkspaceProjection } from '../../workspace-engine/contracts.mts';
import { blockDefinition } from '../../block-library/registry.ts';
import type { HostActionResult, ResourceRef, VelaNativeAction, VelaWorkspaceConstructionReceipt } from '../../vela-core/src/contracts.ts';
import { ensure } from './contracts.mts';

type Construction = Extract<VelaNativeAction, { type: 'constructWorkspace' }>;
export interface WorkspaceConstructionHost {
  templates: Pick<TemplateService, 'requestVelaTemplate' | 'saveTemplate' | 'applyTemplate'>;
  scopeStamp(): string;
  projectVersion(id: string | null): number | undefined;
  createProject(title: string): string;
  inspectWorkspace(id: string): WorkspaceProjection;
  resource(id: string): ResourceRef | null;
  once(commandId: string, input: unknown, work: () => HostActionResult): HostActionResult;
  record(workspaceId: string, receipt: VelaWorkspaceConstructionReceipt): void;
}

const normalized = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/gu, ' ');
/** A clear local creation instruction. Semantic provider planning remains available for other objectives. */
export function matchWorkspaceConstruction(intent: string, projects: readonly Pick<ResourceRef, 'id' | 'title'>[],
  currentProjectId: string | null): Construction | null {
  const input = intent.normalize('NFKC').trim().replace(/^vela[,:]?\s+/iu, '')
    .replace(/^(?:(?:please|(?:can|could|would) you)\s+)+/iu, '').replace(/[.!?]+$/u, '');
  const match = /^(?:create|make|build|set up)\s+(?:me\s+)?(?:a\s+|an\s+|the\s+)?(?:new\s+)?workspace\s+for\s+(.{1,200})$/iu.exec(input);
  if (!match) return null;
  const purpose = match[1].replace(/^["“]|["”]$/gu, '').trim();
  const query = normalized(purpose);
  const matches = projects.filter(project => {
    const name = normalized(project.title);
    return query === name || query.startsWith(name + ' for ') || query === 'my ' + name || query === name + ' project';
  });
  ensure(matches.length <= 1, 'vela_project_ambiguous');
  const referencesCurrent = /^(?:my|this|the current) project$/iu.test(purpose);
  const project = matches[0] ?? (referencesCurrent ? projects.find(item => item.id === currentProjectId) : undefined);
  return { type: 'constructWorkspace', title: project?.title ?? purpose, purpose: intent,
    projectId: project?.id ?? null, newProjectTitle: project ? null : purpose };
}

/** Preparation reads metadata; canonical template application and verification share the caller's transaction. */
export class VelaWorkspaceConstruction {
  private readonly host: WorkspaceConstructionHost;
  constructor(host: WorkspaceConstructionHost) { this.host=host; }

  async prepare(action: Construction, commandId: string, signal: AbortSignal): Promise<() => HostActionResult> {
    const scope = this.host.scopeStamp(), projectVersion = this.host.projectVersion(action.projectId);
    const plan = await this.host.templates.requestVelaTemplate({ requestId: commandId,
      prompt: action.purpose, projectId: action.projectId }, { signal });
    ensure(!signal.aborted && scope === this.host.scopeStamp(), 'vela_construction_scope_changed');
    ensure(plan.body.placements.length > 0 && plan.body.resources.length > 0, 'vela_construction_empty_blueprint');
    const frozen = structuredClone(plan);
    return () => this.host.once(commandId, { action, plan: frozen }, () => {
      ensure(!signal.aborted && scope === this.host.scopeStamp(), 'vela_construction_scope_changed');
      ensure(this.host.projectVersion(action.projectId) === projectVersion, 'project_version_conflict');
      const projectId = action.projectId ?? (action.newProjectTitle ? this.host.createProject(action.newProjectTitle) : null);
      const createdProjectId = action.projectId === null && projectId !== null ? projectId : undefined;
      const template = this.host.templates.saveTemplate({ ...frozen, name: action.title, source: 'vela' });
      const applied = this.host.templates.applyTemplate({ commandId: commandId + ':template', templateId: template.id,
        expectedVersion: template.version, title: action.title, projectId,
        ...(projectId ? { expectedProjectVersion: this.host.projectVersion(projectId) } : {}) });
      const actual = this.host.inspectWorkspace(applied.workspaceId);
      ensure(actual.workspaceId === applied.workspaceId && actual.projectId === projectId, 'vela_construction_target_mismatch');
      ensure(actual.blocks.length === frozen.body.placements.length, 'vela_construction_incomplete');
      const resources = frozen.body.resources.map(role => {
        const resourceId = applied.resourceIds[role.key], resource = this.host.resource(resourceId);
        ensure(resource && resource.state !== 'archived', 'vela_construction_resource_unavailable');
        ensure(role.source.mode !== 'reference' || resourceId === role.source.resourceId, 'vela_construction_duplicated_reference');
        return { role: role.key, resourceId, version: resource.version, reused: role.source.mode === 'reference' };
      });
      const placements = frozen.body.placements.map(role => {
        // Construction currently accepts functional resource cards, not unsupported subject placeholders.
        ensure(role.resourceKey !== undefined, 'vela_construction_subject_binding_unavailable');
        const blockId = applied.placementIds[role.key], resourceId = applied.resourceIds[role.resourceKey];
        const block = actual.blocks.find(item => item.blockId === blockId);
        ensure(block && block.resourceId === resourceId && block.resourceState === 'active', 'vela_construction_binding_mismatch');
        const source = frozen.body.resources.find(item => item.key === role.resourceKey)!;
        const minimum = blockDefinition(source.source.kind).minimumSize;
        ensure([block.x, block.y, block.width, block.height].every(Number.isFinite) &&
          block.width >= minimum.width && block.height >= minimum.height &&
          block.x === role.presentation.x && block.y === role.presentation.y &&
          block.width === role.presentation.width && block.height === role.presentation.height,
        'vela_construction_geometry_mismatch');
        return { role: role.key, blockId, resourceId };
      });
      const receipt: VelaWorkspaceConstructionReceipt = {
        contract: 'aerynth.vela-workspace-construction@1', workspaceId: actual.workspaceId, projectId,
        workspaceVersion: actual.workspaceVersion, layoutVersion: actual.revision,
        templateId: template.id, templateVersion: template.version, observedAt: new Date().toISOString(), resources, placements,
        verification: { workspaceExists: true, projectMatches: true, bindingsMatch: true, geometryValid: true },
      };
      this.host.record(actual.workspaceId, receipt);
      return { status: 'applied', receiptId: commandId, createdWorkspaceId: actual.workspaceId,
        ...(createdProjectId ? { createdProjectId } : {}), workspaceConstruction: receipt,
        responseText: `Created “${action.title}” with ${placements.length} blocks.` };
    });
  }
}
