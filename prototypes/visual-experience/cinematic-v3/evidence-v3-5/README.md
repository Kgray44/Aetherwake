# Cinematic V3.5 evidence index

These are actual native Electron renderer captures and local verification records with explicitly synthetic working content. They document development and review candidates. They do not establish owner artistic acceptance, production readiness, a final desktop-host choice, HDR support, or presented application FPS. The original V3 implementation remains recoverable at `9c8df82`; its original evidence remains in [`../evidence/`](../evidence/).

## Recorded passes

| Pass | Evidence | What it establishes and what it does not |
|---|---|---|
| V3 baseline rerun | [Receipt](baseline/verification.json), [Architecture](baseline/study-architecture.png), [Living](baseline/study-living.png) | **37/37 native checks**, 13 measured scenarios. This is the rerun of the preserved V3 build, not V3.5. |
| V3.5 iteration 1 | [Receipt](iteration-1/verification.json), [Ring](iteration-1/architecture-ring.png), [Aperture](iteration-1/architecture-aperture.png), [Suspended observatory](iteration-1/architecture-observatory.png) | **44/44 native checks**, 28 measured scenarios, 38 indexed still captures. Source development continued concurrently, and this receipt predates launch-time source hashing. Treat performance as exploratory evidence for its built assets, not qualification of the later source. |
| Iteration 2 | [Exploration receipt](iteration-2/exploration.json), [Ring](iteration-2/architecture-ring.png) | Geometry and aliasing refinement. Seven native composition captures and one selectable-composition check. This short exploration is not the full verifier or a performance run. |
| Iteration 3 | [Exploration receipt](iteration-3/exploration.json), [Ring](iteration-3/architecture-ring.png) | Directional architectural graze increased from 360 to 850. Seven composition captures and one selectable-composition check; no complete regression or performance result is implied. |
| Iteration 4 | [Exploration receipt](iteration-4/exploration.json), [Ring](iteration-4/architecture-ring.png), [Aperture](iteration-4/architecture-aperture.png), [Suspended observatory](iteration-4/architecture-observatory.png) | Fog density reduced from `.035` to `.024`. Shell faces, layering and subdivisions are more legible in the reviewed ring capture than in iteration 2, retaining the brighter graze from iteration 3. This is a visual review observation, not an isolated optical benchmark. |
| `review-final/` | [Receipt](review-final/verification.json) | **45/45 native checks**, 28 scenarios. This is the iteration-4 candidate **before** the foreground-material experiment. It is retained as a preceding candidate; the directory name does not imply accepted or delivered final implementation. |
| Foreground-material exploration | [Receipt](material-experiment/exploration.json), [Architecture](material-experiment/architecture-ring.png) | Exposes GPU-backed materials that opaque DOM faces previously obscured. This experiment is distinct from the later correction for overlapping text. |
| Large arc and ambient reveal | [Receipt](large-arc-reveal/exploration.json), [Architecture](large-arc-reveal/architecture-ring.png), [Early ambient frame](ambient-early.png), [Later ambient frame](ambient-late.png), [Independent video inspection](ambient-video-inspection.json) | Preserves the requested partial-viewport architectural arc and slow environmental reveal. The actual ambient videos were independently decoded; the earlier wrong-input review is corrected below. Their source/build coverage remains limited to their own receipts. |
| `review-material-final/` | [Receipt](review-material-final/verification.json), [Retained native overlap failure](failed-native-overlap.jpg) | **47/47 native checks**, 28 scenarios on `877a6d2`. Later hands-on resource dragging revealed background text showing through overlapping transparent DOM/PBR faces. The passing run is retained and superseded; it did not establish content occlusion during that input path. |
| `review-occlusion-final/` | [Completed receipt](review-occlusion-final/verification.json) | Candidate `9388908` uses projected resource-pair bounds in `src/material-occlusion.ts` to restore opaque DOM backing only where resources overlap, preserving normal material exposure elsewhere. **35 source tests and 48/48 native checks passed**, with no renderer errors. This historical checkpoint predates the later celestial and glass-instrument refinements; their exact-source video and memory evidence are recorded in their own indexes. |

