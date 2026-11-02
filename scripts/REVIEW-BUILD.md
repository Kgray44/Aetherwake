# Offline portable review packaging

This builder uses the existing locked Electron 45.2.1 runtime, current Node 24.18+
binary and licenses, current built renderer, and actual canonical application
sources. It performs no npm install, download, build, native launch, provider call,
profile seeding, or account migration.

Run an allocation-only plan from the clean final source checkout:

```powershell
node scripts/review-build.mjs --plan --output=C:\PrivateReviewBuilds\Aerynth-review-new --archive
```

`--source=<absolute repository root>` is optional. Output must be an explicit new
absolute private path on C: or D:, outside the checkout and runtime inputs. The
directory, ZIP, partial ZIP and checksum paths must all be absent. Planning reads
file stats, traces Node runtime imports without executing them, checks runtime
versions/licenses, and invokes the actual host ReserveGuard. It writes no output.
The plan reports the actual clean HEAD/tree and conservative allocation, including
the complete directory and optional stored ZIP, with a hard 1 GiB combined ceiling.
Unknown sizes, external runtime dependencies and excessive allocation fail closed.

After reviewing that concrete plan, the parent may separately run the same command
with `--build` instead of `--plan`. The builder recomputes the plan, checks clean
HEAD/tree, reruns ReserveGuard before writes and archive creation, and rechecks
during long work at four-minute intervals. The Node copy loop cannot write beyond
an input's planned size. Inputs changing during copy fail without a completion
manifest. Outputs are exclusive and partial state is retained; there is no recursive
cleanup or overwrite. Node streams verify each copied file's SHA256. A stored ZIP
uses the existing system `tar.exe` and no temporary compression copy, then verifies
its exact inventory and writes its SHA256. No archive operation is run by `--plan`.

The directory keeps Electron's runtime layout. Its generated `resources/app`
bootstrap sets `AERYNTH_NODE_BIN` to `vendor/node.exe` and requires the unchanged real
desktop entry under `resources/app/prototypes/visual-experience/cinematic-v3/native`.
The parent's trusted `backendExecutable(process.env.AERYNTH_NODE_BIN)` seam is
required; the builder does not patch the host. Backend/kernel/graph/Vela/Library
relative imports, worker source and migrations retain their actual directory layout.
The normal host continues to own native consent, provider identity and private data.

`Launch-Aerynth.cmd` opens the prepared application directly without npm. A default
candidate-specific private profile is created by the actual host outside the app;
no database/profile is shipped. Integration, auto-consent test, resume, recording and
soak flags are rejected. Historical evidence, verification helpers, synthetic setup,
private/runtime data and development dependency trees are excluded. Dormant fixture
port code inside the unchanged canonical provider module is not a seeded setup or
an alternative startup provider. The Node/Electron/Chromium/Three licenses are kept.
Assets are copied without transformation; dist assets also present in tracked
`public/` must match the original byte hash. Historical visual evidence assets are
not copied or modified.

An existing `%LOCALAPPDATA%\AeroStorageWatch\ReserveGuard.ps1` is an explicit review
host prerequisite; its private source is not bundled and there is no bypass. Codex
is separately installed and optional for local work. No Codex account, instructions,
configuration or executable is bundled. Each target host still needs the supported
storage guard and separate 30 GiB free reserves on C: and D:. Monitoring is not an
OS quota and cannot control unrelated writers.

`manifest.json` and `manifest.sha256` bind candidate HEAD/tree, runtime versions,
every shipped byte, source hashes, dist assets, original-asset preservation and
licenses. They contain no absolute source/profile paths or live free-byte telemetry.
They prove packaged bytes, not that an existing dist was compiled from that source,
publisher authenticity, native behavior, security/artistic acceptance, or performance.
The parent must bind its final build/native receipts separately. This is a portable
review directory/ZIP, not an MSI, signed Aerynth release or production delivery.

Focused checks: `node --test scripts/review-build.test.mjs`. These use tiny temporary
source fixtures and never copy/package Electron, run an archive, open an app, or call
a provider. A successful `--plan` is not an executed package or launch test.
