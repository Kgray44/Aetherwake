import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Backend } from "../src/service.mts";
import type {
  DesktopCommand,
  DesktopSnapshot,
} from "../../application-contract/contracts.ts";
import { previewLayout } from "../../workspace-engine/organization.mts";
import { layoutState } from "../../visual-experience/cinematic-v3/src/organization-preview.ts";

const geometry = (s: Pick<DesktopSnapshot, "blocks">) =>
  s.blocks
    .map((b) => ({
      id: b.id,
      resource: b.resource_id,
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      z: b.z,
      shape: b.shape,
      rotation: b.rotation,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
const bounds = { x: 20, y: 170, width: 1560, height: 800 };

test("trusted organization commands match noncanonical Fluid preview, fence stale layouts and persist undo/redo mode transformations", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aerynth-organization-"));
  const options = {
    path: join(dir, "state.sqlite"),
    provider: "fixture" as const,
    contentPolicy: "synthetic-only" as const,
  };
  let backend = new Backend(options);
  const call = (a: DesktopCommand) => backend.call("desktop", { bounds, ...a });
  try {
    let s = await call({
      type: "createWorkspace",
      title: "Synthetic organization",
      projectId: null,
    });
    const workspaceId = s.activeWorkspaceId!;
    assert.equal(s.organization?.mode, "fluid");
    for (const kind of [
      "conversation",
      "note",
      "task",
      "research",
      "stream",
    ] as const)
      s = await call({
        type: "createResource",
        kind,
        title: "Synthetic " + kind,
        workspaceId,
      });
    const originalResources = s.resources,
      beforePreview = JSON.stringify(s),
      first = s.blocks[0],
      neighbor = s.blocks[1];
    const request = {
      placements: [
        {
          blockId: first.id,
          expectedVersion: first.version,
          presentation: { x: neighbor.x, y: neighbor.y },
        },
      ],
      bounds,
      intent: "move" as const,
    };
    const preview = previewLayout(layoutState(s)!, request);
    assert.equal(preview.canonical, false);
    assert.equal(JSON.stringify(s), beforePreview);
    assert.deepEqual(await call({ type: "snapshot" }), s);
    s = await call({
      type: "geometry",
      blockId: first.id,
      expectedVersion: first.version,
      expectedLayoutVersion: s.layoutVersion,
      placement: { ...first, x: neighbor.x, y: neighbor.y },
      shape: first.shape,
    });
    assert.deepEqual(
      s.blocks
        .map((b) => ({
          id: b.id,
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
        }))
        .sort((a, b) => (a.id < b.id ? -1 : 1)),
      preview.blocks
        .map((b) => ({
          id: b.blockId,
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
        }))
        .sort((a, b) => (a.id < b.id ? -1 : 1)),
    );
    await assert.rejects(
      call({
        type: "geometry",
        blockId: first.id,
        expectedVersion: s.blocks.find((b) => b.id === first.id)!.version,
        expectedLayoutVersion: preview.baseRevision,
        placement: first,
        shape: first.shape,
      }),
      /CONFLICT/,
    );
    s = await call({
      type: "setOrganization",
      workspaceId,
      expectedOrganizationRevision: s.organization!.revision,
      organization: { mode: "freeform" },
    });
    const unchanged = geometry(s),
      moving = s.blocks[0],
      stationary = s.blocks[1];
    s = await call({
      type: "geometry",
      blockId: moving.id,
      expectedVersion: moving.version,
      placement: { ...moving, x: stationary.x, y: stationary.y },
      shape: moving.shape,
    });
    assert.deepEqual(
      geometry(s).find((b) => b.id === stationary.id),
      unchanged.find((b) => b.id === stationary.id),
    );
    s = await call({
      type: "layerBlock",
      blockId: moving.id,
      direction: "front",
    });
    assert.equal(s.blocks.at(-1)?.id, moving.id);
    const freeform = geometry(s),
      freePresence = s.presence,
      freeViewport = s.viewport;
    s = await call({
      type: "setOrganization",
      workspaceId,
      expectedOrganizationRevision: s.organization!.revision,
      organization: { mode: "structured", structured: { columnCount: 3 } },
    });
    assert.equal(s.organization!.mode, "structured");
    assert.deepEqual(geometry(s), freeform);
    assert.deepEqual(s.presence, freePresence);
    assert.deepEqual(s.viewport, freeViewport);
    assert.deepEqual(s.resources, originalResources);
    s = await call({
      type: "setOrganization",
      workspaceId,
      expectedOrganizationRevision: s.organization!.revision,
      organization: {
        structured: { spans: { [moving.id]: { columns: 2, rows: 3 } } },
      },
    });
    assert.equal(s.organization!.structured.spans[moving.id].columns, 2);
    assert.deepEqual(geometry(s), freeform);
    assert.deepEqual(s.viewport, freeViewport);
    s = await call({ type: "undo" });
    s = await call({ type: "undo" });
    assert.equal(s.organization!.mode, "freeform");
    assert.deepEqual(geometry(s), freeform);
    assert.deepEqual(
      { ...s.presence, version: 0 },
      { ...freePresence, version: 0 },
    );
    assert.equal(s.canRedo, true);
    await backend.close();
    backend = new Backend(options);
    s = await call({ type: "snapshot" });
    assert.equal(s.organization!.mode, "freeform");
    assert.deepEqual(geometry(s), freeform);
    assert.equal(s.canRedo, true);
    s = await call({ type: "redo" });
    assert.equal(s.organization!.mode, "structured");
    assert.deepEqual(s.resources, originalResources);
  } finally {
    await backend.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("per-workspace modes and camera recovery preserve the same canonical identities and manual geometry", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aerynth-organization-view-"));
  const backend = new Backend({
    path: join(dir, "state.sqlite"),
    provider: "fixture",
    contentPolicy: "synthetic-only",
  });
  const call = (a: DesktopCommand) => backend.call("desktop", { bounds, ...a });
  try {
    let s = await call({
      type: "createWorkspace",
      title: "Synthetic A",
      projectId: null,
    });
    const a = s.activeWorkspaceId!;
    s = await call({
      type: "createResource",
      kind: "note",
      title: "Synthetic distant note",
      workspaceId: a,
    });
    s = await call({
      type: "setOrganization",
      workspaceId: a,
      expectedOrganizationRevision: s.organization!.revision,
      organization: { mode: "freeform" },
    });
    const b = s.blocks[0];
    s = await call({
      type: "geometry",
      blockId: b.id,
      expectedVersion: b.version,
      placement: { ...b, x: 35000, y: 22000 },
      shape: b.shape,
    });
    const manual = geometry(s),
      resources = s.resources;
    s = await call({
      type: "setViewport",
      workspaceId: a,
      viewport: { x: 34000, y: 21000, zoom: 0.5 },
    });
    assert.deepEqual(geometry(s), manual);
    const v = s.viewport!;
    s = await call({
      type: "bringAllIntoView",
      workspaceId: a,
      bounds: {
        x: v.x + 20 / v.zoom,
        y: v.y + 170 / v.zoom,
        width: 1560 / v.zoom,
        height: 800 / v.zoom,
      },
    });
    assert.deepEqual(geometry(s), manual);
    assert(s.viewport!.zoom > 0 && s.viewport!.zoom <= 1);
    const fitted = s.viewport!;
    for (const item of [...s.blocks, s.presence!]) {
      assert((item.x - fitted.x) * fitted.zoom >= 19.9);
      assert((item.y - fitted.y) * fitted.zoom >= 169.9);
    }
    s = await call({
      type: "createWorkspace",
      title: "Synthetic B",
      projectId: null,
    });
    assert.equal(s.organization!.mode, "fluid");
    s = await call({
      type: "navigate",
      target: { kind: "workspace", workspaceId: a },
    });
    assert.equal(s.organization!.mode, "freeform");
    assert.deepEqual(s.viewport, fitted);
    assert.deepEqual(geometry(s), manual);
    assert.deepEqual(s.resources, resources);
  } finally {
    await backend.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
