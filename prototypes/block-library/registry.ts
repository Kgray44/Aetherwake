import type {
  BlockDefinition,
  BlockKind,
  LibraryCapabilities,
  Availability,
  CreateBlockInput,
  Presentation,
  BlockConfiguration,
  BlockCapabilityState,
} from "./contracts.ts";
import { presentation, limits } from "../workspace-engine/geometry.mts";
import { shapes } from "../workspace-engine/contracts.mts";
import type { NonResourceSubjectRef } from "../workspace-kernel/subjects.ts";
import type { SubjectBlockKind } from "./contracts.ts";
import type { BlockInstanceKind } from "./contracts.ts";
import type { LibraryRecommendationContext } from "./contracts.ts";
/** Explainable local rules over current workspace metadata. No model inference or grant inference. */
export function recommendBlocks(
  context: LibraryRecommendationContext | null,
  capabilities: LibraryCapabilities,
): { kind: BlockInstanceKind; reason: string }[] {
  if (!context) return [];
  const present = new Set(context.presentKinds),
    result: { kind: BlockInstanceKind; reason: string }[] = [];
  const propose = (kind: BlockInstanceKind, reason: string) => {
    if (
      !present.has(kind) &&
      blockAvailability(kind, capabilities).state === "available"
    )
      result.push({ kind, reason });
  };
  if (context.projectId)
    propose(
      "project_overview",
      "This workspace belongs to a project; open its canonical overview.",
    );
  if (!present.size) {
    propose("note", "Start this empty workspace with a local document.");
    propose("conversation", "Start a conversation without requiring a task.");
  }
  if (present.has("conversation")) {
    propose("note", "Keep a local working note beside this conversation.");
    propose(
      "stream",
      "Inspect captured event metadata for conversation activity.",
    );
  }
  if (present.has("task"))
    propose(
      "task_group",
      "Organize the tasks already represented in this workspace.",
    );
  if (present.has("research"))
    propose(
      "reference",
      "Keep user-provided source references beside the research document.",
    );
  if (present.size || context.projectId)
    propose(
      "resource_browser",
      "Find and attach existing resources while preserving their identity.",
    );
  return result;
}
export const isSubjectBlockKind = (
  kind: BlockInstanceKind,
): kind is SubjectBlockKind =>
  ["project_overview", "resource_browser", "collection_browser"].includes(kind);
export const subjectBlockKind = (
  subject: NonResourceSubjectRef,
): SubjectBlockKind =>
  subject.kind === "project"
    ? "project_overview"
    : subject.kind === "collection"
      ? "collection_browser"
      : "resource_browser";

/** Preferred geometry for NEW placements. Restores and templates retain their
 * persisted presentation; the workspace engine remains the constraint authority. */
export const BLOCK_DEFAULT_SIZES: Readonly<
  Record<BlockInstanceKind, Readonly<{ width: number; height: number }>>
> = deepFreeze({
  conversation: { width: 380, height: 600 },
  note: { width: 440, height: 360 },
  task: { width: 320, height: 260 },
  task_group: { width: 440, height: 460 },
  checklist: { width: 460, height: 500 },
  agent: { width: 400, height: 460 },
  stream: { width: 500, height: 380 },
  project_overview: { width: 520, height: 360 },
  resource_browser: { width: 560, height: 440 },
  collection_browser: { width: 460, height: 400 },
  research: { width: 420, height: 420 },
  reference: { width: 340, height: 300 },
  file: { width: 420, height: 240 },
  link: { width: 420, height: 220 },
});

