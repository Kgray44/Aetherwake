import type {
  BlockKind,
  CanonicalTemplateHost,
  ResourceCandidate,
  TemplateBody,
  TemplateResourceRole,
  VelaTemplatePlanner,
} from "./contracts.ts";
import { WORKSPACE_ARCHITECT_PROVIDER } from "./contracts.ts";
import { check, validateDraft } from "./model.ts";
import { blockDefinition } from "./registry.ts";
import { defaultPresence } from "../workspace-engine/engine.mts";
import { defaultOrganization } from "../workspace-engine/organization.mts";

type Role = {
  key: string;
  title: string;
  kinds: readonly BlockKind[];
  relevant: RegExp;
  compact?: boolean;
};
const role = (key: string, title: string, kinds: BlockKind[], relevant: RegExp, compact = false): Role =>
  ({ key, title, kinds, relevant, compact });

const purposes = [
  {
    id: "operations", title: "Server Operations", match: /\b(server|infrastructure|incident|runbook|uptime|deployment operations|on[- ]call|ops)\b/i,
    roles: [
      role("runbook", "Operations runbook", ["note", "reference"], /\b(runbook|server|operations|incident)\b/i),
      role("activity", "Recorded operations activity", ["timeline", "stream"], /\b(operations|incident|server|deploy)\b/i),
      role("followUps", "Operational follow-ups", ["checklist", "task_group", "task"], /\b(operations|incident|server|maintenance|deploy)\b/i),
      role("sources", "Service references", ["link", "file", "reference"], /\b(service|server|runbook|infrastructure)\b/i, true),
    ],
  },
  {
    id: "review", title: "Review", match: /\b(review|audit|verification|retrospective|sign[- ]off|acceptance)\b/i,
    roles: [
      role("findings", "Review findings", ["note", "research"], /\b(review|audit|findings|verification)\b/i),
      role("criteria", "Acceptance criteria", ["task_objective", "checklist", "task_group"], /\b(acceptance|criteria|verification|review|audit)\b/i),
      role("evidence", "Review evidence and sources", ["file", "link", "reference"], /\b(evidence|review|audit|report|test results)\b/i, true),
    ],
  },
  {
    id: "monitoring", title: "Monitoring", match: /\b(monitor(?:ing)?|activity|observability|events|health dashboard|metrics)\b/i,
    roles: [
      role("activity", "Recorded activity", ["timeline", "stream"], /\b(activity|health|monitor|monitoring|events|metrics)\b/i),
      role("observations", "Monitoring observations", ["note"], /\b(monitor|monitoring|metrics|observations|health)\b/i),
      role("followUps", "Investigation follow-ups", ["task_objective", "checklist", "task_group"], /\b(monitor|monitoring|health|investigation|alert)\b/i),
    ],
  },
  {
    id: "embedded-audio", title: "Embedded Audio Development", match: /\b(i2s|dsp|audio processing|digital audio|embedded audio|sound processing)\b/i,
    roles: [
      role("bench", "Audio implementation notes", ["note", "research"], /\b(esp32|audio|i2s|dsp|firmware|bench)\b/i),
      role("validation", "Audio bring-up and validation", ["checklist", "task_group", "task"], /\b(esp32|audio|i2s|dsp|bring[- ]up|validation)\b/i),
      role("developmentChat", "Audio development conversation", ["conversation"], /\b(esp32|audio|i2s|dsp|firmware)\b/i),
      role("measurements", "Measurements and observations", ["file", "link", "reference"], /\b(measurements?|capture|scope|spectrum|latency|wav|datasheet|i2s|esp32)\b/i, true),
    ],
  },
  {
    id: "development", title: "Development", match: /\b(develop(?:ment)?|implement(?:ation)?|coding|code|engineering|debug(?:ging)?|software|feature|bug|esp32|firmware|microcontrollers?)\b/i,
    roles: [
      role("implementation", "Implementation notes", ["note", "research"], /\b(implementation|develop|development|feature|engineering|debug|debugging)\b/i),
      role("backlog", "Development backlog", ["task_objective", "checklist", "task_group"], /\b(backlog|development|implementation|bug|feature|sprint)\b/i),
      role("discussion", "Development discussion", ["conversation"], /\b(development|implementation|feature|engineering|coding|debug)\b/i),
      role("sources", "Technical references", ["file", "link", "reference"], /\b(architecture|technical|specification|code|development)\b/i, true),
    ],
  },
  {
    id: "study", title: "Study", match: /\b(stud(?:y|ying)|exam|course|class|lecture|homework|revision|learn(?:ing)?)\b/i,
    roles: [
      role("studyNotes", "Study notes", ["note", "research"], /\b(study|lecture|course|class|exam|notes)\b/i),
      role("practice", "Practice and revision", ["checklist", "task_group", "task"], /\b(practice|revision|homework|exam|study)\b/i),
      role("readings", "Readings and sources", ["file", "link", "reference"], /\b(reading|readings|lecture|textbook|study|course)\b/i, true),
    ],
  },
  {
    id: "writing", title: "Writing", match: /\b(writ(?:e|ing)|draft(?:ing)?|article|novel|essay|script|story|creative)\b/i,
    roles: [
      role("draft", "Working draft", ["note"], /\b(draft|writing|article|novel|essay|script|story)\b/i),
      role("outline", "Outline and decisions", ["note", "research"], /\b(outline|decisions|writing|plot)\b/i),
      role("sources", "Writing references", ["file", "link", "reference"], /\b(writing|source|sources|reference|references)\b/i, true),
    ],
  },
  {
    id: "research", title: "Research", match: /\b(research|investigat(?:e|ion|ing)|compare|comparison|literature|findings|synthesi[sz]e)\b/i,
    roles: [
      role("findings", "Research findings", ["research", "note"], /\b(research|findings|comparison|investigation)\b/i),
      role("sources", "Sources and citations", ["file", "link", "reference"], /\b(source|sources|citation|citations|research|literature|reading)\b/i, true),
      role("questions", "Open research questions", ["note", "task"], /\b(question|questions|hypothesis|research)\b/i),
    ],
  },
  {
    id: "planning", title: "Planning", match: /\b(plan(?:ning)?|roadmap|milestones?|prioriti[sz](?:e|ing|ation)|sprint|schedule)\b/i,
    roles: [
      role("plan", "Plan and milestones", ["task_objective", "checklist", "note"], /\b(plan|planning|roadmap|milestone|milestones|sprint)\b/i),
      role("nextActions", "Next actions", ["task_group", "task"], /\b(next|action|actions|backlog|planning|sprint)\b/i),
      role("decisions", "Planning decisions", ["note", "reference"], /\b(decision|decisions|planning|scope|roadmap)\b/i),
    ],
  },
] as const;

