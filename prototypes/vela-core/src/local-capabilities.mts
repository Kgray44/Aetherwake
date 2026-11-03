import { check, identifier, isLocalFact, isRecord, text } from './capabilities.ts';
import type { VelaLocalCapabilityId, VelaLocalFacts, VelaLocalHost, VelaLocalRecord } from './contracts.ts';
import { validateSystemMemoryMeasurement, type SystemMemoryMeasurement } from './system-information.ts';
import { calculate, calculatorExpression } from './calculator.ts';
import type { SystemUtilization } from './system-utilization.mts';

/** Node/native host system facts. No provider, credentials, files or network are consulted. */
export function readSystemClock(): ReturnType<VelaLocalHost['clock']> {
  const { timeZone, locale } = new Intl.DateTimeFormat().resolvedOptions();
  return { epochMs: Date.now(), timeZone, locale };
}
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const workspace = (value: unknown): boolean => value === null || (isRecord(value) && value.kind === 'workspace' && identifier(value.id) && text(value.title) && Number.isSafeInteger(value.version) && Number(value.version) >= 1 && (value.state === undefined || value.state === 'active') && (value.projectId === undefined || value.projectId === null || identifier(value.projectId)));
export function validateLocalRecord(value: unknown): asserts value is VelaLocalRecord {
  check(isRecord(value) && value.schemaVersion === 1, 'unsupported_vela_local_schema');
  check(identifier(value.commandId) && isLocalFact(value.capabilityId) && value.classification === 'observed' && value.providerId === null && typeof value.observedAt === 'string' && Number.isFinite(Date.parse(value.observedAt)), 'corrupt_vela_local_record');
  const f = value.facts; check(isRecord(f), 'corrupt_vela_local_facts');
  if (f.kind === 'unavailable') { check(typeof f.code === 'string' && /^local_[a-z_]+_unavailable$/u.test(f.code), 'corrupt_vela_local_facts'); return; }
  if (f.kind === 'system-utilization') {
    validateUtilization(f.measurement);
    check(value.capabilityId === 'system.' + f.measurement.metric && value.observedAt === f.measurement.measuredAt, 'corrupt_vela_local_facts');
    return;
  }
  if (f.kind === 'system-performance') {
    check(value.capabilityId === 'system.performance' && Array.isArray(f.measurements) &&
      f.measurements.length > 0 && f.measurements.length <= 2, 'corrupt_vela_local_facts');
    for (const measurement of f.measurements) validateUtilization(measurement);
    check(new Set(f.measurements.map(m => m.metric)).size === f.measurements.length, 'corrupt_vela_local_facts');
    return;
  }
  check(value.capabilityId === (f.kind === 'system-memory' ? 'system.memory' : 'local.' + f.kind), 'corrupt_vela_local_facts');
  if (f.kind === 'calculator') {
    check(text(f.expression, 256) && Number.isFinite(f.value) && calculate(f.expression) === f.value, 'corrupt_vela_local_facts');
    return;
  }
  if (f.kind === 'system-memory') { try { validateSystemMemoryMeasurement(f.measurement); } catch { check(false, 'corrupt_vela_local_facts'); } check(value.observedAt === (f.measurement as {measuredAt:string}).measuredAt, 'corrupt_vela_local_facts'); return; }
  if (f.kind === 'time' || f.kind === 'date') check(Number.isSafeInteger(f.epochMs) && Number.isFinite(Date.parse(String(f.utc))) && new Date(Number(f.epochMs)).toISOString() === f.utc && text(f.timeZone, 100) && text(f.locale, 100) && Number.isInteger(f.utcOffsetMinutes) && Math.abs(Number(f.utcOffsetMinutes)) <= 24 * 60 && typeof f.calendarDate === 'string' && /^\d{4,6}-\d{2}-\d{2}$/u.test(f.calendarDate) && text(f.formatted, 300), 'corrupt_vela_local_facts');
  else if (f.kind === 'workspace-status') check(workspace(f.workspace) && ['persisted', 'pending', 'unknown'].includes(String(f.persistence)) && f.coverage === 'canonical-workspace-layout', 'corrupt_vela_local_facts');
  else if (f.kind === 'project-count') check(count(f.count) && f.coverage === 'authorized-active-projects', 'corrupt_vela_local_facts');
  else if (f.kind === 'execution-status') check(count(f.running) && count(f.unknown) && f.coverage === 'aerynth-owned-executions', 'corrupt_vela_local_facts');
  else check(false, 'corrupt_vela_local_facts');
}
function validateUtilization(value: unknown): asserts value is SystemUtilization {
  check(isRecord(value) && typeof value.measuredAt === 'string' && Number.isFinite(Date.parse(value.measuredAt)) &&
    typeof value.percent === 'number' && Number.isFinite(value.percent) && value.percent >= 0 && value.percent <= 100,
  'invalid_system_utilization');
  if (value.metric === 'cpu') check(value.source === 'node:os.cpus' && count(value.sampleMs) && value.sampleMs > 0 &&
    count(value.logicalCpus) && value.logicalCpus > 0, 'invalid_cpu_counters');
  else check(value.metric === 'gpu' && value.source === 'windows:gpu-engine' && count(value.observedAdapters) &&
    value.observedAdapters > 0 && count(value.observedEngines) && value.observedEngines >= value.observedAdapters, 'invalid_gpu_counters');
}

