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

- Sites enforces who may visit. The Worker requires Sites-injected visitor identity for API requests and scopes every D1 read/write to that identity. POST requires an exact same-origin request and JSON. Task intake inserts proposed, unreviewed v1 tasks. The form defaults to private. Selecting Public GitHub proposal requests publication of its v1 JSON to [Proposed Tasks](https://github.com/Kgray44/Aetherwake/tree/observatory-proposed-tasks/Proposed%20Tasks) on the dedicated intake branch. Configure a repository-scoped Sites secret `GITHUB_PROPOSAL_TOKEN` with Contents write and Issues, Pull requests, and Actions read permissions. GitHub reads can reuse that credential unless a separate `GITHUB_READ_TOKEN` is set. The app writes only new proposal files on that branch. Failed writes are visible as pending and can be retried from the task detail. Loopback, isolated verification and sanitized telemetry never use the public publication path.
- A private proposal can use a previously observed GitHub main revision during a rate limit or refresh failure. The proposal records that provenance through reload. A new public proposal requires a current snapshot. An initial outage with no known revision blocks both forms of intake.
- GitHub reads are server-side, anonymous by default and limited to `Kgray44/Aetherwake`. Both documented record paths are read at the resolved `refs/heads/main` SHA. At most six directory listings, twelve JSON files and 750 valid records are projected. Results expose pinned file paths and blob SHAs, omitted or unavailable paths, and truncation. Issues, pull requests and main CI show a bounded activity window independently of the v1 records. GitHub failures can affect sources independently. Intake requires a resolved main SHA. Workers share a 15-minute D1 cache, preserve the last successful result per source during outages, and honor GitHub’s retry headers. Optionally set the server-side Sites secret `GITHUB_READ_TOKEN` to a fine-grained credential for this repository with read-only Contents, Issues, Pull requests and Actions access. The token stays in the Worker and requests never follow redirects.
- D1 holds up to 500 proposals per owner and namespace. Use `?verification=<random-uuid-v4>` to run a hosted create-and-reload check in an isolated namespace. The private API takes this value via `x-observatory-verification`. Remove the query parameter to return to the normal registry. No local records or credentials should be copied into the Site build or its source history.
- The hosted Worker does not run agents, invoke approval, change GitHub, or integrate with Vela MissionService. Actual usage is unavailable unless supplied by a contract-backed measurement. GitHub check conclusions and merge state carry no task acceptance.

## Motion system

The React interface uses Motion for deliberate page enter/exit, navigation selection, detail inspections, card reveal, chart drawing, status progress, list rearrangement and button feedback. Ambient machinery atmosphere is composed of low-opacity CSS haze and grid motion plus a throttled 30 FPS Canvas particle/spark layer, with capped device pixel ratio, visibility-aware drawing, and `prefers-reduced-motion` support. Avoid unnecessary continuously animated React component state. The production bundle is self-hosted.


## Private execution projection (AADS integration)

The canonical execution Task remains the explicitly authorized local contract record. The hosted D1 proposals are intake only; importing a matching local record projects its state without authorizing execution. `/api/sync` is a signed-in, same-origin JSON POST, limited to 1 MiB, 750 records and 2,000 trace events. The server validates v1 records and the separately versioned trace contract, re-sanitizes through `scripts/agent/telemetry-export.mjs`, and atomically stores one bounded snapshot per owner/verification namespace. Repeating the same snapshot is idempotent; older or equal-time conflicting snapshots are rejected. Human acceptance claims are rejected. Evidence display is a claim, not an authenticated acceptance receipt.

Generate a private snapshot from the repository root with the explicit canonical Task and Phase C journal directory:

```sh
node scripts/agent/export-journal.mjs --task /private/task.json --journal /private/events.jsonl.journal > /private/projection.json
```

Check the command succeeded, then use **Import sanitized export** in the existing Site. The CLI uses only the supplied local files and writes the complete sanitized JSON to stdout. It keeps the latest canonical Attempt snapshot for each ID and preserves incomplete spans. Use a journal for this Task alone. An unrelated record, conflicting identity or projection over the Sites limits fails with no JSON output. Import replaces the selected namespace's current snapshot, so use an isolated verification namespace when checking a snapshot without replacing live data. Do not upload raw journals. Source text, prompts, command arguments, outputs and artifact paths stay local. The UI shows the last imported time, trace events and measurement availability, source, method and coverage. A missing metric is not zero. This is an explicit snapshot synchronization path, not continuous unattended synchronization. A supported machine identity/delegation path has not yet been verified; no sign-in bypass token or new credential is introduced to imply otherwise. Local append-only history remains authoritative; replacing the bounded projection does not erase that history.

Validation of a hosted deployment, owner login, non-owner denial, and real upload/reload must be recorded independently from Worker unit tests. The existing Site must be updated only by its current deployment owner. No second Site is necessary.

### Supported unattended transport: Site MCP

The Worker also implements stateless JSON-RPC `POST /mcp` (MCP 2026-07-28 discovery) with only `project_execution_snapshot` and `read_execution_projection`. Both require a real platform-injected Site-scoped caller identity. The import tool reuses the same bounded schema/sanitizer and private owner/namespace store; readback includes a SHA-256 receipt of the stored sanitized snapshot. Supplied owner IDs, execution tools, arbitrary SQL and approval actions are not supported. Browser cross-origin requests are rejected. Service-only access without visitor identity is rejected rather than translated into a fabricated owner.

To activate on the **existing** private Site, its publication owner must add `mcp` to the private checkout's `.openai/hosting.json` capabilities, retain project identity/access policy, build and publish the reviewed source once, then request `get_site(include_mcp_connection:true)`. Sites provisions a private plugin; if unavailable, the returned plugin ID can be offered through the supported Install/Connect flow. Owner action may be needed for that connection. No credentials are stored in repository instructions or exporter output, and no bypass token is created/rotated.

After connection, the authorized engineering agent can reconstruct and sanitize its private producer journal at task checkpoints, invoke the import tool in an isolated verification namespace, and compare its returned digest with the readback receipt before enabling routine live updates. Verify a fresh cloud task can access both the source journal and plugin independently. Site access alone cannot read a disconnected workstation. The snapshot tool does not authorize Tasks or move canonical state to D1. Do not claim automatic synchronization operational until this real unattended write/readback succeeds. The local MCP tests demonstrate protocol and isolation only; no connection or publication is implied.

Projection admission rejects generation timestamps more than five minutes ahead of the Worker clock. A caller can keep at most eight verification namespaces plus its live projection; quota enforcement occurs inside the atomic SQLite insert, so concurrent first imports cannot exceed it. Existing namespaces remain updateable at quota. Reuse a verification namespace rather than generating one for every refresh. Each projection is bounded to 1 MiB at ingress; no raw-history accumulation occurs in D1. No automatic deletion of owner records is introduced.

Evidence presentation is deliberately non-authoritative: a reported passing result, even with `synthetic: false`, matching revision and linked attempt, is **reported pass unverified**, never criterion acceptance. Missing or inconsistent attempt linkage displays **unverified missing attempt**. Partial projections remain admitted so bounded snapshots do not silently discard useful claims. Neither schema validity, linkage, a digest receipt nor a Site login authenticates the underlying evidence or an owner decision. Canonical task state is not rewritten by this display classification.
