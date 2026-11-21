const active = new Set(['queued', 'claimed', 'running', 'awaiting_review']);
const safeSegment = /^[A-Za-z0-9_-][A-Za-z0-9_. -]{0,100}$/;
const reserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
export const sourceBudget = Object.freeze({ minutes: 8, tokens: 120_000 });

export function repairablePath(path) {
  if (typeof path !== 'string' || path.length > 240 || !path.includes('/') ||
      /^(?:governance|\.agents|\.github|\.codex|scripts\/agent)\//i.test(path) ||
      /^agent-system\/observatory\/sites\/(?:worker|mcp|task-engine|integration-runs|github-integration|source-repair|ci-controls)[.-]/i.test(path)) return false;
  return path.split('/').every(part => safeSegment.test(part) && !reserved.test(part) &&
    !/[. ]$/.test(part) && !/^(?:AGENTS\.md|SECURITY\.md)$/i.test(part));
}

export const activeRepair = run => [...(run.source_repairs ?? [])].reverse().find(repair => active.has(repair.status));

export function usageFromCodex(total, complete) {
  if (![total?.totalTokens, total?.inputTokens, total?.cachedInputTokens, total?.outputTokens]
    .every(value => Number.isSafeInteger(value) && value >= 0) ||
    total.cachedInputTokens > total.inputTokens || total.totalTokens !== total.inputTokens + total.outputTokens) return null;
  return { input_tokens: total.inputTokens, cached_input_tokens: total.cachedInputTokens,
    output_tokens: total.outputTokens, total_tokens: total.totalTokens, complete: Boolean(complete),
    ...(Number.isSafeInteger(total.cacheWriteInputTokens) && total.cacheWriteInputTokens >= 0
      ? { cache_write_input_tokens:total.cacheWriteInputTokens } : {}),
    source: 'codex_app_server_fresh_thread' };
}

export function validRepairUsage(value) {
  if (!value || value.source !== 'codex_app_server_fresh_thread' || typeof value.complete !== 'boolean') return null;
  return usageFromCodex({ totalTokens: value.total_tokens, inputTokens: value.input_tokens,
    cachedInputTokens: value.cached_input_tokens, outputTokens: value.output_tokens,
    cacheWriteInputTokens:value.cache_write_input_tokens }, value.complete);
}

export function safeDiagnostic(value, limit = 150) {
  if (typeof value !== 'string') return null;
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\b(?:gh[pousr]_|github_pat_|sk-)[A-Za-z0-9_-]+/gi, '[redacted]')
    .replace(/https?:\/\/\S+/gi, '[link]').slice(0, limit);
}

export function repairDiffPaths(raw, allowed) {
  if (typeof raw !== 'string' || !raw.endsWith('\0')) return null;
  const fields = raw.slice(0, -1).split('\0');
  if (fields.length % 2 || !fields.length || fields.length > 24) return null;
  const paths = [];
  for (let index=0; index<fields.length; index+=2) {
    const mode = /^:(100644|100755) \1 [0-9a-f]+ [0-9a-f]+ M$/.exec(fields[index]);
    const path = fields[index+1];
    if (!mode || !repairablePath(path) || !allowed.includes(path) || paths.includes(path)) return null;
    paths.push(path);
  }
  return paths.sort();
}
