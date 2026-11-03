# Aerynth integration status

Snapshot 2026-11-03 UTC. Integration remains active and full product acceptance is incomplete.

## November 3 media retention and Portable BA

The workspace retains its three most recently used inactive media readers.
Older inactive readers release their canvases, decoder state, and any
playback lease. Reactivating an evicted card remounts its reader at the
initial page. Canonical resources and placement geometry are independent
of this cache. Active readers and retained recent pages remain available.

The hidden 50-block run visited eight identical synthetic PDFs at eight
separate positions. Portable AZ retained eight canvases and ended the
sequence at 333,308 KiB renderer working set. Portable BA retained four
canvases, including the active one, and ended at 280,644 KiB. The BA run
revisited a recent PDF on page 2, remounted the evicted first reader,
and made a Universe round trip without changing canonical resource or
placement records. These are short offscreen process-memory samples.
Baseline and BA media receipts are in `review-block-scale-50-1793700677596`
and `review-block-scale-50-1793700875601`, with SHA-256 values
`5aec3ca490fddb700beb6967ea09d8897868422d1b4fd80d92b66ec14864e750` and
`fea0bea2a0a3edc48e9249aecd4142bb3740869417c3c2f460badc465ceb9f2a`.

Portable BA packages `d97215dba33150ea09e62c12108cf54448a9dff7`.
All 427 payload hashes matched. Manifest SHA-256 is
`a1fab6493932b072f46c2415626614011d2774638f874425a8fad8776c5f8653`.
The packaged app also passed separate 10-, 25-, and 50-block runs and
restarts, including Fit, Universe, return through an empty workspace,
resize, reduced motion, WebGL recovery, and exact canonical restoration.
The corresponding initial Fit paint P95 values were 27.0, 74.6, and 90.4 ms.
Settled working paint P95 after the same runs was 18.9, 19.4, and 20.0 ms.
The 50-block resize command took 362 ms in this run. Receipts are in
`review-block-scale-10-1793700891510`, `review-block-scale-25-1793700903933`,
and `review-block-scale-50-1793700915914`. Offscreen paints are distinct
from monitor presentation. Dense Fit pacing and physical performance
remain open. Strict build and 405 desktop tests passed.

## November 3 standalone media and Portable AZ

Resources now imports files and saves web links from its Create menu.
The existing native media service creates the canonical identity, and the
resource opener displays it directly in the current view. Explicit
attachment uses the original resource ID and the source format's default
size. Link entry uses the shared contextual surface and Motion Coordinator.

Portable AZ packages `560de70f4f936039e225544719a8389e7a058c05`.
All 427 payload hashes matched. Manifest SHA-256 is
`9c750af47b99213de3d30daf9116d75d127d167c4ffdb8faa73fb8b1b2d008ee`.
Two hidden Electron processes used the packaged application and bundled
backend. The test canceled the picker, imported and read a PDF in Universe,
refused a file URL, and saved an HTTPS link. The successful imports created
zero placements and did not launch a browser. The same PDF was then attached
to two workspaces under distinct placement IDs. A fresh process restored
both exact placements, the same two resource IDs, and the readable PDF.
The picker results and input were synthetic. No provider calls occurred.

Private profile `review-block-scale-0-1793700543537` contains the native
capture and initial/restart receipts. Receipt SHA-256 values are
`bb7f30eb861824699d99e28689421f6a52634542c6ae02324e473cccd9b931cc` and
`69d20a3d0acddfdbb42eced256a416abcb6a66f3b2a53fb88974b69c3525c2cb`.
Strict build and 405 desktop tests passed.

## November 3 local video playback and Portable AY

Portable AY packages `31dd12deeb4b493bcdf6ddb4a81f6c1c216abcf3`.
All 427 payload hashes matched. Manifest SHA-256 is
`4003e51af8877698dc81f8023c0967e930e23959256eef9d35b388e59c6b4e60`.
The existing video block opens a local player after a user gesture.
Electron serves an opaque window-scoped URL in ranges of up to 256 KiB
per backend read. Each read revalidates the canonical resource version,
access, and selected file revision. Closing the viewer releases the URL
and cancels its streams. Local video has no autoplay. YouTube still opens
externally.

The packaged desktop imported an eight-second synthetic VP9 WebM through
a test picker, decoded and played it, and sought to 6.5 seconds. A fresh
process restored the exact placement, reopened the video from Resources,
and repeated playback and seeking. The initial run requested a nonzero
byte range. The restart run verified that closing the reader invalidated
the URL. No provider requests or external player launches occurred.
Private profile `review-block-scale-0-1793700056331` holds the capture and
initial/restart receipts with SHA-256 values
`cd203988623595d0f18e2ccd16e2ecdfd7c844e534d1ca528bd87b8cb8edd691` and
`1432bae79c713cc1d034eaa8bef1930b402f598ff28647205047341ddc93aaa6`.

The same package passed PDF/DOCX import, YouTube external routing, and
PDF reopen/second-page rendering after restart in private profile
`review-block-scale-0-1793700067558`. Strict builds, 405 desktop, 254
backend, and 15 packaging tests passed. Other video codecs and physical
display or audio quality remain unqualified.

## November 3 native media import and Portable AX

The desktop now uses the Universal Block System media readers from
`bb69509` through the canonical resource kernel. The Library imports files
through the native picker and accepts web URLs. The backend stores the
selected locator privately, returns bounded revision-checked reads, and
retains the same resource when its placement is removed. Resources can
reopen a saved file in a direct reading surface. Local videos and YouTube
links open in the system player or browser. Inline playback is still pending.

Portable AX packages `03ea1d374be9f2b5acf69b1e4d42a56eaee13648`.
All 426 payload hashes matched, including both document workers and the
media license notices. Manifest SHA-256 is
`b6de378f8131887b8ce85001de9127c9af0ad7e568041b23890b6c5386bc2b8b`.
Two hidden Electron processes exercised the packaged renderer, host,
and bundled Node runtime. Synthetic picker results imported a real PDF
and DOCX. The test checked inline rendering, blocked imports without a
user gesture, and intercepted the explicit YouTube shell action. Restart
restored exact resource and placement identities. The Resources button
reopened the PDF and its second page rendered with a selectable text layer.
Visual review caught a shadow on that layer and the AX capture confirms
the correction. No provider requests were sent.

Private profile `review-block-scale-0-1793699580441` holds the capture and
initial/restart receipts. Receipt SHA-256 values are
`53745b4f760a7b778b69b8e194538713021fedf84252382945021512d8c5731e` and
`4ae8f8c203188cc237954f2b3a2bf40603dfe1bb8e2822798c88f2ca67433966`.
Strict build and 403 desktop, 259 Block Library, 254 backend, and 15
packager tests passed. Foreground picker interaction, external playback,
and physical display performance remain outside this verification.

## November 3 model-selected Vela navigation

An authorized single navigation action now runs through the same host policy
as a local read. The model selects the typed action, the backend records the
result, and the desktop uses its existing Motion Coordinator to change views.
Layout changes still show the proposed effect for review. The workspace
organization tests continue to exercise the original user request, saved
geometry, restart and undo.

The hidden Electron source build accepted a natural-language request, ran the
actual broker and backend against a scripted App Server, switched the renderer
to Universe and recorded one native receipt. The isolated review callback was
simulated and no live model or account was contacted. Receipt SHA-256 is
`e216973f06a07f6f1b7f6f58658c0cb3966b0f945950bcf07669bef9efad1f33`.
Backend, Vela and desktop passed 254, 147 and 403 tests with strict typing.

## November 3 Fluid insertion and Portable AV

The integrated Universal Block System release `adcb1d7` (source
`cb9e8830`) preserves existing Fluid placements when a new block needs
pannable overflow. The reproduced AT journey had moved the Chat from
(32,-65) to (32,304) while adding the Task. The engine release leaves the
Chat, Note, Vela, and camera unchanged in the insertion transaction.

The first combined check then exposed a separate presenter issue.
Centering the new Task panned the previously visible Note outside the
window. `be689bb` uses the existing Frame all camera command when a
Library addition needs overflow and all existing cards still fit in the
current safe bounds. It keeps existing world geometry. A Library addition
that already fits leaves the current camera alone.

Portable AV packages `be689bbbd13e38b146bcc8e99e2a7ebe932b3e03`.
Its 384 files passed hash verification. The manifest SHA-256 is
`37bbfabdedf75e28a1b3d84bfad489e0325db4a952da05bf9243a4ac188365d9`.
The controlled hidden desktop reproduction kept both original placements
and their versions exact, shifted the camera at zoom 1, and showed all
three cards. The Chat composer rendered fully within y=705–791 in the
1602×1002 viewport. Constellation travel and a separate fresh process
restored the exact layout, camera, resources and notes. The SQLite
integrity check passed with zero provider executions. The six captures
and receipts are in `review-package-journey-1793698011849`.
Engine, backend and desktop suites passed 90, 252 and 403 tests.

A separate hidden AT check confirmed that the explicit Frame all command
reveals a previously clipped Chat without changing the canonical blocks,
resources or Vela placement. The original affected profile and the open
owner window were preserved. Live Codex and monitor presentation remain
pending.

## November 3 Portable AT workspace and Constellation journey

The Resources panel now passes the current canvas bounds to the existing
placement solver. The panned-workspace regression in Portable AS found the
reattached note absent from the viewport. The same action in Portable AT
put the new placement fully in view at x=20–460 and y=492–852 in the
1602×1002 capture. The canonical note and content retained their identity.
The strict build and 403 desktop tests passed.

Portable AT packages `b5a0c0850ed1350b3bbd4a2e7dc9d09a40605607` and
includes the earlier native Codex recovery. All 384 files matched its
manifest, SHA-256
`09b4c0f6b4acf0f1dd1450b2975eace5056a61f2052e7a88d63a2374f29b6e25`.
Three hidden Electron processes ran the packaged UI with real controls and
SQLite. They created the requested project, workspace and blocks, changed
layout, detached and reattached the note, switched workspaces, entered
Constellation and Universe, moved and edited the Engineering note, returned
to Development, and verified both workspaces after restart. SQLite
integrity passed and the test profile recorded zero provider executions.

Private profile `review-package-motion-1793697426428` holds five PNGs
and a 10.851-second recording made from 175 offscreen Electron paints.
Every frame decoded and the recording SHA-256 is
`39391eb0cc2ffca8525b5041ed4ec7428ecf22a242b78a2bab9b8ceecf525436`.
Visual inspection showed the shared orbital backdrop, Vela moving to the
upper-right, and the glass workspace returning. The attached note remained
visible. The restored Freeform camera still cropped the tall chat at the
bottom. These results demonstrate application interactions and offscreen
motion. Physical presentation and live Codex acceptance remain pending.

## November 3 recovery for a lost Codex turn

A direct Codex conversation with an unknown outcome can explicitly
check the exact saved provider turn. It can recover a terminal outcome
and finalized reply without a second turn start. A missing or different
turn, a partial item page, an inaccessible source, or an unsupported
history method leaves the original state unknown. The action retains
the draft for inspection. It currently applies to direct turns recorded
with a canonical user message and an accepted native turn ID, without
attached excerpts or a branch handoff. Older unbound outcomes remain
unresolved.

The SQLite regression exercised a lost transport, restart, rejection
of foreign and truncated history, concurrent recovery, and a second
restart with one user message and one attributed reply. The 252 backend,
403 desktop and 14 bridge tests passed, along with strict backend
typing, the desktop build and the targeted composer recovery test.
A hidden Electron run used the real workspace conversation block and
scripted stdio history. The check required renderer user activation,
recovered the canonical reply, retained the exact draft and reported
zero new provider requests. Receipt SHA-256 is
`851951c15583df76fb34f4c8dd86274b95aa2bf33a9d6dcbcc31d74e641fc643`.
This is synthetic provider evidence. The Portable AR live profile still
had no executions and its normal live Send remains pending.

## November 3 model replies and native Vela actions

Free-text Vela requests already go through the configured AI planner.
The planner receives the scoped capability catalog and selects typed
actions. The canonical host validates each action and applies reviewed
workspace changes through the existing layout and motion path.

Aerynth had been building saved native replies exclusively from deltas.
A completed proposal could be lost if it arrived only as a completed
item, and streamed commentary or another turn could corrupt its JSON.
The backend now binds output to the accepted thread and turn, prefers
finalized messages, and keeps commentary and other-turn output out of the
saved proposal. Live previews still use the original event identity and
durable stream rows remain metadata-only.

Both workspace regressions reproduced the failure before the fix. The
standard catalog case now reads the final from the terminal. The dynamic
catalog case reads it from a completed item and deduplicates repeated
completion. Both verify review, canonical placement changes, restart,
and Undo. Backend typecheck, 251 backend tests, 14 bridge tests, and the
strict desktop build passed. A hidden Electron run exercised the composer,
native broker, and approval control using the scripted stdio model in a
disposable profile. The private receipt SHA-256 is
`fffc0a77868c4fa887234997cf7024c64751a6799c33a1b8cfe0aff8cbd609da`.
The user's open candidate was left in place. Live interpretation of the
workspace request on this revision remains unverified.

