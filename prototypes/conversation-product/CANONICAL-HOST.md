# Canonical host adapter

`src/canonical-host.mts` adds a concrete organization adapter and read-only access
helper. Both use the existing canonical kernel and **same** `DatabaseSync` object;
the organization factory checks connection object identity. It opens no database,
creates no schema, copies no conversation, and writes no canonical SQL itself.

## Required parent callbacks

```ts
const organize = createCanonicalOrganizationAdapter({
  db: canonicalDb,
  kernel: canonicalKernel,
  atomic: operation => backendAtomic(operation),
  allow: request => canonicalPolicyAllows(request),
  conversation: resourceId => ({
    id: canonicalGraphId(resourceId),
    title: canonicalGraphTitle(resourceId),
    revision: canonicalConversationRevision(resourceId),
    providerId: canonicalProviderId(resourceId),
  }),
  renameConversation: (input, mutation) => renameCanonicalConversation(input, mutation),
  associateProject: (input, mutation) => associateCanonicalProject(input, mutation),
  touchCollection: (collectionId, expectedVersion, mutation) =>
    touchCanonicalCollection(collectionId, expectedVersion, mutation),
});
```

- `atomic` must be the owning backend's **synchronous** transaction wrapper,
  restoring both SQLite and in-memory graph/state on errors. Kernel savepoints
  alone cannot restore a partially mutated graph. Async mutation callbacks are
  rejected inside this transaction.
- `allow` is the parent's actual policy decision for typed project, workspace,
  resource, collection, message, membership, and project-association requests.
  The adapter does not grant permissions and does not implement native approval.
- `conversation` reads current canonical graph identity/title/provider and current
  conversation revision synchronously. It must not fetch external provider data.
- `renameConversation` must update the canonical resource title/version and graph
  title/conversation revision together. The adapter requires exactly one version
  and revision increment, unchanged graph ID/provider, and matching final titles.
- `associateProject` must update canonical primary ownership/resource version;
  for conversations, it also advances conversation revision while preserving graph
  ID/provider. It must not duplicate a transcript, recreate a thread, or expand
  filesystem/account permissions. Parent policy must authorize the destination
  and explicit association before the callback.
- `touchCollection` must perform the parent's canonical version/event update for
  a membership change, with an expected-version fence and exactly one increment.
  Existing kernel `addToCollection` / `removeFromCollection` supply membership
  events but do not advance collection version. The adapter intentionally leaves
  this missing canonical primitive with the owning parent instead of writing the
  kernel's tables directly or emitting a false rename event.
- Optional `mutation()` supplies a parent-originated `Mutation`; default attribution
  is user origin with a new correlation ID. Renderer input cannot forge it.

Create, rename, archive/restore and membership delegate existing kernel methods.
Membership checks current version **before** testing for a no-op. Repeated add/remove
with the current version does not duplicate membership, increment version, or emit
another event. A stale retry still fails rather than bypassing a version fence.
All mutation paths validate canonical state and parent access inside `atomic`.

## Access and provider observations

`createCanonicalAccessHelper({db, allow, messageVisible, allowArchivedResources})`
returns `access(resourceId, messageId?)` for the product host, plus read-only
`resource`, `project`, `collection`, and `projectIds` predicates/lookups.

Explicit primary ownership is checked first. For legacy null ownership, actual
canonical block/workspace placements are consulted: an archived-only or denied-only
placement cannot become a global resource. A still-active, explicitly authorized
presentation can remain usable if another placement is archived. Every path still
requires a positive parent resource-policy decision; placement/family/collection
membership never overrides it. Source/target sharing policy remains separately
enforced by the product service and parent's actual policy.

Archived-resource access is opt-in for explicit history/restore views. The product
service still distinguishes those views from active-context eligibility. Message
access fails closed unless the parent supplies `messageVisible`, resolving actual
canonical ancestry/ownership and revocation; no second message index is consulted.

`createObservedCapabilityCache` holds only a cloned observation of the existing
`Capability` contract. The parent calls `observe` after its actual supported native
capability query and supplies `cache.snapshot` as `host.capabilitySnapshot`. Cache
reads never connect, refresh, or execute a provider. Unknown, expired, or backward-
clock observations return unavailable; `inspect` distinguishes stale metadata from
a current observation. A model catalog remains a catalog, not a completed turn.

`resolveLocalRecordingProvider` prefers canonical `local`, falling back to the
existing `mock-ordinary` ID only when true local is absent, with compatibility
explicitly marked and model execution always false. `matchObservedExecutionProvider`
matches the exact observed canonical provider ID and excludes both local aliases.
Neither helper introduces a provider abstraction or changes Vela's independent
identity.

## Verification state

Four focused adapter scenarios are written in `test/canonical-host.test.mts`:
versioned/idempotent memberships and rollback; synchronized conversation callbacks;
current ownership/legacy placement scopes and same-connection enforcement; observed
capability cache expiry/cloning and local/provider identity. Execution is pending
the parent's next CPU-only test slot. Native windows, captures and provider turns
are outside this adapter worker's scope. Storage guard passed for bounded C≤256MiB,
D=0 additional allocation; exact host telemetry stays in private receipts. The
reserve instruction does not enforce quotas on external/already-running processes.
