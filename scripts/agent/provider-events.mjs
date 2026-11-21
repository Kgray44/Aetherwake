import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { parseDevelopmentNote } from '../../agent-system/observatory/development-notes.mjs';

// Codex exec JSONL only. The invocation owner explicitly selects this adapter.
// https://github.com/openai/codex/blob/rust-v0.153.3/sdk/typescript/src/events.ts
const SOURCE = 'codex_exec_jsonl';
const MAX_LINE_BYTES = 256 * 1024;
const MAX_USAGE_RECORDS = 32;
const subsets = { cached_input_tokens: 'input_tokens', reasoning_output_tokens: 'output_tokens' };
const threadId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const tokenFields = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens'];

export function codexUsage(event) {
  if (event?.type !== 'turn.completed') return [];
  const tokens = tokenFields.map(name => {
    const value = event.usage?.[name];
    const parent = event.usage?.[subsets[name]];
    const observed = Number.isSafeInteger(value) && value >= 0 &&
      !(Number.isSafeInteger(parent) && parent >= 0 && value > parent);
    return {
      name: 'provider_' + name,
      availability: observed ? 'observed' : 'unavailable',
      ...(observed ? { value } : {}),
      unit: 'tokens',
      source: 'codex_exec_json_turn_completed',
      method: 'explicit_event_allowlist'
    };
  });
  return tokens.concat(['quota_consumption', 'cost_usd', 'hidden_reasoning_duration'].map(name => ({
    name: 'provider_' + name,
    availability: 'unavailable',
    source: 'not_exposed_by_usage_event'
  })));
}

const appServerUsageFields = ['totalTokens', 'inputTokens', 'cachedInputTokens', 'outputTokens'];
const tokenCount = value => Number.isSafeInteger(value) && value >= 0;

