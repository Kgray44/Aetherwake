# Direct card interaction

The owner requested consistent card edges, effortless resizing, and removal of move controls and taskbar-style workspace setup.

Rectangular, folio and rounded cards now share an 18px contour in the single GPU/DOM outline contract. Focused readers join the same outline. Deliberate compact circles, lenses and pills retain their distinct silhouettes. Canonical shapes and geometry do not need a destructive migration.

The native application mounts `mountDirectManipulation` on existing articles. A noninteractive surface starts dragging after a four-pixel threshold. Text editors, selectable transcripts, links, inputs and buttons retain their ordinary behavior. Invisible edge and corner regions resize with native directional cursors. The existing `LayoutGesture`, preview policy and Motion Coordinator perform geometry; no resource, renderer or animation scheduler is duplicated. An actively manipulated pose snaps through that same coordinator so it follows the pointer directly, while neighbors retain coordinated movement.

Release records one revision-fenced canonical placement command. Escape, lost pointer capture, hidden surfaces and workspace/revision changes cancel previews. Keyboard focus on a card supports arrow movement and Shift+arrow resizing; Alt makes one-pixel adjustments. Resource editors retain DOM identity and do not receive redundant value assignments during reconciliation.

Legacy move arrows, grip buttons, per-card resize widgets, canvas pan buttons and the persistent bottom dock are removed from the integrated application. Fluid, Freeform and Structured appear in a compact section beside the workspace entry, with Add and an overflow action. Resource navigation, history, streams and connections remain available in contextual workspace actions. Per-card context actions offer focus, stacking, locking, removal and presentation; they contain no numeric move/resize setup. Blank-canvas navigation and other retained shortcuts remain host-owned.

`integration-direct.cjs` is an actual desktop test driver for the native host's `--integration-direct` dispatch. It uses explicit synthetic fixture commands, then native mouse input for surface dragging and all eight resize directions, cancellation, compact mode selection, editor identity/selection and fresh-process persistence. Captures require a focused window and a new GPU draw submission. This source checkpoint passes the application typecheck and 79 visual regression tests; the driver has passed syntax checking. Running and inspecting the native journey remains required before calling this interaction change demonstrated.

The separate Fluid visibility fix is `8ca89ec`. Its older glass-host verification passed 10 native checks with four source-bound images; that evidence does not qualify the new gesture/corner patch.
