#!/usr/bin/env node
/**
 * Phase C: revision-qualified, source-backed engineering context snapshots.
 * This is the Aetherwake engineering control plane, never Vela MissionService.
 */
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { realpath } from "node:fs/promises";

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
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, stdio: ["ignore", "pipe", "pipe"] });
}
function safePath(root, input) {
  if (isAbsolute(input)) throw new Error("Only repository-relative paths are permitted");
  const full = resolve(root, input);
  const rel = relative(root, full);
  if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) throw new Error("Path outside repository or root: " + input);
  return { full, rel: rel.split(sep).join("/") };
}
function sha(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function isLocalSource(ref) {
  return ["document", "git"].includes(ref.kind) && !ref.uri.includes("://");
}

async function trackedSources(root, inputs) {
  const normalized = inputs.map(input => safePath(root, input));
  const paths = [...new Map(normalized.map(path => [path.rel, path])).values()];
  const sources = new Map();
  // Bound argv size for Windows. Query each exact path once even when it
  // appears both as a requirement and as evidence of source ownership.
  let batch = [], bytes = 0;
  async function readBatch(entries) {
    const args = ["--", ...entries.map(path => path.rel)];
    const tracked = new Set(git(root, "--literal-pathspecs", "ls-files", "-z", ...args).split("\0"));
    const trackedEntries = entries.filter(path => tracked.has(path.rel));
    // Bound concurrent reads and retain only the digest. Several requirements
    // and owner references can cite the same bytes within this readback.
    for (let offset = 0; offset < trackedEntries.length; offset += 8) {
      await Promise.all(trackedEntries.slice(offset, offset + 8).map(async path => {
        try {
          const actual = await realpath(path.full);
          safePath(root, relative(root, actual));
          if (!(await stat(actual)).isFile()) return;
          sources.set(path.rel, { rel: path.rel, digest: sha(await readFile(actual)), dirty: false });
        } catch {
          // Missing, inaccessible, or out-of-repository sources remain unverified.
        }
      }));
    }
    const dirty = new Set(git(root, "--literal-pathspecs", "status", "--porcelain=v1", "-z",
      "--no-renames", "--untracked-files=no", ...args).split("\0").map(entry => entry.slice(3)));
    for (const { rel } of entries) {
      if (sources.has(rel)) sources.get(rel).dirty = dirty.has(rel);
    }
  }
  for (const path of paths) {
    const size = Buffer.byteLength(path.rel) + 3;
    if (batch.length && bytes + size > 4096) {
      await readBatch(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(path);
    bytes += size;
  }
  if (batch.length) await readBatch(batch);
  return input => sources.get(safePath(root, input).rel);
}
export function taskDigest(task) {
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  return sha(JSON.stringify(canonical(task)));
}
export async function createSnapshot({ root = process.cwd(), task, repository, owners = [], revisionOverride } = {}) {
  if (!task || task.record_type !== "task" || task.schema_version !== 1 || !task.id) throw new Error("Expected a v1 engineering Task");
  if (!repository || task.repository !== repository) throw new Error("Task repository mismatch");
  const revision = git(root, "rev-parse", "HEAD").trim();
  if (revisionOverride && revisionOverride !== revision) throw new Error("Requested revision differs from checked-out HEAD");
  const warnings = [];
  const refs = task.requirements || [];
  for (const ref of refs) {
    if (!ref?.kind || typeof ref.uri !== "string" || !ref.uri) throw new Error("Invalid requirement reference");
  }
  const ownerRefs = owners.map(item => {
    const eq = item.indexOf("=");
    if (eq <= 0) throw new Error("Owner must be component=repository/path");
    return { name: item.slice(0, eq), path: item.slice(eq + 1) };
  });
  const tracked = await trackedSources(root, [
    ...refs.filter(isLocalSource).map(ref => ref.uri), ...ownerRefs.map(owner => owner.path)
  ]);
  const requirements = [];
  for (const ref of refs) {
    const result = { kind: ref.kind, uri: ref.uri };
    if (isLocalSource(ref)) {
      const file = tracked(ref.uri);
      if (file) {
        result.revision = file.digest;
        if (file.dirty) warnings.push("Requirement has uncommitted changes: " + file.rel);
      }
      else {
        if (ref.revision) result.revision = ref.revision;
        warnings.push("Unverified tracked requirement: " + ref.uri);
      }
    } else {
      if (ref.revision) result.revision = ref.revision;
      warnings.push("Requirement cannot be verified from the checkout: " + ref.uri);
    }
    requirements.push(result);
  }
  const components = [];
  for (const { name, path } of ownerRefs) {
    const file = tracked(path);
    if (!file) {
      warnings.push("Owner source unverified: " + name);
      continue;
    }
    if (file.dirty) warnings.push("Owner source has uncommitted changes: " + file.rel);
    components.push({ name, owner_ref: { kind: "git", uri: file.rel, revision: file.digest } });
  }
  if (!components.length) warnings.push("No verified component-owner sources supplied; ownership must not be inferred");
  const current = task.revision === revision && git(root, "rev-parse", "HEAD").trim() === revision;
  if (!current) warnings.push("Task revision differs from checkout HEAD; rebase or explicitly review context");
  const now = new Date().toISOString();
  return {
    schema_version: 1, record_type: "context_snapshot", id: "ctx_" + randomUUID(),
    created_at: now, repository, revision, task_id: task.id, generated_at: now,
    requirements, components, task_digest: taskDigest(task),
    freshness: !current ? "stale" : warnings.length ? "unverified" : "current",
    warnings
  };
}
export async function checkFreshness(snapshot, task, revision, root = process.cwd()) {
  if (!snapshot || snapshot.record_type !== "context_snapshot" || !task) return false;
  if (snapshot.revision !== revision || task.revision !== revision || snapshot.task_id !== task.id ||
      snapshot.repository !== task.repository || snapshot.freshness !== "current" ||
      snapshot.task_digest !== taskDigest(task) || git(root, "rev-parse", "HEAD").trim() !== revision) return false;
  if (!Array.isArray(snapshot.requirements) || snapshot.requirements.length !== (task.requirements || []).length) return false;
  const referenceKey = ref => JSON.stringify([ref.kind,ref.uri]);
  if (new Set(snapshot.requirements.map(referenceKey)).size !== snapshot.requirements.length ||
      (task.requirements||[]).some(ref=>!snapshot.requirements.some(actual=>referenceKey(actual)===referenceKey(ref)))) return false;
  if (!Array.isArray(snapshot.components) || !snapshot.components.length) return false;
  const refs = [...snapshot.requirements, ...snapshot.components.map(c => c.owner_ref)];
  if (refs.some(ref => typeof ref?.uri !== "string" || !isLocalSource(ref))) return false;
  const tracked = await trackedSources(root, refs.map(ref => ref.uri));
  for (const ref of refs) {
    const file = tracked(ref.uri);
    if (!file || file.dirty || file.digest !== ref.revision) return false;
  }
  return git(root, "rev-parse", "HEAD").trim() === revision;
}
export async function writeSnapshot(path, snapshot) {
  await mkdir(dirname(resolve(path)), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(snapshot, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}

async function main() {
  const opts = options(process.argv.slice(2));
  const task = JSON.parse(await readFile(opts.task, "utf8"));
  const snapshot = await createSnapshot({ task, repository: opts.repo, owners: opts.owners, revisionOverride: opts.revision });
  if (opts.out) await writeSnapshot(opts.out, snapshot);
  else process.stdout.write(JSON.stringify(snapshot, null, 2) + "\n");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { process.stderr.write("Context: " + e.message + "\n"); process.exitCode = 1; });
}
