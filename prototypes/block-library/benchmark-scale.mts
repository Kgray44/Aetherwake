import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { BackendCore } from "../integrated-backend/src/core.mts";
import type {
  LibraryMethod,
  LibraryRequest,
} from "../integrated-backend/src/contracts.mts";
import type { DesktopSnapshot } from "../application-contract/contracts.ts";
import type {
  WorkspaceTemplate,
  AppliedTemplate,
  TemplatePreview,
} from "./contracts.ts";
import { captureWorkspaceTemplate } from "./model.ts";
import {
  REGISTERED_BLOCKS,
  resolveBlockType,
  searchBlockCatalog,
} from "./registry.ts";

const outputArg = process.argv.find((value) => value.startsWith("--output="));
assert.ok(
  outputArg,
  "Pass --output=<private report path>; fixtures are synthetic, bounded and retained outside the repository.",
);
const output = resolve(outputArg.slice(9)),
  sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
  fixtureRoot = mkdtempSync(join(tmpdir(), "aerynth-block-scale-")),
  fixtures: { count: number; trial: number; path: string }[] = [],
  samples: any[] = [];
const source = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: sourceRoot,
  encoding: "utf8",
}).trim();
const sourceFiles = [
  "benchmark-scale.mts",
  "service.mts",
  "model.ts",
  "registry.ts",
  "canonical-host.mts",
  "../integrated-backend/src/desktop.mts",
  "../integrated-backend/src/core.mts",
  "../workspace-engine/engine.mts",
];
const hashes = Object.fromEntries(
  sourceFiles.map((name) => [
    name,
    createHash("sha256")
      .update(readFileSync(new URL(name, import.meta.url)))
      .digest("hex"),
  ]),
);
const measure = async <T,>(work: () => Promise<T> | T) => {
  const start = performance.now(),
    value = await work();
  return { value, ms: performance.now() - start };
};
function bytes(path: string) {
  return [path, path + "-wal", path + "-shm"].reduce(
    (total, file) => total + (existsSync(file) ? statSync(file).size : 0),
    0,
  );
}
function checkpoint(path: string) {
  assert.ok(
    bytes(path) < 112 * 1024 * 1024,
    "Synthetic fixture reached its 112 MiB checkpoint; stop before the 128 MiB allocation bound.",
  );
}
const digest = (snapshot: DesktopSnapshot) =>
  snapshot.blocks.map((block) => ({
    id: block.id,
    resourceId: block.resource_id,
    subject: block.subject,
    x: block.x,
    y: block.y,
    width: block.width,
    height: block.height,
    shape: block.shape,
    z: block.z,
  }));

