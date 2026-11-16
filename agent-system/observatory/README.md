# Phase E: Aetherwake Engineering Observatory

A deliberately custom, dark engineering-control interface for **engineering Tasks**, not the one-time set of eleven implementation missions. This is an isolated observability and task intake surface; it never overrides Vela MissionService, governance, agent scheduling, review approval, or PR merge authority.

## Run

From a checked-out repository with Node.js 20+:

```sh
cd agent-system/observatory
npm install
npm run build
npm start
```

For React development, run `npm run dev` in a second terminal while the API server is running. Vite proxies `/api` to port 4178. The production server serves only built `dist/` assets; there is no CDN dependency.

Open `http://127.0.0.1:4178`. Optional: `PORT=4179` and `AETHERWAKE_OBSERVATORY_DATA_DIR=/private/local/path`. Server binds **only** to loopback, rejects non-local Host headers, sets a restrictive CSP, and has no external CDN dependencies or telemetry upload. Do **not** expose or proxy this server publicly without separate authentication and authorization work.

## Data + integration

- Reads valid v1 `Task`, `Attempt`, `Evidence`, `Telemetry`, `ContextSnapshot`, `VerificationProfile` records from `agent-system/records/`, `agent-system/observatory/records/` if present and private local state at `~/.aetherwake/engineering-observatory/` by default.
- Other workstreams can write contract-compliant JSON records to these locations; the UI derives task details, attempt histories, dependency links, evidence, telemetry and status from the records. Schema field names follow `agent-system/contracts/v1.schema.json`.
- The task intake form creates a **proposed** v1 Task with objectives, primary class, prerequisites, profile, and acceptance criteria. POST is local only; new records are stored outside the public repository by default. A new task does not automatically execute or imply approval.
- Live mode never substitutes fake numbers for absent data. Demo mode is isolated and prominently labeled simulated; its example records do not write to the repository or become actual evidence.
- No claim to actual token/weekly quota usage is made unless a record contains a supported observed measurement. Missing data remains unavailable.
- PR merge is not Task acceptance. Owner acceptance remains independent.

## API

`GET /api/overview` returns revision, provenance, and normalized v1 records.
`POST /api/tasks` accepts JSON: `{title, objective, primary, profile_id, dependencies: [], capabilities: [], criteria: ["..."]}`.

## Phase E boundary

This PR owns `agent-system/observatory/` only. Phases B/C/D can integrate via the shared records. Future work can add authenticated remote access, a server-side task event store, reconciliation and streaming as separate reviewed changes. This prototype is intended for single-user local development, not a hardened multi-user control plane.

## Verification

From `agent-system/observatory/`, run `npm test` and `npm run build` with Node.js 20+ after installing dependencies. Tests cover task intake constraints, bounded demo fixtures, read-only overview, content-type rejection, and foreign-origin denial. The server remains a local-only prototype and does not provide authenticated multi-user access.

## Motion system

The React interface uses Motion for deliberate page enter/exit, navigation selection, detail inspections, card reveal, chart drawing, status progress, list rearrangement and button feedback. Ambient machinery atmosphere is composed of low-opacity CSS haze and grid motion plus a throttled 30 FPS Canvas particle/spark layer, with capped device pixel ratio, visibility-aware drawing, and `prefers-reduced-motion` support. Avoid unnecessary continuously animated React component state. The production bundle is self-hosted.
