# Aerynth integrated backend 0.1

Implemented vertical slice for Mission 01: ordinary synthetic conversation A → reviewed context → genuine local Codex conversation B → recorded result → reviewed ordinary synthetic conversation C → close/reopen with stable application identities and replay history.

This is an integration prototype, not a production release or an accepted permanent architecture. SQLite, graph storage, IPC and these 0.1 contracts remain candidates. See [compatibility and exact sources](COMPATIBILITY.md), [UI contract](UI-CONTRACT.md), [verification](VERIFICATION.md), and [security/recovery limits](SECURITY.md).

## Run

Use Node **24.18 or later**. From `prototypes/integrated-backend`:

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm test
npm run demo
npm run benchmark
```

Before any installation/build/demo, run the host's ReserveGuard through Windows PowerShell with a bounded estimate. This package budgets 512 MiB C: for checkout/install/database/journal and 0 D:. Each database is capped at 128 MiB, extension state at 8 MiB, messages at 64 KiB, IPC commands at 256 KiB, pending commands at 64 and journal replay pages at 1,000. A demo creates an ignored `runtime/fixture-<timestamp>/backend.sqlite`; it retains synthetic evidence rather than deleting it on exit.

For an authorized genuine smoke test using existing local Codex authentication:

```powershell
# Optional: full path to the installed native codex executable, when PATH
# resolves a PowerShell/npm shim that child_process.spawn cannot execute.
$env:AERYNTH_CODEX_EXE = '<installed codex.exe>'
npm run smoke
```

The live test uses synthetic text, read-only sandbox, `approvalPolicy: never`, and a request to return `INTEGRATION_OK` without tools or file inspection. It preserves Codex's base identity, configuration and normal instruction loading: no base/developer instructions or persona are supplied. It opens a new native thread; it never mutates another chat's thread. The second ordinary conversation is a labeled deterministic mock; ordinary ChatGPT account history is unavailable. All native command/file approvals fail closed. Configured native services/hooks may initialize; a read-only sandbox does not claim to isolate every configured external integration.

`demo`/`smoke` return only aggregate safe receipts. They verify persisted native item types and the exact synthetic reply after backend restart, and never equate provider completion with task verification. An unavailable provider makes the demo fail; it does not fall back to simulated Codex.

Recheck an existing synthetic live database without another inference turn with `node src/reopen.mts runtime/live-<timestamp>/backend.sqlite --live` (same executable environment setting). For a fixture database omit `--live`.

## Application boundary

```ts
import { Backend } from './src/service.mts';
const backend = new Backend({
  path: '/authorized/local/synthetic.sqlite',
  contentPolicy: 'synthetic-only', provider: 'fixture'
});
const chat = await backend.call('createConversation', {
  title: 'Synthetic example', commandId: 'create-example'
});
const stop = backend.subscribe(event => console.log(event.type));
const page = await backend.call('replay', { after: 0, limit: 100 });
stop();
await backend.close();
```

`Backend` runs the kernel, graph and event persistence in a dedicated worker. Callers use typed async commands from [contracts.mts](src/contracts.mts). No database handle or credentials reach a renderer. The current caller must be a trusted local controller; `authorized: true` is its explicit assertion, not an authentication system. One worker owns one database. Multiple active backend workers over the same database are unsupported and must be prevented by the embedding host. An optimistic stored-state comparison also rejects stale writers and rolls back their resource changes rather than overwriting another worker's graph.

The canonical public conversation ID is the kernel resource UUID. Graph-local IDs are an explicit internal map and must be resolved before use in UI/resource APIs. App message IDs remain stable within their database. Native thread/turn/session/instance/account references remain separate; a session ID stays null when no separate native session handle is supplied. Workspace changes, block duplication and provider selection do not replace a resource UUID. A branch deliberately creates a new resource with ancestry.

## Storage and migration

Kernel tables hold projects, workspaces, resources, blocks, relationships and external references. Integration-owned tables hold a validated graph snapshot, revision/approval/execution/binding metadata, bounded command receipts and an indexed append-only event journal subject to explicit retention. Kernel and graph mutations share a savepoint transaction. Graph state is restored in memory on rollback. Dispatch is committed before remote RPC; remote operations are not transactionally atomic with SQLite.

Kernel schema v1→v2 migrations remain owned by its existing migration scripts. Integration schema 1 is additive and independently versioned; unsupported future schemas/corruption fail closed without resetting state. There is no automatic destructive migration or downgrade. Removing this integration package does not alter the original PRs; retain a database backup before format changes. Kernel backup includes extension tables because they share the database. A production migration/retention/export strategy still requires an accepted design.

Only two prototype source edits are necessary: kernel `withTransaction` exposes composable synchronous savepoints to the trusted worker; graph `ContextItem.sensitivity` declares a field its implementation already stores/checks. Neither change touches visuals or provider fidelity internals.
