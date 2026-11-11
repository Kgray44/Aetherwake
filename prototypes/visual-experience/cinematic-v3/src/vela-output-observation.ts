import type { VelaOutputObservation } from "../../../application-contract/contracts.ts";
import type { VelaPanelManifestation } from "../../../vela-core/src/panel.ts";

function visibleOutput(element: HTMLElement) {
  const { ownerDocument } = element;
  if (!element.isConnected || ownerDocument.visibilityState !== "visible" || element.closest("[hidden]") ||
    element.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) === false) return false;
  const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
  const { clientWidth, clientHeight } = ownerDocument.documentElement;
  return width > 0 && height > 0 && right > 0 && bottom > 0 && left < clientWidth && top < clientHeight;
}

export function createVelaOutputObservation(
  send: (output: VelaOutputObservation) => Promise<unknown>,
  frame: (callback: () => void) => void = callback => requestAnimationFrame(callback),
  visible = visibleOutput,
) {
  const observed = new Set<string>();
  let latest: VelaPanelManifestation | null = null;
  let pending = false;
  function schedule() {
    if (pending || !latest?.output || observed.has(latest.output.messageId)) return;
    pending = true;
    frame(() => {
      const candidate = latest;
      const output = candidate?.output;
      if (!candidate || !output || !visible(candidate.elements.manifestation)) { pending = false; return; }
      frame(() => {
        pending = false;
        if (candidate !== latest) { schedule(); return; }
        if (!visible(candidate.elements.manifestation)) return;
        if (observed.size >= 64) observed.delete(observed.values().next().value!);
        observed.add(output.messageId);
        void send(output).catch(() => {});
      });
    });
  }
  return (value: VelaPanelManifestation | null) => {
    latest = value?.view === "current" && !value.baseline ? value : null;
    schedule();
  };
}
