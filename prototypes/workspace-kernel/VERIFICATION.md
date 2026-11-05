# Verification — 2026-11-01

Environment: Windows, PowerShell, Node v24.18.0, npm 11.9.0. Tests use synthetic temporary databases. No dependency install or build cache was needed.

## Executed

| Command | Result | What it establishes |
|---|---|---|
| `npm test` | 12 passed, 0 failed | Canonical identity across blocks and restart; atomic layout rollback; constraints and stale version conflict; provider identity uniqueness; archive/restore/deletion; project/workspace/collection lifecycle; v1→v2 migration and future-version rejection; failed migration rollback; corrupt/unrecognized/missing data handling; interrupted uncommitted write rollback; backup and reopen. |
| `npm run demo` | `PASS` | Fresh database, synthetic project/workspaces/note/conversation, two visual references to one note, relationship and layout, close/reopen identity and state recovery. |

The exact output in this file reflects the final rerun, not a claim of production qualification. The demonstration uses temporary files and removes them after success. The interrupt test exits a child process before commit; it does not simulate sudden power loss or filesystem failure. Backup verification confirms a copy opens and retains a note, not a full disaster recovery policy. No concurrent multi-process load or large data benchmark was run. No UI, visual, motion, accessibility, remote provider, security, privacy, encryption, sync, or owner acceptance is claimed.

## Governance and storage checks

- Deterministic governance router selected Constitution 00 and advisory domains 03, 04, 07, 09 and 15 for the initial task; additional requested cross-domain charters 08, 11, 14 and 16 were read by targeted sections.
- `node scripts/governance-context.mjs` failed on this base checkout with `Cannot read properties of undefined (reading 'some')` for both focused and full attempts. No router files were changed in this isolated task.
- Before creating the worktree, `ReserveGuard.ps1 -EstimatedCBytes 536870912 -EstimatedDBytes 0` allowed the bounded checkout. Before tests, `-EstimatedCBytes 104857600 -EstimatedDBytes 0` allowed temporary databases. The guard checks local C: and D: free bytes at call time; it cannot stop external applications, cloud tasks, or writers that have not loaded this rule.
