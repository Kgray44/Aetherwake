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

Validation: TypeScript passes; six pure placement tests include 3,600 combinations of tiny/fractional viewports, offscreen anchors, insets, panel sizes and directions. Fourteen [source-hash-bound Electron DOM/component checks](evidence-material-continuity/contextual-surfaces-component.json) cover actual CSS reflow, draft/caret identity, focus return, Escape and inner consumption, outside dismissal, modal Tab cycling, narrow viewport, interrupted close, anchor removal, invalid limits, disposal and ResizeObserver settling. Run `node --experimental-strip-types --test tests/contextual-surfaces.test.mjs` and `electron native/contextual-surfaces-verify.cjs` from the prototype. The latter bundles only a synthetic component fixture into ignored runtime output and uses a hidden sandboxed Electron window with network access blocked. It does not instantiate the application backend or production environment. No native foreground, visual screenshot, shared-host functional or performance qualification is claimed; those checks follow real App integration.

Storage admission passed before bounded local work with both drives above their separate 30 GiB reserves. This monitoring rule is not an OS quota and cannot constrain unrelated applications, cloud work or processes that have not loaded it.
