# FI-5 native experiments and policy lifecycle

This Full Aerynth Realization slice qualifies one MissionService strategy for an explicitly launched native probe cohort. AEP owns the hypothesis, immutable enrollment order, exact trace references, comparison and transition history. MissionService owns the scoped admission policy and its version. ARIE still controls every resource lease and its configuration version fences the cohort. CIE resolves applicable experience on demand through an exact local lookup. The native host commits policy and AEP receipts in one transaction.

## Trial protocol

The baseline admits one attempt per probe mission. The parallel candidate admits two. Both perform CPU and backend timer observations in development, then CPU, RAM and backend timer observations in the frozen holdout. The deliberately harmful candidate omits the required backend observation. The lab executes native OS probes through the real mission scheduler. It alternates baseline-first and candidate-first across six pairs per partition. Each partition has a two-sided exact sign interval for its median paired benefit, with nominal 96.875% coverage under pair independence. The lower bound must be at least 40 ms in both partitions. All baseline and treatment observations must meet the independent objective oracle, with realized parallelism and no recorded admission-pressure reasons required for acceptance. Missing timing is retained and makes the relevant partition inconclusive. Failed baseline quality also yields an inconclusive result. Failed candidate quality with a valid baseline yields rejection.

The objective oracle checks the exact requested task graph and capabilities, allowed read-only effects, canonical attempt and evidence identities, sample validity and report coverage. It calls no model and does not reuse the executor's verification function. Development and holdout are two frozen native workload variants on one host. Same-process autocorrelation and external load remain possible. Results qualify only this local probe cohort.

## Native evidence retained

The application-backed run used an isolated local-private Windows Backend profile, the canonical SQLite database, actual host observations and ARIE leases. It enrolled 48 trial missions across both candidates and two follow-up missions.

| Candidate | Development median benefit and interval | Holdout median benefit and interval | Independent decision |
|---|---|---|---|
| Parallel native probes | 145.78 ms [119.91, 200.04] | 121.85 ms [108.84, 148.82] | Accepted. All 24 arm runs passed all gates. |
| Omit backend probe | 128.94 ms [84.46, 334.03] | 163.63 ms [118.34, 395.74] | Rejected. All 12 treatment runs failed required coverage. |

The source journals retain critical paths for all 48 runs and record 150 resource leases. The widest observed single projection took 6.52 ms, with up to 16 ms process CPU and a 516,096-byte observed RSS increase. These are bounded process-level projection observations. They do not measure renderer or packaged overhead. The runs dispatched zero provider calls. Provider latency, reported usage and charged cost were not applicable.

The owner command promoted the parallel result from policy version 1 to 2 in the isolated workspace. After closing and reopening the Backend, a CIE lookup returned the applicable finding and the next probe ran at concurrency 2 with all four source proofs verified. It had 97.60 ms of measured overlap. Manual rollback committed version 3, then the next probe ran at concurrency 1 with all four source proofs verified. Both accepted and rejected records and the rollback history remain available. An earlier standalone run was inconclusive because its development lower bound was 2.01 ms against the 40 ms requirement. Both databases were retained separately.

To reproduce, run `node prototypes/integrated-backend/src/aep-native-demo.mts <new-path>.fi5.sqlite` after checking the workstation storage reserve. The command uses a dedicated private profile and prints qualified measurements and decisions. Keep the database and raw receipt output local. The checked-in report contains rounded, redacted observations.

## Integration and limits

- The scoped read commands are `missions/experience-list`, `missions/experience-evidence` and `missions/experience-finding`. The finding accepts an experiment ID and the exact cohort `aerynth.aep.native-probe-pairs@1`. Detailed evidence resolves each mission revision and current access on every read. Trial evidence is returned by reference, with no raw sample bodies.
- The trusted host command `aepExperimentNative` owns proposal, testing, explicit promotion, probe admission and rollback. Renderer IPC rejects it. Promotion requires the accepted experiment revision and current MissionService policy version. The policy is effective only in the recorded workspace/project, on the same host cohort and ARIE configuration, for 24 hours. A failed independent quality gate during a monitored probe triggers rollback. The application applies this policy only through the explicit native probe command. Existing ordinary mission entry points retain their previous defaults.
- AIR calibration remains separate. Its observed routing samples do not carry independently held-out semantic acceptance or a versioned AEP promotion binding. ARIE's experiment preview does not provide scoped experimental activation. This slice uses the real ARIE admission/lease owner and does not promote AIR model changes or global ARIE policy. Model-specific optimization requires matched qualified provider execution, independent semantic acceptance and an AIR owner adapter. Provider cost attribution still depends on a qualified rate and fee source.
- CIE uses a local operational lookup, with no persistent personal-memory copy or provider prompt attachment. Packaged GUI controls, longer-run drift and foreground measurements, broader evaluation families, and the combined FI-6 workspace acceptance remain separate integration work.
- Shared integration follows the journal extraction in PR #67 and Mission 6's narrow Core composition change in PR #74. Recheck the MissionService seam against Mission 7's admission and entered-effect reconciliation before landing. The scope and sequencing have been sent to the respective owners and Mission 1.
