import { createHash } from 'node:crypto';
import { MISSION_LIMITS, type MissionObjectiveAssessment, type MissionProjection, type MissionRevisionChange, type MissionRevisionPreview } from './mission-contracts.mts';
import { missionMeasurementAnswer } from './mission-native.mts';

const actions = ['continue', 'request-context', 'request-completion-review', 'recommend-specialist', 'replace', 'dependencies', 'retire'] as const;
type Action = typeof actions[number];
export const missionExecutiveSchema = {
  type: 'object', additionalProperties: false, required: ['version', 'action', 'target', 'related', 'reason'],
  properties: {
    version: { type: 'integer', enum: [1] },
    action: { type: 'string', enum: actions,
      description: 'Replace can propose retry of a known failed task in a paused mission. Unknown effects require reconciliation. Use advice when no safe change is supported.' },
    target: { type: 'string', description: 'Exact supplied task handle for a revision or specialist recommendation. Empty for other advice.' },
    related: { type: 'array', items: { type: 'string' },
      description: 'Empty except for dependencies or retire. For dependencies, list prerequisite handles. For retire, supply one equivalent successor handle.' },
    reason: { type: 'string' },
  },
} as const;
export const missionObjectiveAssessmentSchema = {
  type: 'object', additionalProperties: false, required: ['version', 'findings'],
  properties: {
    version: { type: 'integer', enum: [1] },
    findings: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['status', 'statement', 'evidence'],
      properties: {
        status: { type: 'string', enum: ['supported', 'unverified'] },
        statement: { type: 'string', description: 'Explain missing evidence for unverified findings. Leave empty for supported observations.' },
        evidence: { type: 'array', items: { type: 'string' } },
      },
    } },
  },
} as const;

export interface ExecutivePacket {
  version: 1;
  basedOnRevision: number;
  basedOnPlanRevision: number;
  objective: string;
  disposition: MissionProjection['disposition'];
  outcome: MissionProjection['outcome'];
  trigger: { sequence: number; kind: 'settled' | 'recovered'; task: string | null };
  tasks: { handle: string; objective: string; state: MissionProjection['tasks'][number]['state'];
    dependencies: string[]; verified: boolean; unknown: boolean; executor: string; remainingAttempts: number;
    verificationDetail?: string }[];
  completion?: { limitations: string[]; observations: { handle: string; kind: string; values: Record<string, number> }[] };
}
interface ExecutiveOwner {
  read(): MissionProjection;
  disclose(packet: ExecutivePacket, signal: AbortSignal, isCurrent: () => boolean): Promise<unknown>;
  preview(revision: number, change: MissionRevisionChange): MissionRevisionPreview;
}
interface ExecutiveCheckpoint {
  missionId: string;
  revision: number;
  planRevision: number;
  triggerSequence: number;
  digest: string;
}
export type ExecutiveResult =
  | { state: 'unavailable' | 'stale' }
  | { state: 'rejected'; reasonCode: 'invalid-proposal' | 'invalid-arguments' | 'uneditable-checkpoint' | 'canonical-revision-rejected';
    action?: Action; canonicalCode?: string }
  | { state: 'advisory'; checkpoint: ExecutiveCheckpoint; action: 'continue' | 'request-context' | 'request-completion-review'; reason: string }
  | { state: 'advisory'; checkpoint: ExecutiveCheckpoint; action: 'recommend-specialist'; taskId: string; reason: string }
  | { state: 'completion-assessed'; checkpoint: ExecutiveCheckpoint; findings: MissionObjectiveAssessment['findings'] }
  | { state: 'reviewable'; checkpoint: ExecutiveCheckpoint; change: MissionRevisionChange; preview: MissionRevisionPreview; reason: string };

function parse(value: unknown): { action: Action; target: string; related: string[]; reason: string } | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== missionExecutiveSchema.required.length ||
    !missionExecutiveSchema.required.every(key => Object.hasOwn(row, key)) || row.version !== 1 ||
    !actions.includes(row.action as Action) || typeof row.target !== 'string' || row.target.length > 8 ||
    !Array.isArray(row.related) || row.related.length > 16 || !row.related.every(id => typeof id === 'string' && /^t[1-9][0-9]*$/.test(id)) ||
    new Set(row.related).size !== row.related.length ||
    typeof row.reason !== 'string' || !row.reason.trim() || Buffer.byteLength(row.reason) > 1000) return;
  return { action: row.action as Action, target: row.target, related: [...row.related], reason: row.reason };
}

