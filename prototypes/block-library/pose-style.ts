/** Pose painting replaces its CSS declarations; retain the validated placement
 * typography owned by applyBlockConfiguration. Geometry and optics are passed
 * through exactly as supplied by the renderer. */
export function applyBlockPoseStyle(style: CSSStyleDeclaration, pose: string) {
  const textScale = style.getPropertyValue("--aw-block-text-scale");
  style.cssText = pose;
  if (textScale) style.setProperty("--aw-block-text-scale", textScale);
}
