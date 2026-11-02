import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { AGENT_CONTRACT } from "./contracts.ts";
import type {
  AgentAssignmentInput,
  AgentAssignmentReference,
  AgentAuthorization,
  AgentHostPort,
  AgentMutationReceipt,
  AgentOperation,
  AgentOverrides,
  AgentProfile,
  AgentProfileData,
  AgentProviderCatalog,
  AgentRef,
  AgentSettings,
  AgentTaskRef,
  EffectiveAgentConfiguration,
} from "./contracts.ts";

export const AGENT_LIMITS = Object.freeze({
  profiles: 256,
  versionsPerProfile: 128,
  assignmentsPerProfile: 512,
  operations: 4096,
  listScan: 512,
  profileBytes: 32768,
  effectiveBytes: 65536,
});
export class AgentLibraryError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "AgentLibraryError";
    this.code = code;
  }
}
const check: (value: unknown, code: string) => asserts value = (
  value,
  code,
) => {
  if (!value) throw new AgentLibraryError(code);
};
const record = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: unknown, keys: string[]): value is Record<string, any> =>
  record(value) &&
  Reflect.ownKeys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const identifier = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 200 &&
  value.trim() === value &&
  !/[\x00-\x1f]/.test(value);
const version = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  !value.includes("\0") &&
  Buffer.byteLength(value) <= max;
const normalize = (value: any): any =>
  Array.isArray(value)
    ? value.map(normalize)
    : record(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, normalize(value[k])]),
        )
      : value;
const encode = (value: unknown) => JSON.stringify(normalize(value));
const digest = (value: unknown) =>
  createHash("sha256").update(encode(value)).digest("hex");
const fields = [
  "providerId",
  "modelId",
  "reasoningEffort",
  "additionalInstructions",
  "requiredCapabilities",
] as const;
const tables = [
  "agent_product_schema",
  "agent_product_profiles",
  "agent_product_versions",
  "agent_product_assignments",
  "agent_product_operations",
];
const templatePurposes = {
  researcher: "Investigate questions, compare evidence, and cite sources.",
  engineer: "Design and implement scoped changes with reviewable evidence.",
  debugger: "Reproduce defects and test a narrowly justified correction.",
  verifier: "Independently check requirements and report evidence and gaps.",
  designer: "Develop coherent, accessible interaction and visual design.",
  analyst: "Analyze data with explicit assumptions and limitations.",
  archivist: "Organize authorized knowledge while preserving provenance.",
  planner: "Prepare scoped plans, dependencies, and acceptance criteria.",
};
const inherit = (): AgentOverrides =>
  Object.fromEntries(
    fields.map((key) => [key, { source: "inherit" }]),
  ) as AgentOverrides;
