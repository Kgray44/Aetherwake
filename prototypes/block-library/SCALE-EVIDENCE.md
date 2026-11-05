# Block operation-scale sample

Run the bounded diagnostic after ReserveGuard admission, using `node prototypes/block-library/benchmark-scale.mts --output=<private-report.json>`. The fixed workload creates18 synthetic SQLite fixtures (three trials at each of0,1,3,10,25,50 Note placements). Core limits each main database to128 MiB and a temporary DELETE-mode rollback journal can add another128 MiB for the one active fixture. The112 MiB post-command checkpoint is not a peak-allocation quota. The byte helper now includes a surviving rollback journal; prior closed-database byte totals and measured timings are unchanged. For the recorded C:-resident temporary fixtures and report, admit4 GiB on C and0 on D for the whole sequential run; adjust admission if the temporary/report drives differ. The caller must apply the host reserve rule and recheck during a run exceeding five minutes. Fixture DBs and their private index are retained outside the repository; no cleanup is forced. This run's18 final databases total28,377,088 bytes.

The public baseline records all timings, anonymous Node process memory samples, source hashes and explicit limits. It ran direct public BackendCore commands in one Node process over the real SQLite/kernel/desktop/engine/library path, with a synthetic fixture provider and no provider execution. It did not run a native window, IPC worker, renderer or GPU. Same-process database close/reopen is not native app restart. Memory samples include module caches and uncontrolled garbage collection. These samples are diagnostic evidence, not an acceptance threshold or framework choice.

The existing source suites separately establish per-placement preference identity; this benchmark's baseline preference check only confirms each restored text-scale value belongs to the configured range. It does not alone prove exact per-role configuration equality.

Median elapsed milliseconds from three baseline samples:

| Note cards | Template preview | Template apply | Create all cards |10 workspace navigation commands|10 geometry commits|SQLite reopen/projection|
|---:|---:|---:|---:|---:|---:|---:|
|0|0.26|17.96|0.01|145.12|Unavailable (no card)|15.52|
|1|0.55|24.83|19.71|155.68|181.45|15.25|
|3|2.00|44.97|79.71|240.86|298.27|26.34|
|10|3.05|98.98|327.65|359.82|464.60|37.74|
|25|12.54|444.47|1680.56|844.18|1233.02|91.72|
|50|32.73|2024.39|6281.20|2364.44|3183.82|224.59|

The50-card baseline exposes material committed-operation latency. It is not passed off as effortless interaction or renderer acceptance. Registry lookup and library search also run1000 iterations per sample and are recorded as total elapsed milliseconds, never frame rate. Native0–50 mixed-block rendering, resize/focus/input behavior, idle/hidden suspension, process memory and graphics restoration remain required in the integrated desktop.

The executed benchmark file was hashed with the runtime modules before the run and committed unchanged with this report. The `source` field identifies the existing source commit; `sourceHashes` binds the exact executed benchmark and library files.

## One-projection desktop publication

Commit79f5d2e reuses one canonical WorkspaceEngine projection for the blocks, viewport, organization, presence and undo/redo fields of one synchronous DesktopState snapshot. Previously the same method rebuilt that projection six times, repeatedly normalizing identical history. There is no persistent cache across revisions, change to permissions/history policy, Core command change or renderer change. The existing27 actual DesktopState/canonical adapter regression tests pass; the candidate repeats all18 operation samples with the same workloads.

The candidate additionally checks exact captured placement configuration, organization and presence after SQLite reopen. This strengthens functional checking outside the timed operations. It does not alter the timed command counts. Both raw reports retain their own source hashes and environment/limitations.

Median elapsed milliseconds after projection reuse:

|Note cards|Template apply|10 workspace navigation commands|10 geometry commits|SQLite reopen/projection|
|---:|---:|---:|---:|---:|
|0|19.22|133.26|Unavailable (no card)|12.86|
|1|21.79|133.19|166.04|14.30|
|3|44.35|217.27|266.38|24.74|
|10|102.89|290.75|465.86|41.19|
|25|418.54|610.80|866.53|47.07|
|50|1308.93|1478.86|2243.83|130.50|

These short sequential runs show a useful reduction in committed backend latency at higher counts. Host conditions were not exclusive and no native renderer ran, so this is not a displayed-frame comparison, a definitive performance ratio or product acceptance. Retained candidate fixtures total28,381,184 bytes. Both runs' fixtures and raw paths remain in their private `.runtime` indices.

## Bounded validated-history reuse

