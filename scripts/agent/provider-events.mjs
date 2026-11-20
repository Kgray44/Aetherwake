import { Buffer } from 'node:buffer';

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

function observation(name, value, unit = 'count') {
  return { name: 'provider_' + name, availability: 'observed', value, unit, source: SOURCE, method: 'observed_stdout_frames' };
}

/** Consume a bounded stream without retaining its contents or upstream identifiers. */
export async function observeCodexStream(stream, { onUsage, onSession, forward, maxLineBytes = MAX_LINE_BYTES } = {}) {
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
        return;
      case 'turn.completed': {
        if (!open) gaps++;
        open = false;
        completed++;
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
        return;
      case 'error':
        errors++;
        return;
      case 'item.completed':
        switch (event.item?.type) {
          case 'command_execution':
            commandEvents++;
            if (event.item.status === 'failed') failedCommands++;
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
    observation('file_change_completed_event_count', fileEvents),
    observation('mcp_tool_completed_event_count', mcpEvents)
  ];
}