## November 3 Portable AR and direct Codex readiness

Portable AR packages `e35ebdf45e14686ea58e5a6e55aa332940eba8dc`.
All 384 payload files matched the manifest and the two changed backend
sources matched Git. The manifest SHA-256 is
`373eb837a21b5327f1ce9161cad5170155261a3cb77beac67d453c6bb63ad995`.
The bundled Node and canonical host passed 22 initial calls and five
restart calls with no provider execution. A hidden Electron run loaded
the exact bundled app modules, renderer assets, and Node backend.
With an external test harness and a scripted stdio planner, a real
Vela Send and review click changed canonical workspace geometry.
The private receipt SHA-256 is
`9a5ef319fb0aa897ab3de502ea4bdca43730e89d68f19a41bdcb90abcb1cd58c`.

A separate disposable AR profile observed an already signed-in native
Codex capability and restored a synthetic draft, workspace, and
conversation after backend restart. Its execution count was zero.
The launcher in `review-live-codex-1793696549238` is ready for an
explicit native Send review. Both checks used disposable profiles.
The user window remained open and live direct Codex acceptance is
pending. SQLite integrity checks passed for the three closed profiles.

## November 3 shared glass geometry during Fit

`6bb8f93` shares a WebGL glass slab within a draw when card dimensions,
shape, kind, and unfold are identical. Cards retain their own material
and transform. The renderer owns and disposes each backing buffer even
when a mesh used a peer's buffer in the last frame. A geometry regression
verified equal vertex positions, independent materials, and correct
buffers after resizing or removing the former owner.

In both hidden 50-card runs, the scene submitted all 50 cards using
three distinct slab geometries. At working scale, 12 visible cards used
four after resizing the note. Fit paint P95 was 76.5 and 82.7 ms against
77.9 and 79.2 ms for two same-seed controls. The 900-ms samples overlap,
so the demonstrated change is less duplicate geometry work. The
separate CSS layout containment experiment was discarded after it
failed to improve pacing consistently.

The strict build and 403 desktop tests passed. Eight hidden runs and
restarts at 10, 25, and 50 blocks passed workspace navigation, resize,
graphics recovery, and exact restoration. The 50-card fitted still
was inspected with all cards and Vela visible. Receipts are in
`fit-slabs-1793695807511` and the controls in
`fit-isolation-1793695657829`. Physical presentation remains unqualified.

Portable AQ packages `6bb8f93a15e98c2a1b0a3e19504c8771026a3879`.
An independent audit checked all 383 file hashes, bound the renderer
assets to all eight hidden receipts, and verified SQLite integrity and
zero executions across their profiles. The bundled backend passed 22
initial and five restart calls. Manifest SHA-256 is
`a7e26d0097d55084e17170ca24ee549f4622ef69922600122d35d49f550fc686`.
Normal foreground launch and live provider execution were outside these checks.

## November 3 chat composer measurement during Fit

A Chromium trace on the 50-block workspace attributed 31
`getBoundingClientRect` CPU samples, totaling 47 ms, to queued chat
composer measurement during Fit. `a7c6f87` retains the latest observer
dimensions during passive card motion and reconciles once the existing
Motion Coordinator settles. The focused chat and direct resize paths
keep live measurement. The regression also exercises a resize callback
already queued when motion begins and preserves the editor selection.

The follow-up trace recorded zero samples from that chat measurement
call path. Two hidden Electron runs using the same SQLite seed as the
baseline passed Fit, Universe travel, return, resize, WebGL recovery,
and exact restart checks. The candidate's 900-ms Fit paint P95 was
87.4 and 99.4 ms, compared with 83.3 and 108.5 ms for the two controls.
The ranges overlap. This fixes a repeated source of synchronous work
and leaves overall Fit pacing and physical presentation unqualified.

Separate experiments with CSS layer hints and flat transforms were
discarded after uneven Fit paint timing. Sharing contour samples between
cards was also discarded after a CPU comparison regressed mixed-size
workspaces. Private diagnostics, including the oversized trace that
exceeded its capture cap, remain in `scale-layer-trial-1793694969788`.
The strict build, 158 conversation tests, and 402 desktop tests passed.

Portable AP packages `a7c6f8717ed35604786546eacdd2db84fcf29259`.
All 383 file hashes were independently checked and packaged renderer
assets matched the hidden initial and restart receipts. The bundled
backend passed 22 initial and five restart calls. Manifest SHA-256 is
`a7bcd79b3389314ab098e2d3a5572c569efd8bd36912dcd483678d61844c1ca3`.
The package's normal foreground launch and live Codex send remain
separate checks.

## November 3 desktop scale and process memory

`ce0b87a` adds per-process working set and private memory, optional
Chromium JavaScript heap readings, and monotonic command timing to the
existing hidden desktop benchmark. Separate runs and restarts at 10, 25,
and 50 blocks passed. The real desktop returned from Universe through
an empty workspace, resized a note, restored WebGL, and preserved exact
canonical content, placement, camera, and Vela state after restart.

| Blocks | Hydration / fresh restart | Fit / resize command | Fit / settled fit paint P95 | Settled return / fresh restart renderer working set |
| ---: | ---: | ---: | ---: | ---: |
| 10 | 2.19 / 1.41 s | 67 / 86 ms | 32.9 / 18.3 ms | 264 / 173 MiB |
| 25 | 2.08 / 1.44 s | 108 / 113 ms | 70.4 / 18.5 ms | 327 / 182 MiB |
| 50 | 2.05 / 1.56 s | 164 / 201 ms | 92.5 / 19.2 ms | 487 / 188 MiB |

Fit commands include renderer-to-host round trips. Paint observations are
from offscreen Electron windows in roughly 650-ms samples. The initial
50-block fit observed 15 paints and the settled fit 39. These intervals
are separate from physical presentation. Electron process working sets
are system memory, and the GPU process reading does not establish VRAM
use. The 50-block fitted capture keeps all 50 cards and Vela in view.
At working scale the deliberately restored camera crops Vela against
the top chrome. The synthetic placement command omitted presenter
bounds and collision resolution saved Vela at y = -32.

A separate `5c098c0` run revisited the same 50-block workspace three more
times without intervening captures. Renderer working set after the first
return and the three subsequent returns was 400, 400, 407, and 394 MiB.
This bounded series did not show monotonic memory growth. The inactive
renderer drew zero frames during the 650-ms probe and resumed on
activation. Sustained retention and monitor presentation remain open.
Private receipts are in the three `review-block-scale-*-1793694635158`
profiles and `review-block-scale-50-1793694793899`. A separate read-only
audit checked all seven receipts, current renderer asset hashes, SQLite
integrity, and zero provider executions across the four profiles.

## November 3 native Codex send review and portable AO

`0062735` removes the unused desktop `send` IPC operation and the legacy
verification flag that could authorize a hardcoded prompt. The current
conversation composer uses the existing native review and its scoped
backend grant. All 402 desktop and 15 package checks passed.

Portable AO packages `0062735d3cdf6c9cab5ea4cf6aad718986c4175d` in 383
files. Its manifest SHA-256 is
`ca91ee5df11c80db7c809316999c40c9267352bf0cea6aabe6d0011767aa46bd`.
Its bundled backend discovered the installed Codex session and prepared
a disposable workspace with one Codex conversation and an unsent
`AERYNTH_LIVE_OK` test request. A fresh process restored the exact
resource and placement identities and draft with zero executions.

An offscreen test loaded the packaged application modules and bundled
backend with the locked source Electron executable and a separate copy
of that SQLite profile. The actual composer restored the draft, denied
the retired operation, reached the real native review with the exact
prompt and retained the draft when that review denied a hidden owner.
No provider turn started. Receipt SHA-256 is
`4edfa598433d4bf9159dbe6751f607f4989dc5aba26c6a9c4700cfc84e8594e9`.
An initial attempt to run the offscreen operator through the portable
executable reached no test receipt. The normal portable launcher
remains available in the prepared private profile for the owner to
inspect and explicitly send the synthetic prompt. Step 21 requires the
resulting live turn.

## November 3 Vela model routing on Windows and portable AN

The normal Windows user and machine PATH exposed an npm `codex.cmd` shim
without a directly spawnable `codex.exe`. Bare Node spawn reproduced
`ENOENT`; the desktop then fell through to recording a request that the AI
never received. `bf3a092` resolves the installed CLI from absolute PATH
entries and starts the official npm Node entry point when needed, using
stdio without a shell. Default Vela Send now reports an unavailable,
busy, or signed-out planner and preserves the draft without recording a
request. Free text stays model-interpreted. The existing host policy,
review, typed capability dispatch and Motion Coordinator path remain in use.

Two hidden Electron processes using disposable workspaces exercised the
default broker path. One verified the unavailable planner retained the
exact composer draft, with no request or layout change. The other used a
scripted stdio provider on a shim-only PATH: its typed layout proposal
targeted the active workspace and canonical geometry changed only after the
review control was invoked. The respective private receipt SHA-256 values
are `5a527db1115c6e4254a3a3da4b71429f0c684f5616f0a19aed9e8b71dc32400a`
and `abbcec951e4a8f550ef9fc23cf646ca51f4895cc64ec04693924650669947b71`.
The standard and experimental catalog paths passed the real backend layout,
restart and undo regression with scripted provider output. Strict typing and
build passed, with 251 backend, 147 Vela and 402 desktop tests.

Portable AN packages `bf3a092cf67d8db7faef1091e383bffb8dd6a99a` with
383 files and manifest SHA-256
`aaa742af4f5ba39c8b89a1446ab51b7cae6075cad5a2d5b681f8f9374f4a64dd`.
Its bundled backend passed 22 operations and five restart checks. With
the standard Windows PATH it initialized real App Server, observed an
already signed-in account and obtained four catalog entries without
dispatching a turn. This does not establish model entitlement or live
interpretation of a Vela request. Portable AN's foreground review and
live provider turn remain unverified.

## November 3 confirmed Codex refusals and portable AM

Explicit App Server rejections now settle as failed, allowing a new
explicitly authorized request. A dropped connection or missing
receipt remains unknown and fences duplicate dispatch. Hidden Electron
checks with scripted stdio verified the failed send preserved the draft,
and an approved revised send after restart reused the same thread with one
turn start. The 249 backend tests passed. Portable AM packages `8cf0cc1`;
its 382-file independent inventory audit passed with manifest SHA-256
`224eb8037d5a61bd6fa396e2b0eb9b79b10bd471f2cae340e37f455a8c287472`.

## November 3 workspace navigation and resource opening

A workspace switch previously cancelled newer resource opens when the
queued command reached the backend. Back had the inverse failure and
could leave an earlier pending resource free to open over the destination.
The desktop and Constellation now invalidate older opens at navigation
intent. A superseded lookup also drops its late error.

The hidden Electron regression reproduced both failures and passed all
three corrected sequences. Opening a note after a queued switch or
Constellation departure reached the canonical note, and Back cancelled
a held older note lookup. The race receipt SHA-256 is
`a52e066ea90d6a3c1d3fa2d64f55d765ef586ab0c869117c197f6034bc72e9a7`.

The full application journey passed again in three hidden Electron
processes. They created the required project and workspace, created and
edited blocks, detached and reattached the exact note, switched workspaces,
travelled to another project through Constellation, edited its workspace,
returned, and restored exact geometry, identities and content after
restart. The build, travel and restore receipt SHA-256 values are
`087f99e8e408e4ddd5852b366d0e5c6d3ee6ea1f27045ecd8dab4c771be172cb`,
`8f62ab09c7f55d6c2e3cae91765df708d57bb490a2c511406f5854054127ecf6` and
`a7505558d89f3c707e2027b3e803bf6b4453fe79a91dbc1cb0a1cc507722c839`.
The strict desktop build, 401 desktop tests, 160 Constellation tests
and six backend resource-opening tests passed. The journey had zero
provider executions. The running owner window and portable AH predate
this correction.

## November 3 Codex App Server recovery and portable AL

The previous backend kept a stale connected flag after App Server died.
A subsequent check returned a transport error until the application
restarted. `7692244` clears the lost transport and cached capability
observation. The next requested check coalesces concurrent callers into
one new handshake against the installed provider. Unknown executions
remain unknown. The regression verified thread inspection, exact
idempotent replay of the existing receipt, and refusal to resend the
unknown turn. The original fixture emitted just one turn start.

