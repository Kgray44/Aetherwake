# Governance Context Router V2 — Section-Level Retrieval

**Status:** Engineering implementation, not new normative governance, and not a full implementation of Aerynth's Context Intelligence Engine (CIE).

## Purpose

The original deterministic Governance Router selects relevant charters by task phrases and repository paths, with registry-derived authority labels. It does not ingest their content.

**Governance Context Router V2** builds a current, content-addressed index of every published charter and selects *complete Markdown sections* within the applicable charters, always including the **complete binding Constitution** **and every normative requirement line from every selected charter**. An explicit requirement ID pins the section containing that requirement. Output includes provenance, authority, exact source ranges, and a character-based size estimate. Canonical Markdown stays the source of truth.

This is a selective context assembly component that could later serve CIE. It is not a semantic embedding engine, a provider-native compaction service, or an authorization engine.

## Reliability repair (2026-11-01)

The reported `Cannot read properties of undefined (reading 'some')` failure was reproduced with `node scripts/governance-context.mjs --task "Implement workspace resource identity" --json` on the pre-repair revision. The library call using the same task succeeded. The CLI parser stored `--index` in an `index` boolean (default `false`), then spread its parsed object **after** the real governance index in `buildContext({config, registry, index, ...a})`. This replaced the index object with `false`, so `index.documents.some(...)` failed. The CLI now uses `emitIndex` and passes only supported context arguments explicitly. The library checks input shapes and reports actionable errors for missing indexes, invalid paths/IDs/options, and incomplete registries.

CLI and library calls now produce identical JSON from the repository and an unrelated working directory. `--index`, `--full`, narrow `--requirement`, malformed argument, and repeated-run regression tests cover this boundary. A CLI invocation from another directory must use an absolute script path, for example `node C:\path\to\Aetherwake\scripts\governance-context.mjs --task "..." --json`; source resolution is relative to the script, not the caller's working directory.

## Commands

The default human-readable result can be copied into an agent context:

~~~bash
node scripts/governance-context.mjs \
  --task "Optimize GPU particle rendering" \
  --path src/rendering/particles.ts
~~~

Other forms:

~~~bash
# Machine-readable manifest with original excerpts, authority and ranges
node scripts/governance-context.mjs --task "Implement quick capture notes" --json

# Pin normative requirements independently of phrase matching
node scripts/governance-context.mjs --requirement AW-CIE-008 --requirement AW-CON-014

# Adjust section coverage and specify a soft planning budget
node scripts/governance-context.mjs --task "Implement contextual command selection" \
  --max-sections 3 --budget-tokens 40000

# Explicit whole-document fallback
node scripts/governance-context.mjs --task "Implement contextual command" --full

# Produce a fresh source index (no stale stored index)
node scripts/governance-context.mjs --index

# Reproducible tests and source-character benchmark
node --test tests/governance-router.test.mjs tests/governance-context.test.mjs
node scripts/benchmark-governance-context.mjs
node scripts/evaluate-governance-engineering.mjs --strict
~~~

For library callers, construct the index once from the current repository source, then pass it as `index` without substituting CLI flags:

~~~js
import { parseRegistry } from "./scripts/governance-router.mjs";
import { buildGovernanceIndex, buildContext } from "./scripts/governance-context.mjs";
import { readFileSync } from "node:fs";
const config = JSON.parse(readFileSync("config/governance-routes.json", "utf8"));
const registry = parseRegistry(readFileSync("governance/README.md", "utf8"));
const index = buildGovernanceIndex(config, registry);
const context = buildContext({config, registry, index, task:"Implement workspace resource identity", paths:["src/workspaces/link.ts"]});
~~~

Resolve those three input files from your repository root in an external caller. The CLI itself resolves them relative to its script location.

