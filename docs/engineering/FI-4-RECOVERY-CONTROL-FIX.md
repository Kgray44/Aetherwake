# FI-4 review fix: expose original-result recovery

Review baseline: `f6d9591bf994bbee006f3ea8b554dac8bac73235` remains unchanged. The existing mission-control predicate hid every uncertain task and every exhausted attempt budget, although the backend supports readback of a qualified original source result without allocating an attempt.

The existing `vela-missions.ts` control predicate now recognizes only a matching fixed-source receipt candidate on a failed/uncertain attempt. It offers the existing Retry transport even at 1/1 attempts, labeled **Recover original result**. This is an affordance, not renderer verification: the backend remains authoritative for scope, source, identity, quiescence and atomic result validation. Missing/foreign/mismatched candidates, unrelated provider tasks, running/cancelled tasks and cancelled missions do not acquire this affordance. Ordinary replay-safe Retry retains its prior budget rules.

Changes are limited to this existing predicate/Retry label/retired-control default and its existing test file. FI-6's new adaptive-workspace rendering is untouched; no conflicting edits were present in these files in this isolated checkout. No canonical command schema or permission changed.

All 10 existing-plus-targeted mission-control tests passed, including the rendered label and the unchanged backend Retry request. Desktop typecheck and whitespace checks passed. A fixture-local `childElementCount` implementation supplies a standard browser property missing from the shared CPU-only DOM adapter; the shared conversation fixture was not edited. These are component checks, not native visual acceptance.
