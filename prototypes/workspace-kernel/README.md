# Aetherwake workspace resource kernel prototype

An isolated, synthetic-data persistence experiment for Aerynth. This is **not** a production database decision or a complete application service. It implements a small typed TypeScript API over SQLite using Node 24's built-in `node:sqlite`, with no package installation.

## Run

Prerequisite: Node 24 or newer with `node:sqlite` and TypeScript type stripping. Tested on Node 24.18.0 on Windows.

```powershell
cd prototypes/workspace-kernel
npm test
npm run demo
```

`demo.mts` creates only synthetic content in a temporary database, closes the process-level connection, reopens the file with `openExisting`, asserts the same identities, relationships and layouts, prints `PASS`, and removes the temporary directory. `npm test` uses independent temporary databases. No database or cache is committed.

## Ownership and data boundaries

| Table | Owns | Does not own |
|---|---|---|
| `projects` | Project identity and metadata | Resources and workspaces merely associated with it |
| `workspaces` | Workspace identity and metadata | Resource contents |
| `resources` | Canonical resource identity, title, kind, lifecycle | Visual placement or external provider content |
| `notes`, `conversation_refs` | Aerynth note text and a local conversation catalog pointer, respectively | Provider transcript or live backend state |
| `blocks` | One visual reference to a resource in one workspace, with position and size | Canonical resource data |
| `workspace_layouts` | Workspace layout mode and viewport metadata | Content of displayed resources |
| `collections`, `collection_members` | Group identity and memberships | Duplicate resource content |
| `relationships` | Directed, typed links and provenance (`user`, `inferred`, `imported`) | Permission grants or transitive content access |
| `external_provider_refs` | Namespaced provider identity mapping and verification state | Provider-owned data or deletion authority |
| `change_events` | Local mutation history with correlation and origin | Complete event sourcing, upstream event capture, or replayable state |

The same `resources.id` can appear in multiple `blocks` and collections. `moveBlock` updates its workspace reference only. A conversation can be created without a project or block. Provider IDs are unique within `(provider, namespace, external_id)` and never replace the local resource ID. An association does not confer access; authorization is a future service boundary.

## API and lifecycle

`WorkspaceKernel.open(path)` initializes a new database or migrates an existing one. `openExisting(path)` fails if the expected file is absent, avoiding an accidental empty replacement. `close()` releases it. Methods expose typed domain commands and metadata reads; callers do not need SQL. `KernelError.code` distinguishes `INVALID`, `NOT_FOUND`, `CONFLICT`, `INTEGRITY`, and `STORAGE`.

Projects, workspaces and collections can be created, renamed, archived, restored and deleted. Resources can be created as notes or conversation references, edited (note content), archived, restored and deleted. Blocks can be attached, moved, rearranged and detached. Relationships, collection membership and external refs have add and remove operations. Deletion requires the parent to be archived and unreferenced; it refuses to orphan blocks, resources, edges or memberships. Removing a visual block never removes its resource. Archive changes visibility in default metadata search, but retains underlying content and links. There is no automatic purge.

Mutations use `BEGIN IMMEDIATE` transactions and write a local change event in the same transaction for the main resource/project/workspace/collection operations. Version-bearing records require an `expectedVersion` on modifications to detect stale callers. Layout save checks the layout and all included block versions, so a late conflict rolls back all placements. Deletes retain minimal event metadata (`entity_kind`, `entity_id`) while foreign keys to deleted resource content become null. The event log contains IDs, resource version, UTC ISO timestamp, origin, correlation ID, type and schema version. This is **change history, not authoritative event sourcing**: it cannot reconstruct note content or absent upstream actions, and its event time is local record time, not provider event time.

`backupTo(path)` uses SQLite's online backup facility, then opens and checks the copy. Restoration is opening a valid backup at the selected location. This prototype does not manage backup retention, encryption, permissions, revocation, or synchronization. Store real user data only after those policies and controls exist.

## Schema and migration

The authoritative SQL is in `migrations/001-initial.sql` and `migrations/002-external-refs.sql`. The singleton `app_schema_version` table identifies the application schema. Each upgrade runs in its own transaction, and startup rejects unknown future versions, unrecognized tables without a version, SQLite corruption, broken foreign keys, and missing note/conversation/layout subtype rows. SQLite foreign keys are enabled on every connection. Existing v1 databases migrate to v2; migration failure rolls back without advancing the version. There is no downgrade migration; restore a verified pre-migration backup if downgrade is needed.

## SQLite candidate assessment

SQLite fits this experiment: one portable local file, transactional updates, foreign keys, indices, online backup, and no server or ORM. The tests demonstrate these properties for small synthetic fixtures only. It is **not selected for production**. Open questions include multi-process writer contention, long-running synchronous calls blocking an app thread, encryption and key management, large histories and search scale, schema compatibility across shipped versions, reliable backup policy, and cross-device sync. Node's built-in SQLite API should also be reviewed for stability and support on target runtime versions. IndexedDB or a separate storage service remain possible alternatives; compare representative workloads and operational constraints in an ADR before final selection.

## Integration recommendations

1. Keep this kernel behind a service boundary; move database calls off the UI/render thread. Preserve `Resource` IDs across windows and providers, and expose explicit version/conflict results.
2. Introduce scoped authorization, data classification, retention, and deletion policy before real notes or chats are stored. Keep the provider adapter responsible for transcript retrieval and upstream deletion/status reconciliation.
3. Give Intelligence Streams a distinct ingestion pipeline and event envelope. This local change history may contribute observed application mutations, but cannot stand in for complete agent/provider observability or replay.
4. Add schema contracts, migration snapshots from shipped versions, fault injection, large-data benchmarks, search indexing, backup/restore policy, and platform tests before integrating into `src/`.
5. Record an ADR after comparative evidence. Specialist Charters 03, 04, 07, 08, 09, 11, 14, 15 and 16 were consulted as **advisory published drafts**; the Constitution is binding. The repository's V2 context command errored during this task, so targeted charter sections were read directly after deterministic routing.

See [VERIFICATION.md](VERIFICATION.md) for executed checks and limits.