const general = {
  id: "general",
  title: "Working Workspace",
  roles: [
    role("workingNotes", "Working notes", ["note"], /\b(working notes|workspace notes)\b/i),
    role("nextActions", "Next actions", ["checklist", "task_group", "task"], /\b(next actions|to[- ]do)\b/i),
    role("discussion", "Project conversation", ["conversation"], /\b(chat|conversation|discussion)\b/i),
  ],
} as const;

const explicitKinds = [
  ["conversation", /\b(?:chats?|conversations?|discussion)\b/i],
  ["note", /\bnotes?\b/i],
  ["checklist", /\bchecklists?\b/i],
  ["task", /\b(?:tasks?|to[- ]do)\b/i],
  ["agent", /\bagents?\b/i],
  ["timeline", /\btimelines?\b/i],
  ["task_objective", /\b(?:task tracker|task objective)s?\b/i],
  ["file", /\b(?:files?|documents?|pdfs?)\b/i],
  ["link", /\b(?:links?|websites?|sites?)\b/i],
  ["stream", /\b(?:intelligence stream|activity stream)s?\b/i],
] as const satisfies readonly (readonly [BlockKind, RegExp])[];

const referenceOnly = new Set<BlockKind>(["file", "link"]);
const maxBlocks = 8;
const stopWords = new Set([
  "a", "add", "an", "and", "build", "create", "existing", "for", "from", "give", "in", "make", "me", "my",
  "of", "only", "organize", "please", "project", "put", "resources", "set", "the", "to", "up", "use", "using",
  "want", "with", "workspace",
]);
const words = (value: string) => new Set(value.toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? []);
const abbreviated = (value: string, limit: number) => value.trim().slice(0, limit).trimEnd();
const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

