import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { WorkspaceKernel } from "../../workspace-kernel/kernel.mts";
import {
  AgentLibraryService,
  AgentLibraryError,
  agentTemplates,
} from "../../agent-product/service.mts";
import type {
  AgentHostPort,
  AgentProviderCatalog,
  AgentRef,
} from "../../agent-product/contracts.ts";
import { ChecklistService } from "../../checklist-product/service.mts";
import type {
  ChecklistHostPort,
  ChecklistReference,
} from "../../checklist-product/contracts.ts";

type Command<I, O> = { input: I; output: O };
export interface ProductProjectPage {
  items: { id: string; title: string; version: number }[];
  coverage: "complete" | "bounded";
}
export interface AgentCommandMap {
  list: Command<
    NonNullable<Parameters<AgentLibraryService["list"]>[0]>,
    ReturnType<AgentLibraryService["list"]>
  >;
  templates: Command<Record<string, never>, ReturnType<typeof agentTemplates>>;
  projects: Command<Record<string, never>, ProductProjectPage>;
  catalog: Command<Record<string, never>, AgentProviderCatalog | null>;
  inspect: Command<
    { resourceId: string },
    ReturnType<AgentLibraryService["inspect"]>
  >;
  effective: Command<
    { agent: AgentRef; projectId?: string | null },
    ReturnType<AgentLibraryService["effective"]>
  >;
  create: Command<
    Parameters<AgentLibraryService["create"]>[0],
    ReturnType<AgentLibraryService["create"]>
  >;
  update: Command<
    Parameters<AgentLibraryService["update"]>[0],
    ReturnType<AgentLibraryService["update"]>
  >;
  archive: Command<
    Parameters<AgentLibraryService["archive"]>[0],
    ReturnType<AgentLibraryService["archive"]>
  >;
  recordAssignment: Command<
    Parameters<AgentLibraryService["recordAssignment"]>[0],
    ReturnType<AgentLibraryService["recordAssignment"]>
  >;
  assignment: Command<
    { id: string },
    ReturnType<AgentLibraryService["assignment"]>
  >;
}
export interface ChecklistCommandMap {
  create: Command<
    Parameters<ChecklistService["create"]>[0],
    ReturnType<ChecklistService["create"]>
  >;
  read: Command<{ resourceId: string }, ReturnType<ChecklistService["read"]>>;
  mutate: Command<
    Parameters<ChecklistService["mutate"]>[0],
    ReturnType<ChecklistService["mutate"]>
  >;
}
export type AgentRequest = {
  [K in keyof AgentCommandMap]: { name: K; input: AgentCommandMap[K]["input"] };
}[keyof AgentCommandMap];
export type ChecklistRequest = {
  [K in keyof ChecklistCommandMap]: {
    name: K;
    input: ChecklistCommandMap[K]["input"];
  };
}[keyof ChecklistCommandMap];
export type AgentResponse = AgentCommandMap[keyof AgentCommandMap]["output"];
export type ChecklistResponse =
  ChecklistCommandMap[keyof ChecklistCommandMap]["output"];
