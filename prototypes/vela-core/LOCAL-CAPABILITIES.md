# Vela local facts

Vela's composer sends free text to the configured planning model with the
reviewed context and the available typed capability catalog. The model can
select `readLocalFact` for device time, device date, physical RAM, active
workspace layout status, active project count, or Aerynth execution status.
The trusted backend validates the capability and measures the fact after
inference. A single local fact lookup runs under host policy after provider
consent. The observation stays in Aerynth and is displayed from its canonical
message and receipt. Plans that change the workspace still require action
review. The weather capability has its own location-sharing review.

The model can also select the typed search action. Aerynth searches the
current scope by title, ID, or resource type and displays up to 12 results
that can be opened directly. The receipt stores only canonical references.
Aerynth resolves them again against current permissions on every display,
including after restart. Search results stay in the local application.

The trusted backend also accepts an explicit typed
`VelaService.local({capabilityId, intent, commandId}, signal?)` call. The
desktop renderer has no direct route to this operation. The host supplies
`VelaLocalHost`, including the native clock and targeted status readers.
The same canonical transaction stores the user message, observed assistant
message, and the linked fact record. Repeating the same authorized command
ID retrieves the original observation. An unknown capability, changed
intent or policy, or missing canonical message fails closed. Existing
recorded local answers retain their IDs, attribution, and timestamps.

Workspace status describes the saved layout. Execution status covers
Aerynth-owned executions, including unknown outcomes. The clock uses the
device's time zone and locale. Physical memory is derived from Node's
`os.totalmem()` and `os.freemem()` at the time of the read. On Windows the
available value is OS-reported available physical memory. The result
represents the system's physical memory rather than an individual process.
