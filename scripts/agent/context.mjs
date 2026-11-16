#!/usr/bin/env node
/**
 * Phase C: revision-qualified, source-backed engineering context snapshots.
 * This is the Aetherwake engineering control plane, never Vela MissionService.
 */
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, resolve, relative, isAbsolute, sep } from "node:path";

function options(argv) {
  const out = { owners: [] };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!["--task", "--repo", "--owner", "--out", "--revision"].includes(flag) || !argv[i + 1]) {
      throw new Error("Unknown or incomplete option: " + flag);
    }
    const value = argv[++i];
    if (flag === "--owner") out.owners.push(value);
    else out[flag.slice(2)] = value;
  }
  if (!out.task || !out.repo) throw new Error("Usage: context.mjs --task task.json --repo owner/name [--owner component=tracked/path] [--out file.json]");
  return out;
}
function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function safePath(root, input) {
  if (isAbsolute(input)) throw new Error("Only repository-relative paths are permitted");
  const full = resolve(root, input);
  const rel = relative(root, full);
  if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) throw new Error("Path outside repository or root: " + input);
  return { full, rel: rel.split(sep).join("/") };
}
function sha(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
async function existingTracked(root, path) {
  const p = safePath(root, path);
  try {
    const info = await stat(p.full);
    if (!info.isFile()) return null;
    git(root, "ls-files", "--error-unmatch", "--", p.rel);
    return { ...p, bytes: await readFile(p.full) };
  } catch { return null; }
}
export async function createSnapshot({ root = process.cwd(), task, repository, owners = [], revisionOverride } = {}) {
  if (!task || task.record_type !== "task" || task.schema_version !== 1 || !task.id) throw new Error("Expected a v1 engineering Task");
  if (!repository || task.repository !== repository) throw new Error("Task repository mismatch");
  const revision = git(root, "rev-parse", "HEAD");
  if (revisionOverride && revisionOverride !== revision) throw new Error("Requested revision differs from checked-out HEAD");
  const warnings = [];
  const requirements = [];
  for (const ref of task.requirements || []) {
    if (!ref?.kind || !ref?.uri) throw new Error("Invalid requirement reference");
    const result = { kind: ref.kind, uri: ref.uri };
    if (["document", "git"].includes(ref.kind) && !ref.uri.includes("://")) {
      const file = await existingTracked(root, ref.uri);
      if (file) result.revision = sha(file.bytes);
      else {
        if (ref.revision) result.revision = ref.revision;
        warnings.push("Unverified tracked requirement: " + ref.uri);
      }
    } else if (ref.revision) result.revision = ref.revision;
    requirements.push(result);
  }
  const components = [];
  for (const item of owners) {
    const eq = item.indexOf("=");
    if (eq <= 0) throw new Error("Owner must be component=repository/path");
    const name = item.slice(0, eq), path = item.slice(eq + 1);
    const file = await existingTracked(root, path);
    if (!file) {
      warnings.push("Owner source unverified: " + name);
      continue;
    }
    components.push({ name, owner_ref: { kind: "git", uri: file.rel, revision: sha(file.bytes) } });
  }
  if (!components.length) warnings.push("No verified component-owner sources supplied; ownership must not be inferred");
  const current = task.revision === revision;
  if (!current) warnings.push("Task revision differs from checkout HEAD; rebase or explicitly review context");
  const now = new Date().toISOString();
  return {
    schema_version: 1, record_type: "context_snapshot", id: "ctx_" + randomUUID(),
    created_at: now, repository, revision, task_id: task.id, generated_at: now,
    requirements, components,
    freshness: !current ? "stale" : warnings.length ? "unverified" : "current",
    warnings
  };
}
export function checkFreshness(snapshot, task, revision) {
  if (!snapshot || snapshot.record_type !== "context_snapshot") return false;
  return snapshot.revision === revision && task.revision === revision && snapshot.task_id === task.id &&
    snapshot.freshness === "current";
}
async function main() {
  const opts = options(process.argv.slice(2));
  const task = JSON.parse(await readFile(opts.task, "utf8"));
  const snapshot = await createSnapshot({ task, repository: opts.repo, owners: opts.owners, revisionOverride: opts.revision });
  const payload = JSON.stringify(snapshot, null, 2) + "\n";
  if (opts.out) {
    await mkdir(dirname(resolve(opts.out)), { recursive: true });
    await writeFile(opts.out, payload, { flag: "wx", mode: 0o600 });
  } else process.stdout.write(payload);
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch(e => { process.stderr.write("Context: " + e.message + "\n"); process.exitCode = 1; });
}
