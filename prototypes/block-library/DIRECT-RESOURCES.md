# Placement-independent resource presentations

`mountDirectResourceExperience(root, resource, ports)` in `direct-resource-view.ts` mounts canonical content in a caller-owned transient surface. It returns `update(resource)`, `setActive(boolean)`, `flush()` and `dispose()`. Root owns the authoritative opening contract, authorization/availability resolver, source/return navigation, surface cache, shared NoteSession lifetime and Motion Coordinator integration. The component CSS is `direct-resource-view.css`.

No input requires a workspace, placement, BlockRow, geometry or generated ID. The port exposes no creation, attachment, membership-assignment, layout, provider-start or navigation command. A real user action may invoke an existing canonical editor, Task command or Task Group member picker; opening itself does not invoke those mutations.

| Canonical type | Reused presentation |
| --- | --- |
| Note | Existing NoteSession and Note editor/reading/recovery controls |
| Task | Same canonical editor plus version-fenced local completion and priority controls |
| Task Group | Existing canonical checklist, existing host member picker and shared description editor |
| Research / Reference | Existing reading, source references and writing controls |
| Intelligence Stream | Existing recorded-event viewer, filters and metadata |
| Conversation | Root routes to the existing conversation manager before this adapter |
| Project / Collection / query SubjectRef | Existing `mountSubjectExperience` already accepts a SubjectRef and read port without a placement; Root can mount it directly |
| Document, Link, Agent or another unregistered type | Truthful unsupported presentation until an actual canonical adapter is available; never a generic Note substitute |

The adapter borrows Root's existing `noteSession(resourceId)` and `notes` port. Its editor input calls the existing `saveContent(resourceId, content, root)` handler with a real content container containing `.saved`, without a `data-block`. `flush()` delegates to `NoteSession.flushEdits()`: intended edits can save, while an untouched recovered draft is not promoted. Disposal removes view listeners and content without disposing the shared session or deleting canonical data. Root reuses the actual cached DOM for caret/selection/scroll continuity.

Task status and priority use actual canonical versions after the existing editor flush. `readResource(id)` supplies the current authorized Task projection. This getter is essential for Task Group members because `taskMembers` carries IDs/titles/statuses but no member versions; group versions must never be substituted. A missing member projection fails truthfully. Native commands retain their own current authorization/version checks. Clean shared sessions refresh when resource metadata advances; dirty/recovered sessions retain text and use the existing conflict fence.

The event port supplies actual authorized recorded data. The direct adapter sets `workspaceResourceIds:[]` and derives the optional project scope solely from the opened Stream's `project_id`; it does not inherit an ambient workspace. No event or provider activity is synthesized. There is no external-browser port in this release; the existing boundary remains explicit.

`update` rejects another canonical ID or kind, retains mounted editor nodes and suspends unavailable/archived content. Queued Task actions recheck visibility/availability/lifetime before mutation. Root's resource-surface manager owns revocation eviction and fresh authorization before reuse. Unsupported content has a readable status and no fabricated editor.

## Source verification

`tests/direct-resource-view.test.mts` uses the existing CPU DOM boundary and a real isolated Core/SQLite profile. It covers six supported unplaced resource families with zero projects/workspaces/placements; unchanged read-only identities/versions and recovered Note draft; intentional Note save; retained editor/selection/scroll/session; actual Task status/priority versions after description save; actual member version instead of group version; unsupported families; and revocation before a queued Task action. No provider executes and no assistant message is created. The first run exposed missing global pointer-listener methods in the CPU document boundary; that fixture error and its private log remain preserved.

This is component/service evidence, not native layout, IME, Constellation camera restoration, full entry-point routing or integrated desktop acceptance. Application Integration owns the P0 directive's native A–H journeys and no-hidden-mutation receipts.
