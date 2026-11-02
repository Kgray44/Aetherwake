import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { BackendCore } from "../integrated-backend/src/core.mts";
import type { DesktopSnapshot } from "../application-contract/contracts.ts";
import type { CreatedBlock } from "./contracts.ts";

export const SCALE_COUNTS = [0, 1, 3, 10, 25, 50] as const;
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const kinds = [
  "note",
  "conversation",
  "task",
  "research",
  "reference",
  "task_group",
  "stream",
] as const;

/** Fresh, private synthetic profile for one short native scale trial. This runs
 * real Core/kernel/library/engine code, and never starts Electron or a provider. */
export async function prepareNativeScale(profile: string, count: number) {
  assert.ok(
    SCALE_COUNTS.includes(count as any),
    "Use a required count: 0, 1, 3, 10, 25 or 50",
  );
  assert.ok(
    isAbsolute(profile),
    "An absolute, new private profile path is required",
  );
  profile = resolve(profile);
  assert.ok(
    !existsSync(profile),
    "Profile must not exist: never overwrite an existing application profile",
  );
  if (process.platform === "win32") {
    // The new directory does not exist yet. Resolve its existing parent so a
    // junction/alias cannot charge a D: write to the wrong physical drive.
    const physicalProfile = join(
      realpathSync(dirname(profile)),
      basename(profile),
    );
    const onC = /^C:/i.test(physicalProfile),
      onD = /^D:/i.test(physicalProfile);
    assert.ok(
      onC || onD,
      "Reserve admission supports explicitly bounded C: or D: profiles",
    );
    const admission = JSON.parse(
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
    assert.equal(
      admission.allowed,
      true,
      "Both storage reserves must admit the bounded fixture",
    );
  }
  mkdirSync(profile);
  const path = join(profile, "aerynth.sqlite"),
    core = new BackendCore({
      path,
      privateRoot: profile,
      cwd: sourceRoot,
      provider: "codex",
      contentPolicy: "local-private",
      retention: { maxEvents: 10000 },
    });
  let closed = false;
  try {
    const empty = await core.command("desktop", { type: "snapshot" });
    assert.equal(empty.resources.length, 0);
    assert.equal(empty.workspaces.length, 0);
    let desktop = await core.command("desktop", {
      type: "createWorkspace",
      title: `Synthetic ${count}-block scale`,
      projectId: null,
    });
    const workspaceId = desktop.activeWorkspaceId!;
    let primaryBlockId: string | null = null;
    desktop = await core.command("desktop", {
      type: "setOrganization",
      workspaceId,
      expectedOrganizationRevision: desktop.organization!.revision,
      organization: { mode: "freeform" },
    });
    for (let index = 0; index < count; index++) {
      const kind = kinds[index % kinds.length];
      const created = await core.command("library", {
        name: "createBlock",
        input: {
          commandId: randomUUID(),
          workspaceId,
          expectedLayoutVersion: desktop.layoutVersion,
          kind,
          title: `Synthetic ${kind} ${index + 1}`,
          ...(kind === "conversation" ? { provider: "local" } : {}),
          presentation: {
            x: 120 + (index % 5) * 390,
            y: 240 + Math.floor(index / 5) * 290,
            width: 360,
            height: 260,
            zIndex: count - index,
            shape: "rounded",
          },
          configuration: {
            schemaVersion: 1,
            textScale: index === 0 ? 1.5 : 1,
            contentMode: "auto",
          },
        },
      });
      desktop = created.desktop!;
      if (index === 0)
        primaryBlockId = (created.result as CreatedBlock).placementId;
      if (["note", "research", "reference"].includes(kind)) {
        const resource = desktop.resources.find(
          (resource) =>
            resource.id === (created.result as CreatedBlock).resourceId,
        )!;
        desktop = await core.command("desktop", {
          type: "content",
          resourceId: resource.id,
          expectedVersion: resource.version,
          content:
            `# Synthetic ${kind}\n\n` +
            (index === 0
              ? "Synthetic scale corpus text.\n".repeat(256)
              : "Synthetic local resource content. No external retrieval or model output."),
        });
      }
      // Core bounds SQLite to 128 MiB; stop this small corpus well before that.
      assert.ok(
        statSync(path).size < 32 * 1024 * 1024,
        "Fixture exceeded its 32 MiB checkpoint; preserve it and stop",
      );
    }
    desktop = await core.command("desktop", {
      type: "setPresence",
      workspaceId,
      expectedVersion: desktop.presence!.version,
      placement: { x: 1180, y: 150 },
    });
    const alternate = await core.command("desktop", {
      type: "createWorkspace",
      title: "Synthetic empty switch target",
      projectId: null,
    });
    const alternateWorkspaceId = alternate.activeWorkspaceId!;
    desktop = await core.command("desktop", {
      type: "navigate",
      target: { kind: "workspace", workspaceId },
    });
    const execution = await core.command("snapshot", {});
    assert.equal(
      Object.keys(execution.executions).length,
      0,
      "No execution is permitted during preparation",
    );
    assert.equal(desktop.blocks.length, count);
    assert.equal(desktop.resources.length, count);
    const configurations = Object.fromEntries(
      await Promise.all(
        desktop.blocks.map(async (block) => [
          block.id,
          (
            await core.command("library", {
              name: "getBlockSettings",
              input: block.id,
            })
          ).result,
        ]),
      ),
    );
    const hashes = Object.fromEntries(
      [
        "prototypes/block-library/prepare-native-scale.mts",
        "prototypes/block-library/service.mts",
        "prototypes/integrated-backend/src/core.mts",
        "prototypes/integrated-backend/src/desktop.mts",
        "prototypes/workspace-engine/engine.mts",
      ].map((name) => [
        name,
        createHash("sha256")
          .update(readFileSync(join(sourceRoot, name)))
          .digest("hex"),
      ]),
    );
    const seed = {
      contract: "aerynth.native-block-scale@1",
      syntheticData: true,
      count,
      workspaceId,
      alternateWorkspaceId,
      primaryBlockId,
      preparation: {
        method:
          "Actual canonical Core/library/engine, no native UI and no provider calls",
        providerTransport: "codex (unstarted)",
        conversationRecords: "local",
        hashes,
      },
      expected: scaleState(desktop),
      configurations,
    };
    await core.command("close", {});
    closed = true;
    writeFileSync(
      join(profile, "block-scale-seed.json"),
      JSON.stringify(seed, null, 2) + "\n",
      { flag: "wx" },
    );
    return seed;
  } finally {
    if (!closed) await core.command("close", {}).catch(() => {});
  }
}

export function scaleState(desktop: DesktopSnapshot) {
  return {
    activeWorkspaceId: desktop.activeWorkspaceId,
    blocks: desktop.blocks,
    resources: desktop.resources,
    viewport: desktop.viewport,
    organization: desktop.organization,
    presence: desktop.presence,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const profile = process.argv
      .find((argument) => argument.startsWith("--profile="))
      ?.slice(10),
    count = process.argv
      .find((argument) => argument.startsWith("--block-count="))
      ?.slice(14);
  assert.ok(
    profile && count !== undefined && count !== "",
    "Pass --profile=<new absolute path> --block-count=<0|1|3|10|25|50>",
  );
  const seed = await prepareNativeScale(profile, Number(count));
  console.log(
    JSON.stringify({
      profile: resolve(profile),
      count: seed.count,
      workspaceId: seed.workspaceId,
      prepared: true,
      nativeRun: false,
      providerExecution: false,
    }),
  );
}