A hidden Electron test used the actual conversation composer, broker,
activity reader and Connections surface with an isolated synthetic stdio
App Server. The harness modeled focus for the activity reader and
approved only the exact synthetic payload. App Server exit surfaced an
unknown outcome. The draft and single canonical user message remained
intact. An explicit Connections check recovered the fixture session
without an additional turn. A fresh process restored the same block,
conversation, draft and receipt and surfaced the sign-in-required state
from a separate unauthenticated fixture. The strict backend typecheck,
248 backend tests and 14 Codex bridge tests passed. This evidence does
not exercise a live account or native owner consent.

Portable AL freezes `76922446e110ab4dc96b1c78d26f8de8cecc1542`.
The bundled backend passed 22 initial and five restart commands. An
independent audit verified all 382 payload files, including 250 exact
Git blobs, and matched the tested provider source and renderer assets to
the package. SQLite quick check passed. The synthetic journey and
independent audit are in `review-block-scale-3-1793693450784`.
Manifest SHA-256 is
`7cc7d106bcbe999bb4740b369baebafc812d40546fe930ac561a1c2d78801e51`.
The normal AL launcher and live Codex remain unverified. The owner
review stayed open.

## November 3 portable AK archive and fit verification

The packaged AJ baseline reproduced a navigation defect when the last
open workspace was archived from the project's sky view. The application
opened the sibling workspace even though the project remained valid.
`3ef6f3d` changes the canonical return workspace while retaining the
project or Universe view. Archiving from inside a workspace keeps the
existing fallback navigation behavior. A regression exercises both
Constellation scopes, prunes archived history and rejects stale workspace
navigation.

In a fresh packaged AK profile, actual Environments controls created a
workspace whose node appeared alongside its sibling. Archiving it
removed the node without leaving the project. The node remained absent
after a fresh process restarted in the same view. Restoration made the
same workspace selectable again and returned the exact saved note,
placement geometry, camera and Vela placement. The two hidden receipts
are in `review-package-archive-1793692911984`. The packaged smoke passed
22 initial and five restart commands. Strict builds, 247 backend tests
and 401 desktop tests passed.

Universal Block System's `f6749c9` is integrated as `f3cb79d`. It uses
existing measured footprints to select compact controls. Three AK runs
used fresh copies of the exact 50-card seed used by the earlier AI/AJ
comparison. AK measured 171–189 fit style recalculations and 421–436 ms
of style work, down from AJ's 769–819 and 629–642 ms. All three settled
to zero style recalculations and passed 500 Open and Approach hit samples
each. Fit offscreen paint P95 ranged from 86.46 to 91.64 ms. The earlier
AI interval ranged from 75.68 to 91.68 ms. These are short hidden samples.
Physical presentation and sustained performance remain unqualified.
Private fit receipts and screenshots are in `fit-correction-1793692949096`.

Portable AK freezes `3ef6f3d26a962ed9a687267b841fb404fc041831`.
Independent checks matched all 382 payload files, including 250 exact
Git blobs, to the package manifest and bound the hidden receipts to the
same package. The archive/restore database passed SQLite quick check and
recorded zero provider executions. Manifest SHA-256 is
`84b3781df328dd580518bdb9dbbdc0ecff4cb13e0b229123ab798173214b534d`.
The owner window stayed open. The normal foreground launcher, live
Codex and owner acceptance were outside these checks.

## November 3 packaged motion and fit comparison

The same synthetic 50-card SQLite seed was copied into six fresh profiles.
Portable AI and AJ ran sequentially in order AI, AJ, AJ, AI, AI, AJ.
All six fit the same 50 cards and preserved canonical resources and
placement identities. In 1.2-second fit samples, AI recorded 170–194
Chromium style recalculations and 426–450 ms of style work. AJ recorded
769–819 recalculations and 629–642 ms of style work. Median fit-sample
offscreen paint P95 increased from 78.67 to 100.81 ms. Both builds
settled to zero style recalculations. AJ preserves the compact control
hit-test fix. The repeated transition cost was handed to Universal
Block System for correction. Private source-bound receipts are under
`fit-comparison-1793692458005`. These short hidden samples do not measure
the monitor or qualify sustained performance.

A separate AJ journey recorded 180 actual offscreen Electron paints at
960×600. The 11.8-second WebP uses the captured timing and shows leaving
Development, travelling through project and Universe views, moving and
editing the Engineering note, and returning to the exact Development
layout. Sampled frames show the same orbital architecture throughout,
Vela moving toward the upper-right in Universe, and the glass workspace
returning. The same profile passed the separate restart phase. Decoding
verified every frame and exact recorded playback duration. The recording
used bounded capture, deliberate review holds and no provider turn. It
provides motion evidence, not a presented-frame or owner artistic
qualification.

Private profile `review-package-motion-1793692583209` retains the original
frames, timings, sampled stills, decoded audit and restart receipt. Motion
file SHA-256 is
`d11bbddd504c0b69b62959445b2945b828a7972f1df740a77c62ff371b8019b7`.

## November 3 portable AJ and compact overview

Universal Block System's `9790f0b` is integrated as `5981e7d`. In the
actual hidden 51-card workspace, all 50 compact overview cards kept
separate Open and Approach targets. All 500 center and interior hit
samples reached the intended buttons. The fitted screenshot showed the
controls inside their card contours. The additional Checklist opened
before fitting and retained the shared width observer. Resize,
Constellation travel, reduced motion, graphics recovery and exact restart
passed. The updated build passed 401 desktop tests. One short fit sample
observed 727 Chromium style recalculations versus 123 previously, under
different concurrent load. Physical display timing and a sustained
performance comparison remain open.

Portable AJ freezes `5981e7d4f3e9ee65431757861981997f4786f02d`. All
382 payload files, including 250 exact Git blobs, passed an independent
byte audit. The packaged assets match the dense Electron receipt.
The bundled Node/backend passed 22 initial and five restart commands on
a fresh synthetic profile. The packaged bootstrap, renderer, preload,
host and bundled Node then passed a separate three-process hidden
Electron journey. The harness used a byte-matched Electron executable
and suppressed window show and focus. The journey created the resources
through application controls, edited them across projects via Constellation,
returned to the original workspace and restored exact state after
restart. A read-only SQLite check found zero provider executions.
The normal owner window stayed open. The normal foreground launcher,
owner review, live Codex and monitor presentation were outside these
checks. Portable AI is preserved separately at `de4dc87`.

AJ manifest SHA-256 is
`0b9fa2adff77276838846383c9303cc44038b4db4a67311341e6f70d8b0db494`.
The hidden journey and independent audit are in private profile
`review-package-journey-1793692286041`. The dense control and restart
receipts are in `review-block-scale-50-1793692164791`. The bundled
backend receipt SHA-256 is
`1791572130e715200c01f021615d33ade9f21627532127848fa87de2dac1e0f8`.

## November 3 working-card measurement

The desktop presenter now reuses its shared ResizeObserver measurement
for Timeline, Agent, Checklist and Task Tracker reflow. It stops reading
each working body's width synchronously on every frame. Retained previews
continue to finish their existing Motion Coordinator exit.

A hidden comparison added one canonical Checklist to the standard
50-card fixture and opened it before fitting. Direct Checklist width reads
over each 1.2-second sample fell from 72 to zero while focused and from
65 to zero after the fit settled. The fitted screenshots included all 51
cards and Vela. Navigation, resize, reduced motion, graphics recovery and
exact same-profile restart passed. The strict build and 401 desktop tests
passed, as did the standard 10- and 25-card hidden checks.

Hidden compositor paint P95 while fitting was 24.32 ms for 10 cards,
51.27 ms for 25 and 54.19 ms for 51. Settled fit P95 was 19.30, 18.73
and 21.97 ms, respectively. The instrumented baseline had 67.99 ms P95
during the 51-card fit, while the updated working return was slower.
The comparison establishes removal of repeated reads. Sustained timing
and monitor presentation remain unqualified. The fitted capture showed
clipped approach affordances on small cards. The evidence and corrective
scope were handed to Universal Block System.

Private initial baseline, updated initial and updated restart receipts
have SHA-256 values
`2bce1acaebba58272f408694ab6785c379deca6d07a6613cffa29c9439b2f60d`,
`12af1999420ff5055d313fcf0a00602ae7c5229c78561f353f2ce0d35b361d2c`
and `7183923f98f2b80b8816b8a0eac7b557eda506dae7aba05483900b5c562f1c32`.

## November 3 shared card projection and portable AH

The DOM and WebGL now use the same projected card poses per frame. Glass
slab rebuilds sample the three distinct contours once each rather than
sampling all six rings independently. A comparison of the old and new
renderer methods across 900 geometry cases found identical Float32
vertices and normals. Universal Block System's release `76bfcdc` is
integrated as `4d59497`. Its hidden Chromium comparison measured 600
live style mutations where the previous writer performed 2,400 and
matched declaration values, geometry, hit areas, editor identity, draft
and selection across the exercised cases.

The 50-card fit and SQLite restart passed in hidden Electron. The baseline
and combined build each had a 1.2-second fit sample. Scripting fell from
351 ms to 318 ms, while style work remained around 0.47 seconds and
compositor paint P95 moved from 52.25 ms to 65.62 ms. The settled fit had
19.18 ms paint P95 and zero style recalculations. Restart paint P95 was
18.31 ms. The samples establish fewer repeated operations and exact
restoration. A faster fit and physical display timing remain unverified.

Portable AH packages `4d59497`. All 382 declared payload files matched
their hashes in an independent audit. The packaged renderer assets match
both hidden Electron receipts. The bundled backend passed 22 initial and
five restart commands on its own synthetic SQLite profile, with zero
provider executions. The package manifest SHA-256 is
`51fcbd1b6d28e58775497337b68e6083a3dfba055bc7f52674a4bc7a3ca91568`.
The strict build, 400 desktop tests and 19 packaging and focused block
tests passed. AG remains open on the owner's profile. Live Codex and
packaged visible acceptance remain outstanding.

## November 3 Vela workspace organization

The reviewed model context now identifies the active project and workspace
using IDs already present in its authorized metadata. The tool catalog
distinguishes rearranging cards with an undoable preset from changing the
grid or clearing overlaps. Free text continues through the model adapter.
The host validates the typed proposal and uses the existing layout
command and motion path after the user approves it.

A hidden Electron run used the actual composer and approval controls with
a scripted stdio provider. The exact question reached the protocol, the
layout stayed untouched until approval, and the same blocks moved in the
real SQLite workspace. The private receipt SHA-256 is
`67a7eb8a4c1b6f0a7f934a826107546979ade41105e80b4e35891c9d8529dac2`.
A separate backend regression verified the same command across restart
and Undo, including preserved note content. The strict desktop build,
246 backend tests, 147 Vela tests and 401 desktop tests passed. Live
model interpretation of the request remains unverified.

## November 3 Vela resource search

Vela can run a model-selected search across authorized Aerynth resource
metadata and open matching resources. The action uses the existing
canonical search and resource opener. Receipts retain stable references.
Display resolves those references again against current scope, including
after restart. Resource content and results stay local.

Two synthetic stdio tests exercised the actual Codex planning adapter,
per-turn capability schema discovery and the canonical backend for search
and device time. The search test also confirmed that switching to another
project removes the original result. The model responses were scripted.
Two hidden Electron processes used an explicit typed search through native
IPC and opened the same note from Vela before and after restart. Both
kept the same placement and layout and recorded zero provider executions.
The private receipts have SHA-256 values
`740020b56daba05e6f9b69ff59ae2bc608f5f5d1a30ea8461e790a75170e406d` and
`87c1755b0f5ac6635967fb0b940db2d3cce4145cee5b243e149c22147b77c0d6`.
The strict builds and 147 Vela, 245 backend and 400 desktop tests passed.
Live model interpretation and visible owner review remain outstanding.

## November 3 Vela model routing

Vela's composer sends free text through the configured planning model.
The trusted backend validates and dispatches typed actions from the same
registry used by native tools. A single local fact lookup runs under host
policy after provider review. Layout changes show the proposed action and
workspace before applying. The model supplies the interpretation. Aerynth
owns the action, canonical state and receipt.

A hidden Electron run sent a clock question and a workspace organization
request from the actual composer. Both reached review with the active
workspace ID and the relevant live-fact and layout tools. The harness
declined both reviews and recorded zero provider turns and zero layout
changes. The private receipt has SHA-256
`8c0d685d8002476f0db3614422f4281e041b662cb0bfcf7e7648a77b5f4a7311`.

A separate Core test with synthetic model output ran the actual clock
reader and applied a reviewed layout preset. The layout, block IDs, and
resource IDs survived SQLite restart. Live interpretation and execution
from the user's request are still unverified on this build.

## November 3 fitted workspace rendering

Chromium traced a full workspace style invalidation back to the scene controls
policy label. The renderer reassigned identical text on each frame. On a
settled 50-card fit, a 1.2-second sample observed 73 style recalculations and
0.49 seconds in Chromium style work. At `3cf8cd8`, the same workload observed
zero recalculations across 72 offscreen paints. The label still updates when
the mode changes.

