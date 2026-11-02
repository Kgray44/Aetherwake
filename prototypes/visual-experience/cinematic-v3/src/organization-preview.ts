import type {
  DesktopSnapshot,
  Block,
} from "../../../application-contract/contracts.ts";
import type {
  BlockProjection,
  LayoutState,
} from "../../../workspace-engine/contracts.mts";

/** Structural adapter only: the canonical engine owns policy and geometry. */
export function layoutState(
  snapshot: DesktopSnapshot,
): LayoutState | undefined {
  if (
    !snapshot.activeWorkspaceId ||
    !snapshot.organization ||
    !snapshot.presence
  )
    return;
  return {
    revision: snapshot.layoutVersion,
    viewport: snapshot.viewport ?? { x: 0, y: 0, zoom: 1 },
    organization: snapshot.organization,
    presence: snapshot.presence,
    blocks: snapshot.blocks.map((b) => ({
      blockId: b.id,
      resourceId: b.resource_id,
      workspaceId: b.workspace_id,
      version: b.version,
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      zIndex: b.z,
      shape: b.shape,
      rotation: b.rotation ?? 0,
      minimized: b.minimized ?? false,
      locked: b.locked ?? false,
      materialVariant: b.materialVariant ?? "default",
      contentMode: b.contentMode ?? "reading",
      resourceState:
        snapshot.resources.find((r) => r.id === b.resource_id)?.state ??
        "active",
    })),
  };
}
export function previewBlock(block: BlockProjection): Block {
  return {
    id: block.blockId,
    resource_id: block.resourceId,
    workspace_id: block.workspaceId,
    version: block.version,
    x: block.x,
    y: block.y,
    width: block.width,
    height: block.height,
    z: block.zIndex,
    shape: block.shape,
    rotation: block.rotation,
    minimized: block.minimized,
    locked: block.locked,
    materialVariant: block.materialVariant,
    contentMode: block.contentMode,
  };
}