The JSON package includes `schemaVersion`, `indexFingerprint`, `coveragePolicyFingerprint`, routed domains, selected source sections, source ranges, exact source text, authority, `documentSha256` source revisions, section hashes, inclusion reasons, normative requirement IDs and lines, referenced dependencies, `coverage`, `missing`, `warnings`, and character-based metrics. `coverage.incompleteContext` marks unresolved domain scope, unavailable sources, or unresolved/overflow references. `coverage.explanatorySectionsPartial` marks that some explanatory prose is absent even though all normative lines from selected charters are present. Consumers should inspect both fields and expand to `--full` when a decision depends on omitted definitions, tables, examples, or cross-domain material.

## General-purpose retrieval architecture

The router is designed for **future tasks whose wording has never appeared in its tests**. A match against the task's exact text is not a sufficient safety guarantee. The governing policy in `config/governance-context-policies.json` therefore uses *domain-to-domain dependency edges*, not lists of phrases copied from benchmark prompts.

1. **Authority:** Read the current registry. Document existence never implies ratification; Charter 00 remains the binding baseline unless the registry expressly changes.
2. **Scope:** Select primary charters from task language and affected paths using the original router. If no primary subsystem is recognized, set `scopeNeedsReview` and warn instead of falsely claiming sufficient coverage.
3. **Dependency closure:** Apply one-hop, auditable, domain-level relationships to include trust, quality, integration, and other relevant neighboring charters. This does not depend on the particular words in test cases.
4. **Normative envelope:** Include **every original requirement line** from **every selected charter**, including lines in sections not chosen for full expansion, each with its own exact file path, source line, ID and SHA-256. This protects requirements that a lexical ranker would otherwise omit.
5. **Focused explanatory context:** Include the full Constitution. Rank fuller Markdown sections of other charters by relevance. Explicit requirement IDs pin their full section. When no section can be matched responsibly, load the full charter rather than pretending it was unnecessary.
6. **References and limits:** Expand available one-hop normative references with provenance. Warn about unresolved or overflow dependencies, budget overruns, and missing sources. Never silently truncate a mandatory requirement to meet a soft context budget.
7. **Freshness:** Read canonical Markdown for each invocation. Hash the source index and policy, so a context package can be traced to the underlying governance snapshot.

This is deliberately more conservative than the earlier prototype. The goal is **fewer bytes without omitting applicable requirements**, rather than winning a single benchmark at the expense of future tasks.

## Safeguards

- Full canonical Markdown files remain untouched and authoritative. Neither indexing nor retrieval changes governance approval status.
- The baseline Constitution is always included in full. This is intentionally conservative: later CIE experiments may use a verified pinned constitutional section set, but that requires a separate integrity review.
- **Published does not mean approved**. Until owner acceptance, published charters remain advisory.
- This source index contains public governance only. It is not a permission system for private projects, files, chat history, or user information. Private-resource retrieval will need policy checks before ranking and model attachment.
- Requirement IDs are authoritative references only where the source registry says they have authority.
- Source text hashing provides content identity for a retrieval run; it is **not** a guarantee that a subsequent file edit cannot make an excerpt stale. Refresh before applying governed work.
- Domain routing can still miss an entirely relevant charter. The normative-envelope guarantee applies **only to charters that were selected**; it is not proof that all applicable domains were found. Unknown scope is explicitly flagged for review.
- Text extracted from normative requirement definitions may rely on surrounding tables, examples, or architectural explanations. Expand full sections or entire charters when the task requires them. The router never treats small context as proof of engineering correctness.
- The optional budget is a **soft estimated context planning limit**, not an API/model context or billing cap.

## Benchmarking and quality

