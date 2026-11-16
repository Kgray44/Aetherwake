# Phase E: Aetherwake Engineering Observatory

A deliberately custom, dark engineering-control interface for **engineering Tasks**, not the one-time set of eleven implementation missions. This is an isolated observability and task intake surface; it never overrides Vela MissionService, governance, agent scheduling, review approval, or PR merge authority.

## Run

From a checked-out repository with Node.js 20.19+ or 22.12+:

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
- The task intake form creates a **proposed** v1 Task with objectives, primary class, prerequisites, profile, and acceptance criteria. The loopback server stores new records outside the public repository by default. A new task does not automatically execute or imply approval.
- Live mode never substitutes fake numbers for absent data. Demo mode is isolated and prominently labeled simulated; its example records do not write to the repository or become actual evidence.
- No claim to actual token/weekly quota usage is made unless a record contains a supported observed measurement. Missing data remains unavailable.
- PR merge is not Task acceptance. Owner acceptance remains independent.

## API

`GET /api/overview` returns revision, provenance, and normalized v1 records.
`POST /api/tasks` accepts JSON: `{title, objective, primary, profile_id, dependencies: [], capabilities: [], criteria: ["..."]}`.

## Owner-private ChatGPT Site

Use Node.js 22.12+ for the hosted build and checks:

```sh
npm ci
npm test
npm run test:sites
npm run build:sites
```

The Worker build uses the same Vite UI and shared intake code. It produces `dist/server/index.js` and schema-only D1 migration metadata beneath `dist/.openai/drizzle/`. For a separate Sites source checkout, keep this directory at `agent-system/observatory/` and include the checked-in `agent-system/contracts/v1.schema.json`. Add the Sites-assigned project ID only in the private checkout's `.openai/hosting.json`, declare `"d1": "DB"` and `"r2": null`, and omit `static`. Build there with `OBSERVATORY_SOURCE_REVISION` set to the exact reviewed GitHub commit and pass the private checkout's absolute `dist` path to `npm run build:sites -- /absolute/path/to/dist`. Publish using the Sites source/version workflow with owner-only access. Hosted D1 is separate from the loopback files.

- Sites enforces who may visit. The Worker requires Sites-injected visitor identity for API requests and scopes every D1 read/write to that identity. POST requires an exact same-origin request and JSON. Task intake can only insert proposed, unreviewed v1 tasks.
- GitHub reads are server-side, anonymous by default and limited to `Kgray44/Aetherwake`. Both documented record paths are read at the resolved `refs/heads/main` SHA. At most six directory listings, twelve JSON files and 750 valid records are projected. Results expose pinned file paths and blob SHAs, omitted or unavailable paths, and truncation. Issues, pull requests and main CI show a bounded activity window independently of the v1 records. GitHub failures can affect sources independently. Intake requires a resolved main SHA. Workers share a 15-minute D1 cache, preserve the last successful result per source during outages, and honor GitHub’s retry headers. Optionally set the server-side Sites secret `GITHUB_READ_TOKEN` to a fine-grained credential for this repository with read-only Contents, Issues, Pull requests and Actions access. The token stays in the Worker and requests never follow redirects.
- D1 holds up to 500 proposals per owner and namespace. Use `?verification=<random-uuid-v4>` to run a hosted create-and-reload check in an isolated namespace. The private API takes this value via `x-observatory-verification`. Remove the query parameter to return to the normal registry. No local records or credentials should be copied into the Site build or its source history.
- The hosted Worker does not run agents, invoke approval, change GitHub, or integrate with Vela MissionService. Actual usage is unavailable unless supplied by a contract-backed measurement. GitHub check conclusions and merge state carry no task acceptance.

## Motion system

The React interface uses Motion for deliberate page enter/exit, navigation selection, detail inspections, card reveal, chart drawing, status progress, list rearrangement and button feedback. Ambient machinery atmosphere is composed of low-opacity CSS haze and grid motion plus a throttled 30 FPS Canvas particle/spark layer, with capped device pixel ratio, visibility-aware drawing, and `prefers-reduced-motion` support. Avoid unnecessary continuously animated React component state. The production bundle is self-hosted.