Commitb765919 adds a one-workspace cache for normalized geometry/identity history, eligible only while its encoded history is at most4 MiB. Decoded JavaScript memory can be larger; this is not a4 MiB process-memory quota. Exact history JSON, legacy presence JSON, legacy organization JSON and workspace ID fence reuse. Writes obtain independent data; larger histories use the original uncached path. Full normalization/validation still occurs on every new key. No resource content, provider state, database ownership, permission policy or100-operation recovery retention is changed.

The complete engine+DesktopState suite passes82 tests, including new actual nested-transaction rollback and external corrupt-history replacement after warm reads. The library+backend notes/library suite passes49 tests, including canonical persistence and rollback, and the affected source/tests pass strict TypeScript. The new rollback test first used incorrect command names; the corrected test and the earlier failure logs are retained privately. There was no engine failure hidden by that test correction.

All18 repeated samples pass exact resource/placement identity, captured per-role preferences, geometry, viewport, organization, presence and no-provider-execution checks. Candidate medians in elapsed milliseconds:

|Note cards|Template apply|10 workspace navigation commands|10 geometry commits|SQLite reopen/projection|
|---:|---:|---:|---:|---:|
|0|19.34|138.28|Unavailable (no card)|14.53|
|1|25.66|142.66|186.94|18.66|
|3|41.21|187.65|257.83|21.95|
|10|84.16|272.26|355.46|29.67|
|25|308.42|510.89|728.51|51.74|
|50|918.63|854.84|1258.66|94.88|

The50-card geometry figure is a total for ten persisted backend commands, not input latency or displayed frame rate. Native direct resize, mixed resource workloads, idle/hidden rendering, GPU/resource use and physical application restart remain unqualified by these source samples. Node process RSS samples ranged73,539,584–338,800,640 bytes across these18 sequential trials; garbage collection and module/fixture lifetime prevent attributing that range solely to the cache or declaring leak freedom. The original baseline and both candidates remain available rather than replacing adverse or slower measurements. This run retained28,381,184 bytes of synthetic SQLite fixtures outside the repository.

## Bounded native scale preparation and driver

`prepare-native-scale.mts` now prepares a new private profile for one required count:0,1,3,10,25 or50. It uses the actual Core, canonical library factory, SQLite kernel and workspace engine with the native host's Codex transport selected but never started. Conversations are explicitly local records; it performs no capability probe, model turn or synthetic assistant response. Profiles with ten or more blocks include all seven implemented resource kinds; the primary note contains over7,000 characters and a real persisted150% text-scale preference. An empty alternate workspace supports actual native switching. The preparer refuses existing profiles and unsupported counts before writing, admits a bounded512 MiB profile allocation, and stops the small corpus at a32 MiB main-database checkpoint. The admission covers this owned writer, rather than enforcing an OS quota or stopping other applications.

Eight CPU-only tests pass, including real SQLite/Core reopening at every required count, exact canonical content/IDs/geometry/organization/presence/preferences and zero provider executions. Test profiles and preparation receipts remain private. These checks prepare native work; they are not rendered scale results.

The old `--integration-benchmark` implementation referenced removed block-creation controls and omitted the0/1/3 cases. It now delegates to `native/integration-block-scale.cjs`. This replacement is **unrun natively**. It requires one count per process, a prepared profile and an explicit deadline of at most30 seconds. It uses the existing no-refocus driver and guarded native input; losing focus ends the action. It measures fitted overview and working-scale resource/renderer/memory observations separately, exercises actual workspace buttons, note focus/collapse and a southeast-corner resize, checks custom font scale through pose changes, and writes a separate expected-state receipt for a fresh native process. The fitted viewport and visible/mounted counts are recorded rather than pretending every card is readable at once.

Prepare outside the source checkout using an absolute, new private path:

```powershell
node prototypes/block-library/prepare-native-scale.mts --profile=C:\private\new-scale-50 --block-count=50
```

After the native owner builds and allocates a desktop slot, run from `prototypes/visual-experience/cinematic-v3` with that same private path:

```powershell
.\node_modules\.bin\electron.cmd native/desktop-main.cjs --integration-benchmark --profile=C:\private\new-scale-50 --block-count=50 --sample-ms=750 --verification-deadline-ms=30000
```

Use a second process with the same arguments plus `--verify-restore` for exact native-process restoration, and separate prepared profiles for the other counts. Neither these source helpers nor their CPU-only tests qualify Library form interactions, actual minimized-window behavior, OS restart, long-term memory, display-presented frames, GPU elapsed time/VRAM/utilization, framework selection or complete product acceptance. Callback/draw intervals and backend/runtime memory observations retain their own timestamps and evidence meanings. No desktop was launched to prepare or validate this source release.
