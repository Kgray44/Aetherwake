import { prepareImageGeneration } from '../../openai-provider/images.mts';
import { ensure } from './contracts.mts';
import { MISSION_LIMITS, type MissionPlan } from './mission-contracts.mts';

/**
 * Combine host-built plans before Start review. Callers still validate the
 * composed graph and require each existing effect approval at dispatch.
 */
export function composeReviewedArtifactMission(objective: string, work: MissionPlan, artifact: MissionPlan): MissionPlan {
  ensure(work.scope.workspaceId === artifact.scope.workspaceId && work.scope.projectId === artifact.scope.projectId,
    'mission_composition_scope_changed');
  ensure(typeof objective === 'string' && objective.trim() && Buffer.byteLength(objective) <= 4096 &&
    !artifact.team && !artifact.planning && !artifact.originConversationId && !artifact.coverage &&
    artifact.tasks.length === 1 && artifact.criteria.length === 1 && work.tasks.length < MISSION_LIMITS.tasks &&
    !work.team && !work.originConversationId && !work.tasks.some(task => task.artifactImage || task.executor === 'artifact.illustration'),
    'invalid_mission_composition');

  const [imageTask] = artifact.tasks;
  const image = imageTask.artifactImage;
  const report = work.tasks.find(task => task.id === 'report');
  const branches = work.tasks.filter(task => task !== report);
  ensure(imageTask.executor === 'artifact.illustration' && imageTask.maxAttempts === 1 && !imageTask.dependencies.length &&
    imageTask.criterion === artifact.criteria[0] && !imageTask.projectCheck && !imageTask.specialist && !imageTask.teamMember &&
    !work.criteria.includes(imageTask.criterion) && !work.tasks.some(task => task.id === imageTask.id) &&
    report?.executor === 'join.samples' && !report.projectCheck && !report.specialist && !report.teamMember &&
    report.dependencies.length === branches.length && branches.length > 0 &&
    branches.every(task => report.dependencies.includes(task.id) && !task.dependencies.includes(report.id) &&
      task.executor !== 'join.samples' && task.executor !== 'join.team'),
    'invalid_mission_composition');
  ensure(image && Number.isSafeInteger(image.configurationVersion) && image.configurationVersion > 0 &&
    prepareImageGeneration(image.prompt, image.settings).digest === image.digest, 'mission_composition_artifact_changed');

  return structuredClone({
    ...work, objective: objective.trim(), criteria: [...work.criteria, imageTask.criterion],
    tasks: [...branches, imageTask, {
      ...report, objective: 'Join the verified task evidence and workspace artifacts',
      dependencies: [...report.dependencies, imageTask.id],
    }],
  });
}
