# Aerynth Glass Laboratory — Optical Research and Verification Contract

| Field | Value |
| --- | --- |
| Document ID | AGL-001 |
| Version | 0.1.0 / proposal for review, 2026-11-15 |
| Status | Owner-confirmed product direction; research and implementation NOT yet verified |
| Responsibility | Dedicated engineering laboratory: optical prototyping, reproducible rendering comparisons, material candidates and measured performance |
| Authorities | [Constitution](../../governance/00-AETHERWAKE-CONSTITUTION.md), [02 Liquid Intelligence](../../governance/02-LIQUID-INTELLIGENCE-AND-MOTION.md), [13 Platform](../../governance/13-PLATFORM-PERFORMANCE-AND-DISPLAYS.md), [14 Trust](../../governance/14-TRUST-PRIVACY-AND-AUTONOMY.md), [15 Acceptance](../../governance/15-QUALITY-VERIFICATION-AND-ACCEPTANCE.md) |
| Existing design owners | [AML-001 Materials](../design/AERYNTH-MATERIALS-AND-LIGHTING-SPECIFICATION.md), [AMI-001 Motion](../design/AERYNTH-MOTION-AND-INTERACTION-SPECIFICATION.md), [ADE-001 Design Engineering](AERYNTH-DESIGN-ENGINEERING-SPECIFICATION.md), [Vela Presence GPU](../architecture/VELA-PRESENCE-GPU-RENDERING-CONTRACT.md) |

> The Glass Laboratory is a serious, first-class Aerynth developer environment for experimenting with physically convincing refractive glass and measuring its real cost. It is not a library of decorative presets, a second material engine, an approval authority, or a claim to proprietary Apple rendering algorithms.

## 1. Purpose, non-goals and authority

The laboratory enables engineers to change optical material parameters, geometry, lighting, composition and backend configuration, inspect results in real time, compare against saved reference scenes and collect independently reproducible evidence. The same versioned **Optical Glass Engine** supplies production materials and laboratory experiments; laboratory-only extensions must be feature-gated and cannot silently reach production. The canonical material roles and constraints remain in AML-001. The Glass Laboratory owns only research experience, experimental records, and recommendation artifacts. Design/material owners approve production recipes, ARIE enforces resource policy, AEP validates measurements and the governance/quality owners approve implementation acceptance.

Non-goals: automatically copying paid/preset glass packages; capturing arbitrary third-party applications; proving physically accurate optics by appearance alone; showing an attractive static demo instead of measuring performance; controlling Vela execution state or authorization; launching webcam hand tracking (deferred).

## 2. Interactive workbench and instruments

The workbench should support:
1. **Scene and geometry viewport:** pan/orbit/zoom, selectable reference scene, one or more test glass surfaces, live scene and light overlays, optical normal visualization and exact geometry transforms.
2. **Material inspector:** editable index of refraction, effective thickness, surface curvature, roughness/frost, dispersion, Fresnel reflectance, color tint, transmission, edge response and light scattering where a backend supports them.
3. **Lighting studio:** move/select light sources, alter intensity and color temperature, inspect environment lighting, reflections and highlight behavior; offer test backgrounds with calibrated line grids, high-frequency text, sharp edges, photography and moving objects.
4. **Backend comparison:** synchronized side-by-side or overlay/difference views comparing native/CSS frost, SVG displacement, GPU screen-space refraction and optional offline/reference ray-model outputs, each labeled by actual capability. Missing backends show unsupported, not synthetic screenshots misrepresented as execution.
5. **Temporal tests:** moving lenses, hover response, dock morph, overlapping panels, camera travel, idle-to-active transition, tab occlusion and live interruption tests driven by the existing Motion Coordinator.
6. **Live telemetry:** elapsed/monotonic timing, current and percentile frame-time, CPU/GPU workload where measured, main-thread time, memory/VRAM where accessible, shader compilation/cache indicators, stutters and sampled instrumentation cost.
7. **Experiment management:** named material/scene revisions, saved presets and benchmarks, pinned inputs, source attribution, replayable test steps, screenshots, report export and comparative history.
8. **Accessibility/failure controls:** reduced-motion, reduced-transparency, high contrast, small-display/DPI, HDR/SDR if supported, GPU unavailability, window resize, renderer restart, unknown metrics and background contention.

Tooltips and parameter controls must show units, permitted ranges, backend support, effect direction, stability limitations and provenance. Parameter edits may be previewed locally without mutating approved production presets.

## 3. Proposed typed experiment boundary

Illustrative TypeScript, not a ratified application API:

~~~typescript
type OpticalGeometry = {
  kind: "rounded-rect" | "pill" | "lens" | "custom-sdf";
  curvature: number; thicknessMmEquivalent: number;
  transformRevision: string;
};
type OpticalProperties = {
  indexOfRefraction: number;
  roughness: number; frost: number; dispersion: number;
  transmission: number; fresnelWeight: number;
  tintLinearRGBA: [number, number, number, number];
};
type GlassExperiment = {
  schemaVersion: "0.1"; id: string; createdAtUtc: string;
  sceneRevision: string; geometry: OpticalGeometry;
  material: OpticalProperties; rendererBackend: string;
  rendererRevision: string; motionScenarioId: string;
  machineProfileRef: string; qualityPolicyRevision: string;
  lightingRevision: string; privacyClass: string;
  seed: string | null; notes: string;
};
type LabMeasurement = {
  experimentId: string; source: string;
  unit: string; metric: string;
  value: number | null;
  provenance: "observed" | "derived" | "estimated" | "unavailable" | "disputed";
  sampleCount: number | null;
  timebase: string; instrumentRevision: string;
};
~~~

No production preset is inferred from an experiment without a separate explicit review and acceptance record. Experiments must avoid uploading private background content, credentials, raw screen captures or restricted sources to this public repository.

## 4. Optical integrity and rendering comparisons

Candidate reference material: [rukkiecodes/liquid-glass](https://github.com/rukkiecodes/liquid-glass), [archisvaze/liquid-glass](https://github.com/archisvaze/liquid-glass), and [xcyberpunkx0/liquid-glass](https://github.com/xcyberpunkx0/liquid-glass). These are research starting points, not built-in dependencies, certified implementations or guaranteed license grants for all included assets. Evaluate pinned source versions, tests, licenses and provenance.

Use a common geometric scene, common camera and lighting, matched input events, and clearly recorded material mapping before comparing backends. Distinguish:
- **Frosted transparency** from *lens displacement*.
- **Approximate screen-space refraction** from *Snell-based ray geometry* and true ray/path tracing.
- **Artistic chromatic edging** from physically modeled dispersion.
- **Scene sampling** from protected or inaccessible OS/DOM backdrop content.
- **Subjective optical fidelity** from reproducible measurable rendering performance.

Document invalid comparisons (different backgrounds, refresh rate, motion/quality profile, hardware load or cached shader state) rather than publishing a single unqualified winner.

## 5. Benchmark protocol and acceptance gates

The minimum matrix covers cold/warm renderer startup, static and animated lens, layered/overlapping glass, text and image backgrounds, resize/DPI, keyboard and pointer interactions, 30/60/120 Hz contexts where available, gaming/foreground contention, GPU loss/recovery, reduced-motion/transparency, and fallback backend. Use actual capability detection; platform-unavailable cases remain explicit N/A.

Report:
- Frame P50/P95/P99 latency with sample count and clock origin.
- Input-to-visible latency with definition, methodology and uncertainty.
- Shader compilation first-use stall and warm behavior.
- CPU/GPU resource cost, memory footprint and major allocation spikes.
- Quality-tier transitions, culling impact and energy/battery impact where instrumented.
- Visual fidelity via saved reference scene, assessed distortion geometry, edge artifacts, contrast, occlusion and temporal stability.
- Instrument overhead, dropped samples, missing hardware counters and confidence limitations.

**No claimed pass** until an authorized, representative test environment reproduces the result. AEP stores comparisons and attribution; ARIE enforces grants. A test cannot silently disable quality or remove meaningful intelligence to achieve a favorable FPS number.

## 6. Promotion and rollback

Suggested states: draft experiment → repeatable trial → independently reviewed comparison → candidate material → integration review → verified on target environment → production-approved preset. Preserve rejected and superseded records; do not overwrite original performance evidence. A production preset must include rollback to last verified render behavior. Any new shader or material backend is subject to dependency/license review, security review, compatibility evidence, accessibility review, runtime-resource review, and Mission 1 integration coordination.

## 7. Implementation sequencing

- **AGL-0:** audit current materials/motion/rendering code, provenance and graphics capabilities, then establish immutable research fixtures.
- **AGL-1:** implement lab workspace and immutable experiment schema using the existing engine contracts, with a basic reference scene and safe local save/replay.
- **AGL-2:** integrate interchangeable backend comparison, visual overlays, GPU/CPU measurement adapters and accessibility fixtures.
- **AGL-3:** validate optical reference modeling, regression suites and AEP experiment integration; produce a smallest-safe production candidate.
- **AGL-4:** independent review and rollout behind feature flags, with benchmark evidence and a documented rollback.

No stage asserts the next is complete merely because the interface renders. Performance targets and specific framework choices require measurement, not guesswork.

## 8. Traceability

The [documentation ownership register](../DOCUMENTATION-OWNERSHIP-2026-11-15.md) determines which existing document receives future changes. Changes to material taxonomy belong in AML-001; Motion Coordinator behavior in AMI-001; shared renderer and compositing in ADE-001 and the Vela GPU contract; resource budget in ARIE; evidence in AEP; and higher requirements in the relevant governing charter through explicit amendment review. This document must not re-author those domains.
