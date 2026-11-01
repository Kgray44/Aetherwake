# 10 — AI Execution Profiler
## Governing Charter for Aerynth's Execution Timing, Token Accounting, Efficiency, and Diagnostic Intelligence

| Field | Value |
|---|---|
| Document ID | AW-GOV-010 |
| Version | 1.1.0-draft |
| Status | **Published governing charter — awaiting repository-owner acceptance** |
| Prepared | 2026-11-01 |
| Authority | Specialized subsystem charter, subordinate to [00 — Aetherwake Constitution](00-AETHERWAKE-CONSTITUTION.md) |
| Primary domain | AI execution measurement, temporal profiling, token accounting, context utilization indicators, usage budgets, efficiency analysis, and profiler presentation |
| Normative requirement namespace | **AW-AEP-###** |
| Constitutional anchors | AW-CON-002, 008–009, 017–021, 034–035, 041–046, 051–061, **062–065**, 069–079, 080–089 |
| Coordinating charters | 02 Liquid Intelligence; [03 Resources](03-PROJECTS-WORKSPACES-AND-RESOURCES.md); [04 Conversations](04-CONVERSATIONS-AND-CONNECTED-BRANCHES.md); 05 Agents; [06 Vela](06-VELA-INTELLIGENCE-AND-ADAPTATION.md); 08 CIE; 09 Intelligence Streams; 11 Timelines; 12 Codex Integrations; 13 Performance; 14 Trust; 15 Quality |
| Intended readers | Profiler engineers, backend-adapter developers, observability engineers, UX designers, CIE researchers, evaluation authors, and project maintainers |
| Disclosure boundary | Public requirements only; no private usage records, billing details, credentials, user prompts, or real operational traces |

> **Core promise.** Every AI conversation, agent, task, and execution SHOULD make its actual resource usage and elapsed activity understandable: how long it ran, where time was spent, what the backend reported about tokens, how context and tools contributed, and whether that effort produced a verified useful result.
>
> **Truth promise.** Aerynth MUST never manufacture token counts, internal thinking durations, context-window occupancy, monetary charges, or execution progress. **Observed**, **provider-reported**, **derived**, **estimated**, and **unknown** measurements remain distinguishable everywhere.
>
> **Experience promise.** Profiling is detailed enough for engineering investigation, visually extraordinary enough to belong to Liquid Intelligence, and quiet enough not to burden ordinary chatting or consume the very resources it measures.
>
> **Optimization promise.** Lower token consumption is useful only if answer quality, task completion, correctness, and user control are preserved. Token thrift is not a license to discard essential context or to claim successful work that was not verified.

---

## 1. Authority, purpose, and domain ownership

This charter governs the **AI Execution Profiler** (AEP), the authoritative subsystem for **measurement semantics, metric attribution, accounting, comparative efficiency, budgets, and profiler-specific surfaces**. It specifies product behavior and verifiable contracts rather than prematurely selecting a particular database, charting library, graphics engine, API transport, or pricing provider.

The Aetherwake Constitution has precedence. The repository owner retains final authority. Publication does not constitute acceptance. **MUST**, **MUST NOT**, **SHOULD**, and **MAY** carry their constitutional normative meanings.

**Owned here:** execution and timing definitions; token and context metrics; usage rollups; model/provider attribution; economic reporting boundaries; soft and enforceable budgets; quality-adjusted efficiency; metric completeness; AI profiler presentation; profiling instrumentation overhead; domain-specific diagnostic tests.

**Owned elsewhere:** raw Intelligence Event Bus, stream provenance and replay fidelity (09); context assembly/compaction and optimization decisions (08); task success and verified evidence (05 and 15); user identity and canonical object relationships (03 and 04); Vela initiative behavior (06); timeline engines (11); provider protocols (12); global rendering performance and GPU policy (13); retention, privacy, approvals, and spending authority (14). This charter consumes those contracts rather than redefining them.

**AW-AEP-001 — Constitutional conformity.** All profiler behavior MUST comply with the Constitution, especially AW-CON-062 through AW-CON-065; conflicts MUST be treated as governance issues rather than silently resolved in implementation.

**AW-AEP-002 — First-class profiling.** Live, per-execution timing and available token metrics MUST be core capabilities, accessible directly from ordinary chats as well as from agent, task, and project views.

**AW-AEP-003 — Nonintrusive baseline.** A user MUST be able to converse and use Codex without configuring budgets, opening a dashboard, creating a task, or consenting to optional analytics beyond what is necessary for the requested execution.

**AW-AEP-004 — No false precision.** Unavailable data MUST be shown as unavailable, not zero; inferred numbers MUST NOT be presented as authoritative server measurements.

**AW-AEP-005 — Stable requirement ownership.** Other charters MAY reference AW-AEP rules; they MUST NOT redefine time, token, context-occupancy, or efficiency measurement semantics incompatibly.

## 2. Conceptual model and definitions

| Concept | Meaning |
|---|---|
| **Conversation/chat** | User-visible conversational resource; may contain multiple turns and task executions |
| **Thread** | Backend conversation/session identity, which may not map one-to-one to an Aerynth chat |
| **Turn** | Backend response cycle to an input; may include model work and multiple tool operations |
| **Execution/run/attempt** | One attributable effort to achieve an objective, possibly containing multiple turns |
| **Task** | Persistent intended outcome; may contain failed, retried, delegated, or parallel executions |
| **Agent** | Worker identity or profile; may participate in many runs |
| **Provider/model route** | Actual executing backend/model combination, which may change mid-run |
| **Span** | Time-bounded measurable operation, such as tool invocation, provider interaction, approval wait, or streamed output |
| **Metric sample** | Timestamped observed/reported/derived metric with unit, attribution, and provenance |
| **Counter** | Monotonic accumulated metric within its stated scope, unless backend explicitly corrects it |
| **Gauge** | Point-in-time reading, such as currently reported context occupancy |
| **Usage report** | Provider-reported consumption for a specified interval and aggregation scope |
| **Budget** | Target or policy for usage; not inherently an enforced limit |
| **Outcome** | Verified result state, with evidence and acceptance criteria distinct from an agent's final message |
| **Coverage** | How much of the expected events, time, scopes, and fields is actually observed |
| **Profiler panel** | Interactive presentation of measurements, provenance, timelines, and diagnostics |

