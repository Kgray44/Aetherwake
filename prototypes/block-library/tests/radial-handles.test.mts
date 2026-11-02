import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyBlockPoseStyle } from "../pose-style.ts";
import {
  contourPoint,
  surfaceBorderRadius,
  type SurfaceShape,
} from "../../visual-experience/cinematic-v3/src/surface-contour.ts";
import { REGISTERED_BLOCKS } from "../registry.ts";

class Declaration {
  values = new Map<string, string>();
  set cssText(css: string) {
    this.values.clear();
    for (const part of css.split(";")) {
      const at = part.indexOf(":");
      if (at > 0)
        this.values.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
    }
  }
  setProperty(name: string, value: string) {
    this.values.set(name, value);
  }
  getPropertyValue(name: string) {
    return this.values.get(name) ?? "";
  }
}
const inside = (x: number, y: number, polygon: { x: number; y: number }[]) => {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a.y > y !== b.y > y &&
      x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
    )
      result = !result;
  }
  return result;
};

test("actual diagonal CSS centers remain inside the shared painted contour with native pixel rounding for every shape and morph", () => {
  const css = readFileSync(
      new URL("../direct-manipulation.css", import.meta.url),
      "utf8",
    ),
    offset =
      /top:\s*calc\(var\(--aw-resize-radius-y, 18px\)\s*\*\s*([\d.]+)\s*-\s*([\d.]+)px\)/.exec(
        css,
      )!,
    grip =
      /\.aw-card-edge--sw\s*\{\s*width:\s*(\d+)px;\s*height:\s*(\d+)px;/.exec(
        css,
      )!;
  assert(
    offset && grip,
    "Read the actual CSS geometry, not a copied implementation",
  );
  const fraction = Number(offset[1]),
    halfWidth = Number(grip[1]) / 2,
    halfHeight = Number(grip[2]) / 2,
    adjustment = Number(offset[2]);
  assert(
    halfWidth - adjustment >= 2 && halfHeight - adjustment >= 2,
    "Keep at least two pixels of inward tolerance",
  );
  for (const shape of [
    "rectangle",
    "rounded",
    "folio",
    "lens",
    "circle",
    "pill",
  ] as SurfaceShape[])
    for (const [width, height] of [
      [128, 96],
      [420, 420],
      [560, 320],
      [900, 640],
    ])
      for (const unfold of [0, 0.4, 1]) {
        const radius = surfaceBorderRadius(shape, width, height, unfold),
          style = new Declaration();
        applyBlockPoseStyle(
          style as unknown as CSSStyleDeclaration,
          `border-radius:${radius};clip-path:inset(0 round ${radius});`,
        );
        const rx = Number.parseFloat(
            style.getPropertyValue("--aw-resize-radius-x"),
          ),
          ry = Number.parseFloat(
            style.getPropertyValue("--aw-resize-radius-y"),
          ),
          dx = rx * fraction - adjustment + halfWidth,
          dy = ry * fraction - adjustment + halfHeight,
          polygon = Array.from({ length: 512 }, (_, i) => {
            const point = contourPoint(
              width,
              height,
              shape,
              unfold,
              i / 512,
              0,
              { x: 0, y: 0, nx: 0, ny: 0 },
            );
            return { x: point.x + width / 2, y: height / 2 - point.y };
          });
        for (const x of [dx, width - dx])
          for (const y of [dy, height - dy])
            for (const origin of [-0.49, 0, 0.49])
              assert(
                inside(
                  Math.round(x + origin) - origin,
                  Math.round(y + origin) - origin,
                  polygon,
                ),
                `${shape} ${width}x${height} unfold=${unfold}: corner center must be inside actual shared contour`,
              );
      }
});

test("pose radius variables follow supplied uniform radii without retaining a prior contour or changing the pose/text scale", () => {
  const style = new Declaration();
  style.setProperty("--aw-block-text-scale", "1.5");
  applyBlockPoseStyle(
    style as unknown as CSSStyleDeclaration,
    "left:33px;border-radius:210px / 160px;",
  );
  assert.equal(style.getPropertyValue("--aw-resize-radius-x"), "210px");
  assert.equal(style.getPropertyValue("--aw-resize-radius-y"), "160px");
  assert.equal(style.getPropertyValue("border-radius"), "210px / 160px");
  assert.equal(style.getPropertyValue("--aw-block-text-scale"), "1.5");
  applyBlockPoseStyle(
    style as unknown as CSSStyleDeclaration,
    "left:34px;border-radius:18px;",
  );
  assert.equal(style.getPropertyValue("--aw-resize-radius-x"), "18px");
  assert.equal(style.getPropertyValue("--aw-resize-radius-y"), "18px");
  applyBlockPoseStyle(style as unknown as CSSStyleDeclaration, "left:35px;");
  assert.equal(style.getPropertyValue("--aw-resize-radius-x"), "");
  assert.equal(style.getPropertyValue("--aw-resize-radius-y"), "");
  assert.equal(
    REGISTERED_BLOCKS.find((block) => block.kind === "research")!
      .defaultPresentation.shape,
    "lens",
  );
  assert.equal(REGISTERED_BLOCKS.find((block) => block.kind === "note")!.defaultPresentation.shape, "rounded");
});