Run \`node scripts/benchmark-governance-context.mjs\`.

Seven representative engineering prompts assert charter selection and known relevant requirement coverage while reporting:

- Full source characters across routed charters.
- Actually selected source characters (including one-hop dependencies).
- Percentage reduction in **source characters**.
- A rough proxy \`ceil(characters/4)\` marked explicitly as **not a tokenizer result**.
- Whether every predeclared domain and requirement-ID fixture was retained.

The independent coverage evaluator (`node scripts/evaluate-governance-engineering.mjs --strict`) checks fifteen synthetic engineering scenarios with separately source-reviewed domain and requirement labels, withheld from the retrieval call. They include workspace identity, branching, cross-provider handoff, approval, event provenance, Codex integration, Vela, storage, performance, agent execution, privacy, visual motion, and accessibility. Tests also vary task phrasing while asserting that every normative rule of every selected charter survives. The evaluator compares compact and full packages, records latency, duplicate source ranges, deterministic repeatability, and critical requirements present only as normative lines.

**Measured local run on 2026-11-01:** the seven-fixture benchmark assembled 1,068,152 source characters against 1,661,660 full-source characters (35.63% mean per-fixture reduction). The fifteen-scenario evaluator found 100% of its predeclared essential and critical requirement IDs and all expected domains. It assembled 2,640,357 characters against 4,267,106 characters in full routed context packages; its `ceil(characters/4)` proxy was 660,090 versus 1,066,777. These totals sum repeated fixtures, not one agent's context. The estimator is a rough character proxy, **not a tokenizer**, billable token count, or measured saving. The evaluator reports per-case retrieval latency and duplicated ranges; in this run all repeated packages were identical and no source ranges were duplicated.

This measures **selection volume, domain coverage, defined fixture recall, local assembly latency, and repeatability**, not agent accuracy. Some critical rules were available only as single normative lines, without their full explanatory sections. `passedSafetyGate` in evaluator JSON means only that labeled rules and domains passed its offline coverage checks. It cannot establish that an engineer makes the correct decision, real prompt token costs, cache usage, or downstream task success. Those require an end-to-end controlled agent comparison of full and scoped governance under equivalent models, tools, and tasks. False negatives and explanatory omissions must be reviewed before enabling more aggressive retrieval.

## Future CIE integration

Expose \`buildGovernanceIndex(config,registry)\` and \`buildContext({...})\` through an authenticated, policy-enforced context assembly service. The future CIE should add section/requirement graph dependencies, task intent classification, retrieval confidence, semantic evaluation, cache accounting, and context-inspector UI, while retaining a source manifest and full-document fallback. The indexing algorithm should remain deterministic, small, and dependency-free at this stage.

**Status boundary:** This engineering component does not create additional governing requirements or alter any numbered charter. Implementation details may evolve through measured tests and architecture decisions.

## Fluid Intelligence documentation-routing reconciliation (2026-11-10)

The source charters now contain FI-2026-11-10 requirements across AIR, CIE, AEP, ARIE, the AI Mission Executive and the Adaptive Intelligence Workspace. The governance router is an **engineering documentation retrieval tool**, not the application's semantic interpreter and not a substitute for AI-assisted CIE.

When preparing these implementation tasks, use explicit task/domain signals or requirement IDs and inspect the routed owners before trusting a focused section package. In particular, ARIE tasks require Charter 13 resource policy with relevant Charter 05 scheduling, Charter 10 measurement and Charter 15 acceptance; AEP experimentation requires 10/08/13/15; cognitive planning requires 05/06/08/14/15. Always include additional source charters needed for the actual changed paths and trust boundary.

**Character comparison definition:** `fullRoutedCharacters` includes all full selected charter sources **plus any one-hop normative reference lines outside them**. The same lines are included in `selectedCharacters`; therefore `--full` has zero reported reduction. Neither figure is a tokenizer measurement or a quality metric. Historical benchmark numbers in this document refer to the November 1 source snapshot and must not be reused as current results after the FI amendments.

Required verification for routing edits: run `node scripts/governance-router.mjs --validate`, `node --test tests/governance-router.test.mjs tests/governance-context.test.mjs`, `node scripts/benchmark-governance-context.mjs`, and `node scripts/evaluate-governance-engineering.mjs --strict`. Add new FI evaluation scenarios rather than assuming task-vocabulary additions prove full semantic coverage.
