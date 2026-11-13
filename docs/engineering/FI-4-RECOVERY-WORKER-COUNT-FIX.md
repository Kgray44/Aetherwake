# FI-4 review fix: one termination per attempt

Review baseline: `f6d9591bf994bbee006f3ea8b554dac8bac73235` remains unchanged. The original projection decremented a scalar for both a task's termination and its later verification-only recovered event. A real gated-task reproduction showed two successor tasks running while the reported peak remained one.

MissionService's lightweight profile now tracks distinct admitted/active attempt IDs. A repeated end cannot subtract an already-ended attempt; the source-result verification milestone is explicitly not a worker termination. Duplicate admission IDs also cannot manufacture new workers. This changes no execution lifecycle, resource budget, permission, event schema or independent AEP comparison module.

The regression requires both independent successor tasks to enter their asynchronous gates, asserts two running tasks and a peak of two, releases both, then checks the verified result retains the correct peak. The source worker still executes only once. This is observed task concurrency, not a claim of two CPU threads, speedup or GPU/gaming qualification.

The 11 source-reconciliation cases and 24 existing MissionService cases passed (35 total). The affected backend typecheck and whitespace check are recorded with the final post-review evidence. The correction is isolated from the linked-workroom and existing-control fixes for re-review.