const observationFields: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'sample.cpu': ['percent', 'sampleMs', 'logicalCpus'],
  'sample.gpu': ['percent', 'observedAdapters', 'observedEngines'],
  'sample.ram': ['utilizationPercent', 'totalBytes', 'availableBytes'],
  'sample.backend': ['rssBytes', 'heapUsedBytes', 'timerOvershootMs', 'sampleWindowMs'],
  'codex.project-check': ['testCount'],
});

function checkedObservation(task: MissionProjection['tasks'][number]) {
  const attempt = task.attempts.at(-1), evidence = attempt?.evidence;
  const fields = Object.hasOwn(observationFields, task.executor) ? observationFields[task.executor] : undefined;
  if (!fields || task.state !== 'verified' || attempt?.outcome !== 'verified' || !evidence ||
    evidence.attemptId !== attempt.id || !attempt.verification?.passed || !attempt.verification.evidenceIds.includes(evidence.id) ||
    !evidence.value || typeof evidence.value !== 'object') return;
  const value = evidence.value as Record<string, unknown>;
  const values: Record<string, number> = {};
  for (const field of fields) {
    if (typeof value[field] !== 'number' || !Number.isFinite(value[field])) return;
    values[field] = value[field];
  }
  const statement = missionMeasurementAnswer([task])[0] ??
    (task.executor === 'codex.project-check' ? `Read-only Node checks passed (${values.testCount} tests).`
      : task.executor === 'sample.backend' ? `Aerynth backend sample measured ${values.rssBytes} RSS bytes and ${values.timerOvershootMs.toFixed(2)} ms of timer overshoot.` : undefined);
  if (statement) return { evidenceId: evidence.id, values, statement };
}

type ObservationReference = { taskId: string; evidenceId: string; statement: string };
function parseObjectiveAssessment(value: unknown, references: ReadonlyMap<string, ObservationReference>) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2) return;
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1 || !Array.isArray(raw.findings) || raw.findings.length < 1 || raw.findings.length > 8) return;
  const findings: MissionObjectiveAssessment['findings'] = [];
  const used = new Set<string>();
  for (const row of raw.findings) {
    if (!row || Object.keys(row).length !== 3 || !['supported', 'unverified'].includes(row.status) ||
      typeof row.statement !== 'string' || Buffer.byteLength(row.statement) > 480 || !Array.isArray(row.evidence)) return;
    if (row.status === 'unverified') {
      if (!row.statement.trim() || row.evidence.length) return;
      findings.push({ status: 'unverified', statement: row.statement, evidence: [] });
      continue;
    }
    const handle = row.evidence[0], reference = typeof handle === 'string' && references.get(handle);
    if (row.evidence.length !== 1 || !reference || used.has(handle)) return;
    used.add(handle);
    const { taskId, evidenceId, statement } = reference;
    findings.push({ status: 'supported', statement, evidence: [{ taskId, evidenceId }] });
  }
  return findings.some(row => row.status === 'unverified') ? findings : undefined;
}

export function projectExecutiveCheckpoint(mission: MissionProjection, triggerSeq: number) {
  const event = mission.events.findLast(entry => entry.kind === 'settled' || entry.kind === 'recovered');
  if (!event || event.seq !== triggerSeq || (event.kind !== 'settled' && event.kind !== 'recovered') ||
    mission.disposition === 'cancelled' || mission.tasks.length > MISSION_LIMITS.tasks) return;
  const handles = new Map(mission.tasks.map((task, index) => [task.id, 't' + (index + 1)]));
  const tasks = mission.tasks.map(task => ({
    handle: handles.get(task.id)!, objective: task.objective, state: task.state,
    dependencies: task.dependencies.map(id => handles.get(id)!),
    verified: task.state === 'verified' && task.attempts.at(-1)?.verification?.passed === true,
    unknown: task.state === 'uncertain' || task.attempts.some(attempt => attempt.outcome === 'uncertain'),
    executor: task.executor,
    remainingAttempts: Math.max(0, task.maxAttempts - task.attempts.length),
    verificationDetail: task.attempts.at(-1)?.verification?.detail,
  }));
  const packet: ExecutivePacket = {
    version: 1, basedOnRevision: mission.revision, basedOnPlanRevision: mission.planRevision,
    objective: mission.objective, disposition: mission.disposition, outcome: mission.outcome,
    trigger: { sequence: event.seq, kind: event.kind, task: event.taskId ? handles.get(event.taskId) ?? null : null },
    tasks,
  };
  const observations = new Map<string, ObservationReference>();
  if (mission.outcome === 'blocked' && mission.coverage && mission.tasks.every(task => task.state === 'verified')) {
    const evidence = mission.tasks.flatMap(task => {
      const observed = checkedObservation(task);
      if (!observed) return [];
      const handle = handles.get(task.id)!;
      observations.set(handle, { taskId: task.id, evidenceId: observed.evidenceId, statement: observed.statement });
      return [{ handle, kind: task.executor, values: observed.values }];
    });
    packet.completion = { limitations: mission.coverage.limitations, observations: evidence };
  }
  return { packet, handles, observations };
}

