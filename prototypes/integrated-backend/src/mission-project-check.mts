import type { ProviderPort } from './contracts.mts';
import type { MissionExecutor } from './mission-contracts.mts';
import { admitVelaFileEditAsync, type FileEditAdmission } from './vela-file-edit.mts';
import { planMissionProjectCheck } from './mission-project-check-planner.mts';
import { interpretVelaProjectCheck } from './vela-project-check.mts';

interface ProjectCheckHost {
  runner: ProviderPort['projectChecks'];
  privateRoot?: string;
  fileEditAdmission?: FileEditAdmission;
  digest(value: unknown): string;
  lease(): (() => void) | null;
}

/** Fixed command, current tracked inputs, native App Server read-only sandbox. */
export function createMissionProjectCheck(host: ProjectCheckHost): MissionExecutor {
  return {
    lane: 'codex-local-check',
    replaySafe: true,
    available: () => !!host.runner,
    async run({ task, signal, resourceCheckpoint, validatePlanningContext }) {
      const source = 'codex-app-server:read-only-command';
      const start = performance.now();
      const telemetry = () => ({ providerCalls: 0, durationMs: performance.now() - start });
      const blocked = (status: string) => ({ source, outcome: 'blocked' as const, value: { status }, telemetry: telemetry() });
      const runner = host.runner, target = task.projectCheck;
      const selected = target?.paths?.[0];
      if (!runner || !target || typeof selected !== 'string' || !selected) return blocked('reviewed_check_unavailable');
      const release = host.lease();
      if (!release) return blocked('codex_check_busy');
      const stop = resourceCheckpoint ? AbortSignal.any([signal, resourceCheckpoint]) : signal;
      const checkpointed = () => resourceCheckpoint?.aborted && !signal.aborted;
      let dispatched = false;
      try {
        stop.throwIfAborted();
        if (!await runner.ready()) return blocked('codex_read_only_sandbox_unavailable');
        stop.throwIfAborted();
        if (!host.fileEditAdmission) await admitVelaFileEditAsync(selected, host.privateRoot, stop);
        stop.throwIfAborted();
        const plan = await planMissionProjectCheck(target.paths, host.privateRoot);
        if (host.digest(plan) !== target.digest) return blocked('reviewed_check_changed');
        host.fileEditAdmission?.(plan.cwd, host.privateRoot);
        validatePlanningContext?.();
        stop.throwIfAborted();
        dispatched = true;
        // App Server's Windows sandbox has no per-command terminate operation. Keep the lease
        // until the original bounded call settles and preserve any verified terminal evidence.
        const result = interpretVelaProjectCheck('node-test', await runner.execute(plan.argv, plan.cwd));
        signal.throwIfAborted();
        const observed = await planMissionProjectCheck(target.paths, host.privateRoot);
        if (host.digest(observed) !== target.digest) return blocked('reviewed_check_changed');
        return { source, value: { state: result.state, exitCode: result.exitCode ?? null,
          testCount: result.testCount ?? null, head: plan.head, inputDigest: target.digest }, telemetry: telemetry(),
          ...(result.state === 'unknown' ? { outcome: 'uncertain' as const } : result.state !== 'passed' ? { outcome: 'failed' as const } : {}) };
      } catch { return dispatched ? { source, outcome: 'uncertain', value: { status: 'codex_check_outcome_unconfirmed' }, telemetry: telemetry() } :
        blocked(checkpointed() ? 'resource_checkpoint' : 'codex_check_unavailable_or_scope_changed'); }
      finally { release(); }
    },
    verify(evidence, { task }) {
      const v = evidence.value as { state?: string; exitCode?: number; testCount?: number; inputDigest?: string; head?: string };
      const passed = evidence.source === 'codex-app-server:read-only-command' && v.state === 'passed' &&
        v.exitCode === 0 && Number.isSafeInteger(v.testCount) && v.testCount! > 0 &&
        v.inputDigest === task.projectCheck?.digest && /^[a-f0-9]{40,64}$/u.test(v.head ?? '');
      return { passed, detail: passed ? 'Observed passing tests in the read-only Codex sandbox' :
        'The reviewed Node test command did not produce passing evidence' };
    },
  };
}
