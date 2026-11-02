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
export const subjectBlockKind = (
  subject: NonResourceSubjectRef,
): SubjectBlockKind =>
  subject.kind === "project"
    ? "project_overview"
    : subject.kind === "collection"
      ? "collection_browser"
      : "resource_browser";

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
        : []),
  ],
  defaultPresentation: presentation({
    shape: kind === "note" ? "folio" : kind === "research" ? "lens" : "rounded",
    width: kind === "conversation" ? 520 : kind === "task" ? 320 : 400,
    height: kind === "conversation" ? 400 : kind === "task" ? 220 : 280,
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
    "Research",
    "knowledge",
    "A research note for sources, findings and unresolved questions.",
    ["Edit research", "Link resources", "Open note"],
    "A blank research note. It does not perform an automatic investigation.",
  ),
  define(
    "task",
    "Task",
    "planning",
    "A persistent task with canonical open and done controls.",
    ["Edit task", "Set open or done", "Open task"],
    "An open task. Status records your change; it does not claim verified agent execution.",
  ),
  define(
    "task_group",
    "Task group",
    "planning",
    "A collection of canonical task references, with membership managed by the host.",
    ["Manage task members", "Inspect member status", "Open task"],
    "An empty group. Adding a task references the existing task identity.",
  ),
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
export const blockDefinition = (kind: BlockKind): BlockDefinition => {
  const found = BUILTIN_BLOCKS.find((item) => item.kind === kind);
  if (!found)
    throw Object.assign(new Error("unsupported_block_kind"), {
      code: "unsupported_block_kind",
    });
  return found;
};
export const blockAvailability = (
  kind: BlockKind,
  capabilities: LibraryCapabilities,
): Availability =>
  capabilities.kinds[kind] ?? {
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
            : {
                state: "unsupported",
                reason:
                  "Local conversations store your messages. No ordinary model provider is connected.",
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
  const manifest = BUILTIN_BLOCKS.find((item) => item.id === id);
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