function interpret(prompt: string) {
  const named = prompt.match(/\b(?:called|named)\s+(?:"([^"]+)"|“([^”]+)”|([^.;,\n]+?)(?=\s+(?:with|using|including)\b|[.;,\n]|$))/i);
  const requestedTitle = named?.[1] ?? named?.[2] ?? named?.[3];
  const intent = named ? prompt.replace(named[0], "") : prompt;
  const excludedClauses = [...intent.matchAll(/\b(?:without|no|exclude|skip)\s+([^.;,\n]+)/gi)].map(match => match[1]);
  const excluded = new Set<BlockKind>(explicitKinds.filter(([, matcher]) => excludedClauses.some(clause => matcher.test(clause))).map(([kind]) => kind));
  const preferredIntent = intent.replace(/\b(?:without|no|exclude|skip)\s+[^.;,\n]+/gi, "");
  const purposeClause = preferredIntent.split(/\b(?:with|using|including|include)\b/i)[0];
  const purpose = purposes.find(profile => profile.match.test(purposeClause)) ??
    purposes.find(profile => profile.match.test(preferredIntent)) ?? general;
  const tokens = new Set([...words(preferredIntent)].filter(word => word.length > 2 && !stopWords.has(word)));
  const quotedTitles = [...preferredIntent.matchAll(/"([^"]+)"|“([^”]+)”/g)].map(match => (match[1] ?? match[2]).trim().toLowerCase());
  const allowReuse = !/\b(?:from scratch|blank workspace|no existing|without existing|only new|new resources only)\b/i.test(intent);
  const objective = purposeClause.replace(/^\s*(?:(?:please|could you|can you)\s+)?(?:create|build|make|give me|set up|design|plan)\s+(?:me\s+)?(?:(?:a|an|the)\s+)?(?:workspace\s*(?:for|to)?\s*)?/i, "")
    .replace(/\s+workspace\s*$/i, "").trim();
  const title = requestedTitle || (purpose === general && objective ? objective.charAt(0).toUpperCase() + objective.slice(1) : purpose.title);
  return { purpose, tokens, quotedTitles, allowReuse, preferredIntent, excluded, title: abbreviated(title, 120) || purpose.title };
}

function matchResource(role: Role, candidates: ResourceCandidate[], used: Set<string>, intent: ReturnType<typeof interpret>) {
  return candidates
    .filter(candidate => !used.has(candidate.id) && role.kinds.includes(candidate.kind))
    .map(candidate => {
      const exact = intent.quotedTitles.includes(candidate.title.trim().toLowerCase());
      const overlap = [...words(candidate.title)].filter(word => intent.tokens.has(word)).length;
      return { candidate, score: (exact ? 100 : 0) + overlap * 4 + (role.relevant.test(candidate.title) ? 2 : 0) };
    })
    .filter(match => match.score > 0)
    .sort((a, b) => b.score - a.score ||
      role.kinds.indexOf(a.candidate.kind) - role.kinds.indexOf(b.candidate.kind) ||
      compareText(a.candidate.id, b.candidate.id))[0]?.candidate;
}

/** Stable Freeform placements reserve the default Vela surface and leave manual movement unlocked. */
export function composeWorkspaceBlueprint(resources: TemplateResourceRole[], compact = new Set<string>()): TemplateBody {
  const margin = 24, gap = 24, presence = defaultPresence("new-workspace");
  const firstRight = presence.x + presence.width + gap;
  const leftWidth = presence.x - gap - margin;
  const baseWidth = 1200;
  const firstRightWidth = baseWidth - firstRight - margin;
  // Reserve the floating application header in a newly composed canvas only.
  // Existing workspaces and manually positioned cards never pass through this constructor.
  let rowTop = 144, rowHeight = 0, contentWidth = presence.x + presence.width;
  const placements = resources.map((resource, index) => {
    const definition = blockDefinition(resource.source.kind);
    const right = index % 2 === 1;
    if (index === 2) {
      rowTop = Math.max(rowTop + rowHeight, presence.y + presence.height) + gap;
      rowHeight = 0;
    } else if (index > 2 && !right) {
      rowTop += rowHeight + gap;
      rowHeight = 0;
    }
    const width = Math.max(definition.minimumSize.width, index < 2
      ? (right ? firstRightWidth : leftWidth)
      : (baseWidth - 2 * margin - gap) / 2);
    const x = right ? (index < 2 ? firstRight : (baseWidth + gap) / 2) : margin;
    const height = Math.max(definition.minimumSize.height, index === 0
      ? Math.max(384, definition.defaultPresentation.height)
      : compact.has(resource.key) ? Math.min(280, definition.defaultPresentation.height) : Math.min(372, definition.defaultPresentation.height));
    rowHeight = Math.max(rowHeight, height);
    contentWidth = Math.max(contentWidth, x + width);
    return {
      key: "placement-" + resource.key,
      resourceKey: resource.key,
      presentation: { ...definition.defaultPresentation, x, y: rowTop, width, height, zIndex: index, locked: false },
    };
  });
  const contentHeight = Math.max(rowTop + rowHeight, presence.y + presence.height) + margin;
  const { order: _order, spans: _spans, ...structured } = defaultOrganization().structured;
  return {
    schemaVersion: 1,
    organization: { schemaVersion: 1, mode: "freeform", gap, structured },
    resources,
    placements,
    groups: [],
    viewport: { x: 0, y: 0, zoom: Math.max(0.62, Math.min(1, baseWidth / (contentWidth + margin), 760 / contentHeight)) },
  };
}

