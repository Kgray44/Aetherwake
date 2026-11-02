const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const canonicalPaths = [
  "prototypes/integrated-backend/src/core.mts", "prototypes/integrated-backend/src/desktop.mts",
  "prototypes/integrated-backend/src/providers.mts", "prototypes/codex-bridge/src/adapter.ts",
  "prototypes/codex-bridge/src/transport.ts", "prototypes/block-library/registry.ts",
  "prototypes/block-library/canonical-host.mts", "prototypes/block-library/service.mts",
  "prototypes/workspace-kernel/kernel.mts", "prototypes/workspace-engine/engine.mts",
];
exports.canonicalPaths = canonicalPaths;
const byId = (items) => [...items].sort((a, b) => a.id.localeCompare(b.id));
const canonical = (s) => ({
  projects: byId(s.projects), workspaces: byId(s.workspaces), resources: byId(s.resources),
  placements: byId(s.navigationBlocks ?? s.blocks), relationships: byId(s.relationships),
  branches: s.conversationBranches ?? [], activeWorkspaceId: s.activeWorkspaceId,
});

exports.loadPreparedWorkspaces = async (privateRoot, source, actual) => {
  const file = path.join(privateRoot, "expanded-setup.json");
  assert.ok((await fs.stat(file)).size <= 1024 * 1024, "bounded preparation manifest");
  const raw = await fs.readFile(file, "utf8"), manifest = JSON.parse(raw);
  assert.equal(manifest.schema, "aerynth.expanded-setup@1");
  assert.equal(manifest.syntheticData, true);
  assert.equal(await fs.realpath(manifest.profile), await fs.realpath(privateRoot));
  assert.equal(path.resolve(manifest.database), path.join(await fs.realpath(privateRoot), "aerynth.sqlite"));
  assert.deepEqual(Object.keys(manifest.sourceHashes).sort(), [...canonicalPaths].sort());
  for (const [file, hash] of Object.entries(manifest.sourceHashes))
    assert.equal(source.hashes[file], hash, "prepared canonical source: " + file);
  assert.deepEqual(canonical(actual), canonical(manifest.snapshot), "native host loaded the exact prepared canonical fixture");
  assert.equal(actual.projects.length, 3); assert.equal(actual.workspaces.length, 6);
  assert.equal(actual.resources.length, 39); assert.equal((actual.navigationBlocks ?? actual.blocks).length, 39);
  assert.equal(manifest.records.length, 6); assert.equal(manifest.taskGroups.length, 3);
  assert.deepEqual(actual.projects.map((p) => p.title).sort(), ["A World for Two", "Airbrush Disc System", "Voyagewright"]);
  assert.deepEqual(manifest.records.map((r) => r.title), ["Development", "Planning", "Engineering", "Review", "Calibration", "Hardware"]);
  assert.equal(actual.resources.filter((r) => r.kind === "conversation" && r.provider === "local").length, 9);
  const placements = actual.navigationBlocks ?? actual.blocks;
  const records = manifest.records.map((row) => {
    const result = { projectId: row.projectId, workspaceId: row.workspaceId, title: row.title };
    assert.ok(actual.workspaces.some((w) => w.id === row.workspaceId && w.project_id === row.projectId));
    for (const kind of ["conversation", "note", "task", "research", "reference"]) {
      const ids = row.items[kind], resource = actual.resources.find((r) => r.id === ids.resourceId),
        block = placements.find((b) => b.id === ids.blockId);
      assert.ok(resource && block && resource.kind === kind && block.resource_id === resource.id && block.workspace_id === row.workspaceId);
      result[kind] = { resource, block };
    }
    return result;
  });
  for (const group of manifest.taskGroups) {
    const resource = actual.resources.find((r) => r.id === group.resourceId),
      block = placements.find((b) => b.id === group.blockId);
    assert.ok(resource?.kind === "task_group" && block?.resource_id === resource.id);
    assert.ok(actual.workspaces.some((w) => w.id === block.workspace_id && w.project_id === group.projectId));
    assert.equal(resource.taskMembers?.length, 2);
    assert.deepEqual(resource.taskMembers.map((m) => m.id).sort(), [...group.memberResourceIds].sort());
    assert.equal(resource.taskMembers.filter((m) => m.status === "done").length, 1);
    for (const id of group.memberResourceIds)
      assert.ok(actual.relationships.some((e) => e.kind === "contains_task" && e.source_id === resource.id && e.target_id === id));
  }
  return { projects: manifest.projects, workspaces: manifest.workspaces, records,
    taskGroups: manifest.taskGroups,
    evidence: { mode: "prepared-canonical-workspaces", manifestSha256: createHash("sha256").update(raw).digest("hex"),
      canonicalSourceHashes: manifest.sourceHashes, preparation: manifest.preparation,
      meaning: "Offline canonical fixture preparation only; the ordered desktop interactions are verified separately." } };
};
