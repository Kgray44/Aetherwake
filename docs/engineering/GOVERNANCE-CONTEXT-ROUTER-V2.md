# Governance Context Router V2 — Section-Level Retrieval

**Status:** Engineering implementation, not new normative governance, and not a full implementation of Aerynth's Context Intelligence Engine (CIE).

## Purpose

The original deterministic Governance Router selects relevant charters by task phrases and repository paths, with registry-derived authority labels. It does not ingest their content.

**Governance Context Router V2** builds a current, content-addressed index of every published charter and selects *complete Markdown sections* within the applicable charters, always including the **complete binding Constitution**. An explicit requirement ID pins the section containing that requirement. Output includes provenance, authority, exact source ranges, and a character-based size estimate. Canonical Markdown stays the source of truth.

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
~~~

## Two-stage algorithm

1. **Authority first:** parse the current \`governance/README.md\` registry. An advisory charter stays advisory even if published; a planned/unavailable charter is never invented. A selected file is not silently ratified.
2. **Deterministic domain routing:** call existing \`routeGovernance()\` using task phrases and paths. Explicit normative IDs add their source charters. Mutating/permission-related work includes Trust when present.
3. **Fresh index:** read the original Markdown files every invocation. Split on level-2 section headings, retain full section text and exact line ranges. Parse requirement definitions with the canonical \`**AW-... —\` format and reject duplicate IDs.
4. **Scoped selection:** include the **complete Constitution**. Rank specialized charter sections by query-token overlap with section headings and body; pin explicitly requested requirement sections. Limit automatically selected sections using \`--max-sections\`.
5. **Conservative fallback:** if a selected charter has no positive section match, include the **entire charter**. Never silently drop it just to make context smaller.
6. **Referenced requirements:** include up to 24 additional one-hop normative cross-references with source lines, or warn if expansion is incomplete. This is not semantic dependency closure.
7. **Manifest and soft budget:** report selected text, authority, source path/line range, SHA-256, inclusion reasons, incomplete coverage and estimated size. A budget overrun emits a warning, **not** silent truncation.

## Safeguards

- Full canonical Markdown files remain untouched and authoritative. Neither indexing nor retrieval changes governance approval status.
- The baseline Constitution is always included in full. This is intentionally conservative: later CIE experiments may use a verified pinned constitutional section set, but that requires a separate integrity review.
- **Published does not mean approved**. Until owner acceptance, published charters remain advisory.
- This source index contains public governance only. It is not a permission system for private projects, files, chat history, or user information. Private-resource retrieval will need policy checks before ranking and model attachment.
- Requirement IDs are authoritative references only where the source registry says they have authority.
- Source text hashing provides content identity for a retrieval run; it is **not** a guarantee that a subsequent file edit cannot make an excerpt stale. Refresh before applying governed work.
- Keyword matching can miss indirect requirements. Agents MUST inspect scope and broaden retrieval for implicit cross-domain dependencies. The V2 result is **scoped guidance**, not proof of complete semantic coverage.
- The optional budget is a **soft estimated context planning limit**, not an API/model context or billing cap.

## Benchmarking and quality

Run \`node scripts/benchmark-governance-context.mjs\`.

Seven representative engineering prompts assert charter selection and known relevant requirement coverage while reporting:

- Full source characters across routed charters.
- Actually selected source characters (including one-hop dependencies).
- Percentage reduction in **source characters**.
- A rough proxy \`ceil(characters/4)\` marked explicitly as **not a tokenizer result**.
- Whether every predeclared domain and requirement-ID fixture was retained.

This measures **selection volume and defined fixture recall**, not agent accuracy. It cannot establish real prompt token costs, cache usage, reasoning quality, downstream task success, or latency. Those require a future end-to-end controlled Codex experiment comparing full and scoped governance under equivalent models, tools, and task suites. False negatives must be measured before enabling any aggressive retrieval mode by default.

## Future CIE integration

Expose \`buildGovernanceIndex(config,registry)\` and \`buildContext({...})\` through an authenticated, policy-enforced context assembly service. The future CIE should add section/requirement graph dependencies, task intent classification, retrieval confidence, semantic evaluation, cache accounting, and context-inspector UI, while retaining a source manifest and full-document fallback. The indexing algorithm should remain deterministic, small, and dependency-free at this stage.

**Status boundary:** This engineering component does not create additional governing requirements or alter any numbered charter. Implementation details may evolve through measured tests and architecture decisions.
