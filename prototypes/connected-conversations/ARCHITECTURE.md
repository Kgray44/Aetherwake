# Architecture and lineage model

## Boundary

ConversationGraph is the application-owned source of truth. Conversation, Message, LineageEdge, ContextPackage, and Artifact are separate records. The CLI graph view projects these records; it never owns the relationships. A conversation has a stable Aerynth ID, a local session ID, and an optional provider session ID. The latter is scoped to its provider, not interchangeable with an Aerynth identity. A chat needs no task or agent.

Each conversation owns an append-only message sequence. A branch edge points to an exact source message and a parent conversation. Visible pre-fork history is resolved by walking ancestry through that boundary; no parent messages are copied into the child's own sequence. Future messages stay with their authoring branch. Multiple children can refer to the same source message, and nested branches retain their chain.

Messages carry role, provenance, references, constraint flag, sensitivity label, creation time, and optional provider turn ID. A handoff stores selected source snapshots, SHA-256 digests, source IDs and times, references, classification, excluded IDs, artifact IDs, transfer mode, and state. This is deliberately separate from canonical message history. Context snapshots are audit evidence, not independent authority.

## Fork semantics

- Application continuation: open a fresh provider session using an explicit package. This is how ordinary-to-Codex, Codex-to-ordinary, ordinary-to-ordinary, and unsupported same-provider forks work.
- Simulated native fork: allowed only when source and target providers match, the adapter reports supported and authorized native forking, the selected source message has a completed provider turn ID on the source conversation, and all history through that boundary is included. This avoids falsely claiming a selected-context native fork when the provider actually copies stored history.
- The adapter's mock native fork is a deterministic stand-in. A real Codex adapter must map the source message to a completed turn and pass its provider turn ID to thread/fork as lastTurnId. Runtime feature discovery, auth, errors, and exact source availability must be checked. A provider's native fork does not create Aerynth connected-branch knowledge exchange by itself.

An independent app-level continuation records the source and keeps the original provider session untouched. The package contains only selected messages up to the fork point. The user can choose another provider for each branch. Selection preserves source order. Messages after the fork point or outside the visible ancestry are rejected. The demo adapter returns a labeled response and an explicit mock artifact reference.

## Capability and privacy

ProviderSnapshot separates provider availability, feature support, authorization, and feature availability. It also records models, usage category, quota and last error fields. The mock snapshots are fixture data, not real entitlements. A production adapter must refresh snapshots on auth, account, provider, or policy changes and verify a selected model through a successful permitted inference, not catalog presence alone.

Sensitive messages require an explicit allowSensitive decision in the domain API. Restricted messages cannot enter handoffs. Source unavailability blocks new inclusion and marks existing snapshots stale. This is a prototype boundary, not a full permissions engine: access scope, destination-specific egress approval, source deletion, revocation of already supplied provider context, encryption, and policy inheritance remain integration requirements.

The graph can inspect whether a source has become unavailable or changed since the handoff. The source message and handoff package are distinct records; a stale package remains visible as historical evidence. An interrupted or failed provider open leaves a failed/interrupted branch and handoff instead of inventing a successful session.

## Persistence and validation

Schema version 1 serializes the full application graph as JSON. Import validates version, unique IDs, references, message sequence, parent uniqueness, cycle freedom, source snapshots, and content digests. Idempotency keys prevent duplicate chat, branch, message, and mock-turn results on repeated requests. The CLI writes a complete JSON snapshot; production storage needs atomic writes, migrations, access controls, durable event journaling, and concurrent-writer handling.

## Future integration contracts

### Workspace Kernel

The Kernel should own persistent conversation/message/resource IDs, access scopes, reference resolution, lifecycle, atomic transactions, indexes, retention, and multi-view synchronization. It should expose typed read and mutation APIs independent of graph rendering. Branch IDs, fork origins, and handoff references must survive workspace moves and app restarts. Knowledge discovery after a fork should retrieve cited sibling findings by policy and require explicit adoption; this prototype demonstrates initial handoffs, not the full post-fork family knowledge index.

### Codex Bridge

The Bridge should implement ProviderAdapter with capability discovery, initialize/initialized handshake, turn/session lifecycle, approval and interruption handling, provider ID mapping, and observed events. For native forks, map a message to a completed Codex turn and call thread/fork with lastTurnId. For cross-provider continuation, create a new session with the inspected Aerynth package. Track whether the provider accepted, completed, failed, or interrupted the handoff; never infer implementation success from a completed turn. Any real execution requires sandbox and worktree permissions independent of chat lineage.

### CIE, trust, and observability

CIE should select authorized context, with source freshness and a previewable inclusion manifest. Trust policy must gate classification and egress before relevance ranking. Intelligence Streams should record observed provider events separately from mock output, agent reports, and inference. The Context Inspector should distinguish discoverable, inspected, attached, and actually supplied material. These integrations are not implemented here.

## Open decisions

- How canonical message IDs map to provider items and turns across pagination, compaction, and reconnect.
- Whether a provider can fork at an exact message; Codex App Server documents a turn boundary. When a selected message is inside a turn, use application continuation or a truthful best-supported boundary.
- Secure deletion and revocation propagation for already exported or provider-supplied snapshots.
- Local storage engine, migration strategy, concurrent clients, and long-history performance.
- Policy and user experience for sensitive-context consent and optional sibling knowledge adoption.

The established Constitution is binding. Specialized charter references are published drafts awaiting owner acceptance; this prototype follows their direction without claiming ratification or product acceptance.
