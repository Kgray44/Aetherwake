import { DatabaseSync } from 'node:sqlite';
import { createMissionCpuPool } from '../../src/mission-cpu-pool.mts';
import { createPooledBackendSourceExecutor } from '../../src/mission-native.mts';
import { MissionService, type MissionServiceHost } from '../../src/mission-service.mts';
import type { MissionPlan } from '../../src/mission-contracts.mts';

// Fixed test subprocess: no caller-selected command, source, provider, credential or external effect.
const [mode, path, missionId] = process.argv.slice(2);
if (!['capture', 'recover'].includes(mode) || !path || !process.send) throw Error('invalid_source_process_fixture');
const send = (message: object) => new Promise<void>((resolve, reject) => process.send!(message, undefined, undefined, (error: Error | null) => error ? reject(error) : resolve()));
const db = new DatabaseSync(path), pool = createMissionCpuPool(1), source = createPooledBackendSourceExecutor(pool);
const scope = { workspaceId: 'synthetic-subprocess-workspace', projectId: null };
let entries = 0, service: MissionService;
const host: MissionServiceHost = { db, laneLimit: () => 1,
  authorized: value => value.workspaceId === scope.workspaceId && value.projectId === scope.projectId,
  atomic<T>(work: () => T): T { db.exec('BEGIN'); try { const value = work(); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; } },
  executors: { 'inspect.backend-source': { ...source, async run(context) {
    entries++;
    const result = await source.run({ ...context, recordBackendInspection: terminal => {
      context.recordBackendInspection!(terminal);
      const current = service.read(context.missionId, scope);
      void send({ phase: 'captured', missionId: current.id, attemptId: context.attemptId,
        state: current.tasks[0].state, effectId: current.tasks[0].attempts[0].backendInspection!.effectId, entries });
    } });
    if (mode === 'capture') await new Promise<void>(() => {}); // Deliberate lost-delivery boundary after actual worker exit.
    return result;
  } } },
};
service = new MissionService(host);
if (mode === 'capture') {
  const plan: MissionPlan = { scope, objective: 'Synthetic host-loss boundary around real source inspection', criteria: ['source'], tasks: [{
    id: 'source', executor: 'inspect.backend-source', objective: 'Read fixed shipped source', criterion: 'source', dependencies: [],
    claims: [{ resource: 'aerynth.backend-source', mode: 'exclusive' }], maxAttempts: 1, timeoutMs: 120000,
  }] };
  const created = service.create('source-process-original', plan);
  process.on('message', async message => {
    if (message !== 'cancel') return;
    try {
      const current = service.read(created.id, scope);
      const cancelled = service.control(created.id, scope, current.revision, { type: 'cancel' });
      await send({ phase: 'cancelled', missionId: created.id, disposition: cancelled.disposition, state: cancelled.tasks[0].state });
    } catch (error) { await send({ phase: 'error', reason: String(error) }); }
  });
} else {
  try {
    const before = service.read(missionId, scope), attempt = before.tasks[0].attempts[0];
    let denial: string | null = null;
    try { service.control(missionId, scope, before.revision, { type: 'retry', taskId: 'source' }); }
    catch (error) { denial = (error as Error).message; }
    const after = service.read(missionId, scope), retained = after.tasks[0].attempts[0];
    await send({ phase: 'recovered', missionId, before: before.tasks[0].state, state: after.tasks[0].state,
      disposition: after.disposition, attemptId: retained.id, effectId: retained.backendInspection?.effectId,
      evidenceId: retained.evidence?.id, originalEvidenceId: attempt.backendInspection?.evidenceId,
      attempts: after.tasks[0].attempts.length, entries, denial });
  } finally { await service.close(); await pool.close(); db.close(); process.disconnect?.(); }
}
