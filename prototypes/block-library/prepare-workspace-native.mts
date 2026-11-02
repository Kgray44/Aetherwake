import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { BackendCore } from "../integrated-backend/src/core.mts";
import {
  REGISTERED_BLOCKS,
  BLOCK_DEFAULT_SIZES,
  isSubjectBlockKind,
} from "./registry.ts";
import type {
  BlockInstanceKind,
  CreatedBlock,
  CreatedSubjectBlock,
  Presentation,
} from "./contracts.ts";
import type { DesktopSnapshot } from "../application-contract/contracts.ts";
import type { Collection } from "../conversation-product/src/contracts.ts";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export type WorkspaceNativeCase = {
  kind: BlockInstanceKind;
  workspaceId: string;
  blockId?: string;
  resourceId?: string;
  title: string;
  defaultSize: { width: number; height: number };
  defaultShape: Presentation["shape"];
};
export type WorkspaceNativeSeed = {
  contract: "aerynth.workspace-native@1";
  syntheticOnly: true;
  projectId: string;
  collectionId: string;
  memberId: string;
  taskId: string;
  cases: WorkspaceNativeCase[];
  shapeCases: (Omit<WorkspaceNativeCase, "defaultSize" | "defaultShape"> & {
    shape: "lens" | "circle" | "pill";
    size: { width: number; height: number };
  })[];
  hashes: Record<string, string>;
  expected: DesktopSnapshot;
};

/** Bounded offline preparation using the actual canonical Core. No window,
 * provider turn, fixture transport or alternate resource/layout store. */
