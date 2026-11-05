import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { SiwcSessionManager, ISSUER, DISCOVERY_ENDPOINT, AUTHORIZATION_ENDPOINT, TOKEN_ENDPOINT, JWKS_ENDPOINT, RESOURCE } from '../auth.mts';
import type { AuthOptions, CallbackBinding, NativeCredentialVault, NativeHostIdentityStore, PrivateRegistration } from '../contracts.mts';
const keys = await generateKeyPair('RS256'), jwk = { ...await exportJWK(keys.publicKey), kid: 'offline-rsa-key', use: 'sig', alg: 'RS256' };
const initialNow = 1793630000000;
const binding: CallbackBinding = { id: 'native-listener-proof', redirectUri: 'http://127.0.0.1:45931/auth/callback' };
const hostId = 'urn:uuid:aa6c2d48-875e-40d6-8f52-a09e461a9787';
const clientId = 'oaiapp_offline_fixture';
/** Test double only: does NOT establish production OS-vault or cross-process-lock correctness. */
class Vault implements NativeCredentialVault {
    data = new Map<string, PrivateRegistration>();
    locks = 0;
    writes = 0;
    maxHeld = 0;
    private held = 0;
    private tails = new Map<string, Promise<void>>();
    failNext = false;
    async read(id: string) { return structuredClone(this.data.get(id) ?? null); }
    async compareAndSwap(id: string, version: number | null, next: PrivateRegistration) { if (this.failNext) {
        this.failNext = false;
        throw Error('private-storage-synthetic-secret');
    } assert.equal(this.data.get(id)?.version ?? null, version); assert.equal(next.registrationId, id); assert.equal(next.version, (version ?? 0) + 1); this.data.set(id, structuredClone(next)); this.writes++; }
    async withLock<T>(id: string, work: () => Promise<T>): Promise<T> { this.locks++; const previous = this.tails.get(id) ?? Promise.resolve(); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); const tail = previous.then(() => gate); this.tails.set(id, tail); await previous; this.held++; this.maxHeld = Math.max(this.maxHeld, this.held); try {
        return await work();
    }
    finally {
        this.held--;
        release();
        if (this.tails.get(id) === tail)
            this.tails.delete(id);
    } }
}
type Override = (url: string, init: RequestInit | undefined) => Promise<Response | null>;
function fixture(vault = new Vault()) {
    let now = initialNow, nonce = '', host: string | undefined = undefined, over: Override | undefined;
    let authorizeCount = 0, listenerCount = 0;
    const calls: {
        url: string;
        init: RequestInit | undefined;
    }[] = [];
    const hostStore: NativeHostIdentityStore = { getOrCreate: async (make) => { host ??= make(); return host; } };
    const token = async (changes: Record<string, unknown> = {}, header: Record<string, unknown> = {}) => new SignJWT({ iss: ISSUER, aud: clientId, sub: 'subject-fixture', nonce, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 3600, ...changes }).setProtectedHeader({ alg: 'RS256', kid: jwk.kid, ...header }).sign(keys.privateKey);
    const options: AuthOptions = { vault, host: hostStore, now: () => now, policy: { assertListener: async (value) => { listenerCount++; assert.deepEqual(value, binding); }, authorizeNewRegistration: async () => { authorizeCount++; return { kind: 'local-personal-project', scope: 'current-owner-local-installation', decisionRef: 'owner-local-only' }; } }, fetch: async (url, init) => {
            const location = String(url);
            calls.push({ url: location, init });
            assert.equal(init?.redirect, 'error');
            const overridden = await over?.(location, init);
            if (overridden)
                return overridden;
            if (location === DISCOVERY_ENDPOINT)
                return Response.json({ issuer: ISSUER, authorization_endpoint: AUTHORIZATION_ENDPOINT, token_endpoint: TOKEN_ENDPOINT, jwks_uri: JWKS_ENDPOINT, id_token_signing_alg_values_supported: ['RS256'], revocation_endpoint: ISSUER + '/api/accounts/oauth/revoke' });
            if (location === JWKS_ENDPOINT)
                return Response.json({ keys: [jwk] });
            if (location === TOKEN_ENDPOINT) {
                const body = new URLSearchParams(String(init?.body));
                assert.equal(body.get('client_id'), clientId);
                assert.equal(body.get('resource'), RESOURCE);
                assert.equal(body.has('client_secret'), false);
                const refresh = body.get('grant_type') === 'refresh_token';
                if (refresh) {
                    assert.equal(body.has('scope'), false);
                    nonce = vault.data.get('profile')?.nonce ?? nonce;
                }
                return Response.json({ access_token: refresh ? 'synthetic-access-rotated' : 'synthetic-access', refresh_token: refresh ? 'synthetic-refresh-rotated' : 'synthetic-refresh', id_token: await token(), token_type: 'Bearer', expires_in: 3600, scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct' });
            }
            if (location === ISSUER + '/api/accounts/oauth/revoke')
                return new Response(null, { status: 200 });
            throw Error('unexpected offline request');
        } };
    const manager = new SiwcSessionManager(options);
    const begin = async (id = 'profile') => { const start = await manager.prepareSignIn(id, binding); const url = new URL(start.authorizationUrl); nonce = url.searchParams.get('nonce') ?? ''; return { start, url }; };
    const callback = (start: {
        authorizationUrl: string;
    }, fields: Record<string, string> = {}) => { const original = new URL(start.authorizationUrl); return binding.redirectUri + '?' + new URLSearchParams({ state: original.searchParams.get('state')!, code: 'synthetic-code', client_id: clientId, ...fields }); };
    const connect = async () => { const { start, url } = await begin(); return { status: await manager.completeCallback(start.attemptId, callback(start), binding), start, url }; };
    return { manager, options, vault, begin, callback, connect, token, calls, setNonce: (value: string) => { nonce = value; }, setOverride: (value: Override | undefined) => { over = value; }, setNow: (value: number) => { now = value; }, counts: () => ({ authorizeCount, listenerCount }), setHost: (value: string) => { host = value; } };
}
test('offline RSA: local-personal bootstrap PKCE/state/nonce, native listener, issued client saved before exchange, no secrets in status', async () => {
    const f = fixture();
    let verifier = '';
    f.setOverride(async (url, init) => { if (url === TOKEN_ENDPOINT) {
        const pending = f.vault.data.get('profile');
        assert.equal(pending?.clientId, clientId);
        assert.equal(pending?.identity, null);
        assert.equal(pending?.enabled, false);
        assert.equal(pending?.accessToken, null);
        verifier = new URLSearchParams(String(init?.body)).get('code_verifier') ?? '';
    } return null; });
    const { start, url } = await f.begin();
    assert.equal(url.origin + url.pathname, AUTHORIZATION_ENDPOINT);
    assert.equal(url.searchParams.get('client_id'), 'dynamic_agent_client');
    assert.equal(url.searchParams.get('agent_name_hint'), 'Aerynth');
    assert.match(url.searchParams.get('ext_agent_host_id') ?? '', /^urn:uuid:/);
    assert.equal(url.searchParams.get('resource'), RESOURCE);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.notEqual(url.searchParams.get('state'), url.searchParams.get('nonce'));
    const status = await f.manager.completeCallback(start.attemptId, f.callback(start, { scope: 'openid' }), binding);
    assert.equal(status.state, 'ready');
    assert.equal(status.planUsageEnabled, true);
    assert.equal(status.version, 2);
    assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(verifier).digest('base64url'));
    assert.ok(!JSON.stringify(status).includes('synthetic'));
    assert.equal(status.nativeAccountHistory, false);
    assert.equal(status.nativeAccountMemory, false);
    assert.deepEqual(f.counts(), { authorizeCount: 1, listenerCount: 2 });
});
test('offline: no inference before explicit native eligibility/listener proof; no false OSS category', async () => {
    const f = fixture();
    f.options.policy.authorizeNewRegistration = async () => ({ kind: 'approved-open-source' } as never);
    await assert.rejects(f.manager.prepareSignIn('profile', binding), /local_registration_not_authorized/);
    assert.equal(f.calls.length, 0);
    assert.equal(f.vault.writes, 0);
    const g = fixture();
    g.options.policy.assertListener = async () => { throw Error('secret listener failure'); };
    await assert.rejects(g.manager.prepareSignIn('profile', binding), error => error instanceof Error && error.message === 'native_auth_storage_or_policy_unavailable');
    assert.equal(g.calls.length, 0);
});
test('offline: loopback exact path/host/port and callback proof cannot be renderer substitutions', async () => {
    for (const uri of ['https://127.0.0.1:45931/auth/callback', 'http://localhost:45931/auth/callback', 'http://127.0.0.1:45931/callback', 'http://user@127.0.0.1:45931/auth/callback', 'http://127.0.0.1/auth/callback', 'http://127.0.0.1:45931/auth/callback?x=y']) {
        const f = fixture();
        await assert.rejects(f.manager.prepareSignIn('profile', { ...binding, redirectUri: uri }), /invalid_callback_binding/);
        assert.equal(f.calls.length, 0);
    }
    const f = fixture(), { start } = await f.begin();
    await assert.rejects(f.manager.completeCallback(start.attemptId, f.callback(start).replace(':45931', ':45932'), binding), /callback_binding_mismatch/);
    await assert.rejects(f.manager.completeCallback(start.attemptId, f.callback(start), { ...binding, id: 'foreign-proof' }), /callback_binding_mismatch/);
    assert.equal(f.calls.filter(call => call.url === TOKEN_ENDPOINT).length, 0);
});
test('offline: state, duplicate parameters, access denied and replay reject before token exchange', async () => {
    const f = fixture(), { start } = await f.begin();
    await assert.rejects(f.manager.completeCallback(start.attemptId, f.callback(start, { state: 'wrong' }), binding), /oauth_state_mismatch/);
    await assert.rejects(f.manager.completeCallback(start.attemptId, f.callback(start) + '&state=duplicate', binding), /ambiguous_callback/);
    await assert.rejects(f.manager.completeCallback(start.attemptId, f.callback(start, { error: 'access_denied' }), binding), /authorization_denied/);
    await assert.rejects(f.manager.completeCallback(start.attemptId, f.callback(start), binding), /authorization_attempt_unavailable/);
    assert.equal(f.calls.filter(call => call.url === TOKEN_ENDPOINT).length, 0);
    assert.equal(f.vault.writes, 0);
});
test('offline: incomplete bootstrap and expired/cancelled attempts never become identities', async () => {
    const f = fixture(), { start } = await f.begin();
    const callback = new URL(f.callback(start));
    callback.searchParams.delete('client_id');
    await assert.rejects(f.manager.completeCallback(start.attemptId, callback.href, binding), /callback_client_mismatch/);
    assert.equal(f.vault.writes, 0);
    const g = fixture(), pending = await g.begin();
    g.setNow(initialNow + 300001);
    await assert.rejects(g.manager.completeCallback(pending.start.attemptId, g.callback(pending.start), binding), /authorization_attempt_unavailable/);
    const h = fixture(), cancelled = await h.begin();
    h.manager.cancelSignIn(cancelled.start.attemptId);
    await assert.rejects(h.manager.completeCallback(cancelled.start.attemptId, h.callback(cancelled.start), binding), /authorization_attempt_unavailable/);
});
test('offline: failed code exchange retains only issued mapping and retries require fresh browser attempt using issued ID', async () => {
    const f = fixture();
    f.setOverride(async (url) => url === TOKEN_ENDPOINT ? Response.json({ error: 'invalid_grant', error_description: 'secret code diagnostic' }, { status: 400 }) : null);
    const { start } = await f.begin();
    await assert.rejects(f.manager.completeCallback(start.attemptId, f.callback(start), binding), /invalid_grant/);
    const stored = f.vault.data.get('profile');
    assert.equal(stored?.identity, null);
    assert.equal(stored?.accessToken, null);
    assert.equal((await f.manager.status('profile')).state, 'disconnected');
    await assert.rejects(f.manager.resolvePlanCredential('profile', 1), /plan_credentials_unavailable/);
    const retry = await f.begin();
    assert.equal(retry.url.searchParams.get('client_id'), clientId);
    assert.equal(retry.url.searchParams.has('agent_name_hint'), false);
    assert.equal(f.counts().authorizeCount, 1);
    assert.equal(f.calls.filter(call => call.url === TOKEN_ENDPOINT).length, 1);
});
test('offline RSA: identity-only token response never borrows callback scope or allows inference', async () => {
    const f = fixture();
    f.setOverride(async (url) => url === TOKEN_ENDPOINT ? Response.json({ access_token: 'identity-only', id_token: await f.token(), token_type: 'Bearer', expires_in: 3600, scope: 'openid profile email' }) : null);
    const { start } = await f.begin();
    const status = await f.manager.completeCallback(start.attemptId, f.callback(start, { scope: 'chatgpt.tokens.use.direct' }), binding);
    assert.equal(status.state, 'identity-only');
    assert.equal(status.planUsageEnabled, false);
    await assert.rejects(f.manager.resolvePlanCredential('profile', 2), /plan_credentials_unavailable/);
});
test('offline RSA: signature, nonce, issuer, audience, expiration, future issue and authorized-party fences', async () => {
    const cases = [{ nonce: 'wrong' }, { iss: 'https://evil.example' }, { aud: 'another-client' }, { exp: Math.floor(initialNow / 1000) - 10 }, { iat: Math.floor(initialNow / 1000) + 60 }, { aud: [clientId, 'other'], azp: 'other' }];
    for (const change of cases) {
        const f = fixture();
        f.setOverride(async (url) => url === TOKEN_ENDPOINT ? Response.json({ access_token: 'secret', refresh_token: 'secret-refresh', id_token: await f.token(change), token_type: 'Bearer', expires_in: 3600, scope: 'openid offline_access chatgpt.tokens.use.direct' }) : null);
        const { start } = await f.begin();
        await assert.rejects(f.manager.completeCallback(start.attemptId, f.callback(start), binding));
        assert.equal((await f.manager.status('profile')).state, 'disconnected');
        assert.equal(f.vault.data.get('profile')?.accessToken, null);
    }
    const f = fixture();
    f.setOverride(async (url) => url === JWKS_ENDPOINT ? Response.json({ keys: [{ ...jwk, n: (jwk.n?.[0] === 's' ? 't' : 's') + jwk.n?.slice(1) }] }) : null);
    const { start } = await f.begin();
    await assert.rejects(f.manager.completeCallback(start.attemptId, f.callback(start), binding), /invalid_identity_token/);
});
test('offline RSA: JWT header URL/key injection and discovery endpoint redirects are not trusted', async () => {
    for (const header of [{ jku: 'https://evil.example/keys' }, { x5u: 'https://evil.example/cert' }, { jwk }]) {
        const f = fixture();
        f.setOverride(async (url) => url === TOKEN_ENDPOINT ? Response.json({ access_token: 'secret', refresh_token: 'refresh', id_token: await f.token({}, header), token_type: 'Bearer', expires_in: 3600, scope: 'openid offline_access chatgpt.tokens.use.direct' }) : null);
        const { start } = await f.begin();
        await assert.rejects(f.manager.completeCallback(start.attemptId, f.callback(start), binding), /unsupported_identity_header/);
        assert.equal(f.calls.filter(call => call.url === JWKS_ENDPOINT).length, 0);
    }
    const f = fixture();
    f.setOverride(async (url) => url === DISCOVERY_ENDPOINT ? Response.json({ issuer: ISSUER, authorization_endpoint: AUTHORIZATION_ENDPOINT, token_endpoint: 'https://evil.example/token', jwks_uri: JWKS_ENDPOINT, id_token_signing_alg_values_supported: ['RS256'] }) : null);
    await assert.rejects(f.begin(), /unsupported_identity_configuration/);
});
test('offline RSA: returning sign-in preserves host/client/account; same email cannot merge registrations', async () => {
    const f = fixture();
    await f.connect();
    const before = structuredClone(f.vault.data.get('profile'));
    const { start, url } = await f.begin();
    assert.equal(url.searchParams.get('client_id'), clientId);
    assert.equal(url.searchParams.get('ext_agent_host_id'), before?.hostId);
    assert.equal(url.searchParams.get('id_token_hint'), before?.idToken);
    assert.equal(url.searchParams.has('agent_name_hint'), false);
    await assert.rejects(f.manager.completeCallback(start.attemptId, f.callback(start, { client_id: 'other-client' }), binding), /callback_client_mismatch/);
    assert.deepEqual(f.vault.data.get('profile'), before);
    const again = await f.begin();
    f.setOverride(async (location) => location === TOKEN_ENDPOINT ? Response.json({ access_token: 'foreign', refresh_token: 'foreign-refresh', id_token: await f.token({ sub: 'foreign-subject', email: 'same@example.invalid' }), token_type: 'Bearer', expires_in: 3600, scope: 'openid offline_access chatgpt.tokens.use.direct' }) : null);
    await assert.rejects(f.manager.completeCallback(again.start.attemptId, f.callback(again.start), binding), /selected_identity_mismatch/);
    assert.deepEqual(f.vault.data.get('profile'), before);
});
test('offline: exact current version, same host, copied identity isolation and restart', async () => {
    const f = fixture();
    const { status } = await f.connect();
    const secret = await f.manager.resolvePlanCredential('profile', status.version!);
    assert.equal(secret.kind, 'chatgpt-plan');
    assert.match(secret.boundaryDigest, /^[a-f0-9]{64}$/);
    (secret.scopes as string[]).push('native-copy-mutation');
    assert.equal(f.vault.data.get('profile')?.scopes.includes('native-copy-mutation'), false);
    const restarted = new SiwcSessionManager(f.options);
    assert.deepEqual(await restarted.status('profile'), status);
    await assert.rejects(restarted.resolvePlanCredential('profile', 1), /plan_credentials_unavailable/);
    await assert.rejects(restarted.resolvePlanCredential('foreign-profile', 2), /plan_credentials_unavailable/);
    f.setHost(hostId);
    await assert.rejects(f.begin(), /host_identity_mismatch/);
});
test('offline: refresh is cross-process-lock/CAS injected, exact-version, rotated atomically, no scope escalation or retry', async () => {
    const f = fixture();
    await f.connect();
    const other = new SiwcSessionManager(f.options);
    const results = await Promise.allSettled([f.manager.refresh('profile', 2), other.refresh('profile', 2)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(f.vault.maxHeld, 1);
    assert.equal(f.calls.filter(call => call.url === TOKEN_ENDPOINT && String(call.init?.body).includes('grant_type=refresh_token')).length, 1);
    const current = f.vault.data.get('profile')!;
    assert.equal(current.version, 3);
    assert.equal(current.accessToken, 'synthetic-access-rotated');
    assert.equal(current.refreshToken, 'synthetic-refresh-rotated');
    assert.equal(current.identity?.clientId, clientId);
    await assert.rejects(f.manager.resolvePlanCredential('profile', 2), /plan_credentials_unavailable/);
});
test('offline: terminal refresh errors clear all renewable authority but retain mapping; transient errors do not auto retry', async () => {
    for (const code of ['invalid_grant', 'refresh_token_reused']) {
        const f = fixture();
        await f.connect();
        f.setOverride(async (url) => url === TOKEN_ENDPOINT ? Response.json({ error: code }, { status: 400 }) : null);
        await assert.rejects(f.manager.refresh('profile', 2), new RegExp(code));
        const stored = f.vault.data.get('profile')!;
        assert.equal(stored.clientId, clientId);
        assert.equal(stored.identity?.subject, 'subject-fixture');
        assert.equal(stored.refreshToken, null);
        assert.equal(stored.idToken, null);
        assert.equal(stored.enabled, false);
        assert.equal((await f.manager.status('profile')).planUsageEnabled, false);
    }
    const f = fixture();
    await f.connect();
    const before = structuredClone(f.vault.data.get('profile'));
    let count = 0;
    f.setOverride(async (url) => { if (url === TOKEN_ENDPOINT) {
        count++;
        return Response.json({ error: 'temporarily_unavailable', error_description: 'secret' }, { status: 503 });
    } return null; });
    await assert.rejects(f.manager.refresh('profile', 2), /provider_failed/);
    assert.deepEqual(f.vault.data.get('profile'), before);
    assert.equal(count, 1);
});
test('offline RSA: malformed rotated credentials or changed account disable old renewable session', async () => {
    const f = fixture();
    await f.connect();
    f.setOverride(async (url) => url === TOKEN_ENDPOINT ? Response.json({ access_token: 'rotated', refresh_token: 'rotated-refresh', id_token: await f.token({ sub: 'foreign-account' }), token_type: 'Bearer', expires_in: 3600, scope: 'openid offline_access chatgpt.tokens.use.direct' }) : null);
    await assert.rejects(f.manager.refresh('profile', 2), /selected_identity_mismatch/);
    assert.equal((await f.manager.status('profile')).state, 'disconnected');
    assert.equal(f.vault.data.get('profile')?.refreshToken, null);
});
test('offline: sign-out remote success vs unconfirmed, exact refresh token form, mapping retained and no hints after signout', async () => {
    for (const ok of [true, false]) {
        const f = fixture();
        await f.connect();
        let revocations = 0;
        f.setOverride(async (url, init) => { if (url === ISSUER + '/api/accounts/oauth/revoke') {
            revocations++;
            const form = new URLSearchParams(String(init?.body));
            assert.equal(form.get('token'), 'synthetic-refresh');
            assert.equal(form.get('client_id'), clientId);
            assert.equal(form.get('token_type_hint'), 'refresh_token');
            return new Response(null, { status: ok ? 200 : 503 });
        } return null; });
        const result = await f.manager.signOut('profile', 2);
        assert.equal(result.remoteRevocation, ok ? 'confirmed' : 'unconfirmed');
        assert.equal(result.status.state, 'disconnected');
        assert.equal(revocations, 1);
        assert.equal(f.vault.data.get('profile')?.clientId, clientId);
        assert.equal(f.vault.data.get('profile')?.accessToken, null);
        const { url } = await f.begin();
        assert.equal(url.searchParams.has('id_token_hint'), false);
        assert.equal(url.searchParams.get('client_id'), clientId);
    }
});
test('offline: pending limits include concurrent preparation; expired session blocks inference without hidden refresh', async () => {
    const f = fixture();
    const first = f.begin();
    await assert.rejects(f.begin(), /authorization_already_pending/);
    const { start } = await first;
    await f.manager.completeCallback(start.attemptId, f.callback(start), binding);
    f.setNow(initialNow + 3600001);
    assert.equal((await f.manager.status('profile')).state, 'expired');
    await assert.rejects(f.manager.resolvePlanCredential('profile', 2), /plan_credentials_unavailable/);
    assert.equal(f.calls.filter(call => call.url === TOKEN_ENDPOINT).length, 1);
});
test('offline: storage CAS failure cannot return a connected status or leak private diagnostics', async () => {
    const f = fixture(), { start } = await f.begin();
    f.vault.failNext = true;
    await assert.rejects(f.manager.completeCallback(start.attemptId, f.callback(start), binding), error => error instanceof Error && error.message === 'native_auth_storage_or_policy_unavailable');
    assert.equal((await f.manager.status('profile')).state, 'disconnected');
    assert.equal(f.calls.filter(call => call.url === TOKEN_ENDPOINT).length, 0);
});
test('offline RSA: returning callback can omit client ID, and refresh can omit ID token without changing identity', async () => {
    const f = fixture();
    await f.connect();
    const { start } = await f.begin(), callback = new URL(f.callback(start));
    callback.searchParams.delete('client_id');
    assert.equal((await f.manager.completeCallback(start.attemptId, callback.href, binding)).version, 3);
    const identity = structuredClone(f.vault.data.get('profile')?.identity);
    f.setOverride(async (url) => url === TOKEN_ENDPOINT ? Response.json({ access_token: 'next-access', refresh_token: 'next-refresh', token_type: 'Bearer', expires_in: 3600, scope: 'openid offline_access chatgpt.tokens.use.direct' }) : null);
    assert.equal((await f.manager.refresh('profile', 3)).version, 4);
    assert.deepEqual(f.vault.data.get('profile')?.identity, identity);
});
test('offline: stale external registration write and exhausted revision deny before exchange/refresh', async () => {
    const f = fixture();
    await f.connect();
    const { start } = await f.begin();
    const before = f.vault.data.get('profile')!;
    f.vault.data.set('profile', { ...before, version: 3 });
    const posts = f.calls.filter(call => call.url === TOKEN_ENDPOINT).length;
    await assert.rejects(f.manager.completeCallback(start.attemptId, f.callback(start), binding), /registration_changed/);
    assert.equal(f.calls.filter(call => call.url === TOKEN_ENDPOINT).length, posts);
    f.vault.data.set('profile', { ...before, version: Number.MAX_SAFE_INTEGER });
    await assert.rejects(f.manager.refresh('profile', Number.MAX_SAFE_INTEGER), /registration_version_exhausted/);
    assert.equal(f.calls.filter(call => call.url === TOKEN_ENDPOINT).length, posts);
});
test('offline: missing initial identity token and unsupported signing algorithms never enable a plan', async () => {
    const f = fixture();
    f.setOverride(async (url) => url === TOKEN_ENDPOINT ? Response.json({ access_token: 'synthetic', refresh_token: 'synthetic-refresh', token_type: 'Bearer', expires_in: 3600, scope: 'openid offline_access chatgpt.tokens.use.direct' }) : null);
    const { start } = await f.begin();
    await assert.rejects(f.manager.completeCallback(start.attemptId, f.callback(start), binding), /id_token_required/);
    assert.equal((await f.manager.status('profile')).planUsageEnabled, false);
    const g = fixture();
    g.setOverride(async (url) => url === DISCOVERY_ENDPOINT ? Response.json({ issuer: ISSUER, authorization_endpoint: AUTHORIZATION_ENDPOINT, token_endpoint: TOKEN_ENDPOINT, jwks_uri: JWKS_ENDPOINT, id_token_signing_alg_values_supported: ['none', 'HS256'] }) : null);
    await assert.rejects(g.begin(), /unsupported_identity_algorithms/);
    assert.equal(g.vault.writes, 0);
});
