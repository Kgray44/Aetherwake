import { isAbsolute, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { appendEvent, traceEvent } from './journal.mjs';
import { startObservatorySync } from './observatory-sync.mjs';
import { sanitizeExport } from './telemetry-export.mjs';
import { validateRecord, validateTraceEvent } from './validate-record.mjs';

const identity = /^[A-Za-z0-9_.:-]{1,160}$/;
const revision = /^[a-f0-9]{40}$/;
const terminalStates = new Set(['completed', 'failed', 'interrupted', 'cancelled']);
const codexTurnSources = new Set(['codex_exec_json_turn_completed', 'not_exposed_by_usage_event',
  'codex_app_server_token_usage_updated']);

/** Observe a claimed execution without owning its lifecycle or making an executor call. */
export function createClaimTelemetry({ journal, task, attempt, deliveryDirectory, verificationNamespace,
  providerStream = 'codex_exec_jsonl' },
  { startDelivery = startObservatorySync, managedConnection } = {}) {
  if (!isAbsolute(journal) || (deliveryDirectory !== undefined && !isAbsolute(deliveryDirectory)) ||
      task?.record_type !== 'task' || validateRecord(task).length || !identity.test(task.id) || !identity.test(attempt?.id ?? '') ||
      !revision.test(attempt?.revision ?? '') || !['codex_exec_jsonl','codex_app_server'].includes(providerStream)) {
    throw Error('Invalid claim telemetry configuration');
  }

  const executionTask = { ...task, revision:attempt.revision };
  const spanId = 'codex-' + attempt.id;
  let startedAt, delivery, closing, opening;
  function event(kind, measurements, { state, eventId, phase='implementation', span=spanId, occurredAt, sessionId, note } = {}) {
    const entry = traceEvent({task:executionTask,attemptId:attempt.id,spanId:span,kind,phase,state,eventId,measurements,occurredAt,sessionId});
    if (note) entry.development_note = note;
    const sanitized = sanitizeExport({repository:task.repository,events:[entry]}).events[0];
    if (validateTraceEvent(sanitized).length) throw Error('Invalid claim telemetry event');
    return sanitized;
  }

  function beginDelivery() {
    opening ??= deliveryDirectory ? startDelivery({task,journal,directory:deliveryDirectory,verificationNamespace,
      ...(managedConnection ? { managedConnection } : {})}).then(value=>{delivery=value;}).catch(() => {}) : Promise.resolve();
    return opening;
  }
  function recordStageStart({name,phase,startAt}) {
    const span = spanId + '-' + name;
    return appendEvent(journal,event('span_start',[],{phase,span,occurredAt:startAt,state:'started',eventId:span + '-start'}));
  }

  return {
    async recordStageStart(stage) {
      await recordStageStart(stage);
      await beginDelivery();
    },
    async start() {
      if (startedAt !== undefined) throw Error('Claim telemetry already exists');
      const requested = {
        name:'provider_stream_requested',availability:'observed',unit:'boolean',value:1,
        source:providerStream,method:'observer_configuration',
      };
      const start = event('span_start',[requested],{state:'started',eventId:spanId + '-start'});
      if (!await appendEvent(journal,start)) throw Error('Claim telemetry already exists');
      startedAt = performance.now();
      // The worker's credential stays with the engine. Only the configured
      // Observatory connection can deliver a projection.
      await beginDelivery();
    },
    async onUsage(measurements) {
      if (startedAt === undefined || closing) throw Error('Claim telemetry is not recording');
      if (!Array.isArray(measurements) || measurements.length > 64 ||
          measurements.some(row => !codexTurnSources.has(row?.source))) throw Error('Invalid Codex turn measurements');
      await appendEvent(journal,event('measurement',measurements));
    },
    async onDevelopmentNote({itemId,sessionId,note,occurredAt}) {
      if (startedAt===undefined||closing) return;
      const eventId='note_'+createHash('sha256').update(JSON.stringify([attempt.id,sessionId,itemId])).digest('hex');
      await appendEvent(journal,event('development_note',[],{eventId,sessionId,note,occurredAt}));
    },
    async recordStage({ name, phase, startAt, endAt, durationMs, state }) {
      if (closing) throw Error('Claim telemetry is not recording');
      const span = spanId + '-' + name;
      await recordStageStart({name,phase,startAt});
      await appendEvent(journal,event('span_end',[{
        name:'elapsed_wall_ms',availability:'observed',unit:'ms',value:durationMs,
        source:'local_monotonic_clock',method:name,
      }],{phase,span,occurredAt:endAt,state,eventId:span + '-end'}));
    },
    finish({ measurements = [], state, executionEnd }) {
      if (closing) return closing;
      if (!terminalStates.has(state) || !Array.isArray(measurements) ||
          measurements.length > 64 || measurements.some(row => row?.source !== providerStream)) {
        throw Error('Invalid claim telemetry completion');
      }
      closing = (async () => {
        try {
          if (startedAt !== undefined) {
            const duration = {
              name:'elapsed_wall_ms',availability:'observed',unit:'ms',value:(executionEnd?.monotonic ?? performance.now()) - startedAt,
              source:'local_monotonic_clock',method:'worker_capture_interval',
            };
            await appendEvent(journal,event('span_end',[...measurements,duration],{state,occurredAt:executionEnd?.at,eventId:spanId + '-end'}));
          }
        } finally {
          await delivery?.finish().catch(() => {});
        }
      })();
      return closing;
    },
  };
}

/** Per-claim worker hooks. The dedicated checkout is already storage-admitted. */
export function createClaimTelemetryHooks(workspace, delivery = {}, telemetryDirectory) {
  if (!isAbsolute(workspace)) throw Error('Claim telemetry requires an absolute workspace');
  const directory = telemetryDirectory ?? join(workspace, '.git', 'agent-harness');
  let observer;
  function observe({task,attempt,verificationNamespace,providerStream}) {
    observer ??= createClaimTelemetry({
        task,attempt,journal:join(directory, 'claimed-execution.journal'),
        deliveryDirectory:join(directory, 'observatory-sync'), verificationNamespace,providerStream,
      }, delivery);
    return observer;
  }
  return {
    onTelemetryStageStart(input) {
      return observe(input).recordStageStart(input);
    },
    onTelemetryStart(input) {
      return observe(input).start();
    },
    async onUsage({ measurements }) {
      if (!observer) throw Error('Claim telemetry did not start');
      await observer.onUsage(measurements);
    },
    onDevelopmentNote(input) {
      return observer?.onDevelopmentNote(input);
    },
    async onTelemetryStage(stage) {
      await observer?.recordStage(stage);
    },
    async onTelemetryEnd({ measurements, state, executionEnd }) {
      await observer?.finish({measurements,state,executionEnd});
    },
  };
}
