# Mission 01 security and recovery boundary

This is a synthetic-only local backend prototype. Real private content is unsupported: construction requires the trusted host's `contentPolicy: 'synthetic-only'` assertion. This is an attestation, not an automatic detector. There is no encryption at rest, secure-store integration, user authentication, per-message ACL engine or multi-user isolation. Do not connect it to personal conversations, notes, production datasets or an untrusted renderer. Runtime databases, provider IDs and command receipts stay in ignored local state. No credentials or native diagnostics are returned to consumers or committed.

## Boundaries and controls

| Boundary / threat | Implemented control | Remaining limitation |
|---|---|---|
| UI → controller → worker | typed async commands, byte/pending limits, schema checks, safe error codes | trusted controller must enforce actual identity/intent; `authorized` is not a grant service |
| Stored/retrieved context → native turn | explicit selection, sensitivity exclusion, source hashes/revision, exact target/fingerprint approval/expiry, conservative admission bound | synthetic labeling is caller-attested; no full prompt-injection detector |
| Forged context approval | context cannot set approval/authorization; package fingerprint and independent review command required | no cryptographically authenticated human approver; UI/controller must be trusted |
| Provider → event journal/UI | metadata allowlist, no raw payload persistence, observed/reported/inferred/simulated distinctions | omitted content cannot be recovered from the journal |
| Application ↔ native account | separate instance/account/thread binding, caller scope mismatch fails closed | default account scope is a local configured-account alias, not detected OAuth account identity; do not switch native accounts behind a binding. Production needs a verified account fingerprint |
| Codex native tools | read-only sandbox, never policy, bridge default denial of command/file approval requests; unsupported server requests rejected | inherited configuration/MCP/hooks still initialize; sandbox does not claim to bound all external services. No production tool execution is enabled by this demo |
| Remote send ↔ local persistence | durable intent before RPC, terminal validation, unknown state after loss; no automatic retry | no distributed transaction or native idempotent send guarantee; manual reconciliation may remain necessary |
| Storage corruption/upgrades | kernel checks, graph validation, schema/version checks, mapping integrity, SQLite savepoints | one database owner required; backup/secure migration UX not implemented |
| Retention/capacity | bounded journal, explicit replay truncation, state/DB/input/output caps | no private-data retention policy or automatic physical vacuum; full state requires explicit future archival design |

On process loss, unfinished attempts become `unknown` and get a stream-reopened marker. Retained events replay exactly; missing observations are not invented. Native thread reconciliation is read-only and checks scope, thread ID and optional completed synthetic turn items. It does not upgrade unknown attempts based on an idle thread. A missing thread leaves the local resource intact. Never retry unknown remote work automatically. Explicit interruption only becomes interrupted after the provider's terminal event.

The package changes no native Codex base/developer instructions or identity. It passes only the reviewed quoted source context and user request as user input. Vela coordination is a separate logical consumer. Native fidelity audit findings can replace the provider port without changing canonical resource IDs.

The reserve guard applies to this agent's bounded local work; it is not an OS quota. It cannot stop external applications, cloud tasks or already-running processes that have not loaded the rule. Live checks passed before allocation and smoke runs. Do not delete personal/unique/evidence data to maintain reserves.

Before production use: add secure storage and accepted retention/export policy; authenticated policy/approval authority; verified account scope; single-owner process locking; streamed-message crash recovery; native unknown-turn reconciliation; sustained-load/backpressure benchmarks; backup/upgrade exercises; independent security and visual-team review. These gaps do not qualify as production acceptance.
