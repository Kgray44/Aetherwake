# Backend → visual team integration contract 0.1

Engineering contract, not ratified governance. The visual team owns rendering, styling, motion, shaders and accessibility implementation. No such files are changed by this package.

## Connect and identify

Use a trusted main-process/controller host to instantiate `Backend` and translate validated UI intents into `CommandMap` calls. Do not expose the worker's raw messages, native provider options, `authorized` assertion or database path directly to untrusted renderer content. IPC currently uses `aerynth.integration@0.1`; a mismatched contract is rejected. Unknown event schema majors must be shown as unavailable, never success. Additive optional fields may be ignored without changing meanings. `null` means known absent; absence means not supplied.

A conversation block points to `resourceId`; its own `block.id` is only a placement. Two blocks can share `resource_id`. Use `snapshot.conversations` for canonical identity and revision, `openWorkspace` for persisted placements, and `snapshot.resourceMap` only to resolve graph-local ancestry/message owners. Do not parse an ID's spelling. Provider identity comes from `providerId` plus capability `mock`, with binding details restricted to diagnostics.

`createConversation` requires no project or task. `selectProvider` changes the adapter selection without changing `resourceId`; existing binding history stays separate. No native provider session is created by opening a block. `place`/`move` never start a provider turn. An offline/missing thread keeps the block and local history available.

## Presence and execution state

Vela's presence consumes service state and recorded events. Vela remains the coordinator; Codex remains the execution provider.

| Backend evidence | Permitted semantic state |
|---|---|
| Awaiting a local command response | Loading; operation result not yet known |
| Execution `dispatching` | Connecting/dispatching; no verified start |
| `turn/started` and execution `running` | Provider working; elapsed time since received event may be measured |
| Agent-message delta | Provider-reported output, or simulated output when flagged |
| `provider_completed`, `taskVerified: false` | Provider finished; verification unavailable/not performed |
| `interrupted` | Provider confirmed interruption |
| `interrupt` response `{requested:true, confirmed:false}` | Cancellation requested, pending provider confirmation |
| `failed` | Local/pre-dispatch failure or known failed provider terminal state |
| `unknown` | Remote outcome unknown; do not retry automatically or show success |
| Reconciliation unavailable | Native history unavailable; local identity/history preserved |
| Gap/reopened marker or replay `truncated` | Capture/retention gap; no invented missing activity |

There is no percentage progress, private internal thought stream, task verification, review, merge, deployment or owner-acceptance signal in this contract. Available reasoning events may be represented by metadata; raw reasoning is deliberately not retained. No timer or animation can upgrade provider completion to task success. Unknown activity stays unknown.

## Intelligence Streams and replay

`StreamEvent` schema 1 includes stable application `eventId`, monotone **database receipt cursor**, provider/instance/connection identity, native sequence/thread/turn if supplied, execution/resource/correlation/causation references, receipt time, provider time/source where available, classification and safe metadata. `nativeEventId` is null because this bridge does not expose a separate provider event ID; its UUID is a bridge capture ID, not a provider-issued ID. Classification is `observed | reported | inferred | simulated`; always label simulated activity visibly. Provider source timestamps and local receive timestamps must be labeled separately. Graph fixture-clock timestamps are not provider measurements.

The worker commits an event before publishing it. A subscriber can query the same event immediately. Receipt ordering does not promise a total provider/global causal order. Dedupe uses `(provider, connection, bridge event ID)`; reconnection without native replay identity cannot guarantee cross-connection dedupe and gets a gap marker. Sequence discontinuity emits `stream/gap-or-reorder`. Native errors/credentials/raw tool arguments/output/reasoning are excluded; payload contains only redaction metadata, optional byte count and allowlisted item type. UI consumers can link execution metadata to local synthetic messages; the event payload is not a hidden transcript.

Subscribe first, then load a snapshot and replay from the last cursor. Buffer incoming events during replay, merge by `eventId`/cursor, and apply each once. Page until the returned `latest` is reached, then drain the buffer. Never assume a callback covers the period before subscription. Use `replay({after,limit})` with at most 1,000 records per page. If `truncated` is true, show a retention gap before the first available event. `subscribe` returns an unsubscribe function; call it on surface disposal. Subscription callbacks should enqueue bounded projection updates and return promptly; a slow/crashed UI can recover from replay. This prototype has no remote streaming endpoint or sustained-load IPC throughput guarantee.

The default retention keeps the newest 10,000 events, configurable from 4 to 100,000 at trusted host construction. Retention does not delete messages or lineage. Event IDs and receipt cursors of retained records never change. Deleted records cannot be reconstructed; physical SQLite file size is bounded/reused and not vacuumed automatically. A future accepted retention policy can replace this hook; this prototype policy applies only to synthetic local fixtures.

## Handoffs and failure UX

`branch` requires explicit source message IDs and produces a preview package with citations/digests/exclusions, source revision, target provider, conservative token estimate and fingerprint. It does not submit a native turn. Graph `suppliedAt` is a legacy local staging receipt, not provider delivery. `HandoffReview.state` is authoritative. Show `context.items`, exclusions and target label; submit `review` with that exact fingerprint. Rejected/expired/stale packages cannot execute. Context approval authorizes selected data transfer; execution also needs the trusted controller's user-intent authorization. Native tool approval is a separate boundary and remains declined in this slice.

The token estimate uses UTF-8 bytes as a conservative byte-token upper bound for the native tokenizer and includes serialized context; dispatch additionally checks the full user-supplied text including citations/request. It is a local context admission bound, not an enforceable provider output/total-token spending cap. No exact tokenizer or usage savings are claimed.

Repeat a command with the same `commandId` and identical payload to recover its stored receipt. A changed payload under the same key fails. Unknown dispatch is never automatically resubmitted, even with a new key. Reopen marks unfinished attempts unknown; read-only reconciliation establishes thread availability and safe synthetic item receipts, but does not prove an unknown turn's outcome. Error codes contain no raw provider diagnostics; show a recoverable failure notice and keep local content.

## Immediate synthetic assets

Import [visual-fixture.mts](fixtures/visual-fixture.mts) or consume [visual-fixture.json](fixtures/visual-fixture.json). It supplies stable synthetic resource/block IDs, execution lifecycle projections, a simulated stream, a gap and unknown outcome. Every provider event is labeled simulated; the gap is labeled inferred. It is a rendering fixture, not evidence of a real run. Use `npm run demo` for real service-generated simulated events and `npm run smoke` only on an explicitly authorized host.
