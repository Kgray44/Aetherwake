let poseParser: CSSStyleDeclaration | undefined;

/** The renderer supplies a pose declaration list. This writer owns the resize
 * insets and carries forward the text scale from applyBlockConfiguration. */
export function applyBlockPoseStyle(style: CSSStyleDeclaration, pose: string) {
  const textScale = style.getPropertyValue("--aw-block-text-scale");
  // Read CSSOM-normalized radii without invalidating the live card.
  const parsed = (poseParser ??= document.createElement("div").style);
  parsed.cssText = pose;
  // The renderer already supplied the shared contour's uniform CSS radius.
  // Derive interaction insets from those exact painted radii, never from a
  // second shape/geometry calculation. A fresh pose cannot retain stale radii.
  const [rx, ry = rx] = parsed
    .getPropertyValue("border-radius")
    .split("/")
    .map((value) => value.trim());
  const pixels = /^(?:\d+(?:\.\d+)?|\.\d+)px$/;
  let cardStyle = pose;
  if (pixels.test(rx) && pixels.test(ry)) {
    cardStyle += `;--aw-resize-radius-x:${rx};--aw-resize-radius-y:${ry}`;
  }
  if (textScale) cardStyle += `;--aw-block-text-scale:${textScale}`;
  // Keep the original pose text to preserve the renderer's numeric precision.
  style.cssText = cardStyle;
}
