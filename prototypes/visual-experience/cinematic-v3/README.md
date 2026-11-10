# Aerynth / Cinematic Experience V3.5

This package contains the connected Electron desktop and the Cinematic V3.5 visual harness. For canonical workspaces, conversations, Vela, and native provider review, use the [connected application guide](APPLICATION.md). This page describes the visual harness and its synthetic fixtures. The owner positively reviewed the historical celestial background. Whole-experience artistic acceptance and final host selection remain open.

The current [material continuity correction](MATERIAL-CONTINUITY-V3.5.md) keeps glass visible through overlap and selection and removes the logo's dark raster background. Review the [native workspace](evidence-material-continuity/review-final/01-unselected-three.png), [overlap recording](evidence-material-continuity/review-final/continuous-overlap.webm), and [47-check native receipt](evidence-material-continuity/review-final/verification.json). `npx --no-install electron native/material-preview.cjs` opens the canonical application in a fresh synthetic Freeform workspace for interactive review.

V3 is preserved at `9c8df82` on `codex/cinematic-experience-v3`. V3.5 extends it on `codex/cinematic-experience-v3-5`, retaining this directory and its renderer, Motion Coordinator, resources and studies. V3 evidence remains under `evidence/`; pre-celestial V3.5 is under `evidence-v3-5/`, celestial refinement under `evidence-celestial/`, and glass-instrument integration under `evidence-instruments/`. Runtime profiles remain separate.

## Run

See the [Windows build prerequisites and dependency setup](APPLICATION.md#launch). From this directory, open the visual harness with:

```powershell
npm run preview
```

`npm run preview` opens **Luminous Architecture** with Starlit Ring lighting and Optical Glass resources in a separate local profile, with Expressive Vela ambience. The header switches directly to Living Intelligence. Scene controls expose three instrument material studies, three celestial lighting studies and three orbital geometry concepts, and preserve Aetheric Observatory. This review keeps animating while another window has focus. Minimize or choose Quiet to still it.

Run the host ReserveGuard before installs, builds and captures with a separate estimate for each drive. Include the checkout, npm cache, temporary directories, profile and evidence destination. Keep raw captures and private profiles out of Git.

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

`npm test` runs package tests. `npm run verify`, `npm run record`, and `npm run soak` invoke `native/main.cjs` with the visual harness profile. Use `npm run verify:application` for the connected desktop journey.

```powershell
npm run typecheck
npm test
npm run verify
npm run record
npm run soak
```

`npm run record -- --ambient-study --celestial-study=shadow` records a separate 30-second actual-clock study of slow rotation and fixed-light reflections, without scripted pointer input. The former spatial visibility veil has been removed. It uses the same exact-window, no-audio limits as the walkthrough. Held orientation overrides are reset before recordings.

Each native verification creates a fresh evidence directory and refuses to overwrite an existing receipt. Set `AERYNTH_EVIDENCE_DIR` to a new directory when needed. Generate the current performance report with `node scripts/summarize-v3-5.mjs evidence-instruments/<your-run>`. Historical V3 scripts do not regenerate current reports. The fresh-process soak verifies live rendering before measurement, uses no screenshots, and reports an exploratory memory journey rather than prolonged leak qualification.

The native verifier uses a separate ignored profile and excludes physical mouse input during the scripted run. It captures real Electron contents, exercises local application commands, samples callback/draw timing and app metrics, minimizes the native window, and forces actual WebGL context loss/restoration. Its scripted reorder proves layout/motion behavior; separate native pointer/keyboard smoke evidence is required for the input path. Capture intervals are not presented-frame timing. The expanded run takes roughly five minutes.

The recording command captures only its exact application window, with no audio, for at most 35 seconds / 32 MiB. It creates a new ignored `.runtime/*.webm` and a matching unique same-basename JSON receipt. Recording has explicit own-window capture permission only for that bounded command; normal permissions remain denied. The [current glass-instrument video manifest](evidence-instruments/native-video.json) identifies the exact resize-corrected clip and its independent decode; [celestial recordings](evidence-celestial/native-video.json) and [earlier V3.5 recording review](evidence-v3-5/README.md) retain their historical scope. The old `recording-latest.json` is a preserved V3 receipt and must not select a current recording. Inspect an existing local recording with `electron scripts/inspect-video.cjs <absolute-local-webm-path>` if needed.

## Scope and ownership

The historical material correction was developed on `codex/glass-continuity`. Its rendering work consumed coordinated application, workspace-engine and Constellation integration. The exact master PNG is preserved without alteration; SHA-256 remains `89bd614656667f1178603afa3a23debc5a4e96fe61ccfbb957d7ef27cbf76658`.

The visual harness exercises GPU geometry and shaders, accessible DOM content, the Motion Coordinator and its native window. The connected application uses the same renderer with canonical resources, events and the native Codex bridge. Evidence from the visual harness applies to its synthetic scene.
