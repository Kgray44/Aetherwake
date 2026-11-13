# FI-4 mission admission and Windows evidence

MissionService releases admission slots when a mission has no running work and no dependency-ready task. The journal retains blocked descendants and all attempts. A retry, rewire or other control that makes a stalled mission eligible again acquires an active slot in the same SQLite transaction. Startup recomputes scheduling flags from persisted plans. The mission projection keeps a failed branch visible while independent ready work waits for capacity.

The change uses the existing MissionService queue, ARIE leases, plan revisions and AEP projection. No production permissions, provider limits, process controls, schema or provider transport changed. The entered-effect reconciliation work and FI-5 experiment controls have separate integration sequences.

## Windows source-mode comparison

The test used Windows x64 and Node 24.18.0. Each trial used a fresh private test profile, two reviewed GPT-6.1 Sol high-reasoning calls without tools, canonical native measurements, and a verified dependency join. The sequential arm held dispatch while applying the existing one-worker mission control. ARIE retained its normal admission policy. Alternating the order in six adjacent pairs reduced ordering bias. Process CPU figures exclude separate native processes. GPU RAM and VRAM figures are lease reservations.

| CPU and API workload | Concurrent | Sequential |
| --- | ---: | ---: |
| Verified trials | 6/6 | 6/6 |
| Median wall time | 10.22 s | 18.45 s |
| Wall time range | 8.75–13.52 s | 16.37–23.54 s |
| Median process CPU | 1.62 s | 2.14 s |
| Median reported tokens | 1,706.5 | 1,688.5 |
| Median estimated token cost | $0.00885 | $0.00870 |

Concurrent was faster in all six pairs. Paired savings ranged from 4.33 to 14.31 seconds. Specialist dispatch-to-settlement overlap was 7.54–10.07 seconds. The native inspection overlapped the provider interval in three trials for 42–84 ms. Sequential trials had zero AEP overlap and a peak of one admitted worker. The comparison validates this workload and source-mode host. It does not qualify GPU speedup, whole-system energy, or independent grading of specialist recommendations. Cost is computed from reported token classes and [standard OpenAI pricing](https://developers.openai.com/api/docs/pricing). AEP had no billing receipt.

The GPU-inclusive pilot observed 51 ms of CPU, GPU and provider overlap. A verified sequential pilot had 26.8 seconds of GPU admission wait. The repeat series encountered GPU admission deadlines and was stopped. A separate native product run verified eight staged buffers with a 256 MiB VRAM reservation. An owner-mode checkpoint held the lease while stopping and a separately reviewed replacement verified. These runs do not qualify matched GPU throughput or packaged foreground responsiveness.

The Codex variant uses the same reviewed mission entry point with a tracked, explicitly selected Node test. Its read-only App Server sandbox returns a checked exit and test count. The run joins these results with native CPU/RAM and two attributed specialist reports. The reports undergo structural and attribution checks. A separate live planning test failed native note verification, retried only the native branch after a note was added, and preserved the original provider execution and report across restart. The illustration mission independently read back its real PNG and text, restored its report after restart, and withdrew verification after the text changed. These are separate journeys.

## Reproduce

Set `AERYNTH_VERIFY_LIVE_MIXED=1` and supply an authorized test credential through the environment. Run `node prototypes/integrated-backend/src/mission-mixed-live-verify.mts --cpu-remote-only` for the concurrent arm and append `--sequential` for the one-worker arm. Set `AERYNTH_MIXED_CODEX_TEST` to the absolute path of a reviewed, tracked Node test in an isolated checkout to exercise the installed Codex sandbox. Clear it to compare the source inspection worker. Each trial requests two specialist inferences and may perform provider catalog reads. Keep the same task set, model and effort for both arms and retain every exit status.

Use `AERYNTH_VERIFY_GPU_PRODUCT=1` with `tests/arie-gpu-product.test.mts` for the isolated physical GPU and checkpoint tests. The live artifact and planning retry options are documented in [the artifact handoff](FI-ACC-16-ARTIFACT-HANDOFF.md) and `tests/mission-api-planning.test.mts`. The harnesses use source-mode profiles and simulated review surfaces where applicable. A packaged, independently graded mixed mission that recovers a branch and delivers files in the same execution remains open.