An Aerynth chat, a Codex thread, an agent, and a task MUST remain different identities; profiling MUST NOT force a one-to-one relationship.

**AW-AEP-006 — Canonical attribution.** Metrics MUST retain stable references to applicable project, workspace, conversation, backend thread, turn, task, execution/attempt, agent, provider, and model where known. Unknown relationships MUST remain unknown.

**AW-AEP-007 — Many-to-many operation.** Delegated subagents, shared chat resources, parallel tasks, and backend thread forks MUST be supported without silently duplicating an underlying measured charge or duration.

**AW-AEP-008 — Scope labels.** Every metric view MUST identify its aggregation scope and measurement window. A number such as “14,000 tokens” without its scope and counter definition is insufficient.

**AW-AEP-009 — Metric units.** Persisted metric values MUST declare units, dimensions, and counter/gauge semantics; time metrics SHOULD use a high-resolution representation with explicit display rounding.

**AW-AEP-010 — Versioned vocabulary.** Metric definitions and adapters MUST be versioned so that historical values remain interpretable after provider changes.

## 3. Measurement integrity and evidence classification

The profiler uses the following confidence classes. These classes describe the **origin of a metric**, not whether the associated task is correct:

| Class | Definition | Example |
|---|---|---|
| **Observed** | Directly timed or counted by Aerynth at an explicit boundary | Local wall-clock interval between event receipt and tool completion |
| **Provider-reported** | Value received from the authenticated execution backend | Token usage field returned by Codex |
| **Derived** | Deterministic calculation over identified observations | Completed duration = end timestamp minus start timestamp |
| **Estimated** | Approximation, heuristic, sample extrapolation, or uncertain attribution | Tool overhead attributed from partial timing |
| **Unavailable** | Not exposed, not captured, not applicable, or not reliably reconstructible | Exact private model thinking time |

**AW-AEP-011 — Provenance on every metric.** Persisted metric samples MUST include source class, collector/adapter identity, source event reference where available, collection timestamp, scope, unit, and schema version.

**AW-AEP-012 — Semantic transparency.** A detailed view MUST expose the metric's definition, evidence source, coverage, last update, and any known limitation. Compact views SHOULD provide a concise hover/inspection path.

**AW-AEP-013 — Distinct missing states.** The system MUST distinguish zero, not applicable, not reported, not yet received, redacted, stale, estimated, and collection failed.

**AW-AEP-014 — No invented reasoning observation.** The profiler MUST NOT claim access to a complete private chain of thought, internal token-by-token cognition, or exact internal processing phases unless the provider explicitly and permissibly exposes the particular measurement.

**AW-AEP-015 — Late corrections.** Corrected provider reports MUST be stored with supersession metadata, not silently summed atop the values they replace. The user SHOULD be able to inspect material corrections.

**AW-AEP-016 — Coverage indicator.** Incomplete, disconnected, sampled, delayed, or partially recovered instrumentation MUST be reflected in visible data-quality indicators and export metadata.

**AW-AEP-017 — No decorative measurements.** Cinematic instruments, numeric gauges, and activity pulses MUST reflect actual events or explicitly labeled demonstration data; no fake animated token increments or invented utilization curves.

**AW-AEP-018 — Compare like with like.** Comparisons MUST identify material differences in collection coverage, provider, model, task type, configuration, data quality, and outcome verification.

## 4. Execution lifecycle and timing model

The profiler SHOULD distinguish at least the following conceptual instants where observable: submission, queue admission, provider acceptance, turn start, first observable content, tool start, tool end, final content, turn completion, verification completion, and task acceptance. Not all backends expose all boundaries.

**AW-AEP-019 — Wall-clock versus monotonic time.** Duration measurement MUST prefer a monotonic clock within a process. Wall-clock UTC timestamps MUST be retained for cross-system correlation and display. A wall-clock change MUST NOT corrupt a local elapsed timer.

**AW-AEP-020 — Precise timer boundaries.** Every timer MUST document its start and stop events, supported platform clock, pause behavior, and expected handling of missing events.

**AW-AEP-021 — Concurrent accounting.** Overlapping tool/model/stream/approval spans MUST retain their overlap. The interface MUST NOT pretend overlapping categories add cleanly to total elapsed time.

**AW-AEP-022 — Distinguish run and task duration.** A turn finishing MUST NOT automatically end a multi-turn task; a task completing MUST NOT retroactively redefine the individual attempt durations.

**AW-AEP-023 — Per-chat running counter.** An active chat MUST offer a live elapsed counter and available token usage counter for the relevant execution, with accessible detail for prior turns and totals.

**AW-AEP-024 — Lifecycle outcomes.** Timers MUST account for completed, failed, interrupted, cancelled, approval-blocked, retried, disconnected, and abandoned attempts without falsely labeling an incomplete run “complete.”

**AW-AEP-025 — First-visible-content latency.** The profiler SHOULD measure time from an explicit submission boundary to the first actually received/displayable assistant content; this MUST NOT be conflated with the first tool event, first model token, or complete answer.

**AW-AEP-026 — Streaming interval.** The profiler MUST distinguish elapsed wall time during an active response from time in which text or event deltas were actually arriving; gaps and pauses MUST NOT be masked as continuous token streaming.

**AW-AEP-027 — Tool time.** When item start/completion events exist, tool execution spans SHOULD be measured separately from model-deliberation intervals; nested or parallel tools MUST preserve span hierarchy.

**AW-AEP-028 — Approval and human wait.** Approval wait and human intervention periods MUST be distinguished from active model or tool work whenever observable.

**AW-AEP-029 — Idle and suspended time.** Application suspension, sleep, offline periods, and disconnected streams MUST be reflected as separate states or qualified elapsed measurements.

**AW-AEP-030 — No exact “thinking time” inference.** Pre-output latency, gaps between events, or elapsed time without tools MUST NOT be labeled exact internal model thinking time. A user-facing “thinking” indicator MAY describe an observable processing state if qualified.

