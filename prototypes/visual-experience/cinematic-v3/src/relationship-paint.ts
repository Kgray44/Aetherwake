type RelationshipPath = Pick<SVGPathElement, "setAttribute" | "style">;

/** Paints the existing Vela relationship curve without rewriting settled SVG. */
export function createRelationshipPaint(path: RelationshipPath) {
  let geometry: string | undefined;
  let paintedOpacity: string | undefined;
  return (
    target: { x: number; y: number; w: number } | undefined,
    width: number,
    height: number,
    expanded: boolean,
    attention: number,
  ) => {
    if (target) {
      const startX = width * (expanded ? 0.88 : 0.63);
      const startY = height * (expanded ? 0.32 : 0.4);
      const endX = target.x + target.w * 0.5;
      const endY = target.y + 8;
      const next = `M${startX},${startY} C${startX},${endY} ${endX},${startY} ${endX},${endY}`;
      if (next !== geometry) {
        path.setAttribute("d", next);
        geometry = next;
      }
    }
    const opacity = target ? String(0.2 + attention * 0.55) : "0";
    if (paintedOpacity !== opacity) {
      path.style.opacity = opacity;
      paintedOpacity = opacity;
    }
  };
}
