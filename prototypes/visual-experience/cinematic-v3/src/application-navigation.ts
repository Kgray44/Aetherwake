import type { DesktopSnapshot } from "../../../application-contract/contracts.ts";
import {
  mountConstellation,
  type ConstellationViewOptions,
} from "../../../constellation/view.ts";
import { overviewChromeBottom } from "./presence-layout.ts";

const hostUiSelector =
  ".topbar,.brand,.place,.aw-workspace-layout,.scene-navigation,#settings-button,.dock,.canvas-tools,#status,.keys,.provenance,.window-drag,#vela";

/** Hosts one Constellation view for the lifetime of the connected page. */
export function createApplicationNavigation(
  universe: HTMLElement,
  wake: () => void,
  options: Omit<ConstellationViewOptions, "snapshot" | "hostUiElements" | "onDirty">,
) {
  let view: ReturnType<typeof mountConstellation> | null = null;
  let chromeBottom = 201;

  return {
    get view() {
      return view;
    },
    get overviewBarBottom() {
      return chromeBottom;
    },
    update(snapshot: DesktopSnapshot) {
      const spatialSnapshot = {
        ...snapshot,
        blocks: snapshot.navigationBlocks ?? snapshot.blocks,
      };
      if (view) {
        view.update(spatialSnapshot);
        return;
      }
      view = mountConstellation(universe, {
        ...options,
        snapshot: spatialSnapshot,
        hostUiElements: () =>
          [...universe.ownerDocument.querySelectorAll<HTMLElement>(hostUiSelector)].slice(0, 32),
        onDirty: wake,
      });
      const bar = universe.querySelector<HTMLElement>(".aw-constellation-bar")!;
      observeOverviewChrome(bar, window, (bottom) => {
        chromeBottom = bottom;
        wake();
      });
      void view.ready.then(wake);
    },
  };
}

export function observeOverviewChrome(
  bar: HTMLElement,
  page: Pick<Window, "innerWidth" | "innerHeight" | "addEventListener" | "removeEventListener">,
  changed: (bottom: number) => void,
) {
  const measure = () => {
    const rect = bar.getBoundingClientRect();
    if (rect.height > 0) changed(overviewChromeBottom(page.innerWidth, page.innerHeight, rect));
  };
  const observer = new ResizeObserver(measure);
  observer.observe(bar);
  page.addEventListener("resize", measure);
  function pageHidden(event: Event) {
    if ((event as PageTransitionEvent).persisted) return;
    observer.disconnect();
    page.removeEventListener("resize", measure);
    page.removeEventListener("pagehide", pageHidden);
  }
  page.addEventListener("pagehide", pageHidden);
}