**AW-AEP-031 — Nested execution.** Delegated agents and subcalls MUST use parent/child or causal references; the profiler SHOULD show both each worker's elapsed duration and the critical-path wall time for the parent task.

**AW-AEP-032 — Multi-host clocks.** Cross-host event intervals MUST account for clock offsets and uncertainty; time spans that require unsynchronized clocks MUST be marked uncertain rather than given spurious millisecond precision.

### 4.1 Required timer taxonomy

| Timer | Preferred boundary | Important caveat |
|---|---|---|
| Submission-to-start | User/application submission → accepted run start | Queue/admission semantics vary |
| Time to first visible content | Submission → first supported user-visible content delta | Not synonymous with first model token |
| Active turn elapsed | Start event → completion/interrupt/failure | Includes overlapping tool and wait periods |
| Text streaming span | First text delta → last text delta | Contains possible pauses; not continuous decoding time |
| Tool invocation duration | Tool item start → authoritative completion | Backend may provide a separate duration field |
| Approval wait | Approval request → resolved decision | May overlap with other concurrent work |
| Observable model-processing interval | Gap or reported provider span with explicitly defined boundaries | Not private chain-of-thought duration |
| Verification elapsed | Verification operation start → evidence-based completion | Not necessarily inside the Codex turn |
| Task calendar duration | Task creation or activation → final accepted closure | Includes queues, gaps, and multiple runs |

A timeline MAY display both exclusive and inclusive durations. Exclusive category estimates MUST be qualified if precise boundaries are unavailable.

## 5. Streaming events, adapters, and reconciliation

Codex is the initial backend, but exact provider fields MUST be discovered and validated against the installed version rather than assumed permanent. As of charter preparation, official App Server documentation describes thread and turn events, item lifecycle and delta events, token-usage notifications, and command-execution timing fields. The profiler relies on a **versioned adapter** that maps available events into canonical metrics; it does not assume unexposed model internals are observable.

**AW-AEP-033 — Event-driven acquisition.** Native structured backend events SHOULD be the primary source for lifecycle, tool, and token metrics, rather than parsing prose from an assistant response or scraping a rendered terminal.

**AW-AEP-034 — Provider capability negotiation.** Each adapter MUST declare supported timing, token, usage, context, and budget capabilities, including their freshness, attribution scope, and accuracy limitations.

**AW-AEP-035 — Live updates.** The UI SHOULD update promptly after a meaningful event without implying a continuous metric stream when none has arrived.

**AW-AEP-036 — Snapshot-versus-delta discipline.** Adapters MUST identify whether a value is cumulative, incremental, final, or a correction before aggregation. Repeated cumulative reports MUST NOT be added together.

**AW-AEP-037 — Idempotent ingestion.** Event IDs, source IDs, and sequence/correlation data MUST be used where provided to prevent double counting across reconnections and replay.

**AW-AEP-038 — Out-of-order processing.** Late, duplicated, missing, or reordered events MUST be handled by a deterministic reconciliation policy; arrival order MUST NOT be mistaken for actual execution order when stronger ordering metadata is available.

**AW-AEP-039 — Final reconciliation.** When a final authoritative usage or duration value arrives, provisional metrics MUST be reconciled and marked final or corrected, without erasing auditability.

**AW-AEP-040 — Stream gaps.** A disconnected stream MUST produce an explicit gap or uncertain coverage interval. Restarting the UI MUST NOT silently convert a partial observation into a complete history.

**AW-AEP-041 — Degraded providers.** When a backend exposes only coarse usage, Aerynth MUST still offer the supported coarse metrics and MUST clearly disable unsupported breakdowns.

**AW-AEP-042 — Adapter quarantine.** Invalid units, negative usage, implausible timestamp regressions, malformed identifiers, or contradictory deltas MUST be flagged and excluded from trusted aggregates pending reconciliation.

**AW-AEP-043 — No log scraping assumption.** Aerynth MUST NOT claim to intercept private backend tool calls, hidden prompts, inaccessible provider accounting, or raw reasoning merely because the user can see related output in another surface.

## 6. Token accounting and token categories

Token counts may be reported as totals, input/output components, cached input, reasoning output, tool-related usage, or other provider-specific categories. The available dimensions depend on provider, model, account, API version, and execution mode.

**AW-AEP-044 — Canonical usage record.** A reported usage record MUST retain original source fields and a normalized interpretation with scope, interval, provider, model route, unit, and provenance.

**AW-AEP-045 — Reported categories only.** Input, output, cached, reasoning, and other subcategories MUST appear as measured values only when supported and reported. Absent fields MUST NOT be back-solved from an unsupported assumption.

**AW-AEP-046 — Category accounting relationships.** The profiler MUST document whether a subcategory is included in or additional to another category. Cached input and reasoning tokens MUST NOT be automatically added to totals that already include them.

**AW-AEP-047 — Avoid double counting tool usage.** Provider-reported tool/token consumption, local secondary-model calls, and external plugin/API consumption MUST be attributed under explicitly documented accounting boundaries.

**AW-AEP-048 — Token update reconciliation.** Incremental usage events, aggregate thread snapshots, and final turn totals MUST be reconciled without duplication. Per-turn totals MAY remain unknown when a provider reports only a thread-level total.

**AW-AEP-049 — Model routing.** When the execution model changes or is rerouted, usage MUST retain the actual reported model per segment where available. Unattributed usage MUST NOT be forcibly assigned to the originally requested model.

**AW-AEP-050 — Attempts and retries.** Tokens consumed by unsuccessful attempts, retries, re-prompts, and abandoned work MUST count toward the real observed consumption of the containing task where attributable.

**AW-AEP-051 — Reasoning privacy.** A reported count of reasoning tokens is a usage metric, not access to the reasoning text. The UI MUST NOT imply that a reasoning-token count unlocks the model's private thought process.

**AW-AEP-052 — Precision and rounding.** Store integer provider token counts exactly where reported; compact UI rounding MUST NOT alter persisted values or silently substitute estimates.

