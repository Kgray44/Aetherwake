import { isAbsolute, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { appendEvent, traceEvent } from './journal.mjs';
import { startObservatorySync } from './observatory-sync.mjs';
import { sanitizeExport } from './telemetry-export.mjs';
import { validateRecord, validateTraceEvent } from './validate-record.mjs';

const identity = /^[A-Za-z0-9_.:-]{1,160}$/;
const revision = /^[a-f0-9]{40}$/;
const terminalStates = new Set(['completed', 'failed', 'interrupted', 'cancelled']);
const codexTurnSources = new Set(['codex_exec_json_turn_completed', 'not_exposed_by_usage_event']);
const streamSource = 'codex_exec_jsonl';

/** Observe a claimed execution without owning its lifecycle or making an executor call. */
export function createClaimTelemetry({ journal, task, attempt, deliveryDirectory }) {
  if (!isAbsolute(journal) || (deliveryDirectory !== undefined && !isAbsolute(deliveryDirectory)) ||
      task?.record_type !== 'task' || validateRecord(task).length || !identity.test(task.id) || !identity.test(attempt?.id ?? '') ||
      !revision.test(attempt?.revision ?? '')) throw Error('Invalid claim telemetry configuration');

  const executionTask = { ...task, revision:attempt.revision };
  const spanId = 'codex-' + attempt.id;
  let startedAt, delivery, closing;
  function event(kind, measurements, { state, eventId } = {}) {
    const entry = traceEvent({task:executionTask,attemptId:attempt.id,spanId,kind,phase:'implementation',state,eventId,measurements});
    const sanitized = sanitizeExport({repository:task.repository,events:[entry]}).events[0];
    if (validateTraceEvent(sanitized).length) throw Error('Invalid claim telemetry event');
    return sanitized;
  }

  return {
    async start() {
      if (startedAt !== undefined) throw Error('Claim telemetry already exists');
      const requested = {
        name:'provider_stream_requested',availability:'observed',unit:'boolean',value:1,
        source:streamSource,method:'observer_configuration',
      };
      const start = event('span_start',[requested],{state:'started',eventId:spanId + '-start'});
      if (!await appendEvent(journal,start)) throw Error('Claim telemetry already exists');
      startedAt = performance.now();
      // The worker's credential stays with the engine. Only the configured
      // Observatory connection can deliver a projection.
      if (deliveryDirectory) {
        delivery = await startObservatorySync({task,journal,directory:deliveryDirectory}).catch(() => null);
      }
    },
    async onUsage(measurements) {
      if (startedAt === undefined || closing) throw Error('Claim telemetry is not recording');
      if (!Array.isArray(measurements) || measurements.length > 64 ||
          measurements.some(row => !codexTurnSources.has(row?.source))) throw Error('Invalid Codex turn measurements');
      await appendEvent(journal,event('measurement',measurements));
    },
    finish({ measurements = [], state }) {
      if (closing) return closing;
      if (startedAt === undefined || !terminalStates.has(state) || !Array.isArray(measurements) ||
          measurements.length > 64 || measurements.some(row => row?.source !== streamSource)) {
        throw Error('Invalid claim telemetry completion');
      }
      const duration = {
        name:'elapsed_wall_ms',availability:'observed',unit:'ms',value:performance.now() - startedAt,
        source:'local_monotonic_clock',method:'worker_capture_interval',
      };
      closing = (async () => {
        try {
          await appendEvent(journal,event('span_end',[...measurements,duration],{state,eventId:spanId + '-end'}));
        } finally {
          await delivery?.finish().catch(() => {});
        }
      })();
      return closing;
    },
  };
}

/** Per-claim worker hooks. The dedicated checkout is already storage-admitted. */
export function createClaimTelemetryHooks(workspace) {
  if (!isAbsolute(workspace)) throw Error('Claim telemetry requires an absolute workspace');
  const directory = join(workspace, '.git', 'agent-harness');
  let observer;
  return {
    async onTelemetryStart({ task, attempt }) {
      const next = createClaimTelemetry({
        task,attempt,journal:join(directory, 'claimed-execution.journal'),
        deliveryDirectory:join(directory, 'observatory-sync'),
      });
      await next.start();
      observer = next;
    },
    async onUsage({ measurements }) {
      if (!observer) throw Error('Claim telemetry did not start');
      await observer.onUsage(measurements);
    },
    async onTelemetryEnd({ measurements, state }) {
      await observer?.finish({measurements,state});
    },
  };
}
