# Test results and acceptance status

Observed locally on Windows with Node.js v24.18.0 on 2026-11-01:

~~~text
npm test
12 tests, 12 passed, 0 failed
node src/cli.ts demo --file demo-output.json
node src/cli.ts graph --file demo-output.json
node src/cli.ts handoff handoff-00007 --file demo-output.json
node src/cli.ts handoff handoff-00014 --file demo-output.json
~~~

The tests verify ordinary-to-ordinary, ordinary-to-Codex, Codex-to-ordinary, Codex-to-Codex, nested and sibling branches, exact fork boundaries, no mutation of original history, selected context and exclusion, provider turn gating, sensitive/restricted transfer rules, unavailable source/staleness, idempotent retries, provider absence, failed/interrupted handoffs, and validated export/import with stable identities.

The CLI demo produced three connected conversations and two inspectable handoffs. Reloading the exported JSON via the graph and handoff commands succeeded. All responses and provider sessions are deterministic mocks.

This is a working architectural demonstration. It is not a live Codex or ordinary-provider integration, secure persistent store, visual interaction test, performance benchmark, user acceptance, or proof of provider parity. Future integration must verify real account capability, provider turn mapping, permissions, source deletion, crash-safe writes, long-history scale, and the full Workspace Kernel/Codex Bridge contract.
