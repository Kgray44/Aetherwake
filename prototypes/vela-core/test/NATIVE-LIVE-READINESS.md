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
