# A3 storage and retrieval baseline

Program A change based on `7747e8c723b5961d6edfd6fb75758a50e87e7ac6`. The integrated desktop opens one `aerynth.sqlite` per profile through [Electron main](../../prototypes/visual-experience/cinematic-v3/native/desktop-main.cjs) and the [workspace kernel](../../prototypes/workspace-kernel/kernel.mts). The kernel applies numbered migrations, enables foreign keys and exposes an online backup operation. Core owns the writer fence and the coordinated savepoint. The integrated profile uses the DELETE rollback journal and a 128 MiB main-file ceiling.

| Storage owner | Schema and access paths | Retention and recovery |
| --- | --- | --- |
| [Workspace kernel](../../prototypes/workspace-kernel/migrations) and [workspace engine](../../prototypes/workspace-engine/migrations) | Core resources, projects, workspaces, blocks, subjects, external references, relationships, collections, changes, geometry and presence. Key indexes cover block resource and subject, external resource references and change entity. | Numbered migrations, archive/restore with source versions and SQLite backup. Engine owns layout history. |
| [Desktop](../../prototypes/integrated-backend/src/desktop.mts) and [workspace recovery](../../prototypes/integrated-backend/src/workspace-recovery.mts) | Desktop session, block and resource metadata, view state, checkpoints, undo and recovery actions. | Rehydrate and apply recovery through Core. Renderer cache is disposable. |
| [Conversation graph](../../prototypes/connected-conversations/src/graph.ts), [Core](../../prototypes/integrated-backend/src/core.mts) and [ConversationProduct](../../prototypes/conversation-product/src/service.mts) | Core persists graph and execution bindings in `integration_state`. The graph owns message and ancestry IDs. ConversationProduct owns conversation presentation, drafts, access metadata and product operations. | Bounded context windows and lookup budgets are independent of durable graph retention. Recover bindings and reconcile unresolved execution from Core. |
| [Intelligence journal](../../prototypes/integrated-backend/src/core.mts) | Cursor primary key, unique dedupe identity, partial mission-correlation index and durable latest cursor. | Append and trim share one savepoint. Replay returns global scan bounds and scope-filtered projections for the renderer. |
| [MissionService](../../prototypes/integrated-backend/src/mission-service.mts), [publication](../../prototypes/integrated-backend/src/mission-publication.mts), [team library](../../prototypes/integrated-backend/src/mission-teams.mts) and [conversation bridge](../../prototypes/integrated-backend/src/mission-conversation.mts) | Mission IDs, request digests, scope, active/pending state, attempts, source receipts and lifecycle outboxes. Indexes cover pending, scope and linked workroom. | Startup pauses queued work and reconciles previously active attempts. Outbox rows and visible Stream events have distinct publication and readback duties. |
| [VelaService](../../prototypes/vela-core/src/service.mts), [Personal Context](../../prototypes/personal-context/src/service.mts) and [folder sources](../../prototypes/integrated-backend/src/folder-sources.mts) | Request and action state, encrypted context revisions and dependencies, selected-resource versions and folder grant identity. The history lexical index is transient. | Provider disclosure fences recheck source version and authorization. Encrypted revisions and capacity limits have their own owner. |
| [Product domains](../../prototypes) | Agent, checklist, timer, task, timeline, note and block/template services own their payloads and operation receipts under kernel resource identities. | Per-domain migrations and idempotency keys preserve product writes. The [timer delivery bridge](../../prototypes/integrated-backend/src/timer-domain.mts) retains separate delivery receipts. |
| [OpenAI provider](../../prototypes/openai-provider), [API runtime](../../prototypes/integrated-backend/src/vela-api-runtime.mts), [voice](../../prototypes/integrated-backend/src/vela-voice-runtime.mts), [wake](../../prototypes/integrated-backend/src/vela-wake-runtime.mts), [tool workflows](../../prototypes/integrated-backend/src/vela-tool-workflows.mts) and [file edits](../../prototypes/integrated-backend/src/mission-file-edits.mts) | Provider connection metadata, usage and admission, execution receipts, permissions, voice/wake state and native effect custody. Provider-native history and protected secrets have separate external/native owners. | Unknown effects retain their original identity. Do not use restored SQLite as proof that an external effect can be retried. |

