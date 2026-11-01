# Handoff examples

These values come from the deterministic demo. Times and IDs are deterministic fixture data, not live provider observations.

## Ordinary chat to Codex build branch

- Parent: conv-00001, ordinary chat on mock-ordinary.
- Fork point: msg-00005, the user's privacy constraint.
- Child: conv-00006, mock Codex chat.
- Edge mode: application_continuation. A fresh mock Codex session receives a bounded package; it is not a native Codex fork.
- Included: msg-00003 (app idea) and msg-00005 (privacy constraint). Both retain source conversation, source time, role, provenance, classification, and digest.
- Excluded: msg-00004 (assistant follow-up). This message remains in the original chat and is not included in the package.
- Handoff state: ready, with a mock adapter acceptance timestamp.
- Output: msg-00011, explicitly labeled MOCK Codex artifact, with artifact-00012 pointing to mock://garden/build-plan.

A compact inspector view:

~~~json
{
  "handoffId": "handoff-00007",
  "forkMessageId": "msg-00005",
  "mode": "application_continuation",
  "included": ["msg-00003", "msg-00005"],
  "excluded": ["msg-00004"],
  "state": "ready",
  "staleMessageIds": []
}
~~~

## Codex result back to ordinary chat

- Parent: conv-00006, mock Codex conversation.
- Fork point: msg-00011, the mock output.
- Child: conv-00013, ordinary chat on mock-ordinary.
- Included: the original privacy constraint msg-00005 and mock result msg-00011.
- Attached artifact reference: artifact-00012.
- Excluded: earlier context and the build prompt that were not selected for this discussion.
- Origin is traceable through both edges: conv-00013 → conv-00006 → conv-00001. The original conv-00001 still owns exactly msg-00003, msg-00004, and msg-00005.

## Stale source

Marking msg-00003 unavailable prevents it from being selected for any later handoff. Inspecting handoff-00007 then reports msg-00003 under staleMessageIds while retaining the historical package for audit. The prototype does not implement deletion or revoke data already sent to a provider.

## Native fork distinction

The mock Codex-to-Codex test uses a completed mock provider turn and includes all history through that turn. It marks the edge native_fork only under those conditions. A request at an uncompleted user message or a request that excludes pre-fork history becomes application_continuation. The mock label remains attached to the provider; this is a semantics test, not proof of a real Codex server fork.