The three orbital explorations are different compositions: a partially visible monumental ring, a layered celestial aperture, and a suspended structure with a deeper receiving element. The existing third environment, Aetheric Observatory, is separately preserved; it is not the same as the suspended-observatory orbital concept.

## Comparisons and provenance

The exploration receipts record per-capture SHA-256, PNG dimensions, native content dimensions, zoom, quality, selected/expanded resource, Vela state, and visual-clock position. They also preserve launch-time source hashes. All **21 PNG hashes** listed by the iteration-2, iteration-3 and iteration-4 exploration receipts were independently checked against their local files while preparing this index and matched.

Those three exploration passes consistently record:

- PNGs of **2002 × 1253 pixels**; native content bounds **1601 × 1002**.
- Balanced quality, zoom factor 1, idle Vela, no selected or expanded resource, and reduced motion disabled.
- The same orbital geometry source hash, `b9d69f29cda855a0cddd86559f6b9596bacf6d24e4b92741cf40975ec93f64ce`, across iterations 2–4; the renderer source hashes differ as lighting and fog change.

The camera framing and native size are matched across those exploration passes. Vela's animation clock is recorded but not phase-locked: the ring captures occur at approximately 5138.3, 5120.1 and 5132.3 ms. These are comparable compositions, not strict optical before-and-after images. Do not attribute every pixel difference to a single material or lighting change. The V3 baseline and iteration-1 architecture PNGs also measure 2002 × 1253, but the baseline lacks the newer per-capture conditions manifest. Their final reported window bounds of 1600 × 1001 are not a substitute for the dimensions at each earlier capture.

For concrete chronological references, the ring PNG hashes are:

| Pass | SHA-256 |
|---|---|
| Iteration 2 | `dace3bb76c6a17892b5d8b7dff874baa85bcf5eead0a94d3a37ec6fc95950ec9` |
| Iteration 3 | `c7f9a5f56d57bce5679fd21023a359fe23d9d9452227ca9a430095028f4ca81b` |
| Iteration 4 | `ca59fe1b82892e67a44aec667843ec535d903b1ca2837e482cb35dd6a1618232` |

Screenshots captured with `capturePage()` show the application's rendered content. They do not independently qualify native caption controls or whole-window presentation. Whole-window motion recordings, when produced, are separate evidence and add capture/encoding overhead.

### Recording inspection correction

The first two ambient recordings, `aerynth-v3-5-ambient-1793565278764.webm` and `aerynth-v3-5-ambient-1793565404168.webm`, remain preserved under ignored `.runtime/`. A review command selected the **preserved V3** `.runtime/recording-latest.json` receipt, which references `aerynth-v3-native-1793558556905.webm`, rather than the new V3.5 receipt. The Electron inspector correctly decoded that older input, including its scripted focused-note sequence at 26.5 seconds. New V3.5 recordings write unique `recording-v3-5-<timestamp>.json` receipts and a JSON file beside the actual video; they do not update the legacy V3 pointer.

Independent ffmpeg decoding of **each actual new WebM at 26.5 seconds** shows the correct V3.5 Architecture idle workspace. The old inspection PNGs remain observations of the older V3 recording and must not be presented as V3.5 footage. This was an incorrect input selection in the review command. **No Electron inspector cache, decoder or native-window capture defect was demonstrated.**

The source video SHA-256 values are `980006a47357936091a8b2f20f3cf3015757d1b64b01931adbd3a834427cac3e` and `deac866267b840ae47b71e99deff2c311b21c5f9bb5b3a2f0153d8fcaddaf15e`, respectively. The independent review of the second video is retained locally in `.runtime/v3-5/independent-review-20261101T204245221Z-68fae4d8/inspection.json` with eight extracted PNGs. It records VP9 at 2000 × 1252, 909 video packets, first PTS 0 and last PTS 32.485 seconds. Container duration is unavailable. The native receipt reports 30.0036 seconds, leaving an explicit **2.4814-second difference** between packet timestamp span and reported native wall duration. This discrepancy is not relabeled as exact timing or presented FPS.

[`inspect-video-independent.ps1`](../scripts/inspect-video-independent.ps1) accepts an explicit existing local video and ffmpeg/ffprobe directory. It records the actual input basename/hash, ordered packet-payload hash, requested seek times and decoded frame PTS, with no private tool or source paths in its receipt. It does not alter the original video or its timestamps. Its previews and raw operational receipts remain local until deliberately selected for publication.

