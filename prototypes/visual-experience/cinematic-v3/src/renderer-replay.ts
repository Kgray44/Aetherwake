import type { StreamEvent } from "../../../integrated-backend/src/contracts.mts";

export type RendererEventPage = {
  events: StreamEvent[];
  earliest: number | null;
  latest: number;
  scannedThrough: number;
  truncated: boolean;
  scope: string;
};

type ReplayInput = { after?: number; limit: number; recent?: boolean };
type ReplayOutcome =
  | { status: "current" | "more"; cursor: number }
  | { status: "obsolete" }
  | { status: "rebase"; gap: boolean };

const WINDOW = 250;
const MAX_PAGES = 12;

export function rendererResourceAccessChanged(type: string) {
  return /^(?:policy[./]|application\/(?:archiveSubject|archiveWorkspace)$|source\/(?:revoked|unavailable)$)/.test(type);
}

export function rendererAccessChanged(type: string) {
  return rendererResourceAccessChanged(type) ||
    type === "vela.api/usage-authorization" || type === "provider/connection";
}

/** Only a scoped replay page can advance the scan. History seeds presentation. */
export async function reconcileRendererReplay(options: {
  scope: string;
  after: number;
  seed: boolean;
  read(input: ReplayInput): Promise<RendererEventPage>;
  current(): boolean;
  accept(page: RendererEventPage, history: boolean): void;
}): Promise<ReplayOutcome> {
  let cursor = options.after;
  if (options.seed) {
    const history = await options.read({ recent: true, limit: WINDOW });
    if (!options.current()) return { status: "obsolete" };
    if (history.scope !== options.scope || history.latest < cursor) return { status: "rebase", gap: history.latest < cursor };
    options.accept({ ...history, events: history.events.filter(event => event.cursor <= cursor) }, true);
  }
  for (let index = 0; index < MAX_PAGES; index++) {
    const page = await options.read({ after: cursor, limit: WINDOW });
    if (!options.current()) return { status: "obsolete" };
    if (page.scope !== options.scope || page.truncated || page.latest < cursor)
      return { status: "rebase", gap: page.truncated || page.latest < cursor };
    if (!Number.isSafeInteger(page.scannedThrough) || page.scannedThrough < cursor ||
        page.scannedThrough > page.latest ||
        page.scannedThrough === cursor && page.latest > cursor ||
        page.events.some(event => !Number.isSafeInteger(event.cursor) ||
          event.cursor <= cursor || event.cursor > page.scannedThrough))
      throw Error("invalid_renderer_event_page");
    options.accept(page, false);
    if (!options.current()) return { status: "obsolete" };
    cursor = page.scannedThrough;
    if (cursor === page.latest) return { status: "current", cursor };
  }
  return { status: "more", cursor };
}
