# Real Codex planning adapter integration

`src/codex-planning-adapter.mts` implements `VelaPlanningPort` through the **existing** canonical integrated-backend command/execution service. It does not implement an inference backend, open a database, read credentials, replace native Codex instructions, assume ChatGPT account/history access, manufacture model output, or launch a provider turn when constructed/opened.

Codex remains Codex. The adapter submits an ordinary bounded **delegated planning task** to an explicitly identified Codex conversation. Native Vela search/navigation/organization remain local. The task asks for a typed proposal and no tool/native execution; actual sandbox/tool enforcement remains the owning Codex host's responsibility. The adapter does not alter `baseInstructions`, developer instructions, native thread/session configuration, skills, identity or account binding.

## Exact root wiring seam

```ts
const planner = new CodexPlanningAdapter({
  backend: { command: (name, input) => core.command(name, input) },
  availability: () => observedCodexAvailabilityAndCapacity(),
  authorizePlanning: input => verifyHostProviderContextApproval(input),
  openPlanningConversation: input => createAndLinkCanonicalCodexPlanningChat(input),
  executePlanning: input => executeUsingVerifiedHostGrant(input),
  observe: observation => persistCanonicalPlanningAuditReferences(observation),
});
// Inject planner into the existing VelaService options.
```

The injected callbacks are **required trusted host boundaries**, not renderer adapters:

1. `authorizePlanning` receives the exact request/source-conversation IDs, entire prospective metadata/content context manifest, context digest, full prompt digest and byte count. It must find/revalidate the host-issued provider-context grant and actual native user approval. It returns an opaque `CodexPlanningGrant` bound to those IDs/digests/provider and expiry. The adapter cannot mint grants. Merely passing a renderer boolean or trusting this callback's name is insufficient.
2. `openPlanningConversation` creates/opens an idempotent canonical conversation using the existing `createConversation` behavior with `providerId:'codex-app-server'`, then records the relationship to the initiating Vela conversation/request. Parent scope/visibility policy decides placement and project association. It returns the real canonical `ConversationView`. The adapter supplies a deterministic create command ID.
3. `executePlanning` revalidates that grant at dispatch and invokes the existing `execute` command with the real canonical planning resource ID, exact prompt and deterministic execute command ID. **Only this host callback supplies existing native `authorized:true` after verifying consent**. The adapter never supplies that boolean. This callback must return the owning backend's actual `Execution` promise; it must not invent an execution result or block canonical reads/interrupt while awaiting a turn.
4. `observe` persists metadata references through the existing canonical event/audit service. Source Vela request, planning conversation, provider execution, native thread/turn, canonical assistant-message ID, existing event references, coverage gaps and cancellation state remain traceable. No duplicate transcript/execution database is created.

`backend.command` is needed only for `snapshot`, `replay` and `interrupt`. These are the actual existing `CommandMap` contracts. The host-owned creation/execute callbacks permit canonical in-memory graph + SQLite transactions and real approval policy without making the adapter a privileged command issuer.

## Behavior and evidence

- Before any turn, check observed availability, the canonical graph's real non-mock Codex provider identity, the existing one-active-execution capacity, and host grant binding/expiry.
- Build one compact planning prompt containing the exact intent, application task constraints, capability schemas and selected metadata/content manifest. The existing backend permits at most **16 KiB UTF-8** per execute prompt. Oversized requests fail before chat creation/dispatch; sources are never silently truncated to fit.
- Dispatch once through the host callback, then poll canonical `snapshot`/bounded `replay` at 350 ms by default for at most 75 seconds. Polling exists only during that explicitly authorized planning attempt, makes no new inference requests, and does not fabricate live reasoning/progress. Real event IDs/cursors and gap/truncation state link back to canonical event storage.
- Accept output only after a recorded `provider_completed` execution with the expected command/resource/provider IDs and exactly one assistant message carrying matching **reported** execution/native-thread/native-turn evidence. Reject simulated evidence, missing output, mismatched provenance and unknown outcomes.
- Parse only JSON (optionally one enclosing JSON fence), validate every typed action, and replace all model-written contribution fields with trusted canonical provider/execution/conversation/message/native IDs. The model cannot claim trusted attribution by writing it in JSON. An invalid raw response remains in the canonical planning conversation and the audit/error retains its source IDs; the adapter never copies/fabricates an assistant response.
- Return only a `ProviderProposal`. This creates no workspace, resource, placement, delegated task execution or application effect. Vela's separate fingerprint/version/host-authorization review/apply path remains required.
- An aborted request sends the actual canonical `interrupt` once a real turn is addressable. The existing interrupt reply is **requested, unconfirmed**; only a later recorded `interrupted` execution confirms cancellation. Provider completion before cancellation confirmation, lack of an addressable turn, timeout, disconnect and unknown outcomes remain explicit. No automatic retry or unknown-to-success inference occurs.

The adapter retains only transient control/observation state while one proposal is pending. Canonical conversations, raw response, native bindings, execution truth and receipts remain backend-owned. `ProviderContribution` has additive canonical execution/planning-conversation/source-message IDs so successful plans preserve that trace after the adapter returns.

## Qualification status

Synthetic adapter regressions are written in `tests/codex-planning-adapter.test.mts`. They verify host grant binding, exact canonical provenance, prompt bounds, busy/fixture denial, strict parsing, actual interrupt routing and unknown outcomes. They are **queued, not executed** in this implementation checkpoint because the host is reserved for integrated native/performance acceptance.

No real provider turn, native window, network call or CPU test was launched by this worker for this adapter. Root must wire the real callbacks, execute an explicitly approved live planning task, inspect the canonical Codex conversation/native execution evidence, then review/apply the typed workspace proposal through real application commands. Unit doubles do not qualify real intelligence or application acceptance.