export interface DomainEvent {
  type:
    | "agent.created"
    | "agent.changed"
    | "agent.archived"
    | "agent.restored"
    | "agent.assignment-recorded"
    | "checklist.created"
    | "checklist.changed";
  resourceId: string;
  resourceVersion: number;
  commandId: string;
  /** Bounded metadata/provenance only. No titles, instructions or entry plaintext. */
  detail: {
    domain: "agent" | "checklist";
    operation:
      | "create"
      | "update"
      | "archive"
      | "restore"
      | "assign"
      | "mutate";
    principalId: "local-owner";
    actorKind: "user";
    authority: "manual";
    profileVersion?: number;
    assignmentId?: string;
    taskId?: string;
    taskVersion?: number;
    taskOrigin?: "manual-compatibility";
    operationTypes?: string[];
    entryCount?: number;
    groupCount?: number;
    affectedIds?: string[];
    affectedIdsTruncated?: boolean;
  };
}
export interface ProductDomainsOptions {
  kernel: WorkspaceKernel;
  db: DatabaseSync;
  projectAccess(id: string): boolean;
  /** Must validate current canonical identity; messageId requires an actual visible message. */
  resourceAccess(id: string, messageId?: string): boolean;
  /** Already observed public metadata only; never probes/connects/providers here. */
  catalog(): AgentProviderCatalog | null;
  /** Called INSIDE canonical transaction. Root buffers delivery until outer commit. */
  recordEvent(event: DomainEvent): void;
}
export interface ProductDomains {
  agent<K extends keyof AgentCommandMap>(request: {
    name: K;
    input: AgentCommandMap[K]["input"];
  }): AgentCommandMap[K]["output"];
  checklist<K extends keyof ChecklistCommandMap>(request: {
    name: K;
    input: ChecklistCommandMap[K]["input"];
  }): ChecklistCommandMap[K]["output"];
}
export class ProductDomainError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "ProductDomainError";
  }
}
const check: (value: unknown, code: string) => asserts value = (
  value,
  code,
) => {
  if (!value) throw new ProductDomainError(code);
};
const record = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const fields = (
  value: unknown,
  allowed: string[],
  required = allowed,
): value is Record<string, any> =>
  record(value) &&
  Reflect.ownKeys(value).every(
    (key) => typeof key === "string" && allowed.includes(key),
  ) &&
  required.every((key) => Object.hasOwn(value, key));
const id = (value: unknown, max = 200): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= max &&
  value.trim() === value &&
  !/[\x00-\x1f]/.test(value);
const agentReads = new Set([
  "list",
  "templates",
  "projects",
  "catalog",
  "inspect",
  "effective",
  "assignment",
]);
const names = new Set([
  ...agentReads,
  "create",
  "update",
  "archive",
  "recordAssignment",
]);
const envelope = (value: unknown): value is { name: string; input: unknown } =>
  fields(value, ["name", "input"]) && typeof value.name === "string";
export function isAgentRead(value: unknown): boolean {
  return envelope(value) && agentReads.has((value as AgentRequest).name);
}
export function isChecklistRead(value: unknown): boolean {
  return envelope(value) && (value as ChecklistRequest).name === "read";
}
const policyVersion = "aerynth.local-owner@1";
const identity = { principalId: "local-owner", policyVersion } as const;
const provenance = {
  principalId: "local-owner",
  actorKind: "user",
  authority: "manual",
} as const;

/** Additive services on Root's live connection. Does not own resources, history,
 * executions, event storage, windows or a second connection. New service per call
 * deliberately avoids stale initialized caches after an outer SQLite rollback. */
