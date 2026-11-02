# Agent Library foundation

This is a provisional service contract and same-database implementation. It is
not yet an integrated Agent Library UI or an agent execution runner.

`AgentLibraryService` receives the **existing canonical** `DatabaseSync` and
synchronous transaction/read boundaries. Root supplies `AgentHostPort`. No
database is opened by the service. Agent profiles use canonical resource IDs;
the Root host creates a kernel `generic` resource and its semantic `agent`
projection through `createGenericResource`. It creates no Note, conversation,
workspace, placement, provider thread, or execution.

The service implements create, list, inspect, update, archive/restore, separate
profile/resource version fences, idempotent mutation receipts, and explicit
inheritance. Global and project settings remain Root-owned inputs. Additional
instructions are user/application adjuncts, never replacements for native
provider identity, instructions, tool approval, or sandbox behavior. Requested
capability IDs are requirements rather than grants. The eight templates are
editable profiles and do not imply running or authenticated agents.
Each accepted profile update advances the canonical resource fence once: rename
when its title changes, otherwise `touchGenericResource`; idempotent replay does
not advance it again.

`effective(ref, taskProjectId)` reports field origins, source versions, policy
and catalog digests, and catalog compatibility. That result is not entitlement
or execution proof. `recordAssignment` requires the reviewed effective digest,
current catalog revision, exact agent/task references, and optionally an actual
canonical execution reference. It stores an immutable configuration receipt and
references only: `referenceOnly:true`, `startsExecution:false`,
`taskVerified:false`. Existing task/execution owners retain all mutable status.
Missing execution metadata fails closed; no substitute execution is created.
Task provenance is mandatory host metadata (`supportedTaskOrigin`). The existing
note-backed DesktopState Task is explicitly `manual-compatibility`, not a rich
agentic objective. Its reference association establishes no agentic execution or
verified completion. A future `agentic-objective` adapter requires an actual
canonical domain implementation; this service does not provide one.

The host must return currently authorized canonical metadata and perform its
resource callbacks on the supplied connection in the outer transaction. Every
operation rechecks policy, owner, project, and resource state. Historical receipt
inspection uses current authority; archiving does not grant access. Archived
listing returns restoration metadata, not profile instruction bodies. No
provider connection, network discovery, credential probe, or model invocation is
allowed from the read-only catalog callback.

Module tables are additive, resource-FK-backed, versioned, and bounded. Partial,
future, or malformed schemas fail closed; they are not reset. Profile revisions
and receipt digests detect accidental corruption, not malicious filesystem
access. Lists expose bounded coverage and no unverified totals. Quotas fail
explicitly instead of pruning history.

Run `node --test prototypes/agent-product/tests/service.test.mts` from the repo.
Tests use real Kernel/DesktopState SQLite transactions with synthetic host policy
and provider catalog metadata. They cover persistence/restart, canonical generic
resource creation, actual manual-compatibility Task references, CAS/revocation, inheritance,
reviewed configuration fences, final-write rollback, and schema/FK/digest checks.
The execution reader is deliberately unavailable in these tests. Native UI,
successful canonical execution linking, streaming, cancellation, orchestration,
and artistic acceptance remain separate integration work.
