# Canonical conversation draft recovery

`ProductCommandMap` exposes two browser-safe operations:

```ts
readDraft({ resourceId })
saveDraft({ resourceId, expectedVersion, content })
// Both return:
{ resourceId, version, content, updatedAt } // updatedAt: string | null
```

An absent draft returns version `0`, exact empty content, and `updatedAt: null`.
Every accepted save increments its own version, including same-content saves and
empty clears. Empty rows remain as durable revision tombstones, so an old version-0
writer cannot resurrect cleared text. `stale_draft_version` rejects a conflict
without changing either the stored content or version. Invalid revisions fail with
`invalid_draft_version`; invalid, oversized, or ill-formed Unicode content fails
with `invalid_draft_content`. Text is preserved exactly, without trimming.

Schema v2 adds `cp_drafts` on the SAME injected `DatabaseSync`, referencing the
existing canonical `resources(id)`. A savepoint upgrades schema v1 atomically and
preserves its flags, policies, collection rules, sharing records and IDs. Known
versions 1/2 are accepted; unknown or malformed version records fail without reset.
A v2 store missing its draft table fails `conversation_draft_storage_unavailable`.
There is no second transcript, resource database, execution store, or provider.

Only an active canonical conversation with current host access may read or save a
draft. Canonical resource state and live authorization are checked at the mutation
boundary. Archived, unavailable, non-conversation and revoked resources return
`source_unavailable`; their existing draft is retained. Restoring authorized access
or the active conversation restores the same draft and revision.

Limits are exported as `CONVERSATION_DRAFT_LIMITS`: 16,384 UTF-16 units and 65,536
UTF-8 bytes per draft, 8 MiB aggregate retained draft text, and 4,096 rows including
empty tombstones. Capacity rejection is `draft_capacity_exceeded`, with no partial
write, truncation, eviction, or automatic deletion. Explicit empty saves release
text capacity and retain the revision record. Autosaves do not append per-keystroke
audit records. Inaccessible and archived drafts still count toward retention.

The service never reads, attaches, publishes, searches, exports, sends, inherits,
or automatically clears a draft as part of another operation. Draft revision is
independent from conversation revision. Branches start with no draft. A local send
records only its explicit submitted content; provider context contains only the
explicit request and separately authorized attached sources.

The integrating UI/session coordinator must serialize/coalesce recovery saves and
capture the actual submitted content and its returned draft version before Send.
After actual send acceptance, it may explicitly `saveDraft` with `content: ''` and
that exact version only if its editor still contains the submitted text. Later
typing, later durable saves and conflicts must survive; a failed or unknown send
must not clear anything. Conflicts require an explicit keep-local or use-stored
choice, rather than silent overwrite. A successful service send deliberately leaves
the draft untouched until this separate recovery decision.

Root integration must admit `readDraft` as read-only and permit `saveDraft` as
authorized recovery metadata even while provider execution is active. Core's
startup schema guard must admit known v1/v2 before the service migration. UI, block
composer, native bridge admission and actual native restart acceptance remain their
respective owners' integration responsibilities.

`test/drafts.test.mts` exercises real canonical Core/kernel/SQLite seeds, additive
v1 upgrade, unknown-version preservation, same-file kernel connection restart,
revision conflicts, durable empty clears, exact text, access/archive revocation,
exact aggregate and row capacity, independent branch/transcript/search/export/
context, and later in-flight edits when a synthetic provider callback fails.
The restart fixture uses unchanged cached canonical read views after reopening the
same file through its kernel owner; full BackendCore startup requires Root's schema
guard integration. No native window or actual provider is used by these tests.
