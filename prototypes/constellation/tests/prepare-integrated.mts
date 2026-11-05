import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import type { Snapshot } from "../types.ts";

type Kind = "conversation" | "note" | "task" | "research" | "reference" | "task_group";
type Resource = Snapshot["resources"][number] & {
  version: number; content: string; taskStatus?: "open" | "done";
  taskMembers?: { id: string; title: string; status: string }[];
};
type Block = Snapshot["blocks"][number] & { version: number; shape: string };
type Desktop = Omit<Snapshot, "resources" | "blocks"> & {
  resources: Resource[]; blocks: Block[]; navigationBlocks: Block[];
  layoutVersion: number;
};
type Identity = { resourceId: string; blockId: string };
export type PreparedRecord = {
  projectId: string; workspaceId: string; title: string;
  items: Record<Exclude<Kind, "task_group">, Identity>;
};
type Core = { command(name: string, input: unknown): Promise<any> };
const names = [
  ["A World for Two", ["Development", "Planning"]],
  ["Voyagewright", ["Engineering", "Review"]],
  ["Airbrush Disc System", ["Calibration", "Hardware"]],
] as const;
const argument = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const requestedProfile = argument("profile");
assert.ok(requestedProfile && isAbsolute(requestedProfile), "Pass --profile=<fresh absolute review-expanded-* directory>");
assert.match(basename(requestedProfile), /^review-expanded-[a-zA-Z0-9_-]+$/);
const profile = join(realpathSync(dirname(requestedProfile)), basename(requestedProfile));
assert.ok(!existsSync(profile), "Preparation never reuses or overwrites an existing profile");
const appRoot = realpathSync(argument("app-root") ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../.."));
const sourceRelative = relative(appRoot, profile);
assert.ok(sourceRelative.startsWith("..") || isAbsolute(sourceRelative), "Private profile must stay outside the source checkout");
const database = join(profile, "aerynth.sqlite");
assert.equal(process.platform, "win32", "This entrypoint requires the Windows C:/D: reserve guard");
const guard = JSON.parse(execFileSync("powershell.exe", [
  "-NoProfile", "-File", join(process.env.LOCALAPPDATA!, "AeroStorageWatch", "ReserveGuard.ps1"),
  "-EstimatedCBytes", "1073741824", "-EstimatedDBytes", profile.toUpperCase().startsWith("D:") ? "1073741824" : "0",
], { encoding: "utf8", windowsHide: true, timeout: 15000 }));
assert.equal(guard.allowed, true, "Storage admission denied");
const { canonicalPaths } = createRequire(import.meta.url)("./prepared-workspaces.cjs") as { canonicalPaths: string[] };
const sourceHashes = Object.fromEntries(canonicalPaths.map((p) => [p, createHash("sha256").update(readFileSync(join(appRoot, p))).digest("hex")]));
mkdirSync(profile);
const began = Date.now(), commandCounts: Record<string, number> = {};
let core: Core | undefined, commandCount = 0;
const checkpoint = () => {
  const bytes = [database, database + "-wal", database + "-shm", database + "-journal"]
    .reduce((sum, p) => sum + (existsSync(p) ? statSync(p).size : 0), 0);
  assert.ok(bytes <= 64 * 1024 * 1024, "Preparation exceeded its 64 MiB data checkpoint");
  assert.ok(Date.now() - began < 60000, "Preparation reached its 60-second checkpoint");
  assert.ok(commandCount <= 256, "Preparation command bound exceeded");
  return bytes;
};
const call = async (name: string, input: unknown) => {
  checkpoint(); commandCount++;
  commandCounts[name] = (commandCounts[name] ?? 0) + 1;
  const result = await core!.command(name, input);
  checkpoint();
  return result;
};
const desktop = (input: Record<string, unknown>): Promise<Desktop> => call("desktop", input);
const snapshot = () => desktop({ type: "snapshot" });
const resource = (s: Desktop, id: string) => {
  const value = s.resources.find((r) => r.id === id);
  assert.ok(value, "Canonical resource is missing"); return value;
};
const block = (s: Desktop, id: string) => {
  const value = (s.navigationBlocks ?? s.blocks).find((b) => b.id === id);
  assert.ok(value, "Canonical block is missing"); return value;
};
try {
  const module = await import(pathToFileURL(join(appRoot, canonicalPaths[0])).href);
  core = new module.BackendCore({ path: database, privateRoot: profile,
    cwd: join(appRoot, "prototypes/visual-experience/cinematic-v3"),
    provider: "codex", contentPolicy: "local-private", retention: { maxEvents: 10000 } });
  assert.ok(core, "Actual BackendCore constructor returned no service");
  let state = await snapshot();
  assert.equal(state.projects.length + state.workspaces.length + state.resources.length, 0);
  const projects: string[] = [], workspaces: string[] = [], records: PreparedRecord[] = [];
  const add = async (kind: Kind, title: string, workspaceId: string, dimensions?: { width: number; height: number }): Promise<Identity> => {
    state = await snapshot();
    const response = await call("library", { name: "createBlock", input: {
      commandId: randomUUID(), workspaceId, expectedLayoutVersion: state.layoutVersion,
      kind, title, configuration: { schemaVersion: 1, textScale: 1, contentMode: "auto" },
      ...(kind === "conversation" ? { provider: "local" } : {}),
      ...(dimensions ? { presentation: dimensions } : {}),
    } });
    const created = response.result as { resourceId: string; placementId: string; workspaceId: string };
    assert.equal(created.workspaceId, workspaceId);
    return { resourceId: created.resourceId, blockId: created.placementId };
  };
  for (const [pi, [name, titles]] of names.entries()) {
    state = await desktop({ type: "createProject", title: name });
    const project = state.projects.find((p) => p.title === name)!;
    assert.ok(project); projects.push(project.id);
    for (const [wi, title] of titles.entries()) {
      state = await desktop({ type: "createWorkspace", title, projectId: project.id });
      const workspaceId = state.activeWorkspaceId!;
      assert.ok(workspaceId); workspaces.push(workspaceId);
      const items = {} as PreparedRecord["items"];
      for (const kind of ["conversation", "note", "task", "research", "reference"] as const)
        items[kind] = await add(kind, `${title} ${kind}`, workspaceId,
          kind === "note" ? { width: 330 + pi * 35, height: 230 + wi * 25 } : undefined);
      state = await snapshot();
      const note = block(state, items.note.blockId);
      state = await desktop({ type: "geometry", blockId: note.id, expectedVersion: note.version,
        placement: { x: note.x + 35 + pi * 10, y: note.y + 15 + wi * 10,
          width: note.width, height: note.height, z: note.z }, shape: note.shape });
      for (const [id, content] of [
        [items.note.resourceId, `Synthetic durable ${title} note. Stable resource identity.`],
        [items.reference.resourceId, `Synthetic link: https://example.invalid/${title.toLowerCase()}`],
      ]) state = await desktop({ type: "content", resourceId: id,
        expectedVersion: resource(state, id).version, content });
      records.push({ projectId: project.id, workspaceId, title, items });
    }
  }
  const taskGroups = [];
  for (const row of [records[0], records[2], records[4]]) {
    await desktop({ type: "navigate", target: { kind: "workspace", workspaceId: row.workspaceId } });
    await add("conversation", `${row.title} follow-up conversation`, row.workspaceId);
    const extra = await add("task", `${row.title} verification task`, row.workspaceId);
    const group = await add("task_group", `${row.title} local task group`, row.workspaceId);
    state = await snapshot();
    state = await desktop({ type: "setTaskGroupMembers", groupId: group.resourceId,
      expectedVersion: resource(state, group.resourceId).version,
      taskIds: [row.items.task.resourceId, extra.resourceId] });
    state = await desktop({ type: "taskStatus", resourceId: extra.resourceId,
      expectedVersion: resource(state, extra.resourceId).version, status: "done" });
    assert.equal(resource(state, group.resourceId).taskMembers?.filter((r) => r.status === "done").length, 1);
    await desktop({ type: "relate", sourceId: row.items.conversation.resourceId,
      targetId: row.items.note.resourceId, kind: "references" });
    taskGroups.push({ projectId: row.projectId, resourceId: group.resourceId, blockId: group.blockId,
      memberResourceIds: [row.items.task.resourceId, extra.resourceId] });
  }
  state = await desktop({ type: "navigate", target: { kind: "workspace", workspaceId: records[0].workspaceId } });
  state = await desktop({ type: "bringAllIntoView", workspaceId: records[0].workspaceId,
    bounds: { x: 24, y: 140, width: 1240, height: 760 } });
  assert.equal(state.projects.length, 3); assert.equal(state.workspaces.length, 6);
  assert.equal(state.resources.length, 39); assert.equal(state.navigationBlocks.length, 39);
  const backend = await call("snapshot", {});
  assert.deepEqual(backend.executions, {}); assert.deepEqual(backend.bindings, {});
  assert.deepEqual(backend.messageEvidence, {});
  assert.equal(backend.conversations.length, 9);
  assert.ok(backend.conversations.every((c: { providerId: string }) => c.providerId === "local"));
  const providers = backend.graph.providers as { id: string; mock: boolean }[];
  assert.ok(providers.some((p) => p.id === "codex-app-server" && p.mock === false));
  const manifest = { schema: "aerynth.expanded-setup@1", syntheticData: true,
    preparedAt: new Date().toISOString(), profile, database, sourceHashes,
    projects, workspaces, records, taskGroups, snapshot: state,
    preparation: { commandCounts, providerCommandsIssued: [], registeredProviders: providers.map(({ id, mock }) => ({ id, mock })),
      note: "The unchanged host registers an unused mock-ordinary catalog entry; every created conversation is local, with no provider execution or binding." } };
  const json = JSON.stringify(manifest, null, 2);
  assert.ok(Buffer.byteLength(json) <= 1024 * 1024, "Preparation manifest exceeds 1 MiB");
  const bytes = checkpoint();
  await core.command("close", {}); core = undefined;
  writeFileSync(join(profile, "expanded-setup.json"), json, { flag: "wx" });
  console.log(JSON.stringify({ prepared: true, profile, projects: 3, workspaces: 6, resources: 39,
    conversations: 9, databaseBytes: bytes, manifestBytes: Buffer.byteLength(json), elapsedMs: Date.now() - began }));
} catch (error) {
  writeFileSync(join(profile, "expanded-setup-failure.json"), JSON.stringify({ prepared: false,
    error: error instanceof Error ? error.stack : String(error), commandCounts }, null, 2), { flag: "wx" });
  throw error;
} finally {
  if (core) await core.command("close", {});
}
