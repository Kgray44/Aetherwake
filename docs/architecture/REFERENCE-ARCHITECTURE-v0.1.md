# Aerynth reference architecture v0.1 (owner-approved design baseline)

> **Owner-approved design architecture (2026-11-05).** The architectural intent and specified product guarantees are accepted; individual provisional interfaces, technology choices and implementation details still require the applicable ADR and integration verification. This approval is not a claim of delivered capabilities.

Status: owner-approved architectural direction (2026-11-05). Specific unqualified technology/interface choices remain provisional. No implementation or release acceptance is implied.

## Authority and design rules

The [Constitution](../../governance/00-AETHERWAKE-CONSTITUTION.md) and specialist charters 01–16 are owner-ratified, as recorded in the [registry](../../governance/README.md). Their requirements are binding design targets; referenced prototype interfaces and implementations remain evidence-gated. This design follows the M0–M8 sequence in [Charter 16, section 5](../../governance/16-ENGINEERING-AND-DELIVERY.md). Technology names remain candidates pending comparative evidence and an accepted ADR. Relevant anchors: AW-CON-002, AW-CON-004–006, AW-CON-016–021, AW-CON-026, AW-CON-031–035, AW-CON-042–046, AW-CON-057–065, AW-CON-069–073; proposed AW-ENG-015–026 and AW-CEX-006–008.

The architecture has four rules: (1) canonical identity belongs to Aerynth even when a provider owns a session; (2) policy decisions are enforced before side effects at the application/service boundary, not inferred from the appearance of a UI card; (3) a renderer can project state but cannot author execution truth; (4) ordinary conversation has a direct path that never requires a task or project.

## Logical topology

```text
Windows / views / accessible controls
       | typed intents and subscribed projections
       v
Application service boundary (commands, queries, subscriptions)
       |-- policy decision + approval broker (before effects)
       |-- resource / conversation / workspace store
       |-- Vela intent coordinator --> CIE context composer
       |-- task scheduler --> execution registry
       |-- event journal --> streams / profiler / replay projections
       `-- provider capability registry --> adapters --> Codex App Server / other providers
       ^                                  |
       `------------ normalized results/events, provider handles, errors

Motion Coordinator consumes semantic view state, accessibility policy,
quality policy and event projections. It never writes canonical domain state.
```

This is a dependency diagram, not a process diagram. An in-process prototype may implement several boxes together behind interfaces. A later multi-process design needs an ADR and threat review. No renderer should hold provider credentials or directly invoke a tool. The service boundary must survive window closure and reconnect where the selected process architecture permits.

## Boundaries and owning state

| Subsystem | Owns | Exposes / must not own |
|---|---|---|
| Desktop host and platform services | window lifecycle, display topology, secure storage integration, OS notifications, process supervision, crash/restart signals, quality telemetry | typed platform capabilities; never conversation history or inferred agent success |
| UI shell and Motion Coordinator | ephemeral focus, hover, drag, selection presentation, six-domain transition scheduling, material tokens, reduced-motion and quality-tier projection | commands over stable IDs; never canonical resource identity, approval authority or actual progress |
| Vela interaction and orchestration | intent interpretation, suggested actions, attention proposals, explicit assistant session state | typed commands and policy checks; no ambient omniscience or silent permission growth |
| Resource kernel | app-generated resource IDs, project/collection relationships, workspace placement, notes metadata, deletion/retention markers | atomic resource operations; provider content remains provider-owned unless deliberately imported |
| Conversation service | app conversation/message IDs, ordered local history or durable provider references, drafts, lineage edges, local metadata, branch imports | separate ordinary and execution-oriented conversation modes; no required task association |
| Connected Branches | ancestry and typed post-fork knowledge references, adoption receipts, provenance and sharing scope | selected handoff packages; does not merge transcripts or grant cross-branch access by relationship alone |
| CIE | context candidates, selection rationale, redaction and token-budget plan, versioned handoff packages and compaction metadata | context proposal with source refs; does not erase source history or manufacture provider access |
| Task and agent execution | task objectives/dependencies, agent profiles, execution attempts, verification states, cancellation intent | provider-agnostic scheduling and result evidence; not the chat's identity |
| Provider registry and adapters | provider instance and scoped thread mappings, capability snapshots, protocol version, normalized calls/events/errors | actual support under current auth/settings; no fabricated parity or hardcoded entitlement |
| Event ingestion and projections | append-only observed/reported/inferred event records, dedupe and ordering markers, stream views, profiler measurements with source/unknown status, replay coverage | event-backed projections; not private chain of thought or evidence of acceptance by itself |
| Trust and authorization | effective principal, grants, scoped decisions, approval request/decision records, revocation and audit metadata | enforce before tool/file/network/provider action; relationships, visuals, Vela suggestions and provider claims cannot grant access |