At `93fbb43`, retained chat editors defer layout while their cards are
previews. They reconcile the latest measured bounds when working again.
Explicit same-presentation scroll restoration remains supported. Universal
Block System separately removed repeated card-control attribute writes.
Its release `ec16124` is integrated as `4402865`. A source-owner Chromium
check observed 600 repeated Restore-label writes per 50-card composition
state before the change and zero afterward. The native scale harness now
records the fit transition and settled fit separately.

| Blocks | Fit paint P95 | Settled fit paint P95 | Settled fit style recalculations | Restart paint P95 |
| ---: | ---: | ---: | ---: | ---: |
| 10 | 25.91 ms | 18.29 ms | 73 | 19.26 ms |
| 25 | 49.66 ms | 18.98 ms | 0 | 18.72 ms |
| 50 | 57.78 ms | 18.49 ms | 0 | 18.61 ms |

The 10- and 25-card measurements used the chat layout change. The 50-card
repeat included the card-control change and captured all 50 cards and Vela
centered in the viewport. All three initial and restart pairs passed and
restored exact canonical workspace state. The preceding 50-card fit measured
102.05 ms P95 while the conversation suite was also running. These short
offscreen samples establish the steady-state style fix and show that the
50-card fit transition still has slow frames. Physical display timing and
the actual owner-approved Codex reply are still outstanding.

The strict app build, 400 app tests and 158 conversation tests passed. The
final 50-card initial and restart receipts have SHA-256
`65334bcb21ab5908756b1ebfe37a01c69c515605fbbad2de8d95b4fb8ea2e620` and
`7ed45721f641a436c32b3e3051bbdb9965055bd59c6c19475e8a47960b3e96a8`.
Portable AG remains open on the owner's profile.

## November 3 working desktop and Codex approval

At `dd1a2ea`, three hidden Electron processes exercised objective steps 1–20
through the current application UI, real native host and SQLite. They created
A World for Two and Development, added and manipulated Conversation, Note and
Task blocks, removed and reattached the same Note, switched workspaces, travelled
to another project through Constellation and returned. Restart preserved both
projects' exact resource identities, placements, geometry, camera, Vela
placement and note content. The run also reversed an in-progress Block Library
close on an immediate second Add click. The separate 50-block fit centered the
rendered union of all 50 cards and Vela at approximately (800, 510) in the
1600 × 1000 viewport, and the exact workspace state survived a separate restart.

Portable candidate AG at `8d05f28` is open on the owner's existing profile.
Its manifest SHA-256 is
`c639a59ccfde8182ef5d192d62c7bc0c203685fb3012ae64ae225fd40fcfe414`.
It adds animated Resource categories and a distinct animated pinned state.
The hidden desktop verified category collapse and reopen, exact pinned panel
dimensions after restart, and both the standalone Resources and Intelligence
Stream actions. The live profile reported a renewable ChatGPT session as
ready after restart. The installed Codex App Server reported available
authentication and accepted Vela's typed workspace and weather capabilities
into the exact planning preview. No model turn was needed for that preview.
The weather adapter returned a real National Weather Service forecast for a
public test point. The Windows device location path still needs an owner check.

At `6550483`, Codex conversation sends use the existing native review window
with scrollable, exact outgoing text and fixed decision controls. The native
broker checks the request, resource, provider, version, fingerprint and owner
before dispatch. A hidden Electron trial created the canonical Codex block
through the Block Library using the installed provider's authenticated
availability. The real broker reached review with the exact draft and denied
the send because the parent was hidden. A separate hidden capture verified
that the final line and decision controls fit at 150% zoom. Restart restored
the unsent draft and placement, with zero executions in both processes.
The initial and restart receipt SHA-256 values are
`8be22b1a88b3b810609d021b0eab2de5f799893ea869cb5ce9c063876867ffc7` and
`f4e76c59e3e063d27e93577caa2532c00cdc2cf91c616be3e42d4beb67478246`.
The app suite passed 400 checks and the packaging suite passed 15. Objective
step 21 still needs a current real turn through the owner-approved Codex
conversation. The offscreen captures do not measure physical display presentation.

## November 3 workspace scale checkpoint

At `5b19389`, adjacent housing faces reuse their contour samples while retaining
separate bevel normals. Five local CPU trials of 12 updates across 50
instruments had a median of 155.2 ms, compared with 278.5 ms on the same
benchmark before the change. The sampled final position, normal and instance
buffers shared SHA-256
`6dfadd0fc0ee22ae48ee930a898dac171fd794afff1c64751487729f4ec9ec58`.
This isolates CPU geometry generation.

The renderer now fades the detailed fittings as the projected card shrinks,
using the existing camera and selection motion. The glass slab still uses
the exact contour. At 50 blocks, the fitted desktop submitted all 50 slabs
with zero detailed housings. All 12 visible working cards regained full
housing after return and restart. The 50-block fit sample recorded six
offscreen paint intervals at 314.1 ms P95. The previous same-workload run
recorded four at 377.9 ms. These short samples show that the fit still
stutters and do not establish monitor presentation performance. The actual
fitted screenshot retains the orbital background and all 50 cards but
clusters the cards against the left edge.

The strict build, 397 app tests, and separate hidden Electron initial and
restart checks at 10, 25 and 50 blocks passed. All verification windows
closed. The 50-block initial receipt has SHA-256
`2728e489b47f2e6aaddac738dfd48efcec5692b62c69f9f7ffc04733d504ba2c`.
Portable review AE is staged for `5b19389` with manifest SHA-256
`ca92d82a121c5c66964dd3fa026c2b321f9c2c2ec6bed3d0dfd1da3b336cfe1e`.
The existing owner window continues to run `525a134`.

At `864c64d`, the desktop uses the existing readable-body thresholds to delay
new editors when the current or destination card cannot fit them. Focused
editors retain their working view. Card titles, previews, selection and direct
opening remain available at overview scale. The desktop passed the 397 app
tests and fresh hidden Electron runs and restarts at all three fixture sizes.

| Blocks | Visible cards after fit | Mounted editors after fit | Usable cards after settling on return | Editors after settling on return |
| ---: | ---: | ---: | ---: | ---: |
| 10 | 10 | 9 | 8 | 9 |
| 25 | 25 | 10 | 12 | 19 |
| 50 | 50 | 10 | 12 | 18 |

At 50 blocks the fitted view retained 10 editors instead of 43 in the earlier
run below. The nominal one-second fit sample took 1.04 seconds to collect,
compared with 4.30 seconds earlier. It had only four offscreen paint
intervals, so fit pacing remains uneven. Settled return paint P95 was 25.8 ms
with 55 intervals. The repeat is a shared-host comparison of renderer and
offscreen compositor behavior, with no physical display presentation
measurement. The 50-block initial and restart receipts have SHA-256
`ae99816cc673813ae58b86497b6e66381d9954cb89ba05ced7d5de9b10ee8325` and
`78e21bfa212e74c248560036313542e08410bd755fb9ee067025c4b50eb50565`.

Review candidate `525a134` passed hidden Electron navigation, resize, reduced
motion, WebGL recovery, and fresh-process restoration at 10, 25, and 50 blocks.
The run used synthetic workspaces and the real renderer, desktop host and
SQLite. Exact saved geometry, resource identities, content and Vela placement
survived restart. The owner review remained open on its existing profile.

The follow-up `c1ce98e` omits style updates for hidden cards while preserving
mounted editors. The 50-block run passed again and separated the return
transition from the settled workspace. In the approximately one-second
samples, renderer callback P95 was 83.3 ms during return, 33.4 ms once settled,
and 16.8 ms after restart. Both return samples retained 43 editor nodes with
12 interactive cards. Restart had 10 editor nodes with 12 interactive cards.
The fitted overview exposed a separate stall. A nominal one-second sample
took 4.30 seconds to collect and contained only five offscreen paint intervals.
An earlier run with the same renderer change still observed 100 ms return
callback P95. These short runs on a shared host establish the remaining
problem and do not isolate a performance improvement or measure physical
display presentation.

The synthetic follow-up receipts are retained outside the checkout with
SHA-256 `38c0aad9f07a8346cb3bbafef6b7bff43d072da68af8b6ead6afddefd95d09c2`
for the initial journey and
`5d63f0e37508a6aeee5f67c445211ffcf7ea054e45b872b84c3fa2323dcf50ec`
for restart. The packed 50-block capture still clips Vela against the top
window chrome at the saved camera position. Dense workspace presentation,
foreground input and presentation timing remain unqualified.

## Direct workspace return and offscreen scale

An integrated 50-block Electron capture exposed a transparent workspace
after direct return from Universe View. SQLite had already restored the
placements. The application had left the stage's arrival opacity at its
departure target because the direct route did not emit a spatial arrival
callback. The application now targets the same Motion Coordinator body
on every canonical overview-to-workspace transition. The spatial callback
can still supply the drawn arrival origin.

At `b666fd003fd22f21daacdcd8ff88a45aa9152d21`, the combined application
passed 10-, 25-, and 50-block offscreen runs and separate process restarts.
Each initial run navigated through Universe View, confirmed the workspace
was inert there, switched through an empty workspace, returned, resized a
card, enabled reduced motion and verified WebGL recovery with a new draw.
The harness now requires a visible workspace stage and a painted card before
taking its capture. The restored layout, viewport, resources and presence
matched exactly. All six test processes exited and no model ran.

| Blocks | Run / restart | Working callback P95 | Offscreen paint P95 | Paint intervals | Mounted editors after return / restart |
| --- | --- | --- | --- | ---: | --- |
| 10 | 7.25 / 3.87 s | 50.0 ms | 44.1 ms | 30 | 9 / 7 |
| 25 | 8.47 / 3.22 s | 50.0 ms | 47.4 ms | 28 | 22 / 10 |
| 50 | 27.79 / 4.89 s | 83.4 ms | 76.8 ms | 25 | 43 / 10 |

These are short offscreen renderer and compositor observations on a shared
host, with no native pointer input or monitor presentation measurement. The
50-block post-recovery PNG was inspected and confirms visible cards. It also
shows a separate Vela clipping defect after a collision resolves her saved
footprint above the viewport. The exact reproduction went to Universal Block
System. Dense editor retention, foreground motion and current presentation
performance remain open.

## Ordinary chat web search

ChatGPT-plan chats offer a separate Search web action on the shared composer.
It sends the submitted message and a UTC timestamp with the documented
`web_search` tool. Other messages, reviewed branch excerpts and attachments
stay out of that lookup. The exact request remains bound to the native
authorization and final source checks. Normal Send keeps its existing
conversation context and does not enable search.

