# Living Conversation Environment: source audit and first slice

Source baseline: `b4991fdfaea8c123e335a6491a20d29dd37f0498`. References below name that immutable baseline and one-based source lines, not the edited working copy. The full owner addendum sections 1–17, journeys A–H and outputs 1–10 were read. Constitution 00 is binding; routed charters 01/03/04/08/13/14/15 are published advisory guidance. This document does not ratify them or mark native acceptance complete.

## Current-state audit

| Finding | Source evidence at the baseline | Consequence |
| --- | --- | --- |
| Canonical identity, messages, source policy and independent branch histories already exist. CP metadata uses the injected canonical SQLite connection. | `src/service.mts:34–58`, `:82–92`, `:180–190`; `../connected-conversations/src/graph.ts:183–207` | Extend these services; no new history/provider/graph store. |
| Empty search already suppresses empty-query message hits, but still clone-scans messages and includes every readable non-chat resource. | `src/service.mts:219–233` | The conversation library needs a conversation-only browse path; mixed search needs grouped results. Do not describe the existing empty result as a literal message-hit wall. |
| Sort is creation date only. A new message in an old conversation does not improve its position. | `src/service.mts:137–156` | Add authorized activity metadata and explicit recent/created/title/active ordering. |
| Every command obtains a full backend/desktop snapshot and reconstructs the graph; summaries count cloned bodies before scope filtering. Detail materializes a whole transcript before paging. | `src/service.mts:76–79`, `:137–156`, `:236–239`; `../integrated-backend/src/core.mts:840`, `:1135`; `../integrated-backend/src/desktop.mts:791–827` | UI result limits are not proof of bounded backend work. A trusted same-process read view and separately measured canonical paging are needed. Fallback performance remains unqualified. |
| Collections have stable IDs, parent IDs, smart rules and manual pins, but UI exposes flat selects with a single indentation mark. | `src/service.mts:159–164`; `src/ui.ts:139` | Render native collapsible project/folder hierarchies; distinguish manual pins from derived membership. Parent/cycle validation stays canonical. |
| Smart-save ignores the create result and looks up the collection by title. Smart rules currently derive conversations, while mixed search also finds resources. | `src/ui.ts:64`; `src/service.mts:163`, `:226–231` | Use the returned canonical collection ID; label saved search as a conversation rule instead of promising all resource hits. |
| `run()` resolves without doing work while busy; public open uses it. Filters queue a later refresh without invalidating an earlier in-flight scope. | `src/ui.ts:87`, `:165`, `:174`; collection open already waits at `:152` | Serialize navigation intents and invalidate superseded read rendering. Never replay a mutation merely to recover navigation. |
| Shared composer/draft sessions preserve canonical IDs and CAS recovery across presentations. Provider output comes from actual observations. | `src/ui.ts:88–100`; `src/chat.ts:25–58`; `src/draft-session.ts` | Preserve the component/editor and external-session ownership; no parallel composer or auto-send. |
| Branch lineage is a raw whole-family ID list; fork selection is limited to the loaded message page. | `src/ui.ts:101–108`, `:127` | Add a compact parent/current/child/sibling navigator and exact fork-source navigation. Keep full-history fork selection and spatial Constellation work explicit follow-ups. |
| Native ChatGPT fidelity is unestablished and disclosed separately from inference and local Codex navigation. Root has added trusted ChatGPT/reference opening. | `src/native-chatgpt-fidelity.ts`; `src/ui.ts:7`, `:23–39`, `:72–78` | Preserve Root's optional native opening hook and all provider booleans; no account/history/memory imitation. |

## Compact interaction model

| Presentation | Primary interaction | Contextual depth |
| --- | --- | --- |
| Quick switcher | A bounded recent/favorite/current-project conversation list; keyboard search and the same canonical open operation. | Quick creation; observed running state. It is a manager navigation surface, not a second universal command system. |
| Conversation library | Conversation-first browse, then explicitly scoped/grouped search. Native collapsible project and nested collection branches provide location. | Sort/filter, manual-versus-smart membership, archive and existing organization controls on demand. |
| Workspace/focused chat | Keep the same shared editor/session and actual provider observations. | Root/Universal own placement and Motion Coordinator transitions; CP supplies navigation/state hooks only. |
| Branch navigator | Current/parent/children/siblings by canonical ID, human title, provider and real observed state. | Fork boundary/source, native-fork versus application-continuation labels, attributable sharing controls. No merged hidden state. |

Use existing decorated summaries/buttons, native disclosure/keyboard behavior and the established glass hierarchy. Titles lead; location, activity and provider follow; technical IDs remain inspectable. No independent animation scheduler, permanent settings wall or optimistic mutation success.

## Acceptance ledger

| Journey | First-slice source scope | Still requires integrated proof/follow-up |
| --- | --- | --- |
| A Start talking | Default title and ordinary local creation, actual provider capability labels. | Native interaction and any separately authorized provider; ChatGPT fidelity remains held. |
| B Find old conversation | Conversation-first browse, grouped search, exact message open, sort choices. | Native workspace return/selection and large old-history coverage. |
| C Organization | Canonical nested collection/project navigation, manual/smart distinction, returned-ID correctness. | Transactional bulk actions/undo, actual restart and hierarchy/access journeys. |
| D Fluid expansion | Preserve shared draft/composer/caret/scroll/navigation IDs in CPU tests. | Root/Universal native placement, focus transition, Motion Coordinator and reduced-motion proof. |
| E Connected Branches | Compact canonical lineage and fork-source links, existing selective sharing/review. | Native journey, spatial Constellation, broad fork selection, independent post-fork/handoff proof. |
| F Vela organization | Existing canonical discover/organize ports stay authoritative. | Vela candidates/review/apply and no unrelated movement/disclosure in the actual app. |
| G Large library | Bounded result metadata with honest coverage; optional same-canonical read seam. | Synthetic scale measurements, native input/paint/scroll/refresh/concurrency; no timing claim from unit tests. |
| H Recovery | Draft-drain and navigation queues with no execution replay/cancellation. | Separate-process restart, interruption, selection/organization recovery and provider unknown-outcome checks. |

Outputs 1–3 are this source audit, interaction model and existing-system visual plan. Outputs 4–6 require implemented source plus Root integration. Outputs 7–8 (real performance, native images/motion) remain Root-owned and unperformed by this source-only lane. Output 9 must list exact executed checks; output 10 remains this ledger and release notes. Unit checks do not establish artistic, accessibility, provider or native/performance acceptance.
