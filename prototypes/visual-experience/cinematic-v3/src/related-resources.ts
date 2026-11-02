import type { DesktopSnapshot } from "../../../application-contract/contracts.ts";
import type {
  ResourceLinksPort,
  ResourceLinkAction,
} from "../../../block-library/resource-links.ts";

/** App queue/lifetime adapter; native graph commands retain all authority. */
export function createRelatedResourcesPort(options: {
  active(): boolean;
  enqueue<T>(action: () => Promise<T>): Promise<T>;
  flush(): Promise<void>;
  read(): Promise<DesktopSnapshot>;
  change(action: ResourceLinkAction): Promise<DesktopSnapshot>;
  openResource(resourceId: string): void;
}): ResourceLinksPort {
  const current = () => {
    if (!options.active()) throw Error("related_surface_unavailable");
  };
  return {
    capabilities: { relate: true, unrelate: true },
    read: () =>
      options.enqueue(async () => {
        current();
        const next = await options.read();
        current();
        return next;
      }),
    change: (action) =>
      options.enqueue(async () => {
        current();
        await options.flush();
        current();
        // A dispatched result is applied by the host even if the view closes.
        // A failure/unknown outcome never automatically replays this operation.
        return options.change(action);
      }),
    openResource: (resourceId) => {
      current();
      options.openResource(resourceId);
    },
  };
}
