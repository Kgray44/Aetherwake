#!/usr/bin/env node
/**
 * Phase C: measurements from real local processes; unavailable provider usage
 * is recorded as unavailable, never inferred from commits, PRs or timings.
 * Event files default under .git and must not be committed to public Git.
 */
import { spawn, execFileSync } from "node:child_process";
import { appendFile, mkdir, readFile, lstat } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {beginAttempt,persistRecord} from './record-journal.mjs';
import { checkFreshness } from './context.mjs';
import { observeResources } from './resources.mjs';
import { appendEvent, traceEvent } from './journal.mjs';
import { observeCodexStream } from './provider-events.mjs';
import { startObservatorySync } from './observatory-sync.mjs';
const PHASES = new Set(["context", "implementation", "verification", "integration", "review", "other"]);
function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function parse(argv) {
  if (argv[0] !== "run") throw new Error("Expected 'run' subcommand");
  const split = argv.indexOf("--");
  if (split < 0 || split === argv.length - 1) throw new Error("Provide command after --");
  const opts = {};
  for (let i = 1; i < split; i += 2) {
    const name = argv[i], value = argv[i + 1];
    if (!["--task", "--context", "--attempt", "--attempt-number", "--repo", "--phase", "--out", "--provider", "--model", "--event-stream"].includes(name) || !value) throw new Error("Invalid option: " + name);
    opts[name.slice(2)] = value;
  }
  if (!opts.task || !opts.repo) throw new Error("Required --task and --repo owner/name");
  if (!PHASES.has(opts.phase || "implementation")) throw new Error("Unsupported telemetry phase");
  return { opts, command: argv.slice(split + 1) };
}
function measure(name, availability, value, unit, source, method) {
  const result = { name, availability };
  if (value !== undefined) result.value = value;
  if (unit) result.unit = unit;
  if (source) result.source = source;
  if (method) result.method = method;
  return result;
}
export async function runObserved({ task, context, repository, phase = "implementation", command, attemptId, attemptNumber = 1, out, provider, model, eventStream }) {
  if (!task || task.record_type !== "task" || task.schema_version !== 1 || task.repository !== repository) throw new Error("Expected matching v1 Task");
  if (!PHASES.has(phase) || !Array.isArray(command) || !command.length) throw new Error("Invalid phase or command");
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) throw new Error("Attempt number must be positive integer");
  if (eventStream !== undefined && eventStream !== "codex-exec-json") throw new Error("Unsupported telemetry event stream");
  const revision = git("rev-parse", "HEAD");
  if (task.revision !== revision) throw new Error("Stale Task revision; refresh authorized context before execution");
  if (!await checkFreshness(context, task, revision)) throw new Error("Fresh source-verified context is required before execution");
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  const id = attemptId || "attempt_" + randomUUID();
  const startedAt = new Date().toISOString();
  const observerStarted = process.hrtime.bigint();
  const path = out || join(git("rev-parse", "--absolute-git-dir"), "agent-harness", "events.jsonl");
  await mkdir(dirname(resolve(path)), {recursive:true,mode:0o700});
  await assertPrivateFile(path);
  const journalPath = path + ".journal";
  const runningAttempt=await beginAttempt(journalPath,{schema_version:1,record_type:'attempt',id,created_at:startedAt,repository,revision,task_id:task.id,attempt_number:attemptNumber,state:'running',started_at:startedAt,branch,...provider?{provider}:{},...model?{model}:{},failure_category:'none'});
  const spanId = "span_" + randomUUID();
  const startMeasurements = eventStream === "codex-exec-json" ?
    [measure("provider_stream_requested", "observed", 1, "boolean", "codex_exec_jsonl", "observer_configuration")] : [];
  await appendEvent(journalPath, traceEvent({task,attemptId:id,spanId,kind:"span_start",phase,state:"started",measurements:startMeasurements}));
  const observatory = await startObservatorySync({ task, journal: journalPath }).catch(() => {
    process.stderr.write('Observatory synchronization could not start; the private journal is still recording.\n');
    return null;
  });
  try {
  const cpuStart = process.cpuUsage();
  const launched = process.hrtime.bigint();
  let exitCode = 1, actualExitCode = null, signal = null, launchFailure = null;
  let elapsed = null, childFinishedAt = null, resourceMeasurements = [];
  let providerMeasurements = [], resourceCollectionError = false;
  try {
    const child = spawn(command[0], command.slice(1), {
      stdio: eventStream ? ["inherit", "pipe", "inherit"] : "inherit",
      shell: false
    });
    const closed = new Promise(resolve => {
      child.once("error", error => resolve({ code: 127, signal: null, error }));
      child.once("close", (code, sig) => resolve({ code: code ?? 1, actualExitCode: code, signal: sig, error: null,
        elapsed: Number(process.hrtime.bigint() - launched) / 1e6, finishedAt: new Date().toISOString() }));
    });
    const providerStream = child.stdout && observeCodexOutput(child.stdout, usage => appendEvent(journalPath,
      traceEvent({ task, attemptId: id, spanId, kind: "measurement", phase, measurements: usage })
    ));
    const resources = observeResources(child.pid);
    const result = await closed;
    exitCode = result.code;
    actualExitCode = result.actualExitCode ?? null;
    signal = result.signal;
    launchFailure = result.error;
    elapsed = result.elapsed ?? null;
    childFinishedAt = result.finishedAt ?? null;
    try {
      resourceMeasurements = await resources.stop();
    } catch {
      resourceCollectionError = true;
    }
    if (providerStream) providerMeasurements = await providerStream;
  } catch (e) { launchFailure = e; }
  const observerElapsed = Number(process.hrtime.bigint() - observerStarted) / 1e6;
  const observerCpu = process.cpuUsage(cpuStart);
  const finishedAt = new Date().toISOString();
  const success = exitCode === 0 && !signal && !launchFailure;
  const base = { schema_version: 1, created_at: startedAt, repository, revision, task_id: task.id };
  const attempt = {
    ...runningAttempt,
    state: attemptId ? "running" : success ? "succeeded" : "failed", started_at: runningAttempt.started_at, ...(!attemptId ? {finished_at: finishedAt} : {}), branch,
    ...provider ? { provider } : {}, ...model ? { model } : {},
    failure_category: success ? "none" : launchFailure ? "environment" : "unknown",
    ...launchFailure ? { failure_diagnosis: "Command could not be launched; inspect local stderr" } : {}
  };
  const telemetry = {
    ...base, record_type: "telemetry", id: "telemetry_" + randomUUID(),
    attempt_id: id, phase, observed_at: finishedAt,
    measurements: [
      measure("elapsed_wall_ms", elapsed === null ? "unavailable" : "observed", elapsed ?? undefined, "ms", "local_monotonic_clock", "spawn_to_close"),
      measure("process_exit_code", actualExitCode === null ? "unavailable" : "observed", actualExitCode ?? undefined, "code", "child_process", "close_event"),
      measure("process_launch_succeeded", "observed", Number(elapsed !== null), "boolean", "child_process", "spawn_to_close_or_error"),
      measure("observer_elapsed_before_terminal_ms", "observed", observerElapsed, "ms", "local_monotonic_clock", "attempt_start_to_terminal_preparation"),
      measure("observer_cpu_user_ms", "observed", observerCpu.user/1000, "ms", "node_process_cpuUsage", "wrapper_process_only"),
      measure("observer_cpu_system_ms", "observed", observerCpu.system/1000, "ms", "node_process_cpuUsage", "wrapper_process_only"),
      measure("observer_rss_bytes", "observed", process.memoryUsage().rss, "bytes", "node_process_memoryUsage", "wrapper_process_only"),
      measure("resource_collection_error", "observed", Number(resourceCollectionError), "boolean", "local_observer", "collector_cleanup"),
      ...resourceMeasurements,
      measure("child_cpu_ms", "unavailable"),
      measure("child_peak_rss_bytes", "unavailable"),
      measure("child_disk_read_bytes", "unavailable"),
      measure("child_disk_write_bytes", "unavailable"),
      measure("gpu_utilization", "unavailable"),
      measure("gpu_memory_bytes", "unavailable"),
      measure("frame_time_ms", "unavailable"),
      ...providerMeasurements,
      ...(providerMeasurements.some(m => m.name === "provider_usage_recorded_turn_count" && m.value > 0) ? [] : [
        measure("provider_input_tokens", "unavailable"),
        measure("provider_output_tokens", "unavailable")
      ]),
      measure("provider_quota_consumption", "unavailable"),
      measure("provider_cost_usd", "unavailable")
    ]
  };
  await appendEvent(journalPath, traceEvent({task,attemptId:id,spanId,kind:"span_end",phase,state:success?"completed":"failed",occurredAt:childFinishedAt ?? finishedAt,measurements:telemetry.measurements}));
  if(!attemptId)await persistRecord(journalPath,attempt);
  await persistRecord(journalPath,telemetry);
  await assertPrivateFile(path);
  await appendFile(path, (attemptId ? "" : JSON.stringify(attempt) + "\n") + JSON.stringify(telemetry) + "\n", { encoding: "utf8", mode: 0o600 });
  return { journalPath, exitCode, signal, attempt, telemetry, eventPath: path };
  } finally {
    await observatory?.finish().catch(() => {});
  }
}
async function observeCodexOutput(stream, onUsage) {
  const stdout = process.stdout;
  const onError = () => {}; // The write callback reports failure to the stream observer.
  stdout.on("error", onError);
  try {
    return await observeCodexStream(stream, {
      onUsage,
      forward: bytes => new Promise((resolve, reject) => {
        stdout.write(bytes, error => error ? reject(error) : resolve());
      })
    });
  } finally {
    stdout.off("error", onError);
  }
}
async function assertPrivateFile(path) {
 try {const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||(process.platform!=='win32'&&(info.mode&0o077)))throw Error('Telemetry output must be a private regular file');}
 catch(e){if(e.code!=='ENOENT')throw e;}
}
async function main() {
  const { opts, command } = parse(process.argv.slice(2));
  const task = JSON.parse(await readFile(opts.task, "utf8"));
  const r = await runObserved({
    task, context: opts.context ? JSON.parse(await readFile(opts.context,"utf8")) : null, repository: opts.repo, command, phase: opts.phase || "implementation",
    attemptId: opts.attempt, attemptNumber: Number(opts["attempt-number"] || 1),
    out: opts.out, provider: opts.provider, model: opts.model, eventStream: opts["event-stream"]
  });
  process.stderr.write("Engineering attempt " + r.attempt.id + ": " + r.attempt.state + "; data: " + r.eventPath + "\n");
  process.exitCode = r.signal ? 128 : r.exitCode;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { process.stderr.write("Telemetry: " + e.message + "\n"); process.exitCode = 1; });
}
