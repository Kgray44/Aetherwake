# Aerynth / Cinematic Experience V3.5

An isolated, executable visual experiment. **Synthetic content; no AI backend connected.** The owner positively reviewed the celestial background; whole-experience artistic acceptance remains open. Neither Electron nor Tauri is selected as the production host.

The current [material continuity correction](MATERIAL-CONTINUITY-V3.5.md) keeps glass visible through overlap and selection and removes the logo's dark raster background. Review the [native workspace](evidence-material-continuity/review-final/01-unselected-three.png), [overlap recording](evidence-material-continuity/review-final/continuous-overlap.webm), and [47-check native receipt](evidence-material-continuity/review-final/verification.json). `npx --no-install electron native/material-preview.cjs` opens the canonical application in a fresh synthetic Freeform workspace for interactive review.

V3 is preserved at `9c8df82` on `codex/cinematic-experience-v3`. V3.5 extends it on `codex/cinematic-experience-v3-5`, retaining this directory and its renderer, Motion Coordinator, resources and studies. V3 evidence remains under `evidence/`; pre-celestial V3.5 is under `evidence-v3-5/`, celestial refinement under `evidence-celestial/`, and glass-instrument integration under `evidence-instruments/`. Runtime profiles remain separate.

## Run

Requires Node 24 and npm on Windows. From this directory:

```powershell
npm ci
npm start
```

`npm run preview` opens **Luminous Architecture** with Starlit Ring lighting and Optical Glass resources in a separate local profile, with Expressive Vela ambience. The header switches directly to Living Intelligence. Scene controls expose three instrument material studies, three celestial lighting studies and three orbital geometry concepts, and preserve Aetheric Observatory. This review keeps animating while another window has focus; minimize or choose Quiet to still it. `npm start` also pauses on blur.

Keep the host's per-drive storage reserve before installing/building/capturing. A fresh dependency install and verification should be admitted as a bounded 2 GiB C: step, with no D: writes, using the host ReserveGuard. Dependencies/builds/profiles/raw captures are ignored. There is no installer, updater, remote connection, or production deployment.

## Review the experience

1. Select a folio by its title; **Unfold** expands the same resource into a working surface. The conversation has a scrollable, selectable scripted opening exchange and a separate composer. Keep a local message with Ctrl+Enter; no model request is sent. Horizontal peripheral anchors restore related resources. Return without replacing the article, editor, draft, or reading position. Interrupt/reverse immediately; there is no theatrical lockout.
2. Drag a folio by its dotted grip. Potential destinations appear and neighbors yield. Release to settle. Use **Undo move** to recover the previous arrangement. Keyboard alternatives: move arrows or Alt+arrow on the grip.
3. Address Vela, or press Alt+V. Typed input is received locally; the interface states that an AI response is unavailable. Her expression selector is explicitly synthetic.
4. Run the **synthetic sequence**. Recorded fixture events drive Vela state, the resource highlight and relationship line, and the Intelligence Stream. Reported completion is separate from a check of the fixture sequence. No model work or artistic result is verified by that check.
5. Scene controls switch between three genuinely different procedural environments, graphics tiers, Ambient motion, Vela's Expressive/Subtle presence, reduced motion, and Quiet mode. Vela precesses, breathes and flows without mouse movement; mouse parallax remains additive. After twelve seconds without interaction, visible ambience continues at a lower cadence. Quiet/reduced/unavailable modes stop autonomous animation. The OS reduced-motion preference takes precedence.

Tab/Enter operate the controls; Escape closes the foremost utility surface or returns to the workspace. No microphone is used. Local drafts and ID order persist in a versioned, validated localStorage record; Vela's unsent message stays in the open window. Clear the dedicated profile only through an explicit user data-management operation.

## Inspect the work

