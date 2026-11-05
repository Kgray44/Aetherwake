import { hash } from "./identity.ts";

export type BodyRole = "project" | "workspace" | "resource";
export const BODY_GAP = 28;
export const BODY_MAX_SCALE = 1.08;

/** One size contract shared by geometry, physical clearance and frustum bounds. */
export function planetDimensions(id: string, role: BodyRole) {
  const a = hash("terrain:" + id),
    c = hash("light:" + id),
    d = hash("orbit:" + id);
  const type =
    role === "project"
      ? 5
      : role === "resource"
        ? a < 0.6
          ? 0
          : a < 0.85
            ? 3
            : 1
        : Math.floor(a * 5);
  return {
    type,
    radius:
      role === "project"
        ? 148
        : role === "workspace"
          ? 62
          : 23 + (c - 0.5) * 10,
    rings:
      role === "project" ? false : role === "workspace" ? d > 0.8 : d > 0.98,
    atmosphere: type === 1 || type === 2 || type === 3 || role === "project",
    atmosphereScale: role === "project" ? 1.18 : 1.055,
    ringScale: 1.8 + c * 0.7,
  };
}
export function bodyEnvelope(id: string, role: BodyRole) {
  const p = planetDimensions(id, role);
  return (
    p.radius *
    Math.max(p.rings ? p.ringScale : 1, p.atmosphere ? p.atmosphereScale : 1) *
    BODY_MAX_SCALE
  );
}
