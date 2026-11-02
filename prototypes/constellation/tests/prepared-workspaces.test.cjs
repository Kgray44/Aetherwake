const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { canonicalPaths, loadPreparedWorkspaces } = require("./prepared-workspaces.cjs");

async function fixture(t) {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "aerynth-prepared-test-"));
  t.after(async () => {
    assert.ok(path.resolve(profile).startsWith(path.join(os.tmpdir(), "aerynth-prepared-test-")));
    await fs.rm(profile, { recursive: true });
  });
  const snapshot = { projects: [], workspaces: [], resources: [], blocks: [], navigationBlocks: [], relationships: [], activeWorkspaceId: "w0" };
  const records = [], taskGroups = [], sourceHashes = Object.fromEntries(canonicalPaths.map((p) => [p, "1".repeat(64)]));
  const projectNames = ["A World for Two", "Voyagewright", "Airbrush Disc System"], titles = ["Development", "Planning", "Engineering", "Review", "Calibration", "Hardware"];
  const add = (kind, workspaceId) => {
    const id = "r" + snapshot.resources.length, blockId = "b" + snapshot.navigationBlocks.length;
    snapshot.resources.push({ id, kind, title: id, content: "Synthetic content", provider: "local", version: 1 });
    snapshot.navigationBlocks.push({ id: blockId, resource_id: id, workspace_id: workspaceId, version: 1, x: 0, y: 0, width: 300, height: 200, z: 0, shape: "folio" });
    return { resourceId: id, blockId };
  };
  for (let pi = 0; pi < 3; pi++) {
    const projectId = "p" + pi;
    snapshot.projects.push({ id: projectId, title: projectNames[pi], version: 1 });
    for (let wi = 0; wi < 2; wi++) {
      const workspaceId = "w" + (pi * 2 + wi), title = titles[pi * 2 + wi], items = {};
      snapshot.workspaces.push({ id: workspaceId, project_id: projectId, title, version: 1 });
      for (const kind of ["conversation", "note", "task", "research", "reference"]) items[kind] = add(kind, workspaceId);
      records.push({ projectId, workspaceId, title, items });
      if (!wi) {
        add("conversation", workspaceId);
        const extra = add("task", workspaceId), group = add("task_group", workspaceId), members = [items.task.resourceId, extra.resourceId];
        snapshot.resources.find((r) => r.id === group.resourceId).taskMembers = members.map((id, index) => ({ id, title: id, status: index ? "done" : "open" }));
        for (const id of members) snapshot.relationships.push({ id: "edge-" + id, source_id: group.resourceId, target_id: id, kind: "contains_task", provenance: "user" });
        taskGroups.push({ projectId, resourceId: group.resourceId, blockId: group.blockId, memberResourceIds: members });
      }
    }
  }
  snapshot.blocks = snapshot.navigationBlocks.filter((b) => b.workspace_id === "w0");
  const manifest = { schema: "aerynth.expanded-setup@1", syntheticData: true, profile: await fs.realpath(profile), database: path.join(await fs.realpath(profile), "aerynth.sqlite"), sourceHashes,
    projects: snapshot.projects.map((p) => p.id), workspaces: snapshot.workspaces.map((w) => w.id), records, taskGroups, snapshot, preparation: {} };
  const save = () => fs.writeFile(path.join(profile, "expanded-setup.json"), JSON.stringify(manifest));
  await save();
  return { profile, manifest, snapshot: structuredClone(snapshot), source: { hashes: { ...sourceHashes } }, save };
}

test("prepared fixture validation recovers real ID maps for all 39 resources and task groups", async (t) => {
  const f = await fixture(t), result = await loadPreparedWorkspaces(f.profile, f.source, f.snapshot);
  assert.equal(result.records.length, 6);
  assert.equal(result.taskGroups.length, 3);
  assert.equal(result.records[0].note.resource.id, f.manifest.records[0].items.note.resourceId);
  assert.equal(result.evidence.mode, "prepared-canonical-workspaces");
});

test("prepared validation rejects a different canonical source or changed resource content", async (t) => {
  const f = await fixture(t);
  f.source.hashes[canonicalPaths[0]] = "2".repeat(64);
  await assert.rejects(loadPreparedWorkspaces(f.profile, f.source, f.snapshot), /prepared canonical source/);
  f.source.hashes[canonicalPaths[0]] = "1".repeat(64);
  f.snapshot.resources[0].content = "Changed since preparation";
  await assert.rejects(loadPreparedWorkspaces(f.profile, f.source, f.snapshot), /exact prepared canonical fixture/);
});

test("prepared validation rejects incorrect task-member and block identity mappings", async (t) => {
  const f = await fixture(t);
  f.manifest.taskGroups[0].memberResourceIds = ["unknown", "missing"];
  await f.save();
  await assert.rejects(loadPreparedWorkspaces(f.profile, f.source, f.snapshot));
  f.manifest.taskGroups[0].memberResourceIds = f.manifest.snapshot.resources.find((r) => r.id === f.manifest.taskGroups[0].resourceId).taskMembers.map((m) => m.id);
  f.manifest.records[0].items.note.blockId = f.manifest.records[0].items.reference.blockId;
  await f.save();
  await assert.rejects(loadPreparedWorkspaces(f.profile, f.source, f.snapshot));
});
