# Phase E: Aetherwake Engineering Observatory

A deliberately custom, dark engineering-control interface for **engineering Tasks**, not the one-time set of eleven implementation missions. This is an isolated observability and task intake surface; it never overrides Vela MissionService, governance, agent scheduling, review approval, or PR merge authority.

## Task Control Center

Open #tasks to search, filter, sort, and group the Task feed. Task links
preserve their IDs through reload. An actionable private proposal opens its
editor and change history. Imported and local execution records display the
authority available from their source.

The inspector shows direct prerequisites and dependents, recorded attempts,
evidence, and the Task execution timeline. Missing prerequisites are unverified.
An accepted upstream Task satisfies the displayed dependency check. Execution
admission remains with the source owner. Versioned editing preserves a draft
through an incoming update and requires loading the latest version before saving.

Visible Task routes refresh through the existing overview feed every 30 seconds.
The Worker’s GitHub cache and rate-limit backoff govern upstream reads.

From this directory, run npm run test:workspace:e2e after installing a
Playwright Chromium browser. Set OBSERVATORY_BROWSER_EXECUTABLE to use an
existing Chromium executable. The test uses built assets, real Worker handlers,
an isolated SQLite database, and fixture GitHub responses.

When the Task Engine API is available, private intake registers Tasks through
it. Execution controls read the stored lifecycle separately from computed
readiness and record owner actions using the current Task version. A scheduled
start is submitted in UTC from the operator’s local time. Opening a control
confers no authority. The Worker authorizes each action. Evidence links are
revision-pinned, and per-attempt token accounting preserves observed coverage
and unavailable values from the analytics projection.

Set OBSERVATORY_ENGINE_E2E=1 on a combined checkout with Milestone B’s Worker
to run the canonical schedule and queue-control browser scenario.

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
- GitHub reads are server-side and limited to `Kgray44/Aetherwake`. A Site that has used a configured credential keeps its cached data and reports degraded authentication if that credential is rejected or disappears. Both documented record paths are read at the resolved `refs/heads/main` SHA. At most six directory listings, twelve JSON files and 750 valid records are projected. Results expose pinned file paths and blob SHAs, omitted or unavailable paths, and truncation. Issues, pull requests and main CI show a bounded activity window independently of the v1 records. GitHub failures can affect sources independently. Intake requires a resolved main SHA. Workers share a 15-minute D1 cache, preserve the last successful result per source during outages, and honor GitHubÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¾ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢s retry headers. Optionally set the server-side Sites secret `GITHUB_READ_TOKEN` to a fine-grained credential for this repository with read-only Contents, Issues, Pull requests and Actions access. The token stays in the Worker and requests never follow redirects.
- D1 holds up to 500 proposals per owner and namespace. Use `?verification=<random-uuid-v4>` to run a hosted create-and-reload check in an isolated namespace. The private API takes this value via `x-observatory-verification`. Remove the query parameter to return to the normal registry. No local records or credentials should be copied into the Site build or its source history.
- The hosted Worker holds engineering Task state and supplies leases to configured executors. Execution runs on a separate Codex worker host. Vela product missions retain their own MissionService. The GitHub write surfaces are create-only proposal publication and the CI controls below. Actual usage is unavailable unless supplied by a contract-backed measurement. GitHub check conclusions and merge state carry no task acceptance.

Pull requests and CI runs have dedicated routeable lists, newest-created ordering, and detail views. The home feed previews the five latest entries from each loaded window. Details are fetched on demand and link to GitHub for full source and logs.

Open a failed CI run or a Task with failed attempts to investigate. CI history compares
completed runs with the same workflow ID, trigger, and branch from the loaded GitHub
window. The investigation fetches exact run-attempt job details and exact-head PR
changed paths on demand. Job names must be unique and the job lists complete enough
to compare. GitHub head metadata is distinct from the commit checked out by test steps.
Task investigations bind trace, evidence, and measurements to the Task, Attempt, and
revision. Prior passing measurements are shown only when unit, source, method, and
phase agree. Shared revisions are displayed separately from explicit evidence links.
The investigation suggests a diagnostic check and shows missing or cached evidence.

