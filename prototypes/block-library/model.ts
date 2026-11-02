import type { DesktopSnapshot } from "../application-contract/contracts.ts";
import { presentation } from "../workspace-engine/geometry.mts";
import {
  defaultOrganization,
  updateOrganization,
} from "../workspace-engine/organization.mts";
import type {
  CaptureChoices,
  TemplateBody,
  TemplateDraft,
  TemplateResourceRole,
  BlockConfiguration,
  TemplatePlacementRole,
  TemplateSubjectBinding,
  SubjectCaptureChoices,
} from "./contracts.ts";
import {
  validateSubjectRef,
  type NonResourceSubjectRef,
} from "../workspace-kernel/subjects.ts";
import { blockDefinition, validateConfiguration, BUILTIN_BLOCKS } from "./registry.ts";

export const TEMPLATE_LIMITS = {
  templates: 256,
  resources: 64,
  placements: 64,
  bodyBytes: 65536,
  receipts: 4096,
} as const;
export function check(condition: unknown, code: string): asserts condition {
  if (!condition) throw Object.assign(new Error(code), { code });
}
const object = (value: any, keys: string[]) =>
  check(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).every((k) => keys.includes(k)),
    "invalid_template_fields",
  );
export const text = (value: unknown, max = 120): string => {
  check(
    typeof value === "string" && value.trim().length > 0 && value.length <= max,
    "invalid_template_text",
  );
  return value.trim();
};
export const version = (value: unknown): number => {
  check(Number.isInteger(value) && Number(value) >= 1, "invalid_version");
  return Number(value);
};
export const key = (value: unknown): string => {
  check(
    typeof value === "string" &&
      /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value) &&
      !["constructor", "prototype", "__proto__"].includes(value),
    "invalid_role_key",
  );
  return value;
};
export const identifier = (value: unknown): string => text(value, 200);
export function validateSubjectBinding(
  binding: TemplateSubjectBinding,
): TemplateSubjectBinding {
  object(
    binding,
    binding?.mode === "reference"
      ? ["mode", "subject"]
      : ["mode", "view", "query", "kinds"],
  );
  if (binding.mode === "reference") {
    const subject = validateSubjectRef(binding.subject);
    check(subject.kind !== "resource", "template_subject_must_not_be_resource");
    return { mode: "reference", subject };
  }
  check(
    binding.mode === "project-context" &&
      ["project", "resource-query"].includes(binding.view),
    "invalid_template_subject_binding",
  );
  if (binding.view === "project") {
    check(
      binding.query === undefined && binding.kinds === undefined,
      "invalid_project_context",
    );
    return { mode: "project-context", view: "project" };
  }
  const query = validateSubjectRef({
    kind: "resource-query",
    projectId: null,
    query: binding.query ?? "",
    ...(binding.kinds ? { kinds: binding.kinds } : {}),
  });
  check(query.kind === "resource-query", "invalid_template_query");
  return {
    mode: "project-context",
    view: "resource-query",
    query: query.query,
    ...(query.kinds ? { kinds: query.kinds } : {}),
  };
}
export function resolveTemplateSubject(
  binding: TemplateSubjectBinding,
  projectId: string | null,
): NonResourceSubjectRef {
  const valid = validateSubjectBinding(binding);
  if (valid.mode === "reference") return valid.subject;
  if (valid.view === "project") {
    check(projectId !== null, "project_context_required");
    return { kind: "project", projectId };
  }
  return {
    kind: "resource-query",
    projectId,
    query: valid.query ?? "",
    ...(valid.kinds ? { kinds: valid.kinds } : {}),
  };
}
export function validateBody(input: TemplateBody): TemplateBody {
  check(
    new TextEncoder().encode(JSON.stringify(input)).byteLength <=
      TEMPLATE_LIMITS.bodyBytes,
    "template_too_large",
  );
  object(input, [
    "schemaVersion",
    "organization",
    "resources",
    "placements",
    "groups",
    "viewport",
  ]);
  check([1, 2].includes(input.schemaVersion), "unsupported_template_schema");
  object(input.organization, ["schemaVersion", "mode", "gap", "structured"]);
  check(
    input.organization.schemaVersion === 1,
    "unsupported_organization_schema",
  );
  object(input.organization.structured, [
    "columnCount",
    "rowHeight",
    "rowGap",
    "columnGap",
    "margin",
    "preset",
  ]);
  const organization = updateOrganization(defaultOrganization(), {
    mode: input.organization.mode,
    gap: input.organization.gap,
    structured: input.organization.structured,
  });
  const {
    order: _order,
    spans: _spans,
    ...structured
  } = organization.structured;
  check(
    Array.isArray(input.resources) &&
      input.resources.length <= TEMPLATE_LIMITS.resources,
    "template_resource_limit",
  );
  const resources = input.resources.map((role) => {
    object(role, ["key", "label", "source"]);
    const roleKey = key(role.key),
      label = text(role.label);
    object(
      role.source,
      role.source?.mode === "new"
        ? ["mode", "kind", "title", "provider"]
        : ["mode", "kind", "resourceId", "expectedVersion"],
    );
    check(role.source.kind !== 'checklist' || role.source.mode !== 'new', 'checklist_template_reference_required');
    check(role.source.kind !== 'agent' || role.source.mode !== 'new', 'agent_template_reference_required');
    check(role.source.kind !== 'timeline' || role.source.mode !== 'new', 'timeline_template_reference_required');
    check(role.source.kind !== 'task_objective' || role.source.mode !== 'new', 'task_objective_template_reference_required');
    blockDefinition(role.source.kind);
    check(
      ["new", "reference"].includes(role.source.mode),
      "invalid_binding_mode",
    );
    if (role.source.mode === "new") {
      check(role.source.kind !== 'file' && role.source.kind !== 'link', 'media_import_required');
      check(
        role.source.provider === undefined ||
          (role.source.kind === "conversation" &&
            ["local", "codex"].includes(role.source.provider)),
        "invalid_template_provider",
      );
      return {
        key: roleKey,
        label,
        source: {
          mode: "new" as const,
          kind: role.source.kind,
          title: text(role.source.title),
          ...(role.source.provider === undefined
            ? {}
            : { provider: role.source.provider }),
        },
      };
    }
    return {
      key: roleKey,
      label,
      source: {
        mode: "reference" as const,
        kind: role.source.kind,
        resourceId: identifier(role.source.resourceId),
        expectedVersion: version(role.source.expectedVersion),
      },
    };
  });
  check(
    new Set(resources.map((r) => r.key)).size === resources.length,
    "duplicate_resource_role",
  );
  const byKey = new Map(resources.map((r) => [r.key, r]));
  check(
    Array.isArray(input.placements) &&
      input.placements.length <= TEMPLATE_LIMITS.placements,
    "template_placement_limit",
  );
  const placements = input.placements.map((role): TemplatePlacementRole => {
    object(role, [
      "key",
      "resourceKey",
      "presentation",
      "span",
      "configuration",
      "subjectBinding",
    ]);
    const placementKey = key(role.key);
    let binding:
      | { resourceKey: string; subjectBinding?: never }
      | { resourceKey?: never; subjectBinding: TemplateSubjectBinding };
    if (role.resourceKey !== undefined) {
      check(role.subjectBinding === undefined, "ambiguous_placement_binding");
      const resourceKey = key(role.resourceKey);
      check(byKey.has(resourceKey), "placement_resource_missing");
      binding = { resourceKey };
    } else {
      check(input.schemaVersion === 2, "unsupported_template_schema");
      binding = {
        subjectBinding: validateSubjectBinding(role.subjectBinding!),
      };
    }
    if (role.span !== undefined) {
      object(role.span, ["columns", "rows"]);
      check(
        Number.isInteger(role.span.columns) &&
          role.span.columns > 0 &&
          role.span.columns <= 128 &&
          Number.isInteger(role.span.rows) &&
          role.span.rows > 0 &&
          role.span.rows <= 256,
        "invalid_template_span",
      );
    }
    return {
      key: placementKey,
      ...binding,
      presentation: presentation(role.presentation),
      ...(role.span ? { span: { ...role.span } } : {}),
      ...(role.configuration
        ? { configuration: validateConfiguration(role.configuration) }
        : {}),
    };
  });
  check(
    new Set(placements.map((p) => p.key)).size === placements.length,
    "duplicate_placement_role",
  );
  check(
    resources.every((r) => placements.some((p) => p.resourceKey === r.key)),
    "unplaced_template_resource",
  );
  check(
    Array.isArray(input.groups) &&
      input.groups.length <= TEMPLATE_LIMITS.resources,
    "invalid_template_groups",
  );
  const groups = input.groups.map((group) => {
    object(group, ["groupKey", "taskKeys"]);
    const groupKey = key(group.groupKey),
      role = byKey.get(groupKey);
    check(
      role?.source.mode === "new" && role.source.kind === "task_group",
      "group_must_be_new",
    );
    check(
      Array.isArray(group.taskKeys) &&
        group.taskKeys.length <= TEMPLATE_LIMITS.resources &&
        new Set(group.taskKeys).size === group.taskKeys.length,
      "invalid_group_members",
    );
    const taskKeys = group.taskKeys.map(key);
    check(
      taskKeys.every((k) => byKey.get(k)?.source.kind === "task"),
      "group_member_must_be_task",
    );
    return { groupKey, taskKeys };
  });
  check(
    new Set(groups.map((g) => g.groupKey)).size === groups.length,
    "duplicate_template_group",
  );
  object(input.viewport, ["x", "y", "zoom"]);
  check(
    [input.viewport.x, input.viewport.y, input.viewport.zoom].every(
      Number.isFinite,
    ) &&
      Math.abs(input.viewport.x) <= 1e6 &&
      Math.abs(input.viewport.y) <= 1e6 &&
      input.viewport.zoom >= 0.05 &&
      input.viewport.zoom <= 4,
    "invalid_template_viewport",
  );
  return {
    schemaVersion: input.schemaVersion,
    organization: {
      schemaVersion: 1,
      mode: organization.mode,
      gap: organization.gap,
      structured,
    },
    resources,
    placements,
    groups,
    viewport: { ...input.viewport },
  };
}
export function validateDraft(input: TemplateDraft): TemplateDraft {
  check(input && typeof input === "object", "invalid_template");
  const name = text(input.name),
    description =
      typeof input.description === "string" && input.description.length <= 500
        ? input.description.trim()
        : null;
  check(
    description !== null &&
      Array.isArray(input.tags) &&
      input.tags.length <= 16,
    "invalid_template_metadata",
  );
  const tags = [...new Set(input.tags.map((t) => text(t, 32)))];
  return { name, description, tags, body: validateBody(input.body) };
}

