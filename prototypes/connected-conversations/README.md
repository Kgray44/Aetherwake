# Connected Conversations prototype

A runnable, provider-neutral domain prototype for Aerynth. It supports ordinary chats and execution-oriented Codex chats as first-class conversations, branching across providers, selective context handoffs, lineage inspection, and validated JSON export/import.

**Every adapter and response in this prototype is a deterministic MOCK.** It makes no network requests, launches no agents, and incurs no API charges. The mock Codex adapter simulates native fork semantics; it does not prove live Codex integration or provider parity.

## Requirements

Node.js 22.18+ (tested with 24.18.0). No package install is required.

From this directory:

~~~powershell
npm test
node src/cli.ts demo --file demo-output.json
node src/cli.ts graph --file demo-output.json
node src/cli.ts handoff handoff-00007 --file demo-output.json
node src/cli.ts show conv-00013 --file demo-output.json
~~~

The demo covers the exact required journey: an ordinary garden-app conversation, a branch at a particular message into a mock Codex build conversation, a sourced context package, a mock artifact, and a branch back into ordinary discussion. The original chat keeps its three original messages. The JSON file is ignored by Git; reopening it with the CLI reconstructs the graph and references.

## CLI commands

~~~text
node src/cli.ts new ordinary mock-ordinary "Idea" --file graph.json
node src/cli.ts say conv-00001 user "A garden app" --file graph.json
node src/cli.ts branch conv-00001 msg-00003 codex mock-codex "Build" msg-00003 --file graph.json
node src/cli.ts run-mock conv-00006 "Build it" --file graph.json
node src/cli.ts graph --file graph.json
node src/cli.ts show conv-00006 --file graph.json
node src/cli.ts handoff handoff-00007 --file graph.json
node src/cli.ts unavailable msg-00003 --file graph.json
~~~

The branch command's last argument is an optional comma-separated list of message IDs to include. It defaults to the fork message only. The CLI has no sensitive-consent flag; use the domain API for a deliberately consented sensitive handoff. Restricted content is never included. A production interface needs a preview and explicit consent flow.

## Files

- src/graph.ts: versioned graph, identity, lineage, handoffs, export/import, validation.
- src/adapters.ts: labeled deterministic ordinary and Codex mock adapters.
- src/cli.ts: local commands and end-to-end demo.
- test/graph.test.ts: reproducible domain and persistence tests.
- ARCHITECTURE.md: data model, boundary semantics, integration plan.
- PROVIDER-FINDINGS.md: official OpenAI documentation findings and capability/cost rules.
- HANDOFF-EXAMPLES.md: inspectable example snapshots.
- TEST-RESULTS.md: observed local test results and remaining gates.

## Scope and limitations

The prototype stores data in a local JSON file. This is an inspectable interchange format, not hardened production storage, multi-process concurrency control, or secure deletion. Do not use it for real secrets or personal chat history. Marking a source unavailable blocks future handoffs and marks existing handoff snapshots stale; it does not erase previously supplied content. Actual deletion, revocation propagation, encrypted storage, retention policy, and provider reconciliation belong to later integration.

The governance index says the Constitution is established and specialized Charters 03, 04, 06, 07, 08, 09, 12, 14, and 15 are published drafts pending owner acceptance. Their applicable guidance informed this prototype but is not represented as ratified authority. Governance Context Router V2 was attempted in full and normal modes, but failed locally with "Cannot read properties of undefined (reading 'some')"; relevant charter source sections were read directly. No governance files were changed.
