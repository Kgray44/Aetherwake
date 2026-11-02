# Vela Core functional module

Vela is an application-level assistant and coordination service. Codex and other planning/execution providers retain their own identities. Local search, navigation, note/task creation, workspace organization and relationships do not need a model. Natural-language planning uses an optional, explicitly attributed `VelaPlanningPort`; this module contains no model implementation, inference credentials, network client, demo intelligence, regex intent parser, or provider impersonation.

This module is an integration component, not a separate application or database. It adds one `vela_state` metadata table to the **injected canonical SQLite connection** and never opens or closes a connection. Canonical resources, conversation messages, placements, native command receipts and provider executions stay with their existing host owners. Vela stores request/plan/context/attention metadata and links to host receipts. It never copies a conversation transcript or treats a host/provider turn as a verified task outcome.

## Host integration

```ts
import { VelaService } from './src/service.mts';
const vela = new VelaService({
  db: canonicalDatabase,
  transaction: work => canonicalKernel.withTransaction(work),
  host: canonicalVelaAdapter,
  planner: optionalAttributedPlanner,
});
```

`VelaHostPort` in `src/contracts.ts` is the integration contract. Its synchronous conversation operations use the host's canonical conversation ID and graph, within the supplied transaction. `scope()` is host-derived, never renderer-supplied. The host must mediate content eligibility and provider egress separately. Placement in an authorized workspace can be an access-policy input; it does not change resource ownership or duplicate the resource.

The host's `authorize()` issues opaque authorization references and evaluates actual policy, including revocation and explicit execution consent. A renderer boolean is **not** an action authorization. `review()` records the host-issued review reference against a fixed plan fingerprint; `apply()` obtains fresh host authorization and passes its reference to every native command. Native typed actions that the user explicitly requested can use `native()` and `apply()` directly without an additional provider or redundant review interaction. A provider proposal requires review.

`applyNative()` is the canonical command boundary. It must validate `expectedVersions`, the authorization reference and a globally idempotent `commandId` **atomically with the canonical mutation**. Most actions map to the existing `DesktopAction` union. `workspaceFromResources` is one host transaction that creates a workspace and attaches the exact existing canonical resource IDs. Its receipt returns `createdWorkspaceId`. The service never creates a replacement resource/placement store.

`delegateTask()` is optional. It requires enabled delegation **and** a fresh host-issued execution authorization. Its input preserves the initiating intent, source canonical conversation, attributed receiving provider, bounded resource IDs, constraints and attenuated context manifest. Execution truth remains in the host. The returned receipt is not a declaration that the delegated objective is complete.

## Planner integration

`VelaPlanningPort.availability()` exposes observed availability/busy state. `propose()` receives one bounded request, explicitly selected content, capability schemas, provenance and an `AbortSignal`. Its result must satisfy `ProviderProposal` and name the actual provider. The host planner adapter is responsible for its supported provider protocol and identity, model selection, provider lifecycle and trusted instruction channels. Use the existing real Codex bridge when appropriate; do not replace Codex's identity, native instructions, or ordinary conversation controls.

Metadata search and content inclusion are distinct. Search returns at most 30 permitted metadata references without reading content. A request may read at most 12 selected sources, 12,000 UTF-8 bytes each and 32,000 bytes total. Oversized sources are omitted with a reason rather than truncated. Every included source has a version, content digest and source link. Data is labeled untrusted. The manifest does not claim to expose provider-managed hidden context or private reasoning. Provider-context permission is checked before `propose()`.

Proposals are validated as data, never evaluated as code. Unknown capabilities/fields, invalid IDs, wrong attribution and duplicate step IDs fail closed. Rejected provider output up to 64 KiB is preserved in private local state for inspection; larger/nonserializable output gets an explicit omission record. Plans expire after 15 minutes, bind exact target versions and policy, and are revalidated after inference, review, and before every action. Dependent mutations to the same versioned target need a fresh plan: this first slice deliberately does not invent refreshed versions or auto-expand a reviewed plan.

`apply()` records a started receipt before dispatch. An adapter exception after dispatch is `unknown`, preventing automatic re-execution. On restart, in-flight planning/actions become unknown and are not replayed. Applying an already applied plan returns its receipt state without duplicate execution. Reconciliation of an unknown host outcome belongs to the canonical host execution/receipt service; this module does not guess it succeeded or retry it.

## Existing-dialog UI

