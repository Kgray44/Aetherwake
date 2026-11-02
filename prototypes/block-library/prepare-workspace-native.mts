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
import { createRequire } from "node:module";
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
import type { NoteDocument } from './note-contracts.ts';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
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
  approachValidation: { preflightSha256: string; expressionHelperSha256: string; commonHelperSha256: string };
  minimizeValidation: { preflightSha256: string; helperSha256: string; expressionHelperSha256: string; commonHelperSha256: string };
  relatedValidation?: { preflightSha256: string; helperSha256: string; expressionHelperSha256: string; commonHelperSha256: string };
  structuredGridValidation?: { preflightSha256: string; helperSha256: string; expressionHelperSha256: string; commonHelperSha256: string };
  structuredGridCase?: { workspaceId: string; movingBlockId: string; document: NoteDocument };
  relatedCase?: {
    note: { workspaceId: string; blockId: string; resourceId: string; title: string };
    task: { resourceId: string; title: string; placements: { workspaceId: string; blockId: string }[] };
    browser: { workspaceId: string; blockId: string };
    documents: Record<string, NoteDocument>;
    workspaces: Record<string, Pick<DesktopSnapshot, 'blocks' | 'viewport' | 'organization' | 'presence'>>;
  };
};

/** Bounded offline preparation using the actual canonical Core. No window,
 * provider turn, fixture transport or alternate resource/layout store. */
