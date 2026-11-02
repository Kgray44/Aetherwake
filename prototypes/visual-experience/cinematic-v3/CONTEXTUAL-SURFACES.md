# Contextual glass surface host

Reusable UI host for the Integration workstream's Vela and conversation panels. The module owns temporary placement and focus only. It does not read or write workspaces, resources, provider state or permissions, and it creates no RAF, timer, iframe or renderer. The Integration Lead owns the actual content adapters and shared App wiring; those are not implemented or qualified by this module release.

```ts
import { createContextualSurfaces } from "./contextual-surfaces";
import "./contextual-surfaces.css";

const surfaces = createContextualSurfaces({
  motion: hooks.motion,
  wake: hooks.wake,
  viewport: () => ({ width: innerWidth, height: innerHeight }),
  safeInsets: () => ({ top: 140, right: 16, bottom: 140, left: 16 }),
  restoreFocus: target => target?.focus({ preventScroll: true }),
});
const panel = surfaces.open({
  id: "vela-context",
  anchor: velaButton,
  content: velaContent,
  label: "Vela",
  minSize: { width: 280, height: 160 },
  maxSize: { width: 520, height: 680 },
});

// In the existing App.frame hook, after its shared MotionCoordinator.step:
surfaces.frame(now);
// In the host's viewport / safe-inset resize handler:
surfaces.viewportChanged();
// Explicit close fades through the same coordinator; reduced motion is immediate.
surfaces.close("vela-context", "programmatic");
// During App teardown:
surfaces.dispose();
```

The default is an anchored, nonmodal native dialog. `modal: true` opts into native modal semantics and contained Tab/Shift-Tab navigation. Modal surfaces require dialog semantics. Optional `role` supports `dialog`, `region` and `menu`; a caller that requests menu semantics must supply its actual menu items and arrow-key behavior. This container is not an implementation of those widgets.

`anchor` accepts an HTMLElement, CSS-pixel `{x,y,width,height}` rectangle, or function returning that rectangle. `viewport` accepts a CSS-pixel rectangle or `{width,height}`; `safeInsets` accepts an object or getter. All coordinates share the viewport's coordinate space, without device-pixel multiplication. The default layer mounts on `document.body`; an optional root must be an untransformed viewport overlay. Call `viewportChanged()` when viewport dimensions or safe insets change so intrinsic content is measured again. The app's existing wake/frame path drives arrival, anchor motion, reflow and closing; do not create another animation loop.

Content is a real movable HTMLElement, never cloned. Pass usable, unhidden content; the host does not change a caller's hidden/permission state. If it already has a parent, a placeholder restores the same node to its original position on close. Detached content remains caller-owned after closing. Inputs, drafts, caret ranges, scroll state and component identity are retained. Width and height are real layout dimensions with wrapping and scrolling, rather than scaling the UI to fit. Minimums yield to a smaller usable viewport, while maxSize limits ordinary panel size.

Opening an existing ID with the same content and modality retargets the same dialog and reverses an interrupted close. A changed content node or modality replaces only that UI representation. Escape may be consumed by an inner widget before it reaches the host. Otherwise it closes the topmost surface. Outside-pointer dismissal defaults to nonmodal panels only and does not steal focus from the user's newly chosen target. `initialFocus` accepts a content descendant, a descendant selector, or false; false retains invoking focus for a nonmodal panel while native modal focus remains contained. The normal default focuses the first available content control. Disabled fieldsets, negative tabindex, hidden and inert controls are excluded from modal tab cycling.

`onClose(reason)` is optional per request. Reasons are `escape`, `outside-pointer`, `close-button`, `programmatic`, `anchor-removed`, `native-close` and `disposed`. `restoreFocus(target)` and `onFrame(id,rect,constrained)` are optional trusted UI callbacks; onFrame is a geometry notification, not a scheduler subscription. Parent adapters own trigger aria-expanded/aria-controls state, title/content semantics, authorization, canonical operations and error reporting. An absent anchor closes its representation. Dispose removes listeners, observers and this host's motion bodies while retaining unrelated motion and caller content.

