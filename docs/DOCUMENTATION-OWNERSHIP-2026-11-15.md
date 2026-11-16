# Aerynth visual-engine documentation ownership and consistency register

**Date:** 2026-11-15  
**Status:** scoped documentation audit and proposed ownership clarification; not a new governance charter, code delivery, implementation verification or certification.  
**Repository base:** Kgray44/Aetherwake at \`main\` tree \`f774c417a4019b407e2a06bcac935ef35baaeebd\` as observed during this audit. Recheck source branch head at integration time.

## 1. Governing hierarchy and edit rule

[Governance registry](../governance/README.md) and [Constitution](../governance/00-AETHERWAKE-CONSTITUTION.md) outrank ratified specialist charters; approved decisions and interfaces follow; design/architecture/specifications describe implementation; plans and work items describe execution; observations and historical records never silently overrule normative sources. This register points to authorities and **cannot itself alter precedence**.

Before writing a new specification: search the existing repository and current PRs; identify the canonical owner; amend that owner if the subject already belongs to it; introduce a new document only for a genuinely independent scope; cross-check the complete change set; present the integration report to Mission 1. Do not treat a proposed companion as a ratified charter or a design document as shipped code.

## 2. Observed existing owners and decisions

| Domain / question | Primary existing owner | This branch's action |
| --- | --- | --- |
| Product-level principles, authority and acceptance | [Constitution 00](../governance/00-AETHERWAKE-CONSTITUTION.md), [Governance registry](../governance/README.md) | Leave ratified text unchanged; cite it |
| Visual language, six motion disciplines, materials | [Charter 02](../governance/02-LIQUID-INTELLIGENCE-AND-MOTION.md) | No new charter; respect existing Motion Coordinator |
| Platform/GPU performance and adaptive rendering | [Charter 13](../governance/13-PLATFORM-PERFORMANCE-AND-DISPLAYS.md) | No duplicate budget authority |
| Consent, isolation and authorization | [Charter 14](../governance/14-TRUST-PRIVACY-AND-AUTONOMY.md) | No change; retain safety boundaries |
| Materials, optical properties and legibility | [AML-001](design/AERYNTH-MATERIALS-AND-LIGHTING-SPECIFICATION.md) | Amend existing document |
| Unified six-discipline motion and interaction | [AMI-001](design/AERYNTH-MOTION-AND-INTERACTION-SPECIFICATION.md) | Amend existing document |
| Cross-surface composition, tokens and engineering | [ADE-001](specifications/AERYNTH-DESIGN-ENGINEERING-SPECIFICATION.md) | Amend existing document |
| Genuine volumetric Vela Presence and render contract | [Vela Presence GPU Contract](architecture/VELA-PRESENCE-GPU-RENDERING-CONTRACT.md) | Amend existing document, preserve art/semantic guarantees |
| ARIE hardware policy and adaptation | [ARIE scheduler](specifications/ARIE-RESOURCE-AND-SCHEDULER-CONTRACT.md) | Amend existing document |
| AEP evidence and experiments | [AEP optimization](specifications/AEP-ADAPTIVE-OPTIMIZATION-AND-EXPERIMENTS.md) | Amend existing document |
| System topology and trust boundary | [Reference Architecture](architecture/REFERENCE-ARCHITECTURE-v0.1.md) | Cross-reference added |
| Dedicated optical experiment workbench | No equivalent first-class laboratory contract identified among audited authoritative visual specs | Add [Glass Laboratory](specifications/AERYNTH-GLASS-LABORATORY.md) |
| Documentation ownership and review traceability | Governance establishes precedence, but no scoped cross-document mapping for these changes | Add this register and link from docs index |
| Virtual environment/VM intelligence | Independently assigned workstream | **Deliberately excluded**: no AVEI design, specification, execution or governance text authored here |
| Edge0 inference research | Separate local-inference evaluation scope | Deferred to the independent intelligence research track; no product inclusion asserted |
| Webcam/XR hand tracking | Future research | Explicitly deferred; no runtime dependency or delivery requirement |

This mapping is based on authoritative files inspected for this scoped feature set, not a claim to have independently verified every historical PR, archived planning record, or generated artifact in the repository.

## 3. Decision register and overlap resolution

**D-01 — One optical material engine.** AML-001 describes actual material behavior and tokens; ADE-001 describes adapters, layering and integration; the lab tests them. No component family may define a competing canonical optics schema.

**D-02 — One motion authority.** Charter 02 and AMI-001 already define one six-discipline Motion Coordinator. The Unified Motion Engine implements that authority; GSAP, Motion or other packages are replaceable adapters, not separate clocks.

**D-03 — Shared rendering without fictional parity.** The GPU Presence contract owns genuinely volumetric Vela visuals. ADE-001 owns shared scene/compositor integration. Backends may differ; never assume the app can read an arbitrary OS window's pixels.

**D-04 — Separate policy from instrumentation.** ARIE grants/limits resources; AEP measures experiments and makes evidence-backed proposals. The lab has no direct permission to override either.

**D-05 — Genuine experiment evidence.** AGL-001 defines workbench and reproducibility; optical fidelity and performance require independent scene-matched validation. Unknown, unsupported and unmeasured are not successes.

**D-06 — External source restraint.** Curated demos, design websites, shader libraries and code snippets are reference inputs; no import-by-enthusiasm policy. Licenses and attribution must be tracked individually.

**D-07 — Deferred and parallel scopes.** Spatial hand tracking remains a future project. Edge0 stays an evaluation track. AVEI is separately owned and explicitly not documented on this branch.

## 4. Cross-document contract checklist

- [x] One material taxonomy remains in AML-001.
- [x] One Motion Coordinator remains in Charter 02/AMI-001.
- [x] Vela Presence retains its separate volumetric GPU acceptance contract.
- [x] ADE-001 owns backend compositing; no promised cross-platform parity.
- [x] ARIE owns resource grants; AEP owns performance evidence.
- [x] Laboratory is experimental and cannot approve production presets.
- [x] Accessibility and authorization outrank decorative material effects.
- [x] AVEI implementation and specification are excluded from this PR.
- [x] Existing higher governance files are not silently amended.
- [ ] CI / reviewer must verify Markdown links and current branch divergence at PR review.
- [ ] Implementation contracts need final schema and target-platform benchmarks before promotion.
- [ ] Mission 1 must review overlap with concurrent UI, rendering or research branches.

The checked items express *documentary consistency of this proposed packet*, not runtime acceptance.

## 5. Documentation change-impact report

**Updated:** Materials AML-001; Motion AMI-001; Vela GPU rendering; ADE-001 engineering; ARIE; AEP; Reference Architecture; documentation index.

**New:** AGL-001 Glass Laboratory and this document ownership register.

**Intentionally unchanged:** Constitution and existing charters; implementation code; workflows/CI; permissions and repository rules; any independent virtual-environment subsystem documentation.

**Risks and review conditions:** accidental duplicate ownership; mistaken refraction/physics claims; inaccessible compositor/background sampling; shader overhead; false GPU telemetry; cross-branch collision; licensing/attribution ambiguity; accessibility regression; premature claims of implemented features.

**Smallest safe next step:** obtain Mission 1's confirmation of canonical interface owners and concurrent-branch overlaps; then run repository Markdown/governance validation and a representative Glass Laboratory proof-of-concept separately. Do not merge without ordinary review and protections.