### Canonical Task execution API

The hosted Site and Codex MCP tool operate on the same owner-scoped records in the Observatory database. Existing Site proposals retain their IDs. An engine operation advances the existing row and writes its audit event in the same database transaction. Published proposals remain reviewable through the existing GitHub intake workflow. Explicit owner admission activates the same Task ID in the private engine and preserves the published intake snapshot.

| Interface | Request |
| --- | --- |
| Site | POST /api/task-engine/v1 with same-origin JSON |
| Codex or supported agent | MCP tool task_engine_v1 with a request object and optional verification UUID |
| Configured executor | The same MCP tool with a worker credential and lease-specific operations |

The [v1 request and response schema](../contracts/task-engine-v1.schema.json) defines list, get, register, command, claim, report and worker pulse. List returns lightweight Task summaries, with optional lifecycle-state filtering. Detail includes the v1 Task, optimistic version, priority, authoritative lifecycle, attempts and ordered audit events. The lifecycle includes the stored phase and current readiness with reasons. The v1 overview projects compatible Task and Attempt records for existing clients. Imported telemetry cannot replace an engine-owned Task or Attempt.

The owner can edit an admitted specification before claim or stage a revision for the next attempt while work is running or a candidate is under review. Edits use an expected Task version and record the before and after specification in the audit. The attempt records its claimed specification version and keeps its revision and review criteria. Admitted prerequisites and capability attestations are part of admission. Completed Tasks require a reopen and a new review cycle for material changes.

An owner addendum targets an exact running attempt or the next claim. A supported App Server worker reserves pending addenda at the first completed turn boundary and starts one follow-up turn on that same persisted thread before candidate submission. The accepted timestamp records intake. Delivery records the App Server turn ID and acknowledgment records that turn's completion. If the boundary is missed or the lease ends before delivery is confirmed, the Task shows the deferral. An ambiguous provider outcome is never blindly resubmitted by another attempt.

When a worker submits a partial implementation for verification, the owner can choose **Continue from candidate** and describe the remaining work. The submitted attempt becomes a checkpoint in Task history. The same Task starts a bounded execution cycle from the exact candidate commit and retained Codex conversation. This requires a continuation-capable worker and the original clean checkout. Full acceptance criteria still apply to the next candidate.

If a worker loses its final report after saving a complete candidate, a restarted App Server worker can return that exact revision for verification within 24 hours of orphaning. It verifies the original checkout, revision ancestry, branch and clean working tree. The candidate recovery key is bound to the original attempt at claim time and stored only in the worker marker. A separate fenced operation records the interruption and recovered revision in the same Task audit. The owner still reviews the result.

The attempt view pairs a sanitized failure explanation with a category when the worker or scheduler knows the cause. Lease expiry, an execution time limit, worker and provider interruption, storage and checkout trouble, Git failure, and candidate verification have distinct categories. A worker can explicitly report implementation failure when it has evidence.

Registration takes an operation UUID and the existing intake fields and resolves the current or last known GitHub revision from the shared cache. Commands take a Task ID, operation UUID, expected version and typed action. Replaying the same operation uses its receipt. Use a fresh UUID after changing an operation or resolving a version conflict. Owner decisions are recorded separately from ordinary agent edits and artifact associations. Provide revision-pinned links for branches, commits, reviews, PRs, CI runs, test results, artifacts and investigations. Each attempt carries the stable Task ID, a distinct attempt ID and an immutable execution revision for telemetry. Candidate readback records the resulting commit separately as candidate_revision. A reported Codex session ID identifies the provider checkpoint for that attempt.

