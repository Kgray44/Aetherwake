# Provisional interface contracts v0.1

> **Owner-approved design intent (2026-11-05).** The interface semantics are accepted as architectural direction. 'Provisional' describes candidate wire-level signatures and provider support, not uncertainty about the user's desired product.

Status: **owner-accepted design contracts**, 2026-11-05; exact API signatures remain provisional pending implementation/ADR verification. They are implementation-neutral design inputs, not approved interfaces, binding governance, deployed schemas or claims that a provider exposes identical objects. The [Constitution](../../governance/00-AETHERWAKE-CONSTITUTION.md) is established; the [registry](../../governance/README.md) records all specialist charters as published pending owner acceptance. The [reference architecture](../architecture/REFERENCE-ARCHITECTURE-v0.1.md) assigns owners. Owner acceptance is required before freezing cross-team v1 contracts, retention policy, authentication model, and irreversible data migrations.

## Envelope, types and invariants

Each stored or transmitted object carries `contract` (e.g. `aerynth.resource-ref`), `schemaVersion` (`major.minor`), `id` when it has a durable identity, `createdAt` and `updatedAt` where meaningful, and `extensions` as a map keyed by reverse-domain or provider namespace. JSON UTF-8 is the interchange baseline; timestamps are RFC 3339 UTC strings, IDs are opaque application-generated UUIDv7 candidates (selection pending ADR), integer counters are decimal integers, and byte payloads are content-addressed attachments with access policy rather than inline secrets. Internal storage may differ. No client should parse IDs for meaning. `null`, omitted, `unavailable`, `redacted` and `unknown` are distinct: omission is optional/unknown to an older reader; `null` means known absent; explicit state enums describe inaccessible or not yet measured values.

Major versions may break compatibility. Within a major version, additive optional fields and new enum values are allowed; consumers must preserve unknown `extensions`, ignore unknown optional fields, and render unknown enum values as `unsupported`/`unknown` without success semantics. Required field changes, identity reinterpretation and event meaning changes require a new major version and migration. Readers reject unsupported major versions with `unsupported_schema`; writers do not silently downgrade. All mutating commands include `commandId` (idempotency key), `correlationId`, `actorRef`, `expectedRevision` (or explicit blind-create), and a response with authoritative revision. Duplicates return the original receipt where possible. Version negotiation occurs on each IPC and provider-adapter session.

The common error envelope is `{ code, message, retryable, correlationId, source, details?, observedAt }`. Stable codes initially include `invalid`, `not_found`, `stale_revision`, `unauthorized`, `approval_required`, `approval_expired`, `unsupported_capability`, `unsupported_schema`, `provider_unavailable`, `provider_rejected`, `timeout_unknown_outcome`, `storage_failure`, `integrity_gap`, `redacted` and `cancelled`. `retryable` is advice, not permission to repeat a side effect. Display safe messages; keep raw provider details in restricted diagnostic storage. Never turn an unknown external outcome into `completed` merely because a timeout expired.

**Boundary checks:** `ResourceRef` cannot itself authorize access; provider IDs are scoped to provider instance/account; all externally sourced content is untrusted; lineage/handoff does not alter source transcripts; an approval is valid for one fingerprinted action scope and has expiry; event `observed` is reserved for source-observed activity, not an inferred narrative. AW-CON-002, AW-CON-004, AW-CON-026, AW-CON-031–035, AW-CON-057–065; proposed AW-CHAT-005–012 and AW-CEX-002, 006–008.

## 1. `ResourceRef` — `aerynth.resource-ref@0.1`

| Field | Type and meaning |
|---|---|
| `resourceId` | required opaque app ID, stable across views, rename, move and provider remap |
| `kind` | required extensible type: `conversation`, `message`, `project`, `workspace`, `note`, `file`, `task`, `execution`, `agent`, `event`, `artifact`, `external` |
| `revision` | optional monotone app revision or content hash for stale selection detection |
| `anchor` | optional typed subobject locator: message span `{messageId, start, end, textHash}`, file `{uri, range, contentHash}`, chart `{seriesId, from, to}`; offsets define Unicode code-point indexing in v0.1 |
| `providerLocator` | optional `{providerId, instanceId, accountScope, nativeId}` stored only when useful; never used as app identity |
| `accessScope` | optional reference to visibility policy, not a bearer grant |