const define = (
  kind: BlockKind,
  title: string,
  category: BlockDefinition["category"],
  description: string,
  controls: string[],
  preview: string,
  providerRequirement: BlockDefinition["providerRequirement"] = "canonical-local",
): BlockDefinition => ({
  id: "aerynth." + kind,
  version: 1,
  iconId: kind,
  kind,
  title,
  category,
  description,
  controls,
  preview,
  providerRequirement,
  keywords: [
    kind,
    title,
    category,
    ...controls,
    ...(kind === "conversation"
      ? ["chat", "codex", "messages", "local"]
      : kind === "note"
        ? ["notes", "markdown", "writing"]
        : kind === 'task' || kind === 'task_group'
          ? ['manual', 'to-do', 'local task', 'canonical task']
        : []),
  ],
  defaultPresentation: presentation({
    shape: kind === "research" ? "lens" : "rounded",
    ...BLOCK_DEFAULT_SIZES[kind],
  }),
  compatibleResourceKinds: [kind],
  minimumSize: { width: limits.minWidth, height: limits.minHeight },
  supportedShapes: [...shapes],
  requiredServices: [
    "canonical-resources",
    "workspace-engine",
    ...(providerRequirement === "recorded-events"
      ? ["event-journal"]
      : kind === "conversation"
        ? ["conversation-service"]
        : []),
  ],
  configurationSchema: { version: 1, fields: ["textScale", "contentMode"] },
  defaultConfiguration: { schemaVersion: 1, textScale: 1, contentMode: "auto" },
});
/** Every entry maps to an implemented canonical desktop kind. This is not a future feature catalog. */
export const BUILTIN_BLOCKS: readonly BlockDefinition[] = deepFreeze([
  define(
    "conversation",
    "Conversation",
    "conversation",
    "A canonical conversation with its existing messages, composer and provider controls.",
    ["Read messages", "Send through connected provider", "Open conversation"],
    "An empty conversation. Sending requires an available provider; no response is simulated.",
    "conversation-provider",
  ),
  define(
    "note",
    "Note",
    "knowledge",
    "A persistent note using the canonical editor.",
    ["Edit text", "Open note", "Reference in another workspace"],
    "A blank editable note. The same resource remains editable from each placement.",
  ),
  define(
    "research",
    "Research Notebook",
    "knowledge",
    "Record findings, source links and unresolved questions in a research notebook.",
    ["Edit notebook", "Link resources", "Open notebook"],
    "A notebook for your findings and sources. Research agent execution is a separate capability.",
  ),
  define(
    "task",
    "Manual Task",
    "planning",
    "A manually managed to-do with a description, priority and completion state.",
    ["Edit task", "Set open or done", "Open task"],
    "An open task. Status records your change; it does not claim verified agent execution.",
  ),
  define(
    "task_group",
    "Manual Task Group",
    "planning",
    "Group your existing manual tasks. Their checkmarks record manual completion.",
    ["Manage task members", "Inspect member status", "Open task"],
    "An empty group. Adding a task references the existing task identity.",
  ),
  { ...define(
    'checklist', 'Checklist', 'planning',
    'A persistent list of your actionable items, with groups, priorities, due dates and linked sources.',
    ['Add and edit items', 'Check items manually', 'Group and order items', 'Link sources'],
    'An empty checklist. Checkmarks record manual or explicitly reviewed changes; they do not verify agent work.',
  ), requiredServices: ['canonical-resources', 'workspace-engine', 'checklist-service'] },
  { ...define('agent', 'Agent', 'intelligence', 'Keep an existing saved agent, its purpose and supported configuration close to your work.',
    ['Open agent', 'Inspect effective configuration'],
    'References one saved Agent profile. Catalog compatibility does not mean an agent is running.'),
    creation: 'reference-only', requiredServices: ['canonical-resources', 'workspace-engine', 'agent-library'] },
  define(
    "reference",
    "Reference",
    "knowledge",
    "An editable local reference note for links and source descriptions.",
    ["Edit reference", "Link resources", "Open note"],
    "A blank reference. External content is not fetched or embedded automatically.",
  ),
  define(
    "stream",
    "Intelligence Stream",
    "observability",
    "A view of the native host’s recorded intelligence events.",
    ["Inspect recorded events", "Inspect event provenance"],
    "Recorded events only. An empty or disconnected stream is shown truthfully.",
    "recorded-events",
  ),
]);
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
const subjectDefinition = (
  kind: SubjectBlockKind,
  title: string,
  description: string,
  controls: string[],
  subjectKind: NonResourceSubjectRef["kind"],
): BlockDefinition<SubjectBlockKind> => ({
  ...define(
    "reference",
    title,
    "organization",
    description,
    controls,
    "An inert example of the canonical view. No resources or provider requests are created by this preview.",
  ),
  id: "aerynth." + kind,
  kind,
  keywords: [kind, title, subjectKind, "organization", ...controls],
  compatibleResourceKinds: [],
  compatibleSubjectKinds: [subjectKind],
  requiredServices: [
    "canonical-resources",
    "canonical-projects",
    "workspace-engine",
  ],
  defaultPresentation: presentation({
    shape: "rounded",
    ...BLOCK_DEFAULT_SIZES[kind],
  }),
});
export const SUBJECT_BLOCKS: readonly BlockDefinition<SubjectBlockKind>[] =
  deepFreeze([
    subjectDefinition(
      "project_overview",
      "Project Overview",
      "Canonical project workspaces, resource counts, local task status and recorded changes.",
      ["Read project", "Open workspace", "Browse project resources"],
      "project",
    ),
    subjectDefinition(
      "resource_browser",
      "Resource Explorer — Resources",
      "Explore all permitted resources or a saved project/search scope. Open a resource without attaching it.",
      [
        "Search resources",
        "Filter by kind",
        "Find unplaced resources",
        "Attach existing resource",
      ],
      "resource-query",
    ),
    subjectDefinition(
      "collection_browser",
      "Resource Explorer — Collection",
      "Explore an existing collection's members without changing membership or duplicating resources.",
      ["Browse collection", "Open resource", "Attach existing resource"],
      "collection",
    ),
  ]);