for (const count of [0, 1, 3, 10, 25, 50])
  for (let trial = 1; trial <= 3; trial++) {
    const directory = join(fixtureRoot, `count-${count}-trial-${trial}`);
    mkdirSync(directory);
    const path = join(directory, "synthetic.sqlite");
    fixtures.push({ count, trial, path });
    let core = new BackendCore({
      path,
      provider: "fixture",
      contentPolicy: "synthetic-only",
    });
    let coreOpen = true;
    const invoke = async <T,>(name: LibraryMethod, input: unknown = {}) =>
      (await core.command("library", { name, input } as LibraryRequest))
        .result as T;
    const metrics: Record<string, number | null> = {},
      before = process.memoryUsage();
    try {
      const blank = await core.command("desktop", {
          type: "createWorkspace",
          title: "Synthetic measured source",
          projectId: null,
        }),
        workspaceId = blank.activeWorkspaceId!;
      await core.command("desktop", {
        type: "setOrganization",
        workspaceId,
        expectedOrganizationRevision: blank.organization!.revision,
        organization: { mode: "freeform" },
      });
      let desktop = await core.command("desktop", { type: "snapshot" });
      const caps = await invoke<any>("capabilities");
      let checksum = 0;
      const lookup = await measure(() => {
        for (let i = 0; i < 1000; i++)
          checksum +=
            resolveBlockType(
              REGISTERED_BLOCKS[i % REGISTERED_BLOCKS.length].id,
              1,
            ).manifest?.version ?? 0;
      });
      metrics.registryLookup1000Ms = lookup.ms;
      const search = await measure(() => {
        for (let i = 0; i < 1000; i++)
          checksum += searchBlockCatalog(
            i % 2 ? "canonical" : "note",
            caps,
          ).length;
      });
      metrics.librarySearch1000Ms = search.ms;
      const creation = await measure(async () => {
        for (let i = 0; i < count; i++) {
          const response = await core.command("library", {
            name: "createBlock",
            input: {
              commandId: randomUUID(),
              workspaceId,
              expectedLayoutVersion: desktop.layoutVersion,
              kind: "note",
              title: `Synthetic note ${i}`,
              configuration: {
                schemaVersion: 1,
                textScale: i % 2 ? 1.25 : 1,
                contentMode: "auto",
              },
            },
          });
          desktop = response.desktop!;
          checkpoint(path);
        }
      });
      metrics.blockCreationTotalMs = creation.ms;
      metrics.blockCreationMeanMs = count ? creation.ms / count : null;
      assert.equal(desktop.blocks.length, count);
      const configurations = Object.fromEntries(
        await Promise.all(
          desktop.blocks.map(async (block) => [
            block.id,
            (await invoke<any>("getBlockSettings", block.id)).configuration,
          ]),
        ),
      );
      const capture = await measure(() =>
        captureWorkspaceTemplate(
          desktop,
          Object.fromEntries(
            desktop.resources.map((resource) => [resource.id, "reference"]),
          ),
          configurations,
        ),
      );
      metrics.templateCaptureMs = capture.ms;
      const saved = await invoke<WorkspaceTemplate>("saveTemplate", {
        name: "Synthetic measured template",
        description: "Synthetic operation-scale fixture",
        tags: ["synthetic"],
        body: capture.value,
      });
      const input = {
        commandId: randomUUID(),
        templateId: saved.id,
        expectedVersion: saved.version,
        title: "Synthetic measured target",
        projectId: null,
      };
      const preview = await measure(() =>
        invoke<TemplatePreview>("previewTemplate", input),
      );
      metrics.templatePreviewMs = preview.ms;
      assert.equal(preview.value.placementCount, count);
      assert.equal(preview.value.referenceCount, count);
      checkpoint(path);
      const applied = await measure(() =>
        core.command("library", { name: "applyTemplate", input }),
      );
      metrics.templateInstantiationMs = applied.ms;
      desktop = applied.value.desktop!;
      assert.equal(desktop.blocks.length, count);
      assert.deepEqual(
        desktop.blocks.map((block) => block.resource_id).sort(),
        capture.value.resources
          .map((role) =>
            role.source.mode === "reference" ? role.source.resourceId : null,
          )
          .sort(),
      );
      assert.equal(
        desktop.resources.filter((resource) => resource.kind === "note").length,
        count,
      );
      const targetId = desktop.activeWorkspaceId!;
      const switching = await measure(async () => {
        for (let i = 0; i < 5; i++) {
          await core.command("desktop", {
            type: "navigate",
            target: { kind: "workspace", workspaceId },
          });
          desktop = await core.command("desktop", {
            type: "navigate",
            target: { kind: "workspace", workspaceId: targetId },
          });
        }
      });
      metrics.workspaceSwitch10CommandsMs = switching.ms;
      metrics.geometryCommit10CommandsMs = null;
      if (count) {
        const resizing = await measure(async () => {
          for (let i = 0; i < 10; i++) {
            const block = desktop.blocks[0];
            desktop = await core.command("desktop", {
              type: "geometry",
              blockId: block.id,
              expectedVersion: block.version,
              expectedLayoutVersion: desktop.layoutVersion,
              placement: {
                x: block.x,
                y: block.y,
                width: block.width + (i % 2 ? -1 : 1),
                height: block.height,
                z: block.z,
              },
              shape: block.shape,
            });
          }
        });
        metrics.geometryCommit10CommandsMs = resizing.ms;
      }
      checkpoint(path);
      const expected = digest(desktop),
        expectedViewport = desktop.viewport,
        expectedOrganization = desktop.organization,
        expectedPresence = desktop.presence;
      assert.equal(
        Object.keys((await core.command("snapshot", {})).executions).length,
        0,
      );
      await core.command("close", {});
      coreOpen = false;
      const restoration = await measure(async () => {
        core = new BackendCore({
          path,
          provider: "fixture",
          contentPolicy: "synthetic-only",
        });
        coreOpen = true;
        return core.command("desktop", { type: "snapshot" });
      });
      metrics.sqliteReopenAndProjectionMs = restoration.ms;
      assert.deepEqual(digest(restoration.value), expected);
      assert.deepEqual(restoration.value.viewport, expectedViewport);
      assert.deepEqual(restoration.value.organization, expectedOrganization);
      assert.deepEqual(restoration.value.presence, expectedPresence);
      const ids = (applied.value.result as AppliedTemplate).placementIds;
      for (const role of capture.value.placements) {
        const config = await invoke<any>("getBlockSettings", ids[role.key]);
        assert.deepEqual(config.configuration, role.configuration);
      }
      const after = process.memoryUsage();
      samples.push({
        count,
        trial,
        metrics,
        checksum,
        nodeHeapUsedBeforeBytes: before.heapUsed,
        nodeHeapUsedAfterBytes: after.heapUsed,
        nodeRssAfterBytes: after.rss,
        checks: {
          resourceIdentity: true,
          placementCount: true,
          exactTemplatePreferences: true,
          exactOrganization: true,
          exactPresence: true,
          exactRestoredGeometry: true,
          exactRestoredViewport: true,
          noProviderExecution: true,
        },
      });
    } finally {
      if (coreOpen) await core.command("close", {});
    }
    samples.at(-1).fixtureBytes = bytes(path);
  }
const report = {
  schemaVersion: 1,
  kind: "synthetic-direct-core-operation-sample",
  source,
  sourceHashes: hashes,
  executedAt: new Date().toISOString(),
  runtime: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  },
  method: {
    counts: [0, 1, 3, 10, 25, 50],
    trials: 3,
    registryAndSearchIterations: 1000,
    workspaceSwitchCommands: 10,
    geometryCommands: 10,
    provider: "synthetic fixture; no turn or connection",
    storage:
      "One retained SQLite fixture per sample; same-process close/reopen",
    sourcePath:
      "Direct BackendCore public commands and released canonical library",
    units: "Elapsed milliseconds; process memory bytes",
  },
  limitations: [
    "No native window or renderer ran.",
    "No displayed-frame, GPU, idle, focus-transition, hidden-view or input-latency measurement.",
    "Same-process SQLite restoration is not an operating-system or native desktop restart.",
    "Process memory samples include module caches and uncontrolled garbage collection; they are not a leak verdict.",
    "Three diagnostic trials do not establish exclusive host performance or framework acceptance.",
  ],
  samples,
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
writeFileSync(
  output + ".fixtures.json",
  JSON.stringify({ fixtureRoot, fixtures }, null, 2) + "\n",
);
process.stdout.write(
  JSON.stringify({
    report: output,
    samples: samples.length,
    fixtureBytes: samples.reduce(
      (total, sample) => total + sample.fixtureBytes,
      0,
    ),
    fixturesRetained: true,
  }) + "\n",
);
