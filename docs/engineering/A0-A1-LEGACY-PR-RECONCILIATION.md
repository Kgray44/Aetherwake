# Architecture Recovery A0/A1 legacy PR reconciliation

GitHub status was checked on 2026-11-09 against Aerynth main `6d249eba7c1b3f8327f5a592734a5d334be1bf6e`. The recommendations below leave disposition to the repository owner. Hosted mergeability describes the PR's declared base. It does not establish acceptance or compatibility with the connected desktop.

| Pull request and exact head | Status at review | Source and evidence | Recommended disposition |
| --- | --- | --- | --- |
| [#5 Dual-mode Chat and Codex design](https://github.com/Kgray44/Aetherwake/pull/5) · `4eb577dce86707eb48f4bdb1ffef1cb749ffd952` | Open, conflicts with `main` | The proposal edits Charters 04, 10 and 12 plus governance routing. Later ratified text covers ordinary chat, connected ancestry, scoped context, provider identity, authorization and economic truth. The proposal's six `AW-CHAT-130–135` IDs and nine `CHAT-T27–35` journeys are absent as such from current Charter 04. Several other proposal IDs now name different rules in current charters, so ID presence alone is insufficient. | Leave open pending a content comparison of the remaining obligations and acceptance cases. If the owner wants a remaining requirement ratified, prepare a scoped reconciliation on current governance with stable IDs. |
| [#10 Tauri visual lab](https://github.com/Kgray44/Aetherwake/pull/10) · `f38a8185f25020dcdb3db5b65ff61fc04ed5d3ff` | Open draft, GitHub reports mergeable with `main` | Separate visual-lab tree absent from `main`. The branch preserves Tauri/WebView2 window, detachment, motion and fixture measurements. The host process sample excludes WebView2 children. Renderer callback intervals do not measure presented frames. | Preserve as research. If a host comparison is authorized, use its controls and repeat matched loads with the whole process tree, native frame evidence and mixed DPI. |
| [#11 Electron visual lab](https://github.com/Kgray44/Aetherwake/pull/11) · `90877753d8fcc7edd81f92bea2546e64684ff588` | Open, GitHub reports mergeable with `main` | Separate visual-lab tree absent from `main`. The branch preserves detachment and benchmark instrumentation, synthetic fixture work and historical screenshots. The connected Electron package on `main` has a different renderer/runtime entry point. | Preserve as research. Reuse useful benchmark controls in a matched comparison before drawing a host-selection conclusion. |
| [#14 Native Codex fidelity](https://github.com/Kgray44/Aetherwake/pull/14) · `7ca875d7e91ebfaab67e2f38156e5f6ce9dba0a5` | Open draft, still based on `codex/04-codex-bridge` | Exact head is an ancestor of `main`; integrated history contains later Codex bridge changes. The old PR's mergeability is against its stacked base. Its evidence and acceptance limits belong to that historical checkpoint. | Recommend administrative closure after owner review. Keep current App Server qualification in the connected desktop evidence matrix. |

For #5, the remaining proposal comparison should cover explicit effective mode and provenance (`130`), cost and quota display (`131`), authorization on a metered route change (`132`), external history synchronization claims (`133`), destination scope and permission checks (`134`), and offline history/draft continuity (`135`). The existing [conversation](../../governance/04-CONVERSATIONS-AND-CONNECTED-BRANCHES.md), [execution profiler](../../governance/10-AI-EXECUTION-PROFILER.md), [Codex integration](../../governance/12-CODEX-EXECUTION-AND-INTEGRATIONS.md), and [trust](../../governance/14-TRUST-PRIVACY-AND-AUTONOMY.md) charters control that review. Preserve bidirectional handoff, reconstruction, negative billing and permission cases and mixed-provider lineage as useful proposed acceptance scenarios.

## Owner-ratified reconciliation

[#21 Spatial Intelligence and Vela Presence](https://github.com/Kgray44/Aetherwake/pull/21) and [#22 capability-first execution](https://github.com/Kgray44/Aetherwake/pull/22) are closed without individual merges. Their reconciliation is [#23](https://github.com/Kgray44/Aetherwake/pull/23) at `fa43d82e5a4bdd486b359aedc34b9e834218267b`. Comparing each proposal's added normative IDs with the merged charter files found **110/110** for #21 and **157/157** for #22. The registry documents both reconciliations and their owner-ratified status, including the distinction between accepted requirements and implementation qualification. The [spatial systems index](../design/SPATIAL-INTELLIGENCE-SYSTEMS-INDEX.md) and [capability runtime](../architecture/VELA-CAPABILITY-RUNTIME-AND-EXECUTION-FABRIC.md) retain the associated design boundaries. [#24](https://github.com/Kgray44/Aetherwake/pull/24) adds the subsequent semantic retrieval, storage and Architecture Recovery clarification.

## Reproduce the repository checks

```powershell
gh pr list --state open --json number,isDraft,baseRefName,headRefOid,mergeable,url
gh pr diff 5
gh pr view 23 --json mergeCommit,mergedAt
git merge-base --is-ancestor 7ca875d7e91ebfaab67e2f38156e5f6ce9dba0a5 6d249eba7c1b3f8327f5a592734a5d334be1bf6e
git ls-tree -d 6d249eba7c1b3f8327f5a592734a5d334be1bf6e prototypes/visual-experience/electron prototypes/visual-experience/tauri
```

To repeat the proposal inventory, inspect added `AW-*` normative IDs in the governance diff from the common ancestor of each proposal and `main` to its head (`2471e138` and `d8e39a97` respectively). Match those IDs against `git grep` on `fa43d82`. Match wording and authority separately wherever an ID has been reused or the proposal has been edited.
