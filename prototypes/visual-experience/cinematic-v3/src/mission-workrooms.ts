type Workroom = {
  observe(accessChanged?: boolean): void;
  setScope(scope: string | null): void;
  dispose(): void;
};

/** Owns mounted workroom views and propagates the current presentation scope. */
export function createMissionWorkrooms(document: EventTarget) {
  const views = new Set<Workroom>();
  let scope: string | null = null;

  function observe(accessChanged = false) {
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
      if (scope === next) return;
      scope = next;
      for (const view of views) view.setScope(next);
    },
    track<T extends Workroom>(view: T): T {
      views.add(view);
      return { ...view, dispose: () => release(view) };
    },
    dispose() {
      document.removeEventListener("visibilitychange", onVisibility);
      for (const view of views) release(view);
    },
  };
}