**State classes.** Application state comprises stable resources, chats, local messages, layouts, tasks, policies and durable relationships. Provider-owned state comprises Codex threads/turns, provider messages, model/tool capabilities, remote history and credentials; Aerynth stores scoped references and only an authorized, explicit local copy where supported. Event history is Aerynth's append-only account of observations and derived records, with gaps and source distinctions. Rendering state comprises animation tracks, particle buffers, focus and view cache; it is disposable and recoverable from domain state. A single block may reference one resource in several windows. Closing a block removes a placement, not the resource. AW-CON-026; proposed AW-CHAT-005–012, AW-LIQ-005, AW-EXP-060–061.

## Commands and events

1. A surface issues a typed command with `ResourceRef`, actor, expected revision, intent and correlation ID. The service resolves current state and checks scope and capability. Consequential effects pass the policy engine; an approval decision is bound to a fingerprint of the operation, target set and time window.
2. The owning service commits a domain change and journal event, ideally in one transaction or via an outbox. A rejected, timed-out or stale command yields a typed error and no optimistic success. For an external provider action, the adapter records dispatch and later reconciles observed results; it cannot guarantee atomic commit across the process boundary.
3. Subscribers render projections. The Motion Coordinator maps semantic state transitions to Spatial, Material, Atmospheric, Semantic, Interaction and Performance Motion using one timebase, stable resource IDs, transition IDs and priority. Reduced motion and low quality keep meaning, focus and inputs. Unknown execution state receives an explicit unknown or degraded presentation, not a success effect. AW-CON-017–021; proposed AW-LIQ-015–022, AW-OBS event provenance requirements.

Commands that are local and deterministic (open, focus, filter, save a note) should take the direct service route without a model call. Selection is a referent, not a forced scope: a request about all items in a folder can expand beyond one selected child only after the actual set, authorization and preview are resolved. AW-CON-022–025; proposed AW-EXP-027–035, AW-EXP-041–048.

## Conversation coexistence and branch flow

`Conversation.kind` is `ordinary` or `execution`; both use the same stable app identity, message identity, history access, search, drafts, fork graph and provider mapping envelope. `kind` controls affordances and adapter policy, not whether a formal task exists. An ordinary chat may use a supported conversational provider without tool execution; a Codex conversation may be a direct chat without a formal task. A capability snapshot determines which backend can stream, resume, fork or hand off. Aerynth-owned local history and authorized backend references are displayed with explicit coverage, never silently filled from the user's ChatGPT account.

Forking from ordinary discussion into Codex creates a new execution conversation and a `ConversationLineageEdge` pointing to the source conversation and precise source message/selection. A user-reviewed `ContextHandoffPackage` copies selected authorized context, not the complete transcript by default. Both original and child histories stay intact. Forking back creates an ordinary child, links its source execution/conversation and includes a sourced result summary or artifact references. On every post-fork adoption, record source revisions, scope, actor and approval; a source branch edit does not silently rewrite an adopted target message. If native provider fork is unavailable, a new provider thread plus explicit context package may implement application-level branching, clearly labeled as such. AW-CON-031–035; proposed AW-CHAT-001–012, AW-CIE connected-branch requirements.

