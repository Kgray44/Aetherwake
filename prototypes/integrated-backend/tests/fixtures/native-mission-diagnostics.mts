import type { MissionProjection } from '../../src/mission-contracts.mts';

// Fixture-only diagnostics. Include the CPU sampling window, never the
// provider response, user context, or complete native evidence payload.
export function nativeMissionDiagnostics(mission: MissionProjection): string {
  return JSON.stringify(mission.tasks.map(task => ({
    task: task.id,
    state: task.state,
    detail: task.detail,
    attempts: task.attempts.map(attempt => {
      const value = attempt.evidence?.value as { sampleMs?: unknown } | undefined;
      return {
        id: attempt.id,
        executor: attempt.executor,
        outcome: attempt.outcome,
        executionMs: attempt.timing?.executionMs,
        source: attempt.evidence?.source,
        sampleMs: attempt.evidence?.source === 'node:os.cpus' && typeof value?.sampleMs === 'number'
          ? value.sampleMs : undefined,
        verification: attempt.verification && {
          passed: attempt.verification.passed,
          detail: attempt.verification.detail,
        },
      };
    }),
  })));
}
