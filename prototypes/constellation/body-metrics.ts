import { hash } from "./identity.ts";

export type BodyRole = "project" | "workspace" | "resource";
export const BODY_GAP = 28;
export const BODY_MAX_SCALE = 1.08;

/** One size contract shared by geometry, layout and camera-view decluttering. */
export function planetDimensions(id: string, role: BodyRole) {
  const a = hash("terrain:" + id),
    c = hash("light:" + id),
    d = hash("orbit:" + id);
  const type =
    role === "resource" ? (a < 0.6 ? 0 : a < 0.85 ? 3 : 1) : Math.floor(a * 5);
  return {
    type,
    radius:
      role === "project"
        ? 148
        : role === "workspace"
          ? 62
          : 23 + (c - 0.5) * 10,
    rings:
      role === "project" ? d > 0.46 : role === "workspace" ? d > 0.8 : d > 0.98,
    atmosphere: type === 1 || type === 2 || type === 3 || role === "project",
    ringScale: 1.8 + c * 0.7,
  };
}
export function bodyEnvelope(id: string, role: BodyRole) {
  const p = planetDimensions(id, role);
  return (
    p.radius *
    Math.max(p.rings ? p.ringScale : 1, p.atmosphere ? 1.055 : 1) *
    BODY_MAX_SCALE
  );
}
