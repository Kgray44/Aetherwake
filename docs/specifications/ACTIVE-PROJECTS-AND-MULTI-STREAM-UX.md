# Active Projects Dock and Multi-Stream Experience
## App-shell UX, identity, selection, state persistence and interaction specification

| Field | Value |
|---|---|
| Status | Detailed proposed specification, not implementation evidence |
| Governing authority | [Charter 01 §17](../../governance/01-EXPERIENCE-AND-INTERACTION.md), [Charter 09 §21](../../governance/09-INTELLIGENCE-STREAMS-AND-OBSERVABILITY.md), Charters 02/03/06/14 |
| Runtime contract | [Unified Spatial Intelligence](../architecture/UNIFIED-SPATIAL-INTELLIGENCE-RUNTIME-AND-NAVIGATION.md) |

## 1. Active Projects Dock: a small but continuously useful instrument

The floating Active Projects Dock is an app-level awareness and navigation element positioned near the top right in suitable Workspace, Constellation, Vela Presence and Intelligence Stream contexts. It must remain visibly **different from the block system**: narrower, lower-profile, translucent and integrated into the top-level shell, without the editing affordances or resource lifecycle of a workspace block.

Each project occupies a **medium-length pill** containing:
- stable short project name, truncated carefully with inspectable full name;
- compact state point/visual with accessible label (working, waiting, paused, failed, unknown, etc.);
- running-time representation with clear meaning; and
- context/secondary affordance to open its Stream.

The primary click/tap/keyboard activation opens the **project workspace**, not its Stream. A separately discoverable action opens its Stream. Context menu and keyboard shortcuts should support both without tiny ambiguous targets.

If several executions are operating on the same project, show **one project pill** with a concise grouped state. Additional detail can reveal the runs/agents/approvals. The display must not create one project pill per message, agent, task or provider call.

## 2. Correct elapsed time

Distinguish at least:
- Wall-clock duration since the project's current active session began;
- Accumulated verified execution/run-active duration where source data exists;
- Waiting or paused duration;
- Time since last known event, when relevant.

The default concise timer must be labeled on inspection or in tooltip/accessibility metadata. If running time cannot be measured, show a clearly qualified duration or unknown status. The timer is driven by canonical start/stop intervals and an accurate local time base, not by browser animation ticks accumulating on each render. After app restart, restore it from timestamps and state.

A paused/waiting project's historical wall-clock time may continue, but it cannot silently be described as *actively working for 8 hours*. One false clock and the entire dock becomes decorative fiction.

## 3. Lifecycle and motion

A project begins running: its pill materializes in the dock; existing pills shift softly with bounded reflow and stable order. A project waits for approval: indicator changes to an unmistakable pending state and stays discoverable. A project finishes: its pill transitions to a recent/completed section or gently dissolves from active view according to explicit recency settings; it must not disappear before important result/approval information is retrievable.

Use Motion Coordinator for these effects. Avoid over-blooming, infinite activity spinners, sudden relayout or a list so tall it covers working content. A compact overflow pill (e.g. '3 more') expands into a floating sheet with the same controls when project count grows. Position/anchor adapt to window size, top controls, Vela's manifestation and accessibility zoom.

Screen readers receive a live-updated bounded region with status changes summarized rather than announcing every timer tick. Mouse, touch and keyboard need equivalent activation, and focus must remain stable during reordering.

## 4. Intelligence Stream entry behavior

Selecting the top-level Intelligence Stream affordance implements:

| Eligible project state | Primary response |
|---|---|
| None | Calm empty or recent/history selector; no fabricated active run |
| Exactly one | Enter this project's Stream directly |
| Two or more | Open a compact, beautifully animated multi-project picker |
| Previously selected project | Optional quick resume when clearly presented; do not silently override multiple-active selection expectation |

The project picker resembles a refined floating spatial projection rather than a giant full-screen modal. Each row/pill shows real name, current aggregate state and elapsed-time meaning, with optional single-line current operation. It provides cancel, keyboard navigation and sensible target sizes; waiting-for-approval and partially failed projects can be included with explicit grouping.

Selecting a project creates a **view transition request**, not a backend work request. Never call a project execution API merely because the user chose a project visualization.

## 5. Switching while inside a Stream

Inside any project Stream, the active-project dock and a nearby accessible project-switch affordance stay available. The user can select another project directly. The current scene recedes as a related form in the unified spatial universe; the destination scene emerges with its previous camera center, zoom, selected run/operation, follow-live preference, Theater pin and replay position.

Independent project view state must be persisted under user/project/view identity. It is not stored in a fake chat message or appended to execution trace. Navigation and focus changes do not change project membership or task assignments.

If the destination project becomes unavailable during transition, abort safely and remain or return to the previous authorized view, retaining its state. Fast successive selections must not leave half-applied scenes, orphaned GPU resources, duplicated subscriptions, pointer traps or broken back behavior.

## 6. Relationship to Vela Presence and Constellation

The same project identity appears in:
- the Active Projects Dock;
- its Constellation system/node;
- any Workspace representation;
- a project-linked action mote in Vela Presence;
- its Intelligence Stream graph and history.

Different representations may use different shapes but must preserve source attribution. Click a Vela Presence mote for a project and travel into the correct Stream without going through a separate picker; its project context is already known.

Traveling back should reestablish the relevant camera/selection anchors. Transition animation should not force someone to sit through a long cinematic sequence for simple repeated navigation; it can shorten, interrupt or skip without losing the spatial relationship.

## 7. Proposed state machine

```text
WORKSPACE / CONSTELLATION / PRESENCE / STREAM
   ├─ click project pill → resolve authorization → workspace
   ├─ project pill secondary → resolve authorization → its Stream
   └─ click Intelligence Stream navigation
         ├─ zero eligible → recent/empty
         ├─ one eligible  → its Stream
         └─ multiple      → project picker → selected Stream

STREAM(project A)
   ├─ select project B → spatial travel → STREAM(project B)
   ├─ select Vela Presence → reverse/linked travel → global Presence
   ├─ return to Workspace → linked resource anchor
   └─ view history/replay → same project, independent replay cursor
```

Execution continues in all transitions, and permission gates apply on every query. View-state writes are recoverable and separate from evidence event state.

## 8. Edge cases and abuse tests

1. Project A starts while B has been active; pills update without stealing focus.
2. Ten active projects; dock collapses, no overlapping shell navigation.
3. A project has four agents, three runs and one human approval; one pill, accurate grouped details.
4. Timer survives restart and system sleep; no double-counted active durations.
5. Project is paused, unknown or waiting for approval; correct status and timing language.
6. An active project is deleted/renamed or permission is revoked mid-transition; safe fallback with no leaked content.
7. Two workspaces reference one project; workspace navigation resolves to user's chosen/default workspace without duplicate project identity.
8. Click B, then C, then back rapidly; no stale frame, wrong selection or duplicated backend subscription.
9. Switch in replay mode; A's replay state is not imposed on B or its live work.
10. GPU context loss/reduced motion/screen reader/large text; project selection remains correct.
11. Current active projects include sources with incomplete telemetry; coverage and unavailable status remain honest.
12. Two independent chats in one project; both appear as distinct runs in the Stream if attributable.

## 9. Acceptance and review

An end-to-end native session must demonstrate the dock while two actual project runs execute, the picker and direct switching, Presence-linked entry, correct return to each workspace and preservation of active work. Capture source IDs, runtime state, elapsed-time calculations, interaction/camera snapshots and accessibility observations. A simulated UI screenshot alone cannot establish this experience.

The top-level design principle remains: **one continuous spatial universe, with different meaningful perspectives, and no disconnected screen changes.**