**AW-AEP-053 — Token accounting exports.** Exported breakdowns MUST include raw reported values or provenance links, normalization rules, aggregation boundaries, and quality/coverage flags.

### 6.1 Live usage behavior

- A compact chat footer SHOULD display elapsed time, streaming state, and the latest available token total.
- During an active turn, reported usage MAY arrive intermittently. The counter SHOULD state **last updated** and, where useful, **provisional**.
- The UI MUST NOT interpolate a supposedly exact token count between provider reports merely to animate a gauge.
- Where no token usage is available yet, show **awaiting usage** rather than 0.
- When the backend changes accounting semantics, the adapter MUST version the mapping and annotate affected comparisons.

## 7. Context-window and compaction measurements

Context size, tokens billed as input, conversation history length, and reported context-window occupancy are **different measurements**. CIE owns context construction and retrieval; AEP owns accurate display and comparison of measured context metrics.

**AW-AEP-054 — Context semantic separation.** The profiler MUST distinguish estimated active context content, provider-reported context usage, cumulative input tokens, cache hits, and archived conversation length.

**AW-AEP-055 — Occupancy denominator.** A context-occupancy percentage MUST NOT be shown without a justified numerator and applicable model context-window denominator. Unknown or fluctuating denominators require a qualified or unavailable display.

**AW-AEP-056 — Context event correlation.** Supported compaction, checkpoint, retrieval, and thread-transition events SHOULD appear as annotated profiler milestones linked to their authoritative CIE or observability records.

**AW-AEP-057 — No implied compaction savings.** A compaction event alone MUST NOT be declared a token reduction. Claims require comparable before/after measurements and quality checks.

**AW-AEP-058 — Retrieval accounting.** Where CIE provides the amount of material added or omitted, AEP MAY display it as application-managed context volume; it MUST NOT automatically call it provider-billed input tokens.

**AW-AEP-059 — Decay and time views.** Profiler visualizations MAY correlate usage with memory-decay checkpoints, but knowledge retention/compaction policies remain governed by Charter 08.

**AW-AEP-060 — Large-session diagnostics.** The profiler SHOULD help distinguish backend context limits from frontend transcript-rendering slowdowns, network delay, tool execution, and file-system activity.

## 8. Usage budgets, quotas, and control semantics

A budget may be advisory, a notification threshold, a controller-level admission limit, or a genuinely enforced ceiling. These are not interchangeable.

| Policy class | Meaning | Guarantee |
|---|---|---|
| **Target** | Desired consumption or efficiency goal | No enforcement |
| **Alert threshold** | Notify when reported/estimated use approaches a value | Notifications, with reporting lag |
| **Admission control** | Refuse or defer launching work judged likely to exceed a remaining allocation | Prevents some new work; does not constrain in-flight usage |
| **Best-effort interruption** | Attempt to cancel or steer at a threshold | Can overshoot while work is in flight |
| **Provider-enforced limit** | Backend/provider guarantees a documented maximum within a defined scope | Only as strong as the actual documented enforcement contract |

**AW-AEP-061 — Budget scope.** Budgets MUST identify scope (turn, run, agent, task, conversation, project, provider account, or API billing context), unit, time window, reset policy, and inheritance source.

**AW-AEP-062 — Visible enforcement class.** Budget controls MUST explicitly distinguish targets, alerts, admission control, best-effort cancellation, and truly enforced limits.

**AW-AEP-063 — No unsupported hard cap.** The UI MUST NOT promise that a local counter, scheduled check, or interrupt request guarantees an absolute token/spend ceiling.

**AW-AEP-064 — Overshoot disclosure.** Users MUST be informed when in-flight requests, delayed usage reports, retries, or external tools can consume additional tokens after a threshold is reached.

**AW-AEP-065 — User-priority controls.** Users SHOULD be able to set soft budgets and warning thresholds at global, project, workspace, chat, task, and agent levels, with explicit conflict resolution and inherited-value display.

**AW-AEP-066 — Safe task continuation.** Budget exhaustion MUST NOT silently delete results, discard uncommitted work, fabricate successful completion, or bypass applicable safety/approval requirements. The task SHOULD retain a resumable checkpoint where feasible.

**AW-AEP-067 — Override governance.** Increasing a budget does not increase tool privileges or spending authorization. Budget overrides MUST obey the separate permission policy, with clear audit attribution.

**AW-AEP-068 — Low-cost local operations.** Budget policy SHOULD avoid model calls for deterministic local display, search, formatting, and navigation that need no inference, in coordination with CIE.

**AW-AEP-069 — Spend authority.** API-key charges and external paid services MUST use explicit authorization policies; selecting an estimated token target alone MUST NOT authorize additional paid execution.

**AW-AEP-070 — Cross-task allocations.** Shared project budgets SHOULD account for simultaneous agents, reserved capacity, pending runs, and stale usage reports without treating estimated allocations as already-billed tokens.

## 9. Subscription usage, API billing, and cost reporting

ChatGPT-plan capacity, Codex provider quotas, API usage, third-party model charges, local CPU/GPU consumption, and time spent are separate dimensions. A token count does **not** uniquely determine monetary cost in a subscription-based plan.

**AW-AEP-071 — Distinct economic domains.** Subscription allowance/quota indicators MUST remain separate from metered API usage, third-party invoices, estimated model-equivalent cost, and local system-resource metrics.

**AW-AEP-072 — No fabricated pricing.** Monetary cost MUST NOT be derived from tokens unless applicable pricing, discounts, cache rules, billing mode, currency, and provider contract are known for the relevant usage. Otherwise show **cost unavailable** or a clearly labeled nonbilling estimate.

**AW-AEP-073 — Real account quota reporting.** Account usage windows and remaining allowance MAY be displayed only when an authorized provider exposes them; the UI MUST preserve provider reset timing and qualification.

**AW-AEP-074 — Price provenance.** Historical cost calculations MUST retain applicable rate-plan versions, currency, conversion assumptions, and whether the number is billed, estimated, or hypothetical.

