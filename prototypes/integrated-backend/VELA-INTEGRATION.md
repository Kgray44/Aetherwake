# Canonical Vela backend integration

`BackendCore` now initializes `VelaService`, `createCanonicalVelaHost` and `CodexPlanningAdapter` on the existing kernel SQLite connection, canonical graph and rollback boundary. No resource, transcript or execution database is added. `vela_state` holds Vela request/plan/preferences/attention metadata; core state stores the stable local `system:vela` conversation binding and per-message actor/provider/evidence references. Raw Codex output remains in the canonical Codex planning conversation. Execution state remains exclusively in canonical `executions`; planning diagnostics expose references, stages, cancellation observations and event coverage without a competing execution state.

## Native broker contract

The renderer-facing family is **only** `command('vela', {name,input})`, with an explicit switch:

| Name | Input |
|---|---|
| state, open | `{}` |
| search | query string |
| request | `{intent,resourceIds,authorizeProvider,previewId?,grantId?}` |
| native | `{intent,action}` |
| review | `{planId,fingerprint,decision:'approve'|'reject'}` |
| apply | plan ID string |
| cancel | request ID string |
| preferences | `{expectedVersion,patch}` |
| reviewAttention | event ID array |
| adaptationPolicy, explicitPreference, reviewPreference, resetPreferences | Existing `VelaClient` typed input |

`state` returns `VelaBackendState`: existing `VelaState` plus `nativeCapabilities` and `planningReferences`. `open` records local presence and establishes the same canonical local Vela conversation; it never starts inference or acknowledges events.

The trusted native service also has these **host-only**, explicitly typed commands. Renderer/tool routing must exclude them and must strip renderer-supplied preview/grant IDs:

1. `velaRequestPreview({intent,resourceIds})` returns `{id,intent,resourceIds,context,signature,scopeStamp,providerId,expiresAt}` without opening/appending a conversation or starting a provider.
2. After showing exact provider/source consent, `authorizeVelaRequest({previewId,signature})` returns `{grantId,expiresAt}`.
3. Forward `vela.request` with the actual preview/grant IDs added by the native broker. `authorizeProvider:true` alone never authorizes anything.
4. For a reviewed plan containing `delegateTask`, separately show each actual recorded provider/objective/resource step and call `authorizeVelaDelegation({planId,stepId,fingerprint})` before forwarding `vela.apply(planId)`.

Provider grants bind exact intent, all discovered/omitted/included metadata/content/digests/versions and policy, current project/workspace versions, provider instance/account destination, and expiry. Only fresh manifest ID/time are excluded from stable egress comparison. On request creation, policy binds the real request ID. The actual Codex adapter then binds the full manifest hash and exact bounded prompt hash. Changes reject; grants are single-use and memory-only, so restarting revokes native authorization rather than restoring it from a renderer or disk record.

Separate delegation authorization binds the reviewed plan fingerprint, exact step/action/objective/resource IDs and attenuated metadata/content manifest. Its execution opens a canonical provider conversation linked to the original Vela conversation and returns an actual canonical execution ID as the receipt. Neither provider completion nor an applied delegation receipt verifies the task objective.

## Released native capability bootstrap

`core.registerVelaNativeCapabilities({supportedActions,dispatch,workspaceRevision?,applyPreference?})` is a trusted **in-process bootstrap API**, never an RPC or generic renderer handler-registration API. `setVelaSelection(resourceIds)` is the corresponding trusted current-selection bridge. Parent native/desktop host owns both bridges.

Without a registered released capability, workspace/block creation, attachment and layout/preset commands are unavailable. `workspaceFromResources` is forwarded unchanged to the parent/Universal Block System dispatcher; Vela supplies no fallback workspace/block/placement/template/layout implementation. The default local-owner subset supports canonical standalone note/task resource capture (no placement), content/task/group/relationship operations and navigation through existing application commands. Resource capture with a workspace requires a registered placement capability.

Native dispatch validates paired `ResourceRef.version` freshness through the canonical helper. Typed command `expectedVersion` remains the actual underlying resource mutation version and is separately checked. A pairing token is not accepted as a replacement SQL/native version. Workspace projection revision comes from the registered engine callback, or the actual existing canonical layout revision before that port is registered.

Local-owner scope follows current project/workspace and actual placements. Null-owner legacy chats placed only in another project do not become global sources merely because their SQL project association is null. Metadata discovery never reads note bodies/transcripts. Content retrieval is separate, access checked, source linked and versioned. This is a single local-owner profile; it makes no multiuser, ChatGPT-history or arbitrary account-access claim.

Canonical application events feed explicitly subscribed attention. Quiet remains silent; opening does not review events. User-origin workspace preset selections can provide real event-linked preference evidence when both that event source and the adaptation category are enabled. Learning defaults off; external monitoring is absent. Applying inferred presentation preferences additionally requires the registered real host preference capability.

## Verification and remaining acceptance

- Existing full backend suite: **49/49 passed** before the final additional delegation regression, 38,519.993 ms reported duration.
- Final targeted Vela backend suite: **9/9 passed**, covering real SQLite local identity/provenance/restart, native operations, read-only preview, exact grants/stale scope/expiry, placement denial, capability gating, uncertain receipts, event attention/adaptation and separately approved delegation through an explicitly synthetic fixture provider.
- Existing Vela module: **33/33 passed**. Full integrated-backend TypeScript check passed with zero diagnostics. Original tracked CRLF source style is preserved; whitespace verification uses `git -c core.whitespace=cr-at-eol diff --check`.

Tests use synthetic records, injected explicitly named planning-port doubles and existing fixture executions. No actual Codex/model turn, native application window or network request was launched. Parent owns native broker/bootstrap, mounted panel, released Universal Block wiring and actual combined/live acceptance. Selecting the Vela conversation itself as context can become stale when the request appends its new user message; this first integration fails closed in that case rather than granting a changed transcript implicitly. Additional provider-managed context, inaccessible reasoning and unsupported account history are not claimed.