/** Explicit binding choice for EVERY canonical resource; content and provider/session histories are never read. */
export function captureWorkspaceTemplate(
  snapshot: DesktopSnapshot,
  choices: CaptureChoices,
  configurations: Record<string, BlockConfiguration> = {},
  subjectChoices: SubjectCaptureChoices = {},
): TemplateBody {
  check(snapshot.activeWorkspaceId, "workspace_required");
  const blocks = snapshot.blocks.filter(
    (b) => b.workspace_id === snapshot.activeWorkspaceId,
  );
  const resourceIds = [
    ...new Set(blocks.flatMap((b) => (b.resource_id ? [b.resource_id] : []))),
  ];
  check(
    resourceIds.length <= TEMPLATE_LIMITS.resources &&
      blocks.length <= TEMPLATE_LIMITS.placements,
    "template_capacity_exceeded",
  );
  const roles = new Map(resourceIds.map((id, i) => [id, "resource" + (i + 1)]));
  const resources: TemplateResourceRole[] = resourceIds.map((id) => {
    const r = snapshot.resources.find((resource) => resource.id === id);
    check(
      r &&
        r.available !== false &&
        r.visible !== false &&
        r.state !== "archived",
      "resource_unavailable",
    );
    const manifest = BUILTIN_BLOCKS.find(definition => definition.kind === r.kind);
    check(manifest, 'unsupported_resource_presentation');
    const kind = manifest.kind;
    check(kind !== 'checklist' || choices[id] === 'reference', 'checklist_template_reference_required');
    check(kind !== 'agent' || choices[id] === 'reference', 'agent_template_reference_required');
    check(kind !== 'timeline' || choices[id] === 'reference', 'timeline_template_reference_required');
    check(kind !== 'task_objective' || choices[id] === 'reference', 'task_objective_template_reference_required');
    check(
      choices[id] === "reference" || choices[id] === "new",
      "binding_choice_required",
    );
    check((r.kind !== 'file' && r.kind !== 'link') || choices[id] === 'reference', 'media_import_required');
    return {
      key: roles.get(id)!,
      label: r.title,
      source:
        choices[id] === "reference"
          ? {
              mode: "reference",
              kind,
              resourceId: r.id,
              expectedVersion: r.version,
            }
          : {
              mode: "new",
              kind,
              title: r.title,
              ...(r.kind === "conversation" ? { provider: r.provider } : {}),
            },
    };
  });
  const organization = snapshot.organization ?? defaultOrganization();
  const {
    order: _order,
    spans: _spans,
    ...structured
  } = organization.structured;
  const ordered = [...blocks].sort((a, b) => {
    const ai = organization.structured.order.indexOf(a.id),
      bi = organization.structured.order.indexOf(b.id);
    return (
      (ai < 0 ? blocks.indexOf(a) + blocks.length : ai) -
      (bi < 0 ? blocks.indexOf(b) + blocks.length : bi)
    );
  });
  const placements = ordered.map(
    (b, i): TemplatePlacementRole => ({
      key: "placement" + (i + 1),
      ...(b.resource_id
        ? { resourceKey: roles.get(b.resource_id)! }
        : {
            subjectBinding: (() => {
              const subject = validateSubjectRef(b.subject);
              check(
                subject.kind !== "resource",
                "template_subject_must_not_be_resource",
              );
              check(
                subjectChoices[b.id] === "reference" ||
                  subjectChoices[b.id] === "project-context",
                "subject_binding_choice_required",
              );
              if (subjectChoices[b.id] === "reference")
                return { mode: "reference" as const, subject };
              check(
                subject.kind === "project" ||
                  (subject.kind === "resource-query" && !subject.collectionId),
                "subject_context_binding_unavailable",
              );
              return subject.kind === "project"
                ? { mode: "project-context" as const, view: "project" as const }
                : {
                    mode: "project-context" as const,
                    view: "resource-query" as const,
                    query: subject.query,
                    ...(subject.kinds ? { kinds: subject.kinds } : {}),
                  };
            })(),
          }),
      presentation: presentation({
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        zIndex: b.z,
        shape: b.shape,
        rotation: b.rotation ?? 0,
        minimized: b.minimized ?? false,
        locked: b.locked ?? false,
        materialVariant: b.materialVariant ?? "default",
      }),
      ...(organization.structured.spans[b.id]
        ? { span: { ...organization.structured.spans[b.id] } }
        : {}),
      ...(configurations[b.id]
        ? { configuration: validateConfiguration(configurations[b.id]) }
        : {}),
    }),
  );
  const groups = resources
    .filter((r) => r.source.mode === "new" && r.source.kind === "task_group")
    .map((r) => ({
      groupKey: r.key,
      taskKeys: snapshot.relationships
        .filter(
          (edge) =>
            edge.source_id ===
              resourceIds.find((id) => roles.get(id) === r.key) &&
            edge.kind === "contains_task",
        )
        .map((edge) => roles.get(edge.target_id))
        .filter((k): k is string => !!k),
    }));
  return validateBody({
    schemaVersion: placements.some((p) => p.subjectBinding) ? 2 : 1,
    organization: {
      schemaVersion: 1,
      mode: organization.mode,
      gap: organization.gap,
      structured,
    },
    resources,
    placements,
    groups,
    viewport: {
      x: snapshot.viewport?.x ?? 0,
      y: snapshot.viewport?.y ?? 0,
      zoom: snapshot.viewport?.zoom ?? 1,
    },
  });
}

