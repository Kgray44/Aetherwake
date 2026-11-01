# Aerynth Electron visual lab

An isolated Electron candidate for the Liquid Intelligence desktop experience. This is a local visual and interaction prototype, not a product shell or a choice of final framework. Every conversation, agent state, and Intelligence Stream event in the app is synthetic.

## Run

Requires Node.js 24+, npm, Windows 10/11 or another desktop platform supported by the pinned Electron package, and a graphical session.

```powershell
cd prototypes/visual-experience/electron
npm ci
npm start
```

`npm start` regenerates fixture data, builds the Vite renderer and TypeScript main/preload, then launches Electron. `npm test` checks deterministic fixture integrity; `npm run typecheck` checks both process boundaries. `npm run benchmark` launches a bounded native benchmark, saves a local JSON report under `evidence/benchmark-local.json`, captures native screenshots, and exits. The JSON is ignored by Git because it contains local process and device details; summarized, non-identifying results appear in `EVALUATION.md`.

For the coordinated release-build comparison, use `npm run package:release` and [COMPARISON-CONTROL.md](COMPARISON-CONTROL.md). The opt-in mailbox records reproducible action and frame traces in a local ignored directory; it is distinct from the exploratory `--benchmark` mode.

The app uses only local `file://` content. Its own window state and Chromium profile live in `.runtime/` inside this lab and are ignored by Git. No external service or Codex agent is connected.

## Interact

- Drag a block header to rearrange; arrow controls provide a keyboard-operable alternative.
- Expand/collapse a block with the diagonal-arrow control or Escape when expanded. The same DOM resource view moves between grid and focus positions, and a new gesture can cancel an active transition.
- Detach a block with the overlapping-window control. The secondary window is a native, frameless transparent Electron window with a draggable title area.
- Scroll/select conversation messages, run reproducible event bursts, edit a local note, select resources, and check tasks.
- Choose Vela's four fixture states, graphics quality, and reduced motion. The benchmark control is available in the app, but saving a report is enabled only in `--benchmark` mode.

The official Aerynth master mark is copied byte-for-byte from `assets/brand/aerynth-mark-master.png`; its SHA-256 remains `89bd614656667f1178603afa3a23debc5a4e96fe61ccfbb957d7ef27cbf76658`. This lab does not regenerate or edit it.

## Architecture

| Concern | Implementation |
|---|---|
| Desktop host | `src-electron/main.ts`; main-window bounds, detached windows, permission denial, local-content navigation guard, environment capture |
| Renderer boundary | `src-electron/preload.ts`; six named methods with no raw IPC or Node bridge |
| Interface | React + TypeScript in `src/App.tsx`; 12 typed block identities, local interaction state, virtualized chat |
| Motion | `src/motion.ts` coordinates transition IDs, interruption, and quality policy for Web Animations; `src/atmosphere.ts` owns one canvas loop for 200 particles and eight filaments |
| Performance | `src/benchmark.ts` records requestAnimationFrame intervals; quality and document visibility change canvas cadence |
| Fixtures | `scripts/generate-fixtures.mjs` creates a deterministic seed-20261101 fixture of 2,000 messages and 1,000 timestamped events |

React was chosen for comparable component behavior and ordinary text/input handling. A single 2D canvas supplies ambient depth without 200 per-particle React updates. DOM text stays selectable, and block surfaces use CSS layered backgrounds and restrained blur. This is a candidate design to measure, not a final renderer decision.

See [EVALUATION.md](EVALUATION.md) for measurements, source status, and remaining gaps.
