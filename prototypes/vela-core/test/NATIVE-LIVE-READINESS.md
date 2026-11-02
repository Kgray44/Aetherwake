# Bounded live helper readiness

`native-live.cjs` retains the actual one-turn synthetic workspace proposal/apply journey and its read-only restore / explicitly bound existing-plan resume modes. Source readiness is not actual provider, native consent, visual or restart qualification. This release ran no Electron window, provider request, network request, approval or grant.

Host interface:

```ts
verify({
  win, app, privateRoot, source,
  startupErrors?: readonly {message: string; line?: number; source?: string}[],
  slotStartedAt?: number, // actual Electron-main performance.now() origin
  deadlineMs?: number,   // default/max 85000, includes cleanup
  cancelOwnedPlanning?: (value: {
    requestId: string; reason: 'focus-lost' | 'deadline'
  }) => Promise<unknown>
})
```

Existing flags remain `--integration-vela-live`, optional `--verify-restore`, or `--resume-reviewed-plan` with its existing exact evidence/request/plan arguments. There is no approval flag. Root owns explicit launch, dedicated synthetic profile, native operator, actual backend cancellation validation and the combined 90-second fallback/owned-process termination. Existing profiles and failed evidence are preserved.

All foreground work shares one monotonic budget, including host startup when `slotStartedAt` is forwarded. Work stops 1.5 seconds before the deadline for bounded native cancellation and evidence; the hard deadline requests application quit and `finally` always requests quit. The helper never refocuses or waits for foreground recovery. A real focus loss makes its guard sticky, rejecting further renderer reads and input. The optional native callback is invoked at most once, only for the last newly observed canonical request still known as planning. No preview-only, restore, resume or arbitrary request is cancelled. Its actual host return or unconfirmed timeout/error is recorded without claiming confirmed provider interruption.

Normal parent work still uses the shared real native driver. Only submission uses a separately hit-tested stable native mouse gesture, because the driver's post-click parent-focus check cannot own the legitimate native modal transition. That transition permits only the focused modal child with the same disabled parent, exact released review preload, sandbox/context isolation, disabled Node integration, native token argument and actual review data URL. While active, the helper observes only that child's displayed intent/prompt/source bytes and digest. It sends no parent renderer RPC or input, never activates the child's Send once button and never mints a grant. The parent operator alone decides whether to send.

Fresh acceptance requires exact displayed source/context digests to match the recorded canonical request and exact displayed semantic prompt to match the sole canonical Codex user input. Optional history and schema discovery remain OFF in this journey. Real native provider/thread/turn/execution attribution, scoped contiguous event coverage, no tool/delegation/retry evidence, proposal/receipt state, same-ID resource placements/content and source/assets bindings remain required. Exact reviewed prompt/context evidence also persists into fresh restore expectations. Existing older resume evidence is not relabelled as a newly observed sharing child.

Bounds remain six PNGs / 12 MiB per profile and 2 MiB private JSON receipts; no videos. Startup and runtime console/shader errors reject qualification. All evidence stays in ignored `.runtime` and the existing dedicated private profile.

Executed: `node --check prototypes/vela-core/test/native-live.cjs`, seven pure/offline lifecycle and source-guard tests, and diff whitespace check. The fake window/callback cases qualify only the helper guard logic; they cannot make the actual native `verify()` pass.

## Source selector audit

Read-only audit of clean Root `5b2af123afb113eadfa6291c951db4c325f99ee5` confirmed four stale selector occurrences: two `.conversation-compose` uses in local chat typing/submission, and two `.conversation-transcript` uses in initial/restore rendering assertions. App's active conversation branch mounts `mountBlockChat`, which replaces the old content with `mountConversationChat`. Its actual form/messages are `.cp-composer` and `.cp-messages`. The helper now targets those real shared controls. Legacy cleanup strings elsewhere in App do not prove active controls exist.

| Journey controls | Current source contract | Audit result |
|---|---|---|
| Project/workspace creation and navigation | App `#workspace-manager`, `#new-project`, `#new-workspace`, title IDs, project select, `[data-workspace]`, real dialog submit | Matches |
| Block Library creation | App opens contextual `block-library`; Library renders `.aw-library__list`, detail form, `Title`, `Conversation backend`, local provider choice, `Add New Conversation` / `Add New Note` | Matches |
| Template/workspace creation | This helper opens no template UI. It inspects/applies the exact Vela `workspaceFromResources` plan through the actual panel and canonical host receipt | No template UI selector to migrate |
| Workspace locate and working card | Released `.aw-workspace-layout` / `Workspace actions`, `[data-locate]`, actual `[data-block]`, `.unfold` / `expanded` | Matches |
| Inline local chat and restart | Active App → Block Library chat wrapper → shared CP chat; `.cp-composer textarea`, submit button, `.cp-messages` | Four stale occurrences corrected |
| Canonical note | Existing `.working-content textarea`, canonical committed content; Note wraps the retained editor | Matches |
| Vela host/close | App `vela-assistant-surface`, actual dialog data-surface `vela`, shared `.aw-contextual-dismiss` | Matches |
| Vela sources/provider/send | Actual `Add sources` and `Provider` icons; source search/results; disclosed `Check connection`, dynamic `Use Codex for this request`, `Send to Vela` | Matches |
| Plan review and application | Keyed `data-plan-id`, heading, `.vela-core-effects`, disclosed `.vela-core-plan-details pre`, `Approve and apply` | Matches |
| Terminal state | Actual request/plan status data attributes and canonical applied text | Matches |
| Native sharing | Released child `review-title`, intent, exact request disclosure and displayed digest; no helper approval input | Matches |
| Captures | Actual snapshot GPU stats / draws / native-active flag and writing-focus class; native capture API | Matches |

The added eighth offline test follows the active mounting chain, checks these source contracts, rejects legacy composer selectors and emits the exact inspected source hashes. It passed both against the isolated checkout and explicitly against Root using `AERYNTH_SELECTOR_SOURCE_ROOT`. Source inspection cannot prove runtime visibility, hit testing, focus timing, GPU delivery or actual provider success; those checks remain in the real helper and must pass in Root's separately authorized native run. No production source or guard criteria changed in this selector correction.
