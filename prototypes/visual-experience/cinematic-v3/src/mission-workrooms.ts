type Workroom = {
  observe(accessChanged?: boolean): void;
  setScope(scope: string | null): void;
  disconnect(): void;
  dispose(): void;
};

/** Owns mounted workroom views and propagates the current presentation scope. */
export function createMissionWorkrooms(document: EventTarget) {
  const views = new Set<Workroom>();
  let scope: string | null = null;
  let disconnected = false;

  function observe(accessChanged = false) {
    if (disconnected) return;
    for (const view of views) view.observe(accessChanged);
  }

  const onVisibility = () => observe();
  document.addEventListener("visibilitychange", onVisibility);

  function release(view: Workroom) {
    if (views.delete(view)) view.dispose();
  }

  return {
    get scope() {
      return scope;
    },
    observe,
    setScope(next: string | null) {
      if (disconnected || scope === next) return;
      scope = next;
      for (const view of views) view.setScope(next);
    },
    track<T extends Workroom>(view: T): T {
      views.add(view);
      if (disconnected) view.disconnect();
      return { ...view, dispose: () => release(view) };
    },
    disconnect() {
      if (disconnected) return;
      disconnected = true;
      scope = null;
      for (const view of views) view.disconnect();
    },
    dispose() {
      document.removeEventListener("visibilitychange", onVisibility);
      for (const view of views) release(view);
    },
  };
}
