# Aerynth — Product Vision and Requirements
**Project:** Aetherwake  
**Application:** Aerynth (working name)  
**Persistent assistant:** Vela (working name)  
**Visual language:** Liquid Intelligence  
**Status:** Design baseline, not a claim that features have been built.

## 1. Product promise
An intelligent, spatial, adaptive desktop environment in which natural-language intent, traditional chats, projects, resources, specialized agents, and reliable automation coexist. The experience should feel like a cinematic AI presence while remaining a genuinely practical engineering tool. First-class visual polish is an acceptance requirement, not an optional skin.

### Non-negotiable principles
- The user expresses intent; Aerynth handles the complexity.
- Intelligence should be visible when useful, invisible when unnecessary, accessible everywhere.
- Never make the user work harder to use the AI.
- Ordinary chat stays fast, simple, and complete; no formal task required.
- Show real state and observable events, not invented reasoning or pretend progress.
- Keep raw historical records separate from optimized context.
- Make organization adaptable, legible, discoverable, and reversible.
- Optimize actual useful outcomes, not agent counts, particle counts, or token counts alone.

## 2. Domain model and navigation
**Project:** Persistent body of work containing knowledge, settings, resource associations, chats, agent configurations and multiple workspaces. Projects may be organized into categories and overlapping collections.

**Workspace:** Reconfigurable working surface with blocks, saved layouts, templates, context, and rules. It may belong to a project or exist independently. A project can provide several workspaces; layout is not the same thing as ownership of resources.

**Block:** A visual representation of an underlying resource or computed view. The same resource can be shown in several blocks/workspaces without duplication. All blocks support consistent selection, focus, resizing, layout, detach/dock where possible, and contextual commands. Proposed block types: chat, agent, group, task, folder, file, terminal, website, GitHub, Git diff, note, knowledge, chart, timeline, system monitor, server monitor, activity/Intelligence Stream, console, media, browser, calendar, search, notifications, and Vela.

**Resource:** Persistent uniquely identified chat, agent, task, file reference, website, note, knowledge card, timeline, etc. Keep identity independent of display coordinates, parent folder, and current window.

**Collection:** Manual folders/tags plus smart collections driven by query rules. Chats and other resources may belong to multiple collections; no destructive reparenting for simple organization. Support AI-driven organization of chats by topic.

**Relationships:** Typed, inspectable connections between resources (belongs-to, references, works-on, derived-from, depends-on, forked-from, handoff-to, evidence-for, etc.). Graph views must use progressive disclosure, clusters, labels, filters, and conventional list/tree fallbacks rather than a chaotic cloud of lines.

## 3. Persistent assistant: Vela
Vela has durable app-level awareness via indexed metadata, notes, knowledge, selections, permissions, and event streams; this does NOT imply loading everything into the model. Available everywhere via ambient presence, lightweight conversation, and universal command mode.

Vela can navigate, create workspaces and blocks, organize resources, surface relevant history, generate timelines, delegate bounded work, inspect agent outcomes, and coordinate specialized agents. Use typed app commands for native UI actions, not mouse automation against Aerynth itself. Provide discoverable action history, undo when feasible, and confirmations for consequential filesystem/network actions.

**Initiative Engine:** Proactive suggestions, monitoring, recap, and notifications with per-category attention budgets, silence/focus/gaming policies, urgency controls, suppression and explanations. It can record noteworthy activity when the GUI is closed only if a real service/monitor remains running or external events are reconciled later. Never claim invisible monitoring is happening without a running source.

**Adaptive Experience Engine:** Learn layout, chat-organization, notification, agent/model and response preferences from opt-in observed usage. Levels: manual, suggestive, assisted, adaptive, independently controlled by category. Explain why a preference was inferred; support correction, export, reset, and undo. Never silently escalate permissions or destructive powers.

## 4. Conversations and agents
- Full Codex-like chats with conversation streaming, tool activity, images/files where supported, models/reasoning options, status, search, favorites, folders, smart collections, archive, and forks.
- User can simply chat; tasks and agents are enhancements, never prerequisites.
- Chats can appear in multiple workspaces. Settings inherit global → project → workspace → chat → individual task, showing provenance and easy overrides.
- Configurable specialist agents: personality/instructions, skills, tools, model, reasoning, directory, permissions, memory, report destination, and profiles.
- Natural-language delegation: from an existing chat, Vela identifies independent tasks, constructs task-specific evidence/context, opens separate chats and isolated workspaces/worktrees when appropriate, and tracks milestones, blockers, verification, and review. Favor efficient parallelism, not maximum agents.
- Maintain separation of chat (communication), agent (configured worker), task (durable objective), and execution (one attempt); tasks can outlive chats and agents.
- **Connected Branches:** retain independently forked threads. Offer independent, connected-retrieval, and collaboration modes; preserve provenance and verified finding cards; never silently mix entire branch histories or override a branch's decisions. User may explicitly promote selected findings from one branch into another.

## 5. Quick capture, notes and project knowledge
- Single-shortcut, zero-friction Quick Capture from anywhere within Aerynth, persisted before optional AI analysis.
- Notes as movable blocks, attached annotations to exact resources and selected ranges, project notes, and an independent chronological user Thought Stream.
- Preserve distinction among brainstorming, hypotheses, verified facts, decisions, instructions, and requirements.
- Project Knowledge: structured architecture, facts, constraints, decisions, active objectives, references, history, and editable documents/papers.
- Per knowledge item: always include, retrieve on relevance, manual only, and never send. Permit project and task overrides.
- Vela can suggest knowledge relationships and collections without automatically elevating an unverified note to authoritative instructions.

