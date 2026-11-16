import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSnapshot, checkFreshness } from "../scripts/agent/context.mjs";
import { runObserved } from "../scripts/agent/telemetry.mjs";

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "aetherwake-agent-c-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  function git(...args) { return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim(); }
  git("init", "-q");
  git("config", "user.name", "Agent test");
  git("config", "user.email", "agent-test@example.invalid");
  await mkdir(join(dir, "docs"));
  await writeFile(join(dir, "docs", "authority.md"), "canonical content\n");
  git("add", ".");
  git("commit", "-qm", "test fixture");
  const revision = git("rev-parse", "HEAD");
  const task = {
    schema_version: 1, record_type: "task", id: "task_fixture",
    repository: "example/repo", revision,
    created_at: new Date().toISOString(), title: "Fixture task", objective: "Verify Phase C",
    classification: { primary: "backend", secondary: [] },
    prerequisites: { task_ids: [], capabilities: [] },
    acceptance: { profile_id: "backend-test", criteria: [{ id: "verify", description: "Pass fixture checks" }] },
    state: "ready",
    requirements: [{ kind: "document", uri: "docs/authority.md" }]
  };
  return { dir, git, revision, task };
}
test("context pins Git revision and hashed tracked sources, without inventing owners", async t => {
  const f = await fixture(t);
  const snapshot = await createSnapshot({ root: f.dir, task: f.task, repository: f.task.repository, owners: ["docs=docs/authority.md"] });
  assert.equal(snapshot.record_type, "context_snapshot");
  assert.equal(snapshot.revision, f.revision);
  assert.equal(snapshot.freshness, "current");
  assert.match(snapshot.requirements[0].revision, /^[a-f0-9]{64}$/);
  assert.equal(snapshot.components[0].name, "docs");
  assert.equal(checkFreshness(snapshot, f.task, f.revision), true);
  assert.equal(checkFreshness(snapshot, f.task, "0".repeat(40)), false);
  const missing = await createSnapshot({ root: f.dir, task: f.task, repository: f.task.repository, owners: [] });
  assert.equal(missing.freshness, "unverified");
  await assert.rejects(() => createSnapshot({ root: f.dir, task: f.task, repository: f.task.repository, owners: ["bad=../outside"] }), /outside/);
});
test("context refuses obsolete task revisions", async t => {
  const f = await fixture(t);
  const task = { ...f.task, revision: "0".repeat(40) };
  const snapshot = await createSnapshot({ root: f.dir, task, repository: task.repository, owners: ["docs=docs/authority.md"] });
  assert.equal(snapshot.freshness, "stale");
});
test("telemetry writes observed process events and explicitly unavailable provider metrics", async t => {
  const f = await fixture(t);
  const previous = process.cwd();
  process.chdir(f.dir);
  t.after(() => process.chdir(previous));
  const out = join(f.dir, "events.jsonl");
  const r = await runObserved({
    task: f.task, repository: f.task.repository, phase: "verification", out,
    command: [process.execPath, "-e", "process.exit(0)"]
  });
  assert.equal(r.exitCode, 0);
  const lines = (await readFile(out, "utf8")).trim().split("\n").map(x => JSON.parse(x));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].record_type, "attempt");
  assert.equal(lines[0].state, "succeeded");
  assert.equal(lines[1].record_type, "telemetry");
  assert.equal(lines[1].measurements.find(x => x.name === "elapsed_wall_ms").availability, "observed");
  assert.equal(lines[1].measurements.find(x => x.name === "provider_quota_consumption").availability, "unavailable");
});