**AW-AEP-075 — Quota not cost.** “Remaining usage,” “requests left,” “token equivalents,” and “dollars spent” MUST NOT be treated as interchangeable metrics.

**AW-AEP-076 — Explicit user-facing coverage.** Where the app aggregates several providers/accounts, it MUST display which are connected, which have current cost data, and which are excluded.

## 10. Aggregation, concurrency, and efficiency

The profiler must support rollups by turn, run, chat, agent, task, project, model, and selected time window while preserving the ability to inspect constituent evidence.

**AW-AEP-077 — Additive token accounting.** A measured token unit MUST enter an aggregate only once for each chosen accounting scope. Shared tasks and reused conversations MUST NOT double-count merely because they appear in several workspaces.

**AW-AEP-078 — Duration rollups.** Total wall-clock duration for parallel work MUST be based on elapsed intervals, not the simple sum of concurrent agent durations. Aggregate worker-time MAY be displayed as a separate metric.

**AW-AEP-079 — Critical path.** For dependency-linked tasks, the profiler SHOULD show observable critical-path time and distinguish it from total accumulated worker-time and calendar time.

**AW-AEP-080 — Verified-outcome denominator.** “Tokens per completed task” MUST disclose whether the task is merely marked complete or independently verified against acceptance criteria. The preferred quality-adjusted metric uses accepted/verified outcomes.

**AW-AEP-081 — Failure accounting.** Retries, rollbacks, corrective rework, and unsuccessful runs MUST remain attributable; efficiency measures MUST NOT exclude them by default to improve apparent performance.

**AW-AEP-082 — Fair comparisons.** Model, agent, and strategy comparisons SHOULD normalize or stratify by task difficulty, output requirements, tool availability, context scope, verification strength, and confidence interval where feasible.

**AW-AEP-083 — No optimization-by-appearance.** Lower tokens, higher tokens-per-second, or shorter wall time MUST NOT alone be represented as proof of better task completion quality.

**AW-AEP-084 — Source drilldown.** Every aggregate SHOULD support navigation to the component executions or reported source intervals, subject to retention and authorization.

**AW-AEP-085 — Attributed savings.** Claims that a prompt change, caching strategy, CIE profile, or compaction reduced usage MUST distinguish controlled results from observational correlation.

### 10.1 Recommended efficiency metrics

- **Reported tokens per verified task** = attributable reported tokens / verified accepted outcomes; undefined when the denominator is zero.
- **First-pass acceptance rate** = verified tasks accepted on the first attempt / eligible tasks with sufficient evidence.
- **Rework ratio** = effort on corrective attempts / total attributable task effort, with a defined effort unit.
- **Observed wall time per verified result** = task critical-path time / verified outcomes, with a declared cohort.
- **Token distribution** = reported tokens by model/provider, agent, task type, or project.
- **Tool wait ratio** = observed eligible tool-wait duration / measured elapsed duration; overlapping spans must be treated consistently.
- **Coverage-adjusted reporting** = show excluded runs and missing token/time data rather than silently treating them as zero.

These are analysis conventions, not universal scalar scores. The profiler MUST NOT collapse all outcomes into a deceptively precise “agent IQ” or productivity ranking.

## 11. Cinematic profiler experience and interaction

The Execution Profiler is a first-class part of **Liquid Intelligence**. It must be discoverable from a chat without cluttering the everyday conversation experience. The Motion Coordinator may animate graphs and state changes, but the animation must be semantically tied to data.

**AW-AEP-086 — Universal entry points.** Users MUST be able to open relevant profiler information from an active chat, agent, task, project, and Intelligence Stream where available.

**AW-AEP-087 — Compact live status.** Every supported chat SHOULD offer an unobtrusive live strip showing running elapsed duration, response/stream state, and the latest reported token count with provenance/accessibility affordances.

**AW-AEP-088 — Progressive depth.** The interface MUST offer at least a concise summary, an expanded breakdown, and an advanced diagnostics view without imposing advanced metrics on normal chat use.

**AW-AEP-089 — Meaningful animation.** Token counts, context rings, pulses, transitions, timelines, and charts MUST change only as supported by observed or reported data; interpolation MAY smooth presentation but MUST NOT invent additional measurements.

**AW-AEP-090 — Detail without clutter.** Users SHOULD be able to filter and compare by project, model, agent, run, task, event category, and window, with sensible presets and saved views.

**AW-AEP-091 — Contextual Command integration.** A selected point, interval, run, model segment, or anomaly SHOULD become a typed, attributable selection that Vela can use for analysis without resorting to screen-coordinate guessing.

**AW-AEP-092 — Explainability.** Users MUST be able to inspect what any gauge or chart means, how it was computed, why it changed, and where its data came from.

**AW-AEP-093 — Accessible alternatives.** All significant data MUST be available as text and accessible tables/controls; reduced-motion, keyboard, screen-reader, and color-independent interpretations MUST be supported.

**AW-AEP-094 — Adaptive visual quality.** Profiler effects MUST obey the six-system Motion Coordinator and platform performance policies, gracefully reducing GPU work under load while retaining readable metrics.

**AW-AEP-095 — Scope-aware persistence.** Saved profiler layouts and filters SHOULD restore within their original workspace or display arrangements without altering canonical metric values.

**AW-AEP-096 — Honest empty states.** Before execution, while usage is pending, after disconnect, or when instrumentation is unavailable, the UI MUST explain its state rather than filling charts with plausible-looking synthetic data.

### 11.1 Required visualization families

| Visualization | Required interpretive behavior |
|---|---|
| **Live execution strip** | Elapsed, response state, last-known usage, updating/paused/stale status |
| **Turn/run timeline** | Observable boundaries, tool spans, stream intervals, approval waits, missing-data gaps |
| **Token waterfall/stack** | Reported component inclusion relationships, final versus provisional totals |
| **Context gauge** | Exact/report/estimate labeling; no percentage without valid denominator |
| **Comparative dashboard** | Like-for-like cohorts, quality filters, coverage, and model/provider context |
| **Project analytics** | Time and token trends, task outcomes, retry costs, active work |
| **Agent efficiency view** | Observable tool/model balance, verified results, scoped attribution |
| **Budget visualization** | Target, reported consumption, alerts, overshoot risk, enforcement type |
| **Anomaly inspector** | Unusual latency/usage intervals linked to evidence and actual events |
| **Exportable data table** | Units, scope, methodology, missing values, and trace references |