export function agentTemplates() {
  return Object.entries(templatePurposes).map(([id, purpose]) => ({
    id,
    title: id[0]!.toUpperCase() + id.slice(1),
    profile: { purpose, specialties: [id], settings: inherit() },
    startsExecution: false as const,
  }));
}
function setting(key: keyof AgentSettings, value: unknown) {
  if (key === "additionalInstructions")
    check(text(value, 16384), "agent_invalid_instructions");
  else if (key === "requiredCapabilities")
    check(
      Array.isArray(value) &&
        value.length <= 32 &&
        value.every(identifier) &&
        new Set(value).size === value.length,
      "agent_invalid_capabilities",
    );
  else check(value === null || identifier(value), "agent_invalid_setting");
}
function profile(value: unknown): asserts value is AgentProfileData {
  check(
    exact(value, ["purpose", "specialties", "settings"]) &&
      text(value.purpose, 4096) &&
      value.purpose.trim() &&
      Array.isArray(value.specialties) &&
      value.specialties.length <= 32 &&
      value.specialties.every((s: unknown) => text(s, 128) && s.trim()) &&
      exact(value.settings, [...fields]),
    "agent_invalid_profile",
  );
  for (const key of fields) {
    const item = value.settings[key];
    check(record(item), "agent_invalid_inheritance");
    if (item.source === "inherit")
      check(exact(item, ["source"]), "agent_invalid_inheritance");
    else {
      check(
        item.source === "override" && exact(item, ["source", "value"]),
        "agent_invalid_inheritance",
      );
      setting(key, item.value);
    }
  }
  check(
    Buffer.byteLength(encode(value)) <= AGENT_LIMITS.profileBytes,
    "agent_profile_capacity",
  );
}
function agentRef(value: unknown): asserts value is AgentRef {
  check(
    exact(value, ["resourceId", "profileVersion", "resourceVersion"]) &&
      identifier(value.resourceId) &&
      version(value.profileVersion) &&
      version(value.resourceVersion),
    "agent_invalid_ref",
  );
}
export interface AgentLibraryOptions {
  db: DatabaseSync;
  /** Same canonical connection; synchronous callbacks, including Root resource mutations. */
  transaction<T>(work: (db: DatabaseSync) => T): T;
  readTransaction?<T>(work: (db: DatabaseSync) => T): T;
  host: AgentHostPort;
}
export class AgentLibraryService {
  private opts: AgentLibraryOptions;
  constructor(options: AgentLibraryOptions) {
    this.opts = options;
    this.tx(() => this.initialize());
  }
  private tx<T>(work: () => T, read = false): T {
    return (
      read && this.opts.readTransaction
        ? this.opts.readTransaction
        : this.opts.transaction
    )((db) => {
      check(db === this.opts.db, "agent_database_mismatch");
      return work();
    });
  }
  private identity() {
    const who = this.opts.host.identity();
    check(
      who && identifier(who.principalId) && identifier(who.policyVersion),
      "agent_identity_unavailable",
    );
    return who;
  }
  private initialize() {
    const db = this.opts.db;
    check(
      db.prepare("PRAGMA foreign_keys").get()!.foreign_keys === 1,
      "agent_foreign_keys_required",
    );
    const existing = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 'agent_product_*'",
      )
      .all()
      .map((row) => String(row.name));
    if (!existing.length)
      db.exec(`
      CREATE TABLE agent_product_schema(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL);
      INSERT INTO agent_product_schema VALUES(1,1);
      CREATE TABLE agent_product_profiles(resource_id TEXT PRIMARY KEY REFERENCES resources(id) ON DELETE RESTRICT,owner_id TEXT NOT NULL,profile_version INTEGER NOT NULL CHECK(profile_version>0));
      CREATE TABLE agent_product_versions(resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,profile_version INTEGER NOT NULL,data_json TEXT NOT NULL,data_digest TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(resource_id,profile_version));
      CREATE TABLE agent_product_assignments(id TEXT PRIMARY KEY,resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,task_id TEXT NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,owner_id TEXT NOT NULL,command_id TEXT NOT NULL,receipt_json TEXT NOT NULL,receipt_digest TEXT NOT NULL,UNIQUE(owner_id,command_id));
      CREATE TABLE agent_product_operations(owner_id TEXT NOT NULL,command_id TEXT NOT NULL,resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,operation TEXT NOT NULL,request_digest TEXT NOT NULL,receipt_json TEXT NOT NULL,receipt_digest TEXT NOT NULL,PRIMARY KEY(owner_id,command_id));`);
    else
      check(
        existing.length === tables.length &&
          tables.every((name) => existing.includes(name)),
        "agent_partial_schema",
      );
    const rows = db
      .prepare("SELECT id,version FROM agent_product_schema")
      .all();
    check(
      rows.length === 1 && rows[0]!.id === 1 && rows[0]!.version === 1,
      "agent_unsupported_schema",
    );
    const columns: Record<string, string[]> = {
      agent_product_schema: ["id", "version"],
      agent_product_profiles: ["resource_id", "owner_id", "profile_version"],
      agent_product_versions: [
        "resource_id",
        "profile_version",
        "data_json",
        "data_digest",
        "created_at",
      ],
      agent_product_assignments: [
        "id",
        "resource_id",
        "task_id",
        "owner_id",
        "command_id",
        "receipt_json",
        "receipt_digest",
      ],
      agent_product_operations: [
        "owner_id",
        "command_id",
        "resource_id",
        "operation",
        "request_digest",
        "receipt_json",
        "receipt_digest",
      ],
    };
    for (const table of tables)
      check(
        encode(
          db
            .prepare(`PRAGMA table_info(${table})`)
            .all()
            .map((row) => row.name),
        ) === encode(columns[table]),
        "agent_invalid_schema",
      );
    for (const table of tables.slice(1)) {
      const refs = db.prepare(`PRAGMA foreign_key_list(${table})`).all();
      check(
        refs.length === (table === "agent_product_assignments" ? 2 : 1) &&
          refs.every((row) => row.table === "resources" && row.to === "id") &&
          refs.some((row) => row.from === "resource_id") &&
          (table !== "agent_product_assignments" ||
            refs.some((row) => row.from === "task_id")),
        "agent_invalid_schema",
      );
    }
  }
  private authorize(input: AgentAuthorization) {
    const who = this.identity();
    let result;
    try {
      result = this.opts.host.authorize(structuredClone(input));
    } catch {
      throw new AgentLibraryError("agent_not_authorized");
    }
    check(
      result?.decision === "allow" &&
        result.policyVersion === who.policyVersion &&
        identifier(result.authorizationRef),
      "agent_not_authorized",
    );
    return result.authorizationRef;
  }
  private project(id: string | null) {
    if (id === null) return undefined;
    check(identifier(id), "agent_invalid_project");
    const p = this.opts.host.project(id);
    check(
      p && p.id === id && version(p.version) && p.state === "active",
      "agent_project_unavailable",
    );
    return { id: p.id, version: p.version };
  }
  private resource(id: string, operation: AgentOperation) {
    check(identifier(id), "agent_invalid_id");
    const resource = this.opts.host.resource(id, operation);
    check(
      resource &&
        resource.id === id &&
        resource.kind === "agent" &&
        text(resource.title, 200) &&
        resource.title.trim() &&
        version(resource.version) &&
        ["active", "archived"].includes(resource.state),
      "agent_resource_unavailable",
    );
    const raw = this.opts.db
      .prepare(
        "SELECT kind,title,project_id,version,state FROM resources WHERE id=?",
      )
      .get(id);
    check(
      raw &&
        raw.kind === "generic" &&
        raw.title === resource.title &&
        raw.project_id === resource.projectId &&
        raw.version === resource.version &&
        raw.state === resource.state,
      "agent_canonical_resource_mismatch",
    );
    const project = this.project(resource.projectId);
    this.authorize({
      operation,
      agent: resource,
      ...(project ? { project } : {}),
    });
    return structuredClone(resource);
  }
  private head(id: string, operation: AgentOperation) {
    const resource = this.resource(id, operation),
      row = this.opts.db
        .prepare(
          "SELECT owner_id,profile_version FROM agent_product_profiles WHERE resource_id=?",
        )
        .get(id);
    check(
      row &&
        row.owner_id === this.identity().principalId &&
        version(row.profile_version),
      "agent_profile_unavailable",
    );
    if (
      operation === "read" ||
      operation === "update" ||
      operation === "assign"
    )
      check(resource.state === "active", "agent_profile_archived");
    return {
      resource,
      ref: {
        resourceId: id,
        profileVersion: Number(row.profile_version),
        resourceVersion: resource.version,
      },
    };
  }
  private data(ref: AgentRef): AgentProfileData {
    const row = this.opts.db
      .prepare(
        "SELECT data_json,data_digest FROM agent_product_versions WHERE resource_id=? AND profile_version=?",
      )
      .get(ref.resourceId, ref.profileVersion);
    check(
      row &&
        typeof row.data_json === "string" &&
        Buffer.byteLength(row.data_json) <= AGENT_LIMITS.profileBytes,
      "agent_profile_corrupt",
    );
    let value;
    try {
      value = JSON.parse(row.data_json);
    } catch {
      throw new AgentLibraryError("agent_profile_corrupt");
    }
    profile(value);
    check(digest(value) === row.data_digest, "agent_profile_corrupt");
    return value;
  }
  private current(ref: AgentRef, operation: AgentOperation) {
    agentRef(ref);
    const current = this.head(ref.resourceId, operation);
    check(encode(current.ref) === encode(ref), "agent_version_conflict");
    return current;
  }
  inspect(resourceId: string): AgentProfile {
    return this.tx(() => {
      const h = this.head(resourceId, "read");
      return { contract: AGENT_CONTRACT, ...h, profile: this.data(h.ref) };
    }, true);
  }
  list(
    input: {
      projectId?: string | null;
      includeArchived?: boolean;
      query?: string;
      limit?: number;
    } = {},
  ) {
    return this.tx(() => {
      check(
        record(input) &&
          Object.keys(input).every((key) =>
            ["projectId", "includeArchived", "query", "limit"].includes(key),
          ) &&
          (input.projectId === undefined ||
            input.projectId === null ||
            identifier(input.projectId)) &&
          (input.includeArchived === undefined ||
            typeof input.includeArchived === "boolean") &&
          (input.query === undefined || text(input.query, 200)),
        "agent_invalid_list",
      );
      const limit = input.limit ?? 64;
      check(
        Number.isSafeInteger(limit) && limit > 0 && limit <= 128,
        "agent_invalid_list",
      );
      if (input.projectId)
        this.authorize({
          operation: "read",
          project: this.project(input.projectId)!,
        });
      const rows = this.opts.db
        .prepare(
          "SELECT resource_id FROM agent_product_profiles WHERE owner_id=? ORDER BY resource_id LIMIT ?",
        )
        .all(this.identity().principalId, AGENT_LIMITS.listScan);
      const items: Pick<AgentProfile, "contract" | "ref" | "resource">[] = [];
      let limited = rows.length === AGENT_LIMITS.listScan;
      for (const row of rows) {
        let h;
        try {
          h = this.head(
            String(row.resource_id),
            input.includeArchived ? "restore" : "read",
          );
        } catch (error) {
          if (
            error instanceof AgentLibraryError &&
            [
              "agent_resource_unavailable",
              "agent_not_authorized",
              "agent_project_unavailable",
              "agent_profile_archived",
            ].includes(error.code)
          )
            continue;
          throw error;
        }
        if (
          (!input.includeArchived && h.resource.state !== "active") ||
          (input.projectId !== undefined &&
            h.resource.projectId !== input.projectId) ||
          (input.query &&
            !h.resource.title
              .toLocaleLowerCase()
              .includes(input.query.toLocaleLowerCase()))
        )
          continue;
        if (items.length === limit) {
          limited = true;
          break;
        }
        items.push({ contract: AGENT_CONTRACT, ...h });
      }
      return {
        contract: AGENT_CONTRACT,
        items,
        coverage: limited ? ("bounded" as const) : ("complete" as const),
      };
    }, true);
  }
  private prior(commandId: string, requestDigest: string, operation: string) {
    check(identifier(commandId), "agent_invalid_command");
    const row = this.opts.db
      .prepare(
        "SELECT resource_id,operation,request_digest,receipt_json,receipt_digest FROM agent_product_operations WHERE owner_id=? AND command_id=?",
      )
      .get(this.identity().principalId, commandId);
    if (!row) return null;
    check(
      row.operation === operation && row.request_digest === requestDigest,
      "agent_command_conflict",
    );
    this.head(String(row.resource_id), "inspect-receipt");
    check(
      typeof row.receipt_json === "string" &&
        Buffer.byteLength(row.receipt_json) <= 4096,
      "agent_receipt_corrupt",
    );
    let receipt;
    try {
      receipt = JSON.parse(row.receipt_json);
    } catch {
      throw new AgentLibraryError("agent_receipt_corrupt");
    }
    check(
      digest(receipt) === row.receipt_digest &&
        (operation === "assign"
          ? identifier(receipt.id)
          : receipt.agent?.resourceId === row.resource_id &&
            receipt.commandId === commandId &&
            receipt.operation === operation),
      "agent_receipt_corrupt",
    );
    return receipt;
  }
  private capacity() {
    check(
      Number(
        this.opts.db
          .prepare(
            "SELECT count(*) n FROM agent_product_operations WHERE owner_id=?",
          )
          .get(this.identity().principalId)!.n,
      ) < AGENT_LIMITS.operations,
      "agent_operation_capacity",
    );
  }
  private saveOperation(
    commandId: string,
    operation: string,
    resourceId: string,
    requestDigest: string,
    receipt: unknown,
  ) {
    this.opts.db
      .prepare("INSERT INTO agent_product_operations VALUES(?,?,?,?,?,?,?)")
      .run(
        this.identity().principalId,
        commandId,
        resourceId,
        operation,
        requestDigest,
        encode(receipt),
        digest(receipt),
      );
  }
  private saveVersion(ref: AgentRef, value: AgentProfileData) {
    check(
      ref.profileVersion <= AGENT_LIMITS.versionsPerProfile,
      "agent_version_capacity",
    );
    this.opts.db
      .prepare("INSERT INTO agent_product_versions VALUES(?,?,?,?,?)")
      .run(
        ref.resourceId,
        ref.profileVersion,
        encode(value),
        digest(value),
        new Date().toISOString(),
      );
  }
  create(input: {
    commandId: string;
    title: string;
    projectId: string | null;
    profile: AgentProfileData;
  }): AgentMutationReceipt {
    return this.tx(() => {
      check(
        exact(input, ["commandId", "title", "projectId", "profile"]) &&
          identifier(input.commandId) &&
          text(input.title, 200) &&
          input.title.trim() &&
          (input.projectId === null || identifier(input.projectId)),
        "agent_invalid_create",
      );
      profile(input.profile);
      const fingerprint = digest(input),
        previous = this.prior(input.commandId, fingerprint, "create");
      if (previous) return previous;
      this.capacity();
      check(
        Number(
          this.opts.db
            .prepare(
              "SELECT count(*) n FROM agent_product_profiles WHERE owner_id=?",
            )
            .get(this.identity().principalId)!.n,
        ) < AGENT_LIMITS.profiles,
        "agent_profile_capacity",
      );
      const project = this.project(input.projectId),
        authorizationRef = this.authorize({
          operation: "create",
          ...(project ? { project } : {}),
        });
      const r = this.opts.host.createResource({
        kind: "agent",
        title: input.title.trim(),
        projectId: input.projectId,
        commandId: input.commandId,
      });
      check(r && identifier(r.id), "agent_resource_unavailable");
      const resource = this.resource(r.id, "create");
      check(
        resource.title === input.title.trim() &&
          resource.projectId === input.projectId &&
          resource.state === "active",
        "agent_canonical_resource_mismatch",
      );
      const ref = {
        resourceId: resource.id,
        profileVersion: 1,
        resourceVersion: resource.version,
      };
      this.opts.db
        .prepare("INSERT INTO agent_product_profiles VALUES(?,?,1)")
        .run(resource.id, this.identity().principalId);
      this.saveVersion(ref, input.profile);
      const receipt: AgentMutationReceipt = {
        commandId: input.commandId,
        operation: "create",
        agent: ref,
        authorizationRef,
        requestDigest: fingerprint,
      };
      this.saveOperation(
        input.commandId,
        "create",
        resource.id,
        fingerprint,
        receipt,
      );
      return receipt;
    });
  }
  update(input: {
    commandId: string;
    agent: AgentRef;
    title: string;
    profile: AgentProfileData;
  }): AgentMutationReceipt {
    return this.mutate(input, "update");
  }
  archive(input: {
    commandId: string;
    agent: AgentRef;
    archived: boolean;
  }): AgentMutationReceipt {
    check(typeof input?.archived === "boolean", "agent_invalid_archive");
    return this.mutate(input, input.archived ? "archive" : "restore");
  }
  private mutate(
    input: any,
    operation: "update" | "archive" | "restore",
  ): AgentMutationReceipt {
    return this.tx(() => {
      check(
        exact(
          input,
          operation === "update"
            ? ["commandId", "agent", "title", "profile"]
            : ["commandId", "agent", "archived"],
        ) && identifier(input.commandId),
        "agent_invalid_mutation",
      );
      agentRef(input.agent);
      if (operation === "update") {
        check(
          text(input.title, 200) && input.title.trim(),
          "agent_invalid_title",
        );
        profile(input.profile);
      }
      const fingerprint = digest(input),
        previous = this.prior(input.commandId, fingerprint, operation);
      if (previous) return previous;
      this.capacity();
      const h = this.current(input.agent, operation);
      check(
        h.ref.profileVersion < AGENT_LIMITS.versionsPerProfile,
        "agent_version_capacity",
      );
      check(
        operation !== "restore" || h.resource.state === "archived",
        "agent_not_archived",
      );
      check(
        operation !== "archive" || h.resource.state === "active",
        "agent_profile_archived",
      );
      const data =
          operation === "update"
            ? structuredClone(input.profile)
            : this.data(h.ref),
        authorizationRef = this.authorize({
          operation,
          agent: h.resource,
          ...(h.resource.projectId
            ? { project: this.project(h.resource.projectId)! }
            : {}),
        });
      if (operation === "update" && input.title.trim() !== h.resource.title)
        this.opts.host.renameResource({
          id: h.resource.id,
          title: input.title.trim(),
          expectedVersion: h.resource.version,
          commandId: input.commandId,
        });
      else if (operation === "update")
        this.opts.host.touchResource({
          id: h.resource.id,
          expectedVersion: h.resource.version,
          commandId: input.commandId,
        });
      if (operation !== "update")
        this.opts.host.archiveResource({
          id: h.resource.id,
          expectedVersion: h.resource.version,
          archived: operation === "archive",
          commandId: input.commandId,
        });
      const resource = this.resource(h.resource.id, operation),
        expectedResourceVersion = h.resource.version + 1;
      check(
        resource.version === expectedResourceVersion &&
          resource.projectId === h.resource.projectId &&
          resource.state ===
            (operation === "archive" ? "archived" : "active") &&
          (operation !== "update" || resource.title === input.title.trim()),
        "agent_canonical_resource_mismatch",
      );
      const ref = {
        resourceId: resource.id,
        profileVersion: h.ref.profileVersion + 1,
        resourceVersion: resource.version,
      };
      const changed = this.opts.db
        .prepare(
          "UPDATE agent_product_profiles SET profile_version=? WHERE resource_id=? AND profile_version=?",
        )
        .run(ref.profileVersion, ref.resourceId, h.ref.profileVersion);
      check(changed.changes === 1, "agent_version_conflict");
      this.saveVersion(ref, data);
      const receipt: AgentMutationReceipt = {
        commandId: input.commandId,
        operation,
        agent: ref,
        authorizationRef,
        requestDigest: fingerprint,
      };
      this.saveOperation(
        input.commandId,
        operation,
        ref.resourceId,
        fingerprint,
        receipt,
      );
      return receipt;
    });
  }
  effective(
    agent: AgentRef,
    contextProjectId?: string | null,
  ): EffectiveAgentConfiguration {
    return this.tx(() => this.resolveEffective(agent, contextProjectId), true);
  }
  private resolveEffective(
    ref: AgentRef,
    contextProjectId?: string | null,
  ): EffectiveAgentConfiguration {
    const h = this.current(ref, "read"),
      data = this.data(ref),
      projectId =
        contextProjectId === undefined
          ? h.resource.projectId
          : contextProjectId;
    check(
      h.resource.projectId === null || projectId === h.resource.projectId,
      "agent_cross_project_assignment",
    );
    const contextProject = this.project(projectId);
    if (contextProject)
      this.authorize({
        operation: "read",
        agent: h.resource,
        project: contextProject,
      });
    const source = this.opts.host.configurationLayers(projectId),
      who = this.identity();
    check(
      source &&
        source.policyVersion === who.policyVersion &&
        Array.isArray(source.layers) &&
        source.layers.length <= 2,
      "agent_configuration_unavailable",
    );
    const settings: Record<string, unknown> = {},
      origins: Record<string, unknown> = {};
    let seenGlobal = false,
      seenProject = false;
    for (const layer of source.layers) {
      check(
        record(layer) &&
          exact(layer, ["scope", "id", "version", "settings"]) &&
          identifier(layer.version) &&
          record(layer.settings) &&
          Object.keys(layer.settings).every((key) =>
            fields.includes(key as any),
          ),
        "agent_invalid_configuration_layer",
      );
      if (layer.scope === "global") {
        check(
          !seenGlobal &&
            !seenProject &&
            layer.id === null &&
            fields.every((key) => Object.hasOwn(layer.settings, key)),
          "agent_invalid_configuration_layer",
        );
        seenGlobal = true;
      } else {
        check(
          layer.scope === "project" &&
            seenGlobal &&
            !seenProject &&
            projectId !== null &&
            layer.id === projectId,
          "agent_invalid_configuration_layer",
        );
        seenProject = true;
      }
      for (const key of fields)
        if (Object.hasOwn(layer.settings, key)) {
          setting(key, layer.settings[key]);
          settings[key] = structuredClone(layer.settings[key]);
          origins[key] = {
            scope: layer.scope,
            id: layer.id,
            version: layer.version,
          };
        }
    }
    for (const key of fields)
      if (data.settings[key].source === "override") {
        settings[key] = structuredClone(data.settings[key].value);
        origins[key] = {
          scope: "profile",
          id: ref.resourceId,
          version: String(ref.profileVersion),
        };
      }
    check(
      fields.every(
        (key) => Object.hasOwn(settings, key) && Object.hasOwn(origins, key),
      ),
      "agent_configuration_unavailable",
    );
    const catalog = this.opts.host.providerCatalog();
    this.validateCatalog(catalog);
    const provider = catalog.providers.find(
        (p) => p.id === settings.providerId,
      ),
      model = provider?.models.find((m) => m.id === settings.modelId);
    let state: EffectiveAgentConfiguration["configurationState"] = "supported";
    const reasons: string[] = [];
    if (settings.providerId === null || settings.modelId === null) {
      state = "needs-setup";
      reasons.push("provider-or-model-not-configured");
    } else if (!provider || provider.state === "unavailable" || !model) {
      state = "unsupported";
      reasons.push("provider-or-model-not-in-current-catalog");
    } else if (provider.state === "unknown") {
      state = "unknown";
      reasons.push("provider-capability-unknown");
    } else if (
      (settings.reasoningEffort !== null &&
        !model.reasoningEfforts.includes(settings.reasoningEffort as string)) ||
      (settings.requiredCapabilities as string[]).some(
        (id) => !provider.capabilities.includes(id),
      )
    ) {
      state = "unsupported";
      reasons.push("requested-capability-not-in-current-catalog");
    }
    const value = {
      agent: structuredClone(ref),
      projectId,
      policyVersion: who.policyVersion,
      catalogRevision: catalog.revision,
      catalogDigest: digest(catalog),
      settings: settings as unknown as AgentSettings,
      origins: origins as EffectiveAgentConfiguration["origins"],
      configurationState: state,
      reasons,
      verification: "catalog-only" as const,
    };
    check(
      Buffer.byteLength(encode(value)) <= AGENT_LIMITS.effectiveBytes,
      "agent_effective_capacity",
    );
    const current = this.current(ref, "read");
    check(
      this.identity().policyVersion === who.policyVersion,
      "agent_policy_conflict",
    );
    if (contextProject) {
      const latest = this.project(contextProject.id)!;
      check(
        latest.version === contextProject.version,
        "agent_project_conflict",
      );
      this.authorize({
        operation: "read",
        agent: current.resource,
        project: latest,
      });
    }
    return { ...value, digest: digest(value) };
  }
  private validateCatalog(
    value: AgentProviderCatalog | null,
  ): asserts value is AgentProviderCatalog {
    check(
      value &&
        identifier(value.revision) &&
        Array.isArray(value.providers) &&
        value.providers.length <= 32 &&
        new Set(value.providers.map((p) => p.id)).size ===
          value.providers.length,
      "agent_catalog_unavailable",
    );
    for (const p of value.providers)
      check(
        identifier(p.id) &&
          ["available", "unavailable", "unknown"].includes(p.state) &&
          Array.isArray(p.models) &&
          p.models.length <= 256 &&
          new Set(p.models.map((m) => m.id)).size === p.models.length &&
          p.models.every(
            (m) =>
              identifier(m.id) &&
              Array.isArray(m.reasoningEfforts) &&
              m.reasoningEfforts.length <= 32 &&
              m.reasoningEfforts.every(identifier),
          ) &&
          Array.isArray(p.capabilities) &&
          p.capabilities.length <= 128 &&
          p.capabilities.every(identifier),
        "agent_catalog_unavailable",
      );
  }
  private assignmentAuthority(
    value: {
      agent: AgentRef;
      task: {
        id: string;
        version: number;
        projectId?: string | null;
        supportedTaskOrigin?: AgentTaskRef["supportedTaskOrigin"];
      };
      execution: AgentAssignmentReference["execution"];
    },
    exactVersions: boolean,
  ) {
    const h = exactVersions
      ? this.current(value.agent, "assign")
      : this.head(value.agent.resourceId, "read-assignment");
    const task = this.opts.host.task(value.task.id);
    check(
      task &&
        task.id === value.task.id &&
        task.kind === "task" &&
        task.state === "active" &&
        ["manual-compatibility", "agentic-objective"].includes(
          task.supportedTaskOrigin,
        ) &&
        version(task.version) &&
        (task.projectId === null || identifier(task.projectId)) &&
        (!exactVersions || task.version === value.task.version),
      "agent_task_unavailable",
    );
    check(
      h.resource.projectId === null || h.resource.projectId === task.projectId,
      "agent_cross_project_assignment",
    );
    this.project(task.projectId);
    if (!exactVersions)
      check(
        task.projectId === value.task.projectId &&
          task.supportedTaskOrigin === value.task.supportedTaskOrigin,
        "agent_cross_project_assignment",
      );
    let execution = null;
    if (value.execution) {
      const e = this.opts.host.execution(value.execution.id);
      check(
        e &&
          e.id === value.execution.id &&
          identifier(e.revision) &&
          identifier(e.providerId) &&
          (!exactVersions || e.revision === value.execution.revision),
        "agent_execution_unavailable",
      );
      execution = e;
    }
    const authorizationRef = this.authorize({
      operation: exactVersions ? "assign" : "read-assignment",
      agent: h.resource,
      task,
      ...(execution ? { execution } : {}),
      ...(task.projectId ? { project: this.project(task.projectId)! } : {}),
    });
    return { h, task, execution, authorizationRef };
  }
  recordAssignment(input: AgentAssignmentInput): AgentAssignmentReference {
    return this.tx(() => {
      check(
        record(input) &&
          Object.keys(input).every((key) =>
            [
              "commandId",
              "agent",
              "task",
              "execution",
              "expectedCatalogRevision",
              "expectedConfigurationDigest",
            ].includes(key),
          ) &&
          identifier(input.commandId) &&
          identifier(input.expectedCatalogRevision) &&
          typeof input.expectedConfigurationDigest === "string" &&
          /^[a-f0-9]{64}$/.test(input.expectedConfigurationDigest) &&
          exact(input.task, ["id", "version"]) &&
          identifier(input.task.id) &&
          version(input.task.version),
        "agent_invalid_assignment",
      );
      agentRef(input.agent);
      if (Object.hasOwn(input, "execution"))
        check(
          exact(input.execution, ["id", "revision"]) &&
            identifier(input.execution.id) &&
            identifier(input.execution.revision),
          "agent_invalid_assignment",
        );
      const fingerprint = digest(input),
        previous = this.prior(input.commandId, fingerprint, "assign");
      if (previous) return this.assignment(String(previous.id));
      this.capacity();
      const state = this.assignmentAuthority(
        {
          agent: input.agent,
          task: input.task,
          execution: input.execution
            ? { ...input.execution, providerId: "" }
            : null,
        },
        true,
      );
      check(
        Number(
          this.opts.db
            .prepare(
              "SELECT count(*) n FROM agent_product_assignments WHERE resource_id=?",
            )
            .get(input.agent.resourceId)!.n,
        ) < AGENT_LIMITS.assignmentsPerProfile,
        "agent_assignment_capacity",
      );
      const configuration = this.resolveEffective(
        input.agent,
        state.task.projectId,
      );
      check(
        configuration.catalogRevision === input.expectedCatalogRevision,
        "agent_catalog_conflict",
      );
      check(
        configuration.digest === input.expectedConfigurationDigest,
        "agent_configuration_conflict",
      );
      check(
        configuration.configurationState === "supported",
        "agent_configuration_not_supported",
      );
      check(
        !state.execution ||
          state.execution.providerId === configuration.settings.providerId,
        "agent_execution_provider_mismatch",
      );
      const final = this.assignmentAuthority(
        {
          agent: input.agent,
          task: {
            ...input.task,
            projectId: state.task.projectId,
            supportedTaskOrigin: state.task.supportedTaskOrigin,
          },
          execution: input.execution
            ? { ...input.execution, providerId: state.execution!.providerId }
            : null,
        },
        true,
      );
      check(
        final.task.projectId === state.task.projectId &&
          (!final.execution ||
            final.execution.providerId === configuration.settings.providerId),
        "agent_assignment_context_conflict",
      );
      const value: AgentAssignmentReference = {
        id: randomUUID(),
        commandId: input.commandId,
        agent: structuredClone(input.agent),
        task: {
          id: final.task.id,
          version: final.task.version,
          projectId: final.task.projectId,
          supportedTaskOrigin: final.task.supportedTaskOrigin,
        },
        execution: final.execution,
        configuration,
        authorizationRef: final.authorizationRef,
        createdAt: new Date().toISOString(),
        referenceOnly: true,
        startsExecution: false,
        taskVerified: false,
      };
      this.opts.db
        .prepare("INSERT INTO agent_product_assignments VALUES(?,?,?,?,?,?,?)")
        .run(
          value.id,
          input.agent.resourceId,
          value.task.id,
          this.identity().principalId,
          input.commandId,
          encode(value),
          digest(value),
        );
      this.saveOperation(
        input.commandId,
        "assign",
        input.agent.resourceId,
        fingerprint,
        { id: value.id },
      );
      return structuredClone(value);
    });
  }
  assignment(id: string): AgentAssignmentReference {
    return this.tx(() => {
      check(identifier(id), "agent_invalid_assignment");
      const row = this.opts.db
        .prepare(
          "SELECT resource_id,task_id,command_id,receipt_json,receipt_digest FROM agent_product_assignments WHERE id=? AND owner_id=?",
        )
        .get(id, this.identity().principalId);
      check(
        row &&
          Buffer.byteLength(String(row.receipt_json)) <=
            AGENT_LIMITS.effectiveBytes + 8192,
        "agent_assignment_unavailable",
      );
      let value: AgentAssignmentReference;
      try {
        value = JSON.parse(String(row.receipt_json));
      } catch {
        throw new AgentLibraryError("agent_assignment_corrupt");
      }
      check(
        value.id === id &&
          value.agent?.resourceId === row.resource_id &&
          value.task?.id === row.task_id &&
          value.commandId === row.command_id &&
          digest(value) === row.receipt_digest &&
          value.referenceOnly === true &&
          value.startsExecution === false &&
          value.taskVerified === false,
        "agent_assignment_corrupt",
      );
      agentRef(value.agent);
      const { digest: stored, ...configuration } = value.configuration;
      check(digest(configuration) === stored, "agent_assignment_corrupt");
      this.assignmentAuthority(value, false);
      return structuredClone(value);
    }, true);
  }
}