The owner explicitly admits a Task for Codex execution and can set a future start, attest declared capability prerequisites and choose cancellation propagation. The scheduler orders eligible tasks by priority and creation time and allows up to four active leases per owner and namespace. A prerequisite is satisfied after its engine-recorded reviewed completion. Eligibility is recomputed from the persisted dependency graph on read and claim. The worker claims periodically without polling GitHub. Lost leases produce orphaned attempts. For a failed Task, the authenticated owner can use Retry with the current Task version and a changed assumption. The next claim carries that diagnosis and uses the persisted Codex session when a compatible worker can reuse the pinned checkout. Resume is reserved for paused Tasks. Pause or cancel requests wait for the executor to confirm it stopped.

The worker waits three seconds between idle poll cycles, plus storage-check and transport time. Storage denial, unavailable reserve data and a timed-out guard are distinct observations. Telemetry recovery uses a separate connection and does not delay the next claim poll. The owner sees current slot use and recent worker pulses, filtered by the selected Task's scope and continuation requirements. A stale pulse means no recent verified contact. The pulse is an observation and carries no dispatch or acceptance authority.

The worker opens the report connection before claiming and keeps it separate from dispatch, telemetry and provider turns. Each report has a five-second request budget within the existing lease. A transient failure replays the same operation ID with bounded backoff. The worker schedules retries against a monotonic estimate of the reported lease deadline, and the Task Engine remains authoritative on lease validity. A missing tool reply releases just that request. Lost control ultimately interrupts the provider turn if renewal cannot be confirmed safely.

A worker exit requests verification. Acceptance requires the configured owner's review decision and a reference for each criterion at the candidate revision. The references record what the owner reviewed. The engine does not automatically certify linked artifacts or treat a PR or CI result as approval.

For a hosted rollout, apply outstanding migrations through 0014, set the private Site's OBSERVATORY_TASK_ENGINE_OWNER_ID and OBSERVATORY_TASK_WORKER_KEY, and verify Task Engine discovery from the installed Observatory connector. Use a generated secret of at least 32 characters and configure the same value as AADS_TASK_WORKER_KEY on the executor host. Keep the secret out of repository files, command arguments and Task records. The ordinary agent tool cannot admit, cancel, retry or accept work, and the worker credential cannot authorize those operations.

Start the host with node scripts/agent/observatory-task-worker.mjs and the path to a private JSON config. The config provides the executable, workspace root, storage check, workspace policy, and an optional verification namespace.

- codex_bin is an absolute path to the executable of a signed-in Codex installation supporting exec and App Server.
- workspace_root is an absolute path containing dedicated Aetherwake checkouts. Each checkout has its own Git directory and a codex/aads-task- branch.
- `workspaces` maps Task IDs to existing dedicated checkouts. In this mode, the worker only claims mapped Tasks.
- `auto_provision` with `name` and `email` opts the worker into creating its own checkouts. The worker claims owner-admitted Tasks and fetches the exact claimed commit from Aetherwake into a dedicated branch under `workspace_root`. Optional `auto_provision.task_ids` narrows claims by Task ID. Explicit `workspaces` can still override checkout locations for eligible Tasks.
- Size `storage_check` for the maximum concurrent checkout and Git object allocation on the worker host. Provisioning is covered by the same reservation and lease as the attempt. An existing clean checkout at the pinned revision is reusable. Interrupted sessions require their original checkout, and dirty or conflicting workspaces are retained for reconciliation.
- storage_check is an argument array starting with an absolute executable path. Its exit code controls resource admission before launch and during heartbeats. On the AERO X16 use the host reserve check with bounded estimates.
- verification is the UUID of an isolated Task namespace. Use the same UUID in the Site controls and when connecting telemetry for the sandbox checkouts. The worker rejects a checkout connected to a different telemetry namespace, and omitting verification selects the live namespace.