## 12. Integration with Intelligence Streams, CIE, Vela, and tasks

**AW-AEP-097 — Observability-source boundary.** Charter 09 owns event capture, evidence classes, stream completeness, event replay, and raw execution provenance. The profiler MUST consume these without redefining raw event truth.

**AW-AEP-098 — CIE feedback contract.** The profiler SHOULD provide quality-qualified usage, repeated-context patterns, compaction comparisons, and tool-output measurements to CIE through typed, provenance-preserving interfaces.

**AW-AEP-099 — No forced optimizations.** Profiling findings MUST NOT independently delete context, change model settings, interrupt work, or reduce verification standards. Changes require authorized CIE, Vela, or user policies.

**AW-AEP-100 — Vela interpretation.** Vela MAY explain anomalies, tradeoffs, and recommendations using the profiler, but MUST distinguish evidence from inference and cite the underlying intervals/events in the application.

**AW-AEP-101 — Task-result semantics.** The profiler MUST obtain completion and verification states from the task/acceptance authority; it MUST NOT infer success merely because a turn ended cleanly.

**AW-AEP-102 — Historical timeline boundary.** Charter 11 owns general timeline and replay navigation. AEP owns timing calculations and profiler-specific presentation of those events.

**AW-AEP-103 — Cross-resource authorization.** An aggregate or Vela analysis spanning projects, chats, or providers MUST respect the access boundary of every underlying record; visibility in one block is not automatic permission to expose private detail elsewhere.

**AW-AEP-104 — Explainable recommendations.** Proposed optimization SHOULD state the observed issue, suggested intervention, expected tradeoff, confidence, and verification method.

**AW-AEP-105 — Outcome-first policy.** Profiler-generated recommendations MUST preserve task success, information integrity, necessary context, safety controls, and final user authority.

## 13. Instrumentation architecture and event-store expectations

A reference architecture comprises source adapters → ingestion/reconciliation → metric/span store → aggregation/analysis → presentation and authorized automation. This is a contract boundary, not a mandated implementation stack.

### 13.1 Minimal normalized metric envelope

An implementation SHOULD represent, where applicable:

| Field | Requirement |
|---|---|
| metric_id | Stable unique sample or aggregate identifier |
| source_event_id | Original event reference or null with explanation |
| capture_time_utc | Collection wall-clock time and precision |
| source_time_utc | Provider event time when available, with uncertainty |
| monotonic_time | Process-local timing reference where available |
| measurement_scope | Thread/turn/run/task/agent/chat/project/account and ID(s) |
| provider/model | Actual reported route where available |
| metric_name, value, unit | Typed metric definition and value |
| kind | Counter, gauge, duration, interval, distribution, or estimate |
| provenance_class | Observed, provider-reported, derived, estimated, unavailable |
| status | Provisional, final, corrected, stale, missing, rejected |
| mapping_version | Collector and normalization schema |
| coverage | Relevant missing events, sampling ratio, incomplete ranges |
| privacy_class | Retention/export/access requirements |
| relationships | Parent span, causal links, delegation and trace IDs |

**AW-AEP-106 — Typed ingestion.** Metric APIs MUST validate identity, unit, scope, data type, temporal ordering, and version information before accepting authoritative aggregates.

**AW-AEP-107 — Preserve raw evidence selectively.** Where permitted, raw provider usage fields and relevant event references SHOULD remain inspectable under appropriate retention and redaction policy; summaries MUST NOT erase canonical records without authorized retention action.

**AW-AEP-108 — Bounded instrumentation.** Sampling, delta batching, throttled rendering, and off-main-thread aggregation SHOULD prevent telemetry itself from causing significant rendering stalls, runaway memory usage, or inflated model costs.

**AW-AEP-109 — No recursive model tax.** The profiler MUST NOT invoke an AI model on each token/event update. Optional natural-language explanation SHOULD be user-initiated or governed by an explicit low-frequency initiative policy.

**AW-AEP-110 — Crash-consistent metrics.** Buffered events and execution states SHOULD be safely persisted or reconciled after crashes and restarts, with any irrecoverable gaps reported.

**AW-AEP-111 — Schema migration.** Historical measurement definitions MUST remain reconstructible or annotated through schema migrations; a new adapter MUST NOT silently rewrite old facts to fit new reporting rules.

**AW-AEP-112 — Health monitoring.** The profiler SHOULD report its own collector lag, dropped events, reconciliation backlog, storage pressure, and last-successful-provider update without confusing profiler health with agent health.

## 14. Privacy, resource costs, and failure behavior

Profiling metadata may reveal sensitive activity even when message content is not stored. File paths, command names, project names, token usage, timestamps, account identifiers, and recorded outputs require appropriate protections.

**AW-AEP-113 — Minimum necessary collection.** Collect the least sensitive data sufficient to satisfy authorized profiling goals. Full prompts, command outputs, and file contents MUST NOT be duplicated into analytics storage merely for token accounting.

**AW-AEP-114 — Retention controls.** Telemetry retention, sampling, export, purge, and redaction MUST follow applicable user-approved policies. Where allowed, retaining aggregate metrics while expiring detailed traces SHOULD be supported.

**AW-AEP-115 — Safe exports.** Profiler exports MUST identify contained private metadata, offer suitable redaction/scoping, and preserve measurement quality/provenance labels.

**AW-AEP-116 — Provider credentials.** API keys, session tokens, authentication material, and raw privileged connector payloads MUST NOT appear in profiler UI, telemetry events, exports, or the public repository.

**AW-AEP-117 — Offline truthfulness.** Offline/local history MUST remain available where stored, with last-sync timestamps; the UI MUST NOT claim live backend coverage while disconnected.

**AW-AEP-118 — Safe fallbacks.** Profiler failure MUST NOT corrupt conversation histories, break ordinary local navigation, increase agent privileges, or cause silent user-work loss.

