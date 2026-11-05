# Intelligence Stream V2: Immersive Project Execution Landscape
## Interaction, animation, inspection, and acceptance specification

| Item | Value |
|---|---|
| Scope | App-level full-screen perspective for one selected project |
| Status | Proposed detailed functional/interaction specification; not implemented or owner-accepted by publication |
| Governing source | [Charter 09 §21](../../governance/09-INTELLIGENCE-STREAMS-AND-OBSERVABILITY.md), [Charter 02 §17](../../governance/02-LIQUID-INTELLIGENCE-AND-MOTION.md), [Charter 01 §17](../../governance/01-EXPERIENCE-AND-INTERACTION.md) |
| Runtime | [Unified Spatial Intelligence Contract](../architecture/UNIFIED-SPATIAL-INTELLIGENCE-RUNTIME-AND-NAVIGATION.md) |
| Acceptance | [Prototype and Acceptance Plan](../engineering/SPATIAL-INTELLIGENCE-PROTOTYPE-AND-ACCEPTANCE-PLAN.md) |

## 1. Explicit veto of the earlier presentation

The existing small Stream preview and compact branching block are **not** the new default Intelligence Stream. They may remain as Glimpse/Forensic aids if truthful and useful. The primary new experience is an immersive, full-viewport spatial landscape animated by the Motion Coordinator with no giant top toolbar, no regularly spaced vertical stack, and no block-library metaphor.

It shows a chosen project's real execution plan as the underlying topology, not just a list of events converted into an ornament. When there is no source-backed plan, show an honest observed-activity projection with clear plan unavailability. The scene must retain source identities, timestamps, causal evidence and user inspection capabilities.

## 2. Scene composition

The main field occupies the viewport. The execution graph has a logical direction of increasing work/dependency fulfillment, which can be traversed by the user without forcing a single strict left-to-right orientation. Layout should consider causal depth, parallel operation grouping, latency, active branch count and long-lived phases.

The initial project plan forms through a restrained animated reveal: major phases become visible, then the relevant operation branches; unreached operations are gray/desaturated and quiet. Their dependency lines remain legible but subdued. Completed operations retain full semantic color and subtle residual luminosity. The advancing boundary of active work is the signature *Execution Wave*.

Minimum visual families: intent/plan; source analysis; tool execution; editing/creation; agent delegation; human approval; blocked/wait; verification; retry; result/terminal; unknown. Shape and iconography distinguish state in addition to color. Long labels appear on focus or zoom, not permanently cluttering the field.

An execution graph is a DAG when plan dependencies form a DAG; dynamic retries and event provenance may need a richer structure. Never connect two unrelated events to produce a prettier branching composition.

## 3. The Execution Wave

The Wave is **not** a CSS percentage bar crossing an entire view. Each concurrent active branch has an independent luminous execution front, with embedded flowing particles and smooth speed adaptation. A shared prefix may split into multiple fronts. Joins remain subdued until recorded prerequisites are satisfied. The wave visually unlocks completed segments behind the front as source-backed success arrives; future segments stay desaturated.

Three independent time signals coexist:
1. **Runtime truth:** source-verified operation state; never inferred from a visual clock.
2. **Estimated duration:** optional model/statistical estimate with confidence and update history, not a completed-work metric.
3. **Rendering phase:** bounded smoothed interpolation for visual elegance, never permitted to cross source-truth boundaries.

Suggested integration scheme for each branch front:

```text
observed runtime → state reducer → bounded target interval
                                     ↓
                       duration estimator (uncertain)
                                     ↓
                    motion-controlled visual front
                 (position, velocity, acceleration, jerk)
                                     ↓
              particles and colorization (never mutate truth)
```

**Early completion:** immediately expose the confirmed result in accessible status. Visually accelerate with bounded easing to close the remaining active geometry, without holding UI truth hostage to animation.

**Slow completion:** decelerate before a gate or localize activity around the current operation until evidence arrives. Do not animate indefinitely through unreached nodes.

**No estimate:** allow a living localized active-current state rather than a fake numeric percent.

**Failure/unknown:** current front changes its state signature and preserves evidence; downstream items do not illuminate as successful merely because their route is known.

**Replay:** interpolate from recorded event times, identify gaps and distinguish recreated visual phase from unrecorded intermediate data.

## 4. Streaming particles and semantic light

The field should exhibit actual visual transport through paths and within operations, not static beams plus sparkle noise. Use GPU-batched instanced particles or comparable technique and a coherent flow field, synchronized with activity levels and data-transfer events that actually exist. Particle arrival can signal observed tool output or an agent handoff. Idle decorative motion may be restrained but must not imply execution.

Nodes can contain distinct operational motion: a code-write node may show lines and file-structure formation from real diff data; verification a rotating pending glyph resolves upon results; analysis folding/branching filaments; approval localized waiting halo; terminal a contained waveform of actual output activity. Do not overload every node with its own text dashboard.

At high graph density, preserve semantic hierarchy and accessibility through grouping and level of detail. Hover/selection can reveal labels and source links. Foreground selected branch must remain clearly readable under glow and bloom.

## 5. The Activity Theater: continuous live operation inspection

Place a non-block, morphing Activity Theater near the bottom right, with collision avoidance for app shell and approvals. It is **not** a permanent giant log window, and it must not obstruct the user's control of the graph.

