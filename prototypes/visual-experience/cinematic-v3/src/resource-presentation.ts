import type { Resource } from "../../../application-contract/contracts.ts";
import type {
  ResourceOpeningInput,
  ResourceOpeningResult,
} from "../../../application-contract/resource-opening.ts";

type ReadyResource = Extract<ResourceOpeningResult, { status: "ready" }>;
type Bounds = { left: number; top: number; right: number; bottom: number };
type Anchor = { x: number; y: number; width: number; height: number };
type CurrentIntent = () => boolean;

export function createResourcePresenter(options: {
  remember(resource: Resource): void;
  project(
    nodeKey: string,
  ): { resourceId?: string; clippedBounds?: Bounds | null } | null | undefined;
  enqueue(action: () => Promise<void>): Promise<unknown>;
  navigate(workspaceId: string): Promise<unknown>;
  close(id: "canonical-resource" | "conversations"): void;
  focusPlacement(blockId: string): void;
  showAgent(resourceId: string): Promise<unknown>;
  showConversation(
    resourceId: string,
    messageId: string | undefined,
    current: CurrentIntent,
    anchor: Anchor | undefined,
  ): Promise<unknown>;
  showResource(resource: Resource, anchor: Anchor | undefined): void;
}) {
  return async (
    result: ReadyResource,
    input: ResourceOpeningInput,
    current: CurrentIntent,
  ) => {
    if (!current()) return;
    const { resource, placement, presentation } = result;
    options.remember(resource);

    if (presentation.mode === "existing-placement" && placement) {
      await options.enqueue(async () => {
        if (!current()) return;
        await options.navigate(placement.workspaceId);
        if (!current()) return;
        options.close("canonical-resource");
        options.close("conversations");
        options.focusPlacement(placement.blockId);
      });
      return;
    }
    if (presentation.kind === "agent") {
      await options.showAgent(resource.id);
      return;
    }

    const nodeKey = input.origin?.nodeKey;
    const projection = nodeKey ? options.project(nodeKey) : null;
    const bounds =
      projection?.resourceId === resource.id ? projection.clippedBounds : null;
    const anchor =
      bounds && bounds.right > bounds.left && bounds.bottom > bounds.top
        ? {
            x: bounds.left,
            y: bounds.top,
            width: bounds.right - bounds.left,
            height: bounds.bottom - bounds.top,
          }
        : undefined;

    if (presentation.kind === "conversation") {
      options.close("canonical-resource");
      await options.showConversation(
        resource.id,
        result.selection?.messageId,
        current,
        anchor,
      );
    } else {
      options.close("conversations");
      options.showResource(resource, anchor);
    }
  };
}
