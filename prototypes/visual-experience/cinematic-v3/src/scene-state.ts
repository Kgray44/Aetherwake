import type { EnvironmentFrame } from "./renderer";

/** One visual interpretation of observable workspace state, shared by DOM and GPU. */
export function deriveSceneState(input: {
  selected: string | null;
  expanded: string | null;
  related: string | null;
  dragging: boolean;
  focus: number;
  attention: number;
  ambient: boolean;
  ambientStrength: number;
  quiet: boolean;
  visible: boolean;
  reduced: boolean;
  vela: EnvironmentFrame["vela"];
  pointer: { x: number; y: number };
  surfaces: NonNullable<EnvironmentFrame["surfaces"]>;
  width: number;
  height: number;
}) {
  const activeResource =
    input.related ?? input.expanded ?? (input.dragging ? input.selected : null);
  const anchor = input.surfaces.find(
    (surface) => surface.id === activeResource,
  );
  const point = anchor
    ? {
        x: ((anchor.x + anchor.w / 2) / input.width) * 2 - 1,
        y: 1 - ((anchor.y + anchor.h / 2) / input.height) * 2,
      }
    : input.pointer;
  const autonomous =
    input.visible &&
    !input.quiet &&
    !input.reduced &&
    input.vela !== "unavailable";
  return {
    mode: input.expanded ? "focused-work" : "workspace",
    activeResource,
    focus: input.focus,
    attention: input.attention,
    interaction: input.dragging ? 1 : input.expanded ? 0.25 : 0,
    pointer: input.reduced ? { x: 0, y: 0 } : point,
    ambientStrength:
      autonomous && input.ambient
        ? input.ambientStrength * (1 - input.focus * 0.7)
        : 0,
  };
}
