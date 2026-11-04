# Vela mission program: implementation and evidence

Baseline: `30e210c149ff633fc8f26ac8f997c473e9d0115f`, the exact head of
[draft #18](https://github.com/Kgray44/Aetherwake/pull/18). It includes
[draft #17](https://github.com/Kgray44/Aetherwake/pull/17) at `ac6baae` and
[draft #16](https://github.com/Kgray44/Aetherwake/pull/16) at `3847653` by
Git ancestry. Hosted main is `77ba4f8`. This branch stacks on #18; none of
those drafts is a landed production baseline. The existing worktrees and their
branches are retained.

The table uses directive section numbers as trace IDs. AW-CON IDs refer to the
[binding Constitution](../../governance/00-AETHERWAKE-CONSTITUTION.md); numbered
specialist charters in the [registry](../../governance/README.md) are advisory.
The [AIR specification](../specifications/VELA-ADAPTIVE-INTELLIGENCE-ROUTING.md)
is proposed. Its existing level and route evidence lives in
[AIR status](VELA-AIR-STATUS.md). The table tracks implementation and proof and
does not establish new governing requirements.

| Directive / proof | Authority references | Baseline and current gap | Change and required evidence |
| --- | --- | --- | --- |
| §1–2 / M0 | AW-CON-007–010, 080, 088–089; charter 16 | **Partial.** Latest integrated stack identified. Core owns routing, review, workflow, app state, and observation. | Keep canonical SQLite and native consent; extract bounded services. Record exact-source baseline, migrations, source and runtime checks. |
| §3 / A–B | AW-CON-011, 041, 062–065; charters 06, 10, 12; AIR §4–6 | **Partial.** Native zero-model actions, bounded routing, live discovery, pins, calibration and escalation exist. Complex objectives still resolve to single or fixed workflows. | Add mission strategy alongside AIR, inspect decisions, retain manual controls; prove native, deep, unavailable and direct Codex cases. |
| §4.1–4.2 / C–D | AW-CON-042, 045–046, 080; charters 05, 06, 15 | **Missing.** Task Objectives store acceptance and evidence; they do not run dependency graphs. | Versioned mission, graph, attempt and evidence records; validate DAG and capabilities before admission. |
| §4.3–4.4 / C–F, L, M | AW-CON-042–045, 073; charters 05, 09, 13, 14 | **Missing.** `Core.runVelaWorkflow` and provider execution are globally exclusive. Existing sequential scopes are individually reviewed. | Schedule independent graphs under shared capacity and claims. Keep existing review boundaries. Prove overlap, order, joins, fair admission and isolation. |
| §4.5–4.7 / G–H | AW-CON-025, 046, 059, 067, 073; charters 05, 09, 14 | **Partial.** Ordinary and Codex executions retain uncertain outcomes on restart. No mission revision, branch control or execution journal. | Journal before dispatch, preserve criteria and evidence across revisions, expose pause/cancel/retry; crash and recovery tests. |
| §5.1–5.5 / F, M, O | AW-CON-019, 042–046, 069; charters 05, 06, 12, 14 | **Partial.** Agent profiles resolve versioned settings; assignment records explicitly do not start or verify work. | Connect profiles and scoped specialists to real adapters, structured handoffs and team views. Test actual launches, separate context and failed verification. |
| §6.1–6.7 / K, M, N | AW-CON-031–034, 046, 048, 050–056; charters 04, 07–08 | **Partial.** Personal Context, canonical references, graph handoffs and reviewed four-message/4 KiB recent history exist. No mission compiler or cross-attempt manifests. | Compile relevant provenance and dependency evidence under per-task budgets; recheck scope and invalidate on revisions. Compare usage, quality and continuity. |
| §7.1–7.9 / I–J | AW-CON-025–030, 078; charters 01–03, 13–15 | **Partial.** Template validation, preview, transactional apply and layout persistence exist. Core supplies no planner; geometry is preset/placement based. | Wire real blueprint generation with canonical resources and deterministic dimensions; verify preview, atomic apply, undo and manual layout preservation. |
| §8.1–8.6 / F, I, N, O, P | AW-CON-013–021, 033, 057–061; charters 01–05, 09, 11 | **Partial.** Desktop already has Agent, Checklist, Timeline, Connected Branches and Streams; none is a live mission projection. | Add canonical mission surfaces and controls with source links and actual events; test native UI, accessibility, rendering and display changes. |
| §9.1–9.8 / A, B, K–L | AW-CON-041, 055–056, 062–065, 075–077; charters 06, 08, 10, 13 | **Partial.** AIR records usage where provided and has single-turn comparisons. No end-to-end mission efficiency evidence. | Record queue, provider and verification evidence. Compare controlled workloads on verified objectives per reported token, latency and load; disclose missing metrics. |
| §10.1–10.6 / H, M–O | AW-CON-024–025, 039, 057–059, 069–073; charter 14 | **Partial.** Native review, grants, capability allowlists, restricted sandbox and private storage exist. No delegated mission grant boundary. | Enforce authorization per task outside prompts, bound execution, separate uncertain work and prove refusal paths. |
| §11–16 / A–P, M0–M8 | AW-CON-001–003, 021, 077, 085–089; charters 15–16 | **Partial.** Prior AIR acceptance is attributable to its own candidates; no mission acceptance or review artifact exists. | Run suites and native journeys on final source, package only within reserve, publish scoped draft and reconcile every proof item. |

## Direct baseline measurements

Windows, Node 24.18.0. Offline held-out AIR evaluation matched 352/352
routes across 88 scenarios (32 verified calculator answers and 32 disconnected
admissions blocked with zero provider calls). This does not measure model
correctness, cost or provider latency. The existing 100-append synthetic
backend benchmark recovered 100 messages: startup 1,135 ms, reopen 755 ms,
append p50 60.92 ms and p95 93.86 ms, SQLite 688,128 bytes, process RSS
121,401,344 bytes. This is one observed run; it is not a renderer or mission
load baseline. The benchmark created its synthetic database under an
untracked directory; the database was preserved in ignored runtime storage.
Prior signed-in and desktop results in AIR status are historical evidence,
not measurements repeated for this program.

The pre-change test run exited successfully across the backend, Vela Core,
Block Library, Agent Product, Personal Context, and Workspace Engine suites.

## Integrated checkpoint

The [architecture record](../architecture/VELA-MISSION-EXECUTION.md) describes
the code paths and their trust boundaries. The following statuses refer to
this branch; **verified** is limited to the proof in the same row.

| Acceptance | Checkpoint evidence | Remaining work |
| --- | --- | --- |
| A · Native intelligence | **Verified for the measured route.** Electron ran real backend, CPU and memory observations plus a digest-bound static code scan; zero provider calls. Baseline native AIR covers individual facts. | Expand exact-source native checks for GPU availability across hardware. |
| B · Adaptive answers | **Partial.** Existing AIR baseline and 352 offline matches; specialist route binds observed catalog controls and fails closed. | Repeat live deep/pinned and unavailable-provider desktop cases on the candidate; general bounded model-assisted intent interpretation. |
| C · Parallel performance mission | **Verified for the native route.** Actual Electron Start, 106 ms measured overlap, ordered report join, actual static source digest. Real Responses protocol with synthetic transport observed two outstanding requests before releasing either. | Live specialist and external research evidence. |
| D · Dependencies | **Verified in scheduler and native app.** No join before verified predecessors; graph validator rejects missing edges and cycles. | Extend proof to implementation and verification mutations once mission-owned write adapters exist. |
| E · Concurrent missions | **Verified in controlled scheduler execution.** Two mission identities run together, exclusive claims serialize, outputs do not mix. | Sustained native load and UI responsiveness under simultaneous missions. |
| F · Specialized execution | **Partial.** Separate ChatGPT-plan requests, role instructions, context manifests, response IDs and usage exercised via the existing protocol; native review is mandatory and the first role can be a version-bound Agent Library profile. | Live provider acceptance, reusable team persistence and Codex worker integration. |
| G · Replanning | **Partial.** Versioned append with unchanged acceptance and dependency validation covered by tests. Native timer outlier policy can extend the report dependencies. | Verify evidence-triggered amendments and review on a broader class of objectives. |
| H · Crash recovery | **Partial.** Committed in-flight external attempt restores as uncertain with no retry, checked against a fresh journal connection. The worker-loss case covers interrupted native work. | External reconciliation and a controlled native process loss during a real provider turn. |
| I · Workspace construction | **Partial.** Real template request and canonical application path; Block Library tests prove scoped identity reuse, functional checklist, exact geometry, rollback and preview. | Native creation journey and complete mission workroom binding. |
| J · Workspace adaptation | **Partial.** Planner geometry and manual layout undo/redo covered. | Monitor-specific automatic arrangements, explicit workspace creation undo and multiple real display checks. |
| K · Token efficiency | **Partial.** Context receipts distinguish estimates and reported usage; no-provider workload completed with two workers using no model calls. | Matched, held-out live token, latency, quality and reliability comparison for missions. |
| L · Resource pressure | **Partial.** Worker limits, claims and injected memory pressure/backpressure are tested; physical-memory floor used in Core. | GPU, disk, network and renderer measurements under sustained representative workloads. |
| M · Permissions and isolation | **Partial.** Scoped mission reads, same-workspace Notes boundary, provider review, version fences, exclusive claims and no automatic external replay. | Mission file-write isolation, connector approval/revocation, and broader adversarial cases. |
| N · Conversation continuity | **Partial.** Ordinary fallback and pin bypass tested; no change to existing canonical conversation and Codex session stores. | Persist mission-to-chat/task links and qualify native Connected Branches handoffs. |
| O · Truthful completion | **Verified for scheduler behavior.** Failed independent verification blocks downstream work; provider output is labeled reported. | More domain-specific external verifiers. |
| P · Visual integration | **Partial.** Actual Electron preview, explicit Start, mission status, task evidence and timeline on one Windows display. | Mission workspace blocks, broader keyboard and reduced-motion journeys, multiple display and scale configurations. |

The paired native benchmark (`node prototypes/integrated-backend/src/mission-benchmark.mts`)
used two warm-ups and six measured runs per setting with alternating order.
Both settings verified every objective. One worker: 368.5 ms median, range
363–379 ms. Two workers: 266 ms median, range 254–269 ms. This is a 27.8%
median reduction for this bounded workload using in-memory SQLite on Windows
with Node 24.18.0. It used zero model calls. Reported tokens and paid cost
are unavailable; the benchmark establishes neither a token-efficiency ratio
nor performance under representative renderer or provider load.