export function predefinedTemplates(): (TemplateDraft & { id: string })[] {
  const build = (
    id: string,
    name: string,
    description: string,
    entries: [string, TemplateResourceRole["source"] & { mode: "new" }][],
    mode: "fluid" | "structured",
    preset: "balanced" | "development" | "research",
  ) => {
    const o = defaultOrganization(),
      { order: _order, spans: _spans, ...structured } = o.structured;
    const resources = entries.map(([roleKey, source]) => ({
      key: roleKey,
      label: source.title,
      source,
    }));
    const body: TemplateBody = {
      schemaVersion: 1,
      organization: {
        schemaVersion: 1,
        mode,
        gap: 12,
        structured: { ...structured, preset },
      },
      resources,
      placements: resources.map((r, i) => ({
        key: "placement" + (i + 1),
        resourceKey: r.key,
        presentation: presentation({
          x: 32 + (i % 3) * 440,
          y: 32 + Math.floor(i / 3) * 320,
          width: i === 0 ? 560 : 400,
          height: i === 0 ? 440 : 280,
          zIndex: i,
          shape: r.source.kind === "note" ? "folio" : "rounded",
        }),
        span: { columns: i === 0 ? 2 : 1, rows: i === 0 ? 4 : 2 },
      })),
      groups: resources
        .filter((r) => r.source.kind === "task_group")
        .map((r) => ({
          groupKey: r.key,
          taskKeys: resources
            .filter((t) => t.source.kind === "task")
            .map((t) => t.key),
        })),
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    return {
      id,
      name,
      description,
      tags: [name.toLowerCase()],
      body: validateBody(body),
    };
  };
  const role = (
    kind: TemplateResourceRole["source"]["kind"],
    title: string,
  ): TemplateResourceRole["source"] & { mode: "new" } => ({
    mode: "new",
    kind,
    title,
  });
  return [
    build(
      "builtin:blank",
      "Blank",
      "An empty Fluid workspace. Add the blocks you need.",
      [],
      "fluid",
      "balanced",
    ),
    build(
      "builtin:development",
      "Development",
      "A conversation, implementation notes, a task and its task group.",
      [
        ["conversation", role("conversation", "Development conversation")],
        ["notes", role("note", "Implementation notes")],
        ["task", role("task", "Next implementation task")],
        ["group", role("task_group", "Development tasks")],
      ],
      "structured",
      "development",
    ),
    build(
      "builtin:research",
      "Research",
      "A conversation, research notebook, findings note, task and task group.",
      [
        ["conversation", role("conversation", "Research conversation")],
        ["research", role("research", "Research notebook")],
        ["notes", role("note", "Findings and questions")],
        ["task", role("task", "Next research question")],
        ["group", role("task_group", "Research tasks")],
      ],
      "structured",
      "research",
    ),
    build(
      "builtin:planning",
      "Planning",
      "A planning conversation, plan note, two tasks and a task group.",
      [
        ["conversation", role("conversation", "Planning conversation")],
        ["notes", role("note", "Plan and decisions")],
        ["first", role("task", "First milestone")],
        ["next", role("task", "Next milestone")],
        ["group", role("task_group", "Plan tasks")],
      ],
      "structured",
      "balanced",
    ),
  ];
}