Initial component release validation (4634a36): TypeScript passes; six pure placement tests include 3,600 combinations of tiny/fractional viewports, offscreen anchors, insets, panel sizes and directions. Fourteen [source-hash-bound Electron DOM/component checks](evidence-material-continuity/contextual-surfaces-component.json) cover actual CSS reflow, draft/caret identity, focus return, Escape and inner consumption, outside dismissal, modal Tab cycling, narrow viewport, interrupted close, anchor removal, invalid limits, disposal and ResizeObserver settling. Run `node --experimental-strip-types --test tests/contextual-surfaces.test.mjs` and `electron native/contextual-surfaces-verify.cjs` from the prototype. The latter bundles only a synthetic component fixture into ignored runtime output and uses a hidden sandboxed Electron window with network access blocked. It does not instantiate the application backend or production environment. No native foreground, visual screenshot, shared-host functional or performance qualification is claimed; those checks follow real App integration.

Storage admission passed before bounded local work with both drives above their separate 30 GiB reserves. This monitoring rule is not an OS quota and cannot constrain unrelated applications, cloud work or processes that have not loaded it.

## Guarded close lifecycle

Optional request `beforeClose(reason): boolean | Promise<boolean>` lets a reusable panel finish durable saving before dismissal. Ordinary outside-pointer, Escape, close-button and programmatic `close()` calls invoke this guard before making the dialog inert or targeting its closing motion. Only `true` permits closing. False, a synchronous throw or a rejected promise leaves the same live DOM, current focus and editable state; the callback owns the visible persistence error. No rejection escapes from the guard. This is a persistence lifecycle hook, not a user approval flow.

```ts
surfaces.open({
  id: "conversation-manager",
  anchor: conversationsButton,
  content: conversationContent,
  label: "Conversations",
  beforeClose: async () => {
    try {
      await conversationManager.flush();
      return true;
    } catch (error) {
      showPersistenceError(error);
      return false;
    }
  },
});
```

`close()` still returns void. Ungated surfaces keep their synchronous behavior, and a synchronous boolean guard is also decided synchronously. Promise guards do not add a scheduler or timer. Repeated dismissal attempts while one decision is pending reuse that decision instead of invoking persistence again. Inputs remain usable while saving, so the callback must return true only once the current edits are durable, including any edits made during the await. The host does not pretend to save drafts or choose an application's persistence policy.

Calling `open()` for the same ID/content/modality reuses the dialog and invalidates any pending close decision. A stale success or rejection cannot dismiss that reopened surface or clear a newer pending decision. A different content node or modality remains an explicit synchronous forced replacement: its caller MUST flush before swapping. Replacement bypasses beforeClose, restores the old content and invokes its onClose once with `programmatic`, then installs the new representation. An old native-dialog close event cannot remove the replacement.

Anchor removal, native dialog closure and dispose are forced immediate UI cleanup. They invalidate pending decisions, release this host's listeners/observers/motion bodies and restore caller content without waiting for persistence. Forced cleanup does not cancel the underlying promise or guarantee storage durability. The parent native shutdown/subject-removal lifecycle must await its actual persistence separately. `onClose` remains a cleanup notification after the UI lifetime has ended; saving that must veto closing belongs in beforeClose. A native dialog whose close event is delayed is also recognized through its open state during the shared frame, close-decision and reopen paths.

Follow-up validation: strict TypeScript and formatting pass. The new [source-hash-bound component receipt](evidence-material-continuity/contextual-surfaces-close-guard.json) passes all **27 checks**, including the initial fourteen and thirteen lifecycle checks for synchronous allow/veto/throw, asynchronous success/veto/rejection, deduplicated dismissal paths, edits/focus/caret retention, stale reopen/replacement/native-close races, and forced teardown. The isolated hidden DOM verifier now disables hardware acceleration and records its environment; it requires no foreground window or production renderer. Earlier failed native-close timing checks remain in ignored runtime output and were not relabeled. The initial fourteen-check receipt remains preserved above. Live conversation-manager wiring and native save/reopen acceptance remain Integration-owned.
