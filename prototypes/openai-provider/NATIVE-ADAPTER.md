# Native storage and callback integration

These adapters are source modules. Tests use fresh synthetic canonical SQLite files, separate owned Node processes, actual local HTTP sockets, and a synthetic AES stand-in for OS encryption. They do not establish actual safeStorage protection, user OAuth, account eligibility, provider inference, application restart or native UI acceptance.

## Existing canonical database

Root's migration owner applies `NATIVE_AUTH_SCHEMA_SQL` to the **existing canonical SQLite database** through its existing transaction connection. `SqliteNativeVault` never opens a database, migrates autonomously or closes the supplied connection. Pass the same DB handle and a synchronous transaction callback, such as the kernel's `withTransaction`; the adapter verifies connection identity before every callback. No separate credential, conversation, resource or execution database is introduced.

Only registration ID, revision, installation host ID, issued client ID and lock metadata are plaintext. The complete private registration, including identity, all tokens, scopes and nonce, is one encrypted envelope. Its route, format and metadata must match the row when decrypted. `UNIQUE(host_id,client_id)` prevents separate configurations from claiming the same issued registration, including incomplete identity-null registrations. This adapter stores **ChatGPT-plan registrations only**; Vela's separately configured API route is not added or inferred here.

Supply `createElectronSecretProtector(safeStorage, process.platform)` from the trusted main process after app readiness, through a private authenticated main/backend channel. It uses the current asynchronous API and rejects unavailable encryption, Linux `basic_text`/unknown backends and unhandled key-rotation requirements. It never enables plaintext encryption or substitutes a password. Ciphertext may only be written after protection succeeds. Windows DPAPI protects against other OS users; it does not protect against all software running as the same OS user. Platform/backend and signing qualifications still require actual native acceptance. [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).

`vault` also implements `NativeHostIdentityStore`; pass that same instance as the session manager's `host`. Its random installation host ID lives in the same canonical database and is reused. There are no account names or token hints in `lockStatus`.

## Cross-process exclusion and recovery

`withLock` acquires a committed SQLite lease with a random owner and monotonically increasing fence. Short transactions acquire, renew, validate CAS and release; no transaction stays open across crypto, browser, callback or network waits. The local async context only carries the current owner/fence, while SQLite decides authority. CAS requires the current, unexpired matching lease plus exact registration revision. A delayed previous holder cannot write after fence changes. Lock wait, lease duration, operation duration, record size and quotas are bounded. Existing connection busy-timeout policy remains Root-owned; this module makes no UI-latency claim. [SQLite transaction behavior](https://www.sqlite.org/lang_transaction.html), [Node SQLite](https://nodejs.org/download/release/v24.18.0/docs/api/sqlite.html).

Use `vault.guardedFetch(nativeFetch)` **for the auth manager only**. It permits fixed public discovery/JWKS reads outside a lease, and requires a current lease for token/revocation operations. During a lease it composes the fetch signal with lock-loss cancellation. Do not install it as the Responses inference transport, which uses its separate native dispatch authorization.

An expired/unreleased lease is quarantined: no automatic takeover, refresh retry or old-token read. `lockStatus(registrationId)` returns only `state`, `fence`, `registrationVersion`. `recoverAbandoned(id, expectedFence, expectedVersion)` requires an injected native consequential authorization callback. It rechecks the actual expired lease and current version before decrypting, clears token/inference authority, retains host/client identity mapping, increments the registration revision and lease fence atomically, then permits a fresh user-directed OAuth flow. No rollback of external token rotation is claimed. A process death, lost response, expired lease or failed rotated-token persistence can require user reauthorization. Recovery does not grant plan usage, change account ownership or activate an API billing fallback.

The Root callback must verify the genuine native sender, selected configuration and fresh user decision; renderer booleans or provider requests are not recovery authority. Unknown/stale/revoked native proof denies. There is no public renderer RPC in these files.

## Exact loopback flow

1. Native Root creates `createLoopbackListener()`; it binds only `127.0.0.1`, port zero, `/auth/callback`, with an opaque listener proof.
2. The session manager's native `assertListener` policy invokes `listener.assertBinding(binding)`. Root calls `prepareSignIn(selectedRegistrationId, listener.binding)` and keeps its authorization URL private.
3. Root extracts the state from that same private authorization URL and calls `listener.bindAttempt(attemptId,state)` **before** opening the user-approved system browser. This module never opens a browser.
4. `waitCallback(attemptId)` returns only one matching private callback. Exact Host, GET method, path, state, URL/header/request/socket/time bounds apply. Responses contain fixed text only; no callback URL, code, query, token or account data is logged or reflected.
5. Root calls `completeCallback(attemptId, callbackUrl, listener.binding)` and closes the listener in `finally`. Proof remains valid for this single returned callback until close/expiry; the auth manager separately consumes the pending OAuth state. Wrong-state requests do not consume the valid attempt. Cancel, close, expiry and request-budget exhaustion reject waiters and close sockets.

Tests verify independent-process lease contention, simultaneous exact-version CAS, process-death quarantine, recovery, rollback, durable fixture reopening, uniqueness, encryption rejection, cipher binding and local callback lifecycle. The synthetic encryption test proves that plaintext markers are absent from fixture bytes; it is not an OS-vault security proof. No user profile, credential, browser, external authorization endpoint or model request is accessed by these tests.
