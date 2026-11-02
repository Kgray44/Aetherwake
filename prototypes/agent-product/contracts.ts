/** Provisional canonical service seam. A profile/assignment reference never
 * creates a chat, provider thread, execution, task, or visual placement. */
export const AGENT_CONTRACT = "aerynth.agent-library@1" as const;
export type Inherited<T> =
  | { source: "inherit" }
  | { source: "override"; value: T };
export interface AgentSettings {
  providerId: string | null;
  modelId: string | null;
  reasoningEffort: string | null;
  /** Additional app/user instructions only; never replaces native provider instructions. */
  additionalInstructions: string;
  /** Requested capability IDs, NOT tool/skill/permission grants. */
  requiredCapabilities: string[];
}
export type AgentOverrides = {
  [K in keyof AgentSettings]: Inherited<AgentSettings[K]>;
};
export interface AgentProfileData {
  purpose: string;
  specialties: string[];
  settings: AgentOverrides;
}
export interface CanonicalAgentResource {
  id: string;
  kind: "agent";
  title: string;
  projectId: string | null;
  version: number;
  state: "active" | "archived";
}
export interface AgentRef {
  resourceId: string;
  profileVersion: number;
  resourceVersion: number;
}
export interface AgentProfile {
  contract: typeof AGENT_CONTRACT;
  ref: AgentRef;
  resource: CanonicalAgentResource;
  profile: AgentProfileData;
}
export interface AgentTaskRef {
  id: string;
  version: number;
  projectId: string | null;
  /** Host-derived provenance; a manual checkbox Task is not an agentic objective. */
  supportedTaskOrigin: "manual-compatibility" | "agentic-objective";
}
export type AgentOperation =
  | "create"
  | "read"
  | "update"
  | "archive"
  | "restore"
  | "assign"
  | "read-assignment"
  | "inspect-receipt";
export interface AgentAuthorization {
  operation: AgentOperation;
  agent?: CanonicalAgentResource;
  project?: { id: string; version: number };
  task?: AgentTaskRef;
  execution?: { id: string; revision: string; providerId: string };
}
export interface AgentConfigurationLayer {
  scope: "global" | "project";
  id: string | null;
  version: string;
  /** Global supplies every field; an explicit project layer overrides named fields. */
  settings: Partial<AgentSettings>;
}
export interface AgentProviderCatalog {
  revision: string;
  providers: {
    id: string;
    state: "available" | "unavailable" | "unknown";
    models: { id: string; reasoningEfforts: string[] }[];
    capabilities: string[];
  }[];
}
export interface EffectiveAgentConfiguration {
  agent: AgentRef;
  projectId: string | null;
  policyVersion: string;
  catalogRevision: string;
  catalogDigest: string;
  settings: AgentSettings;
  origins: {
    [K in keyof AgentSettings]: {
      scope: "global" | "project" | "profile";
      id: string | null;
      version: string;
    };
  };
  configurationState: "supported" | "needs-setup" | "unsupported" | "unknown";
  reasons: string[];
  /** Catalog compatibility is not provider entitlement, execution, or completion. */
  verification: "catalog-only";
  digest: string;
}
export interface AgentMutationReceipt {
  commandId: string;
  operation: "create" | "update" | "archive" | "restore";
  agent: AgentRef;
  authorizationRef: string;
  requestDigest: string;
}
export interface AgentAssignmentInput {
  commandId: string;
  agent: AgentRef;
  task: { id: string; version: number };
  execution?: { id: string; revision: string };
  expectedCatalogRevision: string;
  expectedConfigurationDigest: string;
}
export interface AgentAssignmentReference {
  id: string;
  commandId: string;
  agent: AgentRef;
  task: AgentTaskRef;
  execution: { id: string; revision: string; providerId: string } | null;
  configuration: EffectiveAgentConfiguration;
  authorizationRef: string;
  createdAt: string;
  referenceOnly: true;
  startsExecution: false;
  taskVerified: false;
}
export interface AgentHostPort {
  identity(): { principalId: string; policyVersion: string };
  /** Effective canonical policy; missing callbacks/metadata fail closed. */
  authorize(input: AgentAuthorization): {
    decision: "allow" | "deny";
    policyVersion: string;
    authorizationRef: string;
  };
  resource(id: string, purpose: AgentOperation): CanonicalAgentResource | null;
  project(
    id: string,
  ): { id: string; version: number; state: "active" | "archived" } | null;
  /** Same-transaction Root callback: kernel generic resource + semantic agent projection. No note row. */
  createResource(input: {
    kind: "agent";
    title: string;
    projectId: string | null;
    commandId: string;
  }): CanonicalAgentResource;
  renameResource(input: {
    id: string;
    expectedVersion: number;
    title: string;
    commandId: string;
  }): CanonicalAgentResource;
  touchResource(input: {
    id: string;
    expectedVersion: number;
    commandId: string;
  }): CanonicalAgentResource;
  archiveResource(input: {
    id: string;
    expectedVersion: number;
    archived: boolean;
    commandId: string;
  }): CanonicalAgentResource;
  configurationLayers(
    projectId: string | null,
  ): { policyVersion: string; layers: AgentConfigurationLayer[] } | null;
  /** Read only. Never connect, discover over a network, probe credentials, or start a provider here. */
  providerCatalog(): AgentProviderCatalog | null;
  task(
    id: string,
  ): (AgentTaskRef & { kind: "task"; state: "active" | "archived" }) | null;
  execution(
    id: string,
  ): { id: string; revision: string; providerId: string } | null;
}

/** Renderer-safe asynchronous projection of the canonical service. The caller
 * owns RPC, policy, persistence, and cached catalogs; no provider discovery here. */
export type AgentSummary = Pick<AgentProfile, "contract" | "ref" | "resource">;
export interface AgentLibraryClientPort {
  list(input: {
    projectId?: string | null;
    includeArchived?: boolean;
    query?: string;
    limit?: number;
  }): Promise<{
    contract: typeof AGENT_CONTRACT;
    items: AgentSummary[];
    coverage: "complete" | "bounded";
  }>;
  inspect(resourceId: string): Promise<AgentProfile>;
  create(input: {
    commandId: string;
    title: string;
    projectId: string | null;
    profile: AgentProfileData;
  }): Promise<AgentMutationReceipt>;
  update(input: {
    commandId: string;
    agent: AgentRef;
    title: string;
    profile: AgentProfileData;
  }): Promise<AgentMutationReceipt>;
  archive(input: {
    commandId: string;
    agent: AgentRef;
    archived: boolean;
  }): Promise<AgentMutationReceipt>;
  effective(
    agent: AgentRef,
    contextProjectId?: string | null,
  ): Promise<EffectiveAgentConfiguration>;
  templates(): Promise<
    {
      id: string;
      title: string;
      profile: AgentProfileData;
      startsExecution: false;
    }[]
  >;
  projects(): Promise<{ id: string; title: string; version: number }[]>;
  /** Existing cached/authorized metadata only. Null is a truthful unavailable catalog. */
  catalog(): Promise<AgentProviderCatalog | null>;
  /** Optional actual authorized reference history, never synthetic execution activity. */
  references?(resourceId: string): Promise<AgentAssignmentReference[]>;
}