// A fresh thread has an implicit zero baseline. A resumed thread has no
// baseline until its first in-turn notification. A notification can cover
// multiple responses, so only accept a response-sized interval when its
// cumulative difference agrees with the accompanying `last` breakdown.
export function appServerTurnProfile(resumed, promptBytes) {
  const previousZero = Object.fromEntries(appServerUsageFields.map(key => [key, 0]));
  let previous = resumed ? null : previousZero;
  let first, latest, peakInput, peakWindow, responseCount = 0, intervals = 0, notices = 0;
  let commands = 0, repeated = 0, failures = 0, mcp = 0, outputBytes = 0, outputs = 0;
  let commandsAtLastNotice = 0;
  let toolLimit = false;
  const tools = new Set(), commandFingerprints = new Set();
  const responseSamples = [];
  const validUsage = usage => appServerUsageFields.every(key => tokenCount(usage?.[key])) &&
    usage.cachedInputTokens <= usage.inputTokens && usage.totalTokens === usage.inputTokens + usage.outputTokens;
  return {
    observeUsage(usage) {
      const {total, last, modelContextWindow} = usage ?? {};
      if (!validUsage(total)) return;
      if (previous && appServerUsageFields.some(key => total[key] < previous[key])) return;
      if (previous && total.totalTokens === previous.totalTokens) return;
      notices++;
      if (tokenCount(modelContextWindow) && modelContextWindow > 0) peakWindow = Math.max(peakWindow ?? 0, modelContextWindow);
      if (previous) {
        intervals++;
        if (validUsage(last) && appServerUsageFields.every(key => total[key] - previous[key] === last[key])) {
          responseCount++;
          const sample = {input:last.inputTokens, cached_input:last.cachedInputTokens, output:last.outputTokens};
          first ??= sample;
          latest = sample;
          peakInput = Math.max(peakInput ?? 0, sample.input);
          // Keep the opening four and most recent four reconciled intervals.
          // Aggregates above still include all reconciled observations.
          if (responseSamples.length===8) responseSamples.splice(4,1);
          responseSamples.push({interval:intervals, sample, commands:commands-commandsAtLastNotice});
        }
      }
      commandsAtLastNotice=commands;
      previous = Object.fromEntries(appServerUsageFields.map(key => [key, total[key]]));
    },
    observeTool(item) {
      if (!['commandExecution', 'mcpToolCall'].includes(item?.type) || typeof item.id !== 'string' ||
          !item.id || item.id.length>160 || tools.has(item.id)) return;
      if (tools.size >= 1024) { toolLimit = true; return; }
      tools.add(item.id);
      if (item.type === 'mcpToolCall') { mcp++; return; }
      commands++;
      if (item.status === 'failed') failures++;
      if (typeof item.aggregatedOutput === 'string') {
        outputs++;
        outputBytes += Buffer.byteLength(item.aggregatedOutput);
      }
      if (typeof item.command === 'string') {
        const hash = createHash('sha256').update(JSON.stringify([item.cwd, item.command])).digest('hex');
        if (commandFingerprints.has(hash)) repeated++;
        commandFingerprints.add(hash);
      }
    },
    measurements(completed, limitedStart = false) {
      const metric = (name, unit, value) => ({name:'app_server_'+name, unit,
        source:'codex_app_server_turn_profile', method:'observed_turn_notifications',
        availability:'observed', value});
      const counts = {
        usage_notification_count:notices, observed_interval_count:intervals,
        reconciled_response_count:responseCount, command_count:commands,
        repeated_command_count:repeated, failed_command_count:failures,
        command_output_sample_count:outputs, mcp_tool_count:mcp,
      };
      const samples = (position, sample) => Object.entries(sample ?? {}).map(([key, value]) =>
        metric(position+'_response_'+key+'_tokens','tokens',value));
      return [
        metric('submitted_task_prompt_bytes','bytes',promptBytes),
        ...Object.entries(counts).map(([key,value])=>metric(key,'count',value)),
        metric('command_event_output_bytes','bytes',outputBytes),
        metric('turn_completed','boolean',Number(completed)),
        metric('tool_observation_limit_reached','boolean',Number(toolLimit || limitedStart)),
        ...samples('first',first), ...samples('latest',latest),
        ...responseSamples.flatMap(row=>[
          ...samples('interval_'+row.interval,row.sample),
          metric('interval_'+row.interval+'_command_count','count',row.commands),
        ]),
        ...(peakInput === undefined ? [] : [metric('peak_response_input_tokens','tokens',peakInput)]),
        ...(peakWindow === undefined ? [] : [metric('max_reported_context_window_tokens','tokens',peakWindow)]),
      ];
    },
  };
}

function observation(name, value, unit = 'count') {
  return { name: 'provider_' + name, availability: 'observed', value, unit, source: SOURCE, method: 'observed_stdout_frames' };
}

