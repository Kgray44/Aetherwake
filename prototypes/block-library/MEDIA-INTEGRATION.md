# Canonical media viewer handoff

This is a source implementation. Native importing, protocol enforcement, playback codecs, Electron policy, visual acceptance and user-file journeys remain Application Integration responsibilities. A registered type does not advertise an available native capability.

The released canonical types are `file` and `link`. PDF, DOCX, video, image and UTF-8 text are detected presentations of a file; YouTube is a presentation of a canonical link. The original source is never rewritten. Source bytes, native locators and playback authorization remain separate from placements.

## Root integration

- Install the exact feature-local lock with `npm ci --ignore-scripts --no-audit --no-fund` in `prototypes/block-library`, after the host reserve check. Pinned packages are PDF.js6.5.438, Mammoth1.13.0 and fflate0.8.3. No install scripts were run.
- Use `MediaImportPort.chooseMediaForAdd` for the native file picker and explicit link submission. File requests contain no renderer path or URL. Link requests carry the entered HTTP(S) URL; the native host validates and saves it without fetching it. Both requests carry fresh world bounds when supplied by the workspace. File picker cancellation has no effects. Creating a `file`/`link` through generic Add, a generic host resource factory or a new-resource template fails `media_import_required` before canonical creation. Templates may reference an existing authorized canonical media ID.
- Supply `library.mediaImport` and the library mount option `onMediaCreated(result)` to reveal an actual committed placement. The UI forwards the current workspace/layout fence. It never invents a source or placement. `kinds.file/link` remain unavailable until the real host capability exists. Existing-resource attachment continues through the established authorized attachment service.
- Call `mediaDefaultGeometry(metadata)` once during the canonical initial placement, using detected source metadata. It returns distinct preferred and minimum sizes. Preserve explicit user geometry and restored placements; the viewer never resizes canonical geometry after mounting.
- Call `mountMediaExperience(contentRoot, canonicalResource, mediaReadPort)` for workspace and direct focus. The direct resource adapter also accepts `ports.media` and uses this same component. The shared `identity-view.css` imports the media styles.
- `describe` exposes safe metadata/current capabilities. Every byte read and lease request carries the canonical resource ID, expected version and source revision. Preserve actual `Uint8Array` structured cloning across native IPC; JSON numeric maps are rejected. File locators/tokens/paths must remain in Root's existing private canonical storage.
- Local video consumes only an approved `aerynth-media:` lease. The port must enforce actual source revision, current authorization, range/size limits and expiry on every native read. The viewer mounts native controls only after an explicit Open player action, does not autoplay, pauses/releases on suspension, and releases late leases after disposal.
- YouTube remains an external canonical Open action while `embed:false`. Only Root can enable embedding after verifying actual registered client identity and required native headers. No application identity/domain/Referer is fabricated here. No YouTube frame/network request is created on mount. An enabled frame requires an exact approved `youtube-nocookie.com` lease with autoplay0.
- PDF and DOCX workers bundle locally. The application must allow local module workers and the PDF.js blob wrapper under `worker-src 'self' blob:` on file origins. The wrapper imports the bundled PDF worker, so verify the actual native origin permits this module load. In-memory image previews use `img-src blob:`; native video uses `media-src aerynth-media:`. Keep general renderer HTTP access disabled. Add a narrowly scoped YouTube `frame-src` only when the real native embedding capability is approved. Verify these policies in the packaged app.

## Implemented reading behavior

PDF uses actual PDF.js page count, canvas painting, selectable text, page navigation, zoom and text lookup. DOCX uses actual Mammoth conversion in a terminable worker after actual streamed ZIP expansion accounting. Its HTML is parsed as inert XML and rebuilt with semantic allowlisted elements; active markup, source events, external images and active hyperlinks are not adopted. DOCX reading is semantic rather than a claim of Word pagination fidelity. Supported embedded raster images are bounded; omissions are disclosed.

Images are byte/dimension checked; UTF-8 text is read as selectable original text. Binary files retain accurate type/size facts and real native external opening. Unsupported/encrypted/damaged files display a useful failure instead of a text editor. Source errors never mutate canonical content. PDF parsing/rendering/text, DOCX conversion, reads, images and canvas dimensions have explicit limits in source; these are processing budgets, not an OS memory quota.

## Evidence and remaining acceptance

The focused tests use tiny authored synthetic PDF/DOCX fixtures, actual PDF.js text and CPU canvas paint, actual Mammoth conversion, adversarial ZIP/signature/lease cases, actual component DOM behavior, import cancellation and direct/shared viewer identity. Source tests do not establish native file selection, real video codec playback, YouTube client compliance, browser text-layer selection, physical input, visual/artistic quality or GPU performance.

The existing workspace preparation fixture explicitly remains ten non-media families. It cannot manufacture media resources to expand that historical proof. New native media journeys and the broader original mixed 0/1/3/10/25/50 matrix remain open.