Use the same workspaces and Codex session storage when restarting a paused executor. If the host dies while an execution is active, the next Task read or scheduler pass after the lease deadline records the orphaned attempt. Inspect the workspace and process state before removing a stale local lock or approving a retry. Effects from an orphaned attempt can remain in the checkout. The host verifies checkout identity and records a local candidate commit from the dedicated checkout after a successful Codex turn. The configured Git identity authors that commit. The worker never pushes the commit or grants acceptance. Codex runs with workspace-write sandboxing and approval escalation disabled. The worker uses the existing bounded AADS Codex event observer. Its runClaim telemetry callbacks receive the original Task and canonical Attempt. onTelemetryStart begins an execution observation, onUsage delivers normalized completed-turn measurements, and onTelemetryEnd delivers the observer summary and execution disposition. The execution disposition does not grant Task acceptance.

Fresh App Server executors publish up to one cumulative usage snapshot every 15 seconds, capped at 16 snapshots per turn. The Task view and PDF show the latest snapshot until a final receipt is available. Task totals use final receipts. The worker leaves resumed-thread attribution unavailable because the provider counter includes earlier turns.

### Link Codex Desktop work to the Task

On the signed-in Codex host, run the observer for one Task and its persisted conversation. Use `--thread-id` when the Task already links more than one conversation. Omit `--watch` for a single sync. Stop polling with Ctrl+C.

```text
node scripts/agent/observatory-desktop-sync.mjs --task-id task_<id> --watch
```

The observer uses documented App Server `thread/turns/list` and `thread/items/list` history reads. It does not resume the thread. Completed, timestamped turns outside all matching managed attempt windows appear in Linked Codex history with message, tool and file-change item counts. Counts describe the visible item page. The observer reads up to three pages of recent turns per pass and marks truncated item pages. Prompt text, arguments, tool outputs, and file paths stay on the Codex host. The history response provides neither a per-turn provider receipt nor a Git commit attribution, so these observations add no token total or claimed Git outcome. When the origin of a turn is unavailable, the Workspace identifies it by its persisted Codex history.

The observer keeps imported history separate from the worker's leases and owner review. For managed continuation, run the following command in the original Task checkout before using its existing owner Retry or Resume control.

```text
node scripts/agent/observatory-desktop-sync.mjs --task-id task_<id> --reconcile
```

Reconciliation reports the pinned revision, current head, changed path count and whether the checkout is clean on the Task branch. Preserve a newer revision by retaining its branch or recording a verified checkpoint first. The owner can then restore a clean checkout at the required revision and authorize a new managed attempt. Review previously produced Git evidence before deciding whether another execution is needed.

After a restart or a temporary delivery failure, an idle worker revisits journals in its configured Task scope once a minute. It reuses the saved upload and then syncs newer journal entries. It skips unchanged checkpoints and uses the existing authenticated telemetry connection.

The private worker recovery marker records the checkout, pinned source, session and observed App Server turn. Before reporting a candidate it also records the verified local revision and terminal operation ID. The marker contains no lease secret. If terminal delivery is uncertain, reconciliation retains the marker and candidate until the canonical attempt records the exact revision. Submitting a recovered candidate still requires independent verification and the owner recovery action.

The subprocess integration test executes real artifact-producing steps with an explicit test executor. It proves queueing and evidence transitions across separate checkouts. Verify the hosted MCP deployment, owner controls and signed-in Codex provider execution independently before production acceptance.

### CI controls

Set `OBSERVATORY_CI_OWNER_ID` to the authorized Sites user ID and configure a dedicated
`GITHUB_ACTIONS_TOKEN` secret for `Kgray44/Aetherwake` with Actions write and repository
metadata read. Use a fine-grained token or GitHub App credential and keep it distinct
from the proposal and activity credentials. Without both settings only the GitHub read
views are available. CI writes are disabled in isolated verification namespaces.