Failure cases: provider disconnection preserves local conversation identity and draft; a missing remote history is shown as unavailable; failed handoff leaves both histories unchanged; a stale source selection requires re-resolution; denied cross-branch sharing stops before context transfer; an interrupted turn remains interrupted, not complete. A branch relationship grants discovery only within effective visibility rules.

## Provider reality and capability negotiation

OpenAI's [App Server guide](https://learn.chatgpt.com/docs/app-server) describes a client protocol; the [Codex App Server sign-in guide](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server) documents `initialize`, `thread/start`, `turn/start`, streamed message deltas, `turn/completed`, and `thread/resume` for its ChatGPT-plan OAuth path. Its `model/list` can be a bundled catalog, so an actual completed inference turn is needed to verify model access for that request. These are documentation facts, not a successful Aerynth integration. M2 must exercise current installed binary/protocol and credentials in a bounded spike.

[Sign in with ChatGPT](https://developers.openai.com/siwc/quickstart) can allow eligible, authorized open-source clients to use a ChatGPT plan for eligible inference; identity scopes alone do not grant that usage or access to existing ChatGPT conversations. Aerynth must choose and verify its integration path and account policy. A generic API-key path is separately billed/authorized; a ChatGPT subscription is not an arbitrary API entitlement. The [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) require `store:false` and streaming on the documented plan-sharing Responses route and list unsupported hosted tools and fields. App Server has its own local thread history and RPC inputs; local tools differ from hosted Responses tools. Capability snapshots must therefore be scoped to provider instance, account, connection, model, operation and timestamp, with `documented`, `discovered`, `verified`, `experimental`, `emulated` or `unavailable` evidence. Unknown is a real state. Recheck on auth change, provider upgrade, reconnect or model selection. Never treat catalog presence as entitlement.

## Durability, recovery and replay

The persistence engine remains undecided. Any candidate must prove atomic local resource writes, schema migration and recovery, ordered event append or outbox, bounded indexing, backup/export, and no credential leakage. Provider events are ingested with `(providerInstance, nativeEventId)` dedupe keys where available; otherwise use a scoped content/sequence fingerprint and mark collision uncertainty. Preserve receive time and provider time separately. A stream interruption records a gap and reconciliation attempt; replay can reconstruct only covered events and versioned projections. A profiler field without a trustworthy provider or local measurement source is `unavailable`, never zero. Proposed AW-OBS, AW-PRO, AW-TML, AW-TRU and AW-QUA charters provide the detailed review scenarios.

Schema migrations must preserve original history and support interrupted-upgrade recovery. At minimum M3 tests kill/restart around write boundaries, reopen the same resource in two views, and restore an off-screen layout to one display. External provider sends use an idempotency/correlation strategy where supported; where unavailable, surface possible duplicate or unknown outcome and require user-directed retry rather than blind replay.

## Integration seams and current risks

| Seam | Contract / gate | Risk to resolve |
|---|---|---|
| Shell ↔ platform | window/display/secure-store adapter, no renderer secrets | shell choice and cross-window composition not benchmarked |
| UI ↔ service | versioned commands, snapshots, event subscriptions | cross-window stale writes and focus continuity |
| Service ↔ persistence | transactional repository and migration interface | engine and recovery semantics undecided |
| Service ↔ provider | `ProviderCapabilitySnapshot`, `ExecutionAttempt`, normalized events | installed App Server protocol/auth and entitlement must be verified |
| Policy ↔ all effects | operation-scoped `ApprovalRequest`/`Decision` | provider-native approval and Aerynth policy must not diverge |
| CIE ↔ conversations | `ContextHandoffPackage` with source receipts | no automatic ChatGPT history access; token/quality tradeoffs |
| Events ↔ UI/profiler/replay | `AppEvent` provenance and gap markers | duplicate, missing or delayed provider telemetry |

The [provisional contracts](../specifications/PROVISIONAL-INTERFACE-CONTRACTS-v0.1.md) define these seams. The [ADR queue](../decisions/ADR-QUEUE-FOUNDATIONS.md) records the experiments and owner decisions needed before a production stack is selected.
