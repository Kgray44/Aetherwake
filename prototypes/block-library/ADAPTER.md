# Canonical host adapter

`createCanonicalTemplateHost(options)` in `canonical-host.mts` implements the native `CanonicalTemplateHost<DatabaseSync>` seam over the existing WorkspaceKernel, WorkspaceEngine and exact injected connection. It opens no database and performs no direct resource, placement, group-membership or session-table writes.

The factory checks `engine.kernel === kernel` and obtains the kernel's actual database handle through its existing transaction seam to enforce `actualDb === options.db`. `host.atomic` delegates unchanged to the parent wrapper, which must roll back canonical graph/mapping state together with SQLite. The adapter is intended to be called by TemplateService inside that outer transaction.

Root supplies these synchronous callbacks:

| Callback | Responsibility |
|---|---|
| `atomic<T>(() => T): T` | Existing integrated-backend atomic wrapper, including in-memory graph/state rollback |
| `capabilities(): LibraryCapabilities` | Current implemented/provider capability snapshot |
| `createResource(kind, title, provider, projectId): string` | Existing canonical factory, including new conversation graph mapping, with no automatic placement or provider execution |
| `resourceKind(resourceId): BlockKind` | Existing canonical desktop type resolution |
| `navigateWorkspace(workspaceId): void` | Actual synchronous DesktopState navigation/session update; publish renderer changes after outer commit |
| `setTaskGroupMembers(command): void` | Actual DesktopState command path; adapter supplies `type: 'setTaskGroupMembers'`, current group `expectedVersion`, group ID and task IDs |
| `isAuthorized({ kind, id }): boolean` | Effective parent-owned project/workspace/resource grant decision; required rather than inferring access from existence |
| `bounds?(workspaceId): Geometry \| undefined` | Optional current native canvas bounds in canonical world coordinates |

Reads use canonical projects/resources/workspaces/layout rows, with effective authorization plus active object/owner-project checks. Archived/missing owner projects suppress resource/workspace visibility even if those rows remain active. The adapter verifies new factory output is a newly inserted canonical resource with exactly the requested kind and project ownership; a reused existing ID or mismatched owner fails the outer transaction.

Workspace creation stages Freeform and invokes actual session navigation. Placement creation uses a typed `WorkspaceEngine.attachResource` command with the current canonical revision and finds the one newly created placement ID. Final organization uses typed `setOrganization` with both layout and organization version fences, then a camera-only `saveLayout` for the viewport. Role order/spans must target actual placement IDs; Vela's engine-owned presence cannot be a template span or resource. Final Fluid/Structured policy remains the engine's responsibility. Task membership always delegates the parent DesktopState command; there is no alternate membership implementation.

The new `tests/canonical-host.test.mts` suite is **queued, not run**, while the parent's native organization/performance slot is active. It uses actual WorkspaceKernel, WorkspaceEngine, DesktopState and ConversationGraph with a clearly labeled local mock adapter, without any model/provider turn. It covers strict connection identity, canonical ownership/mapping, real membership/version increments, current layout fences, Freeform geometry/viewport, archived/revoked visibility, Vela span exclusion, and graph/session/SQLite rollback after the actual membership command has executed. This adapter checkpoint does not claim typecheck, native integration or acceptance.
