# Canonical conversation product integration

`BackendCore` constructs `ConversationProduct` on its existing kernel and identical
`DatabaseSync` connection. Canonical collection changes delegate the kernel;
conversation rename synchronizes resource and graph titles and versions; project
association changes primary ownership and advances conversation revision. No
second transcript, resource catalog, provider adapter, or execution service exists.

## Native host contract

- `conversation({name, input})`: typed `ProductCommandMap` envelope for discovery,
  history, organization, sharing and normal local recording. Local `send` delegates
  canonical idempotent `addMessage`, including legacy recording aliases. Native
  `send` never executes from this route: the injected `sendWithContext` rejects with
  `native_send_approval_required` when capabilities are available. An unknown native
  catalog remains unavailable. The host should intercept native sends proactively.
- `conversationSendPreview(sendInput)`: source-read-only preview of exact user
  request, expected revision, provider/model, authorized selected context references,
  source content/digests/evidence, approved branch handoff where applicable, exact
  transport text, fingerprint and expiry. It starts no connection or model turn.
- `authorizeConversationSend({previewId, fingerprint, commandId})`: **trusted native
  host only** after its actual consent/policy decision. Never expose this command
  to a renderer, model/tool caller or generic allowlist. Returns a one-use opaque
  grant with at most 60 seconds validity. The host remains the actor/approval owner.
- `conversationSend({previewId, grantId, fingerprint, commandId})`: revalidates
  current revision, source access, sharing policy, source digests and exact scope,
  consumes the grant, then uses existing canonical execution. Replays fail closed.

Native IPC must bind an approval to the preview fingerprint and exact command ID,
show intelligible source/provider scope, and keep authorization issuance private.
The same broker can serve Vela; Vela remains a separate assistant identity.
Previews and grants are bounded, expiring memory-only records. Restart discards
them; it does not resend an uncertain execution. Grant possession is not a source
permission and never sets an attachment's supplied state.

The canonical raw `execute` API remains a trusted-host compatibility operation;
it must retain the native host's existing approval checks. Do not expose its
`authorized` boolean as renderer authority.

## Data, context, and availability

The default backend is a single local-owner data boundary. The access helper checks
current canonical resource/project state, legacy workspace placements, canonical
message ancestry and revocation. It is not a multiuser ACL system. Native/assistant
actor policy and any additional source constraints must be enforced by the parent
host broker. Family/collection links never create filesystem/account authority.

Local histories, search and ordinary recording use a side-effect-free last-observed
capability cache. They do not connect App Server. The explicit existing
`capabilities` operation and an authorized execution populate the observation cache;
an expired/unknown catalog never implies supported live execution.

Managed execution persists the raw user request before network dispatch, including
synthetic failure fixtures. Selected excerpts are quoted data in transport, never
silently appended as historical user text. Sources are revalidated immediately
before `ProviderPort.turn`. Only an accepted nonempty provider turn ID creates the
durable reference-only `contextSupplies` receipt; only that receipt can advance
selected sharing records to `sent`. Completion/interruption/unknown execution state
remains separate. Failure before turn acceptance preserves user text and leaves
attachments unsent. Restarts validate receipts against their canonical execution.

Read-only conversation operations and inspection remain available during an active
execution. Consequential graph/organization/sharing changes are fenced. Block
presentation and the Universal Block System are outside this integration change.

## Evidence and limits

Node 24.18.0: five new integration tests passed; the full backend suite passed
**41/41**. Strict TypeScript noEmit passed for core/contracts/new integration tests.
Scenarios cover normal local create/search/folders/send/restart and idempotent retry;
canonical rename/project identity; denied, stale, expired and replayed grants;
selective context; raw user text; durable supplied receipts; provider failure; and
reads during execution with mutation fences. Tests use the actual backend/kernel/
graph and explicitly synthetic fixture ports. No native window, screenshot, live
provider turn, package installation, clone, cache fill or asset transfer was run.

Actual desktop native consent/IPC/UI, Vela broker integration, visual/motion and
performance acceptance remain the parent's responsibility. ReserveGuard passed for
bounded additional C≤256MiB and D=0 allocation, maintaining separate 30GiB reserves.
Exact host disk telemetry stays in private tool receipts. The instruction/check is
not an OS quota and cannot constrain external or already-running uninstrumented
writers.