A subsequent focus-gated capture experiment aborted after focus loss and did not save a WebM. No recording result is claimed from that attempt, and neither earlier ambient take was overwritten or deleted. No unrelated user window was closed to obtain evidence.

A later correctly selected walkthrough, `aerynth-v3-5-native-1793566094175.webm`, was recorded on the `877a6d2` candidate with its capture pixel-binding check passing. Its independent inspection is retained under `.runtime/v3-5/independent-review-20261101T204913601Z-4ccdd78d/inspection.json`. This is evidence for that preceding candidate, not for the subsequent `9388908` overlap correction; a post-correction recording remains pending here.

## Functional and measurement coverage

The full V3.5 verifier exercises persistent resource DOM and editors, reversal and rapid switching, scene changes around selected text, reading position and caret state, both primary environments' resource transformations, local message retention, eight Vela presentation states, resize/zoom, reduced motion, Quiet, minimization and actual graphics-context loss/restoration. A passing controller check does not establish native pointer-input latency, accessibility acceptance, sustained reading comfort or artistic quality. Use each pass's recorded checks to determine what actually ran.

Performance scenarios retain callback intervals, renderer-submission intervals, Electron-reported CPU sums and summed working sets as separate measurements. Callback/submission cadence is **not presented FPS**; working-set sums can count shared pages more than once. Screenshots are excluded from the measurement windows, but earlier capture allocations can remain in the same process.

The [fresh-process memory probe](fresh-process-memory.json) on `877a6d2` ran for 90.014 seconds without screenshots. Summed working sets began at **560.87 MiB**, reached **1148.66 MiB**, and ended at **690.77 MiB** across its ambient, interaction, focused-work, Quiet and minimized phases. These values can count shared pages repeatedly and are not unique resident memory or VRAM. The short run does not establish leak freedom, sustained thermal stability or production memory acceptance. It predates the overlap correction; a subsequent post-fix probe is pending rather than inferred from these numbers.

[Measurement-tool discovery](performance-tools.json) records available WPR/WPA tooling, absence of PresentMon on PATH, and nonnumeric `[N/A]` NVIDIA memory entries for matching prototype processes. Discovering GPU, desktop-composition, power and thermal trace profiles does not produce an attributed presentation, VRAM or energy measurement. Those qualifications remain open unless a later receipt explicitly supplies them.

[Governance validation](governance-validation.json) preserves router validation, 33 passing router/context tests, and passing benchmark/engineering evaluations. The pre-existing Governance Context V2 CLI failure is retained; direct authoritative-source retrieval was used as the fallback. Published specialist charters remain advisory pending owner acceptance.

## Retention, privacy and storage

Earlier passes remain intact, including intermediate designs that motivated another correction. `raw/` PNG sequences are retained locally and ignored by `evidence-v3-5/**/raw/`; omission from Git is not evidence deletion. Iteration 1 alone retains 122 raw frames, approximately 111.5 MiB. JSON manifests retain their relative frame names and timing. Raw recordings, decoding frames, profiles and absolute-path operational receipts stay under ignored `.runtime/`. A public video receipt must omit local usernames, absolute paths, process/window identifiers and unrelated application information. Simulation labels and event provenance must remain visible.

Local work uses the host ReserveGuard with separate **30 GiB floors on C: and D:**. The task's broader 2 GiB C: admission includes profiles, captures and other temporary outputs; the native 190 MiB PNG cap is only the screenshot portion. Recheck the broader remaining allocation before subsequent writers. This policy monitors bounded agent-owned work; it is not an operating-system quota and cannot stop unrelated applications, cloud tasks or already-running processes that did not load the instruction. No reserve compliance claim authorizes deletion of retained evidence, personal data or unrelated work.

Owner artistic review and acceptance remain outstanding. The native overlap failure illustrates why a passing scripted predecessor run cannot settle all visual behavior. The corrected candidate still requires its own completed native receipt and subsequent evidence, alongside the remaining sustained-performance, assistive-technology and multi-display qualifications.