export function compositeProductDomains(
  options: ProductDomainsOptions,
): ProductDomains {
  const { kernel, db } = options;
  for (const callback of [
    "projectAccess",
    "resourceAccess",
    "catalog",
    "recordEvent",
  ] as const)
    check(
      typeof options[callback] === "function",
      "product_domain_host_required",
    );
  const tx = <T,>(work: () => T): T =>
    kernel.withTransaction((actual) => {
      check(actual === db, "canonical_connection_required");
      return work();
    });
  tx(() =>
    check(
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='desktop_resources'",
        )
        .get(),
      "canonical_resource_projection_required",
    ),
  );
  const permit = (work: () => boolean) => {
    try {
      return work() === true;
    } catch {
      return false;
    }
  };
  const project = (projectId: string) => {
    if (!id(projectId) || !permit(() => options.projectAccess(projectId)))
      return null;
    const p = db
      .prepare("SELECT id,title,version,state FROM projects WHERE id=?")
      .get(projectId);
    return p?.state === "active"
      ? {
          id: String(p.id),
          title: String(p.title),
          version: Number(p.version),
          state: "active" as const,
        }
      : null;
  };
  const resource = (resourceId: string) => {
    if (!id(resourceId, 512)) return null;
    const r = db
      .prepare(
        "SELECT r.id,r.kind AS canonical_kind,r.project_id,r.title,r.version,r.state,d.kind FROM resources r LEFT JOIN desktop_resources d ON d.resource_id=r.id WHERE r.id=?",
      )
      .get(resourceId);
    if (
      !r ||
      (r.project_id && !project(String(r.project_id))) ||
      !permit(() => options.resourceAccess(resourceId))
    )
      return null;
    return {
      id: String(r.id),
      kind: String(r.kind ?? r.canonical_kind),
      title: String(r.title),
      projectId: r.project_id as string | null,
      version: Number(r.version),
      state: r.state as "active" | "archived",
      canonicalKind: String(r.canonical_kind),
    };
  };
  const agentResource: AgentHostPort["resource"] = (resourceId) => {
    const r = resource(resourceId);
    return r?.canonicalKind === "generic" && r.kind === "agent"
      ? {
          id: r.id,
          kind: "agent",
          title: r.title,
          projectId: r.projectId,
          version: r.version,
          state: r.state,
        }
      : null;
  };
  const task: AgentHostPort["task"] = (resourceId) => {
    const r = resource(resourceId);
    return r?.kind === "task" &&
      r.canonicalKind === "note" &&
      r.state === "active"
      ? {
          id: r.id,
          kind: "task",
          version: r.version,
          projectId: r.projectId,
          state: r.state,
          supportedTaskOrigin: "manual-compatibility",
        }
      : null;
  };
  const create = (
    kind: "agent" | "checklist",
    title: string,
    projectId: string | null,
    commandId?: string,
  ) => {
    check(
      projectId === null || project(projectId),
      "product_project_unavailable",
    );
    const r = kernel.createGenericResource(title, projectId, {
      origin: "user",
      correlationId: commandId,
    });
    db.prepare(
      "INSERT INTO desktop_resources(resource_id,kind) VALUES(?,?)",
    ).run(r.id, kind);
    const value = resource(r.id);
    check(
      value?.kind === kind && value.state === "active",
      "product_resource_unavailable",
    );
    return value;
  };
  function catalog(): AgentProviderCatalog | null {
    let source: AgentProviderCatalog | null;
    try {
      source = options.catalog();
    } catch {
      throw new AgentLibraryError("agent_catalog_unavailable");
    }
    if (source === null) return null;
    check(
      id(source?.revision) &&
        Array.isArray(source.providers) &&
        source.providers.length <= 32,
      "agent_catalog_unavailable",
    );
    check(
      Buffer.byteLength(JSON.stringify(source)) <= 2 * 1024 * 1024,
      "agent_catalog_capacity",
    );
    const providers = source.providers.map((p) => {
      check(
        id(p.id) &&
          ["available", "unavailable", "unknown"].includes(p.state) &&
          Array.isArray(p.models) &&
          p.models.length <= 256 &&
          Array.isArray(p.capabilities) &&
          p.capabilities.length <= 128 &&
          p.capabilities.every((value) => id(value)),
        "agent_catalog_unavailable",
      );
      const models = p.models.map((m) => {
        check(
          id(m.id) &&
            Array.isArray(m.reasoningEfforts) &&
            m.reasoningEfforts.length <= 32 &&
            m.reasoningEfforts.every((value) => id(value)),
          "agent_catalog_unavailable",
        );
        return { id: m.id, reasoningEfforts: [...m.reasoningEfforts] };
      });
      check(
        new Set(models.map((m) => m.id)).size === models.length,
        "agent_catalog_unavailable",
      );
      return {
        id: p.id,
        state: p.state,
        models,
        capabilities: [...p.capabilities],
      };
    });
    check(
      new Set(providers.map((p) => p.id)).size === providers.length,
      "agent_catalog_unavailable",
    );
    return { revision: source.revision, providers };
  }
  const agentHost: AgentHostPort = {
    identity: () => identity,
    authorize: (input) => {
      const a = input.agent
        ? agentResource(input.agent.id, input.operation)
        : undefined;
      const p = input.project ? project(input.project.id) : undefined;
      const t = input.task ? task(input.task.id) : undefined;
      const allowed =
        (!input.agent || (a && a.version === input.agent.version)) &&
        (!input.project || (p && p.version === input.project.version)) &&
        (!input.task || (t && t.version === input.task.version)) &&
        !input.execution;
      return {
        decision: allowed ? "allow" : "deny",
        policyVersion,
        authorizationRef:
          "local-owner:" +
          createHash("sha256").update(JSON.stringify(input)).digest("hex"),
      };
    },
    resource: agentResource,
    project,
    createResource: (input) => {
      const r = create("agent", input.title, input.projectId, input.commandId);
      return agentResource(r.id, "create")!;
    },
    renameResource: (input) => {
      check(agentResource(input.id, "update"), "agent_resource_unavailable");
      kernel.renameResource(input.id, input.title, input.expectedVersion, {
        origin: "user",
        correlationId: input.commandId,
      });
      return agentResource(input.id, "update")!;
    },
    touchResource: (input) => {
      check(agentResource(input.id, "update"), "agent_resource_unavailable");
      kernel.touchGenericResource(input.id, input.expectedVersion, {
        origin: "user",
        correlationId: input.commandId,
      });
      return agentResource(input.id, "update")!;
    },
    archiveResource: (input) => {
      check(
        agentResource(input.id, input.archived ? "archive" : "restore"),
        "agent_resource_unavailable",
      );
      kernel.setResourceArchived(
        input.id,
        input.archived,
        input.expectedVersion,
        { origin: "user", correlationId: input.commandId },
      );
      return agentResource(input.id, input.archived ? "archive" : "restore")!;
    },
    configurationLayers: (projectId) =>
      projectId === null || project(projectId)
        ? {
            policyVersion,
            layers: [
              {
                scope: "global",
                id: null,
                version: "1",
                settings: {
                  providerId: null,
                  modelId: null,
                  reasoningEffort: null,
                  additionalInstructions: "",
                  requiredCapabilities: [],
                },
              },
            ],
          }
        : null,
    providerCatalog: catalog,
    task,
    execution: () => null,
  };
  const expected = {
    agent: [
      "agent_product_schema",
      "agent_product_profiles",
      "agent_product_versions",
      "agent_product_assignments",
      "agent_product_operations",
    ],
    checklist: [
      "checklist_schema",
      "checklist_documents",
      "checklist_receipts",
    ],
  };
  function schema(domain: "agent" | "checklist") {
    const found = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name GLOB ?",
      )
      .all(domain === "agent" ? "agent_product_*" : "checklist_*")
      .map((row) => String(row.name));
    if (!found.length) return false;
    check(
      found.length === expected[domain].length &&
        expected[domain].every((name) => found.includes(name)),
      domain + "_partial_schema",
    );
    const versions = db
      .prepare("SELECT version FROM " + expected[domain][0])
      .all();
    check(
      versions.length === 1 && versions[0]!.version === 1,
      domain + "_unsupported_schema",
    );
    return true;
  }
  const agentService = (allowCreate: boolean) => {
    check(schema("agent") || allowCreate, "agent_profile_unavailable");
    return new AgentLibraryService({
      db,
      transaction: (work) => tx(() => work(db)),
      readTransaction: (work) => tx(() => work(db)),
      host: agentHost,
    });
  };
  const checklistService = (allowCreate: boolean, commandId?: string) => {
    check(schema("checklist") || allowCreate, "checklist_unavailable");
    const host: ChecklistHostPort = {
      db,
      atomic: tx,
      createResource: (input) =>
        create("checklist", input.title, input.projectId, commandId),
      readResource: (resourceId) => {
        const r = resource(resourceId);
        if (!r || r.canonicalKind !== "generic" || r.kind !== "checklist")
          return null;
        return {
          resource: r,
          authorized: true,
          writable: r.state === "active",
        };
      },
      touchResource: (input) => {
        const r = resource(input.resourceId);
        check(
          r?.kind === "checklist" &&
            r.canonicalKind === "generic" &&
            r.state === "active",
          "checklist_unavailable",
        );
        kernel.touchGenericResource(r.id, input.expectedVersion, {
          origin: "user",
          correlationId: commandId,
        });
        return resource(r.id)!;
      },
      resolveReference: (reference: ChecklistReference) => {
        if (reference.kind === "project") {
          const p = project(reference.projectId);
          return p ? { available: true, title: p.title } : { available: false };
        }
        if (
          reference.kind === "resource" ||
          reference.kind === "conversation"
        ) {
          const r = resource(reference.resourceId);
          if (
            !r ||
            r.state !== "active" ||
            (reference.kind === "conversation" &&
              r.canonicalKind !== "conversation")
          )
            return { available: false };
          if (
            reference.kind === "conversation" &&
            reference.messageId !== undefined &&
            !permit(() => options.resourceAccess(r.id, reference.messageId))
          )
            return { available: false };
          return { available: true, title: r.title };
        }
        return { available: false };
      },
      mutationContext: () => ({
        actor: { kind: "user", id: "local-owner" },
        authority: "manual",
        at: new Date().toISOString(),
      }),
      recordEvent: (event) =>
        options.recordEvent({
          type: event.type,
          resourceId: event.resourceId,
          resourceVersion: event.resourceVersion,
          commandId: event.detail.commandId,
          detail: {
            ...provenance,
            domain: "checklist",
            operation: event.type === "checklist.created" ? "create" : "mutate",
            operationTypes: event.detail.operationTypes.slice(0, 16),
            entryCount: event.detail.entryCount,
            groupCount: event.detail.groupCount,
            affectedIds: event.detail.affectedIds.slice(0, 32),
            affectedIdsTruncated:
              event.detail.affectedIdsTruncated ||
              event.detail.affectedIds.length > 32,
          },
        }),
    };
    return new ChecklistService(kernel, host);
  };
  const request = (value: unknown, family: "agent" | "checklist") => {
    check(
      envelope(value) &&
        (family === "agent"
          ? names.has(value.name)
          : ["create", "read", "mutate"].includes(value.name)),
      "unsupported_" + family + "_request",
    );
    check(
      Buffer.byteLength(JSON.stringify(value)) <= 2 * 1024 * 1024,
      "product_request_capacity",
    );
  };
  const empty = (value: unknown) =>
    check(fields(value, []), "product_invalid_input");
  function agent(
    value: AgentRequest,
  ): AgentCommandMap[keyof AgentCommandMap]["output"] {
    request(value, "agent");
    return tx(() => {
      const present = schema("agent");
      switch (value.name) {
        case "templates":
          empty(value.input);
          return agentTemplates();
        case "projects": {
          empty(value.input);
          const candidates = db
            .prepare(
              "SELECT id,title,version FROM projects WHERE state='active' ORDER BY title,id LIMIT 257",
            )
            .all();
          return {
            items: candidates
              .slice(0, 256)
              .filter((p) => project(String(p.id)))
              .map((p) => ({
                id: String(p.id),
                title: String(p.title),
                version: Number(p.version),
              })),
            coverage: candidates.length > 256 ? "bounded" : "complete",
          };
        }
        case "catalog":
          empty(value.input);
          return catalog();
        case "inspect":
          check(
            fields(value.input, ["resourceId"]) && id(value.input.resourceId),
            "agent_invalid_id",
          );
          return agentService(false).inspect(value.input.resourceId);
        case "assignment":
          check(
            fields(value.input, ["id"]) && id(value.input.id),
            "agent_invalid_assignment",
          );
          return agentService(false).assignment(value.input.id);
        case "effective":
          check(
            fields(value.input, ["agent", "projectId"], ["agent"]),
            "agent_invalid_configuration",
          );
          return agentService(false).effective(
            value.input.agent,
            value.input.projectId,
          );
        case "list": {
          check(
            fields(
              value.input,
              ["projectId", "includeArchived", "query", "limit"],
              [],
            ) &&
              (value.input.projectId === undefined ||
                value.input.projectId === null ||
                id(value.input.projectId)) &&
              (value.input.includeArchived === undefined ||
                typeof value.input.includeArchived === "boolean") &&
              (value.input.query === undefined ||
                (typeof value.input.query === "string" &&
                  !value.input.query.includes("\0") &&
                  Buffer.byteLength(value.input.query) <= 200)) &&
              (value.input.limit === undefined ||
                (Number.isSafeInteger(value.input.limit) &&
                  value.input.limit > 0 &&
                  value.input.limit <= 128)),
            "agent_invalid_list",
          );
          if (value.input.projectId)
            check(project(value.input.projectId), "agent_project_unavailable");
          return present
            ? agentService(false).list(value.input)
            : {
                contract: "aerynth.agent-library@1",
                items: [],
                coverage: "complete",
              };
        }
        case "create":
        case "update":
        case "archive":
        case "recordAssignment": {
          const service = agentService(value.name === "create");
          const previous =
            typeof value.input?.commandId === "string"
              ? !!db
                  .prepare(
                    "SELECT 1 FROM agent_product_operations WHERE owner_id=? AND command_id=?",
                  )
                  .get(identity.principalId, value.input.commandId)
              : false;
          if (value.name === "recordAssignment") {
            const result = service.recordAssignment(value.input);
            if (!previous)
              options.recordEvent({
                type: "agent.assignment-recorded",
                resourceId: result.agent.resourceId,
                resourceVersion: result.agent.resourceVersion,
                commandId: result.commandId,
                detail: {
                  ...provenance,
                  domain: "agent",
                  operation: "assign",
                  profileVersion: result.agent.profileVersion,
                  assignmentId: result.id,
                  taskId: result.task.id,
                  taskVersion: result.task.version,
                  taskOrigin: "manual-compatibility",
                },
              });
            return result;
          }
          const result =
            value.name === "create"
              ? service.create(value.input)
              : value.name === "update"
                ? service.update(value.input)
                : service.archive(value.input);
          if (!previous)
            options.recordEvent({
              type: {
                create: "agent.created",
                update: "agent.changed",
                archive: "agent.archived",
                restore: "agent.restored",
              }[result.operation] as DomainEvent["type"],
              resourceId: result.agent.resourceId,
              resourceVersion: result.agent.resourceVersion,
              commandId: result.commandId,
              detail: {
                ...provenance,
                domain: "agent",
                operation: result.operation,
                profileVersion: result.agent.profileVersion,
              },
            });
          return result;
        }
      }
    });
  }
  function checklist(
    value: ChecklistRequest,
  ): ChecklistCommandMap[keyof ChecklistCommandMap]["output"] {
    request(value, "checklist");
    return tx(() => {
      if (value.name === "read") {
        check(
          fields(value.input, ["resourceId"]) &&
            id(value.input.resourceId, 512),
          "invalid_checklist_input",
        );
        return checklistService(false).read(value.input.resourceId);
      }
      const service = checklistService(
        value.name === "create",
        value.input?.commandId,
      );
      switch (value.name) {
        case "create":
          return service.create(value.input);
        case "mutate":
          return service.mutate(value.input);
      }
    });
  }
  return {
    agent: agent as ProductDomains["agent"],
    checklist: checklist as ProductDomains["checklist"],
  };
}
