# FI-6 mounted read-only inspection increment

Program B, STANDARD_AUTONOMOUS, product-phase. **One continuous spatial universe.
No disconnected screen changes.** This is an additive inspection disclosure within
the existing GPU-backed mission workroom, not full six-region spatial art acceptance.

## Recovery and base

Recovered only FI-6 artifacts from Library archive
`libfile_8847bf036dcc8191b05c1a8a5383dfc2`. Patch SHA256:
`05d6f0b6369c84e7f02bad91df5a92da5e7a4b77902e9deda0f4d18809d332cd`;
bundle SHA256:
`6ab4851ce3f5b8480c10d39151c676b03a99786bd24d8dcb2e98483ff96ec630`.
Both matched. Restored foundation commit `640cadbd0497d34eb48f79dd34a78519a4c63c9a`.
Verified origin/main remains `c470a5d23786ea2d5022553a1472e3643a619bb1`.
No FI-4 payload applied and no FI-2/CIE/AEP/provider or source-owner changes made.
No repository .agents/skills or nested AGENTS.md found. Existing guidance and
Spatial/FI governance from foundation remain applicable; routing rerun for the
mounted read-only path and keyboard/focus/provenance scope. AW-EXP-202–204,
AW-OBS-160–169 and AW-QVA-209 retain authority. No native Goal interface exposed.

## Changes and exact integration seam

- `prototypes/visual-experience/cinematic-v3/src/adaptive-workspace-view.ts` mounts
  a native details/summary disclosure with six ARIA tabs and a labeled tabpanel.
  Arrow keys, Home/End and pointer navigation reach identical source projections;
  Escape closes and restores summary focus. Tab nodes remain stable on refresh.
  Navigation keys do not bubble into spatial workspace navigation. No animation
  is required, so the inspection is equally usable in reduced-motion mode.
- `src/mission-workroom-view.ts` mounts the disclosure in its existing section,
  alongside the canonical mission flow. It consumes the **same already-read**
  authorized `MissionProjection` after existing identity/revision/generation
  checks in `readFlow`; no new API or provider call. Application already supplies
  the host's `missions/read` API through `options.readMission`.
- Scope comes from that authorized canonical mission, including origin workspace
  and project (a workroom placement may have a different workspace). It is not
  derived from UI-selected labels. The original expected mission ID is preserved.
- Inspection readings clear before refresh, access revalidation, inactivity,
  visibility loss and scope exit; existing read epochs reject late responses.
  Scope/access changes close the disclosure. Same-scope refresh preserves region
  choice and DOM tab identity. Opening/closing never disposes or changes the
  existing flow, its selected task, or the host's camera/focus state.
- Missing readings show Unavailable, classifications and source IDs/timestamps
  are text, and status explicitly says recorded snapshot, not live telemetry.
  Learning and experiment sources remain explicitly unavailable, with no invented
  FI-5 schema, history or write controls. No hidden reasoning shown.
- `tests/mission-workroom-view.test.mjs` adds two integration tests using explicitly
  synthetic fixtures. Existing adapter tests remain unchanged.

## Final checks

Node 24.22.1; installed locked cinematic-v3 dependencies with scripts disabled.

Passed (15 tests, zero failures):

```sh
node --experimental-strip-types --test prototypes/visual-experience/cinematic-v3/tests/adaptive-workspace.test.mjs prototypes/visual-experience/cinematic-v3/tests/mission-workroom-view.test.mjs
```

Includes existing Flow/forensic/compact/evidence/access behavior plus six mounted
tabs, repeated open/close, keyboard and focus return, explicit learning/experiment
missingness, source simulation labels, stable selected task and inspector identity,
refresh, immediate revocation clearing and interrupted scope reads.

Passed from cinematic-v3 (final source):

```sh
./node_modules/.bin/tsc --noEmit --strict --skipLibCheck --allowImportingTsExtensions --target ES2023 --module ESNext --moduleResolution Bundler src/adaptive-workspace-view.ts src/mission-workroom-view.ts
```

An initial invocation from repository root failed because Node type declarations
were resolved from the wrong working directory; the corrected affected-file
check above passed. `git diff --check` passed. Full app build/typecheck and broad
suite were not rerun; foundation records sibling dependency limitations.

Browser attempt **blocked**, not passed: temporary labeled synthetic workroom
fixture served with Vite on loopback, but supported cloud browser returned
`net::ERR_CONNECTION_REFUSED`. Wildcard host also failed OS network-interface
enumeration; loopback server started, with an unrelated pdfjs dependency-scan
warning. No screenshot or real-native claim. Fixture removed and server stopped.

## Remaining qualification and integration

- Cloud: browser visual/accessibility inspection in a browser sharing the executor
  network; richer six-zone spatial mounting and live authorized AEP/ARIE/FI-5
  source adapters remain future scoped work. This disclosure does not replace the
  full spatial AIW or qualify FI-ACC-37–46. No styling, camera or GPU renderer changes.
- Local Windows/GPU: packaged real mission read, repeated journeys and focus
  across real workspace/project changes, keyboard/screen-reader and reduced-motion
  parity, context-loss and multi-display behavior; moving-camera continuity and
  frame-time/resource interference measurement on target hardware.
- Owner-only: artistic acceptance against the approved reference.
- Apply the combined recovery patch onto `c470a5d2` or fetch the bundle and
  cherry-pick foundation then mounted increment. Do not apply both combined patch
  and commits. Coordinate future renderer changes with Program A.
- No merge, publication, deployment, permission change, policy mutation or model
  API call. Only private Library preservation is requested for recovery.
