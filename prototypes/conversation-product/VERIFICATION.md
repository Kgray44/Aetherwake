# Conversation product verification

Checkpoint: module unit and type verification passed; combined host acceptance pending.

Draft schema v2 follow-up: the six focused real SQLite draft tests passed (81,272 ms),
including exact 8 MiB aggregate capacity and 4,096 retained rows. They cover additive
v1 preservation, unknown-version non-reset, same-file kernel connection restart,
CAS/empty tombstones, exact Unicode/whitespace/NUL text, archive/access denial without
erasure, source independence, and later typing during a synthetic failed provider
callback. Full Core startup with v2 and native/UI draft recovery require the parent
integration; these tests do not claim provider or native acceptance. Bounded storage
admission passed for C ≤ 67,108,864 bytes and D = 0 for this batch.

- Node 24.18.0: `node --test prototypes/conversation-product/test/*.test.mts`
  passed **6/6** tests, 0 failures, duration 1,202 ms in the final bounded CPU-only
  validation gap. Earlier five-test checkpoint also passed.
- Strict TypeScript noEmit check passed for service, UI, and tests using existing
  installed compiler/Node types. Flags: `--strict --skipLibCheck --target ES2023
  --module ESNext --moduleResolution Bundler --allowImportingTsExtensions
  --lib ES2023,DOM,DOM.Iterable --types node`. Initial typecheck found the `.mts`
  generic-arrow syntax ambiguity; adding its required trailing comma fixed it.
- Executed synthetic canonical-backend scenarios: restart/migration and stable IDs;
  two canonical collection references; branch independence; post-fork discovery;
  inspection before attachment; supplied-context receipt fence; source revocation
  and stale digest; smart membership/manual pin preservation; saved-rule conflicts;
  provider unavailability; failed Codex dispatch without invented response;
  stale send/policy commands; offline local recording without provider connection;
  exact-hit paging; resource collection/archive filters; full export;
  unsupported-schema preservation; supersession and non-reactivation after revoke.
- No native window, screenshot/capture, provider inference, installation, clone,
  cache fill, or asset download was performed by this module worker.
- Host storage reserve checks passed for bounded additional
  allocation C ≤ 268,435,456 bytes and D = 0 bytes. Both drives remained above
  their separate 30 GiB reserves. Live free-byte measurements remain in private
  tool receipts and are intentionally excluded from this public source document.
  ReserveGuard is an instruction/check, not a quota: external applications and
  already-running processes that did not load it are outside its enforcement.

Combined host adapter, actual browser/native UI, visual/motion/accessibility,
long-history performance and owner acceptance remain unverified at this checkpoint.
