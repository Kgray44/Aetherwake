# FI-4 review fix: linked workroom control scope

Review baseline: `f6d9591bf994bbee006f3ea8b554dac8bac73235` (unchanged). A focused test reproduced `mission_reconciliation_denied` when an authorized linked workroom requested Retry, while the same receipt worked from its originating workspace.

MissionService now authenticates the caller through the existing `requireAccess` gateway, then validates both receipt scope digests against `current.scope`, the canonical originating mission scope. The receipt is not retargeted to the workroom. Both caller and origin must still be authorized; unlinked workspaces, different projects and revocation of origin access remain denied without changing the attempt or dispatching work.

This is a separate post-review correction. The 10 source-reconciliation cases plus 2 real subprocess recovery/cancellation cases passed, as did the affected backend typecheck and whitespace check. New tests verify the unchanged original attempt/binding and one source execution through workroom Retry. No renderer, FI-2/provider/AEP-comparison or native policy change belongs to this fix.
