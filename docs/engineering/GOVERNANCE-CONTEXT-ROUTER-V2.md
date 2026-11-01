# Governance Context Router V2 — Section-Level Retrieval

**Status:** Engineering implementation, not new normative governance, and not a full implementation of Aerynth's Context Intelligence Engine (CIE).

## Purpose

The original deterministic Governance Router selects relevant charters by task phrases and repository paths, with registry-derived authority labels. It does not ingest their content.

**Governance Context Router V2** builds a current, content-addressed index of every published charter and selects *complete Markdown sections* within the applicable charters, always including the **complete binding Constitution** **and every normative requirement line from every selected charter**. An explicit requirement ID pins the section containing that requirement. Output includes provenance, authority, exact source ranges, and a character-based size estimate. Canonical Markdown stays the source of truth.

This is a selective context assembly component that could later serve CIE. It is not a semantic embedding engine, a provider-native compaction service, or an authorization engine.

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

The independent sufficiency evaluator (`node scripts/evaluate-governance-engineering.mjs --strict`) also checks eight synthetic engineering scenarios with **45 separately curated requirement labels**, which are withheld from the retrieval call. Tests additionally vary task phrasing while asserting that every normative rule of every selected charter survives.

**Important change in measured performance:** the earlier phrase-dependent section strategy reduced source characters by about 70%, but initially recovered only 33/45 independently labeled essential requirements. The conservative domain-dependency + full-normative-envelope strategy now retrieves 45/45 labeled requirements, and the seven-fixture benchmark measures roughly **35.6% source-character reduction** (the precise value is emitted by CI). This is a fidelity/efficiency tradeoff, not a token or cost guarantee.

This measures **selection volume, domain coverage, and defined fixture recall**, not agent accuracy. It cannot establish real prompt token costs, cache usage, reasoning quality, downstream task success, or latency. Those require a future end-to-end controlled Codex experiment comparing full and scoped governance under equivalent models, tools, and task suites. False negatives must be measured before enabling any aggressive retrieval mode by default.

## Future CIE integration

Expose \`buildGovernanceIndex(config,registry)\` and \`buildContext({...})\` through an authenticated, policy-enforced context assembly service. The future CIE should add section/requirement graph dependencies, task intent classification, retrieval confidence, semantic evaluation, cache accounting, and context-inspector UI, while retaining a source manifest and full-document fallback. The indexing algorithm should remain deterministic, small, and dependency-free at this stage.

**Status boundary:** This engineering component does not create additional governing requirements or alter any numbered charter. Implementation details may evolve through measured tests and architecture decisions.
