# Capability-First Aerynth Acceptance Matrix
**CF-TEST-01 · owner-accepted 2026-11-05 · subordinate to governance/15 · tests not automatically passed**

> **Owner-accepted specification (2026-11-05).** The contract and release criteria are binding design targets subject to the governing charters; actual capability, security and usability require implementation and independent test evidence.

## 1. Rules of evidence

There are six distinct states for a claimed capability: `documented`, `implemented`, `integrated`, `verified`, `owner-accepted`, `released`. An API reference is evidence of documentation, a unit test is evidence of a component, and a native Windows end-to-end journey is evidence of actual integration. None of these imply one another. Track product behavior, trust, user experience, performance and model/tool cost separately; do not average away failures. The acceptance baseline is **complete capability**, then optimization without regression.

The table is a test specification, not a declaration of current pass status. Initial status for every new scenario is `NOT QUALIFIED` until a reviewer attaches scoped receipts. Synthetic fixtures may exercise negative paths but cannot substitute for a required live effect or human-audible/visual demonstration.

| ID | User-facing outcome | Positive proof | Negative/security proof | Owner |
|---|---|---|---|---|
| CF-001 | Vela answers nuanced technical question | Current reasoning route, correct derivation, attributable sources, coherent Vela identity | Unsupported model/effort rejected without hallucination | 06/12/15 |
| CF-002 | Instant native RAM report | Real system read, source/timestamp, zero inference on direct path | Disconnected broker returns unavailable, not guessed value | 06/12/15 |
| CF-003 | Safe RAM maintenance | Specific process/cache candidates, scoped consent, before/after metrics, evidence | No arbitrary kill, unrelated file loss or false "freed RAM" | 05/14/15 |
| CF-004 | API/tool catalog discovery | Account/org/model/tool probe and TTL, schema loaded on demand | Revoked/unavailable tool cannot be invoked even after discovery | 12/14 |
| CF-005 | Provider switching | Canonical conversation/identity persists across Responses/Codex route | No context leak between project privacy scopes | 04/06/08 |
| CF-006 | Intelligent model routing | Correct environment/tools/effort selected across diverse requests | Cheapest route blocked when it cannot satisfy outcome | 06/10 |
| CF-007 | Decisions triage | Probability/choice with evaluated evidence and uncertainty | Low-confidence decision never authorizes destructive action | 06/14 |
| CF-008 | Tool orchestration | At least two authorized independent reads actually overlap | Each programmatic child tool retains the policy gate | 05/12/14 |
| CF-009 | Multi-agent investigation | Concurrent independent agent receipts, distinct contexts, joined answer | Shared write locks prevent inter-agent races | 05/09 |
| CF-010 | Durable managed task | Session and task IDs survive app restart; progress reconciles | Replayed webhook and ambiguous write do not duplicate effect | 05/09/12 |
| CF-011 | Agent file/repository edit | Actual diff, real test command, verified readback, correct approval | Inaccessible worktree/runner reports blocked | 05/12/14 |
| CF-012 | Vela builds a workspace | Real add/remove/resize/place, persisted canonical resources and undo | Failure mid-layout rolls back or reports partial state | 03/06 |
| CF-013 | Block Library functional tasks/agents | Distinct real agent/task/checklist types, correct actions and persistence | No fake task completion due to manual checkbox | 03/05 |
| CF-014 | Search and memory | Source-linked cross-chat retrieval after restart, recency and privacy respected | Forgotten/deleted source not resurrected from a stale embedding | 04/08 |
| CF-015 | Source-grounded reasoning | Current authoritative requirements selected, citations and precedence | Prompt injection in fetched document doesn't override policy | 08/14 |
| CF-016 | GPT-Live speaking | Human-audible Windows microphone/speaker session and backend delegation | No audio without consent; no wake/replay during restart | 01/06/14 |
| CF-017 | Voice interrupt and steering | Interruption and task amendment observed, separate task vs speech cancellation | No repeated tool effect; voice never claims unverified success | 05/06/09 |
| CF-018 | Vision-based help | Screenshot scoped to approved window and interpreted accurately | Unauthorized display/window not transmitted | 12/14 |
| CF-019 | Vela 3D GPU Mind | Actual GPU-rendered volumetric structure, camera parallax, event-driven flows | Static 2D layer cannot pass as volumetric; fake cognition forbidden | 02/09/13 |
| CF-020 | One spatial universe | Workspace/constellation/other destination navigate continuously, same IDs/geometry | No disconnected screen reset or duplicate resources | 01/02/03 |
| CF-021 | Living Instruments | Timeline pan/zoom/add/edit real events; meaningful charts/clocks; authoritative motion | Decorative mock and duplicate conflicting events rejected | 02/03/09 |
| CF-022 | Truthful Intelligence Stream | Task tree, calls, results, permissions, timestamps and provenance correlate | No simulated activity presented as live or hidden thought replay | 09/11 |
| CF-023 | Reconciliation on failure | Restart resumes safe, verified state with external receipts | Unknown effect remains unknown and no blind retry | 05/09/14 |
| CF-024 | Credit / entitlement handling | Correct org linkage, credit grants/expiry, estimate vs actual usage | Codex signed-in quota never misrepresented as API credit | 10/12 |
| CF-025 | Spend limits | Active user-set budget enforced, estimate and actual provenance | Cost cap causes explicit pause, not silent quality downgrade | 10/14 |
| CF-026 | Privacy and authority | Consent/retention decisions backed by provider and application policy | Agent/subagent/MCP cannot escape parent authorization | 14 |
| CF-027 | Accessibility & resource load | Keyboard, screen reader, reduced motion, multi-display, real load test | Visual tier changes do not disable actual capabilities | 01/02/13 |
| CF-028 | End-to-end workflow | Planning, execution, verification, memory and UI complete one realistic compound task | Missing backend effect prevents overall "complete" claim | 05/15 |
| CF-029 | Dynamic feature withdrawal | Removed model/tool/version handled cleanly and user informed | Cached entitlement cannot keep acting after revocation | 12/14 |
| CF-030 | Task/voice cost accounting | Provider tokens, audio duration, tool/sandbox billing categorized by task | Unknown charge not displayed as zero, no fabricated savings | 10/15 |

