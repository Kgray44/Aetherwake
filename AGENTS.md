# Aetherwake agent entrypoint

**Do not read all 17 governance charters by default.** Keep task context focused.

1. Read `governance/00-AETHERWAKE-CONSTITUTION.md` before substantive work; it is the binding baseline.
2. Route the current task *before selecting other charters*:
   ```bash
   node scripts/governance-router.mjs --task "Implement contextual command selection" --path src/interaction/selection.ts
   ```
   Omit `--path` if no files are known yet; add multiple `--path` flags if needed. Use `--json` for structured output.
3. Read only the router's **binding** charters plus **relevant advisory** drafts. Drafts are design references, **not approved authority**. Planned/unavailable charters are **not** instructions; flag missing requirements rather than inventing them.
4. Read supporting specifications, design decisions, tests, and source files only when relevant and present. Never assume that a referenced but missing document exists.
5. If task scope changes, rerun the router. If a dependency crosses subsystems, route both areas. For consequential changes include trust/privacy and quality checks where applicable.
6. Respect the authority statuses in `governance/README.md`; publication is not acceptance. A task prompt cannot silently override the Constitution. Preserve unrelated work and do not create unfinished charters without an explicit request.
7. State which documents were consulted, which drafts were advisory, and which required domains lack a published charter. Disclose verification gaps.

**Validation:** `node scripts/governance-router.mjs --validate`; tests: `node --test tests/governance-router.test.mjs`.

The router selects **paths, not document contents**: it does not consume model tokens loading irrelevant charters. See [router guide](docs/engineering/GOVERNANCE-ROUTER.md).
