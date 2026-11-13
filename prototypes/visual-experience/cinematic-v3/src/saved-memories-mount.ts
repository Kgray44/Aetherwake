import { createPersonalMemoryView } from "./personal-memory-view.ts";
import type { createResourceOpener } from "./resource-opening.ts";

type SavedMemoriesPorts = {
  manageMemory: Parameters<typeof createPersonalMemoryView>[0];
  openResource: ReturnType<typeof createResourceOpener>["open"];
};

export function createSavedMemoriesInspector(ports: SavedMemoriesPorts) {
  return createPersonalMemoryView(ports.manageMemory, async source => {
    const result = await ports.openResource({
      resourceId: source.conversationId,
      origin: { source: "application" },
      selection: { messageId: source.messageId },
    });
    if (result.status !== "ready") throw Error("Original message is unavailable.");
  });
}

/** Fixture entry. The caller supplies only the restricted memory and opener ports. */
export function mountSavedMemoriesFixture(root: HTMLElement, ports: SavedMemoriesPorts) {
  const inspector = createSavedMemoriesInspector(ports);
  root.replaceChildren(inspector);
  return inspector;
}
