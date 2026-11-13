type Renderer = { dispose(): void; contextLost?(): void };
type Change = "unavailable" | "interrupted" | "restored";

/** Owns the renderer instance. The application owns the spatial layer. */
export function mountRendererLifecycle<T extends Renderer>({
  canvas,
  page,
  create,
  changed,
  failed,
}: {
  canvas: EventTarget;
  page: EventTarget;
  create(): T;
  changed(change: Change): void;
  failed(error: unknown): void;
}) {
  let current: T | null = null;
  let graphicsFailed = false;

  function release() {
    const renderer = current;
    current = null;
    renderer?.dispose();
  }

  function contextLost(event: Event) {
    event.preventDefault();
    graphicsFailed = true;
    current?.contextLost?.();
    changed("interrupted");
  }

  function contextRestored() {
    try {
      release();
      current = create();
    } catch (error) {
      graphicsFailed = true;
      failed(error);
      return;
    }
    graphicsFailed = false;
    changed("restored");
  }

  function pageHidden(event: Event) {
    if ((event as PageTransitionEvent).persisted) return;
    canvas.removeEventListener("webglcontextlost", contextLost);
    canvas.removeEventListener("webglcontextrestored", contextRestored);
    page.removeEventListener("pagehide", pageHidden);
    release();
  }

  try {
    current = create();
  } catch (error) {
    graphicsFailed = true;
    failed(error);
    changed("unavailable");
  }
  canvas.addEventListener("webglcontextlost", contextLost);
  canvas.addEventListener("webglcontextrestored", contextRestored);
  page.addEventListener("pagehide", pageHidden);
  return {
    get current() {
      return current;
    },
    get graphicsFailed() {
      return graphicsFailed;
    },
  };
}
