# Aerynth Liquid Intelligence · Tauri visual lab

This is a local, synthetic candidate for Aerynth's desktop visual foundation. It is an interactive prototype, not a product integration or a decision to adopt Tauri. Nothing in the conversation or activity stream connects to Codex or represents real agent work.

## Run on Windows

Prerequisites: Node.js 20+, npm, Rust stable with the `x86_64-pc-windows-msvc` target, Visual Studio C++ Build Tools, and Microsoft Edge WebView2 Runtime. From this directory:

```powershell
npm ci --no-audit --no-fund
npm test
npm run desktop:dev
```

`npm run desktop:build` compiles a release executable at `src-tauri/target/release/aerynth_visual_lab.exe`. The Tauri configuration intentionally has `bundle.active: false`; this produces an executable, not an installer. `npm run build` runs TypeScript validation and creates the bundled frontend. Start the release executable directly to inspect the native build.

The official mark is read from `../../../assets/brand/aerynth-mark-master.png` through Vite's `publicDir`. The source asset remains in its established repository location. Fonts are bundled locally. No network service or credential is needed at runtime.

## Walk through the pilot

- The main window opens the home scene, Vela presence, living workspace, conversation, and performance lab. The separate Intelligence Stream window opens at startup. Close it and use **Stream** or **Open activity window** to reopen it.
- Switch Vela between Idle, Working, Attention required, and Unavailable. These are developer controlled simulated states.
- Select a workspace card, drag it to another slot, or use **Alt + arrow** to move the selected card. **Widen/Compact**, **Collapse/Expand**, **Focus**, **Escape**, and **Detach** exercise spatial transitions. Stable resource IDs and layout choices persist in local storage. Detached block windows can be closed independently.
- Scroll and select from 2,000 virtualized conversation messages or 1,000 virtualized stream events. **Play reproducible burst** replays a deterministic visual sequence without changing fixture history.
- In **Mode**, choose Cinematic, Balanced, or Efficient, turn on reduced motion, run the bounded four-scenario benchmark, and export its renderer measurements. Efficient is the advanced-effects fallback.

## Architecture

`src/fixtures.ts` generates the six deterministic fixture families from seed `20261101`. `src/main.ts` owns ordinary interface state and window actions. `src/motion.ts` coordinates six domains: spatial transitions, material treatment, atmospheric canvas, semantic Vela state, interaction response, and performance scheduling. High-frequency canvas drawing uses a dedicated `requestAnimationFrame` loop; it does not rebuild the DOM each frame. CSS handles compositor-friendly transitions, with an explicit reduced-motion path. Vite packages the approved mark and local font files. `src-tauri/` owns the two native startup windows and narrow window permissions.

The benchmark measures callback intervals in the renderer. Its missed-frame count is an **estimate** against each tier's nominal interval, not a count of GPU presents. `scripts/observe-process.ps1` provides a separate, bounded Windows process sampler. Example:

```powershell
./scripts/observe-process.ps1 -ProcessId 12345 -Seconds 8 -IntervalMs 500 -OutFile ./evidence/process-sample.json
```

The sampler is limited to 1–60 seconds and 250–2,000 ms intervals. Its CPU percentage is one-core normalized for the host process only; WebView2 child processes are outside that metric. The evaluation explains the measurements and gaps.

## Review notes

Read [EVALUATION.md](EVALUATION.md) for native screenshots, test results, hardware context, measured values, limits, and recommended next work. This prototype stays inside its owned directory; it does not alter shared Aetherwake source or governance.
