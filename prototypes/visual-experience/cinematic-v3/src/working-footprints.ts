import type { BlockInstanceKind } from "../../../block-library/contracts.ts";
import { blockComposition } from "../../../block-library/presentation-policy.ts";

/** The full projected card is an upper bound on the usable editor body.
 * ResizeObserver still supplies the actual body measurement for card layout. */
export function workspaceBodyEligible(
  kind: BlockInstanceKind,
  textScale: number,
  projected: { w: number; h: number },
  target: { w: number; h: number },
  active: boolean,
) {
  const fits = ({ w, h }: { w: number; h: number }) =>
    blockComposition(kind, {
      width: w, height: h, bodyWidth: w, bodyHeight: h, textScale,
    }) === "working";
  // A newly exposed card headed for an overview can stay lightweight during
  // the glide. Retained editors continue to follow their actual footprint.
  return fits(projected) && (active || fits(target));
}

type Size = { width: number; height: number };
type Observer = Pick<ResizeObserver, "observe" | "unobserve" | "disconnect">;
type Observe = (
  read: (entries: readonly ResizeObserverEntry[]) => void,
) => Observer;

/** One shared observer. Delivery caches actual content boxes and wakes the
 * existing coordinator; DOM mutation and composition happen in its frame. */
export function createWorkingFootprints(
  wake: () => void,
  observe: Observe = (read) => new ResizeObserver(read),
) {
  const nodes = new Map<string, Element>();
  const ids = new WeakMap<Element, string>();
  const visible = new Set<string>();
  const sizes = new Map<string, Size>();
  let disposed = false;
  const observer = observe((entries) => {
    if (disposed) return;
    let changed = false;
    for (const entry of entries) {
      const id = ids.get(entry.target);
      if (!id || nodes.get(id) !== entry.target || !visible.has(id)) continue;
      const { width, height } = entry.contentRect;
      if (
        ![width, height].every((value) => Number.isFinite(value) && value >= 0)
      )
        continue;
      const prior = sizes.get(id);
      if (prior?.width === width && prior.height === height) continue;
      sizes.set(id, { width, height });
      changed = true;
    }
    if (changed) wake();
  });
  function release(id: string) {
    const node = nodes.get(id);
    if (node) {
      observer.unobserve(node);
      ids.delete(node);
    }
    nodes.delete(id);
    visible.delete(id);
    sizes.delete(id);
  }
  return {
    track(id: string, node: Element) {
      if (disposed || nodes.get(id) === node) return;
      release(id);
      nodes.set(id, node);
      ids.set(node, id);
      observer.observe(node);
    },
    setVisible(id: string, value: boolean) {
      if (disposed || !nodes.has(id) || visible.has(id) === value) return;
      sizes.delete(id);
      if (value) {
        visible.add(id);
        // Re-observing requests a genuine fresh delivery, even if revealing a
        // previously hidden card did not change its retained body's size.
        const node = nodes.get(id)!;
        observer.unobserve(node);
        observer.observe(node);
      } else visible.delete(id);
    },
    read: (id: string): Readonly<Size> | undefined => sizes.get(id),
    release,
    dispose() {
      disposed = true;
      observer.disconnect();
      nodes.clear();
      visible.clear();
      sizes.clear();
    },
  };
}
