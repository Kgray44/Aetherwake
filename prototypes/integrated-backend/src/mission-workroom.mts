import { randomUUID } from 'node:crypto';
import type { TemplateResourceRole, VelaTemplatePlan } from '../../block-library/contracts.ts';
import type { TemplateService } from '../../block-library/service.mts';
import { composeWorkspaceBlueprint } from '../../block-library/workspace-architect.mts';
import { ensure } from './contracts.mts';
import type { MissionProjection, MissionScope, MissionWorkroom, MissionWorkroomPreview } from './mission-contracts.mts';
import type { MissionService } from './mission-service.mts';

interface WorkroomHost {
  library: Pick<TemplateService, 'requestVelaTemplate' | 'saveTemplate' | 'applyTemplate'>;
  missions: Pick<MissionService, 'read' | 'attachWorkroom'>;
  createTimeline(input: { commandId: string; title: string; projectId: string | null; missionCreatedAt: string }): {
    resourceId: string; version: number;
  };
  currentScope(): MissionScope;
  projectVersion(projectId: string): number | undefined;
  writable(): boolean;
  atomic<T>(work: () => T): T;
}
interface Pending {
  missionId: string;
  scope: MissionScope;
  projectVersion?: number;
  expires: number;
  title: string;
  draft: VelaTemplatePlan;
}
const checklist: TemplateResourceRole = {
  key: 'mission-checklist', label: 'Mission checklist',
  source: { mode: 'new', kind: 'checklist', title: 'Mission checklist', emptyChecklist: true },
};
const timelineKey = 'mission-timeline';
const timelineTitle = 'Mission timeline';
const canBuild = (state: MissionProjection['outcome']) => state !== 'cancelling';
const sameScope = (a: MissionScope, b: MissionScope) => a.workspaceId === b.workspaceId && a.projectId === b.projectId;

/** A short-lived review capability around existing canonical template transactions. */
export class MissionWorkrooms {
  private readonly host: WorkroomHost;
  private readonly reviews = new Map<string, Pending>();

  constructor(host: WorkroomHost) { this.host = host; }

  async preview(missionId: string): Promise<MissionWorkroomPreview> {
    const scope = this.host.currentScope();
    const mission = this.host.missions.read(missionId, scope);
    ensure(!mission.workroom && canBuild(mission.outcome) && sameScope(mission.scope, scope), 'mission_workroom_unavailable');
    const projectVersion = scope.projectId === null ? undefined : this.host.projectVersion(scope.projectId);
    ensure(scope.projectId === null || projectVersion !== undefined, 'mission_scope_denied');
    for (const [id, row] of this.reviews) if (Date.now() >= row.expires || row.missionId === missionId) this.reviews.delete(id);
    ensure(this.reviews.size < 8, 'mission_workroom_review_busy');
    const reviewId = randomUUID();
    const research = mission.tasks.some(t => t.specialist?.webSearch);
    const title = research ? 'Research workroom' : mission.tasks.some(t => t.executor === 'inspect.backend-source')
      ? 'Backend performance workroom' : 'System measurement workroom';
    const draft = await this.host.library.requestVelaTemplate({
      requestId: reviewId, projectId: scope.projectId,
      prompt: `Set up a ${research ? 'research' : 'software engineering'} workspace for ${title} with a local conversation and notes, without a checklist or timeline.`,
    });
    ensure(sameScope(scope, this.host.currentScope()), 'mission_workroom_scope_changed');
    const current = this.host.missions.read(missionId, scope);
    ensure(!current.workroom && canBuild(current.outcome), 'mission_workroom_unavailable');
    ensure(this.reviews.size < 8, 'mission_workroom_review_busy');
    ensure(draft.body.resources.every(role => role.source.kind !== 'checklist' && role.source.kind !== 'timeline' &&
      role.key !== checklist.key && role.key !== timelineKey), 'mission_workroom_invalid_draft');
    const expires = Date.now() + 120_000;
    this.reviews.set(reviewId, { missionId, scope, projectVersion, expires, title, draft });
    return { kind: 'workroom-preview', missionId, reviewId, title, expiresAt: new Date(expires).toISOString(),
      cards: [...draft.body.resources.map(role => ({ title: role.label, kind: role.source.kind, mode: role.source.mode })),
        { title: checklist.label, kind: 'checklist', mode: 'new' }, { title: timelineTitle, kind: 'timeline', mode: 'new' }] };
  }

  apply(missionId: string, reviewId: string): MissionWorkroom {
    const scope = this.host.currentScope();
    const mission = this.host.missions.read(missionId, scope);
    if (mission.workroom) return mission.workroom;
    const review = this.reviews.get(reviewId);
    ensure(this.host.writable() && review && review.missionId === missionId && review.expires > Date.now() &&
      sameScope(review.scope, scope) && sameScope(mission.scope, scope) && canBuild(mission.outcome), 'mission_workroom_review_required');
    const result = this.host.atomic(() => {
      // Templates bind an existing Timeline. Provision it through its canonical factory in the same transaction.
      const timeline = this.host.createTimeline({ commandId: reviewId + ':timeline', title: timelineTitle,
        projectId: scope.projectId, missionCreatedAt: mission.createdAt });
      const body = composeWorkspaceBlueprint([...review.draft.body.resources, checklist, {
        key: timelineKey, label: timelineTitle,
        source: { mode: 'reference', kind: 'timeline', resourceId: timeline.resourceId, expectedVersion: timeline.version },
      }], new Set([checklist.key]));
      const saved = this.host.library.saveTemplate({ ...review.draft, body, source: 'vela',
        description: `Reviewed mission workroom with ${body.resources.length} resources, including a dedicated checklist and timeline.` });
      const applied = this.host.library.applyTemplate({
        commandId: reviewId, templateId: saved.id, expectedVersion: saved.version, title: review.title,
        projectId: scope.projectId, expectedProjectVersion: review.projectVersion,
      });
      const missionChecklistResourceId = applied.resourceIds[checklist.key];
      ensure(missionChecklistResourceId && applied.resourceIds[timelineKey] === timeline.resourceId, 'mission_workroom_invalid_bindings');
      const workroom: MissionWorkroom = { kind: 'workroom', workspaceId: applied.workspaceId, title: review.title,
        templateId: applied.templateId, missionChecklistResourceId, missionTimelineResourceId: timeline.resourceId };
      this.host.missions.attachWorkroom(mission.id, scope, workroom);
      return workroom;
    });
    this.reviews.delete(reviewId);
    return result;
  }
}