- [Current celestial environment design and critical review](CELESTIAL-ENVIRONMENT-ADDENDUM-V3.5.md)
- [Current foreground integration and critical review](FOREGROUND-INTEGRATION-V3.5.md)
- [Optical material continuity correction and current acceptance work](MATERIAL-CONTINUITY-V3.5.md)
- [Instrument evidence index](evidence-instruments/README.md) and [performance report](PERFORMANCE-INSTRUMENTS-V3.5.md)
- [Celestial evidence index](evidence-celestial/README.md)
- [Celestial performance report](PERFORMANCE-CELESTIAL-V3.5.md)
- [Historical V3.5 design](CELESTIAL-DESIGN-V3.5.md), [evaluation](EVALUATION-V3.5.md) and [performance](PERFORMANCE-V3.5.md)
- [V3 visual direction and research](VISUAL-DIRECTION.md)
- [Motion, materials and Vela contracts](MOTION-AND-VELA.md)
- [Historical V3 evaluation](EVALUATION.md)
- [Current architecture and glass resources](evidence-instruments/review-resize-final/instruments-A-optical-glass-workspace.png), [Living field](evidence-instruments/review-resize-final/instruments-A-optical-glass-living-workspace.png), [focused conversation](evidence-instruments/review-resize-final/instruments-A-optical-glass-conversation-focused.png)
- [Instrument native verification](evidence-instruments/review-resize-final/verification.json), [celestial checkpoint](evidence-celestial/review-radius-motion/verification.json), [V3 baseline rerun](evidence-v3-5/baseline/verification.json)
- [Native pointer/keyboard smoke](evidence-instruments/native-input-smoke.json), [exact-candidate video manifest](evidence-instruments/native-video.json), [validated live-rendering memory probe](evidence-instruments/fresh-process-memory.json)

## Verify

```powershell
npm run typecheck
npm test
npm run verify
npm run record
npm run soak
```

`electron . --record --ambient-study --celestial-study=shadow` records a separate 30-second actual-clock study of slow rotation and fixed-light reflections, without scripted pointer input. The former spatial visibility veil has been removed. It uses the same exact-window, no-audio limits as the walkthrough. Held orientation overrides are reset before recordings.

Each native verification creates a fresh evidence directory and refuses to overwrite an existing receipt. Set `AERYNTH_EVIDENCE_DIR` to a new directory when needed. Generate the current performance report with `node scripts/summarize-v3-5.mjs evidence-instruments/<your-run>`. Historical V3 scripts do not regenerate current reports. The fresh-process soak verifies live rendering before measurement, uses no screenshots, and reports an exploratory memory journey rather than prolonged leak qualification.

The native verifier uses a separate ignored profile and excludes physical mouse input during the scripted run. It captures real Electron contents, exercises local application commands, samples callback/draw timing and app metrics, minimizes the native window, and forces actual WebGL context loss/restoration. Its scripted reorder proves layout/motion behavior; separate native pointer/keyboard smoke evidence is required for the input path. Capture intervals are not presented-frame timing. The expanded run takes roughly five minutes.

The recording command captures only its exact application window, with no audio, for at most 35 seconds / 32 MiB. It creates a new ignored `.runtime/*.webm` and a matching unique same-basename JSON receipt. Recording has explicit own-window capture permission only for that bounded command; normal permissions remain denied. The [current glass-instrument video manifest](evidence-instruments/native-video.json) identifies the exact resize-corrected clip and its independent decode; [celestial recordings](evidence-celestial/native-video.json) and [earlier V3.5 recording review](evidence-v3-5/README.md) retain their historical scope. The old `recording-latest.json` is a preserved V3 receipt and must not select a current recording. Inspect an existing local recording with `electron scripts/inspect-video.cjs <absolute-local-webm-path>` if needed.

## Scope and ownership

The material correction is developed on `codex/glass-continuity`. It consumes coordinated application, workspace-engine and Constellation integration while keeping rendering ownership here. Governance is unchanged. The exact master PNG is preserved without alteration; SHA-256 remains `89bd614656667f1178603afa3a23debc5a4e96fe61ccfbb957d7ef27cbf76658`.

GPU geometry/shaders, accessible DOM content, canonical resources/events, coordinator, native adapter, and verification are separate. There is no backend lock-in in the scene. A real Codex path, complete application architecture, production security review, detached displays, and owner artistic acceptance remain outside this experiment's demonstrated scope.