Invariants: one `resourceId` has one canonical kind; a placement may reference it many times; a stale `anchor` returns `stale_revision` and asks for re-selection. The service validates `providerLocator` against the actual account and policy before dereference. File paths are opaque URIs and must be normalized against an authorized root before effect. Proposed AW-EXP-027–035, AW-CHAT-005–007.

## 2. `EventProvenance` and `AppEvent` — `aerynth.event@0.1`

`EventProvenance` has required `classification` = `observed | provider_reported | user_authored | derived | predicted | simulated | unknown`; `sourceType` = `app | provider | user | tool | importer`; `sourceRef` (nullable), `sourceRevision` (nullable), `captureMethod`, `confidence` only for derived/predicted evidence, `visibilityScope`, and `redactionState`. `observed` requires an actual service/tool/provider observation and receipt; `provider_reported` preserves provider attribution without upgrading it to independently verified truth. `simulated` must remain visibly labeled in every projection.

`AppEvent` has `eventId`, `eventType` (namespaced, e.g. `conversation.message.appended`), `subjectRef`, `actorRef` or explicit `system`, `occurredAt` (source clock when available), `receivedAt`, `correlationId`, optional `causationId`, optional `attemptId`, `streamId`, `streamSequence` when known, `provenance`, `payloadSchemaVersion`, `payload` or redacted payload reference, and `integrity` = `complete | partial | gap | duplicate_suppressed | unverifiable`. Event IDs are app IDs; native event IDs remain scoped metadata. Ingestion is at least once, with dedupe; downstream projections are idempotent. Per-stream order is guaranteed only where the source gives sequence; global total order is not claimed. A gap event records missing ranges or an unavailable source. No hidden model chain of thought is inferred from animation or deltas. Event retention and deletion must follow the accepted policy, currently undecided. Proposed AW-LIQ-052–062, AW-CEX-006–008 and Charter 09.

## 3. `Conversation` and `ConversationMessage` — `aerynth.conversation@0.1`

| Object | Required fields | Optional / constraints |
|---|---|---|
| `Conversation` | `conversationId`, `kind: ordinary | execution`, `title`, `state: active | archived | deleted_pending | unavailable`, `revision`, `createdAt`, `updatedAt` | `providerBindings[]` each `{providerId, instanceId, accountScope, nativeThreadId, bindingState}`, project/collection refs, privacy scope, retention class. Zero tasks and zero projects are valid. |
| `ConversationMessage` | `messageId`, `conversationId`, `ordinal`, `role: user | assistant | tool | system_notice | imported_context`, `contentParts[]`, `source`, `state: draft | streaming | committed | interrupted | failed | redacted`, `createdAt` | `providerItemRef`, `turnRef`, `replyTo`, citations/attachments as `ResourceRef`, `completedAt`, `editedFrom`, provenance, content hash. |

The conversation service owns the app ID and local history/refs; a provider binding may be absent, disconnected, replaced or inaccessible without changing `conversationId`. Message ordinal is monotone within one conversation and never recycled; branch ancestry is separate. A provider delta updates a streaming message under an explicit turn; only a terminal provider result and persisted reconciliation commit it. A user draft must survive navigation/restart where possible. A `system_notice` is an Aerynth notice and must never be passed off as a provider-authored message. `imported_context` is a cited adoption, not a copied source message inserted invisibly. Canonical source history is retained under explicit retention rules; compaction changes active context selection only. Proposed AW-CHAT-001, 005–020.

## 4. `ConversationLineageEdge` — `aerynth.lineage-edge@0.1`