## Journal retention change

The previous append scanned the table and constructed a membership list for the newest N cursors. The new statement finds the Nth newest existing cursor and deletes rows below it by integer primary-key range. Ranking the existing rows preserves the newest N across ignored-insert gaps. Below capacity the scalar subquery returns NULL and no row qualifies. No schema migration is required. Rolling back the code restores the prior deletion statement and reads the same database format. Cursor order, dedupe, recovery events and renderer authorization continue through their existing owners.

Run `node prototypes/integrated-backend/src/journal-retention-benchmark.mjs` for a synthetic, in-memory SQLite comparison with gapped cursors and exact row assertions. On Windows with Node 24.18.0, 20 warmups and 100 measured deletes per configuration, p95 at 100, 10,000 and 100,000 retained rows was 0.087, 16.70 and 244.48 ms for the prior query and 0.009, 0.069 and 1.34 ms for the range query. This single comparison measures pruning SQL, including walking the rank, and excludes provider, disk commit, renderer and full application latency.

Run `node --test prototypes/integrated-backend/tests/transaction-coordination.test.mts` for the integrated journal checks. The retention regression verifies the range query plan, sparse cursor retention, authorized renderer bounds and restart with the normal `stream/reopened` event. The suite includes interruption before and after SQLite release.

## Disk-backed continuity and retrieval

Run `node prototypes/integrated-backend/src/transaction-benchmark.mjs` for the existing disk-backed mutation, restart and writer-fence workload. The Windows run completed all seven synthetic profiles with four warmups and 24 measured samples per operation. Examples from that run follow. Peak RSS is cumulative across the process. Other host activity overlapped this run, so the latency numbers describe this run and should not be used as quiet-host thresholds.

| Profile | SQLite bytes before and after workload | Reopen and snapshot p95 | Process peak RSS |
| --- | ---: | ---: | ---: |
| Almost empty | 831,488 → 2,949,120 | 495 ms | 352,352 KiB |
| Conversation heavy | 5,259,264 → 7,405,568 | 3,915 ms | 566,620 KiB |
| Event heavy | 1,183,744 → 3,330,048 | 393 ms | 576,804 KiB |
| Near snapshot limit | 14,761,984 → 17,035,264 | 1,481 ms | 928,496 KiB |

Run `node prototypes/integrated-backend/src/transaction-benchmark.mjs event-heavy` to repeat the indexed canonical resource read and authorized 250-row renderer replay probes. In a second event-heavy run, the resource read measured median 3.00 ms and p95 17.63 ms. Renderer replay measured median 11.46 ms and p95 32.67 ms. Reopen and snapshot p95 was 1,678 ms, compared with 393 ms on the earlier run. The difference illustrates the run-to-run variance under ambient load. These probes use the existing owner APIs and do not measure native IPC or GPU rendering.

Pass `--sample-allocations` to add eight V8 sampling runs per phase at a 32 KiB sampling interval. The default timing pass now splits in-process Core hydration from the first snapshot. Timing is collected before profiling starts. The separate allocation pass sums the byte sizes returned by the V8 sampler, including samples from objects collected during each phase. Those numbers cover JavaScript heap allocation samples. SQLite and other native allocations, retained heap size, cold process startup, and desktop presentation are outside this measurement.

| Windows disk-backed profile | Hydration p95 | First snapshot p95 | Indexed read p95 | Replay p95 | Median sampled bytes, hydration / snapshot / replay |
| --- | ---: | ---: | ---: | ---: | ---: |
| Event heavy, repeat 1 | 811.75 ms | 18.71 ms | 17.44 ms | 59.28 ms | 33,202,800 / 1,344,720 / 560,584 |
| Event heavy, repeat 2 | 571.23 ms | 16.18 ms | 14.03 ms | 15.56 ms | 32,611,932 / 1,394,120 / 559,648 |
| Conversation heavy | 987.12 ms | 35.11 ms | 7.45 ms | 7.38 ms | 94,001,524 / 3,287,752 / 395,160 |

