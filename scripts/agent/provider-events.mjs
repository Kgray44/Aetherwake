/** Pure adapter for explicitly supplied supported Codex exec --json events.
 * Does not launch Codex, read sessions, retain content, or infer costs/quota.
 * Source: https://github.com/openai/codex/blob/main/sdk/typescript/src/events.ts
 */
export function codexUsage(event) {
 if(event?.type!=='turn.completed') return [];
 return ['input_tokens','cached_input_tokens','cache_write_input_tokens','output_tokens','reasoning_output_tokens'].map(name=>{
  const value=event.usage?.[name];
  return {name:'provider_'+name,availability:Number.isSafeInteger(value)&&value>=0?'observed':'unavailable',...(Number.isSafeInteger(value)&&value>=0?{value}:{}),unit:'tokens',source:'codex_exec_json_turn_completed',method:'explicit_event_allowlist'};
 }).concat(['quota_consumption','cost_usd','hidden_reasoning_duration'].map(name=>({name:'provider_'+name,availability:'unavailable',source:'not_exposed_by_usage_event'})));
}
