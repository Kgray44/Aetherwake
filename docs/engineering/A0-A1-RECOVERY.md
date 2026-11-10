# Architecture Recovery A0 and A1

Program A establishes the connected application's source and verification baseline. The starting commit is [`6d249eba7c1b3f8327f5a592734a5d334be1bf6e`](https://github.com/Kgray44/Aetherwake/commit/6d249eba7c1b3f8327f5a592734a5d334be1bf6e). GitHub `main` and the local tracking ref agreed when the recovery checkout was created. The draft PR identifies the candidate commit and hosted checks. Ratified design authority remains in the [governance registry](../../governance/README.md).

- [Runtime architecture, state owners, technical debt, and A2 handoff](A0-A1-RUNTIME-OWNERSHIP.md)
- [Windows native baseline and retained evidence](A0-A1-NATIVE-BASELINE.md)
- [Legacy PR reconciliation and ratified design provenance](A0-A1-LEGACY-PR-RECONCILIATION.md)
- [Connected application setup and native verification](../../prototypes/visual-experience/cinematic-v3/APPLICATION.md)

## Confirmed defects and corrections

1. The backend workflow omitted several live dependency paths, including Vela Core, the conversation product and the connected renderer. It ran backend and three adjacent suites. The [integrated workflow](../../.github/workflows/integrated-backend.yml) now exercises the existing 17-group acceptance runner and review build contracts on Linux and Windows. Vela Core typechecking exposed two fixture errors. The fixture now clears the existing receipt array and imports the canonical message type. The assertions still exercise refusal and read-only projection behavior.
2. The connected desktop build was absent from CI. Windows now builds the real Electron application and its Windows system helper. Linux checks desktop TypeScript and runs cross-platform fixture coverage. The workflow keeps the OpenAI provider's locked package cache for its offline provenance check.
3. The governance workflow filtered out many local link targets whose deletion can invalidate a charter or the registry. The [governance workflow](../../.github/workflows/governance-router.yml) now runs for every PR and push to `main`, so a stale path list cannot prevent this gate from running.
4. The `record` and `soak` scripts implicitly opened the connected desktop, whose entry point does not handle those flags. That could open the regular review profile. Both commands now name the visual harness that owns the flags. The connected guide documents the explicit offline verification runner and separately authorized live review.
5. The initial Linux CI run exposed Windows paths in test fixture setup and cleanup. Portable fixtures now use native path semantics. Real Windows profile preparation requires the installed reserve guard, and some of those fixtures also use the Windows elapsed clock. Hosted jobs without these prerequisites report the missing gate. The local Windows run with the guard exercised the preparations. The first hosted Windows run was still completing backend tests when it reached the 20-minute job limit. The Windows job now has a bounded 35-minute budget.
6. The Living Instruments runner left an unsaved orientation change before attempting plan creation. The Timeline correctly disabled editing. The runner now saves and observes the new version before planning, and requires the initial planning and timer evidence before evaluating restart.
7. Resource action IDs stopped being assigned when the Add sources menu moved to the panel header. The renderer now assigns the existing IDs on the actual menu. The Checklist helper resolves its target while it settles, since opening a resource can change DOM sibling order. The AIR helper waits for the renderer to match the exact canonical conversation under its existing deadline.

These changes preserve the runtime command and IPC contracts, canonical data owners, profile schema, provider permissions and effect verification. The existing acceptance runner is reused without a second orchestration layer.

## Changed-path coverage

| Path | Before | Revised workflow |
|---|---|---|
| Integrated backend, OpenAI provider, application contract, Block Library, Timeline, Workspace Kernel, Connected Conversations, Codex bridge | PR path filters, Linux and Windows backend fixtures with three owner suites | Both OSes run backend and Vela typechecks, the cross-package fixture runner, and review build contract tests |
| Agent, Checklist, Conversation, Task, Timer, Personal Context, Vela Core, Constellation and Workspace Engine | Changes confined to these paths did not trigger the backend workflow | Same cross-package job on both OSes |
| Connected Electron source, native host, lockfile, build scripts, acceptance runner and review contracts | Connected application build and suite absent | Windows builds the renderer and native helper. Linux runs the desktop typecheck. Both run desktop tests in the acceptance runner |
| Governance, router, policy, docs and linked targets | Governance workflow used a fixed allowlist of paths | Registry, links, router tests, benchmark and strict evaluation on all PRs and main pushes |
| Interactive Windows, live providers, hardware and artistic acceptance | Outside the automated workflow | Qualified local Windows and authorized provider/owner review gates |