The CI run detail confirms the workflow, run, attempt, job if applicable, and
head revision before a write. Eligible actions are rerunning a failed workflow, all
failed jobs in that workflow, or one failed job, and ordinary cancellation of an
active run. Scope is restricted to same-repository workflow heads. The CI list permits
dispatch of the existing Engineering Observatory diagnostic on `main` only. Its
workflow checks the confirmed revision before checkout, so a moved ref cannot run
the diagnostic against an unconfirmed revision. The dispatch inputs and scope must
first be merged on the default branch.

One persisted operation holds a run attempt or diagnostic workflow revision. Replaying
the operation ID returns the stored receipt. After a lost response, the Site checks
GitHub instead of resending the write. An ambiguous rerun or cancellation remains
unattributed even if a matching state is later visible. GitHub does not provide a
compare-and-set on run attempt for mutations, so the adapter preflights the exact
identity and separately reports the observed outcome. For rejected actions, refresh the
target before submitting a new operation. The audit store is capped at 1,000 operations
per owner. Inspect existing receipts and use GitHub directly if that limit is reached.

Private proposals can be edited from Task inspection while proposed. The Site stores priority,
version, and the latest 20 operation receipts alongside the contract record. Writes require the
same owner, namespace, and expected version. A proposal may be blocked, cancelled, or superseded
with a reason, and a blocked proposal may return to proposed. Public proposals and Tasks with a
local execution projection are outside this editing path. Proposal state cannot grant owner
acceptance or authorize execution.

External tools can append a bounded receipt to an existing Task journal with `node scripts/agent/record-engineering-activity.mjs --task PATH --journal DIRECTORY --receipt PATH`. A receipt supplies `kind`, `source`, a stable non-secret `source_id`, `revision`, `occurred_at` (UTC), and `outcome`. It may include an artifact SHA-256, a Codex session UUID, or an attempt ID. Use the same operation ID for a start and its final result. The exporter publishes the derived operation hash through the existing private synchronization path. Receipts populate the chronology as reported activity and do not change Task Engine state or owner acceptance.

A release or test tool with its own private journal can use `--sync --activity-only` with the same command and the existing Task JSON. This mode accepts engineering receipts without an attempt ID and keeps the worker’s synchronized records intact. It can seed a projection with the supplied Task when no projection exists. Retries use the source’s stable operation ID. Use ordinary `--sync` when writing into the worker’s journal.

Run from the Task checkout and pass `--sync` after the receipt path to deliver through its configured private Observatory connection, including after its worker has exited. Use the existing Task journal and the same verification namespace, if configured. The command returns the local event ID and delivery status. A pending or unconfigured delivery exits nonzero and preserves the journal entry. Repeating the same command retries delivery without duplicating the receipt.

The shared GitHub D1 cache serializes refreshes and uses authenticated ETag revalidation for main, issues, pull requests and CI. The feed shows the latest reported API budget and reset time alongside data refresh timestamps. The shared cooldown honors GitHub retry and primary-reset headers. Unauthenticated GitHub delivery cannot reach the owner-private Site, so this deployment uses conditional refreshes. An approved authenticated ingress would be needed to use signed webhook delivery.

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

### Automatic delivery from the local Task runner

Install and connect the existing private **Aetherwake Engineering Observatory** plugin in
Codex. With the signed-in Codex CLI available on PATH, run this from your Aetherwake
checkout once:

```sh
node scripts/agent/observatory-sync.mjs connect
```

The command verifies the connection through Codex and opts this Git checkout into local
delivery. It stores no credential. The normal `scripts/agent/telemetry.mjs run` command
now starts a bounded delivery worker alongside the observed command, batches committed
journal changes, and attempts a final flush. No model turn or browser tab is involved.
The next observed run revisits earlier queued journals if delivery was interrupted. A
quiet workstation with no observed Tasks running does not poll. An operator can run
`node scripts/agent/observatory-sync.mjs sync <task.json> <journal>` to reconcile a
specific journal without running a new Task. Use a separate checkout configured with
`connect --verification <UUID>` for isolated verification.