## 2. Minimal proof schema

```json
{
  "scenario_id": "CF-010",
  "run_id": "uuid",
  "status": "passed | failed | blocked | not_run",
  "baseline_commit": "sha",
  "artifact_refs": [],
  "provider": "name/version",
  "capability_probe": "receipt",
  "platform": "OS/device/renderer",
  "input_and_scope_hash": "sha256",
  "permission_records": [],
  "event_refs": [],
  "external_effect_receipts": [],
  "postcondition_readbacks": [],
  "measured_metrics": {},
  "cost_provenance": "reported | estimated | unavailable",
  "known_limitations": [],
  "reviewer": "identity",
  "reviewed_at": "ISO8601"
}
```

Public-repo receipts must be redacted: no real keys, private conversations, personal file paths, device identifiers or sensitive content. A passing test lacking linked evidence is an undocumented assertion.

## 3. Evaluation cohorts and anti-gaming

Use at least:
- 12 simple/native requests, including time, calculator, RAM, CPU, GPU, file metadata;
- 12 open-ended technical/research requests with verified expected sources;
- 12 ambiguous tool/action requests with permission boundaries and resource selection;
- 10 persistent multi-step tasks with external effects and agent branches;
- 10 failure/recovery scenarios (network loss, stale tool, provider quota, rollback, restart, duplicate webhook);
- 10 voice/multimodal scenarios with device capture, interruptions and bad acoustics;
- 10 spatial/render scenarios across displays, GPU loads, accessibility modes and navigation.

Count actual task completions, safe refusals, errors and unavailable separately. Never optimize only for "number of model tokens saved" while weakening success. Report p50/p95 interactive latency, task success, correction rate, approval friction, time to recover, tool-call count, GPU/CPU/RAM load, billed usage and visual motion quality when measured. Mark benchmarks provisional until run.

## 4. Release gate policy

**Gate 0:** documentation and contracts reviewed; conflicts resolved. **Gate 1:** unit/protocol negative tests. **Gate 2:** real native integration. **Gate 3:** long-running multi-agent reliability and security. **Gate 4:** UI, spatial and human voice/visual acceptance. **Gate 5:** owner review and release authorization. Every release explicitly lists supported, partially supported, unavailable and not-yet-proven capabilities. A phase may ship a smaller honest subset, but cannot rename absent functionality "complete".

## 5. Review decisions

If a release fails a capability-first requirement, classify as:
- **Blocker:** unsafe effect, forged outcome, data leak, unusable primary path or corruption.
- **Incomplete:** missing real backend/tool, absent GPU visual, nonfunctional block.
- **Quality regression:** capability works but fails experience/performance/accessibility thresholds.
- **Unverified:** no end-to-end evidence even if code exists.
- **Intentional partial scope:** owner-approved interim release with explicit missing functionality.

No tool, API or model choice is ratified by this document. See [reference architecture](../architecture/VELA-CAPABILITY-RUNTIME-AND-EXECUTION-FABRIC.md) and [evidence register](../research/OPENAI-PLATFORM-CAPABILITY-EVIDENCE-2026-11-05.md).
