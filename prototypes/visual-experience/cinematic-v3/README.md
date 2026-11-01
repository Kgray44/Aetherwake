# Aerynth / Cinematic Experience V3.5

An isolated, executable visual experiment. **Synthetic content; no AI backend connected.** The owner has not accepted this visual direction, and neither Electron nor Tauri is selected as the production host.

V3 is preserved at `9c8df82` on `codex/cinematic-experience-v3`. V3.5 extends that implementation on `codex/cinematic-experience-v3-5`, retaining this directory and its existing renderer, Motion Coordinator, resources and studies. V3 evidence remains under `evidence/`; new runs use `evidence-v3-5/`. V3.5 runtime profiles are separate from the V3 profiles.

## Run

Requires Node 24 and npm on Windows. From this directory:

```powershell
npm ci
npm start
```

`npm run preview` opens **Luminous Architecture** in a separate local profile, with Expressive Vela ambience. The header switches directly to Living Intelligence. Scene controls expose the three orbital composition experiments and preserve the third Aetheric Observatory study. This visible review keeps animating while you use another window; minimize or choose Quiet to still it. `npm start` uses the ordinary profile and also pauses on blur.

Keep the host's per-drive storage reserve before installing/building/capturing. A fresh dependency install and verification should be admitted as a bounded 2 GiB C: step, with no D: writes, using the host ReserveGuard. Dependencies/builds/profiles/raw captures are ignored. There is no installer, updater, remote connection, or production deployment.

## Review the experience

1. Select a folio by its title; **Unfold** expands the same resource into a working surface. The conversation has a scrollable, selectable scripted opening exchange and a separate composer. Keep a local message with Ctrl+Enter; no model request is sent. Horizontal peripheral anchors restore related resources. Return without replacing the article, editor, draft, or reading position. Interrupt/reverse immediately; there is no theatrical lockout.
2. Drag a folio by its dotted grip. Potential destinations appear and neighbors yield. Release to settle. Use **Undo move** to recover the previous arrangement. Keyboard alternatives: move arrows or Alt+arrow on the grip.
3. Address Vela, or press Alt+V. Typed input is received locally; the interface states that an AI response is unavailable. Her expression selector is explicitly synthetic.
4. Run the **synthetic sequence**. Recorded fixture events drive Vela state, the resource highlight and relationship line, and the Intelligence Stream. Reported completion is separate from a check of the fixture sequence. No model work or artistic result is verified by that check.
5. Scene controls switch between three genuinely different procedural environments, graphics tiers, Ambient motion, Vela's Expressive/Subtle presence, reduced motion, and Quiet mode. Vela precesses, breathes and flows without mouse movement; mouse parallax remains additive. After twelve seconds without interaction, visible ambience continues at a lower cadence. Quiet/reduced/unavailable modes stop autonomous animation. The OS reduced-motion preference takes precedence.

Tab/Enter operate the controls; Escape closes the foremost utility surface or returns to the workspace. No microphone is used. Local drafts and ID order persist in a versioned, validated localStorage record; Vela's unsent message stays in the open window. Clear the dedicated profile only through an explicit user data-management operation.

## Inspect the work

- [Celestial design specification](CELESTIAL-DESIGN-V3.5.md)
- [V3.5 critical evaluation](EVALUATION-V3.5.md)
- [V3.5 performance report](PERFORMANCE-V3.5.md)
- [V3 visual direction and research](VISUAL-DIRECTION.md)
- [Motion, materials and Vela contracts](MOTION-AND-VELA.md)
- [Historical V3 evaluation](EVALUATION.md)
- [V3.5 architecture](evidence-v3-5/review-material-final/architecture-ring.png), [Living field](evidence-v3-5/review-material-final/study-living.png), [focused conversation](evidence-v3-5/review-material-final/focused-conversation.png)
- [V3.5 native verification](evidence-v3-5/review-material-final/verification.json), [V3 baseline rerun](evidence-v3-5/baseline/verification.json)

## Verify

```powershell
npm run typecheck
npm test
npm run verify
npm run record
npm run soak
```

`electron . --record --ambient-study` records a separate 30-second native study of the much larger arc, its slow rotation, spatial uncovering veil and fixed-light reflections, without scripted interaction. It uses the same exact-window, no-audio capture limits as the walkthrough.

Each native verification creates a fresh evidence directory and refuses to overwrite an existing receipt. Set `AERYNTH_EVIDENCE_DIR` to a new directory when a specific destination is needed. Generate a performance report using `node scripts/summarize-v3-5.mjs evidence-v3-5/<your-run>`. The old `summarize-evidence.mjs` and `make-motion-evidence.py` belong to historical V3 evidence; do not use them to regenerate V3.5 reports. The fresh-process soak uses no screenshots and reports a bounded exploratory memory journey, not prolonged leak qualification.

The native verifier uses a separate ignored profile and excludes physical mouse input during the scripted run. It captures real Electron contents, exercises local application commands, samples callback/draw timing and app metrics, minimizes the native window, and forces actual WebGL context loss/restoration. Its scripted reorder proves layout/motion behavior; separate native pointer/keyboard smoke evidence is required for the input path. Capture intervals are not presented-frame timing. The expanded run takes roughly five minutes.

The recording command captures only its exact application window, with no audio, for at most 35 seconds / 32 MiB. It creates a new ignored `.runtime/*.webm` and a unique local receipt. Recording has explicit own-window capture permission only for that bounded command; normal permissions remain denied. A [de-identified V3.5 video receipt](evidence-v3-5/native-video.json) describes the delivered recordings. Inspect an existing local recording with `electron scripts/inspect-video.cjs <absolute-local-webm-path>` if needed.

## Scope and ownership

All implementation is under this directory on `codex/cinematic-experience-v3-5`. Other prototypes and governance are untouched. The exact master PNG is preserved without alteration; SHA-256 remains `89bd614656667f1178603afa3a23debc5a4e96fe61ccfbb957d7ef27cbf76658`.

GPU geometry/shaders, accessible DOM content, canonical resources/events, coordinator, native adapter, and verification are separate. There is no backend lock-in in the scene. A real Codex path, complete application architecture, production security review, detached displays, and owner artistic acceptance remain outside this experiment's demonstrated scope.
