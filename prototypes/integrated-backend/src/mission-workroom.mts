import { randomUUID } from 'node:crypto';
import type { VelaTemplatePlan } from '../../block-library/contracts.ts';
import type { TemplateService } from '../../block-library/service.mts';
import { ServiceError } from './contracts.mts';
import type { MissionScope, MissionWorkroom, MissionWorkroomPreview } from './mission-contracts.mts';
import type { MissionService } from './mission-service.mts';

interface WorkroomHost {
  library: Pick<TemplateService, 'requestVelaTemplate' | 'saveTemplate' | 'applyTemplate'>;
  missions: MissionService;
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
const check: (ok: unknown, code: string) => asserts ok = (ok, code) => { if (!ok) throw new ServiceError(code); };
const canBuild = (state: string) => ['verified', 'failed', 'blocked', 'cancelled', 'uncertain'].includes(state);
const sameScope = (a: MissionScope, b: MissionScope) => a.workspaceId === b.workspaceId && a.projectId === b.projectId;

/** A short-lived review capability around existing canonical template transactions. */
export class MissionWorkrooms {
  private readonly host: WorkroomHost;
  private readonly reviews = new Map<string, Pending>();

  constructor(host: WorkroomHost) { this.host = host; }

  async preview(missionId: string): Promise<MissionWorkroomPreview> {
    const scope = this.host.currentScope();
    const mission = this.host.missions.read(missionId, scope);
    check(!mission.workroom && canBuild(mission.outcome) && sameScope(mission.scope, scope), 'mission_workroom_unavailable');
    const projectVersion = scope.projectId === null ? undefined : this.host.projectVersion(scope.projectId);
    check(scope.projectId === null || projectVersion !== undefined, 'mission_scope_denied');
    for (const [id, row] of this.reviews) if (Date.now() >= row.expires || row.missionId === missionId) this.reviews.delete(id);
    check(this.reviews.size < 8, 'mission_workroom_review_busy');
    const reviewId = randomUUID();
    const research = mission.tasks.some(t => t.specialist?.webSearch);
    const title = research ? 'Research workroom' : mission.tasks.some(t => t.executor === 'inspect.backend-source')
      ? 'Backend performance workroom' : 'System measurement workroom';
    const draft = await this.host.library.requestVelaTemplate({
      requestId: reviewId, projectId: scope.projectId,
      prompt: `Set up a ${research ? 'research' : 'software engineering'} workspace for ${title} with a local conversation, notes, checklist and timeline.`,
    });
    check(sameScope(scope, this.host.currentScope()) && !this.host.missions.read(missionId, scope).workroom, 'mission_workroom_scope_changed');
    check(this.reviews.size < 8, 'mission_workroom_review_busy');
    const expires = Date.now() + 120_000;
    this.reviews.set(reviewId, { missionId, scope, projectVersion, expires, title, draft });
    return { kind: 'workroom-preview', missionId, reviewId, title, expiresAt: new Date(expires).toISOString(),
      cards: draft.body.resources.map(role => ({ title: role.label, kind: role.source.kind, mode: role.source.mode })) };
  }

  apply(missionId: string, reviewId: string): MissionWorkroom {
    const scope = this.host.currentScope();
    const mission = this.host.missions.read(missionId, scope);
    if (mission.workroom) return mission.workroom;
    const review = this.reviews.get(reviewId);
    check(this.host.writable() && review && review.missionId === missionId && review.expires > Date.now() &&
      sameScope(review.scope, scope) && sameScope(mission.scope, scope) && canBuild(mission.outcome), 'mission_workroom_review_required');
    const result = this.host.atomic(() => {
      const saved = this.host.library.saveTemplate({ ...review.draft, source: 'vela' });
      const applied = this.host.library.applyTemplate({
        commandId: reviewId, templateId: saved.id, expectedVersion: saved.version, title: review.title,
        projectId: scope.projectId, expectedProjectVersion: review.projectVersion,
      });
      const workroom: MissionWorkroom = { kind: 'workroom', workspaceId: applied.workspaceId, title: review.title,
        templateId: applied.templateId };
      this.host.missions.attachWorkroom(mission.id, scope, workroom);
      return workroom;
    });
    this.reviews.delete(reviewId);
    return result;
  }
}