## 6. Universal Contextual Command
- Support selecting text excerpts, chat messages, images/regions, files, folders, chart ranges, timeline events, notes, agents, and mixed groups of resources.
- Selection creates an anchored, subtle command surface; typed or spoken command receives structured target references and surrounding context.
- **Selection is evidence/context, not automatically the operation scope.** Example: select one file; "move all files from this folder" means folder contents; "move only the selected file" means exactly that file.
- Resolve scope using explicit wording first, then selection + containing context. Show proposed targets in a live preview, especially when inferred scope differs from the initial selection.
- Allow multi-object selection, preview, cancel, and undo; require appropriate confirmation for broad or destructive operations. Support drag-to-agent and drag-to-chat context attachment as alternate interactions.
- No model call required for simple navigation or deterministic local commands.

## 7. Timeline, spatial views and replay
- **Historical Timeline:** real activity and event correlation, filters, zoom, drill-down, and replay of actually captured state. Record missing intervals.
- **Planning Timeline:** when requested, produce a visual block with estimates, dependencies, uncertainty ranges, and live updates as task status changes; never present speculative completion times as guarantees.
- **Relationship View / Agent Constellations:** show evidence-based nodes and edges with focus, progressive disclosure, search, and non-graph alternatives.
- Workspace snapshots, focus mode, visual workflow composition, universal search, command history and explainable action provenance.

## 8. Login / home / multi-display
- Launch/resume experience with an attention-aware digest of events since last relevant review, not merely since process startup. Each update actionable; coalesce noisy events.
- Customizable home dashboard with blocks, layouts and role-based notifications.
- Intelligent multi-monitor layouts: preserve separate single/dual-monitor layouts, semantic display roles, resolution/DPI changes, fallback positions, detachable windows, and reliable restoration. Avoid losing content offscreen.

## 9. Context Intelligence Engine (CIE)
Treat context as a carefully assembled working set, not a copy of every resource.
- Relevance-first retrieval across indexed resources and conversation history, with transparent citation/provenance.
- Multidimensional ranking by task relevance, recency, decision weight, reliability, dependencies, uniqueness, retrieval cost and explicit user pinning.
- Preserve immutable/accessible complete transcript and artifacts; maintain separately compacted working summaries. Never erase original history as a side effect of context compaction.
- Adaptive age-based decay applies to active context prominence, not irreversible storage deletion. Old important facts survive; old irrelevant detail remains searchable.
- Durable Task Memory: goals, decisions, modified files, evidence, blockers, tests, outcomes, handoff checkpoints.
- User-controlled profiles: minimal, lean, balanced, comprehensive, maximum, adaptive; per project/workspace/chat settings.
- Deduplicate overlapping instructions and avoid unnecessarily large tool outputs, where controlled by our own tooling; do not pretend we can transparently intercept every internal Codex message.
- Observe actual results and token spend; evaluate savings vs regressions rather than assuming shorter context always improves quality.

## 10. AI Execution Profiler / Intelligence Streams
- Separate **user Thought Stream** (notes) from **Intelligence Streams** (observable agent/chat/app execution activity).
- Each chat, agent, task, project, Vela and global scope supports live activity stream blocks.
- Three principal views: readable progress/reasoning *summaries*, detailed command/tool/event execution, spatial live workflow visualization.
- Capture available events: starts/stops, status, plans, tool calls, commands/output, file diffs, delegated tasks, approvals, errors, results, available reasoning summaries, token usage, measured timing, review results, provenance, correlation IDs.
- Classification: observed, agent-reported, inferred, unknown. **Never claim complete access to hidden chain-of-thought.**
- Historical replay and event-based animations from an append-only event store; distinguish real events from simulations, missing periods and synthetic demonstrations.
- Extremely detailed telemetry at available granularity: elapsed, time-to-first-output, streaming, tools, idle/wait, token input/output/cache/reasoning as reported, context estimates, usage by chat/agent/task/project, time series, per-chat running counters and outcome efficiency.
- Treat reported, inferred, and estimated measurements distinctly. Subscriber usage is not automatically a reliable dollar-cost measure. Budgets must distinguish alerting vs enforced task admission; hard interruptions may not stop already in-flight consumption.
- Vela can explain what an agent is doing and whether verified output has been delivered, using observed evidence.

## 11. Security, autonomy and privacy
- Public repo: only generic product requirements and sample/simulated data. Never store private chats, actual credentials, personal notes or telemetry.
- Least-privilege tools, auditable approvals, isolated worktrees and safe server boundaries. No silent destructive operations. Protect main and production world/state.
- Explicit connected-source grants and scoped background monitoring. Clear indicators when observation is active.
- Offline navigation, notes and organization should work without Codex; model usage and external integrations may require connectivity.

## 12. First milestone and success tests
The first experience must look and feel extraordinary while proving practicality:
1. Cinematic Liquid Intelligence scene with meaningful motion and Vela presence.
2. Draggable/resizable blocks, spatial transitions, focus mode and a saved workspace.
3. Quick Capture note and contextual command with visible target/scope preview.
4. Chat experience and *one real* Codex App Server event stream behind a secure adapter.
5. An Intelligence Stream that clearly distinguishes real events and simulated demos.
6. Profiling of frame timing, idle resource use, and degraded/gaming mode.
7. UI accessibility: keyboard controls, reduced motion, readable typography, fallbacks.

This is a product specification, not evidence that the features are implemented.