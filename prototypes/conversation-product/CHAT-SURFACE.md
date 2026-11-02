# Shared conversation presentation

`src/chat.ts` exports the browser-only `mountConversationChat(container, options)`
for focused resource views and the global Conversations manager. The manager uses
the same component. Canonical history, mutations, drafts, source permissions and
native consent remain owned by the injected existing command port.

```ts
mountConversationChat(container, {
  port, resourceId, draftSession: sharedSession, execution,
  onMessageAction: ({ action, message, selection }) => { /* host-scoped extras */ },
});
// { ready, refresh({aroundMessageId?, latest?}), focusComposer(), flush(), dispose(), whenSubmissionSettled() }
```

`ManagerOptions.draftSession(resourceId)` lets the host give full and inline views
one coordinator. Supplied sessions are flushed and unsubscribed, never disposed.
Fallback sessions are owned by the component/manager. `flush()` drains only draft
persistence, including captured submissions and later typing. It never waits for a
native provider turn or issues interruption. Hosts must await it before closing;
unresolved recovery conflicts prevent disposal. Closing promptly detaches UI and
observations while the existing native send/receipt continues. A pending internally
owned session stays alive only until exact acceptance/CAS processing finishes, then
is released by a caught background finalizer; externally owned sessions remain owned
by their host. Detached sends do not refresh the closed UI or invoke `onChanged`.
`whenSubmissionSettled()` explicitly observes that pending acceptance work; ordinary
close and before-quit editor draining must not await it. If the renderer exits first,
the already-flushed recovery remains and canonical host execution/receipts own the
execution lifecycle.

The composer supports Enter to send and Shift+Enter for a newline, without sending
during composition. Native send review remains explicit; there are no renderer
grants. A failed, cancelled or unknown send retains recovery. Only proven canonical
submission acceptance can acknowledge the captured draft checkpoint. Newer typing
and conflicting CAS revisions survive. Quotation edits a draft and never sends.

`ConversationExecutionPort.observe(resourceId, listener)` supplies whitelisted public
execution records and optional observed assistant deltas `{eventId,cursor,text}`.
Metadata does not consume a delta's ID/cursor. Connection-only observations may
report `available`/`unavailable` without inventing an execution. Disconnection shows
the last observed state and unconfirmed outcome. Stop calls explicit `cancel(id)`;
a requested interrupt remains unconfirmed until a terminal observed record. A
completed provider turn is never presented as a verified task. Without this port
there is no streaming/cancel claim; canonical history/send still work.

Assistant Markdown supports paragraphs, headings, flat lists, quotes, fenced code,
inline emphasis/code and safe http(s)/mailto links. HTML is literal; no remote
media is loaded, no highlighting code executes. Copy uses exact stored source.
Per-message provider bindings are absent from `MessageView`, so historical messages
are labelled Assistant (or simulated source), while the current composer and
observed execution show their actual provider. No historical provider is guessed.

Message actions are focus accessible. Branch/source operations use canonical IDs.
Selective publication uses an explicit raw-source disclosure so Unicode offsets
refer to the original message even when Markdown presentation omits syntax. The
component emits a reviewed selection callback; it never grants sharing access.

Embedded manager chrome is transparent; `embedded:false` opts into the standalone
frame. Transcript and history occupy flexible panes without nested viewport-height
scroll limits. The composer stays outside transcript scrolling. Organization,
lineage and sharing are contextual disclosures. Narrow views expose History as a
separate view, keeping the chat readable.

Validation: CPU-only DOM/event-adapter tests cover canonical identity, keyed refresh,
caret/scroll retention, safe Markdown/code copying, Enter/IME, pending-send drain,
CAS conflicts, accepted/cancelled/failed/unknown sends, shared session ownership,
exact source selections, revoked reads, real-observation-only stream/cancel and
disconnect/order handling. These tests do not qualify actual browser layout,
native consent, live providers, visual quality, GPU/performance or owner acceptance.
Parent integration owns the actual inline mount and execution adapter. Existing
native helpers need to select `.cp-message-raw` in “Select source excerpt” for
publication and inspect `.cp-chat-status` for send feedback.