/** Interprets bounded purpose and metadata locally. It never accesses content, creates objects or invokes a provider. */
export function createWorkspaceArchitect(
  host: Pick<CanonicalTemplateHost, "capabilities" | "workspacePlanningResources">,
  options: { semantic?: () => VelaTemplatePlanner | undefined } = {},
): VelaTemplatePlanner {
  return {
    async plan(input, signal) {
      const semantic = options.semantic?.();
      if (semantic) return semantic.plan(input, signal);
      check(!signal?.aborted, 'workspace_architect_cancelled');
      const intent = interpret(input.prompt);
      const available = new Set(input.supportedKinds.filter(kind => !intent.excluded.has(kind)));
      const discovery = intent.allowReuse ? host.workspacePlanningResources?.(input.projectId) : undefined;
      const candidates = discovery?.resources.filter(resource => resource.projectId === input.projectId && available.has(resource.kind)) ?? [];
      const local = host.capabilities().providers.local?.state === "available";
      const canCreate = (kind: BlockKind) => !referenceOnly.has(kind) && blockDefinition(kind).creation !== "reference-only" && (kind !== "conversation" || local);
      const resources: TemplateResourceRole[] = [];
      const used = new Set<string>(), compact = new Set<string>(), included = new Set<BlockKind>();
      const add = (proposal: Role, selected?: ResourceCandidate) => {
        const permitted = { ...proposal, kinds: proposal.kinds.filter(kind => available.has(kind)) };
        const existing = selected ?? matchResource(permitted, candidates, used, intent);
        const kind = existing?.kind ?? permitted.kinds.find(canCreate);
        if (!kind) return false;
        if (existing) used.add(existing.id);
        if (proposal.compact) compact.add(proposal.key);
        included.add(kind);
        resources.push({
          key: proposal.key,
          label: existing ? abbreviated(existing.title, 120) || proposal.title : proposal.title,
          source: existing
            ? { mode: "reference", kind, resourceId: existing.id, expectedVersion: existing.version }
            : {
                mode: "new", kind, title: proposal.title,
                ...(kind === "conversation" ? { provider: "local" } : {}),
                ...(kind === "checklist" ? { emptyChecklist: true } : {}),
              },
        });
        return true;
      };
      // Specifically requested kinds get first claim on a compatible purpose role.
      const requested = new Set<BlockKind>(explicitKinds
        .filter(([kind, matcher]) => matcher.test(intent.preferredIntent) && !intent.excluded.has(kind))
        .map(([kind]) => kind));
      const requestedMissing = new Set<BlockKind>();
      for (const proposal of intent.purpose.roles) {
        const explicit = proposal.kinds.filter(kind => requested.has(kind) && !included.has(kind));
        if (!explicit.length || !add({ ...proposal, kinds: explicit })) add(proposal);
      }
      for (const kind of requested) {
        if (included.has(kind)) continue;
        const definition = blockDefinition(kind);
        if (resources.length >= maxBlocks || !add(role("requested-" + kind, definition.title, [kind], /$^/))) requestedMissing.add(kind);
      }
      // A specifically named authorized object may be useful even when it is
      // outside the default kinds of the inferred purpose.
      for (const candidate of candidates.filter(item => intent.quotedTitles.includes(item.title.trim().toLowerCase()))) {
        if (resources.length >= maxBlocks) break;
        if (!used.has(candidate.id)) add(role("named-" + resources.length, blockDefinition(candidate.kind).title, [candidate.kind], /$^/), candidate);
      }
      check(resources.length > 0, "workspace_architect_no_supported_blocks");
      const description = [
        `Proposed ${intent.purpose.id === "general" ? "working" : intent.purpose.id} workspace with ${resources.length} blocks.`,
        !intent.allowReuse ? "Uses new local resources as requested." : discovery
          ? "Existing resources are matched by title within the destination scope."
          : "Existing resource discovery is unavailable.",
        requestedMissing.size ? `Unavailable requested blocks: ${[...requestedMissing].map(kind => blockDefinition(kind).title).join(", ")}.` : "",
        discovery?.complete === false ? "Resource matching scanned a limited set of titles." : "",
      ].filter(Boolean).join(" ");
      return {
        ...validateDraft({
          name: intent.title, description: abbreviated(description, 500),
          tags: ["workspace-architect", intent.purpose.id],
          body: composeWorkspaceBlueprint(resources, compact),
        }),
        provenance: { requestId: input.requestId, providerId: WORKSPACE_ARCHITECT_PROVIDER },
      };
    },
  };
}