/** Project one meaningful owner event and compile only a reviewable MissionService change. */
export async function proposeMissionExecutiveRevision(triggerSeq: number, owner: ExecutiveOwner,
  cancel?: AbortSignal): Promise<ExecutiveResult> {
  const timeout = AbortSignal.timeout(15_000);
  const signal = cancel ? AbortSignal.any([cancel, timeout]) : timeout;
  try {
    signal.throwIfAborted();
    const mission = structuredClone(owner.read());
    const projected = projectExecutiveCheckpoint(mission, triggerSeq);
    if (!projected) return { state: 'unavailable' };
    const { packet, handles, observations } = projected;
    const encoded = JSON.stringify(packet);
    const checkpoint: ExecutiveCheckpoint = {
      missionId: mission.id, revision: mission.revision, planRevision: mission.planRevision, triggerSequence: triggerSeq,
      digest: createHash('sha256').update(encoded).digest('hex'),
    };
    if (Buffer.byteLength(encoded) > 12000) return { state: 'unavailable' };
    const isCurrent = () => {
      const current = owner.read();
      return current.id === mission.id && JSON.stringify(projectExecutiveCheckpoint(current, triggerSeq)?.packet) === encoded;
    };
    const raw = await owner.disclose(packet, signal, isCurrent);
    signal.throwIfAborted();
    if (!isCurrent()) return { state: 'stale' };
    if (raw == null) return { state: 'unavailable' };
    if (packet.completion) {
      const findings = parseObjectiveAssessment(raw, observations);
      return findings ? { state: 'completion-assessed', checkpoint, findings } : { state: 'rejected', reasonCode: 'invalid-proposal' };
    }
    const proposal = parse(raw);
    if (!proposal) return { state: 'rejected', reasonCode: 'invalid-proposal' };
    const { action, target, related, reason } = proposal;
    if (action === 'continue' || action === 'request-context' || action === 'request-completion-review') {
      return !target && !related.length ? { state: 'advisory', checkpoint, action, reason } : { state: 'rejected', reasonCode: 'invalid-arguments', action };
    }
    const task = mission.tasks.find(item => handles.get(item.id) === target);
    if (action === 'recommend-specialist') {
      if (!task || related.length) return { state: 'rejected', reasonCode: 'invalid-arguments', action };
      if ((task.state !== 'failed' && task.state !== 'blocked') || task.attempts.some(attempt => attempt.outcome === 'uncertain'))
        return { state: 'rejected', reasonCode: 'uneditable-checkpoint', action };
      return { state: 'advisory', checkpoint, action, taskId: task.id, reason };
    }
    if (mission.disposition !== 'paused' || !task || task.state === 'verified' ||
      packet.tasks.some(item => item.unknown || item.state === 'running' || item.state === 'cancelling')) return { state: 'rejected', reasonCode: 'uneditable-checkpoint', action };
    const refs = related.map(handle => mission.tasks.find(item => handles.get(item.id) === handle)?.id);
    if (refs.some(id => id === undefined || id === task.id)) return { state: 'rejected', reasonCode: 'invalid-arguments', action };
    let change: MissionRevisionChange;
    if (action === 'replace' && refs.length === 0) change = { type: action, taskId: task.id };
    else if (action === 'dependencies') change = { type: action, taskId: task.id, dependencies: refs as string[] };
    else if (action === 'retire' && refs.length === 1) change = { type: action, taskId: task.id, successorId: refs[0]! };
    else return { state: 'rejected', reasonCode: 'invalid-arguments', action };
    try {
      const preview = owner.preview(mission.revision, change);
      return { state: 'reviewable', checkpoint, change, preview, reason };
    } catch (error) {
      const code = (error as { code?: unknown })?.code;
      const canonicalCode = typeof code === 'string' && /^mission_[a-z_]{1,80}$/.test(code) ? code : undefined;
      return { state: 'rejected', reasonCode: 'canonical-revision-rejected', action, ...(canonicalCode ? { canonicalCode } : {}) };
    }
  } catch {
    return { state: 'unavailable' };
  }
}