A matching completed provider response can supply bounded citations.
The native host opens the canonical HTTPS citation only on explicit selection.
Citations survive SQLite restart with their answer. Provider rejection retains
the draft, reports the known failure and starts no fallback turn.
Controlled transport, Core, SQLite, native broker and mounted chat component
tests cover the send and citation paths. The [official preview limits](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
make web search conditional on model and account policy. Actual search on the
owner's account and native visual acceptance remain open.

## Current ordinary chat and packaged backend evidence

The S review completed a real ChatGPT-plan Responses turn after the native
transport learned to accept the documented stream events on a successful
response with no Content-Type. The earlier unknown outcomes remain in history.
The T review uses the same profile and the owner confirmed its Device clock
reply in the desktop. Their next ordinary question confirmed a general gap in
the remote request context. The model received the question without a date.

The shared ChatGPT-plan send path now includes a timestamp from Aerynth for
every model turn, in UTC and local time with its numeric offset. The same
observation is bound into preview, approval and dispatch. Direct local clock
replies remain local. Long chats retain their transcript and continue sending
using a recent, ordered window bounded by the actual serialized request size
and item limit. Current input and reviewed excerpts are kept, and every
included source still passes the existing final permission check. Arbitrary
calendar prompts and long-chat sends passed the controlled Responses transport
tests. Live model behavior on this update still needs an explicit Send.
[Sign in with ChatGPT preview limits](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
document account/model-dependent web search and other capability boundaries.

The packaged T host at `d5b210163374edee3793468d046df95fe27472fc`
passed one headless backend trial at each size below. All three restored exact
placements, note content and canonical identities after a separate process
restart. Universe and empty-workspace navigation preserved the source
workspace. Vela's saved footprint intersected zero saved cards before and after
resize and restart. No model ran and all trial processes exited.

| Blocks | First snapshot | Return to workspace | Resize | Edit note | Restart to snapshot | Backend RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 488 ms | 28 ms | 42 ms | 30 ms | 445 ms | 106 MiB |
| 25 | 471 ms | 38 ms | 59 ms | 35 ms | 491 ms | 108 MiB |
| 50 | 324 ms | 42 ms | 81 ms | 36 ms | 348 ms | 122 MiB |

These are monotonic packaged backend timings on isolated synthetic profiles.
The private receipt has SHA-256
`62afaff9a2cde2d24e787de13438d191e6dad0376aaa42d96db969ac31a4be3d`.
Current visual drag and display presentation still require desktop evidence.

## Native workspace scale at 10, 25, and 50 blocks

The same integration source `ecdc05eb0a1fb44c2857e77408e8924ed9381e79`
and renderer assets passed three bounded desktop runs and three fresh-process
restores. Real Core and SQLite commands prepared separate synthetic mixed
workspaces. Native window input used the current environment navigator,
focused the inline note editor at its saved 150% text scale, and resized the
note by 32 × 24 units. Switching to the empty workspace unmounted all cards
and editors. Restart preserved exact placement geometry, resource identities
and content, viewport, organization, and Vela placement. Provider execution
count remained zero.

| Blocks | Initial run / restore | Fitted renderer callback P95 | Visible cards / mounted editors at working scale | Return to workspace and navigator dismissal |
| --- | --- | --- | --- | --- |
| 10 | 13.25 / 3.57 s | 6.2 ms | 8 / 9 | 0.69 s |
| 25 | 14.53 / 3.58 s | 12.1 ms | 12 / 22 | 0.94 s |
| 50 | 25.15 / 4.17 s | 36.3 ms | 12 / 43 | 3.27 s |

The fitted samples lasted roughly 0.75 seconds each. The 50-block sample
contains 36 callback intervals. These are renderer and interaction
observations on a shared host. Display presentation, sustained performance,
GPU memory, and the causes of the dense slowdown remain open. Inspection of
the 50-block still confirmed Vela was obscured. The synthetic fixture used
the actual Freeform placement command to put her 208 × 260 footprint at
(1180, 150), intersecting two saved card rectangles. The same canonical
overlap survives restart. Universal Block System has the reproduction and
owns the workspace policy correction.

## Earlier connection and conversation checkpoints

The P review at `1ddc0cf` preserves the owner's existing private profile.
Official sign-in and plan authorization were already valid. Model discovery
failed because the actual account catalog exceeded the old 256 KiB JSON limit.
Success responses now have a separate 2 MiB limit; errors retain 256 KiB,
requests retain 15 seconds, and model-row validation remains enforced.
An actual managed desktop GET now succeeds. Its private receipt contains only
safe response metadata and byte/count measurements, without model names or
credentials. Connections distinguishes sign-in from model discovery and does
not repeat OAuth, change billing, or claim successful inference.

A brief native UI check created a fresh ordinary conversation and sent only a
synthetic request. The message persisted, but the response is **unknown** with
`invalid_stream_response`: no response identity or assistant output was observed.
It has not been retried. Model discovery does not establish working inference
or native ChatGPT history, Projects, personalization or memory parity.
Computer control was reset and its newly owned helper processes were stopped.

P includes provider-aware chat copy, title-only history rows, canonical message
times and local-calendar day separators. Rounded menus, provider-pill navigation,
Motion Coordinator disclosures and compact recovery layout remain in progress.
AI-generated titles are not implemented or simulated with truncated user text.

Populated chats require a reviewed application continuation when changing
providers. Their original provider, transcript and native binding are preserved.
Empty, unbound chats retain direct provider selection. Continuation preparation
checks the conversation product's source revision atomically and starts no turn.

At this checkpoint, 203 backend, 358 application, 58 provider and 14 packaging
checks passed, with focused strict checks and a production build. Counts overlap
and do not establish visual, accessibility, presentation-performance or product
acceptance. Earlier checkpoints below remain historical.

P0 native ChatGPT fidelity investigation is integrated. The [exact 13-aim compatibility matrix](../../prototypes/conversation-product/CHATGPT-ACCOUNT-FIDELITY.md) distinguishes documented support, interface-scoped exclusions, unverified native-account interfaces and additional authorization. Official documentation confirms the unified desktop Chat/Work/Codex experience, but Sign in with ChatGPT explicitly excludes existing conversations and other account context. Installed public App Server schemas and versioned OpenAI source do not establish ChatGPT cloud history, Projects or account-memory access. The canonical provider catalog now returns typed evidence for each aim while ChatGPT remains unavailable for recording/execution. Eligible Responses inference remains a separate capability with implementation on hold. Local Codex navigation remains a separately labelled, host-unwired seam. No authentication, private service access, copied history, synthetic memory or substitute model provider was introduced.

The combined application now renders that report in an invoked, collapsed compatibility disclosure and wires explicit public-site navigation to the official ChatGPT home. Reviewed evidence links use an exact 12-URL native allowlist rather than generic popups. `requested` acknowledges an OS request only; errors remain unknown with no retry. Neither operation connects an account or imports content. The combined backend checkpoint passes 356 tests; the final UI/descriptor/interop subset passes 60, the application suite passes 182, and strict production build passes with the existing chunk-size warning. These overlapping source suites do not establish native navigation, real account fidelity or visual acceptance. No GUI or account/provider action was used for this checkpoint.

Vela's deterministic local time/date/workspace-layout/project-count/execution-status service is now wired through the actual Core and native broker before provider preview, context or consent. Replies and provenance use the existing canonical conversation and atomic persistence. Unknown intents retain their prior route. Seven actual Core tests cover targeted facts, idempotence/restart, absence of provider/context access, revocation and failed local writes during a suspended fixture execution/handoff; the pending execution still commits its true terminal outcome. This is source/backend proof. First useful UI output, cold/warm native latency and the owner-requested P95 target remain unqualified.

The owner review was updated to immutable H (`856f604`) using its current saved profile after graceful close and a verified closed-database backup. A read-only Windows PowerShell process check on 2026-11-02 confirms H remains open. Owned source checks do not control or close this review window. H includes the bounded readability fixes below; newer native ChatGPT/local-fact source is not in H.

Latest correction: selecting Structured enables the existing world-anchored 16-unit grid without packing the current workspace. Exact block geometry, shape, layers, ordering and placement versions, camera, Vela and saved arrangement preferences are preserved. Later direct drag/resize snaps only changed targets; stationary cards remain collision anchors. Explicit Arrange/Resolve retains its distinct packing action. No canonical resource store or schema was added.

This correction passed the actual combined desktop at `ab07f0835deb3311b7019ea2c71442a61d524346`: native Structured selection on three off-grid mixed-shape cards, one native header drag, one native corner resize, and a separate-process exact restart. Host times were 4.576 and 1.895 seconds. Three fresh-draw PNGs retain actual geometry/pose measurements; startup/runtime/graphics error observations and provider executions were zero. Both test processes exited; the owner's existing review window was left open. Root inspected both initial stills: the stationary layout is preserved; the existing clipped Task status remains a usability defect. This is bounded native functionality and persistence proof, not continuous motion, wider-scale or artistic acceptance. Private evidence folders are `workspace-structured-grid-1793635220256-1967b423` and `workspace-structured-grid-1793635224187-22c98e29`.

Independent read-only audit passed 13 checks: 255 exact raw Git source blobs, all three retained renderer assets, all three PNGs, exact checkpoint and physical SQLite/content/no-execution state. The final Note moved to `(144,352)` and resized to `416×320`; neighbors, ordering, camera and Vela remained exact. The retained private operator has exact pre-launch byte custody but is intentionally ignored source, so no Git-origin claim is made for it.

## Actual application and ownership

The secure Electron application consumes the canonical SQLite kernel, workspace engine, conversation product, Vela service and block/template library. Constellation uses those identities and the existing Cinematic V3.5 shared renderer and Motion Coordinator. Native consent and private provider grants remain outside renderer authority. Opening, moving or navigating a block never starts a model turn. Local chats record actual user messages without invented model replies.

Universal Block System owns all blocks and the transferred Dynamic Workspaces engine. Constellation owns spatial navigation and rendering. Cinematic V3.5 owns optics and coordinated presentation CSS. The application integration lead owns canonical/native contracts and combined acceptance. Workers use isolated checkouts and scoped releases.

Vela retains her own persistent application identity, conversation service, capability registry, contextual plan/review/apply lifecycle and attention observations. Codex remains a distinct provider. Fifteen additional native actions are integrated: project/workspace creation, workspace rename/framing/collision resolution/organization, task priority, conversation creation/favorite/rename/project association, and collection creation/rename/archive/restore/membership. Collection IDs remain distinct from resource IDs; revisions, rule changes, permission scope and idempotent receipts are enforced. Creation of a Codex conversation identity starts no connection, authentication probe or turn. Actual presenter bounds for framing travel separately from model actions and carry no permission authority. Full-app coverage, template orchestration, branch policies and further commands remain incomplete.

Three further canonical actions now support project rename, non-chat resource rename and resource project assignment. Both exact source and destination manifests and current organization permissions are revalidated. Assignment retains all existing workspace references, canonical content and separate recovery drafts; it does not grant access to unrelated destination content or silently rebase an older draft. Actual SQLite restart, idempotent receipts, rollback, stale/revoked permissions and unsupported conversation bypasses are tested. The catalog has 30 entries, including the read-only search descriptor; search is not a planning action or an autonomous resource-search tool. Lossless root-schema defaults preserve the existing 16-KiB prompt ceiling and complete schema reconstruction. Neither capability count nor synthetic provider-port tests establish full-app conversational control.

The provider result contract accepts attributed answers, clarifications and honest inability without inventing an action plan. A non-plan response atomically writes its exact canonical message and a response reference; it creates no native-action plan, action receipt or delegated task. Vela state now migrates versions 1/2 to 3 in the same database, preserving IDs, messages and plans without backfilling unknown historical origins. Unknown versions fail before writes. This is separate from the conversation-product schema, which remains at its own supported versions. Source, scope, cancellation, permission and freshness checks still apply. These paths have synthetic-port plus actual Core/SQLite/component proof. A real provider planning journey subsequently passed as bounded below; non-plan model outcomes and general autonomy remain unqualified.

## Exact original Constellation integration

Initial worker synchronization fix `56f9d08` became `c811ca4`, with matching stable patch IDs. Resource-label culling and revoked-anchor fix `44e252c` became `57948f9`, also matching. Final initial-worker HEAD `5b25e5a` became `1117c15`; the complete Constellation trees are identical (`e834448924230a93097d6710e22a70006079879b`). Later spatial development builds on those changes. Original fixture evidence does not establish combined desktop acceptance.

## Current source checkpoint

Current product source through `539ee4b` passes 321 backend/Vela/bridge/graph/conversation regressions (253 plus 68 in separate invocations), 176 application tests and strict application/backend/Vela typing/build. The Structured integration passes 255 workspace-engine/block-library/Desktop/organization tests. The following helper-only `ab07f08` release passes nine focused native guard/fixture tests and the actual native journey above. These are separate overlapping source suites, not an additive native or provider acceptance count.

Actual native Vela preparation exposed a moving Send target and two ResizeObserver delivery errors before any request or sharing grant. `d38d8db` coalesces Vela measurement/resize into the existing application frame; subsequent actual preparations recorded zero console errors. The helper now requires three stable, unobstructed geometry samples before its single native Send gesture. A further actual run identified `native_review_failed:unsupported_command`: the private desktop stdio allowlist omitted `velaNativeReview`, although direct-Core tests passed. `b170dc3` repairs that real integration defect; an actual subprocess/Core test verifies exact review dispatch and zero executions, while the renderer preload refuses all private review/grant commands before IPC. Later retained native facts showed a focused owned child and disabled parent: Electron's reported preferences omitted the metadata the helper had incorrectly expected. Private native ownership and authenticated preload readiness now provide that attestation without weakening focus-loss aborts or reacquiring focus. All earlier failed profiles and evidence remain preserved.

At `6528f40`, 167 application tests, 127 block-library tests and 300 combined backend/Vela/bridge/conversation regressions pass, alongside strict application/backend/Vela typing and the production build. These are separate suites, not native acceptance counts. The graphics bundle remains `graphics-7cdVc5rd.js`. The build's existing large-chunk warning remains; it is not performance qualification. The subsequent camera-only fix `09a67e2` also passes all 167 application tests, typing and build.

The `9e5b6b1` Minimize integration checkpoint passes 171 application tests, 217 block-library/workspace-engine tests and 308 backend/Vela/bridge/conversation regressions, plus application/backend/Vela typing and build. The following `58db7ba` canonical-project projection fix passes all 155 Constellation runtime/helper tests. It retains foreign workspace references and adds an owning-project body when no permitted placement represents the resource in that project. Existing stable IDs and saved XYZ/pins remain unchanged; native project reassignment still needs acceptance.

New placements have ten distinct default size pairs. Conversations start at 380 by 600; notes at 440 by 360; tasks at 320 by 260. Existing stored and user-resized geometry is preserved. Normal cards mount their functional views without expansion, retaining canonical resource identity and stable editors. Research now defaults to a rounded card; saved lens/circle/pill shapes remain supported. Direct interaction, task completion, browser attachment and recovered note drafts use current canonical fences.

An actual earlier native run exposed accidental saving of an untouched recovered note during navigation. The automatic drain now commits only new edits; untouched recovery, metadata rename, competing draft revisions and explicit overwrite authority remain distinct. The failed receipt is preserved.

The minimal Vela surface now starts with the composer and purposeful icons. Actual context, plans, messages and phase observations retarget the existing Motion Coordinator; saved history does not replay as new activity. Context surfaces resize from measured content. Conversation settings, history and filtering controls use semantic icon/label treatments and the same shared transcript/composer in normal and focused presentations. Generic oversized application dialogs outside those scoped changes remain unfinished.

## Actual native and visual evidence

At `af0bd3099ea38ccee6316b949ba520cec8b98805`, a real Codex-backed Vela planning journey and separate restart PASSED in the actual combined app: 52.414 and 6.590 seconds respectively. The user physically approved the native exact-prompt disclosure; the helper never grants approval. The exact 16,111-byte reviewed prompt equals the sole canonical provider input. The frozen reviewed context equals the stored request context, including identity and timestamp. A real provider plan was presented and explicitly applied through application controls, materializing one persistent workspace reusing the selected canonical local-chat and Note IDs. Actual local message/Note edits and exact source/target geometry, receipts, preferences and content survived restart without a new turn, grant or probe. Vela's application identity and Codex's provider identity remained distinct. One execution completed with `taskVerified=false`; the complete retained event scope contains no tool lifecycle or delegated task. This proves a bounded selected-resource planning/apply journey, not full-app control, natural-language autonomy or task delegation. Independent audit verified 249 exact Git blobs, original bundles, operator/logs, all five PNGs and read-only SQLite/checkpoint. Private evidence folders are `vela-live-1793632458917` and `vela-live-1793632589409`.

That functional pass initially failed Vela visual acceptance: actual long-request/plan/restart images showed overlapping text and rear-Note bleed. Intrinsic text flow and the bounded inner reading film were corrected. At `b6018f8`, the actual historical applied-plan UI passed in 8.025 seconds: native outer/inner wheel scrolling, evidence disclosure open/reveal/close, two fresh-draw PNGs and all 116 required glyph lines fully reachable/visible. Canonical/event digests, editor value/selection, nodes and geometry stayed exact, with zero observed console/native errors and no provider turn. Root and V3.5 independently inspected the images and closed this specific overlap/bleed finding. The owned process exited. Fresh approval, ordinary Whisper/Insight, IME, all window sizes and the full Manifestations composition remain unqualified. A historical hydration-only `adaptation.applicationAvailable` cache differs from runtime availability; durable preferences and policy are exact, so whole raw adaptation JSON identity is not claimed.

The newer `412040a`/`95e0814`/`539ee4b` Constellation seam uses the full viewport, actual bounded host UI exclusions, caption/leader clearance and successful-draw arrival projection. Root compacts the header while measuring actual mode/navigation controls and enforcing one row. Original image/graphics assets remain unchanged. The grid stills show this workspace header, but narrow-window/enlarged-text usability, fewer navigation controls, full-field spatial motion and renewed heavy-case presentation measurements remain pending. Earlier measurements do not qualify this changed viewport.

Later source `09491f7` passes 110 Constellation runtime tests and strict application build. Fresh project/default/Home framing now fits actual project-body envelopes using the tighter horizontal/vertical field of view. A separate outward project-exit band prevents an immediate tiny zoom-out from leaving that new overview; Universe approach thresholds and saved/manual/restored poses remain authoritative. Direction/reversal, narrow aspects, distant pins and the 100,000-distance escape have source tests. Actual full-viewport UI exclusions, label/capsule placement, new-camera native motion and heavy-case measurements remain pending. Immutable E predates this framing change.

The combined desktop at `8344010` passed the bounded product-UI check on a private synthetic profile in 7.243 seconds. It used native input, actual Vela and conversation surfaces, fresh GPU draw acknowledgements, two screenshots and a 6.690-second exact-window recording. The Sources pane settled near 520 by 323 instead of a standing 580-pixel height, with actual intermediate dimensions and the identical composer. Full existing canonical resources, block geometry, Vela placement, note content and separate recovery draft were unchanged; provider executions and observed startup errors were zero.

The motion file is 3,449,412 bytes, SHA256 `ee9a8a4506835b631d07659a336691609436bde5be094e0bd4507a6719835301`. Eight frames were decoded offline with a hidden software-only process. Independent visual review closed the oversized empty-Sources gap for that sampled state and confirmed readable controls and recognizable Vela. The new compact placement no longer crosses the rear Note, so this sequence does not independently prove absorption under deliberate rear-text overlap. Sampled frames and a requested capture rate are not continuous smoothness, artistic acceptance or monitor presentation measurements.

A separate actual expanded Constellation run on the same source completed steps 1 through 14, then failed while seeking the original workspace at a camera still inside a resource neighborhood. Its recordings, partial progress and failed receipt are preserved. `b4a243c` uses actual Recenter/Locate commands before the unchanged workspace return assertion. The chat now observes its externally sized host and coalesces sizing outside ResizeObserver delivery, preserving the existing composer.

The fresh actual combined run at `9288f6a` subsequently PASSED all 25 steps across two processes: steps 1–23 in 52.243 seconds, then restart steps 24–25 in 3.467 seconds. It exercised editable workspaces, native block manipulation, wheel traversal, project and Universe environments, native orbit/pan, provenance inspection, reviewed connected branches, native 3D dragging, XYZ/pins, typed relationships, named views, cross-project travel and a real persistent note edit. Exact original identities, geometry, shapes, content, viewport and Vela footprint returned; fresh-process restoration retained relationships, branch ancestry, spatial layout, camera bookmarks and history. Both receipts report `rendererErrors: []`. The earlier warning did not recur in this sequence; its cause was not isolated experimentally. The owner-bound launcher verified exact source/build hashes and closed both app/backend processes. This is real combined desktop functional and persistence evidence, not an isolated Constellation fixture.

The rerun at `03ccd51` also PASSED all 25 steps across the actual journey and fresh restart, with no errors in its recorded window/runtime and graphics checks. Its preceding attempt had read an expanded task-group host before asynchronous membership painted; the preserved screenshot showed the real rows afterward. The helper now waits at most five seconds for the exact canonical member IDs, statuses and accessible enabled checkboxes before all 106 unchanged journey assertions. Five new focused readiness/abort checks pass. No product state, geometry, fixture seed, deadline or native action was changed for that correction. Both owned processes closed after the passing run; the existing user review database remains unchanged. The later corrected console/startup monitor was not part of that earlier run, so its empty arrays do not prove all-console error absence.

Two exact-window clips contain 24.446 and 22.894 seconds of motion, SHA256 `e6b0d03de48758bba7e36061d7572ab546c8d60518be66a9800db162e69981a3` and `667f6d0c5165a9b6cf6cdac524627ba18b925c04207b37e20d80e5e4e36e66ce`. Native Universe and restored-workspace stills have been inspected. The deliberately retained older synthetic layout is cramped at its saved zoom, with small controls clustered left; exact restoration does not establish useful framing or artistic acceptance.

The latest hidden real-browser contour fixture passed all 72 shape/size/morph cases: 576 handle-center and 144 editor-corner hit tests, zero failures and zero console errors. Its earlier run caught real resize-grip overlap with editor corners; the production inset fix passed the unchanged assertions. This establishes actual DOM mask/hit behavior, not native GPU, motion or artistic acceptance.

An actual collection-browser attachment then exposed an unspecified-position collision. New individual Library placements now use the canonical nearest-vacant solver only when both coordinates are omitted, with fresh presenter bounds. Existing Freeform overlaps and explicit geometry remain unchanged. At `61022af`, all ten block types plus three saved lens/circle/pill cases passed native primary-action, resizing and editor-identity checks; a separate fresh-process restart passed exact geometry/content/draft restoration and native Send. Both final graphics checks report zero errors, no failed renderer and no lost context. An independent read-only audit compared 209 source hashes, both native receipts and the actual reopened canonical database. Synthetic preparation remains separate from actual native Note/Chat creation and interaction.

Visual review found that short Chat feedback and automatic scrolling could hide canonical text despite a working composer/Send. The failed screenshot and bounded Range geometry are preserved. Selective informational feedback cleanup, following actual canonical content rather than the invisible action footer, and explicitly following an acknowledged Send across restored scroll state are now integrated. At `d2f3d0b`, a fresh native run passed all ten block types and three saved curved shapes; the short 408-by-257 Chat had a 67.65-pixel transcript containing a complete painted canonical user line, an unchanged usable composer and a visible, hit-tested Send. A separate fresh-process run restored exact identities, geometry, content and draft, then actually sent the restored draft once and cleared its acknowledgement. Both runs report zero graphics errors, no failed or lost graphics context and zero provider executions. Their empty startup/console arrays do not independently prove error absence: a subsequent source audit found the workspace host did not enable startup capture and the helper used an outdated console callback signature. Correcting capture and rerunning remain required. Independent source/SQLite audits verified 209 source hashes, 13 workspaces, 15 placements, exact saved shapes and precisely the two expected local user messages. V3.5 inspected both actual Chat screenshots and closed that specific visibility finding. Other sizes, views, live providers and whole-app artistic acceptance remain separate.

A projected free-footer placement helper and coordinated CSS now avoid notices covering saved-card content. The helper reuses renderer bounds rather than moving canonical geometry; if no footer interval fits, it uses reserved native chrome while preserving window controls. Three focused geometry checks pass. The new footer placement still requires current native visual review.

## Measured presentation pilot

One fresh 1-project/50-resource case at `ba9adf2` completed 40 project and 40 Universe samples with actual camera/GPU progress. Separate pinned PresentMon captures reported 1,805 and 1,808 displayed rows for the application's GPU process/swapchain. An independent raw-CSV audit reproduced the counts and interval distributions. Project display intervals: P95 6.1326 ms, P99 12.1275 ms, maximum 709.0925 ms. Universe: P95 6.1318 ms, P99 12.1308 ms, maximum 709.1441 ms. Each phase has one interval over 500 ms despite every row having a zero dropped flag. No renderer errors were observed.

A second diagnostic retained the full callback/draw timeline, unchanged OS captures and sixteen bounded no-input tail samples. It reproduced a roughly 715-ms display gap and 727-ms draw gap while the window remained visible and focused. The scheduler was accumulating a future deadline by advancing a 60-Hz deadline on every forced transition draw at a faster refresh rate. `92ffb92` resets that forced-draw debt; `d2f3d0b` retains the existing 0.25-ms fractional cadence tolerance. Six policy tests and an independent exact-source replay reproduce the old 727.27-ms gap and bound the corrected sequence to 18.18 ms, while preserving ordinary cadence behavior. No shaders or Motion Coordinator behavior changed.

The subsequent actual `d2f3d0b` 1-project/50-resource probe completed the same 40 project and 40 Universe samples with fresh camera/GPU progress and zero errors in its recorded checks. OS display intervals measured project P95 6.2147 ms / maximum 12.2486 ms and Universe P95 6.2071 ms / maximum 12.1925 ms, with no intervals over 16.667 ms and zero dropped flags. Full callback/draw maxima were 24.3 ms, without the former flat GPU tail. An independent audit verified the source, assets and raw CSVs. The fresh synthetic camera/layout differed: the later project culled 12–17 of its 53 nodes while the earlier pilot culled none. This is evidence for the scheduler correction and absence of the reproduced symptom, not a controlled overall GPU speedup or production qualification.

At `844cf1c`, the actual 3-project/250-resource case passed its measurement-integrity checks in 29.939 seconds. Independent audit reproduced all unfiltered PresentMon rows: project 1,895 rows, P95 6.1888 ms, maximum 12.2558 ms; Universe 1,891 rows, P95 6.1963 ms, maximum 18.2206 ms, one interval above 16.667 ms. Both phases recorded zero dropped flags. The corrected current Electron console/startup monitor observed no errors from registration through final capture. The canonical dataset contains 250 resources distributed 84/83/83, 50 actual workspace placements and 249 relationships. All 87 active-project bodies and three Universe project stars were detailed; the instance-batch path was not exercised. The remaining cases are 10 projects/2,000 resources, 10/10,000 and 1/10,000. Display-change intervals are not unique-content FPS, CPU submission timing is not whole-frame GPU timing, and zero dropped flags alone do not establish smoothness. Gaming/development load remains uncontrolled.

The first 10-project/2,000-resource attempt at `dd9323a` failed admission before any samples, PNGs, PresentMon process or console-monitor registration. The original host wall timestamp was 372 ms later than the helper's subsequent wall timestamp; the unchanged deadline check rejected it. The exact source and failed receipt are preserved. No OS trace establishes why the wall clock reversed. The later `b6cc022` interface uses the Electron main process's monotonic clock while retaining original wall timestamps as diagnostics; the old failure is not performance evidence.

All five scale cases now have bounded actual-app measurement and independent raw-CSV audits; they are not one current-source matrix or production qualification. The additional 10-project/2,000-resource case at `5b2af12` measured project display intervals P95/max 6.1857/18.2471 ms and Universe 6.1752/18.1977 ms. The 10-project/10,000-resource case at the same source measured 12.1574/30.3624 ms and 6.1785/24.3033 ms. Both exercised real instanced rendering. The latter original JS bundle was overwritten before independent byte audit: recorded manifests and an exact-source deterministic reconstruction corroborate its digest, but reconstructed bytes are not retained original captures. Full custody details and exact receipt paths are in `prototypes/constellation/VERIFICATION.md`.

The final 1-project/10,000-resource case at `336558e` measured project P95/max 12.1159/42.4005 ms and Universe 6.1759/18.2288 ms, with the 42.4005-ms outlier retained. Its 64.034-second helper completed all nine idle/quality/Quiet/reduced-motion/resize/WebGL-recovery/scene/minimize checks within the 90-second ceiling. Real context recovery preserved exact camera and 10,003 candidates: 4,874 visible bodies, including 280 detailed and 4,594 instanced, with 5,129 offscreen. The recreated renderer drew frame 1 after the previous renderer's frame 3,145. Retained original pre-launch bundles, operator, source, four PNGs, two CSVs and read-only SQLite were independently audited. Observed startup/runtime errors and malformed console events were zero; 252 non-error events were ignored, so this is not a no-warnings claim. The recovered dense image is visibly crowded with crossing leaders and a rectangular viewport edge. Visual refinement, continuous motion, input latency, sustained GPU/VRAM/soak and mixed-display qualification remain open.

## Frozen portable review builds

A, B and C are immutable and preserved. Their bundled Node/backend persistence checks passed; these checks do not establish a packaged native GUI or live inference.

| Artifact | Candidate | ZIP bytes | ZIP SHA256 |
| --- | --- | --- | --- |
| A | `262501a661dddfdb833b3fdd54a4c8632cdccbbd` | 471,335,398 | `a9ad3e3c33de7b57d854ea46305f1ed65c731f558c12e6d793066d866273ba0a` |
| B | `f8965609e883219eb5190304f1d026342b786dd5` | 471,490,544 | `a2a48dd7ea2c9c33cc76e2461e138ba5a057cce1212273689b940d0c1d5eb95e` |
| C | `7a5e3359cb9eb2f37869b7ce94fe898e9e7517c0` | 471,824,720 | `c909c07ed40d0489376aaba6df96803d581fabd600f5f7670a7bbd35aa8e2438` |
| E | `c7590e701674f1977b1cbc9bd4cd3665bc7d7a77` | 472,030,260 | `b56306fcd9e84575de9cd0daebed165978f95df105756a79d4a2b8ed49218339` |
| F | `17011a4fb6c2cc437f7b66b12caa636cac1daec6` | 472,034,686 | `519bc4d7a735077b446044ee436a83f311a82685d30f029e7e5722bfbb4178d0` |
| G | `ab07f0835deb3311b7019ea2c71442a61d524346` | 472,061,944 | `ca09dc0880ed8d3fa1382ebd2a646d5fc14e745431f1797be497518e5712952c` |
| H | `856f604af743031b69d858c05dfa409ce22566c7` | 472,062,576 | `fb491d44fca4ef1555b9cefa4b6e6ec25006cb142d05e78c26aaf4d97f90666c` |

F passed independent byte/source/closure audit and bundled backend/restart. Its saved profile contains subsequent owner edits and remains the current profile. It was gracefully closed for the requested update; only the closed database was backed up before H opened using that same profile. G remains a preserved separate immutable update containing the native-verified Structured correction, frozen-context fix and optical/header source. G's actual bundled Node/backend passed 22 initial and five restart commands, including exact off-grid geometry preservation on Structured entry. Its payload is 241 files/471,905,756 bytes; manifest SHA256 is `b44f8b47f7d8e4995b63b315d9e8dd724036f27d9ede05ce4bd78fb2e805a7a5`. G was never launched as a packaged GUI. H also passed 22 initial/five restart packaged-backend commands; its 241-file payload is 471,906,388 bytes, manifest SHA256 `3ebf84bf632953c3e1ce78ca1c578bf97b38a6fdcef281fe82227288107541a2`. Its independent full byte/source/vendor/preload/runtime-closure and 243-member ZIP audit passed. Renderer assets match the native readability candidate. The launcher selects H, refusing concurrent access to its current profile. Packaged bytes/backend, source-native receipts and owner review remain distinct evidence tiers.

G's independent byte/static-closure audit passed: all 241 payload files, 157 exact raw Git source origins, vendor runtimes, all five dist files, original brand images and both trusted preloads. The normal 44-file/80-runtime-edge native/backend closure has zero unresolved runtime dependencies; excluded verifier requires remain behind bootstrap-blocked flags. Every one of the ZIP's 243 members (payload, manifest and sidecar) was streamed and verified for exact bytes, digest, CRC and safe unique paths without extraction. Independent compilation of dist, packaged native GUI, provider, performance and artistic acceptance are not inferred.

Artifact D at `3ed23b8` is preserved but rejected for review promotion: independent audit found a missing Electron decision preload and three unintended native synthetic preparers. The packager now explicitly roots both trusted preloads and excludes/refuses synthetic native preparation dependencies. Nine packager regressions pass. D was not repaired in place; A/B/C and the existing C launcher remain unchanged.

Replacement E has an independently verified 239-file payload (471,875,473 bytes), 241 exact ZIP members, 155 exact Git source origins, original assets and both corrected runtime/exclusion boundaries. Manifest SHA256 is `764decbf8cc7a3a49ed907a165ce03f3bab3eafa14d7eb16dd3c04de7e102ac3`. The actual bundled Node/backend passed 19 initial and five separate-process restart commands using a fresh synthetic external profile: canonical project/workspace, Library local chat and user message, Note, minimized flag/camera, attention-mode receipt/preferences and exact native disclosure transport without any grant or model turn. Independent read-only SQLite audit corroborated the exact restart state, schema 3, unchanged monitoring/delegation authority and zero executions. This establishes packaged bytes/closure and backend persistence; packaged native GUI and live-provider acceptance remain unrun. E's generated launcher uses its own fresh default profile; the existing user review database is unchanged at its verified SHA256.

B predates the minimal Vela presentation, direct normal-card updates, recovery correction and additional capabilities described above. C includes them and the scheduler correction, binding 228 copied/generated files, 471,678,409 payload bytes and manifest SHA256 `1a3a77ebe606973779d390365820d3ff476a3f38d19433730613332df9da827a`. Packaging preserves exact bytes and does not infer native acceptance. The bundled Node and actual packaged canonical backend passed local message, geometry, committed note, separate recovery draft and exact close/reopen checks with zero provider connections. C's packaged native window was not separately tested. Its historical launcher selection has since been superseded by the F/G lifecycle above; C and its original profile/backup remain preserved. User profiles, private evidence, recordings and credentials are excluded from public artifacts and remain preserved privately.

## Acceptance still open

### Candidate work after frozen C

`fd8f792` integrates Universal's per-kind measured readability composition with one shared actual-body ResizeObserver and the existing coordinator. Hidden/unobserved bodies remain unknown; actual zero-sized bodies remain real observations. The observer only caches and wakes. Camera-only Approach and an explicit previous-view return use canonical viewport commands, with rotated bounds, retained editors, focus/interruption checks and no saved block-geometry mutation. Eight focused observer/framing regressions, 159 application tests, 105 block-library tests, typing and build passed. An actual ten-kind/three-shape native run plus fresh restart passed again in 28.276 seconds including preparation, with zero independently collected graphics errors; the older console-capture limitation applies.

The separate actual native Approach test caught a fractional camera round-trip difference. `09a67e2` keeps the exact canonical viewport rather than reconstructing it from pixel offsets. The next assertion caught Research editor scroll changing on Return. Bounded diagnostics showed unchanged scroll through Tab, followed by browser anchoring during width reflow. The owner's scoped `overflow-anchor: none` fix passed the unchanged exact camera and scroll assertions at `ee5802b`: 13 native actions plus six explicit fixture navigation/camera commands exercised Research editing, pill Task status, circle Reference Approach/Return and Open/Back. The fresh process used four canonical navigation commands to verify exact persisted geometry, flags, content and tiny viewports without replaying input. Research scroll remained exactly 950.4000244140625 with the identical editor, text and selection. Initial/restart host times were 12.057/1.947 seconds, with no observed console/startup or graphics errors. Independent audit verified 238 source/helper hashes, matching assets, three fresh-draw PNGs and the unchanged read-only canonical database. Root inspected the approached Research still. Previous failures remain preserved; continuous motion and broader artistic acceptance remain separate.

Canonical Minimize/Restore is integrated through the existing engine flag, transaction, version fences, undo/checkpoint history and native command queue, preserving geometry/camera/presence. Effective presentation state defers shrink during IME and wakes the existing Motion Coordinator; physical compact bounds do not become a layout store. Actual combined native acceptance PASSED at `5b2af12`: Chat/Note creation and editing, inspector Minimize/header Restore, same-process node/text/selection/scroll retention, and unobstructed tiny-circle Restore at 35% zoom. Initial and restart host times were 15.122 and 5.997 seconds. All three saved-minimized placements, exact geometry/camera/content and Chat draft survived restart. Cold minimized Chat intentionally mounts its controller only on native Restore; canonical draft was checked before that first activation, then exact hydration without input replay. Independent audit covered 245 source/helper hashes, matching build manifests, two fresh PNGs, checkpoint and SQLite. Real native IME, wider tiny-shape coverage, continuous motion and artistic acceptance remain pending.

The integrated source contains default-off same-turn native capability-schema discovery and bounded-history flow. The catalog uses the existing canonical registry, a private execution/thread/turn-bound read-only lease, exact schema/digest/permission checks and bounded calls; cancellation revokes the lease without deleting provider history. Read-only metadata and history checks use same-connection read transactions without full graph/body snapshots or database writes. History preserves whole canonical pairs, transitive authorization proofs and exact source scope; it binds the approved frozen context to only the host-recorded canonical input append. Stale/revoked/extra-append cases refuse rather than silently selecting different history. Both discovery and history feature flags remain off. Tests use synthetic stdio and actual Core/SQLite, not a live Codex model.

The native broker now reads a private exact-prompt disclosure and binds its digest to authorization. A bounded, scrollable native-owned child shows shared metadata/excerpts, selected prior messages and the exact semantic prompt. It exposes no application bridge, grants or provider port. CPU lifecycle/security tests and hidden real-browser wrapping checks passed, including a narrow surface at an asserted 150% zoom. At `56c83be`, a separate actual native check on the integrated desktop parent passed Cancel, Escape, a synthetic Send once decision, expiry and child close in 4.720 seconds from host start. The actual modal parent was disabled, Cancel initially focused, exact 11,765-byte request retained, footer bounded and application/node bridges absent. Every child and decision listener was released, and canonical state and zero executions were unchanged. Root inspected the actual child screenshot. No backend authorization grant or provider connection occurred: live-provider approval, parent destruction, real focus-loss interruption and inference remain unqualified. These source additions are absent from immutable C and do not establish a working full-app conversational assistant.

The full native Library/template journey PASSED at `6528f40`: 120 actual native actions, then six actions in a fresh process, with 30.119 and 2.936 seconds from each host start. Starting from an empty ordinary schema, it created a project and Blank workspace, working Chat/Note/Task blocks, canonical edits and independent drafts, detached/reattached the same Note, changed geometry and typography, saved a named template, discovered it through Constellation and instantiated it. Restart preserved exact IDs, geometry, configuration, template and drafts. The Note and Task reused canonical identities; the new Conversation was empty and independent. Both corrected startup/console monitors and graphics checks recorded zero errors; no provider execution occurred. Independent audit verified 232 exact source/helper hashes, unchanged source/assets across restart, all three fresh-draw PNGs and the immutable read-only canonical database.

Actual A/C still review confirmed a visible recognizable glossy Vela, quiet idle caption and working direct controls. Remaining findings include dense template utility controls, a clipped Task status line and deliberate saved Freeform overlap. Persistence success does not close those visual/usability findings or establish whole-app artistic acceptance.

Related-resource callbacks are now wired from document menus and resource-browser row details into a locally anchored contextual surface. The host reads the current canonical snapshot and dispatches only the existing native graphAction family; the module owns no resource/relationship store. Queue/lifetime checks prevent a closed surface from starting a later action, new edits flush before mutation, and uncertain results are not replayed. Read-only inspection does not flush drafts. The released module confirms actual relationship effects in returned state, limits removals to supported user-authored kinds and keeps other provenance inspectable. All 171 application and 136 block-library tests, strict application typing and build pass. Native interaction and visual review for this App hookup remain pending.

That pending Related check subsequently PASSED in the actual combined app at `a4ef873`, receipts `workspace-resource-links-1793624049009-76b67c31` and `workspace-resource-links-1793624059207-561b9b5a`: 10.626 seconds initially, 3.483 seconds after fresh-process restart. Native Note menu/search/focus traversal/selects created and inspected a user references edge, opened its target, inspected incoming provenance and protected task membership, then removed exactly that edge. A second depends-on edge survived restart and was removed without replaying creation. Canonical resources, versions, all saved block/camera/Vela state and two separate recovery drafts remained exact. Startup/runtime/graphics error observations were zero and no model turn occurred. Root verified current source/assets and viewed the outgoing-link PNG; the block owner independently verified all 248 exact Git source/helper hashes, retained original pre-launch bundles (1,197,230 bytes), copied operator, three PNGs and closed SQLite. All 12 placements and both exact recovery drafts remain intact; only the two intended user edges changed, with protected membership preserved. The panel still has generic, text-heavy, scroll-heavy presentation; optical refinement is coordinated, not accepted as finished.

The exact actual-Core/native-live semantic request now fits without dropping sources, history or schemas. The initial formatter measured 15,224 bytes with 28 capabilities and 15,768 with the synthetic 29-entry availability fixture, under the unchanged 16,384-byte ceiling. The new attention action raises those to 15,566 bytes with 29 entries and 16,110 with the synthetic 30-entry fixture, leaving only 274 bytes in that latter exact case. Further catalog additions require a new capacity strategy or proof. Ordered required-property and effect defaults reconstruct the original schemas exactly; oversized input still rejects before writes, grants or connections. This is capacity proof, not current model understanding or native authorization proof. Optional history and catalog-discovery flags remain off.

Vela can now prepare/review/apply `setAttentionMode` through the existing canonical persistent AttentionPreferences service. The five modes alter attention-event policy only; they do not enable monitoring, delegation, graphics Quiet, timers or new data sources. Optional read/change-mode host policy ports fail closed, the catalog pins the actual authorized preference version, and stale/revoked/foreign/unsafe versions refuse. Actual SQLite tests cover all modes, duplicate commands/restart, cancellation and a forced failure after the real preference write: service and stored state roll back together, canonical request/plan/receipt references remain consistent, the uncertain old plan is not replayed, and a fresh reviewed request succeeds. These are synthetic-port/Core proofs, not native conversational acceptance or full-app control.

| Category | Actual status |
| --- | --- |
| Implemented in subsystem source | Navigation, spatial graph/layout commands, working card views, libraries, conversations and Vela foundations exist; expanded product scope remains ongoing. |
| Integrated into desktop source | Yes for the recorded releases; no competing graph/resource database. |
| Verified in combined desktop | All 25 expanded spatial steps/restart pass at `03ccd51`; ten block types and three saved shapes/restart; native Library/template lifecycle at `6528f40`; Approach/Return at `ee5802b`; Minimize/Restore at `5b2af12`; refined Related links/recovery and bounded real Vela provider planning/apply at `af0bd30`; Structured grid preservation/native gestures/restart at `ab07f08`. Each is source-bound; no claim that one current candidate repeats every prior journey. |
| Visually reviewed | Actual stills and sampled motion frames reviewed with explicit limits; whole-app and owner artistic acceptance incomplete. |
| Performance-qualified | No. All five scale cases have source-bound measured display intervals, with instancing and dense lifecycle/recovery exercised. Different source candidates, uncontrolled gaming/development load, custody limits, dense visual defects and unmeasured sustained/input/VRAM concerns preclude production qualification. |
| Packaged current candidate | Immutable K at `0b68459e466c761805da4da1035b9ea17a57cb6a` is open after the owner's latest update request. It reuses the saved profile after graceful close and a verified database backup. Its 254 payload files/source/build hashes, bundled backend initial/restart, 203 application source checks and strict build pass. It includes the relationship fix, current conversation-read improvements and measured Vela manifestation host. The full 25-step native journey remains source-bound to predecessor J (`f221f55`), not a complete K native rerun. K's new Vela optics, native provider behavior and overall performance/artistic acceptance remain unqualified. Earlier candidates remain preserved. |

Required follow-up includes authentic ChatGPT account interfaces/authorization, native Vela fact latency and cohesive Manifestations, remaining Library/template management journeys, additional branch policies, other live provider outcomes and attention states, full-app capability coverage and delegation, native IME, useful saved-layout framing, dense visual/transition refinement and sustained/input/VRAM/mixed-display performance. The sampled historical long-plan reading defect is closed above; other Vela states remain open. Renderer callbacks never substitute for monitor presentation. The successful real planning receipt and earlier failures remain source-bound and preserved. Bounded history and capability discovery remain default-off source, not live-provider claims.

Owned native test windows and backends close after each bounded check. Automation stops between slots and never reclaims focus after loss. The owned checks leave owner review alone; dedicated test profiles keep agent writes separate from current user data. Reserve admission retains at least 30 GiB independently on C: and D: for bounded owned work; it is an instruction/check rather than an OS quota and cannot stop unrelated or unloaded writers.

### Latest drag, navigation and provider checkpoint

The native drag regression passes at `0b81ae7` and again after the actual grid-depth correction at `411c290`. The latter actual combined application check took 17.875 seconds initially and 2.263 seconds in a fresh process. Fluid, Freeform and Structured each retain the visible target outline while the physical card follows through the existing Motion Coordinator, converges, commits once, and restores exact geometry/content/camera/settings through Undo and restart. The same Note editor, text and selection remain mounted; the exercised scroll position was zero. Three native PNGs and an exact-window 6,396,714-byte WebM are retained under private evidence `drag-glide-1793643767952-4bba2ed0` with separate restore `drag-glide-1793643786586-2638cdda`. Independent audit verified 274 exact source/helper blobs and unchanged canonical SQLite, configuration, draft and history records.

Actual inspection of the first passing candidate found grid lines crossing the physical card faces and Vela. This was corrected by rendering the existing MC-controlled grid after the celestial background and before the physical scene, retaining the same sparse spacing, feathering, falloff and reduced-motion behavior. Root and the visual owner independently reviewed the corrected Structured capture: lines remain in open space and stop behind foreground bodies; the intentional target outline remains visible. This closes that scoped optical defect, not general artistic or presentation-performance acceptance. Smooth local selection has source coverage; the drag test does not independently qualify plain-selection neighbor stability or its full visual cadence.

Conversation navigation releases `ddce518`, `0e02396` and `88f948e` are integrated through `007de11`: conversation-first browsing, grouped message matches, activity/title/creation/running sorting, nested collections, a bounded keyboard switcher and compact branch navigation. Codex capabilities bind only to exact provider identity and matching observations. Root's `32b69b1` connects the trusted metadata read view to the same canonical SQLite/graph, avoiding full graph/Desktop/body hydration for empty browsing. Actual Core tests prove this path and refusal of retained lazy reads after source revocation/access denial. Native journeys, accessibility and large-library usability remain pending.

The original bounded library benchmark failures remain preserved: `eb80c88` stopped at the 256 MiB sampled RSS fence during setup; `d8832b7`, with lower V8 heap limits and the same RSS fence, reached its dataset deadline. Source `fda8ec8` then introduced a fresh synchronous canonical read transaction and per-read source/message authorization memo, shared by the CP host and graph callbacks. Escaped lazy readers, nested/async/thenable callbacks and subsequent denied/revoked sources are fenced; the memo is cleared on every exit. Smart collections no longer calculate unused count/activity summaries, and conversation search summarizes only authorized matches. No competing graph, persistent index or permission cache was added.

The fresh small benchmark **passes** at `6f7a3ddc506f9b05e94f8366e2eab10ec20225a4`: actual 172 conversations, 2,072 messages, 64-level branch chain, eight fanout branches, current source denial and revocation, four projects, eight notes and three collections. All 13 operations completed five warmups and 20 timed samples under the unchanged 90-second/256 MiB RSS/64 MiB disk envelope; total elapsed 68.005 seconds. Recent metadata p95 was 234 ms, empty conversation browse 196 ms, scoped project 25.8 ms, favorites 6.9 ms and explicit resource search 1.84 ms. All observed reads made zero provider calls or SQLite mutations; empty browse avoided graph snapshots, full history and note-body hydration. These are in-process Core/service timings, not native input, paint, animation or presentation measurements.

The fresh medium case constructed all requested 572 conversations/8,072 messages without capping, then failed its dataset deadline at 91.248 seconds. Empty browse completed 20 samples (p95 1,179 ms); recent-read timing was incomplete, with partial samples exceeding three seconds. The large case was not attempted by the fail-fast runner. Larger-library performance is therefore incomplete. Original failures, both fresh fixtures and all partial receipts remain preserved; budgets were not increased.

The encrypted, reviewed Personal Context core (`f7b6685`, integrated `0e4c4ba`) and native-only SIWC/Responses module (`4c06425`, integrated `8148fc4`) remain source foundations, not connected runtime features in J. Canonical-connection encrypted storage, cross-process fenced leases/recovery and exact loopback adapters (`1f896bd`, integrated `2008e60`) pass 49 offline tests, including actual independent Node processes and local HTTP sockets; OS encryption is a synthetic stand-in in those checks. The owner keeps Aetherwake proprietary. Official guidance separately permits the current personal-local application category without stating an open-source-license prerequisite; dynamic registration implementation proceeds in that scope. Native main/backend secret-protection wiring, user consent, eligible inference and ordinary/Vela behavior remain unverified. Native ChatGPT history, account memory and sync are not supplied by this route. See [the fidelity matrix](../../prototypes/conversation-product/CHATGPT-ACCOUNT-FIDELITY.md).

The reported camera-dependent relationship disappearance is corrected by Constellation release `867b983` integrated at `f221f55`. Relationships resolve from the authorized scope, independently of endpoint-body frustum membership; the bounded edge set is stable through camera movement. Existing Three.js screen-width filaments retain readable width, dashed inferred provenance, canonical picking and normal depth occlusion, without a new renderer/store/scheduler. Source regressions cover 96 orbit/zoom/pan/quality poses, off-screen endpoints with an on-screen arc, near-plane crossing, stable allocation and actual addon picking.

The actual combined V3.5 desktop passed ordered steps 1–25 at that exact source: editable working blocks, real pointer orbit and pan, reviewed local branch creation, spatial positioning/pinning, typed relationship creation/inspection, Universe/project/workspace travel, real Note editing, exact return and fresh-process restoration of identities/content/geometry/shapes/camera/history. Monotonic module-to-finish times were 69.135 seconds and 5.895 seconds; all test processes closed afterward. Startup/runtime console and renderer errors were zero. Independent audit verified 276 exact source blobs, retained original bundles, 15 PNGs, two WebMs and immutable closed SQLite. Evidence is retained privately under `expanded-1793645483429-cKIOiJ` and `expanded-1793645555876-9gmyNg`.

Root inspected the actual orbit still and decoded recording frames through the real pointer movement; filaments remain perceptible. This establishes the exercised native views, not all possible camera angles or artistic/performance acceptance. The separate 96-pose stress remains source coverage. The recorded DOM label selection artifact and bright project-star/chrome refinement remain visible follow-ups. Review J includes the fix, retains the owner's current profile, and is left open; foreground automation and the test windows are stopped.

K includes the current/history projection, durable response references and measured manifestation host (`9808dd5`, integrated `0de8eaa`/`ab1bfc6`) with immediate canonical local DTO presentation. Only decorative bridge opacity uses its new shared-MC body; ready content is never faded or delayed. Actual post-render sculpture bounds drive the viewport-fixed connection, one sizing owner replaces the old fixed minimum, and close/unavailable/dispose release owned state. Current checks pass 203 application, 140 Vela, 24 Personal Context and 49 auth-module tests, plus focused actual Core/SQLite and CP regressions and strict build. The new optical bridge and conversation-performance changes are present for owner review but have not received native appearance/performance acceptance. Actual auth/inference wiring remains pending independently.

K's package manifest SHA-256 is `974e7bf15f13cb35726d069562c561c1d3443a15808632ba54c6fae2e899b076`; the 472,178,690-byte payload and every declared source/build file were independently rehashed before launch. The bundled Node/backend completed 22 initial and five restart calls on a separate synthetic profile, with zero model execution. The owner's previous window closed gracefully; its closed database was backed up and verified before the same current profile was reopened in K. The launcher now points to K, which is left open without foreground test automation. This update is packaging/recovery evidence, not new full native or artistic acceptance.
