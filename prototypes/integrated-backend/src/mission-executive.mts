import { createHash } from 'node:crypto';
import { MISSION_LIMITS, type MissionProjection, type MissionRevisionChange, type MissionRevisionPreview } from './mission-contracts.mts';

const actions = ['continue', 'request-context', 'request-completion-review', 'replace', 'dependencies', 'retire'] as const;
type Action = typeof actions[number];
export const missionExecutiveSchema = {
  type: 'object', additionalProperties: false, required: ['version', 'action', 'target', 'related', 'reason'],
  properties: {
    version: { type: 'integer', enum: [1] },
    action: { type: 'string', enum: actions },
    target: { type: 'string' },
    related: { type: 'array', items: { type: 'string' } },
    reason: { type: 'string' },
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
    dependencies: string[]; verified: boolean; unknown: boolean }[];
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
type ExecutiveResult =
  | { state: 'unavailable' | 'rejected' | 'stale' }
  | { state: 'advisory'; checkpoint: ExecutiveCheckpoint; action: 'continue' | 'request-context' | 'request-completion-review'; reason: string }
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

function projectCheckpoint(mission: MissionProjection, triggerSeq: number) {
  const event = mission.events.findLast(entry => entry.kind === 'settled' || entry.kind === 'recovered');
  if (!event || event.seq !== triggerSeq || (event.kind !== 'settled' && event.kind !== 'recovered') ||
    mission.disposition === 'cancelled' || mission.tasks.length > MISSION_LIMITS.tasks) return;
  const handles = new Map(mission.tasks.map((task, index) => [task.id, 't' + (index + 1)]));
  const tasks = mission.tasks.map(task => ({
    handle: handles.get(task.id)!, objective: task.objective, state: task.state,
    dependencies: task.dependencies.map(id => handles.get(id)!),
    verified: task.state === 'verified' && task.attempts.at(-1)?.verification?.passed === true,
    unknown: task.state === 'uncertain' || task.attempts.some(attempt => attempt.outcome === 'uncertain'),
  }));
  const packet: ExecutivePacket = {
    version: 1, basedOnRevision: mission.revision, basedOnPlanRevision: mission.planRevision,
    objective: mission.objective, disposition: mission.disposition, outcome: mission.outcome,
    trigger: { sequence: event.seq, kind: event.kind, task: event.taskId ? handles.get(event.taskId) ?? null : null },
    tasks,
  };
  return { packet, handles };
}

/** Project one meaningful owner event and compile only a reviewable MissionService change. */
export async function proposeMissionExecutiveRevision(triggerSeq: number, owner: ExecutiveOwner,
  cancel?: AbortSignal): Promise<ExecutiveResult> {
  const timeout = AbortSignal.timeout(15_000);
  const signal = cancel ? AbortSignal.any([cancel, timeout]) : timeout;
  try {
    signal.throwIfAborted();
    const mission = structuredClone(owner.read());
    const projected = projectCheckpoint(mission, triggerSeq);
    if (!projected) return { state: 'unavailable' };
    const { packet, handles } = projected;
    const encoded = JSON.stringify(packet);
    const checkpoint: ExecutiveCheckpoint = {
      missionId: mission.id, revision: mission.revision, planRevision: mission.planRevision, triggerSequence: triggerSeq,
      digest: createHash('sha256').update(encoded).digest('hex'),
    };
    if (Buffer.byteLength(encoded) > 12000) return { state: 'unavailable' };
    const isCurrent = () => {
      const current = owner.read();
      return current.id === mission.id && JSON.stringify(projectCheckpoint(current, triggerSeq)?.packet) === encoded;
    };
    const raw = await owner.disclose(packet, signal, isCurrent);
    signal.throwIfAborted();
    if (!isCurrent()) return { state: 'stale' };
    if (raw == null) return { state: 'unavailable' };
    const proposal = parse(raw);
    if (!proposal) return { state: 'rejected' };
    const { action, target, related, reason } = proposal;
    if (action === 'continue' || action === 'request-context' || action === 'request-completion-review') {
      return !target && !related.length ? { state: 'advisory', checkpoint, action, reason } : { state: 'rejected' };
    }
    const task = mission.tasks.find(item => handles.get(item.id) === target);
    if (mission.disposition !== 'paused' || !task || task.state === 'verified' ||
      packet.tasks.some(item => item.unknown || item.state === 'running' || item.state === 'cancelling')) return { state: 'rejected' };
    const refs = related.map(handle => mission.tasks.find(item => handles.get(item.id) === handle)?.id);
    if (refs.some(id => id === undefined || id === task.id)) return { state: 'rejected' };
    let change: MissionRevisionChange;
    if (action === 'replace' && refs.length === 0) change = { type: action, taskId: task.id };
    else if (action === 'dependencies') change = { type: action, taskId: task.id, dependencies: refs as string[] };
    else if (action === 'retire' && refs.length === 1) change = { type: action, taskId: task.id, successorId: refs[0]! };
    else return { state: 'rejected' };
    try {
      const preview = owner.preview(mission.revision, change);
      return { state: 'reviewable', checkpoint, change, preview, reason };
    } catch {
      return { state: 'rejected' };
    }
  } catch {
    return { state: 'unavailable' };
  }
}