**AW-AEP-119 — Permission preservation.** Profiling and diagnostic tools MUST NOT circumvent task sandbox, provider restrictions, user permissions, or workspace access policies.

**AW-AEP-120 — Collection-cost visibility.** The application SHOULD disclose material telemetry disk, CPU, GPU, network, and optional AI-analysis overhead, and provide sensible resource-efficient defaults.

## 15. Acceptance requirements and adversarial test matrix

The following tests are **minimum observable acceptance expectations**. Test fixtures MUST identify whether data is simulated or recorded from a supported backend. Acceptance requires functional, visual, accessibility, performance, security, and evidence review under Charter 15; a pretty dashboard alone is not completion.

| Test | Required observable result |
|---|---|
| **AEP-T01: Ordinary chat** | Launch a simple conversation; elapsed timer and state work without a project/task requirement; usage displays only if reported |
| **AEP-T02: Delayed usage** | Before first usage report, show pending; after update, show exact reported scope and last-updated state |
| **AEP-T03: Cumulative reports** | Replayed and repeated cumulative usage snapshots do not inflate totals |
| **AEP-T04: Provider correction** | Corrected usage replaces/supersedes provisional value with audit evidence |
| **AEP-T05: Missing token categories** | Unsupported cache/reasoning breakdowns show unavailable, not zero or inferred |
| **AEP-T06: Streaming pause** | Text streaming interval and its gaps remain distinct from continuous decoding claims |
| **AEP-T07: Tool overlap** | Concurrent tool durations do not sum into a fictional larger wall-clock execution |
| **AEP-T08: Human approval** | Approval wait is attributable and not misrepresented as model thinking |
| **AEP-T09: Model reroute** | Usage and charts attribute known segments to actual model routes, with unattributed segments labeled |
| **AEP-T10: Thread fork** | Shared ancestry and post-fork work do not duplicate provider usage by visual membership alone |
| **AEP-T11: Parallel agents** | Parent wall time, subagent worker-time, task critical path, and token aggregation remain distinct |
| **AEP-T12: Task retry** | Failed/retried work remains in total consumption; verified completion status comes from acceptance evidence |
| **AEP-T13: Context gauge** | Missing or uncertain model-window denominator prevents an unjustified occupancy percentage |
| **AEP-T14: Compaction** | Compaction milestone appears; no savings claim until comparable evidence exists |
| **AEP-T15: Soft budget overshoot** | A running request can exceed an alert threshold and the UI does not claim guaranteed enforcement |
| **AEP-T16: ChatGPT vs API** | Subscription capacity and actual billable API charges are never mixed or priced as if equivalent |
| **AEP-T17: Reconnection** | Duplicated events are reconciled; missing intervals remain explicitly marked |
| **AEP-T18: System sleep and clock skew** | Timers recover or qualify unknown elapsed intervals without negative durations |
| **AEP-T19: Provider absence** | No tokens/context are invented; local history and unrelated workspace functions remain accessible |
| **AEP-T20: Sensitive metadata** | Logs/exports redact keys and respect project permissions; filtered aggregates do not leak excluded records |
| **AEP-T21: Rendering under load** | Live panels remain responsive while tracing many agents; presentation can reduce fidelity without changing data |
| **AEP-T22: Accessible inspection** | All essential metrics, uncertainty, charts, alerts, and controls are accessible without motion or color cues |
| **AEP-T23: Efficiency A/B** | Optimization claim reports token/time outcomes, verified quality, coverage, and task comparability |
| **AEP-T24: UI semantics** | The “thinking” field does not claim exact hidden reasoning time; data classes remain visible |
| **AEP-T25: Restart and retention** | Crash/restart restores recorded metrics and marks gaps; retention removes data only under authorized policy |
| **AEP-T26: Export reconciliation** | Exported totals reproduce visible aggregate numbers from cited records under documented rules |

**AW-AEP-121 — Evidence-based acceptance.** Each material profiler requirement MUST have an applicable verification method, result, and provenance; untested behavior MUST NOT be reported as verified.

**AW-AEP-122 — Real backend qualification.** Acceptance SHOULD include a supported real Codex integration with streamed events, plus synthetic adversarial fixtures for edge cases unavailable on demand.

**AW-AEP-123 — Visual acceptance.** Profiler blocks, live gauges, timelines, and state transitions MUST be reviewed under the Liquid Intelligence standard, including semantic motion, readability, reduced-motion equivalence, and adaptive rendering.

**AW-AEP-124 — Long-session regression.** Verification MUST include prolonged chat sessions, reconnects, multiagent concurrency, large event histories, and at least one multi-display/high-load condition when supported.

**AW-AEP-125 — Instrumentation overhead test.** The team MUST measure profiler overhead with profiling disabled/minimal/full against a representative baseline; serious regressions require remediation or a documented, user-controlled tradeoff.

## 16. Delivery sequence and open architecture decisions

This charter requires eventual capability, not simultaneous release of all components. Staged milestones MAY deliver subsets if their coverage and limitations are clearly marked.

### Recommended implementation progression

1. **Foundation:** versioned event/metric schema, monotonic timing, adapter capability probing, secure event storage.
2. **Useful chat instrumentation:** per-turn timer, provider token updates, tool spans, completion/reconciliation, pending/unknown labels.
3. **Multi-entity rollups:** task/agent/project attribution, delegated work, retries, comparison charts, quality/coverage.
4. **Budgets and CIE exchange:** scoped warnings, best-effort controller, context annotations, measurable optimization evaluation.
5. **Full visual profiler:** Liquid Intelligence dashboards, linked Intelligence Streams, timeline drilldown, cinematic but data-faithful transitions.
6. **Advanced diagnostics:** multi-provider accounting, critical-path analysis, cost modes where verified, cohort analysis, adaptive recommendations.

### Explicitly open decisions

