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