`mountVelaPanel(root, client, options)` in `src/panel.ts` mounts inside the host's existing `#vela-dialog`. Include `src/panel.css` through the current renderer build and implement `VelaClient` via the host's existing trusted IPC. Mounting and `open()` do not start inference, apply plans, read source content, or mark events reviewed. The panel exposes a durable conversation, local search/actions, explicit provider-context disclosure, proposal review, typed targets/versions, context inspection, host receipts, cancellation and attention settings. All user/provider text is inserted through `textContent`, with no HTML interpretation.

The panel is browser-safe and creates no native window. The host retains cinematic presentation and Motion Coordinator ownership. The panel itself uses no animation, continuous polling, pseudo-progress, fabricated thinking, provider turns, or external monitoring.

## Attention foundation

Preferences persist normal/quiet/focused/collaborative/proactive modes, explicit app-event subscriptions, severity thresholds, interruption budgets, and independent monitoring/delegation toggles. Monitoring and delegation default off; learned preferences are explicitly disabled. Quiet produces silent recorded items; focused mode defers interruptions. Other modes use the configured threshold/budget, so changing a mode cannot silently broaden event subscriptions or permissions.

Only host-fed authorized application events are classified. There is no OS/window activity watcher, screen capture, microphone, external account polling or inference loop. Event source, occurrence time, receive time, evidence class, correlation, source subject and coverage gap survive into review. Opening the app updates presence only; review/dismissal is per event, and neither changes the underlying task or approval. Revoked subjects are hidden from attention views and blocked at review. This is a stored app-event digest foundation, not a claim of continuous external awareness.

## Adaptive Experience preferences

Adaptation is a separate, default-disabled policy family in the same Vela metadata state. Each presentation/organization category has independent enablement and one of four levels: **manual** records explicit choices only; **suggestive** records inspectable hypotheses; **assisted** can apply an accepted hypothesis after user review; **adaptive** can automatically apply a permitted low-risk preference after at least three distinct observed user app actions and host authorization. These levels never grant source access, tools, provider execution, sensors or privilege changes.

Only two keys are implemented: `presentation.density` (`comfortable`/`compact`) and `organization.defaultPreset` (`balanced`/`focus`/`development`/`research`), scoped globally or to an authorized workspace. The schema rejects all other keys and values. Confidence is explicitly a count-based heuristic (one/two observations low, three/four medium, five or more high), not a probability or fabricated model inference.

The host app-event adapter calls `observePreference()` with an already recorded event ID. Evidence must be an observed, user-origin `presentation.densitySelected` or `workspace.presetSelected` event with matching structured `preferenceSignal`, value and scope. Vela/provider-origin actions cannot feed back into learning. No renderer method can manufacture a behavioral observation. The evidence remains linked to its actual source event and timestamp. Monitoring must be explicitly subscribed to those local app-event types before evidence can be used.

Inferred hypotheses remain separate from explicit preferences. Explicit workspace choices, then explicit global choices, take precedence over applied inference. Accepting a hypothesis creates an explicit record; rejection/suppression prevents the same suggestion from repeatedly reappearing until an explicit reset. Users can inspect/correct values, disable learning, reset scope-specific preferences and inspect application receipts. Reset preserves evidence, deactivates explicit overrides and supersedes active hypotheses; it does not pretend to undo a prior host UI effect.

Actual application uses the optional `host.applyPreference()` **canonical command port** with a host-issued authorization reference, expected target versions, idempotent command ID, origin and evidence IDs. The adapter must implement real low-risk settings/organization changes; the module never writes a parallel application-setting store. If that port is unavailable or policy denies it, the receipt/hypothesis records failure and the UI says application is unavailable. An exception after dispatch records unknown outcome, never a fabricated success. This module does not claim an application effect from saving a preference record alone.

## Verification and limits

Run `node --test prototypes/vela-core/tests/*.test.mts` with Node 24.18+ and typecheck `tsconfig.json` using the existing repository TypeScript installation. Tests use synthetic data and a real in-memory SQLite canonical host on the exact injected connection; they do not launch inference or native windows.

No integrated desktop/provider, cinematic, keyboard/screen-reader, performance, long-history, cross-account, real Codex planning, or owner acceptance claim follows from these tests. Those checks belong to the actual application integration. The module's JSON state has a 4 MiB preservation limit; it refuses additional writes at capacity and never silently drops historical evidence. User-controlled export/retention and unknown-outcome reconciliation remain host integration work. Host transaction rollback must include its canonical graph/in-memory state, not SQLite alone. Adaptive preference application additionally requires an actual host adapter and appropriate product usability/reversibility review.