Private checkpoints and status live under the Git common directory in
`agent-harness/observatory-sync`. A durable pending batch is replayed exactly after a
lost response, with the same event identities and compare-and-set baseline. The worker
reuses immutable journal entries while active and retains canonical files untouched during
outages. Local status records telemetry coverage, last successful delivery, preparation
and request time, and any pending error. Open **Measured execution** to see the uploaded Task
and its receipt. Keep each Task's journal in a private directory.

### Browser recovery and manual import

On an active trusted workstation, run
`node scripts/agent/stage-observatory.mjs <task.json> <journal> <private-staging-directory> --watch`
to prepare a sanitized snapshot automatically. Omit `--watch` for a one-time checkpoint.
Use a dedicated private staging directory per Task, outside the journal and source checkout.
The watcher observes committed file changes and checks directory metadata every five seconds
to recover missed notifications. It coalesces changes before reusing the bounded exporter.
An unchanged snapshot keeps its original bytes for retry. An invalid journal leaves the last
good file intact. The watcher reports staging status and performs no network requests.

Open the signed-in Observatory in a browser with the File System Access API. In **Measured execution**,
choose **Connect staging directory** and grant read access to the dedicated directory. The page reads only
`observatory-projection.json` for the selected Task and monitors it while the tab remains open. It uses the
existing Site session and sends only new events and changed records to the private Task telemetry endpoint.
Worker compare-and-set receipts fence concurrent writes and retries. The page reads back the stored data
before refreshing the execution feed. A lost response is reconciled against the stored receipt on retry or
restart. Directory access is saved per authenticated owner and verification namespace, and may need renewal
after a browser restart. You can disconnect from the panel at any time.

Automatic delivery allows up to 500 live Task projections within the existing 2 MiB live payload budget.
Verification allows eight Task projections and 2 MiB of payload per namespace, with up to 24 verification
projections per owner. Verification capacity does not consume live projection slots. The foreground
session pauses on persistent errors after three scheduled
retries. Previously synchronized events remain immutable. The selected local Task journal remains
authoritative. A closed tab, unsupported browser, or signed-out session pauses delivery.

The manual import and Site MCP routes still replace their respective namespace's legacy snapshot.
The execution feed combines that snapshot with automatically delivered Task projections and uses the
automatic records for Tasks connected through the new path. Existing MCP import/readback describes
its own legacy snapshot.

The Worker also implements stateless JSON-RPC `POST /mcp` (MCP 2026-07-28 discovery) with only `project_execution_snapshot` and `read_execution_projection`. Both require a real platform-injected Site-scoped caller identity. The import tool reuses the same bounded schema/sanitizer and private owner/namespace store; readback includes a SHA-256 receipt of the stored sanitized snapshot. Supplied owner IDs, execution tools, arbitrary SQL and approval actions are not supported. Browser cross-origin requests are rejected. Service-only access without visitor identity is rejected rather than translated into a fabricated owner.

To activate on the **existing** private Site, its publication owner must add `mcp` to the private checkout's `.openai/hosting.json` capabilities, retain project identity/access policy, build and publish the reviewed source once, then request `get_site(include_mcp_connection:true)`. Sites provisions a private plugin; if unavailable, the returned plugin ID can be offered through the supported Install/Connect flow. Owner action may be needed for that connection. No credentials are stored in repository instructions or exporter output, and no bypass token is created/rotated.

An authorized engineering agent can reconstruct and sanitize its private producer journal at task checkpoints,
invoke the import tool in an isolated verification namespace, and compare its returned digest with the
readback receipt. A cloud task needs independent access to both the producer journal and the Site connection.
The tool does not authorize Tasks or move canonical state to D1.

Projection admission rejects generation timestamps more than five minutes ahead of the Worker clock. A caller can keep at most eight verification namespaces plus its live projection; quota enforcement occurs inside the atomic SQLite insert, so concurrent first imports cannot exceed it. Existing namespaces remain updateable at quota. Reuse a verification namespace rather than generating one for every refresh. Each projection is bounded to 1 MiB at ingress; no raw-history accumulation occurs in D1. No automatic deletion of owner records is introduced.

