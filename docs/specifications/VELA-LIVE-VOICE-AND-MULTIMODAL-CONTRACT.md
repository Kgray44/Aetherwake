# Vela Live Voice and Multimodal Delegation Contract
**CF-SPEC-02 · owner-accepted 2026-11-05 · live-session qualification still required**

> **Owner-accepted specification (2026-11-05).** The contract and release criteria are binding design targets subject to the governing charters; actual capability, security and usability require implementation and independent test evidence.

## 1. Intended experience and authority

Vela has one persistent identity whether spoken, typed, shown in a block, represented by the GPU Mind, or executing an agent task. The user may interrupt her speech, modify a request, request help with the current screen, or watch work advance without losing the current workspace and conversation.

Governance ownership: 01 governs interaction; 05 owns task state; 06 owns Vela identity and adaptation; 08 owns memory; 09 owns event truth; 12 owns provider transport; 13 and 02 own rendering and interaction performance; 14 owns microphone, data and system consent; 15 owns acceptance. This document is subordinate to all.

**GPT-Live with client delegation is the preferred candidate, not a presumption of verified current implementation.** It connects a fast conversational frontend to Aerynth's canonical backend reasoning, tools and agent runtime. Realtime or a chained transcription/Responses/speech path remains an available alternative if objectively better for a scenario.

Sources: https://developers.openai.com/api/docs/guides/live ; https://developers.openai.com/api/docs/guides/custom-voices ; https://developers.openai.com/api/docs/guides/live-prompting

## 2. Voice ownership split

| Component | Owns | Does not own |
|---|---|---|
| Voice UI | microphone permission, device choice, waveform/presence, mute/PTT, stop, accessibility | effect authority, model results |
| GPT-Live conversation | natural turn-taking, interruptions, speech presentation and *decision to delegate* | durable task truth, local OS authorization, provider-wide memory |
| Client delegation adapter | maps utterances to canonical `request_id`, bidirectional status and speech-safe results | isolated second personality or parallel independent task database |
| Vela backend | reasoning, tools, agents, context, plans and result verification | unconditional control of microphone, output device or privacy settings |
| Evidence/Memory | durable observed facts, consent and replay fences, content provenance | a claim of access to private reasoning |
| GPU presence | audiovisual synchronization to verified events, spatial continuity | a fabricated brain-state oracle |

The conversational prompt stays short and contains identity, speaking style, delegation policy and safety cues. Tool schemas, elaborate workflows, long-lived memory and policy live in the backend to avoid forcing a voice model to shoulder an entire software architecture.

## 3. State machine

Voice session: `inactive` → `permission_requested` → `connecting` → `listening` ↔ `speaking` ↔ `delegating` → `ending` → `ended`, with `failed`, `muted` and `reconnecting` as explicit branches.

Delegated task state is independent of speech state. When a user says "stop talking," stop voice playback and any necessary generation, **not necessarily** already authorized external work. "Stop that task" triggers task cancellation and best-effort effect fences, with uninterruptible or unknown external effects separately explained. A revision such as "also inspect the GPU" creates a scoped new task or steering amendment without replaying earlier side effects.

Speech output is linked to one canonical response/message ID and digest. Reconnect, backlog events and provider restarts must never trigger unsolicited rereading of old messages. Voice feedback after a tool call must identify whether the result is measured, estimated, pending, denied, unknown or verified.

## 4. Screen, vision and local context

The user can authorize an image or screenshot from the current Aerynth workspace, selected window, display, or external capture. The frontend labels the capture scope, source time, target window and data classification. Vision-capable backend processing receives only the authorized region and must not infer permission to read other windows, remote secrets or adjacent displays.

The Live frontend's ability to talk does not guarantee it can itself reason over screenshots. If a session/model does not support images, route them to a vision-capable backend and send back grounded findings. Distinguish screenshot observation from live interactive computer control. A visually identified button is not a permission to click it.

For engineering screens, include viewport size, source resolution, scaling and confidence if a measurement depends on pixels. Avoid ungrounded exact physical measurements from screenshots.

## 5. Custom voice identity and audio compatibility