export async function prepareWorkspaceNative(
  profile: string,
): Promise<WorkspaceNativeSeed> {
  assert(isAbsolute(profile), "absolute_new_profile_required");
  profile = resolve(profile);
  assert(
    /^review-workspace-native-/.test(basename(profile)),
    "dedicated_synthetic_profile_name_required",
  );
  assert(!existsSync(profile), "existing_profiles_must_be_preserved");
  if (process.platform === "win32") {
    const physical = join(realpathSync(dirname(profile)), basename(profile)),
      onC = /^C:/i.test(physical),
      onD = /^D:/i.test(physical);
    assert(onC || onD, "bounded_C_or_D_profile_required");
    const admitted = JSON.parse(
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-File",
          join(homedir(), "AppData/Local/AeroStorageWatch/ReserveGuard.ps1"),
          "-EstimatedCBytes",
          String(onC ? 536870912 : 16777216),
          "-EstimatedDBytes",
          String(onD ? 536870912 : 0),
        ],
        { encoding: "utf8", windowsHide: true, timeout: 15000 },
      ),
    );
    assert.equal(admitted.allowed, true, "storage_reserve_required");
  }
  mkdirSync(profile);
  const databasePath = join(profile, "aerynth.sqlite"),
    core = new BackendCore({
      path: databasePath,
      privateRoot: profile,
      cwd: sourceRoot,
      provider: "codex",
      contentPolicy: "local-private",
      retention: { maxEvents: 10000 },
    });
  let closed = false;
  try {
    const empty = await core.command("desktop", { type: "snapshot" });
    assert.equal(
      empty.resources.length + empty.workspaces.length + empty.projects.length,
      0,
      "fresh_profile_only",
    );
    let desktop = await core.command("desktop", {
      type: "createProject",
      title: "Synthetic normal-card project",
    });
    const projectId = desktop.projects[0].id;
    await core.command("conversation", {
      name: "organize",
      input: {
        type: "createCollection",
        title: "Synthetic normal-card collection",
        projectId,
      },
    });
    const collections = (await core.command("conversation", {
        name: "collections",
        input: {},
      })) as Collection[],
      collection = collections.find(
        (item) => item.title === "Synthetic normal-card collection",
      )!;
    assert(collection);
    const member = await core.command("createConversation", {
      title: "Synthetic collection member",
      providerId: "local",
      commandId: randomUUID(),
    });
    await core.command("conversation", {
      name: "organize",
      input: {
        type: "membership",
        collectionId: collection.id,
        resourceId: member.resourceId,
        member: true,
        expectedVersion: collection.version,
      },
    });
    const cases: WorkspaceNativeCase[] = [];
    let taskId = "",
      groupId = "";
    for (const definition of REGISTERED_BLOCKS) {
      desktop = await core.command("desktop", {
        type: "createWorkspace",
        title: "Synthetic normal " + definition.kind,
        projectId,
      });
      const workspaceId = desktop.activeWorkspaceId!;
      desktop = await core.command("desktop", {
        type: "setOrganization",
        workspaceId,
        expectedOrganizationRevision: desktop.organization!.revision,
        organization: { mode: "freeform" },
      });
      desktop = await core.command("desktop", {
        type: "setPresence",
        workspaceId,
        expectedVersion: desktop.presence!.version,
        placement: { x: 1120, y: 170 },
      });
      const entry: WorkspaceNativeCase = {
        kind: definition.kind,
        workspaceId,
        title: "Synthetic direct " + definition.kind,
        defaultSize: { ...BLOCK_DEFAULT_SIZES[definition.kind] },
        defaultShape: definition.defaultPresentation.shape,
      };
      // These two placements must be created by the real native Library form.
      if (definition.kind !== "note" && definition.kind !== "conversation") {
        const result = isSubjectBlockKind(definition.kind)
          ? await core.command("library", {
              name: "createSubjectBlock",
              input: {
                commandId: randomUUID(),
                workspaceId,
                expectedLayoutVersion: desktop.layoutVersion,
                kind: definition.kind,
                subject:
                  definition.kind === "project_overview"
                    ? { kind: "project", projectId }
                    : definition.kind === "collection_browser"
                      ? { kind: "collection", collectionId: collection.id }
                      : { kind: "resource-query", projectId, query: "" },
                presentation: { x: 90, y: 160 },
              },
            })
          : await core.command("library", {
              name: "createBlock",
              input: {
                commandId: randomUUID(),
                workspaceId,
                expectedLayoutVersion: desktop.layoutVersion,
                kind: definition.kind,
                title: entry.title,
                presentation: { x: 90, y: 160 },
              },
            });
        const created = result.result as CreatedBlock | CreatedSubjectBlock;
        assert.equal(typeof created.placementId, "string");
        entry.blockId = created.placementId;
        if ("resourceId" in created) entry.resourceId = created.resourceId;
        desktop = result.desktop!;
        const block = desktop.blocks.find((item) => item.id === entry.blockId)!;
        assert.deepEqual(
          { width: block.width, height: block.height },
          entry.defaultSize,
        );
        if (
          entry.resourceId &&
          ["research", "reference"].includes(definition.kind)
        ) {
          const resource = desktop.resources.find(
            (item) => item.id === entry.resourceId,
          )!;
          desktop = await core.command("desktop", {
            type: "content",
            resourceId: resource.id,
            expectedVersion: resource.version,
            content:
              "# Synthetic findings\nA user-provided source: https://example.com/normal-card\nNo external content was fetched.",
          });
        }
        if (definition.kind === "task") taskId = entry.resourceId!;
        if (definition.kind === "task_group") groupId = entry.resourceId!;
      }
      cases.push(entry);
      assert(
        statSync(databasePath).size <= 32 * 1024 * 1024,
        "prepared_database_32MiB_checkpoint_exceeded",
      );
    }
    desktop = await core.command("desktop", { type: "snapshot" });
    const group = desktop.resources.find(
      (resource) => resource.id === groupId,
    )!;
    await core.command("desktop", {
      type: "setTaskGroupMembers",
      groupId,
      expectedVersion: group.version,
      taskIds: [taskId],
    });
    const shapeCases: WorkspaceNativeSeed["shapeCases"] = [];
    for (const [shape, kind, width, height] of [
      ["lens", "research", 420, 420],
      ["circle", "reference", 420, 420],
      ["pill", "task", 520, 320],
    ] as const) {
      const resourceId = cases.find(
        (entry) => entry.kind === kind,
      )!.resourceId!;
      desktop = await core.command("desktop", {
        type: "createWorkspace",
        title: "Synthetic saved " + shape,
        projectId,
      });
      const workspaceId = desktop.activeWorkspaceId!;
      desktop = await core.command("desktop", {
        type: "setOrganization",
        workspaceId,
        expectedOrganizationRevision: desktop.organization!.revision,
        organization: { mode: "freeform" },
      });
      desktop = await core.command("desktop", {
        type: "setPresence",
        workspaceId,
        expectedVersion: desktop.presence!.version,
        placement: { x: 1120, y: 170 },
      });
      const current = desktop.resources.find(
        (resource) => resource.id === resourceId,
      )!;
      const attached = await core.command("library", {
        name: "attachBlock",
        input: {
          commandId: randomUUID(),
          workspaceId,
          expectedLayoutVersion: desktop.layoutVersion,
          resourceId,
          kind,
          expectedResourceVersion: current.version,
          presentation: { shape, width, height, x: 90, y: 160 },
        },
      });
      const blockId = (attached.result as CreatedBlock).placementId;
      desktop = attached.desktop!;
      assert.equal(
        desktop.blocks.find((block) => block.id === blockId)!.shape,
        shape,
      );
      shapeCases.push({
        kind,
        shape,
        size: { width, height },
        workspaceId,
        resourceId,
        blockId,
        title: "Synthetic explicit saved " + shape,
      });
      assert(
        statSync(databasePath).size <= 32 * 1024 * 1024,
        "prepared_database_32MiB_checkpoint_exceeded",
      );
    }
    desktop = await core.command("desktop", {
      type: "navigate",
      target: {
        kind: "workspace",
        workspaceId: cases.find((item) => item.kind === "note")!.workspaceId,
      },
    });
    assert.equal(
      Object.keys((await core.command("snapshot", {})).executions).length,
      0,
    );
    const hashes = Object.fromEntries(
      [
        "prototypes/block-library/prepare-workspace-native.mts",
        "prototypes/block-library/registry.ts",
        "prototypes/block-library/service.mts",
        "prototypes/integrated-backend/src/core.mts",
        "prototypes/workspace-engine/engine.mts",
      ].map((name) => [
        name,
        createHash("sha256")
          .update(readFileSync(join(sourceRoot, name)))
          .digest("hex"),
      ]),
    );
    const seed: WorkspaceNativeSeed = {
      contract: "aerynth.workspace-native@1",
      syntheticOnly: true,
      projectId,
      collectionId: collection.id,
      memberId: member.resourceId,
      taskId,
      cases,
      shapeCases,
      hashes,
      expected: desktop,
    };
    const json = JSON.stringify(seed, null, 2);
    assert(
      Buffer.byteLength(json) <= 256 * 1024,
      "prepared_metadata_256KiB_exceeded",
    );
    await core.command("close", {});
    closed = true;
    writeFileSync(join(profile, "workspace-native-seed.json"), json, {
      flag: "wx",
    });
    return seed;
  } finally {
    if (!closed) await core.command("close", {}).catch(() => {});
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const profile = process.argv
    .find((arg) => arg.startsWith("--profile="))
    ?.slice(10);
  assert(profile, "pass_profile_with_new_absolute_path");
  const seed = await prepareWorkspaceNative(profile);
  process.stdout.write(
    JSON.stringify({
      prepared: true,
      nativeRun: false,
      providerExecution: false,
      cases: seed.cases.length,
      explicitShapes: seed.shapeCases.length,
    }) + "\n",
  );
}