export async function prepareWorkspaceNative(
  profile: string,
  options: { relatedResources?: boolean; structuredGrid?: boolean } = {},
): Promise<WorkspaceNativeSeed> {
  assert(options && typeof options === 'object' && Object.keys(options).every(key => ['relatedResources', 'structuredGrid'].includes(key)) && Object.values(options).every(value => value === undefined || typeof value === 'boolean') && !(options.relatedResources && options.structuredGrid), 'invalid_preparation_options');
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
  // Pure compilation only, before profile allocation or provider construction.
  const approachPreflight = require('./tests/workspace-approach-expressions.cjs').preflight();
  const expressionDigest = (name: string) => createHash('sha256').update(readFileSync(join(sourceRoot, 'prototypes/block-library/tests', name))).digest('hex');
  const approachValidation = { preflightSha256: approachPreflight.sha256, expressionHelperSha256: expressionDigest('workspace-approach-expressions.cjs'), commonHelperSha256: expressionDigest('library-native-expressions.cjs') };
  const minimizePreflight = require('./tests/workspace-minimize-expressions.cjs').preflight();
  const minimizeValidation = { preflightSha256: minimizePreflight.sha256, helperSha256: expressionDigest('workspace-minimize.cjs'), expressionHelperSha256: expressionDigest('workspace-minimize-expressions.cjs'), commonHelperSha256: expressionDigest('workspace-approach-expressions.cjs') };
  const relatedValidation = options.relatedResources ? { preflightSha256: require('./tests/workspace-resource-links-expressions.cjs').preflight().sha256, helperSha256: expressionDigest('workspace-resource-links.cjs'), expressionHelperSha256: expressionDigest('workspace-resource-links-expressions.cjs'), commonHelperSha256: expressionDigest('workspace-approach-expressions.cjs') } : undefined;
  const structuredGridValidation = options.structuredGrid ? { preflightSha256: require('./tests/workspace-structured-grid-expressions.cjs').preflight().sha256, helperSha256: expressionDigest('workspace-structured-grid.cjs'), expressionHelperSha256: expressionDigest('workspace-structured-grid-expressions.cjs'), commonHelperSha256: expressionDigest('library-native-expressions.cjs') } : undefined;
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
      // Ordinary modes create Note/Chat through the native Library. The explicit
      // relationship fixture needs a preexisting Note recovery draft instead.
      if (definition.kind !== "conversation" && (definition.kind !== "note" || options.relatedResources || options.structuredGrid)) {
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
    let relatedCase: WorkspaceNativeSeed['relatedCase'];
    if (options.relatedResources) {
      const note = cases.find(entry => entry.kind === 'note')!, browser = cases.find(entry => entry.kind === 'resource_browser')!;
      assert(note.blockId && note.resourceId && browser.blockId);
      const documents: Record<string, NoteDocument> = {};
      for (const [id, label] of [[note.resourceId, 'Note'], [taskId, 'Task']] as const) {
        const current = desktop.resources.find(resource => resource.id === id)!;
        desktop = await core.command('desktop', { type: 'content', resourceId: id, expectedVersion: current.version, content: 'Synthetic canonical ' + label + ' text. Related-resource reads must not change this.' });
        const version = desktop.resources.find(resource => resource.id === id)!.version;
        await core.command('notes', { name: 'saveNoteDraft', input: { resourceId: id, expectedDraftVersion: 0, baseResourceVersion: version, content: 'Synthetic separate unsaved ' + label + ' recovery. This is not canonical content.' } });
        documents[id] = (await core.command('notes', { name: 'readNote', input: id })).result as NoteDocument;
        assert(documents[id].draft && documents[id].draft!.content !== documents[id].resource.content);
      }
      const placements = (desktop.navigationBlocks ?? []).filter(block => block.resource_id === taskId).map(block => ({ workspaceId: block.workspace_id, blockId: block.id }));
      assert.equal(placements.length, 2);
      const workspaces: NonNullable<WorkspaceNativeSeed['relatedCase']>['workspaces'] = {};
      for (const workspaceId of new Set([note.workspaceId, browser.workspaceId, ...placements.map(p => p.workspaceId)])) {
        desktop = await core.command('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId } });
        desktop = await core.command('desktop', { type: 'setViewport', workspaceId, viewport: { x: 0, y: -100, zoom: 1 } });
        workspaces[workspaceId] = { blocks: desktop.blocks, viewport: desktop.viewport, organization: desktop.organization, presence: desktop.presence };
      }
      relatedCase = { note: { workspaceId: note.workspaceId, blockId: note.blockId, resourceId: note.resourceId, title: note.title }, task: { resourceId: taskId, title: cases.find(entry => entry.kind === 'task')!.title, placements }, browser: { workspaceId: browser.workspaceId, blockId: browser.blockId }, documents, workspaces };
    }
    let structuredGridCase: WorkspaceNativeSeed['structuredGridCase'];
    if (options.structuredGrid) {
      const note = cases.find(entry => entry.kind === 'note')!, workspaceId = note.workspaceId;
      assert(note.blockId && note.resourceId);
      desktop = await core.command('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId } });
      for (const [kind, shape, x, y, width, height, z] of [
        ['note', 'folio', 77, 303, 367, 291, 7],
        ['task', 'pill', 623, 315, 351, 177, -2],
        ['reference', 'circle', 1077, 357, 251, 251, 3],
      ] as const) {
        const entry = cases.find(entry => entry.kind === kind)!; assert(entry.resourceId);
        let blockId = entry.blockId!;
        if (kind !== 'note') {
          const current = desktop.resources.find(resource => resource.id === entry.resourceId)!;
          const attached = await core.command('library', { name: 'attachBlock', input: { commandId: randomUUID(), workspaceId, expectedLayoutVersion: desktop.layoutVersion, resourceId: entry.resourceId, expectedResourceVersion: current.version, kind, presentation: { shape, width, height } } });
          desktop = attached.desktop!; blockId = (attached.result as CreatedBlock).placementId;
        }
        const block = desktop.blocks.find(block => block.id === blockId)!;
        desktop = await core.command('desktop', { type: 'geometry', blockId, expectedVersion: block.version, placement: { x, y, width, height, z }, shape });
      }
      const noteResource = desktop.resources.find(resource => resource.id === note.resourceId)!;
      desktop = await core.command('desktop', { type: 'content', resourceId: note.resourceId, expectedVersion: noteResource.version, content: 'Synthetic grid Note. Mode selection and direct geometry gestures preserve this exact content.' });
      desktop = await core.command('desktop', { type: 'setPresence', workspaceId, expectedVersion: desktop.presence!.version, placement: { x: 1505, y: 337 } });
      desktop = await core.command('desktop', { type: 'setViewport', workspaceId, viewport: { x: -37, y: -75, zoom: 0.9 } });
      const document = (await core.command('notes', { name: 'readNote', input: note.resourceId })).result as NoteDocument;
      assert.equal(document.draft, null); assert.equal(desktop.blocks.length, 3);
      structuredGridCase = { workspaceId, movingBlockId: note.blockId, document };
      assert(statSync(databasePath).size <= 32 * 1024 * 1024, 'prepared_database_32MiB_checkpoint_exceeded');
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
        ...(options.structuredGrid ? ['prototypes/workspace-engine/organization.mts', 'prototypes/workspace-engine/structured-grid.mts'] : []),
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
      approachValidation,
      minimizeValidation,
      ...(relatedValidation ? { relatedValidation, relatedCase } : {}),
      ...(structuredGridValidation ? { structuredGridValidation, structuredGridCase } : {}),
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
  const seed = await prepareWorkspaceNative(profile, { relatedResources: process.argv.includes('--related-resources'), structuredGrid: process.argv.includes('--structured-grid') });
  process.stdout.write(
    JSON.stringify({
      prepared: true,
      nativeRun: false,
      providerExecution: false,
      cases: seed.cases.length,
      explicitShapes: seed.shapeCases.length,
      relatedResources: !!seed.relatedCase,
      structuredGrid: !!seed.structuredGridCase,
    }) + "\n",
  );
}