export function evaluateLocalCapability(id: VelaLocalCapabilityId, host: VelaLocalHost, intent?: string, utilization: SystemUtilization[] = [], memory?: SystemMemoryMeasurement | null): { facts: VelaLocalFacts; content: string; kind: 'answer' | 'inability' } {
  check(isLocalFact(id), 'unsupported_local_capability');
  if (id === 'local.calculator') {
    const expression = intent && calculatorExpression(intent);
    try {
      check(expression, 'invalid_expression');
      const value = calculate(expression);
      return { facts: { kind: 'calculator', expression, value }, content: expression + ' = ' + value, kind: 'answer' };
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      const content = code === 'division_by_zero' ? 'Division by zero is undefined.'
        : code === 'square_root_domain' ? 'That square root has no real-valued result.'
        : code === 'result_out_of_range' ? 'The result is outside the calculator’s numeric range.'
        : 'I couldn’t parse that arithmetic. Try parentheses and operators such as +, −, ×, ÷, %, or ^.';
      return { facts: { kind: 'unavailable', code: 'local_calculator_unavailable' }, content, kind: 'inability' };
    }
  }
  if (id === 'system.performance') {
    const cpu = evaluateLocalCapability('system.cpu', host, undefined, utilization);
    const gpu = evaluateLocalCapability('system.gpu', host, undefined, utilization);
    const measurements = [cpu.facts, gpu.facts].flatMap(fact => fact.kind === 'system-utilization' ? [fact.measurement] : []);
    return {
      facts: measurements.length ? { kind: 'system-performance', measurements } : { kind: 'unavailable', code: 'local_system_performance_unavailable' },
      content: cpu.content + ' ' + gpu.content,
      kind: measurements.length ? 'answer' : 'inability',
    };
  }
  if (id === 'system.cpu' || id === 'system.gpu') {
    const name = id === 'system.cpu' ? 'CPU' : 'GPU';
    try {
      const reading = utilization.find(value => id === 'system.' + value.metric);
      validateUtilization(reading);
      const measurement = structuredClone(reading);
      const detail = measurement.metric === 'cpu'
        ? `averaged across ${measurement.logicalCpus} logical processors over ${measurement.sampleMs} ms`
        : `the busiest measured GPU engine across ${measurement.observedAdapters} observed adapter(s)`;
      return { facts: { kind: 'system-utilization', measurement }, content: `${name} usage was ${measurement.percent}% (${detail}).`, kind: 'answer' };
    } catch {
      return { facts: { kind: 'unavailable', code: 'local_system_' + name.toLowerCase() + '_unavailable' },
        content: `Current ${name} usage is unavailable from this device’s native performance counters.`, kind: 'inability' };
    }
  }
  try {
    if (id === 'system.memory') {
      const raw = memory === undefined ? host.system?.memory() : memory;
      validateSystemMemoryMeasurement(raw);
      const measurement = structuredClone(raw), gib = (bytes:number) => (bytes / 1073741824).toFixed(2);
      const executor = measurement.source.executor ? ' through the local read-only Codex command' : '';
      return { facts: { kind: 'system-memory', measurement }, content: `Your computer is using ${gib(measurement.usedBytes)} GiB of ${gib(measurement.totalBytes)} GiB RAM (${measurement.utilizationPercent.toFixed(2)}%). ${gib(measurement.availableBytes)} GiB is ${measurement.source.platform === 'win32' ? 'available' : 'OS-reported free'}. Measured at ${measurement.measuredAt} using node:os totalmem/freemem${executor}. Used is total minus OS-reported ${measurement.source.platform === 'win32' ? 'available' : 'free'} physical memory, not Aerynth process memory or committed memory.`, kind: 'answer' };
    }
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
    const name = id === 'system.memory' ? 'system_memory' : id.slice('local.'.length).replaceAll('-', '_');
    return { facts: { kind: 'unavailable', code: `local_${name}_unavailable` }, content: id === 'system.memory' ? 'Current system RAM usage is unavailable from the trusted memory reader. No model or diagnostic task was started.' : id === 'local.time' || id === 'local.date' ? 'The local clock or time zone is unavailable.' : id === 'local.workspace-status' ? 'Current workspace status is unavailable.' : id === 'local.project-count' ? 'The active project count is unavailable.' : 'Aerynth execution status is unavailable.', kind: 'inability' };
  }
}
