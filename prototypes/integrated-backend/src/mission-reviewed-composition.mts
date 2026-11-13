import { prepareImageGeneration } from '../../openai-provider/images.mts';
import { ensure } from './contracts.mts';
import { ARTIFACT_MISSION_PREFIX, EXPLICIT_MISSION_PREFIX, MISSION_LIMITS, type MissionPlan } from './mission-contracts.mts';

/** The semicolon introduces an explicit artifact request. The image prompt stays opaque. */
export function parseReviewedArtifactMission(objective: string) {
  if (typeof objective !== 'string' || Buffer.byteLength(objective) > 4096) return null;
  const text = objective.trim();
  const prefix = EXPLICIT_MISSION_PREFIX.exec(text);
  if (!prefix) return null;
  const work = text.slice(prefix[0].length);
  const boundary = work.indexOf(';');
  if (boundary < 1) return null;
  const workObjective = work.slice(0, boundary).trim();
  if (!workObjective || /^generate an illustration\b/iu.test(workObjective)) return null;
  const artifact = 'run a mission to ' + work.slice(boundary + 1).trimStart();
  const request = ARTIFACT_MISSION_PREFIX.exec(artifact);
  return request ? { workObjective, imageOptions: request[1]?.trim(), imagePrompt: artifact.slice(request[0].length) } : null;
}

/** Use only existing host planners. A recognized request must cover both parts. */
export function resolveReviewedArtifactMission(objective: string, workPlan: (objective: string) => MissionPlan | null,
  imagePlan: (prompt: string, options?: string) => MissionPlan,
  request = parseReviewedArtifactMission(objective)): MissionPlan | null {
  if (!request) return null;
  const work = workPlan(request.workObjective);
  ensure(work, 'mission_composition_work_unsupported');
  return composeReviewedArtifactMission(objective, work, imagePlan(request.imagePrompt, request.imageOptions));
}

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
  // Version zero represents an unconfigured provider in the existing preview.
  ensure(image && Number.isSafeInteger(image.configurationVersion) && image.configurationVersion >= 0 &&
    prepareImageGeneration(image.prompt, image.settings).digest === image.digest, 'mission_composition_artifact_changed');

  return structuredClone({
    ...work, objective: objective.trim(), criteria: [...work.criteria, imageTask.criterion],
    tasks: [...branches, imageTask, {
      ...report, objective: 'Join the verified task evidence and workspace artifacts',
      dependencies: [...report.dependencies, imageTask.id],
    }],
  });
}