Fields: `edgeId`, `sourceConversationId`, `targetConversationId`, `relation: fork | inspired_by | handoff | result_discussion`, `forkPoint` (`messageId`/ordinal or explicit `whole_conversation`), `createdAt`, `actorRef`, `sourceRevision`, `targetKind`, `handoffPackageId` nullable, `sharingScope`, and `creationReceipt`. The graph must be acyclic for `fork` edges; non-fork links may form cycles. A fork creates a new conversation and independent subsequent messages/turns. Neither edge nor shared project implies read permission. A deleted or unavailable source leaves a tombstone with policy-safe metadata and an explicit unavailable state, not a broken invented transcript. Cross-provider fork is an application-level new thread plus reviewed context package unless the specific provider capability proves native fork. Proposed AW-CHAT-008–012, AW-CON-032–034.

## 5. `ProviderCapabilitySnapshot` — `aerynth.provider-capability@0.1`

Fields: `snapshotId`, `providerId`, `instanceId`, `accountScope` (opaque), `providerVersion`, `adapterVersion`, `capturedAt`, `expiresAt`, `authState: authorized | expired | denied | unknown`, `operations` map, `sourceEvidence[]`, and `limitations[]`. Each operation (e.g. `thread.create`, `thread.resume`, `turn.stream`, `turn.cancel`, `approval.respond`, `chat.ordinary`, `conversation.fork_native`, `usage.read`, `history.list`) carries `availability: documented | discovered | verified | emulated | unavailable | unknown`, `constraints`, `lastVerifiedAt`, `verificationReceipt` if verified, and `reason`. `documented` never equals usable for this account; a catalog listing never proves model entitlement. Stale snapshots may inform UI explanations but must be refreshed/rechecked before a consequential call. Provider-specific extras stay namespaced. Proposed AW-CEX-002, 007–008; [official App Server guidance](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server).

## 6. `ContextHandoffPackage` — `aerynth.context-handoff@0.1`

Fields: `packageId`, `sourceConversationIds[]`, `targetConversationId` nullable until committed, `purpose`, `createdBy`, `createdAt`, `expiresAt` nullable, `sourceItems[]` of `{ResourceRef, revision, excerptHash, inclusionReason, provenance, visibilityScope}`, `summaryParts[]` with author/source classification, `redactions[]`, `estimatedTokens` with estimator identity, `policyDecisionRef`, `reviewState: draft | approved | rejected | expired | applied`, `appliedAt` nullable, `targetReceipt` nullable. Content payload is a protected attachment or reference; public logs retain only hashes/metadata. A package must be revalidated against current source revision, rights, target provider and token budget at apply time. It does not grant task authority, silently share whole transcripts, or delete sources. A declined/failed apply leaves source and target histories intact. Cross-provider import must say which content is user-approved context and which is provider-owned unavailable history. Proposed AW-CHAT-009–012 and Charter 08.

## 7. `ExecutionAttempt` — `aerynth.execution-attempt@0.1`

Fields: `attemptId`, optional `taskId`, `conversationId`, `providerBinding`, `requestedBy`, `startedAt`, `endedAt` nullable, `state: queued | dispatching | running | awaiting_approval | cancelling | interrupted | failed | provider_completed | verifying | verified | accepted | unknown`, `stateRevision`, `correlationId`, `turnRefs[]`, `eventRefs[]`, `artifactRefs[]`, `verificationReceipts[]`, `failure` nullable, `environmentRef` and `capabilitySnapshotId`. `provider_completed` is distinct from tests passing, reviewed, merged, deployed and owner accepted; those are separate evidence/acceptance records or transitions with explicit authority. A task can have many attempts and a conversation can have none. Cancellation request is not cancellation confirmation. On process loss, reconcile before retrying externally consequential work. Proposed AW-ENG-036, 093–098, 106–107; AW-CON-042–046.

## 8. `ApprovalRequest` and `ApprovalDecision` — `aerynth.approval@0.1`

