# Deterministic Governance Router

Aetherwake's governance router maps a task (plus optional affected repository paths) to the **smallest identifiable set of relevant governance domains**. It is a stdlib-only Node CLI; **no model call, embeddings, credentials, network request, or transcript ingestion**.

## Authority

- `governance/README.md` is the single source of truth for charter publication/acceptance status.
- **Binding:** established, explicitly approved, or ratified and present.
- **Advisory:** published but pending acceptance; consult as design guidance, never misrepresent as binding.
- **Planned/unavailable:** do not load or fabricate. Mention the governance gap when it affects the task.
- **00 Constitution:** selected unconditionally.
- The router does not modify charters, does not approve documents, and cannot elevate a draft's authority.
- The repo owner's explicit decisions and higher-order safety/platform requirements remain controlling.

## Usage

```bash
node scripts/governance-router.mjs --validate
node scripts/governance-router.mjs --task "Implement contextual command selection"
node scripts/governance-router.mjs --task "Optimize particle rendering" --path src/rendering/particles.ts
node scripts/governance-router.mjs --task "Fix branch sharing" --path src/branches/links.ts --json
node --test tests/governance-router.test.mjs
```

A contextual-command task selects the established Constitution and the published **advisory** Interaction, Resources, Trust, and Quality charters. Publication is not owner ratification. The current registry lists Charter 05 as published and pending owner acceptance. Always read the live registry because availability and authority can change without changing this routing guide.

## Operating rules

1. Route with the actual task text and all known affected paths; rerun when scope expands.
2. Treat the output as a **routing aid**, not a substitute for judgment: include other materially relevant dependencies with explicit reasons.
3. Open the Constitution and applicable binding charters; consult relevant published drafts with their advisory labels. Do not invent missing documents.
4. Record the selected governance and any gaps in the task or PR summary.
5. Configure domain signals in `config/governance-routes.json`: `terms` are whole-word phrases; `path_prefixes` are repo-relative directory prefixes. Keep the signals focused. Never duplicate approval statuses here.
6. Change the authority registry only through the separate governance approval/change-control process; the router reads but does not rewrite it.
7. Fail closed on missing/malformed registration, missing charter signals, path/link mismatch, duplicate IDs, unknown authority, or registered approved/published files missing.
8. Routing directly from a `governance/NN-*.md` path includes that charter, even if the task description contains no matching keywords. A charter marked planned remains unavailable even if its intended path is selected.

## Limitations and extensions

The deterministic router cannot infer every dependency from prose; the agent must expand its selection when the work crosses domains. Routing itself spends no model tokens, but a Codex agent still consumes tokens when it reads selected files. Do not confuse tokens saved by selection with verified account-level usage savings. Use real telemetry for later CIE measurement.

When new charters are accepted, update `governance/README.md`; the router will automatically treat them as binding on the next run. If a charter filename changes, update the mapping and registry link in the same change. As of November 1, 2026, all 16 specialist charters are published but pending owner acceptance; consult the registry for current status.

## Audit and verification boundaries

- The router is a **deterministic documentation selector**, not a semantic proof that all applicable governance has been loaded. Its path/phrase routing is deliberately conservative, and agents MUST add cross-domain charters when task dependencies require them.
- Charter existence is not acceptance: registered published charters remain advisory until the repository owner records an explicit approval and the registry is updated.
- `--validate` checks registry consistency, charter presence, and routing configuration. The Node tests exercise representative scenarios; neither can prove full semantic compatibility of the governing documents.
- The project currently has no production application under `src/`. Governance requirements describe intended behavior and must not be represented as implemented features.
- Before claiming CI verification, consult an actual green GitHub Actions run for the precise commit, not merely local static review.
