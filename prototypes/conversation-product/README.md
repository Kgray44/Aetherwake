# Conversation product integration

This module adds functional conversation discovery, canonical collection organization,
paged history, and selective Connected Branch knowledge references. It is an integration
component, not a separate application or provider backend. Combined native, motion,
performance, and owner acceptance remain the integrating host's responsibility.

## Minimum source packet

- `AGENTS.md`, `governance/README.md`, Constitution v1.0.0: binding baseline.
- Router invocation: `node scripts/governance-router.mjs --task "Implement searchable conversation histories folders collections projects Connected Branch lineage selective knowledge sharing review provider capabilities" --path prototypes/conversation-product --path prototypes/integrated-backend/src/core.mts --json`.
- Router selected 00 binding and 03/04/15 advisory. Scope inspection additionally
  consulted relevant sections of published charters 01/07/08/09/12/14. All specialist
  charters are published pending owner acceptance; publication is not ratification.
- Decisive binding IDs: AW-CON-002/004/006/011/015/018/023/026/031–035,
  049–054/069–073/079–083/086–089. Advisory design references:
  AW-CHAT-005–012/017/021/028–040/048–068/069–075/101–105/107–120;
  AW-CIE-006/013/015/016/019; AW-TRUST-001–004; AW-OBS-008/017/018.
- Canonical ownership inspected: `application-contract/contracts.ts`,
  `integrated-backend/src/{contracts,core,desktop}.mts`,
  `workspace-kernel/kernel.mts`, `connected-conversations/src/{graph,adapters}.ts`.
  Existing graph owns messages and lineage; kernel owns resources, projects,
  collections and membership; backend owns provider identity and execution.
- Vela is the independent persistent application assistant. This module supplies
  typed deterministic capabilities for host registration, never a Vela provider alias.

## Host adapter

`src/service.mts` exports `ConversationProduct` and `CanonicalConversationHost`.
Construct it after the existing backend initializes, passing the **same** canonical
`DatabaseSync` object. It does not open, reset, close, or create a parallel database.

```ts
const conversations = new ConversationProduct(canonicalDb, {
  snapshot: () => core.command('snapshot', {}),
  desktop: () => core.command('desktop', { type: 'snapshot' }),
  command: (name, input) => core.command(name, input),
  organize: input => canonicalOrganization(input),
  access: (resourceId, messageId) => policy.canRead(resourceId, messageId),
  sendWithContext: (input, context) => canonicalSend(input, context),
  contextReceipt: (executionId, resourceId, shareId, digest) =>
    executionContextManifest.has(executionId, resourceId, shareId, digest),
});
```

`organize` accepts the browser-safe `CanonicalOrganizationCommand` union. The
host delegates create/rename/archive collection and membership to the existing
kernel, with canonical version fences. It owns title synchronization between
resource and graph, project association, event attribution, and canonical mutation
authorization. The product service only SQL-writes tables prefixed `cp_`.

Host access must enforce current project/resource/message scopes, including
legacy project placement where ownership was null. Family links and collections
never grant access. Archived content requires explicit host authorization.
The host's renderer bridge must expose only `command`, not arbitrary DB access,
`attachedContext`, or `confirmSupplied`. Serialize commands in the existing owning
queue and validate trust/approval at that boundary.

`src/contracts.ts` contains `ProductCommandMap` and `ConversationProductPort`.
`VELA_CONVERSATION_CAPABILITIES` lists deterministic discovery/organization/branch
operations the host can register with Vela under the same authorization policy.

## Persistence and search

Schema v1 is additive, version checked, and installed in a savepoint. Unknown
versions are rejected without resetting user data. `cp_flags`,
`cp_collection_rules`, `cp_policy`, `cp_shares`, `cp_adoptions`, and `cp_audit`
contain only metadata/reference records. `cp_schema` owns this extension version.
Canonical collection IDs and membership come directly from the kernel tables.
Saved rules have a separate rule revision for concurrent-edit detection.

Search covers canonical titles, message bodies, and visible resource content;
filters include project, provider, collection, family, favorites, creation date,
and archive state. It evaluates current authorized source data on every request,
so there is no persistent text index holding revoked excerpts. Results link to
stable resource/message IDs. Paged detail reuses `ConversationGraph.visibleMessages`
to preserve original ancestor message IDs while keeping post-fork histories separate.
This phase uses case-insensitive literal search, not embeddings or semantic ranking.
The canonical backend's existing state capacity bounds the scanned dataset;
large-history native performance still requires integrated measurement.

## Sharing and execution

Branch creation delegates existing `branch` and `review` commands and labels
application continuation honestly. It never calls `applyOrdinary` or creates
synthetic assistant messages. Branch inclusion is explicit and version checked.

Publishing records source resource/message IDs, source timestamp, full-message
SHA-256, exact UTF-16 selection range, evidence class, and optional supersession.
The excerpt text itself stays in the canonical graph. Discovery returns references;
inspection resolves the current source; attachment requires prior inspection.
`discoverable`, `inspected`, `attached`, and `sent` are distinct recorded stages.
Policy provides Independent/Connected/Collaborative modes, allowed branches,
cross-project restriction, sensitivity ceiling, and evidence categories. This phase
performs only explicit user-directed publication/retrieval; no mode starts automatic
inference or silently injects a sibling transcript. Both source and target policies
must permit cross-project access; current host authorization is still required.

`attachedContext(resourceId)` resolves and revalidates every attached source.
The owning host supplies these quoted data records through existing execution
assembly. After actual dispatch, the host may call
`confirmSupplied(resourceId, shareId, executionId)`. The method demands a trusted
context receipt matching the source digest. A renderer cannot set `sent` directly.
If attachment transport is absent, Codex sending with attachments fails explicitly.
Local recording does not claim attachment content was sent to a model.

Revocation removes future discovery and detaches optional context. Source access
loss, missing messages, and changed digests block future assembly; detail reports
unavailable/stale source metadata without copying protected text. Prior supplied
receipts remain auditable. Conflicting or superseding contributions coexist; no
algorithm silently upgrades an evidence class or rewrites a transcript.

## UI mounting

```ts
import { mountConversationManager, createManagerState } from './src/ui.ts';
import './src/style.css';
const state = createManagerState();
const manager = mountConversationManager(hostElement, rendererPort, {
  state,
  onClose: closeTemporarySurface,
  onResource: navigateCanonicalResource,
  onState: savePrivateHostViewState,
});
await manager.ready;
// Later: manager.open(id, optionalMessageId); manager.refresh(); manager.dispose();
```

The surface is temporary and mountable; it adds no permanent sidebar. Drafts,
selected resource, page offsets, and scroll are held in `ManagerState`, which the
host can persist in private view state across remount/restart. Composer DOM survives
refresh; unchanged messages keep keyed DOM nodes for selection stability. History
renders 50 messages per page. Search input is debounced; there is no animation loop,
backend subscription, native window, capture, inference timer, or hidden renderer.
The host owns shared Motion Coordinator and visual integration. Keyboard operation,
status/error announcements, reduced-motion fallback and readable plain text are
included. Project pickers currently derive authorized IDs from available catalog
entries; the integrating host can use its named canonical project picker.

## Verification

Run `node --test prototypes/conversation-product/test/*.test.mts` with Node 24.18+.
Tests instantiate the actual integrated backend/kernel/graph with **synthetic**
conversations in a bounded temporary SQLite database. The test-only host implements
canonical collection delegation; it does not exercise native Codex inference.
Results are recorded in `VERIFICATION.md` after execution. Browser/native visual,
multidisplay, motion, long-history timing, and final owner acceptance remain with
the parent integrating phase.
