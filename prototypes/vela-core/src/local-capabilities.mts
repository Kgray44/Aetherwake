import { check, identifier, isRecord, text } from './capabilities.ts';
import type { VelaLocalCapabilityId, VelaLocalFacts, VelaLocalHost, VelaLocalRecord } from './contracts.ts';

/** Explicit finite grammar, not general language understanding. Unknown/compound requests never acquire an invented local interpretation. */
export const VELA_LOCAL_CAPABILITIES = [
  { id: 'local.time', phrases: ['what time is it', 'what time is it now', 'what time is it right now', 'what is the time', "what's the time", 'what is the current time', "what's the current time", 'what is the local time', "what's the local time", 'what is the current local time', "what's the current local time", 'can you tell me the time', 'tell me the time', 'current time', 'local time', 'time'] },
  { id: 'local.date', phrases: ["what is today's date", "what's today's date", 'what is the date', "what's the date", 'what date is it', 'what is the date today', "what's the date today", 'what day is it', 'what day is it today', "today's date", 'current date', 'date'] },
  { id: 'local.workspace-status', phrases: ['is this workspace saved', 'is my workspace saved', 'is the current workspace saved', 'what workspace is active', 'which workspace is active', 'what workspace am i in', 'which workspace am i in', 'what is the active workspace', "what's the active workspace", 'what is my current workspace', "what's my current workspace", 'workspace status'] },
  { id: 'local.project-count', phrases: ['how many projects do i have', 'how many projects are there', 'how many active projects do i have', 'project count'] },
  { id: 'local.execution-status', phrases: ['are any agents running', 'are any tasks running', 'are any executions running', 'are any codex tasks running', 'how many agents are running', 'execution status'] },
] as const satisfies readonly { id: VelaLocalCapabilityId; phrases: readonly string[] }[];
/** Local routing metadata is intentionally separate from provider-native-action schemas and their prompt budget. */
export const VELA_LOCAL_REQUEST_SCHEMA = { type: 'object', additionalProperties: false, properties: { intent: { type: 'string', minLength: 1, maxLength: 16000 }, commandId: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['intent', 'commandId'] } as const;
export function classifyVelaLocalIntent(intent: string): VelaLocalCapabilityId | null {
  if (typeof intent !== 'string' || intent.length > 16000) return null;
  const normalized = intent.normalize('NFKC').trim().toLowerCase().replaceAll('’', "'").replace(/\s+/gu, ' ').replace(/^vela[,:]?\s+/u, '').replace(/[?!.]+$/u, '').trim();
  for (const capability of VELA_LOCAL_CAPABILITIES) if ((capability.phrases as readonly string[]).includes(normalized)) return capability.id;
  return null;
}
/** Node/native host system facts. No provider, credentials, files or network are consulted. */
export function readSystemClock(): ReturnType<VelaLocalHost['clock']> {
  const { timeZone, locale } = new Intl.DateTimeFormat().resolvedOptions();
  return { epochMs: Date.now(), timeZone, locale };
}
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const workspace = (value: unknown): boolean => value === null || (isRecord(value) && value.kind === 'workspace' && identifier(value.id) && text(value.title) && Number.isSafeInteger(value.version) && Number(value.version) >= 1 && (value.state === undefined || value.state === 'active') && (value.projectId === undefined || value.projectId === null || identifier(value.projectId)));
export function validateLocalRecord(value: unknown): asserts value is VelaLocalRecord {
  check(isRecord(value) && value.schemaVersion === 1, 'unsupported_vela_local_schema');
  check(identifier(value.commandId) && VELA_LOCAL_CAPABILITIES.some(cap => cap.id === value.capabilityId) && value.classification === 'observed' && value.providerId === null && typeof value.observedAt === 'string' && Number.isFinite(Date.parse(value.observedAt)), 'corrupt_vela_local_record');
  const f = value.facts; check(isRecord(f), 'corrupt_vela_local_facts');
  if (f.kind === 'unavailable') { check(typeof f.code === 'string' && /^local_[a-z_]+_unavailable$/u.test(f.code), 'corrupt_vela_local_facts'); return; }
  check(value.capabilityId === 'local.' + f.kind, 'corrupt_vela_local_facts');
  if (f.kind === 'time' || f.kind === 'date') check(Number.isSafeInteger(f.epochMs) && Number.isFinite(Date.parse(String(f.utc))) && new Date(Number(f.epochMs)).toISOString() === f.utc && text(f.timeZone, 100) && text(f.locale, 100) && Number.isInteger(f.utcOffsetMinutes) && Math.abs(Number(f.utcOffsetMinutes)) <= 24 * 60 && typeof f.calendarDate === 'string' && /^\d{4,6}-\d{2}-\d{2}$/u.test(f.calendarDate) && text(f.formatted, 300), 'corrupt_vela_local_facts');
  else if (f.kind === 'workspace-status') check(workspace(f.workspace) && ['persisted', 'pending', 'unknown'].includes(String(f.persistence)) && f.coverage === 'canonical-workspace-layout', 'corrupt_vela_local_facts');
  else if (f.kind === 'project-count') check(count(f.count) && f.coverage === 'authorized-active-projects', 'corrupt_vela_local_facts');
  else if (f.kind === 'execution-status') check(count(f.running) && count(f.unknown) && f.coverage === 'aerynth-owned-executions', 'corrupt_vela_local_facts');
  else check(false, 'corrupt_vela_local_facts');
}
export function evaluateLocalCapability(id: VelaLocalCapabilityId, host: VelaLocalHost): { facts: VelaLocalFacts; content: string; kind: 'answer' | 'inability' } {
  check(VELA_LOCAL_CAPABILITIES.some(capability => capability.id === id), 'unsupported_local_capability');
  try {
    if (id === 'local.time' || id === 'local.date') {
      const reading = host.clock(); check(Number.isSafeInteger(reading.epochMs) && text(reading.timeZone, 100) && text(reading.locale, 100), 'invalid_local_clock');
      const instant = new Date(reading.epochMs), utc = instant.toISOString();
      const formatter = new Intl.DateTimeFormat(reading.locale, { timeZone: reading.timeZone, calendar: 'gregory', ...(id === 'local.time' ? { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' } as const : { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' } as const) });
      const timeZone = formatter.resolvedOptions().timeZone, locale = formatter.resolvedOptions().locale, formatted = formatter.format(instant);
      const offset = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(instant).find(part => part.type === 'timeZoneName')!.value;
      const match = offset.match(/^GMT([+-])(\d{2}):(\d{2})$/u); check(offset === 'GMT' || !!match, 'invalid_local_offset');
      const utcOffsetMinutes = match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
      const parts = new Intl.DateTimeFormat('en-US', { timeZone, calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant), part = (type: string) => parts.find(value => value.type === type)!.value;
      return { facts: { kind: id === 'local.time' ? 'time' : 'date', epochMs: reading.epochMs, utc, timeZone, locale, utcOffsetMinutes, calendarDate: `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`, formatted }, content: id === 'local.time' ? `It’s ${formatted}.` : `Today is ${formatted}.`, kind: 'answer' };
    }
    if (id === 'local.workspace-status') {
      const value = host.workspaceStatus?.(); check(value && workspace(value.workspace) && ['persisted', 'pending', 'unknown'].includes(value.persistence) && (value.workspace !== null || value.persistence === 'unknown'), 'invalid_local_workspace');
      const w = value.workspace, ref = w ? { id: w.id, kind: 'workspace' as const, title: w.title, version: w.version, ...(w.projectId === undefined ? {} : { projectId: w.projectId }) } : null;
      const facts: VelaLocalFacts = { kind: 'workspace-status', workspace: ref, persistence: value.persistence, coverage: 'canonical-workspace-layout' };
      return { facts, content: value.workspace === null ? 'No workspace is active.' : value.persistence === 'persisted' ? `“${value.workspace.title}” layout is saved.` : value.persistence === 'pending' ? `“${value.workspace.title}” has layout changes waiting to be saved.` : `The saved layout status of “${value.workspace.title}” is unavailable.`, kind: value.workspace !== null && value.persistence === 'unknown' ? 'inability' : 'answer' };
    }
    if (id === 'local.project-count') {
      const value = host.projectCount?.(); check(value && count(value.count) && value.coverage === 'authorized-active-projects', 'invalid_local_project_count');
      return { facts: { kind: 'project-count', count: value.count, coverage: 'authorized-active-projects' }, content: `${value.count} active ${value.count === 1 ? 'project' : 'projects'}.`, kind: 'answer' };
    }
    const value = host.executionStatus?.(); check(value && count(value.running) && count(value.unknown) && value.coverage === 'aerynth-owned-executions', 'invalid_local_execution_status');
    return { facts: { kind: 'execution-status', running: value.running, unknown: value.unknown, coverage: 'aerynth-owned-executions' }, content: `${value.running === 0 ? 'No' : value.running} Aerynth ${value.running === 1 ? 'execution is' : 'executions are'} running.${value.unknown ? ` ${value.unknown} ${value.unknown === 1 ? 'execution has' : 'executions have'} an unknown outcome.` : ''}`, kind: 'answer' };
  } catch {
    const name = id.slice('local.'.length).replaceAll('-', '_');
    return { facts: { kind: 'unavailable', code: `local_${name}_unavailable` }, content: id === 'local.time' || id === 'local.date' ? 'The local clock or time zone is unavailable.' : id === 'local.workspace-status' ? 'Current workspace status is unavailable.' : id === 'local.project-count' ? 'The active project count is unavailable.' : 'Aerynth execution status is unavailable.', kind: 'inability' };
  }
}
