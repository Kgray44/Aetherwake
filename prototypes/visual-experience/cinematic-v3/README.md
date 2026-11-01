# Aerynth / Cinematic Experience V3

An isolated, executable visual experiment. **Synthetic content; no AI backend connected.** The owner has not accepted this visual direction, and neither Electron nor Tauri is selected as the production host.

## Run

Requires Node 24 and npm on Windows. From this directory:

```powershell
npm ci
npm start
```

`npm run preview` opens the updated **Living Intelligence** review window in a separate local profile, with Expressive Vela ambience. This visible review keeps animating while you use another window; minimize or choose Quiet to still it. `npm start` uses the ordinary profile and also pauses on blur.

Keep the host's per-drive storage reserve before installing/building/capturing. A fresh dependency install and verification should be admitted as a bounded 2 GiB C: step, with no D: writes, using the host ReserveGuard. Dependencies/builds/profiles/raw captures are ignored. There is no installer, updater, remote connection, or production deployment.

## Review the experience

1. Select a folio by its title; **Unfold** expands the same resource into a working surface. The conversation has a scrollable, selectable scripted opening exchange and a separate composer. Keep a local message with Ctrl+Enter; no model request is sent. Horizontal peripheral anchors restore related resources. Return without replacing the article, editor, draft, or reading position. Interrupt/reverse immediately; there is no theatrical lockout.
2. Drag a folio by its dotted grip. Potential destinations appear and neighbors yield. Release to settle. Use **Undo move** to recover the previous arrangement. Keyboard alternatives: move arrows or Alt+arrow on the grip.
3. Address Vela, or press Alt+V. Typed input is received locally; the interface states that an AI response is unavailable. Her expression selector is explicitly synthetic.
4. Run the **synthetic sequence**. Recorded fixture events drive Vela state, the resource highlight and relationship line, and the Intelligence Stream. Reported completion is separate from a check of the fixture sequence. No model work or artistic result is verified by that check.
5. Scene controls switch between three genuinely different procedural environments, graphics tiers, Ambient motion, Vela's Expressive/Subtle presence, reduced motion, and Quiet mode. Vela precesses, breathes and flows without mouse movement; mouse parallax remains additive. After twelve seconds without interaction, visible ambience continues at a lower cadence. Quiet/reduced/unavailable modes stop autonomous animation. The OS reduced-motion preference takes precedence.

Tab/Enter operate the controls; Escape closes the foremost utility surface or returns to the workspace. No microphone is used. Local drafts and ID order persist in a versioned, validated localStorage record; Vela's unsent message stays in the open window. Clear the dedicated profile only through an explicit user data-management operation.

## Inspect the work

- [Visual direction and research](VISUAL-DIRECTION.md)
- [Motion, materials and Vela contracts](MOTION-AND-VELA.md)
- [Evaluation and known limitations](EVALUATION.md)
- [Native screenshots](evidence/environment-idle.png), [expanded working surface](evidence/resource-expanded.png), [Intelligence Stream](evidence/intelligence-stream.png)
- [Motion samples](evidence/motion/manifest.json), including [resource expansion](evidence/motion/expansion.gif) and [rearrangement](evidence/motion/rearrangement.gif)
- [Reproducible native verification](evidence/verification.json)

## Verify

```powershell
npm run typecheck
npm test
npm run verify
npm run record
python scripts/make-motion-evidence.py
node scripts/summarize-evidence.mjs
```

The native verifier uses a separate ignored profile and excludes physical mouse input during the scripted run. It captures real Electron contents, exercises local application commands, samples callback/draw timing and app metrics, minimizes the native window, and forces actual WebGL context loss/restoration. Its scripted reorder proves layout/motion behavior; separate native pointer/keyboard smoke evidence is required for the input path. Capture intervals are not presented-frame timing. Pillow is needed only to encode recorded frames as GIFs. The run takes roughly three minutes.

The recording command captures only its exact application window, with no audio, for at most 35 seconds / 32 MiB. It creates a new ignored `.runtime/*.webm` and a local receipt. Recording has explicit own-window capture permission only for that bounded command; normal permissions remain denied. A [de-identified video receipt](evidence/native-video.json) describes the delivered recording. Inspect an existing local recording with `electron scripts/inspect-video.cjs <absolute-local-webm-path>` if needed.

## Scope and ownership

All implementation is under this directory on `codex/cinematic-experience-v3`. Existing prototypes and governance are untouched. The exact master PNG is copied without alteration; SHA-256 remains `89bd614656667f1178603afa3a23debc5a4e96fe61ccfbb957d7ef27cbf76658`.

GPU geometry/shaders, accessible DOM content, canonical resources/events, coordinator, native adapter, and verification are separate. There is no backend lock-in in the scene. A real Codex path, complete application architecture, production security review, detached displays, and owner artistic acceptance remain outside this experiment's demonstrated scope.