Older Electron and Tauri visual labs remain outside the integrated application path filter. The integrated workflow installs five packages from lockfiles. Constellation's standalone tests resolve its pinned Three.js peer from its own install. The offline acceptance fixtures require an OS temporary directory outside the checkout, consistent with the runtime's private storage fence. Windows installs Electron for the compiled addon contract. Linux runs the portable assertions and reports the Windows PowerShell parser and addon checks as platform skips. Interactive Electron journeys and the opt-in output-only DOM journey are separate.

The Windows addon smoke runs before the longer aggregate to surface host and ABI failures early. It resolves the executable through the locked Electron package, which provisions the binary on first use. It still checks real system measurements, unissued-reference denial and in-flight revocation. Catalog discovery can report only the two native desktop eligibility refusals as unavailable. To require nonempty real desktop catalogs and a visible memory candidate on an eligible local Windows host, set `AERYNTH_WINDOWS_INTERACTIVE_QA=1` and run `node --test prototypes/visual-experience/cinematic-v3/tests/windows-system-build.test.mjs`.

The hosted worker-loss test also hit its previous 12-second deadline. It now interrupts the actual worker immediately after the durable CPU attempt event, reports the stage if its bounded deadline expires and still requires the exact paused/recovered journal and workroom projections.

The Windows review-build fixtures canonicalize their temporary parent before creating the owned fixture. This accommodates the runner's short path aliases without changing the packager's path-containment or vendor-integrity checks. The workflow runs these contracts before the longer aggregate.

## Verification and acceptance

Run commands from the repository root unless noted. Windows setup requires Node 24.18, the documented dependencies, a Windows SDK and MSVC. Run the host reserve guard before each disk-consuming stage.

| Gate | Command or evidence | Scope |
|---|---|---|
| Governance baseline | `node scripts/governance-router.mjs --validate`; `node scripts/verify-governance.mjs`; `node --test tests/governance-router.test.mjs tests/governance-context.test.mjs`; `node scripts/benchmark-governance-context.mjs`; `node scripts/evaluate-governance-engineering.mjs --strict` | At the base on Windows, registry and links passed, 38 tests passed, all 7 benchmark cases passed, and all 82 labeled requirements were recovered across 15 strict cases |
| Cross-package fixtures | `node scripts/run-aerynth-acceptance.mts`; `node --test "scripts/review-*.test.mjs"` | Synthetic providers, real local owner contracts and fixture stores. Exact run outcomes belong in the draft PR evidence |
| Type and build gates | `npm --prefix prototypes/integrated-backend run typecheck`; `node prototypes/integrated-backend/node_modules/typescript/bin/tsc --project prototypes/vela-core/tsconfig.json --typeRoots prototypes/integrated-backend/node_modules/@types`; `npm --prefix prototypes/visual-experience/cinematic-v3 run build` | Backend, Vela Core, renderer and native helper build. The Linux job substitutes desktop typecheck for the Windows build |
| Native application baseline | `npm --prefix prototypes/visual-experience/cinematic-v3 run verify:application` | Interactive Windows Electron, finite synthetic canonical profile, same-profile restart, offline |
| Living Instruments | `node --experimental-strip-types scripts/verify-living-instruments-native.mjs` | Interactive Windows Electron with a fresh private synthetic profile. Inspect the receipt's named checks and limitations |
| Live provider and owner acceptance | Standard reviewed native send for any authorized live request. Owner review for artistic and physical-display acceptance | Separate gates. Local fixture responses and hosted tests supply no evidence of account entitlement or owner acceptance |

The candidate PR records the exact executed journeys and results. Raw profiles and captures stay out of the public repository. Existing historical results retain their original scope.

The broad desktop `npm run format:check` remains red. Prettier misclassifies the unchanged native C++ include `windows-computer.inc` and also reports existing style drift. A0/A1 leaves bulk reformatting out of scope.
