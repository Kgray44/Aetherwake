# Block and Workspace Template Libraries

Independent module for the existing native Aerynth application. There is no database opener, transcript store, provider executor, sidebar or animation loop here.

## Integration

`contracts.ts`, `registry.ts`, `model.ts` and `view.ts` are browser safe. Import `style.css` once. Mount `mountBlockLibrary(root, port, options)` from the existing Add action, or `mountWorkspaceTemplates(root, port, options)` from New Workspace. Dispose the mount on close. Both use the injected native ports; creation opens the parent's canonical block controls through `onCreated` / `onApplied`.

The block mount requires `workspaceId`, `expectedLayoutVersion` (a getter is supported), `onCreated`, and `onClose`. The template mount requires `projectId`, its `expectedProjectVersion` when non-null, `onApplied`, and `onClose`. Supply `currentWorkspace: () => DesktopSnapshot | null` to expose Save Current Workspace. Its binding controls require an explicit **reuse existing resource** or **create empty new resource** choice for every resource.

On the native side, instantiate `new TemplateService(canonicalDb, host, optionalVelaPlanner)`. `CanonicalTemplateHost<DatabaseSync>` is the exact adapter contract. `host.db === canonicalDb` is enforced. `host.atomic` must encompass the same kernel transaction and rollback any canonical in-memory state (the integrated backend's existing `atomic` wrapper provides this). All host methods are synchronous. No host call may launch provider work while applying a template.

The host creates resources without placements, then creates placements independently. Stage a new workspace in Freeform while placing all roles. `setOrganization` runs once after placement creation, with role order and spans already remapped to canonical placement IDs; the workspace engine owns final Fluid/Structured resolution. Use its normal geometry/version validation. Vela stays the separate existing 208 × 260, scale .65 presence; it is never encoded as a template resource or padded placement.

Bridge these methods to their matching `WorkspaceTemplatePort` / `BlockLibraryHostPort` promise methods: `capabilities`, `createBlock`, `listTemplates`, `getTemplate`, `saveTemplate`, `renameTemplate`, `archiveTemplate`, `previewTemplate`, `applyTemplate`, `requestVelaTemplate`. Native `readProject`, `readWorkspace` and `readResource` must return effective authorization and current state/version; fail closed rather than inferring access from existence.

`requestVelaTemplate` only invokes the optional real `VelaTemplatePlanner.plan` port. No planner or unavailable Vela capability yields `vela_planning_unavailable`. A returned plan retains request/provider/model attribution and is reviewed, saved and checked before apply. No fallback AI generation, transcript cloning or Codex delegation is hidden in this module.

## Behavior

- Seven built-ins map to implemented desktop kinds: Conversation, Note, Research, Task, Task group, Reference and Intelligence Stream. Runtime capability state controls creation. Absent capabilities are unknown, unavailable providers are explicit, and the preview describes real existing controls. Streams display recorded events only.
- Blank defaults to Fluid. Development, Research and Planning create supported canonical chats/notes/tasks/groups with real task membership. Presets are read-only templates; users can save their own layouts.
- Template resources and placement roles have separate keys. Multiple placements may reference one resource role. Reuse preserves the canonical resource ID and ownership. New resources begin empty; note text, messages, credentials, provider bindings and executions are excluded by a strict schema.
- Named templates support versioned save/update, rename, list/search, preview, archive/restore and restart persistence. The extension tables live in the injected canonical SQLite database.
- Apply always creates a new workspace. Counts and JSON bytes are bounded; template/project/reference versions, archive state, access and cross-project restrictions are rechecked inside one transaction. Existing global resources may be referenced; project-owned resources must match the target project. Reused task groups are never modified by template membership.
- Create/apply have persistent operation receipts. Same request ID/input returns its canonical result; changed input conflicts. Failure rolls back all workspace/resource/placement/membership/receipt changes. Metadata capacity is explicit (256 templates, 32 resource roles, 64 placements, 64 KiB body, 4096 receipts, 8192 extension audit events); reaching capacity fails rather than deleting retained records.

## Verification status

At initial checkpoint, tests are written but **not run**: the parent currently holds all workers' test/build execution during native visual/performance acceptance. Run `node --test prototypes/block-library/tests/*.test.mts` when released. The suite uses the actual WorkspaceKernel, WorkspaceEngine, DesktopState and SQLite, plus a clearly synthetic injected Vela test planner. It covers canonical IDs, task membership, Freeform overlap, Fluid/Structured modes and Vela presence, restart, preview/no writes, rollback/retry, provider unavailability, cross-project/revoked/archived/stale references and content exclusion.

Native host adaptation, renderer integration, interactive browser/native validation, accessibility/motion/performance evidence and owner acceptance remain with the parent integration. This module checkpoint does not claim those outcomes.
