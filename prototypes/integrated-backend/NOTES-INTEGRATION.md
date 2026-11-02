# Canonical note recovery RPC

Core now constructs the released `NoteExperienceService` through `createCanonicalNoteHost`, using the same SQLite connection/kernel/parent atomic transaction and the actual released template host's local-owner resource authorization. There is no new note/draft implementation or competing content store. Canonical updates delegate to the existing DesktopState `content` path; renaming uses the canonical kernel resource version and title event.

`command('notes', {name,input})` is a typed `NoteRequest` union with an explicit switch:

| Name | Input | Result |
|---|---|---|
| readNote | canonical resource ID string | `NoteDocument` |
| saveNoteDraft | `{resourceId,expectedDraftVersion,baseResourceVersion,content}` | `NoteDraft` |
| commitNote | `{resourceId,expectedResourceVersion,expectedDraftVersion,content}` | `NoteDocument` |
| discardNoteDraft | `{resourceId,expectedDraftVersion}` | `NoteDocument` |
| renameNote | `{resourceId,expectedResourceVersion,title}` | `NoteDocument` |

The envelope is `{result,desktop?}`. Commit/rename include the canonical desktop snapshot after success; draft/read/discard return the exact released result. Parent's native preload admits only the public `notes` family, with no reflective invocation or new authorization channel.

Recovery draft writes/read/discard remain available while a provider is active. Canonical commit/rename honor the existing busy fence. Thus an editor can persist recovery text without waiting for a model; it should serialize/await each returned draft revision, then retry a blocked canonical commit after the actual execution stops. Competing draft/canonical versions fail instead of silently rebasing or overwriting newer text. Archive/access denial preserves recovery data without exposing it.

The source module owns monotonic recovery revisions, the 100,000-byte content limit, 8,192-resource retention bound and 32 MiB aggregate recovery bound. Core does not duplicate or alter those policies. A failed canonical mutation rolls back content/version and leaves the actual recovery draft intact.

Focused notes + library integration: **8/8 tests passed** (four notes and four library scenarios), including restart recovery, canonical commit, competing-editor conflicts, rollback after an injected post-mutation failure, rename/archive behavior, and recovery during a clearly synthetic pending fixture turn. The full integrated-backend TypeScript check passed with zero diagnostics after the Universal owner's tagged-subject correction. No real model/provider turn, native application window or network request ran. Actual editor/native interrupted-save acceptance remains parent-owned: these source tests do not claim keystrokes that never reached the host can survive process termination.