Evidence presentation is deliberately non-authoritative: a reported passing result, even with `synthetic: false`, matching revision and linked attempt, is **reported pass unverified**, never criterion acceptance. Missing or inconsistent attempt linkage displays **unverified missing attempt**. Partial projections remain admitted so bounded snapshots do not silently discard useful claims. Neither schema validity, linkage, a digest receipt nor a Site login authenticates the underlying evidence or an owner decision. Canonical task state is not rewritten by this display classification.

## Merge Workspace

Automatic infrastructure reruns require the existing CI owner and Actions credential, the live worker's `integration_ci_automation` opt-in, and a separate owner authorization of the exact PR head and base. The authorization expires after 30 minutes and consumes the shared repair limit. The worker reruns only a transient job tied to a failed required check. A pending submission stays fenced until a newer attempt of the exact workflow and head is observed.

Failed-step diagnostics sample at most three steps and 64 KiB per step. The GitHub read credential stays on the API request. A single signed download redirect is allowed only to recognized Actions storage. Only fixed diagnostic codes, test ordinals, and locations in files verified on the PR are retained. The structured facts carry workflow, run, attempt, job, step, and head provenance. Remote log text never enters the Codex repair prompt.

Integration runs and their audit history use the existing private, owner-scoped Observatory database. They retain the accepted Task attempt, exact candidate SHA and parent, PR identity, observed target and verified merge commit. Task prerequisites still default to acceptance. Select the merge milestone for individual prerequisite Task IDs when the downstream Task needs verification on `main`.

The workspace reads GitHub without using the proposal or Actions write credentials. Protected merge and candidate PR publication require separate owner bindings and distinct repository-scoped credentials. Configure `OBSERVATORY_INTEGRATION_MERGE_OWNER_ID` with `GITHUB_INTEGRATION_MERGE_TOKEN` or `OBSERVATORY_INTEGRATION_PUBLISH_OWNER_ID` with `GITHUB_INTEGRATION_PUBLISH_TOKEN` only after authorizing that deployment. Direct merge requires strict base protection. Queue-required repositories use the GitHub queue. GitHub enforces its protection rules, and Observatory confirms the reported merge commit on main. Existing CI permissions govern targeted job reruns.

Managed publication requires an active ruleset that restricts updates and deletion of `aads/integration/*` with zero bypass actors. When the exact reviewed commit exists only locally, an explicitly enabled live worker can transfer it. This requires `OBSERVATORY_INTEGRATION_TRANSFER_ENABLED=true` on the Site, `integration_transfer_git_bin` pointing to an installed Git executable outside managed checkouts, and a separate worker-only `AADS_INTEGRATION_PUSH_TOKEN` with repository-scoped Contents write access. The worker transfers the original commit and Git history into the protected ref without modifying the source checkout. The Site independently matches the ref, commit, single parent and tree. The owner then confirms PR publication separately. An unknown upload outcome remains pending remote readback. Keep these branches protected for source integrity.

Source repair requires `OBSERVATORY_INTEGRATION_SOURCE_REPAIR_OWNER_ID` and the live App Server worker's `integration_source_repair` opt-in. The owner can request repair of a classified CI failure or authorize one automatic repair of an exact pending head and base. Repairs run in a pinned disposable-purpose checkout with workspace-only tool access. They can modify approved files already present in the pull request. The shared repair limit covers both infrastructure reruns and source repair. Each Codex repair has a wall deadline and a token ceiling based on observed provider usage. The worker retains an owner-reviewable candidate and its fresh persistent conversation. Approval binds the exact commit and tree, preserves the original acceptance, and returns the integration to publication and fresh CI. Billing remains unknown. OpenAI API reference pricing uses only eligible current quotes and complete exact-turn counters.
