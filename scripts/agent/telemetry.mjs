#!/usr/bin/env node
/**
 * Phase C: measurements from real local processes; unavailable provider usage
 * is recorded as unavailable, never inferred from commits, PRs or timings.
 * Event files default under .git and must not be committed to public Git.
 */
import { spawn, execFileSync } from "node:child_process";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
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
    if (!["--task", "--attempt", "--attempt-number", "--repo", "--phase", "--out", "--provider", "--model"].includes(name) || !value) throw new Error("Invalid option: " + name);
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
export async function runObserved({ task, repository, phase = "implementation", command, attemptId, attemptNumber = 1, out, provider, model }) {
  if (!task || task.record_type !== "task" || task.schema_version !== 1 || task.repository !== repository) throw new Error("Expected matching v1 Task");
  if (!PHASES.has(phase) || !Array.isArray(command) || !command.length) throw new Error("Invalid phase or command");
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) throw new Error("Attempt number must be positive integer");
  const revision = git("rev-parse", "HEAD");
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  const id = attemptId || "attempt_" + randomUUID();
  const startedAt = new Date().toISOString();
  const started = process.hrtime.bigint();
  let exitCode = 1, signal = null, launchFailure = null;
  try {
    const child = spawn(command[0], command.slice(1), { stdio: "inherit", shell: false });
    const result = await new Promise(resolve => {
      child.once("error", error => resolve({ code: 127, signal: null, error }));
      child.once("close", (code, sig) => resolve({ code: code ?? 1, signal: sig, error: null }));
    });
    exitCode = result.code;
    signal = result.signal;
    launchFailure = result.error;
  } catch (e) { launchFailure = e; }
  const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
  const finishedAt = new Date().toISOString();
  const success = exitCode === 0 && !signal && !launchFailure;
  const base = { schema_version: 1, created_at: startedAt, repository, revision, task_id: task.id };
  const attempt = {
    ...base, record_type: "attempt", id, attempt_number: attemptNumber,
    state: success ? "succeeded" : "failed", started_at: startedAt, finished_at: finishedAt, branch,
    ...provider ? { provider } : {}, ...model ? { model } : {},
    failure_category: success ? "none" : launchFailure ? "environment" : "unknown",
    ...launchFailure ? { failure_diagnosis: "Command could not be launched; inspect local stderr" } : {}
  };
  const telemetry = {
    ...base, record_type: "telemetry", id: "telemetry_" + randomUUID(),
    attempt_id: id, phase, observed_at: finishedAt,
    measurements: [
      measure("elapsed_wall_ms", "observed", elapsed, "ms", "local_monotonic_clock", "hrtime.bigint"),
      measure("process_exit_code", "observed", exitCode, "code", "child_process", "spawn"),
      measure("provider_input_tokens", "unavailable"),
      measure("provider_output_tokens", "unavailable"),
      measure("provider_quota_consumption", "unavailable"),
      measure("provider_cost_usd", "unavailable")
    ]
  };
  const path = out || join(git("rev-parse", "--absolute-git-dir"), "agent-harness", "events.jsonl");
  await mkdir(dirname(resolve(path)), { recursive: true });
  await appendFile(path, JSON.stringify(attempt) + "\n" + JSON.stringify(telemetry) + "\n", { encoding: "utf8", mode: 0o600 });
  return { exitCode, signal, attempt, telemetry, eventPath: path };
}
async function main() {
  const { opts, command } = parse(process.argv.slice(2));
  const task = JSON.parse(await readFile(opts.task, "utf8"));
  const r = await runObserved({
    task, repository: opts.repo, command, phase: opts.phase || "implementation",
    attemptId: opts.attempt, attemptNumber: Number(opts["attempt-number"] || 1),
    out: opts.out, provider: opts.provider, model: opts.model
  });
  process.stderr.write("Engineering attempt " + r.attempt.id + ": " + r.attempt.state + "; data: " + r.eventPath + "\n");
  process.exitCode = r.signal ? 128 : r.exitCode;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { process.stderr.write("Telemetry: " + e.message + "\n"); process.exitCode = 1; });
}