/** Consume a bounded stream without retaining its contents or upstream identifiers. */
export async function observeCodexStream(stream, { onUsage, onSession, onDevelopmentNote, onTurnStarted, onTurnFinished,
  forward, maxLineBytes = MAX_LINE_BYTES } = {}) {
  if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes < 1 || maxLineBytes > MAX_LINE_BYTES) {
    throw Error('Invalid Codex JSONL line limit');
  }
  const line = Buffer.allocUnsafe(maxLineBytes);
  let length = 0;
  let discard = false;
  let open = false;
  let fullyObservedUsage = true;
  let coreUsage = true;
  let dropped = 0;
  let gaps = 0;
  let completed = 0;
  let failed = 0;
  let errors = 0;
  let commandEvents = 0;
  let failedCommands = 0;
  let repeatedCommands = 0;
  let observedCommandOutputBytes = 0;
  const commandFingerprints = new Set();
  let fileEvents = 0;
  let mcpEvents = 0;
  let recorded = 0;
  let writeFailures = 0;
  let forwardingFailed = false;
  let sessionReported = false;

  async function consumeLine() {
    const text = discard ? '' : line.toString('utf8', 0, length).trim();
    length = 0;
    if (discard) {
      discard = false;
      dropped++;
      return;
    }
    if (!text) return;

    let event;
    try { event = JSON.parse(text); } catch { /* The raw line must remain private. */ }
    if (typeof event?.type !== 'string') {
      dropped++;
      return;
    }
    switch (event.type) {
      case 'thread.started':
        if (!sessionReported && typeof event.thread_id === 'string' && threadId.test(event.thread_id)) {
          sessionReported = true;
          try { await onSession?.(event.thread_id); }
          catch { gaps++; }
        }
        return;
      case 'turn.started':
        if (open) gaps++;
        open = true;
        await onTurnStarted?.();
        return;
      case 'turn.completed': {
        if (!open) gaps++;
        open = false;
        completed++;
        await onTurnFinished?.('completed');
        const usage = codexUsage(event);
        coreUsage &&= ['provider_input_tokens', 'provider_output_tokens'].every(name =>
          usage.some(metric => metric.name === name && metric.availability === 'observed'));
        fullyObservedUsage &&= usage.slice(0, tokenFields.length).every(metric => metric.availability === 'observed');
        if (!onUsage || completed > MAX_USAGE_RECORDS) {
          fullyObservedUsage = false;
          return;
        }
        try {
          await onUsage(usage);
          recorded++;
        }
        catch {
          writeFailures++;
          fullyObservedUsage = false;
        }
        return;
      }
      case 'turn.failed':
        if (!open) gaps++;
        open = false;
        failed++;
        await onTurnFinished?.('failed');
        return;
      case 'error':
        errors++;
        return;
      case 'item.completed':
        switch (event.item?.type) {
          case 'agent_message': {
            const note = parseDevelopmentNote(event.item.text);
            if (note && typeof event.item.id==='string') await onDevelopmentNote?.(event.item.id,note);
            break;
          }
          case 'command_execution':
            commandEvents++;
            if (event.item.status === 'failed') failedCommands++;
            if (typeof event.item.aggregated_output === 'string') {
              observedCommandOutputBytes += Buffer.byteLength(event.item.aggregated_output);
            }
            if (typeof event.item.command === 'string' && commandFingerprints.size < 1024) {
              const fingerprint = createHash('sha256').update(event.item.command).digest('hex');
              if (commandFingerprints.has(fingerprint)) repeatedCommands++;
              commandFingerprints.add(fingerprint);
            }
            break;
          case 'file_change':
            fileEvents++;
            break;
          case 'mcp_tool_call':
            mcpEvents++;
        }
    }
  }

  try {
    for await (const value of stream) {
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
      let offset = 0;
      do {
        const newline = bytes.indexOf(10, offset);
        const end = newline === -1 ? bytes.length : newline;
        if (!discard) {
          if (length + end - offset > line.length) discard = true;
          else {
            bytes.copy(line, length, offset, end);
            length += end - offset;
          }
        }
        if (newline === -1) break;
        await consumeLine();
        offset = newline + 1;
      } while (offset < bytes.length);
      if (forward && !forwardingFailed) {
        try { await forward(bytes); }
        catch { forwardingFailed = true; }
      }
    }
    if (length || discard) await consumeLine();
  } catch {
    // A disconnected stream can end even while the child exit is still unobserved.
    gaps++;
  }

  const complete = !open && !dropped && !gaps && completed + failed > 0;
  return [
    observation('stream_complete', Number(complete), 'boolean'),
    observation('stream_dropped_line_count', dropped),
    observation('stream_gap_count', gaps + Number(open)),
    observation('stdout_forwarding_failed', Number(forwardingFailed), 'boolean'),
    observation('core_usage_complete', Number(complete && !failed && coreUsage && recorded === completed), 'boolean'),
    observation('usage_complete', Number(complete && !failed && fullyObservedUsage), 'boolean'),
    observation('usage_recorded_turn_count', recorded),
    observation('usage_write_failure_count', writeFailures),
    observation('turn_completed_event_count', completed),
    observation('turn_failed_event_count', failed),
    observation('error_event_count', errors),
    observation('command_completed_event_count', commandEvents),
    observation('command_failed_event_count', failedCommands),
    observation('repeated_observed_command_count', repeatedCommands),
    observation('observed_command_output_bytes', observedCommandOutputBytes, 'bytes'),
    observation('file_change_completed_event_count', fileEvents),
    observation('mcp_tool_completed_event_count', mcpEvents)
  ];
}