When an operation is the most relevant focus, the Theater materializes the applicable source-backed adapter:

| Operation | Primary animation | Required evidence fallback |
|---|---|---|
| File read | Real file surface and highlighted permitted section | File identity, read event and coverage |
| Document extraction | Page/section presentation with extraction focus | Citation, extracted segment and limitations |
| File creation | File/structure forming, real path/diff reveal | Source status, created path and verified readback |
| File change | Real diff appearing over time as available | Text diff or source-linked change summary |
| Terminal | Live console line/phase changes | Command/exit state and bounded stdout/stderr |
| Test | Suite progress and result resolution | Actual test IDs/counts/failures |
| Planning | Plan structure unfolding | Visible plan revision and source timestamp |
| Agent delegation | Handoff/worker connection visual | Real agent/run/correlation identity |
| Chat streaming | Actual streamed content when supported | Message/source coverage |
| Waiting or approval | Quiet waiting scene with clear accessible action | Source approval record and consequences |
| Failure or unknown | Distinct collapse/uncertainty visual | Evidence, retry status and what is unavailable |
| Unsupported/hidden | Neutral source-bound inspection | No fabricated file or screen depiction |

The Theater can display one primary focus plus lightweight previews of concurrent operations. It SHOULD choose focus based on user intent and salience, not switch wildly on each raw event. Pinned focus remains until user changes it or it is no longer authorized. Transitions between adapter forms preserve selected operation identity, use the Motion Coordinator, and cannot postpone approval interaction.

A non-3D/reader alternative must show all supported information, including real source references. Text and logs are not optional simply because particles are impressive.

## 6. Navigation choreography

**Entry from shell:** zero eligible projects → recent/history or honest empty state; one → open directly; more than one → compact animated selector. Show project name and state before the scene is fully entered. Keep the dock available, adapted to the dark environment.

**Presence → Stream:** an action mote/tendril tied to project ID is selected. Its luminous current becomes a spatial route. The camera travels along and through it; branches resolve into the actual project plan; the Activity Theater forms around selected operation. The project resource identity survives.

**Stream A → Stream B:** active graph recedes to a distant luminous constellation. Camera travels through a shared atmospheric bridge. B expands with its saved camera and selection. The A and B backend executions continue untouched.

**Stream → Workspace:** graph representation recedes or folds into the selected project's workspace/resource anchor, not a raw page swap. Focus only passes after the destination is ready. Back restores Stream where it was.

**Stream → Presence:** reverse to global Vela field, with source operation represented as a satellite. Historical state is preserved; completed streams do not vanish.

Motion can be skippable, and the accessible route must be one reliable action away.

## 7. Primary gestures and progressive disclosure

- Direct pointer pan with momentum capped to user preference.
- Cursor-anchored zoom, trackpad-friendly; maintain focus under pointer.
- Node selection, upstream/downstream lineage highlight and branch-follow.
- Project switch, history/live mode, search and simple filters discoverable near context or overflow rather than occupying the entire top edge.
- Focus pin/unpin for the Theater, inspect a run, return to current live focus, and choose a different active agent.
- Keyboard alternative to all crucial actions; Esc cancels transient navigation/selection without cancelling a real job.
- Replay scrub and state filter are available when relevant, not always visible as a full horizontal control wall.
- Minimap or overview appears as-needed for huge graphs; no hardcoded three-card layout.

No semantic operation should depend on the user knowing a secret gesture. Contextual actions remain accessible via focus or menus.

## 8. State, errors and density

A project can have multiple plans, runs and agents concurrently. Display higher-level grouped missions and semantic zoom into the relevant run rather than pretending a single DAG describes the entire project. A significant new plan may emerge next to an existing one with stable anchors.

Unknown/unverified progress must be visibly different from success. Retried operations display actual attempt identity and preserve failed history. Approval blockage keeps downstream operations gray. A provider report without independent verification uses a reported terminal state. Recorded run gaps must disclose uncertainty.

When a graph is very large, virtualize offscreen or distant nodes, aggregate repetitive low-value events and preserve one-to-one inspection of underlying evidence. Layout must never move selected work unexpectedly; saved view state is per project.

## 9. Acceptance journey with concrete pass/fail criteria

- **Plan-before-work:** a real plan with at least one future branch renders subdued before it executes.
- **Concurrent branches:** at least two actually running branches show distinct wave fronts, with one slower than another and join gating correct.
- **Smoothness:** re-estimation changes visual velocity continuously; under simulated bounds, no visible front teleportation or premature completion.
- **Artifact previews:** at least one real document/file read, a real file diff or creation, one command/test source, and an approval/unknown adapter display trustworthy content without invented footage.
- **Plan mutation:** new branch unfolds from source-backed revision, neighboring nodes reflow smoothly, old selected node remains findable.
- **Project switching:** two real projects with distinct histories; return restores camera/Theater and preserves execution continuity.
- **Spatial travel:** Presence↔Stream and Stream A↔B are filmed from the actual app as continuous perceptual journeys.
- **User control:** keyboard, reduced motion, errors, high-density mode and GPU interruption retain access and meaning.
- **Truth:** no decorative pulse is counted as an observed event and no model's private chain-of-thought is claimed exposed.

A row of boxes connected by lines, even a graceful row with particle animations, does not pass this document. It is not the final Intelligence Stream.