- Final metric storage and event-retention backends, and whether long-lived aggregate summaries are independently durable.
- Precise live update-rate and rendering throttling targets based on device benchmarks.
- Whether any connected provider offers guaranteed server-side hard token caps for supported use cases.
- Whether account-level usage reporting can be disaggregated consistently across all authentication and billing modes.
- Exact user-facing compact token breakdown defaults, visualization palette, and motion mapping.
- Method for reliable cross-machine clock-offset estimation and confidence intervals.
- Whether local on-device estimates are valuable enough to include as a separate opt-in diagnostics mode.
- Standard experiment protocol for comparing CIE strategies across task families.
- Cross-provider token normalization rules; provider tokenizers and accounting semantics are not necessarily comparable.

**AW-AEP-126 — Open-decision discipline.** The choices above MUST remain explicit research questions until supported by evidence and recorded architecture decisions; no future contributor may treat an example technology or unverified provider feature as governing fact.

## 17. Cross-charter references and change control

This document's domain contract intentionally depends on:

- **[00 — Aetherwake Constitution](00-AETHERWAKE-CONSTITUTION.md):** authority, no hollow simulations, true observability, realistic budgets, quality-adjusted metrics.
- **02 — Liquid Intelligence and Motion:** cinematic materials, six-system Motion Coordinator, meaningful state animation.
- **[03 — Projects, Workspaces, and Resources](03-PROJECTS-WORKSPACES-AND-RESOURCES.md):** persistent identities and workspace block representation.
- **[04 — Conversations and Connected Branches](04-CONVERSATIONS-AND-CONNECTED-BRANCHES.md):** threads, branches, conversation state, and UI loading.
- **05 — Agents, Tasks, and Workflows:** task lifecycle, execution attempt semantics, verification authority.
- **[06 — Vela Intelligence and Adaptation](06-VELA-INTELLIGENCE-AND-ADAPTATION.md):** assistant explanations, attention management, user preferences, proactive suggestions.
- **[07 — Notes, Knowledge, and Thought Stream](07-NOTES-KNOWLEDGE-AND-THOUGHT-STREAM.md):** user-authored ideas versus machine execution data.
- **08 — Context Intelligence and Memory:** context selection, retrieval, compaction and memory policies; AEP measures impact.
- **09 — Intelligence Streams and Observability:** canonical events, provenance, replay integrity; AEP computes usage and timings.
- **11 — Timelines and Replay:** time navigation and historical reconstruction.
- **12 — Codex Execution and Integrations:** backend/API adapters, supported provider semantics, permissions.
- **13 — Platform, Performance, and Displays:** responsive rendering, adaptive GPU budgets, multi-window integration.
- **14 — Trust, Privacy, and Autonomy:** data minimization, consent, account authorization, retention and approvals.
- **15 — Quality, Verification, and Acceptance:** acceptance evidence, test quality and regression gates.
- **16 — Engineering and Delivery:** sequencing, architecture decisions and implementation records.

When another charter is not yet published, a reference to it is **a reserved dependency**, not a claim that the document exists or has been accepted.

### Change control

Amendments MUST preserve stable identifiers where the original requirement remains the same. Material semantic changes require an explicit version increment, rationale, cross-charter impact review, and appropriate regression and migration assessment. Removed requirements SHOULD be marked superseded rather than reusing their IDs for unrelated provisions.

**AW-AEP-127 — Traceable amendments.** Changes to token semantics, timing boundaries, billing interpretations, budget enforcement, or efficiency scores MUST include migration/compatibility analysis because these alter the meaning of historical evidence.

**AW-AEP-128 — Owner acceptance.** Publication of this draft on the repository's default branch does not by itself mean owner ratification. Registry status MUST remain pending until explicitly accepted.

### 17.1 Dual-mode economic accounting and cross-provider telemetry

This extension applies when ordinary Chat-mode turns and Codex execution branches coexist in one Connected Branches family. It clarifies the existing cost/usage ownership of this charter and does not imply that any billing provider exposes a complete real-time balance.

**AW-AEP-129 — Per-turn economic identity.** Every recorded model turn or agentic execution SHOULD retain its effective mode, provider/transport, account or billing-scope reference, source-backed plan/quota class, applicable metered price version if known, and provenance class of each usage datum. The frontend MUST NOT derive charge class solely from whether the user selected Chat or Codex.

**AW-AEP-130 — Subscription-versus-API separation.** ChatGPT subscription allowances, eligible participating-app allowances, Codex limits/credits, API-billed tokens, local inference, and unknown external charges MUST remain separately identified even when a chat family or Vela task combines them.

**AW-AEP-131 — Non-fabricated zero cost.** A purported "free Chat" path MUST NOT display an unqualified $0 or "unlimited free" claim without evidence of that exact route's applicable terms. For subscription-included work, label **covered by plan allowance** where verified and identify quota consumption separately from an incremental monetary charge.

**AW-AEP-132 — Pre-execution impact preview.** Before authorization of a new metered backend or materially different quota pool, the UI SHOULD show the known charge class, available credible estimate or **unknown**, account scope, budget policy, and whether execution requires user approval. An estimate is neither a hard cap nor an invoice.

**AW-AEP-133 — Branch-family attribution without double count.** The profiler MUST attribute usage to actual provider-bound turns/executions. Copying a finding into another branch, viewing it in multiple workspaces, or displaying a shared ancestor MUST NOT replicate original charges. A later inference that consumes that copied context MAY incur its own distinct provider usage.

**AW-AEP-134 — Degradation and evaluation coverage.** Acceptance tests MUST include mixed Chat/Codex branches, unavailable subscription-quota data, API fallback refusal, variable provider tariffs, reconnection, and accurate aggregation by provider, account, and branch. Missing billing fields MUST remain unknown rather than inferred as free.

---

## Final governing statement

**The AI Execution Profiler exists to make intelligent work measurable without pretending the unobservable is observable.**

Aerynth MUST reveal real performance in useful detail; it MUST help users understand time, tokens, context, tools, models, retries, and verified outcomes; it MUST remain visually coherent with Liquid Intelligence; and it MUST support CIE optimization **without hiding uncertainty, weakening quality, or compromising user control**.

Aerynth's profiler is not a decorative token counter. **It is an accountable instrument panel for an intelligent engineering environment.**
