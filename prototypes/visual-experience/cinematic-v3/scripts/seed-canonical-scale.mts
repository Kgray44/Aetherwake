import {
  mkdirSync,
  existsSync,
  writeFileSync,
  statSync,
  realpathSync,
  readFileSync,
} from "node:fs";
import { resolve, join, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { WorkspaceKernel } from "../../../workspace-kernel/kernel.mts";
import { WorkspaceEngine } from "../../../workspace-engine/engine.mts";
import { DesktopState } from "../../../integrated-backend/src/desktop.mts";

// Synthetic benchmark setup uses the exact canonical kernel and schema. It
// deliberately avoids N repeated desktop snapshots while importing N objects.
const [directory, projectsArg, resourcesArg] = process.argv.slice(2);
const projectCount = Number(projectsArg),
  resourceCount = Number(resourcesArg);
if (
  !directory ||
  !isAbsolute(directory) ||
  ![1, 3, 10].includes(projectCount) ||
  ![50, 250, 2000, 10000].includes(resourceCount)
)
  throw Error("bounded_scale_arguments_required");
const profile = resolve(directory),
  sourceRoot = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));
if (existsSync(profile)) throw Error("fresh_profile_required");
if (process.platform === "win32") {
  const bytes = 256 * 1024 * 1024;
  const guard = JSON.parse(
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-File",
        join(homedir(), "AppData/Local/AeroStorageWatch/ReserveGuard.ps1"),
        "-EstimatedCBytes",
        profile.toUpperCase().startsWith("C:") ? String(bytes) : "0",
        "-EstimatedDBytes",
        profile.toUpperCase().startsWith("D:") ? String(bytes) : "0",
      ],
      { encoding: "utf8", windowsHide: true },
    ),
  );
  if (!guard.allowed) throw Error("storage_reserve_not_admitted");
}
mkdirSync(profile, { recursive: true });
const rel = relative(realpathSync(sourceRoot), realpathSync(profile));
if (!rel.startsWith("..") && !isAbsolute(rel))
  throw Error("profile_must_be_outside_source");
const started = performance.now(),
  kernel = WorkspaceKernel.open(join(profile, "aerynth.sqlite"));
const result = {
  syntheticData: true,
  canonical: true,
  projectCount: 0,
  workspaceCount: 0,
  resourceCount: 0,
  relationshipCount: 0,
  placedCount: 0,
  databaseBytes: 0,
  seedMs: 0,
  sourceSha256: createHash("sha256")
    .update(readFileSync(fileURLToPath(import.meta.url)))
    .digest("hex"),
};
try {
  kernel.withTransaction((db) => {
    const pageSize = Number(db.prepare("PRAGMA page_size").get()!.page_size);
    if (db.prepare("PRAGMA journal_mode").get()!.journal_mode !== "delete")
      throw Error("unsupported_seed_journal");
    db.exec(
      "PRAGMA max_page_count=" + Math.floor((128 * 1024 * 1024) / pageSize),
    );
    const desktop = new DesktopState(kernel, db),
      engine = new WorkspaceEngine(kernel);
    const projects = Array.from({ length: projectCount }, (_, i) =>
      kernel.createProject("Synthetic project " + (i + 1)),
    );
    const workspaces = projects.map((p, i) => [
      engine.createWorkspace("Synthetic workspace " + (i + 1) + "A", p.id),
      engine.createWorkspace("Synthetic workspace " + (i + 1) + "B", p.id),
    ]);
    const kinds = ["note", "task", "research", "reference", "stream"],
      ids: string[] = [];
    const kind = db.prepare(
      "INSERT INTO desktop_resources(resource_id,kind) VALUES(?,?)",
    );
    for (let i = 0; i < resourceCount; i++) {
      const project = i % projects.length;
      const resource = kernel.createNote(
        "Synthetic scale " + String(i + 1).padStart(5, "0"),
        "Synthetic benchmark content " + (i + 1),
        projects[project].id,
        { origin: "system" },
      );
      kind.run(resource.id, kinds[i % kinds.length]);
      ids.push(resource.id);
      if (i > 0)
        kernel.relate(
          ids[i - 1],
          resource.id,
          i % 3 === 0 ? "depends_on" : "references",
          "imported",
          { origin: "system" },
        );
      if (i < 50) {
        const workspaceId = workspaces[project][0].workspaceId;
        engine.execute({
          commandId: randomUUID(),
          workspaceId,
          expectedRevision: engine.project(workspaceId).revision,
          type: "attachResource",
          resourceId: resource.id,
        });
      }
    }
    desktop.apply(
      {
        type: "navigate",
        target: { kind: "constellation", projectId: projects[0].id },
      },
      () => {
        throw Error("provider_not_used");
      },
    );
    const count = (table: string) =>
      Number(db.prepare("SELECT count(*) AS n FROM " + table).get()!.n);
    result.projectCount = count("projects");
    result.workspaceCount = count("workspaces");
    result.resourceCount = count("resources");
    result.placedCount = count("blocks");
    result.relationshipCount = count("relationships");
    if (
      result.projectCount !== projectCount ||
      result.workspaceCount !== 2 * projectCount ||
      result.resourceCount !== resourceCount ||
      result.placedCount !== Math.min(50, resourceCount) ||
      result.relationshipCount !== resourceCount - 1
    )
      throw Error("seed_count_mismatch");
  });
  kernel.assertIntegrity();
} finally {
  kernel.close();
}
result.databaseBytes = [
  "aerynth.sqlite",
  "aerynth.sqlite-wal",
  "aerynth.sqlite-shm",
  "aerynth.sqlite-journal",
].reduce(
  (n, file) =>
    n +
    (existsSync(join(profile, file)) ? statSync(join(profile, file)).size : 0),
  0,
);
result.seedMs = performance.now() - started;
writeFileSync(
  join(profile, "scale-seed.json"),
  JSON.stringify(result, null, 2),
  { flag: "wx" },
);
console.log(JSON.stringify(result));
