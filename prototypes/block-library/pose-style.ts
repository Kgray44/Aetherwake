/** Pose painting replaces its CSS declarations; retain the validated placement
 * typography owned by applyBlockConfiguration. Geometry and optics are passed
 * through exactly as supplied by the renderer. */
export function applyBlockPoseStyle(style: CSSStyleDeclaration, pose: string) {
  const textScale = style.getPropertyValue("--aw-block-text-scale");
  style.cssText = pose;
  // The renderer already supplied the shared contour's uniform CSS radius.
  // Derive interaction insets from those exact painted radii, never from a
  // second shape/geometry calculation. A fresh pose cannot retain stale radii.
  const [rx, ry = rx] = style
    .getPropertyValue("border-radius")
    .split("/")
    .map((value) => value.trim());
  const pixels = /^(?:\d+(?:\.\d+)?|\.\d+)px$/;
  if (pixels.test(rx) && pixels.test(ry)) {
    style.setProperty("--aw-resize-radius-x", rx);
    style.setProperty("--aw-resize-radius-y", ry);
  }
  if (textScale) style.setProperty("--aw-block-text-scale", textScale);
}
