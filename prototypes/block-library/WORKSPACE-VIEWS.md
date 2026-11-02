# Direct workspace views

The source views accept `presentation: 'workspace' | 'focused'` and expose `setPresentation(mode)`. Changing this value only changes the existing view's presentation. It does not remount an editor, reset its chosen mode, query storage, change geometry, or write a draft.

The main application owns the final activity/presentation hookup. Every visible, supported, nonreceded normal card should activate its functional view regardless of whether its complete rectangle fits the viewport. A small or partly offscreen card is still editable. Invisible/receded views suspend work. Expansion supplies more space and does not unlock primary actions. The existing canonical engine and Motion Coordinator remain responsible for bounds, direct dragging, resizing and movement. Inputs, buttons, search, disclosures and working content remain outside the card drag surface.

| Type               | Normal primary body                                                   | Secondary tools                                  |
| ------------------ | --------------------------------------------------------------------- | ------------------------------------------------ |
| Conversation       | Exact shared CP transcript and composer, `mountBlockChat`             | Existing History and CP disclosures              |
| Note               | Existing textarea and resource-owned NoteSession, initialMode `write` | Read, Find, Rename; existing conflict recovery   |
| Research           | Markdown findings followed by actual source links, initialMode `read` | On-card Edit; Find, Rename                       |
| Reference          | Actual source links before descriptive reading, initialMode `read`    | On-card Edit; Copy/Open only when supported      |
| Task               | Canonical status checkbox, priority and description textarea          | Document actions                                 |
| Task group         | `mountTaskGroupExperience` searchable, filterable canonical checklist | Manage tasks and optional description disclosure |
| Stream             | Metadata search and inspectable keyed event rows                      | Filters and evidence coverage disclosures        |
| Project Overview   | Actual task counts and keyed workspace navigation                     | Resources and recent changes disclosure          |
| Resource Browser   | Search and table-style same-ID resource actions                       | Kind/unplaced filters and row details            |
| Collection Browser | Search and collection resource entries                                | Same bounded filters and row details             |

Import `task-group-view.css` once beside the existing view styles. Mount `mountTaskGroupExperience(root, { members, active, presentation, setStatus, manageMembers, openTask? })` once per placement. Call `update(resource.taskMembers ?? [])` for canonical updates. `setStatus({resourceId,status})` must use the parent's existing flush/current-version canonical command path; `manageMembers` must open the existing membership editor. This component owns no task state. It does not optimistically mark completion and restores the canonical checkbox on a failed command. Keep the description's original textarea/session within its optional disclosure rather than recreating it.

The Note controller adds `initialMode` and `setPresentation`. Set the initial mode only when mounting; changing a card's pose must preserve a user's later Read/Edit choice. `mountBlockChat` forwards the CP controller's exact `setPresentation` and retains the externally owned draft session. Subject views retain keyed resource/workspace rows, search selection and open detail disclosures through refresh. Event views retain keyed details and filter inputs; the existing recorded-event port remains the only source.

`BLOCK_DEFAULT_SIZES` in the registry is exhaustive for all ten kinds and is consumed by both resource and subject manifest factories. Its distinct dimensions apply to new placements. Explicit placement geometry, restored layouts, user resizes and saved template geometry are preserved.

CPU component tests cover direct note editing/recovery persistence, Read/Edit ordering, same-ID browser actions, project navigation, actual event metadata, checklist success/failure and stable nodes/focus/selection through presentation changes. Canonical-host tests create all ten types with the real workspace engine and check that new defaults preserve resized and explicit geometry. These tests do not qualify native layout, pointer input, motion, performance or owner acceptance; the parent must collect those after integrating its App/Main hooks.

## Distinct working identities and direct manipulation

The product owner's latest correction is that the workspace still looks like repeated cards. The shared glass contour stays under the existing renderer; type identity now receives more of the normal working view's hierarchy:

| Kind | Working identity |
|---|---|
| Local conversation | Quiet title, actual transcript, retained composer |
| Codex conversation | Same canonical conversation experience, execution typography and actual provider/turn controls |
| Note | Editorial heading and writing/reading typography, open writing area |
| Task | Prominent task title and direct completion control |
| Task group | Checklist with actual membership completion meter, independent of search/filter results |
| Intelligence Stream | Received timestamp, event type, explicit evidence class and status along a temporal rail; original metadata stays in Details |
| Project | Accessible workspace/resource counts, visible partial-count suffixes, workspace navigation rows |
| Resource browser | Type-led searchable rows with existing attach and Details operations |
| Collection browser | Grouped resource shelf with title and type hierarchy |
| Research | Findings and user-authored sources with a source rail; new placements use the optical lens |
| Reference | User-authored source links lead the reading view, followed by the annotation |

No new live activity, source fetching, progress or provider access is implied by presentation. The task meter is hidden for an empty group; project counts remain hidden until an authorized overview arrives and are cleared on denial. Refreshing views retains their keyed rows, disclosures, actual editor nodes, focus and selection.

New Note placements use the common rounded contour. Existing persisted shapes, sizes, positions, workspace policies and templates are preserved. Registered rectangular/folio fallback DOM frames use the same 18px round as the current shared contour; lens/circle/pill remain deliberate curved shapes. This is not a DB migration or a new GPU material.

Moving has no toolbar, grab widget or mode switch. The existing card surface drag, invisible edges, keyboard movement/resizing, Escape, lock and undo paths remain authoritative. Invisible side targets are 14px and corner targets 28px; short-card top/bottom bands stop before the existing Open/Return controls. Release coordinates pass through the same `LayoutGesture` as move samples, so a fast release commits its final position as one versioned command. Workspace mode selection remains in the existing small Fluid/Freeform/Structured plus Add/actions section.

Source verification covers membership-based completion after filters/failure, bounded project counts and keyed navigation, explicit event timestamp/evidence, actual shared contour diagonal centers, and final pointer release/stale revision cancellation. No native window was opened by this worker. Parent integration must use fresh source-bound profiles and check all registered kinds in normal/focused/small states, real edge/corner/keyboard behavior, retained editor selection/IME, all three organization modes, restart, reduced motion, text scaling and painted readability. The retained earlier B diagnostic image is only a before reference, not an after receipt or artistic acceptance.