`ApprovalRequest`: `requestId`, `attemptId` nullable, `operation`, `targetRefs[]`, `effectSummary`, `riskClass`, `scopeFingerprint`, `requestedBy`, `requiredAuthority`, `createdAt`, `expiresAt`, `state: pending | decided | expired | withdrawn`, `providerRequestRef` nullable. `ApprovalDecision`: `decisionId`, `requestId`, `choice: allow_once | deny | allow_scoped` (only if policy permits), `decidedBy`, `decidedAt`, `approvedFingerprint`, `conditions`, `auditEventId`. A decision authorizes only the exact operation/targets/environment/version and its time window; changed scope or stale policy requires a new request. Denial, expiry and provider rejection are explicit terminal states. The broker must reconcile provider-native approval and Aerynth policy without assuming one substitutes for the other. Never store credentials in the request or audit payload. AW-CON-024–025, AW-CON-062–065; proposed Charter 14 and AW-CEX approval requirements.

## 9. `WorkspaceLayout` — `aerynth.workspace-layout@0.1`

Fields: `layoutId`, `workspaceId`, `revision`, `mode: grid | dock | list | freeform | graph`, `placements[]` of `{placementId, resourceRef, displayRole, geometry, zOrder, pinned, collapsed, viewOptions}`, `displayTopologyHint`, `focusRef` nullable, `qualityPreference`, `createdAt`, `updatedAt`. Placement ID differs from resource ID; deleting a placement does not delete its resource. Geometry uses normalized logical coordinates within a named display role, with bounds checks and an off-screen recovery algorithm. A topology hint is advisory: when monitors disappear, reflow to a reachable display and preserve the prior arrangement for restore. A layout save uses expected revision; concurrent windows get conflict/merge UI rather than last-writer-wins data loss. Motion interpolation is transient and never stored as canonical layout. AW-CON-026, 029–030; proposed AW-EXP-057–066 and Charter 13.

## Example: ordinary idea to Codex and back

1. User message `mA` is committed to ordinary conversation `cA` without a task. `cA` remains accessible.
2. User requests implementation. The UI previews a `ContextHandoffPackage` containing a cited selection of `mA` and any approved context. The policy engine checks source and target scopes.
3. A new execution conversation `cB` and `fork` edge `cA → cB` are committed. The adapter creates a provider thread only after capability/auth checks. A task may be linked later; it is not required for the conversation to exist.
4. Real provider events update `ExecutionAttempt` and message state, with observed/reported provenance and explicit gaps. Completion of the provider turn is not verification.
5. A later ordinary conversation `cC` is created with a `result_discussion` or `fork` edge from `cB` and a user-reviewed, cited result handoff. `cA` and `cB` histories remain unchanged. Search can traverse edges subject to access policy.

Required contract tests: serialize/round-trip unknown optional extensions; reject unknown major version; duplicate command idempotency; stale revision/selection; disconnected provider and unavailable remote history; denial/expiry of approval; lineage cycle rejection; cross-account provider locator rejection; source deletion/tombstone; interrupted stream gap; layout restore after display removal; ordinary conversation with no task/project; cross-provider fork marked emulated if native fork is absent. These tests verify schema behavior when implemented, not current product capability.

## Decisions requiring owner acceptance before v1 freeze

1. Stable ID format, local-first versus provider-backed canonical message storage, retention/deletion and export rules.
2. Persistence engine, event/outbox durability, migration/backup policy and cross-device sync scope.
3. Authentication paths and account/workspace scope; whether eligible ChatGPT-plan OAuth, separately billed API, or both are supported.
4. Exact approval classes, scoped grants, audit retention and delegation limits.
5. Native versus application-level branch promise, handoff preview defaults and cross-provider redaction policy.
6. Numerical performance targets, target devices and quality tiers; cross-window sync and process model.

Until those decisions, implement against adapters and versioned tests, keep migrations reversible, and describe unavailable capabilities honestly. See the [ADR queue](../decisions/ADR-QUEUE-FOUNDATIONS.md).
