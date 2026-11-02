# Block operation-scale sample

Run the bounded diagnostic after ReserveGuard admission, using `node prototypes/block-library/benchmark-scale.mts --output=<private-report.json>`. The fixed workload creates 18 synthetic SQLite fixtures (three trials at each of 0,1,3,10,25,50 Note placements), with at most128 MiB allocated per fixture and a112 MiB checkpoint. Admit4 GiB on C and0 on D for the whole bounded run. The caller must apply the host reserve rule and recheck during a run exceeding five minutes. Fixture DBs and their private index are retained outside the repository; no cleanup is forced. This run's18 final databases total28,377,088 bytes.

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