Voice design is an owned Aerynth asset: `voice_profile_id`, model compatibility, prompt/version hash, optional authorized recording consent, output codecs and supported locales, chosen sample rate, acoustic test receipt and rollback reference.

Prompt-generated custom voice is currently a GPT-Live compatibility path. Consent-and-sample voices are a different workflow with their own compatibility. Do not assume a GPT-Live prompt-generated voice ID works with Realtime or generic Text-to-Speech endpoints.

Human acceptance includes:
- neutral American English phonetic stability across varied sentences, no unwanted shifting accent;
- attractive, distinct personality without voice cloning of an unconsenting speaker;
- natural pacing, emotional nuance, low harshness, appropriate pitch and fatigue-resistant long listening;
- real audibility through Windows output selection, Bluetooth headsets, speakers, device hot-swap, mute and system volume;
- clear pronunciation of engineering units, variable names and filenames;
- interruption detection, no repeated utterances, cross-session voice consistency;
- usable captions, transcript privacy and keyboard-only alternatives.

A demo clip is not evidence that the whole Aerynth playback path works.

## 6. Spoken feedback policy

When task work is ongoing: provide concise updates only when useful; do not claim completion until evidence exists. When a delegated agent encounters a consent gate: voice may explain what permission is needed, but the actual approval must be bound to specific effects and a trusted UI/confirmation channel. Sensitive readbacks should be redacted in speech when other people could hear them.

On network loss, speak (if possible) the precise uncertainty and preserve the durable task; don't announce success or repeat. On false wake, avoid actions and record a local diagnostic without storing unnecessary raw audio. On unavailable voice feature, maintain full text/functionality; do not downgrade task reasoning or disable accessible alternatives.

## 7. Performance, cost and privacy

Voice per-second session billing, backend tokens and tools must be metered separately. Keep the API key in protected backend credentials; use short-lived session credentials where supported. Microphone must not activate without explicit user permission and visible state. Recording retention, transcription persistence, training opt-ins and any cross-provider data transfer require disclosed policies.

Prioritize low conversational latency **without** limiting the depth or correctness of delegated work. Voice can respond with an honest "I'm investigating" while backend work proceeds. Never keep an idle paid voice session active solely to create an ambient visual animation.

## 8. Required end-to-end journeys

| ID | Journey | Accept only when |
|---|---|---|
| VO-01 | Ask RAM usage by voice | A real local read occurred; measured value accurately spoken and displayed |
| VO-02 | Interrupt and add a condition | Request/attempt lineage preserved; no duplicate tool effect |
| VO-03 | Pause speech without cancelling task | Speech stops promptly; authorized task continues or safely pauses by policy |
| VO-04 | Cancel dangerous operation | Approval/action state stops within documented boundary; unknown effects shown |
| VO-05 | Screenshot with consent | Only approved region sent; accurate visual answer; no implicit click |
| VO-06 | Voice profile consistency | Prompt-generated voice genuinely used in GPT-Live on real speakers, including restart |
| VO-07 | Unplug/change device | Correct recovery and clear UI state; no unexpected microphone or playback |
| VO-08 | Multi-agent task while speaking | Actual concurrent task receipts and one stable Vela response |
| VO-09 | Reconnect after half-spoken result | No unsolicited backlog replay or duplicate postcondition |
| VO-10 | Credits/account unavailable | Clear fallback, preserved text experience and truthful cost/entitlement |

For each test capture full user-visible audio observations, provider session metadata (redacted), delegated request IDs, tool/effect receipts, caption accuracy, start/stop latency and resource load. Label recorded/synthetic fixtures. At least one real Windows device test is mandatory for audible acceptance; tests on a backend-only server are insufficient.

## 9. Relationship to Vela's 3D Mind

The voice waveform and Vela Mind can respond to real speaking/listening/delegating states. The Mind should show active delegated tasks as event-driven flows and connections, but not claim to depict exact hidden neural or private reasoning. Render state remains responsive after disconnection and under reduced motion; the Motion Coordinator is authoritative.

**Acceptance statement:** Vela is a genuine spoken interface to the same powerful assistant, not a second weaker assistant taped to the first one with a WebSocket.
