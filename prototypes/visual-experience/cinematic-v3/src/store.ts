import { researchNotebook, longDocument } from "./workloads.ts";
export type Resource = {
  id: string;
  type: "conversation" | "research" | "note";
  title: string;
  subtitle: string;
  text: string;
};
export type StreamEvent = {
  id: string;
  sequence: number;
  run: string;
  source: string;
  resource: string;
  kind: string;
  evidence: "synthetic" | "local-observed";
  time: string;
  detail: string;
};
export const seed: Resource[] = [
  {
    id: "conversation-tidal",
    type: "conversation",
    title: "The shape of a quieter world",
    subtitle: "Conversation study · local draft",
    text: "Let the environment recede when the work begins.\n\nA resource should keep its identity as it moves. Light can explain focus, while the document remains clear. The useful part is what stays with you.",
  },
  {
    id: "research-material",
    type: "research",
    title: "Light, held in a surface",
    subtitle: "Research notebook · synthetic review",
    text: researchNotebook,
  },
  {
    id: "note-field",
    type: "note",
    title: "Leave room for thought",
    subtitle: "Working document · local edits",
    text: longDocument,
  },
];
export function validateSaved(
  value: unknown,
): { order: string[]; drafts: Record<string, string> } | null {
  if (!value || typeof value !== "object") return null;
  const o = value as { order?: unknown; drafts?: unknown };
  const ids = seed.map((r) => r.id);
  if (
    !Array.isArray(o.order) ||
    o.order.length !== ids.length ||
    new Set(o.order).size !== ids.length ||
    !o.order.every((x) => ids.includes(x))
  )
    return null;
  if (!o.drafts || typeof o.drafts !== "object") return null;
  const drafts: Record<string, string> = {};
  for (const id of ids) {
    const d = (o.drafts as Record<string, unknown>)[id];
    if (typeof d !== "string" || d.length > 100000) return null;
    drafts[id] = d;
  }
  return { order: o.order as string[], drafts };
}
export const demoSteps = [
  {
    state: "receiving",
    kind: "input.received",
    source: "Vela fixture",
    resource: "conversation-tidal",
    detail: "Synthetic brief received. No microphone or model is connected.",
  },
  {
    state: "working",
    kind: "execution.started",
    source: "Material agent fixture",
    resource: "research-material",
    detail: "Synthetic material comparison started.",
  },
  {
    state: "coordinating",
    kind: "relationship.assigned",
    source: "Vela fixture",
    resource: "note-field",
    detail: "Synthetic relationship: notebook informs the material study.",
  },
  {
    state: "attention",
    kind: "review.requested",
    source: "Review fixture",
    resource: "research-material",
    detail: "Synthetic review requests a clearer reading plane.",
  },
  {
    state: "reported",
    kind: "result.reported",
    source: "Material agent fixture",
    resource: "research-material",
    detail: "Fixture reports completion. This is not verification.",
  },
  {
    state: "verified",
    kind: "fixture.check.passed",
    source: "Local demo validator",
    resource: "research-material",
    detail:
      "Only the synthetic event sequence was checked locally; no design or agent work was verified.",
  },
  {
    state: "idle",
    kind: "execution.settled",
    source: "Vela fixture",
    resource: "conversation-tidal",
    detail: "Synthetic sequence ended. Returning to calm.",
  },
] as const;

/** Checks recorded fixture events, not the underlying artistic or agent outcome. */
export function validateDemoPrefix(
  events: readonly StreamEvent[],
  run: string,
): boolean {
  const prefix = events.filter(
    (e) => e.run === run && e.evidence === "synthetic",
  );
  const expected = demoSteps.slice(0, 5);
  return (
    prefix.length === expected.length &&
    new Set(prefix.map((e) => e.id)).size === prefix.length &&
    prefix.every(
      (e, i) =>
        e.kind === expected[i].kind &&
        e.resource === expected[i].resource &&
        e.source === expected[i].source &&
        Number.isFinite(Date.parse(e.time)) &&
        (i === 0 || e.sequence > prefix[i - 1].sequence),
    )
  );
}
