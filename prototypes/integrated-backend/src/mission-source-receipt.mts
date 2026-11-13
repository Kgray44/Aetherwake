import { createHash } from 'node:crypto';
import { closeSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import type { MissionExecutionContext } from './mission-contracts.mts';
import type { createMissionCpuPool } from './mission-cpu-pool.mts';

export type BackendInspectionTerminal = Awaited<ReturnType<ReturnType<typeof createMissionCpuPool>['inspect']>>;
export interface BackendInspectionReceipt {
  contract: 'aerynth.backend-inspection-terminal@1';
  missionId: string; taskId: string; attemptId: string; scopeDigest: string; claimsDigest: string;
  contextDigest: string; terminalDigest: string; observedAt: string; effectId: string; reservedRevision: number; evidenceId: string;
  terminal: BackendInspectionTerminal;
  reconciledRevision?: number;
}
export function backendInspectionBinding(context: Pick<MissionExecutionContext, 'missionId' | 'task' | 'attemptId' | 'scope'>): string {
  return createHash('sha256').update(JSON.stringify({ missionId: context.missionId, taskId: context.task.id,
    attemptId: context.attemptId, scope: { workspaceId: context.scope.workspaceId, projectId: context.scope.projectId },
    claims: context.task.claims })).digest('hex');
}
const uuid = (s: unknown) => typeof s === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(s);
/** Independent readback of one fixed application source, never a caller-selected path or command. */
export function backendInspectionCurrent(raw: BackendInspectionTerminal): boolean {
  try {
    const { evidence, exit, threadId } = raw;
    if (!/^[a-f0-9]{64}$/.test(raw.bindingDigest ?? '') || !exit || Object.keys(exit).length !== 4 || exit.quiescence !== 'worker-exit' ||
      !uuid(exit.effectId) || !uuid(exit.workerInstanceId) || exit.threadId !== threadId ||
      !Number.isSafeInteger(threadId) || threadId < 1 || evidence.source !== 'aerynth.shipped-backend-source') return false;
    const path = new URL('./core.mts', import.meta.url);
    const fd = openSync(path, 'r');
    try {
      const before = fstatSync(fd, { bigint: true });
      if (!before.isFile() || before.size < 1n || before.size > 768n * 1024n) return false;
      const buffer = Buffer.alloc(Number(before.size) + 1);
      let count = 0;
      while (count < buffer.length) {
        const read = readSync(fd, buffer, count, buffer.length - count, count);
        if (!read) break;
        count += read;
      }
      const bytes = buffer.subarray(0, count), after = fstatSync(fd, { bigint: true });
      const current = lstatSync(path, { bigint: true });
      if (!current.isFile() || current.isSymbolicLink() || current.dev !== after.dev || current.ino !== after.ino ||
        current.size !== after.size || current.mtimeNs !== after.mtimeNs || current.ctimeNs !== after.ctimeNs) return false;
      if (before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || bytes.length !== Number(before.size)) return false;
      const source = bytes.toString('utf8'), value = evidence.value;
      return value.module === 'core.mts' && value.bytes === bytes.length &&
        value.sha256 === createHash('sha256').update(bytes).digest('hex') &&
        value.sqlitePrepareSites === [...source.matchAll(/\bthis\.db\.prepare\(/gu)].length &&
        value.transactionSites === [...source.matchAll(/\bthis\.kernel\.withTransaction\(/gu)].length &&
        value.note === 'Counts are static inspection clues. They do not measure runtime cost or establish a bottleneck.';
    } finally { closeSync(fd); }
  } catch { return false; }
}
