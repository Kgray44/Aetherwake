import { createHash } from 'node:crypto';
import { ensure, ServiceError } from './contracts.mts';
import { specialistMissionObjective } from './mission-reviewed-composition.mts';
import { MISSION_LIMITS, type Mission, type MissionExecutor, type MissionRevisionChange,
  type MissionRevisionPreview, type MissionTask } from './mission-contracts.mts';

type Specialist = MissionTask['specialist'];
interface RevisionAuthority {
  executors: Readonly<Record<string, MissionExecutor>>;
  reassign?(mission: Mission, task: MissionTask, agentProfileId: string): Specialist;
  evidenceCurrent(task: MissionTask): boolean;
}

const id = (value: unknown): value is string => typeof value === 'string' && /^[\w.:-]{1,120}$/u.test(value);
const keys = (value: object, expected: string[]) =>
  Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const editable = (task: MissionTask) => task.state === 'queued' && task.attempts.length === 0;
const native = (task: MissionTask, authority: RevisionAuthority) =>
  authority.executors[task.executor]?.lane === 'native' && authority.executors[task.executor]?.replaySafe &&
  !task.projectCheck && !task.specialist && !task.teamMember;

export function buildMissionRevision(mission: Mission, change: MissionRevisionChange, authority: RevisionAuthority) {
  ensure(change && typeof change === 'object' && id(change.taskId), 'invalid_mission_revision');
  const task = mission.tasks.find(candidate => candidate.id === change.taskId);
  ensure(task, 'mission_revision_task_denied');
  let tasks = mission.tasks, retired: MissionTask | undefined, replacementTaskId: string | undefined;
  let summary: string;
  let externalReview: MissionRevisionPreview['externalReview'];
  switch (change.type) {
    case 'dependencies': {
      ensure(keys(change, ['type', 'taskId', 'dependencies']) && Array.isArray(change.dependencies) &&
        change.dependencies.length < MISSION_LIMITS.tasks && change.dependencies.every(id) &&
        new Set(change.dependencies).size === change.dependencies.length, 'invalid_mission_revision');
      const dependencies = [...change.dependencies];
      ensure(editable(task) && native(task, authority) &&
        (task.executor.startsWith('sample.') || task.dependencies.every(dep => dependencies.includes(dep))) &&
        JSON.stringify(dependencies) !== JSON.stringify(task.dependencies), 'mission_revision_dependency_denied');
      tasks = tasks.map(item => item === task ? { ...item, dependencies } : item);
      summary = `Change prerequisites for “${task.objective}” from ${task.dependencies.join(', ') || 'none'} to ${dependencies.join(', ') || 'none'}.`;
      break;
    }
    case 'reassign': {
      ensure(keys(change, ['type', 'taskId', 'agentProfileId']) && id(change.agentProfileId), 'invalid_mission_revision');
      ensure((task.executor === 'chatgpt.specialist' || task.executor === 'api.specialist') && !task.attempts.length && !task.dependencies.length &&
        ['queued', 'blocked'].includes(task.state), 'mission_revision_task_denied');
      const specialist = authority.reassign?.(mission, task, change.agentProfileId);
      ensure(specialist?.profile?.id === change.agentProfileId &&
        specialist.provider === task.specialist?.provider && specialist.webSearch === task.specialist?.webSearch &&
        (!task.teamMember || tasks.every(item => item === task || item.teamMember?.profileId !== change.agentProfileId)) &&
        JSON.stringify(specialist) !== JSON.stringify(task.specialist), 'mission_revision_reassignment_unavailable');
      const { detail: _detail, ...prior } = task;
      const updated: MissionTask = { ...prior, specialist, state: 'queued',
        ...(task.teamMember ? { teamMember: { ...task.teamMember, profileId: specialist.profile.id, title: specialist.role } } : {}) };
      tasks = tasks.map(item => item === task ? updated : item);
      summary = `Assign “${task.objective}” to ${specialist.role}. The task can send one request when the mission resumes.`;
      externalReview = { provider: specialist.provider === 'openai-api-vela' ? 'Vela dedicated API' : 'ChatGPT plan', model: specialist.model, effort: specialist.effort,
        objective: specialistMissionObjective(mission), instructions: specialist.instructions,
        ...(specialist.webSearch ? { webSearch: true } : {}) };
      break;
    }
    case 'replace':
    case 'retire': {
      ensure(native(task, authority) && ['queued', 'blocked', 'failed', 'cancelled'].includes(task.state) &&
        task.attempts.every(attempt => attempt.finishedAt && attempt.outcome && attempt.outcome !== 'uncertain'),
      'mission_revision_task_denied');
      let replacement: MissionTask | undefined;
      if (change.type === 'replace') {
        ensure(keys(change, ['type', 'taskId']) && task.attempts.length < task.maxAttempts, 'mission_revision_task_denied');
        replacementTaskId = 'replacement-' + hash([mission.id, mission.planRevision, task.id]).slice(0, 24);
        const { detail: _detail, ...prior } = task;
        replacement = { ...prior, id: replacementTaskId, attempts: [], state: 'queued',
          maxAttempts: task.maxAttempts - task.attempts.length };
        summary = `Replace “${task.objective}” with a fresh task using its remaining attempt budget. Dependent tasks will wait for the replacement.`;
      } else {
        ensure(keys(change, ['type', 'taskId', 'successorId']) && id(change.successorId), 'invalid_mission_revision');
        const successor = tasks.find(item => item.id === change.successorId);
        ensure(successor && successor !== task && native(successor, authority) &&
          successor.executor === task.executor && successor.criterion === task.criterion &&
          successor.objective === task.objective && JSON.stringify(successor.claims) === JSON.stringify(task.claims) &&
          task.dependencies.every(dep => successor.dependencies.includes(dep)) &&
          (editable(successor) || successor.state === 'verified' && authority.evidenceCurrent(successor)),
        'mission_revision_task_denied');
        replacementTaskId = successor.id;
        summary = `Retire “${task.objective}” as duplicate work. Its dependents will use equivalent task ${successor.id}.`;
      }
      retired = task;
      tasks = tasks.flatMap(item => {
        if (item === task) return replacement ? [replacement] : [];
        if (!item.dependencies.includes(task.id)) return [item];
        ensure(editable(item), 'mission_revision_dependency_denied');
        return [{ ...item, dependencies: [...new Set(item.dependencies.map(dep => dep === task.id ? replacementTaskId! : dep))] }];
      });
      break;
    }
    default: throw new ServiceError('invalid_mission_revision');
  }
  return { tasks, retired, replacementTaskId, summary, externalReview };
}
