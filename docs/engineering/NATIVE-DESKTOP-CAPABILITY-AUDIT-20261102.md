# Native desktop capability audit

The qualified review is **M**, source `6c9d829a033fa336c1210f274b96f1b88f381240`.
It preserves the existing V3.5 renderer and user profile. Later development
commits must not be described as part of that immutable review.

## Verified corrections

The actual combined Electron application passed two fresh-profile journeys and
their separate-process restarts. These were application integration checks,
not the isolated Constellation fixture. All test windows/backend processes
exited and were independently checked. There were no global mouse hooks.

| Capability | Current evidence and boundary |
|---|---|
| Explicit Copy | Actual Reference and Research Notebook links, conversation user message, Note fenced code, current editor text, canonical resource information, selection button and native Ctrl+C all produced exact Windows clipboard readback. |
| Clipboard authorization | A scripted request without activation was denied. Product API is write-only dedicated IPC; current isolated-preload activation and focused Main frame/URL are checked. No browser permission policy was relaxed. Transient activation is not a cryptographic one-shot consent token. |
| Clipboard feedback | Native write promises are awaited. Unconfirmed writes stay unknown without automatic retry. Note copy failure has its own status and cannot claim the document failed to save. |
| `system.memory` | The exact RAM question invoked the actual trusted physical-memory reader once. Independent Windows CIM comparison passed; source, interpretation and measurement time are retained. System memory is distinct from process RSS and committed memory. |
| No model required | Actual process-session observations showed zero registered provider connection/turn attempts. Restoration performed no new RAM read. These observations are not a global network monitor. |
| Environments | Actual project/workspace creation, hierarchical disclosure, project opening, exact-ID search/switch, keyboard operation, stale-version rejection, rename/archive/restore and exact restart passed. |
| Workspace Actions | Mode-only Structured/Fluid preserved exact geometry. Checkpoint, real fixture move, Undo, Redo, Restore and Find preserved resource identity/content. |
| Motion | Actual coordinator intermediate state, interrupted retarget and reduced-motion reconciliation were checked. Anchored nonmodal surfaces retain the visible scene. Native screenshots were inspected and an exact-window recording was retained privately. Continuous-motion/owner artistic acceptance and monitor-presented timing remain separate. |

Native desktop-basics initial/restore slots completed in approximately 11.0/4.6
seconds; Environments completed in 23.4/3.7 seconds. These include harness and
capture overhead and are **not** navigation latency or performance thresholds.
The final foreground batch lasted 47.7 seconds. Software native-window input and
renderer DOM integration are identified separately; neither is physical input.

The packaged backend independently restored actual local chat, Note, recovery
draft and geometry using its bundled Node. Review M's GUI started with the
preserved profile following graceful close and a verified closed-database
backup. Packaging checks are not a substitute for native journey evidence.

## Wider functionality

| Expectation | Status |
|---|---|
| Ordinary local chat | Working; native manual Send, canonical message identity and restart checked. It records user messages and does not invent a model response. |
| General paste | Native editor behavior remains; this pass did not qualify a complete paste/format matrix. |
| Time | Existing deterministic native clock route remains; RAM extends that path rather than invoking Codex planning. |
| CPU/GPU/battery/network telemetry | Missing; not advertised as implemented by the memory capability. |
| Independent resources | Native direct Note/Reference/Research and conversation opening work without workspace placement. The full current Constellation resource-opening A–H acceptance remains separate. |
| External links | Supported first-party ChatGPT navigation has its own exact allowlist. A general native source/file opener remains incomplete; successful Copy is not successful external navigation. |
| Files/media | Real viewers exist in the Universal Block System source lane. Native import/read/playback integration remains incomplete; current file/link capability gates remain unavailable. |
| Real Codex tools | Existing supported execution and authorization routes remain separate from restricted planning. A new deeper diagnostic handoff was not executed in these model-free journeys. |
| ChatGPT-plan inference | Supported-flow source/native protection/packaging are implemented. Live account consent and authenticated inference remain unverified. |
| Native ChatGPT account history/memory/Projects | No parity is claimed. Account-authorized inference does not establish these capabilities. |
| General Vela conversation/orchestration | Incomplete. Deterministic local answers do not qualify her general conversational intelligence or full application control. |
| Agents/checklists | Independent canonical service slices are entering integration after M. They are not functional features of the M artifact. |
| Agentic tasks/workflows/timelines | Broader implementation and native acceptance remain. Existing manual task records are compatibility data, not verified agentic work. |

## Evidence custody

Source checks at the qualified candidate: 175 backend, 311 application/native
boundary and 14 packaging checks, plus strict production build. Suites overlap;
counts do not add up to independent end-to-end acceptance. Large-bundle warnings
remain. CI and native/artistic/performance acceptance are distinct.

Private receipts contain exact source/build digests, original passing-receipt
restart bindings, synthetic canonical identities, screenshot/video hashes and
actual host measurements. They are excluded from this public repository.
Earlier failed receipts remain failures and were preserved. No original user
clipboard content was read or retained; copy verification used synthetic text.

Review M manifest SHA256:
`9f0375165aff49dd13828b062831c8354cd3808562f5884c6496dba6b7df0755`.
The 334-file package contains no test helper/profile/database/credential corpus.
Its dependency license does not change Aetherwake's proprietary status.