export const REGISTERED_BLOCKS: readonly BlockDefinition<BlockInstanceKind>[] =
  deepFreeze([...BUILTIN_BLOCKS, ...SUBJECT_BLOCKS]);
export function catalogDefinition(
  kind: BlockInstanceKind,
): BlockDefinition<BlockInstanceKind> {
  const definition = REGISTERED_BLOCKS.find((item) => item.kind === kind);
  if (!definition)
    throw Object.assign(new Error("unsupported_block_type"), {
      code: "unsupported_block_type",
    });
  return definition;
}
export const blockDefinition = (kind: BlockKind): BlockDefinition => {
  const found = BUILTIN_BLOCKS.find((item) => item.kind === kind);
  if (!found)
    throw Object.assign(new Error("unsupported_block_kind"), {
      code: "unsupported_block_kind",
    });
  return found;
};
export const blockAvailability = (
  kind: BlockInstanceKind,
  capabilities: LibraryCapabilities,
): Availability =>
  (isSubjectBlockKind(kind)
    ? capabilities.subjects?.[kind]
    : capabilities.kinds[kind]) ?? {
    state: "unknown",
    reason: "The host has not advertised this block capability.",
  };
/** Execution availability is resolved separately from the registered rendering/local capabilities. */
export function blockCapabilities(
  kind: BlockKind,
  capabilities: LibraryCapabilities,
  provider?: "local" | "codex",
): BlockCapabilityState[] {
  const state = blockAvailability(kind, capabilities);
  const result: BlockCapabilityState[] = [
    { id: "read", availability: state },
    { id: "attach", availability: state },
  ];
  if (["note", "research", "reference", "task", "task_group"].includes(kind))
    result.push({ id: "edit-local", availability: state });
  if (kind === "conversation") {
    result.push({ id: "compose-local", availability: state });
    result.push({
      id: "provider-execution",
      availability:
        state.state !== "available"
          ? state
          : provider === "codex"
            ? (capabilities.providers.codex ?? {
                state: "unknown",
                reason: "Codex availability has not been checked.",
              })
            : provider === undefined
              ? (capabilities.providers.automatic ?? { state: 'unknown', reason: 'Automatic ordinary chat availability has not been reported.' })
              : {
                state: "unsupported",
                reason:
                  "Manual local conversations record your messages without model execution.",
              },
    });
  }
  return result;
}
export function validateConfiguration(
  value: unknown = { schemaVersion: 1, textScale: 1, contentMode: "auto" },
): BlockConfiguration {
  const input = value as BlockConfiguration;
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (k) => !["schemaVersion", "textScale", "contentMode"].includes(k),
    ) ||
    input.schemaVersion !== 1 ||
    !Number.isFinite(input.textScale) ||
    input.textScale < 0.75 ||
    input.textScale > 2 ||
    !["auto", "compact", "reading"].includes(input.contentMode)
  )
    throw Object.assign(new Error("invalid_block_configuration"), {
      code: "invalid_block_configuration",
    });
  return {
    schemaVersion: 1,
    textScale: input.textScale,
    contentMode: input.contentMode,
  };
}
/** Unknown versions retain their original metadata for a later compatible renderer. */
export function resolveBlockType(id: string, version: number) {
  const manifest = REGISTERED_BLOCKS.find((item) => item.id === id);
  return manifest && manifest.version === version
    ? { state: "available" as const, manifest }
    : {
        state: "unsupported" as const,
        reason: manifest
          ? "Unsupported block manifest version."
          : "Block type is not registered.",
      };
}
export function searchBlocks(
  query: string,
  capabilities: LibraryCapabilities,
  category?: BlockDefinition["category"],
  includeUnavailable = true,
): (BlockDefinition & { availability: Availability })[] {
  const terms = query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 16);
  return BUILTIN_BLOCKS.filter(
    (item) =>
      (!category || item.category === category) &&
      terms.every((term) =>
        (item.title + " " + item.description + " " + item.keywords.join(" "))
          .toLocaleLowerCase()
          .includes(term),
      ),
  )
    .map((item) => ({
      ...item,
      availability: blockAvailability(item.kind, capabilities),
    }))
    .filter(
      (item) => includeUnavailable || item.availability.state === "available",
    );
}
export function searchBlockCatalog(
  query: string,
  capabilities: LibraryCapabilities,
  category?: BlockDefinition["category"],
) {
  const terms = query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 16);
  return REGISTERED_BLOCKS.filter(
    (item) =>
      (!category || item.category === category) &&
      terms.every((term) =>
        (
          item.title +
          " " +
          item.description +
          " " +
          item.keywords.join(" ") +
          " " +
          item.compatibleResourceKinds.join(" ") +
          " " +
          (item.compatibleSubjectKinds ?? []).join(" ")
        )
          .toLocaleLowerCase()
          .includes(term),
      ),
  ).map((item) => ({
    ...item,
    availability: blockAvailability(item.kind, capabilities),
  }));
}
export function assertBlockAvailable(
  kind: BlockKind,
  capabilities: LibraryCapabilities,
  provider?: "local" | "codex",
): void {
  blockDefinition(kind);
  const state = blockAvailability(kind, capabilities);
  if (state.state !== "available")
    throw Object.assign(
      new Error("block_unavailable: " + (state.reason ?? state.state)),
      { code: "block_unavailable" },
    );
  if (provider !== undefined) {
    if (kind !== "conversation")
      throw Object.assign(new Error("provider_only_for_conversation"), {
        code: "provider_only_for_conversation",
      });
    if (!["local", "codex"].includes(provider))
      throw Object.assign(new Error("unsupported_provider"), {
        code: "unsupported_provider",
      });
    const available = capabilities.providers[provider];
    if (available?.state !== "available")
      throw Object.assign(
        new Error(
          "provider_unavailable: " +
            (available?.reason ?? available?.state ?? "unknown"),
        ),
        { code: "provider_unavailable" },
      );
  }
}
export function validateCreateBlock(
  input: CreateBlockInput,
  capabilities: LibraryCapabilities,
): CreateBlockInput & { presentation: Presentation } {
  if (
    !input ||
    typeof input !== "object" ||
    Object.keys(input).some(
      (k) =>
        ![
          "commandId",
          "workspaceId",
          "expectedLayoutVersion",
          "kind",
          "title",
          "provider",
          "bounds",
          "presentation",
          "configuration",
        ].includes(k),
    )
  )
    throw Object.assign(new Error("invalid_create_block"), {
      code: "invalid_create_block",
    });
  if (
    typeof input.commandId !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,198}$/.test(input.commandId) ||
    typeof input.workspaceId !== "string" ||
    !input.workspaceId ||
    input.workspaceId.length > 200 ||
    !Number.isInteger(input.expectedLayoutVersion) ||
    input.expectedLayoutVersion < 1
  )
    throw Object.assign(new Error("invalid_create_block"), {
      code: "invalid_create_block",
    });
  if (
    typeof input.title !== "string" ||
    !input.title.trim() ||
    input.title.length > 120
  )
    throw Object.assign(new Error("invalid_title"), { code: "invalid_title" });
  assertBlockAvailable(input.kind, capabilities, input.provider);
  if (blockDefinition(input.kind).creation === 'reference-only')
    throw Object.assign(new Error('agent_library_creation_required'), { code: 'agent_library_creation_required' });
  return {
    ...input,
    title: input.title.trim(),
    configuration: validateConfiguration(input.configuration),
    presentation: presentation(
      input.presentation ?? {},
      blockDefinition(input.kind).defaultPresentation,
    ),
  };
}
