import { randomUUID } from 'node:crypto';
import type { TemplateResourceRole, VelaTemplatePlan } from '../../block-library/contracts.ts';
import type { TemplateService } from '../../block-library/service.mts';
import { composeWorkspaceBlueprint } from '../../block-library/workspace-architect.mts';
import { ensure } from './contracts.mts';
import type { MissionProjection, MissionScope, MissionWorkroom, MissionWorkroomCard, MissionWorkroomPreview } from './mission-contracts.mts';
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
  roles: TemplateResourceRole[];
  dashboards: MissionWorkroomCard[];
  conversationKey: string;
  planRevision: number;
  agents: { taskId: string; key: string }[];
}
const checklist: TemplateResourceRole = {
  key: 'mission-checklist', label: 'Mission checklist',
  source: { mode: 'new', kind: 'checklist', title: 'Mission checklist', emptyChecklist: true },
};
const timeline: TemplateResourceRole = {
  key: 'mission-timeline', label: 'Mission timeline',
  source: { mode: 'new', kind: 'timeline', title: 'Mission timeline' },
};
const primaryChat: TemplateResourceRole = {
  key: 'mission-primary-chat', label: 'Mission conversation',
  source: { mode: 'new', kind: 'conversation', title: 'Mission conversation', provider: 'local' },
};
const dashboards = {
  graph: 'Mission graph',
  evidence: 'Verification evidence',
  performance: 'Mission performance',
  stream: 'Mission Intelligence Stream',
  team: 'Mission agent team',
} as const satisfies Record<MissionWorkroomCard, string>;
const dashboardRole = (card: MissionWorkroomCard): TemplateResourceRole => ({
  key: 'mission-' + card, label: dashboards[card],
  source: { mode: 'new', kind: card === 'stream' ? 'stream' : 'note', title: dashboards[card] },
});
const assignmentTitle = (objective: string): string => {
  // Template role labels permit 120 UTF-16 units. Keep a cut surrogate pair together.
  const label = `Specialist assignment · ${objective}`.slice(0, 120);
  const last = label.charCodeAt(label.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? label.slice(0, -1) : label;
};
const workroomToolbarInset = 96;
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
      ? 'Backend performance workroom' : mission.tasks.some(t => t.specialist) ? 'Specialist mission workroom' :
        mission.tasks.some(t => t.executor.startsWith('sample.')) ? 'System measurement workroom' : 'Mission workroom';
    const draft = await this.host.library.requestVelaTemplate({
      requestId: reviewId, projectId: scope.projectId,
      prompt: `Set up a ${research ? 'research' : 'software engineering'} workspace for ${title} with a local conversation and notes, without a checklist or timeline.`,
    });
    ensure(sameScope(scope, this.host.currentScope()), 'mission_workroom_scope_changed');
    const current = this.host.missions.read(missionId, scope);
    ensure(!current.workroom && canBuild(current.outcome), 'mission_workroom_unavailable');
    ensure(this.reviews.size < 8, 'mission_workroom_review_busy');
    const planned = draft.body.resources;
    const localChat = planned.find(role => role.source.mode === 'new' && role.source.kind === 'conversation' &&
      role.source.provider === 'local');
    const cards = (Object.keys(dashboards) as MissionWorkroomCard[]).filter(card => card !== 'team' ||
      current.tasks.some(task => task.specialist));
    const [graph, ...details] = cards.map(dashboardRole);
    const agents = current.tasks.filter(task => task.specialist).map((task, index) => ({
      taskId: task.id, key: 'mission-agent-' + (index + 1),
      title: assignmentTitle(task.objective),
    }));
    const roles = [graph, localChat ?? primaryChat, checklist, timeline, ...details,
      ...agents.map(({ key, title }): TemplateResourceRole => ({ key, label: title,
        source: { mode: 'new', kind: 'note', title } })),
      ...planned.filter(role => role !== localChat)];
    ensure(new Set(roles.map(role => role.key)).size === roles.length && planned.every(role =>
      role.source.kind !== 'checklist' && role.source.kind !== 'timeline'), 'mission_workroom_invalid_draft');
    const expires = Date.now() + 120_000;
    this.reviews.set(reviewId, { missionId, scope, projectVersion, expires, title, draft, roles, dashboards: cards,
      conversationKey: (localChat ?? primaryChat).key, planRevision: current.planRevision,
      agents: agents.map(({ taskId, key }) => ({ taskId, key })) });
    return { kind: 'workroom-preview', missionId, reviewId, title, expiresAt: new Date(expires).toISOString(),
      cards: roles.map(role => ({ title: role.label, kind: role.source.kind, mode: role.source.mode })) };
  }

  apply(missionId: string, reviewId: string): MissionWorkroom {
    const scope = this.host.currentScope();
    const mission = this.host.missions.read(missionId, scope);
    if (mission.workroom) return mission.workroom;
    const review = this.reviews.get(reviewId);
    ensure(this.host.writable() && review && review.missionId === missionId && review.expires > Date.now() &&
      sameScope(review.scope, scope) && sameScope(mission.scope, scope) && canBuild(mission.outcome) &&
      review.planRevision === mission.planRevision, 'mission_workroom_review_required');
    const result = this.host.atomic(() => {
      // Templates bind an existing Timeline. Provision it through its canonical factory in the same transaction.
      const timelineResource = this.host.createTimeline({ commandId: reviewId + ':timeline', title: timeline.label,
        projectId: scope.projectId, missionCreatedAt: mission.createdAt });
      const body = composeWorkspaceBlueprint(review.roles.map(role => role.key === timeline.key ? {
        ...timeline,
        source: { mode: 'reference', kind: 'timeline', resourceId: timelineResource.resourceId, expectedVersion: timelineResource.version },
      } : role), new Set([checklist.key]));
      // Leave the leading graph and conversation below the fixed workspace controls.
      body.viewport.y = -Math.ceil(workroomToolbarInset / body.viewport.zoom);
      const saved = this.host.library.saveTemplate({ ...review.draft, body, source: 'vela',
        description: `Reviewed mission workroom layout with ${body.placements.length} resource placements.` });
      const applied = this.host.library.applyTemplate({
        commandId: reviewId, templateId: saved.id, expectedVersion: saved.version, title: review.title,
        projectId: scope.projectId, expectedProjectVersion: review.projectVersion,
      });
      const missionChecklistResourceId = applied.resourceIds[checklist.key];
      const missionConversationResourceId = applied.resourceIds[review.conversationKey];
      ensure(missionConversationResourceId && missionChecklistResourceId && applied.resourceIds[timeline.key] === timelineResource.resourceId, 'mission_workroom_invalid_bindings');
      const missionCards: NonNullable<MissionWorkroom['missionCards']> = {};
      for (const card of review.dashboards) {
        const id = applied.resourceIds[dashboardRole(card).key];
        ensure(id, 'mission_workroom_invalid_bindings');
        missionCards[card] = id;
      }
      const missionAgentCards = Object.fromEntries(review.agents.map(agent => {
        const id = applied.resourceIds[agent.key];
        ensure(id, 'mission_workroom_invalid_bindings');
        return [agent.taskId, id];
      }));
      const workroom: MissionWorkroom = { kind: 'workroom', workspaceId: applied.workspaceId, title: review.title,
        templateId: applied.templateId, missionConversationResourceId, missionChecklistResourceId,
        missionTimelineResourceId: timelineResource.resourceId, missionCards,
        ...(review.agents.length ? { missionAgentCards } : {}) };
      this.host.missions.attachWorkroom(mission.id, scope, workroom);
      return workroom;
    });
    this.reviews.delete(reviewId);
    return result;
  }
}
