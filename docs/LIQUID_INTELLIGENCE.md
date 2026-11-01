# Liquid Intelligence — Visual, Motion, and Interaction Contract

**This is not a styling pass. UI and motion are core product behavior and must be designed and tested before the full feature set.**

## Visual north star
A distinct fusion of cinematic AI presence, visionOS-like dimensional materials, high-end scientific visualization, and mission-control precision. Avoid generic neon-cyan sci-fi dashboards, flat rounded cards with blur, gratuitous HUD clutter, and motion that only covers bad information architecture.

Desired qualities: fluid, lucid, airy, glasslike, physically coherent, responsive, beautiful even at rest, and clearly readable. Particle motion, reflections, depth and light must feel part of one environment. The assistant should feel ambient and present rather than like a separate chat bubble.

## Six coordinated motion systems
1. **Spatial Motion:** Position, scale, detach/dock, resize, reflow, focus, shared-element transitions, cross-workspace and window moves. Objects retain identity throughout transformations. Prefer velocity-preserving springs and continuity over disconnected slide-in presets.
2. **Material Motion:** Layered translucent materials, refraction/reflection approximations, edge highlights, lighting gradients, shadows and depth. Effects change with focus, movement and object hierarchy. Preserve text contrast under every background.
3. **Atmospheric Motion:** GPU-driven particles, subtle volumetric suggestions, filaments, environmental flow and Vela's central visual presence. Atmospheric effects may be decorative but should not constantly dominate.
4. **Semantic Motion:** Tool execution, delegation, stream updates, new findings, verification, failures, approvals, inter-agent sharing and task progress each get meaningful, consistent motion signatures. Render only *observed* or clearly marked simulated activity; avoid fabricated progress percentages.
5. **Interaction Motion:** Hover/focus, selection anchors, contextual command emergence, drag and drop, connected-resource highlights, keyboard and touch behavior; gracefully merge competing animations.
6. **Performance Motion:** Automated quality adaptation based on frame timing, foreground activity, GPU/CPU pressure and power conditions when those signals are available. Idle or background windows should reduce rendering; gaming mode should be quiet. Crossfade quality changes without visually breaking the scene.

## Render architecture principles
- Split high-frequency GPU/canvas rendering from React or other application UI state. Do not create thousands of DOM nodes for each particle.
- Centralize timing, animation priorities, cancellation and easing/spring parameters in a Motion Coordinator. No widget-specific arbitrary 200ms transitions.
- Implement a semantic event-to-motion layer: event data drives animation *state*, not imperative animation scripts scattered across UI modules.
- Defer choosing Tauri/Electron or WebGL2/WebGPU until a Windows hardware prototype benchmarks actual composition, WebView limitations, transparent/detached windows, high-DPI support and GPU load.
- Prefer physically suggestive visual behavior, not computationally expensive literal photorealism.
- Implement adjustable fidelity profiles: Cinematic, Balanced, Efficient, Gaming, Battery, Automatic; allow manual override.
- Respect prefers-reduced-motion and build clear, beautiful non-animated equivalents. Keyboard interaction and focus indication are mandatory.
- Smoothly handle 1/2-display configurations, mixed DPI, fullscreen apps and minimized windows. Inactive detached windows should throttle safely.

## Signature interactions to prototype
**Launch / return:** Visual awakening (interruptible) followed by an attention-aware recap; never delay access to urgent work behind an animation.

**Vela Presence:** Ambient filaments and structured light signal idle, listening, working, delegation, results and approval required. States derived from the real event model. Voice is optional and never blocks typing.

**Block manipulation:** Pick up, drag, rearrange, dock, resize and focus cause natural neighboring layout motion. No sudden jumps or lost identity. Contextual selection can include object-level and text-range scope.

**Chat expansion:** Small chat block expands to full conversation via shared-element continuity. Message history virtualization means long chats load quickly even if transcripts are huge.

**Command anchor:** Selected object or content acquires a gentle light contour. A compact translucent input forms nearby, following selection semantics without occluding the target. Scope expansion (e.g. from one file to entire folder) is visibly previewed. A high-risk action prompts confirmation.

**Task fan-out:** One natural-language request becomes task objects, visible dependencies and agent nodes; concurrent work uses distinctive pulses; results return to Vela and relevant conversation/workspace.

**Live timeline:** Asked for task plan; workspace gracefully reallocates space, timeline comes into being, ranges/confidence shown, dependency edges remain legible. Forecast updates animate in place.

**Intelligence Streams:** Real event bus drives light/activity, with an execution view for source evidence. Agent constellations avoid pretending that glowing structure is a literal view of internal neural reasoning.

**Context decay:** Context Inspector presents older detail as less prominent, decisions as persistent anchors, with search and restore capabilities; original transcript remains available.

## Benchmarks and verification
- Measure 16.7ms frame budget at 60Hz and 8.3ms at 120Hz as *targets*, not promises; test p50/p95/p99 frame time, long tasks, scrolling, startup/restore, dynamic layout changes and power draw.
- Profile integrated and discrete GPU configurations; do not assume high refresh availability.
- Verify that heavy background load, gaming, window occlusion and minimized state reduce rendering work.
- Test at least a lengthy synthetic conversation, 100+ resource nodes, multiple active agent-event feeds, and a dual-display arrangement before locking the design.
- Test reduced-motion, high-contrast, screen scaling, keyboard-only control, and blurry/backdrop failure modes.
- Never compromise legibility or reliability to achieve an effect. Every animation should be interruptible and converge to valid UI state.

## Anti-patterns
- Random particles not coupled to any purposeful scene composition.
- Fake thinking text, fake progress and fictitious token metrics.
- Massive expensive blur layers behind every panel.
- Only beautiful screenshot states while resize/drag/focus feel brittle.
- Delayed click response to preserve choreography.
- Motion graphs that cannot be reduced for accessibility.
- Starting with a generic dashboard library and hoping polish will arrive later.

## First visual review gates
1. **Still image quality:** Does the resting UI look genuinely original, refined and coherent?
2. **Motion continuity:** Do blocks preserve identity across states?
3. **Interactive precision:** Can keyboard, mouse and context selection be used without friction?
4. **Truthfulness:** Does animation reflect events, not invent them?
5. **Practical performance:** Does it remain usable under real and simulated system load?
6. **Usability:** Can a user do routine tasks faster than in an ordinary Codex window?

A spectacular screen that fails these gates is not done.