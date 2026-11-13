# PR #5: remaining Chat/Codex obligations

Documentation review, 2026-11-12. Compared [proposal #5](https://github.com/Kgray44/Aetherwake/pull/5) at `4eb577dce86707eb48f4bdb1ffef1cb749ffd952` with main `c470a5d23786ea2d5022553a1472e3643a619bb1`. This completes the content comparison requested by the [A0/A1 reconciliation](A0-A1-LEGACY-PR-RECONCILIATION.md), not implementation qualification or owner ratification of the proposal.

**Disposition: keep #5 open pending a scoped governance decision and acceptance mapping.** Do not merge its old charter patch directly. Current Charters 04, 10 and 12 reuse proposal-era IDs for different ratified requirements. In particular, current AW-CHAT-130–135 are now Fluid Intelligence rules, so the earlier report's absence-by-ID observation is historical. Compare wording and authority, not numeric presence. This review changes no charter, requirement ID, acceptance registry or PR state.

## Sources and method

- [Proposal Charter 04](https://github.com/Kgray44/Aetherwake/blob/4eb577dce86707eb48f4bdb1ffef1cb749ffd952/governance/04-CONVERSATIONS-AND-CONNECTED-BRANCHES.md), section 22: twelve mode requirements and CHAT-T27–35.
- [Proposal Charter 12](https://github.com/Kgray44/Aetherwake/blob/4eb577dce86707eb48f4bdb1ffef1cb749ffd952/governance/12-CODEX-EXECUTION-AND-INTEGRATIONS.md) and [proposal Charter 10](https://github.com/Kgray44/Aetherwake/blob/4eb577dce86707eb48f4bdb1ffef1cb749ffd952/governance/10-AI-EXECUTION-PROFILER.md): related provider and economic requirements.
- Current [conversation charter](../../governance/04-CONVERSATIONS-AND-CONNECTED-BRANCHES.md), [profiler charter](../../governance/10-AI-EXECUTION-PROFILER.md), [integration charter](../../governance/12-CODEX-EXECUTION-AND-INTEGRATIONS.md), [Trust charter](../../governance/14-TRUST-PRIVACY-AND-AUTONOMY.md), and [registry](../../governance/README.md).

The table distinguishes substantial existing design coverage from wording that still merits an explicit decision. None of these mappings proves a runnable user journey. No live provider, paid call or native UI test was performed for this review.

## Six previously identified remaining obligations

| Proposal-only ID and meaning | Current binding coverage | Remaining reconciliation |
| --- | --- | --- |
| AW-CHAT-130: effective mode, provider/model, capability, authorization and evidence per turn | AW-CHAT-006, 012, 025, 124–125 and AW-CEX-042 establish scoped provider mappings, attribution and execution settings. | Explicit user-facing Chat/Codex mode per turn and chronology across mixed-mode segments remain more specific in the proposal. Map the data/UI acceptance without reusing the ID. |
| AW-CHAT-131: honest plan, quota and metered cost signals | AW-AEP-071–073, 133, 141 and AW-CEX-045 distinguish economic domains, unknown cost, actual account limits and grants. | Strong substantive coverage. Retain a concrete mixed-route UI test, including unavailable quota and no fabricated zero cost. |
| AW-CHAT-132: no surprise billable escalation | AW-CEX-016, 045, 152 plus AW-TRUST-014, 021 require authorized fallback, truthful economics and an effective authorization envelope. | Map explicit branch/retry/default-route transitions and materially different quota pools. Broad permission rules are not evidence that every economic transition is tested. |
| AW-CHAT-133: consumer account-history/import/sync honesty | AW-CHAT-010, 115, 117–118 and AW-CEX-002, 030, 098–099 prohibit fabricated continuity and require honest recovery/context limits. | Proposal explicitly names consumer ChatGPT history and snapshot/one-way/two-way labeling. Preserve that product-specific clarification for owner review; do not claim automatic account sync. |
| AW-CHAT-134: destination privacy and permission checks | AW-CHAT-126, 128, 136 and AW-CEX-048, 050, 095–098 preserve scoped context, credential separation and no implied authority transfer. | Strong substantive coverage. Verify destination revocation and cross-account/project denial in actual mixed-mode handoffs before calling the journey passed. |
| AW-CHAT-135: retained source/destination records and drafts during failure | AW-CON-079, AW-CHAT-009, 026, 028, 115–120 and AW-CEX-004, 114 cover retained history, unsent text during organization, recovery and degraded local use. | Explicit pending-draft preservation across auth/quota loss and unsupported cross-mode resume deserves a combined scenario; the narrower unsent-text organization guarantee is not the same test. |

The earlier proposal's AW-CHAT-124–129 additionally names two visibly distinct, independently usable modes, all four branching directions and controls such as Branch into Chat/Codex. Current AW-CHAT-001, 008, 054, 056–063, 124–126 and AW-CEX-003, 098 preserve much of the underlying ordinary-chat, independent-branch and source-linked handoff intent. They do not establish that the proposal's exact dual-mode UX and every direction are accepted or delivered. Related proposal CEX-132–141 and AEP-129–134 should be reconciled with these same canonical owners, not copied as a second rule set.

## Nine proposed acceptance journeys

These proposal IDs are not current charter test definitions. Current references below are related coverage, not a claim of equivalence or passing tests.

| Proposal journey | Existing anchors | Evidence still needed for this specific journey |
| --- | --- | --- |
| CHAT-T27 Chat → Codex | CHAT-T08, T17, T26; AW-CHAT-124–126 | Actual supported Chat and Codex routes, bounded source-linked handoff, original readable history and shared ancestry. |
| CHAT-T28 Codex → Chat | CHAT-T10, T17, T26; AW-CEX-098 | Return real edits/tests/artifacts to a conversational child without implicit tool execution. |
| CHAT-T29 bidirectional post-fork learning | CHAT-T09–14; AW-CHAT-056–063 | Independently create a new user decision and verified coding finding, then selectively retrieve/adopt in both directions. |
| CHAT-T30 no false native state | CHAT-T26; AW-CHAT-115, 117–118 | Unsupported native import yields an explicitly reconstructed handoff with original provenance. |
| CHAT-T31 billing guard | AW-AEP-071–073; AW-CEX-016, 045, 152 | Actual economic-class preview and denial before a subscription-to-metered transition. |
| CHAT-T32 entitlement changes | CHAT-T22; AW-CEX-004, 015, 114 | Auth expiry, exhausted allowance and unavailable route preserve both histories, ancestry and pending draft. |
| CHAT-T33 permissions | CHAT-T20, T24; AW-CHAT-126, 136 | Parent context cannot grant filesystem, network, credentials or destination data access. |
| CHAT-T34 account-history limits | AW-CHAT-010, 117–118; AW-CEX-002, 030 | Import/export and account-linking UI distinguish retained snapshot from a genuinely supported sync path. |
| CHAT-T35 mixed-provider timeline | AW-CHAT-012, 025, 125; AW-AEP-006, 048–049, 132 | Render provider/mode/source boundaries and reconcile actual usage without duplicating ancestor or copied-finding charges. |

## Recommended next decision

Keep existing ratified protections authoritative. If the owner wants the additional explicit dual-mode promises adopted, prepare a separate narrowly scoped amendment using new stable IDs and map these nine journeys to current test/evidence owners. That requires its own governance review; this documentation cleanup is not acceptance of new requirements. Existing runtime evidence can later be assessed against the scenarios without assuming either that everything is missing or that a similarly named test proves the complete journey.

PRs #10 and #11 remain preserved visual research under the existing reconciliation; this review does not change their disposition.
