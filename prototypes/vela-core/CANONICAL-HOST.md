# Canonical Vela host adapter

`createCanonicalVelaHost()` in `src/canonical-host.mts` makes the existing canonical app services available through `VelaHostPort`. It owns no tables, resources, conversations, history, execution records, layouts, blocks, templates or application preferences. All SQL performed by this helper is read-only. Mutations occur only through explicit parent-owned callbacks.

## Exact callback API

```ts
const host = createCanonicalVelaHost({
  db: this.db, // the SAME existing canonical connection
  transaction: work => this.atomic(() => work(this.db)),
  metadata: () => currentDesktopMetadataProjection(),
  currentContext: () => ({
    principalId, policyVersion,
    currentProjectId, currentWorkspaceId, selectedResourceIds,
  }),
  permissions: {
    scope: (context, metadata) => actualAuthorizedAllowList(context, metadata),
    metadata: (ref, context, metadata) => mayDiscoverMetadata(ref, context),
    content: (ref, context, metadata) => mayReadContent(ref, context),
    authorize: (request, context, metadata) => issueOrDenyActualHostGrant(request),
  },
  conversations: {
    ensure: key => ensureCanonicalAssistantConversation(key),
    read: id => readCurrentCanonicalConversation(id),
    append: (id, message) => appendCanonicalMessageWithProvenance(id, message),
  },
  revisions: {
    conversation: id => currentCanonicalConversationRevision(id),
    workspace: id => actualEngineProjectionRevision(id),
  },
  dispatch: {
    native: command => verifyGrantAndDispatchReleasedApplicationCapability(command),
    delegateTask: command => verifyGrantAndDelegateCanonicalExecution(command), // optional
    preference: command => verifyGrantAndApplyCanonicalPreference(command), // optional
  },
});
```

`transaction` supplies its actual live connection to the callback. The helper checks object identity against `db`; a second connection or an unrelated transaction boundary fails. The parent wrapper must include canonical in-memory graph/state rollback as well as SQLite rollback when its callbacks change those systems. No async provider/delegation promise is held inside a synchronous database transaction.

The parent's `conversations.ensure` callback must record the canonical Vela conversation ID in its actual scope/metadata policy before returning. The helper then validates the returned resource immediately. This is a parent-owned canonical identity binding, not a permissive helper exception for a newly created chat.

`metadata` returns `CanonicalVelaMetadata`, a projection of actual `DesktopSnapshot` projects/workspaces/resources/placements and current workspace. Existing full `DesktopSnapshot` values structurally fit, but a metadata-only projection avoids the existing full snapshot's eager body/transcript work. The helper reads no resource body and invokes no canonical conversation reader during scope/search/resolve. Only canonical entity metadata is queried from SQLite during discovery. Metadata factories and revision callbacks should therefore remain cheap and content-free.

The context is supplied by the parent application's real current project, workspace and selection. `host.context()` filters it against live authorization; selecting an item never creates access. The parent `permissions.scope` is an exact allow-list, not a hint. It can include authorized resource ownership, explicit grants and actual placements in authorized workspaces, including legacy conversations whose `project_id` remains null. A placement does not change ownership or automatically grant access. The helper never expands scope from a relationship or from a selected ID.

Metadata and content policy callbacks are both mandatory. There is no allow-all fallback. Live canonical rows, active owning projects, available/visible metadata and the current policy version further constrain the parent allow-list. Archived entities, removed placements in the parent's current snapshot, denied metadata and changed policy immediately invalidate access. Explicit parent resource grants can cross a project boundary if permitted, but archived owning projects remain unavailable.

## Freshness and content

Notes expose the actual canonical resource version. Conversations combine the canonical resource version with the current canonical graph/message revision. Workspaces combine their metadata version with the actual engine projection/layout revision supplied by the parent. `canonicalVersionToken()` uses exact injective pairing within the safe-integer range; `max(version,revision)` would miss a message or layout change while the smaller value grows. Null/missing dependent revisions are unavailable, not fabricated defaults.

The resulting `ResourceRef.version` is a freshness token for preview/context/expected-target manifests. Parent dispatchers compare it through `host.resolve`. Typed native commands retain their own actual native expected-version fields. The token does not replace a resource's SQL version or the engine's revision, and the helper never changes either.

`readContent` first checks metadata membership and separate content permission. Notes come directly from the canonical `notes` row; a SQL UTF-8 byte-length check precedes materialization. Conversations come from the parent canonical reader with matching current revision and message provenance. Returned source links retain canonical IDs/revisions. Content above the configured 128,000-byte default is unavailable rather than silently truncated. Vela's stricter context builder still selects/omits content at its existing 12 KiB per-source/32 KiB total limits. A denied content read can leave authorized metadata discoverable.

`authorize` revalidates the live target versions, full prospective discovered metadata and included-content permissions, then delegates to the mandatory parent policy callback. Only the parent issues an opaque authorization reference. `applyNative` requires a complete fresh action-target manifest and forwards the exact typed command and reference to the mandatory parent dispatcher, which verifies the actual grant atomically with canonical mutation. A string shaped like a grant is not permission.

**Universal Block System owns all block work.** In particular, `workspaceFromResources` is opaque forwarding to the parent's released capability. This helper does not create a workspace/block, attach a placement, apply a template, change a layout, or supply a fallback block implementation. A dispatcher receipt reflects the parent's actual capability, not an inferred effect from this helper.

## Read-only native consent preview

`VelaService.previewContext(resourceIds)` uses the **same authorized context builder** as a real request, without opening a Vela conversation, appending messages, creating a request, updating presence or calling a provider. Parent native consent can display that exact metadata/content and retain its stable egress signature. Exclude only the fresh manifest ID/creation time from signature comparison; include all discovered/omitted/included IDs, versions, source links, content digests/content, policy and byte counts.

At actual request dispatch, the parent compares the preview signature against the new full manifest, rejects changed scope/content/message revisions, then binds the host grant to the actual request ID, full manifest hash and prompt hash in `CodexPlanningAdapter.authorizePlanning`. Preview is not execution or a provider authorization by itself.

## Verification

New canonical-host tests use the real `WorkspaceKernel` SQLite schema and the same injected connection, with parent-owned canonical conversation/message tables and explicit policy/dispatcher callbacks. They cover metadata-versus-content access, project/placement/archive revocation, conversation/engine freshness, connection identity, mandatory policy, canonical transaction rollback and forwarding without block creation. A separate regression checks read-only preview side effects and changed source content. No provider turn or native UI is needed for these tests; actual integrated native consent/live planning remains parent-owned.

Executed verification: **33/33 full-module tests passed**, 436.5494 ms reported test duration, preserving all 23 prior scenarios and adding nine canonical-host scenarios plus one consent-preview scenario. The added delegation scenario verifies that both discovered metadata and included content remain within the exact child resource scope and that changed canonical versions block dispatch. The full shared TypeScript check passed with zero diagnostics after correcting an `.mts` generic-arrow syntax ambiguity. `git diff --check` passed. No provider turn, native window, network request, dependency install, build or cache fill was launched by this helper's work.