Both event-heavy runs used fresh fixtures. The database grew from 1,183,744 to 3,330,048 bytes and the journal from 525 to 637 rows before the reopen cycles. Replay latency varied under ambient host load despite matching fixture sizes and similar sampled allocation medians. The conversation-heavy fixture grew from 5,259,264 to 7,405,568 bytes and from 25 to 137 journal rows. Its larger conversation graph had higher sampled hydration and snapshot allocations than the event-heavy fixtures.

The backup regression uses the existing SQLite online backup and opens the copy through Core. It checks the exact conversation, message, event ID and cursor, and verifies that a source appended after backup is absent from the restored copy.

The [Personal Context suite](../../prototypes/personal-context/tests/service.test.mts) also restores an online backup with the existing in-memory AES-GCM test key. The restored original, corrected fact and supersession link keep their exact identities and provenance. The original content, fact bodies and key are absent from the backup bytes. A different provider requires a fresh preview and disclosure check. A changed project revision, a denied disclosure or a wrong key each fails closed. Deleting the source and its dependent facts in the live database leaves a previously created backup recoverable, so recovery operators must account for deletion and retention before reusing an old copy. All 25 suite tests passed on Windows.

The [native protected backup probe](../../prototypes/visual-experience/cinematic-v3/native/protected-backup-verify.cjs) also exercises the existing Vela API credential owner, native-host protocol, and Electron protected-storage broker. On Windows with Electron 45.2.1, one process sealed a synthetic credential, backed up the database, and disconnected the source. A second Electron process under the same OS account recovered the original version and authorization boundary from the 159,744-byte backup. The synthetic bearer was absent from the raw backup bytes and the public connection view. Opening the same backup with native custody unavailable denied credential resolution. The probe uses no provider network calls.

From the repository root, run the following with the installed Electron executable and a fresh scratch directory.

```powershell
$scratch = (New-Item -ItemType Directory (Join-Path ([IO.Path]::GetTempPath()) ("aerynth-native-backup-" + [guid]::NewGuid()))).FullName
$probe = 'prototypes/visual-experience/cinematic-v3/native/protected-backup-verify.cjs'
$electron = './prototypes/visual-experience/cinematic-v3/node_modules/electron/dist/electron.exe'
& $electron $probe $scratch seed | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Native backup seed failed' }
& $electron $probe $scratch restore | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Native backup restore failed' }
```

Run `node prototypes/vela-core/tests/mission-context-evaluation.mts` for the frozen starter corpus. The current lexical compiler found five of six expected source IDs, including both conflicting records, and missed the paraphrase about the night shift. The fixture denied a superseded source and a restricted source at their owner boundary. It also verified rejection of an old policy-stamped package, reconstruction with the same source identities under a new stamp and denial after revocation. Two 150-sample runs measured p50 0.20–0.33 ms and p95 1.53–16.46 ms under concurrent host load. The fixture adapter supplies its own authorization and policy stamps. These results establish a regression baseline for the compiler and proof checks. Live provider continuity and independently labeled semantic quality require separate evidence.

## Remaining acceptance evidence

The current lexical baseline uses [bounded history retrieval](../../prototypes/vela-core/src/history-retrieval.mts) and scoped [mission context](../../prototypes/vela-core/src/mission-context.mts). The [semantic CIE specification](../specifications/CIE-SEMANTIC-INTERPRETATION-AND-EVIDENCE-RETRIEVAL.md) requires an independently labeled split for paraphrase, conflict, correction, permissions, revocation and provider continuity. A3 still needs that comparative evaluation and a qualified native profile. The repeated disk-backed baselines characterize the synthetic profiles under ambient load. The native backup probe covers the integrated Vela API credential schema and same-account Windows custody. Personal Context recovery uses its synthetic host and crypto adapter. Production Personal Context host custody, full-profile protection and portability across OS accounts require separate evidence. No independent CIE database or transcript copy is introduced.
