import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify, type JSONWebKeySet } from 'jose';
import type { AuthOptions, CallbackBinding, Identity, NativeAuthorizationStart, NativeCredential, PrivateRegistration, PublicAuthStatus } from './contracts.mts';
import { abortable, boundedJSON, digest, knownRemoteCode, ProviderError, record, requireValue, text } from './common.mts';
export const ISSUER = 'https://auth.openai.com';
export const DISCOVERY_ENDPOINT = ISSUER + '/.well-known/openid-configuration';
export const AUTHORIZATION_ENDPOINT = ISSUER + '/api/accounts/authorize';
export const TOKEN_ENDPOINT = ISSUER + '/api/accounts/oauth/token';
export const JWKS_ENDPOINT = ISSUER + '/.well-known/jwks.json';
export const RESOURCE = 'https://api.openai.com/v1';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const DIRECT = 'chatgpt.tokens.use.direct';
const asymmetric = ['RS256', 'PS256', 'ES256', 'EdDSA'];
const terminalRefresh = new Set(['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused']);
interface Discovery {
    algorithms: string[];
    revocation: string | null;
}
interface Pending {
    registrationId: string;
    version: number | null;
    hostId: string;
    binding: CallbackBinding;
    clientId: string | null;
    state: string;
    nonce: string;
    verifier: string;
    expiresAt: number;
    discovery: Discovery;
}
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const random = () => randomBytes(32).toString('base64url');
function loopback(uri: string): URL {
    requireValue(text(uri, 2048), 'invalid_callback_binding');
    let url: URL;
    try {
        url = new URL(uri);
    }
    catch {
        throw new ProviderError('invalid_callback_binding');
    }
    requireValue(url.protocol === 'http:' && url.hostname === '127.0.0.1' && !!url.port && Number(url.port) > 0 && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/auth/callback' && url.href === uri, 'invalid_callback_binding');
    return url;
}
function validateStored(value: PrivateRegistration | null, id: string): void {
    if (!value)
        return;
    requireValue(value.registrationId === id && Number.isSafeInteger(value.version) && value.version >= 1 && text(value.clientId) && value.clientId !== 'dynamic_agent_client' && /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.hostId), 'invalid_protected_registration');
    requireValue(!value.identity || value.identity.issuer === ISSUER && text(value.identity.subject, 512) && value.identity.clientId === value.clientId, 'invalid_protected_registration');
    requireValue(Array.isArray(value.scopes) && value.scopes.length <= 64 && value.scopes.every(scope => text(scope, 200)) && Number.isFinite(value.expiresAt) && typeof value.nonce === 'string' && typeof value.enabled === 'boolean', 'invalid_protected_registration');
    for (const token of [value.accessToken, value.refreshToken, value.idToken])
        requireValue(token === null || text(token, 65536), 'invalid_protected_registration');
}
function publicStatus(id: string, value: PrivateRegistration | null, now: number): PublicAuthStatus {
    const connected = !!(value?.enabled && value.identity && value.accessToken), plan = connected && value!.scopes.includes(DIRECT), expired = connected && value!.expiresAt <= now;
    return { providerId: 'chatgpt-plan-responses', registrationId: id, state: !connected ? 'disconnected' : expired ? 'expired' : plan ? 'ready' : 'identity-only', planUsageEnabled: !!plan && !expired, sessionRefreshAvailable: !!(connected && value?.refreshToken), nativeAccountHistory: false, nativeAccountMemory: false, billingRoute: 'chatgpt-plan', version: value?.version ?? null };
}
function cleared(value: PrivateRegistration): PrivateRegistration { return { ...value, version: value.version + 1, accessToken: null, refreshToken: null, idToken: null, scopes: [], expiresAt: 0, nonce: '', enabled: false }; }
function nextVersion(value: PrivateRegistration): void { requireValue(Number.isSafeInteger(value.version + 1), 'registration_version_exhausted'); }
/** Native-only OAuth/OIDC coordinator. No browser, callback server, disk or account database. */
export class SiwcSessionManager {
    private readonly options: AuthOptions;
    private readonly pending = new Map<string, Pending>();
    private readonly preparing = new Set<string>();
    constructor(options: AuthOptions) { this.options = options; }
    private now() { return this.options.now?.() ?? Date.now(); }
    private async native<T>(operation: () => Promise<T>): Promise<T> { try {
        return await operation();
    }
    catch (error) {
        throw error instanceof ProviderError ? error : new ProviderError('native_auth_storage_or_policy_unavailable');
    } }
    private read(id: string) { return this.native(() => this.options.vault.read(id)); }
    private save(id: string, version: number | null, next: PrivateRegistration) { return this.native(() => this.options.vault.compareAndSwap(id, version, structuredClone(next))); }
    private locked<T>(id: string, operation: () => Promise<T>) { return this.native(() => this.options.vault.withLock(id, operation)); }
    private async requestJSON(url: string, init: RequestInit = {}): Promise<unknown> {
        const signal = AbortSignal.timeout(15000);
        try {
            const response = await abortable((this.options.fetch ?? fetch)(url, { ...init, signal, redirect: 'error', credentials: 'omit', cache: 'no-store' }), signal), data = await boundedJSON(response, 262144, signal);
            if (!response.ok)
                throw new ProviderError(record(data) ? knownRemoteCode(record(data.error) ? data.error.code : data.error) : 'provider_failed');
            return data;
        }
        catch (error) {
            throw error instanceof ProviderError ? error : new ProviderError('auth_transport_unavailable');
        }
    }
    private async discovery(): Promise<Discovery> {
        const data = await this.requestJSON(DISCOVERY_ENDPOINT);
        requireValue(record(data) && data.issuer === ISSUER && data.authorization_endpoint === AUTHORIZATION_ENDPOINT && data.token_endpoint === TOKEN_ENDPOINT && data.jwks_uri === JWKS_ENDPOINT, 'unsupported_identity_configuration');
        requireValue(Array.isArray(data.id_token_signing_alg_values_supported), 'unsupported_identity_algorithms');
        const algorithms = asymmetric.filter(alg => (data.id_token_signing_alg_values_supported as unknown[]).includes(alg));
        requireValue(algorithms.length > 0, 'unsupported_identity_algorithms');
        let revocation: string | null = null;
        if (typeof data.revocation_endpoint === 'string') {
            let url: URL;
            try {
                url = new URL(data.revocation_endpoint);
            }
            catch {
                throw new ProviderError('invalid_revocation_endpoint');
            }
            requireValue(url.origin === ISSUER && !url.username && !url.password && !url.search && !url.hash && url.protocol === 'https:', 'invalid_revocation_endpoint');
            revocation = url.href;
        }
        return { algorithms, revocation };
    }
    private async identity(token: unknown, clientId: string, nonce: string, discovery: Discovery): Promise<Identity> {
        requireValue(text(token, 65536), 'id_token_required');
        try {
            const header = decodeProtectedHeader(token);
            requireValue(text(header.kid) && !header.jku && !header.x5u && !header.jwk && discovery.algorithms.includes(header.alg ?? ''), 'unsupported_identity_header');
            const jwks = await this.requestJSON(JWKS_ENDPOINT);
            requireValue(record(jwks) && Array.isArray(jwks.keys) && jwks.keys.length > 0 && jwks.keys.length <= 32, 'invalid_identity_keys');
            const { payload } = await jwtVerify(token, createLocalJWKSet(jwks as unknown as JSONWebKeySet), { issuer: ISSUER, audience: clientId, algorithms: discovery.algorithms, requiredClaims: ['sub', 'iat', 'exp', 'nonce'], clockTolerance: 5, currentDate: new Date(this.now()) });
            requireValue(text(payload.sub, 512) && typeof payload.nonce === 'string' && same(payload.nonce, nonce) && typeof payload.iat === 'number' && payload.iat <= this.now() / 1000 + 5, 'identity_nonce_or_time_mismatch');
            requireValue((payload.azp === undefined || payload.azp === clientId) && (!Array.isArray(payload.aud) || payload.aud.length === 1 || payload.azp === clientId), 'identity_authorized_party_mismatch');
            return { issuer: ISSUER, subject: payload.sub, clientId };
        }
        catch (error) {
            throw error instanceof ProviderError ? error : new ProviderError('invalid_identity_token');
        }
    }
    private async tokens(data: unknown, current: PrivateRegistration, nonce: string, discovery: Discovery, initial: boolean): Promise<PrivateRegistration> {
        requireValue(record(data) && text(data.access_token, 65536) && data.token_type === 'Bearer' && Number.isSafeInteger(data.expires_in) && Number(data.expires_in) > 0 && Number(data.expires_in) <= 86400 && typeof data.scope === 'string' && data.scope.length <= 8192, 'invalid_token_response');
        const scopes = [...new Set(data.scope.split(/\s+/).filter(Boolean))];
        requireValue(scopes.length <= 64 && scopes.every(scope => text(scope, 200)), 'invalid_token_scopes');
        requireValue(data.refresh_token === undefined || text(data.refresh_token, 65536), 'invalid_refresh_token_response');
        if (!initial || scopes.includes('offline_access'))
            requireValue(text(data.refresh_token, 65536), 'replacement_refresh_token_required');
        const identity = data.id_token !== undefined ? await this.identity(data.id_token, current.clientId, nonce, discovery) : current.identity;
        requireValue(identity && (!initial || data.id_token !== undefined), 'id_token_required');
        requireValue(!current.identity || current.identity.issuer === identity.issuer && current.identity.subject === identity.subject && current.identity.clientId === identity.clientId, 'selected_identity_mismatch');
        const expiresAt = this.now() + Number(data.expires_in) * 1000;
        requireValue(Number.isSafeInteger(expiresAt), 'invalid_token_expiry');
        nextVersion(current);
        return { ...current, version: current.version + 1, identity, accessToken: data.access_token, refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : null, idToken: typeof data.id_token === 'string' ? data.id_token : current.idToken, scopes, expiresAt, nonce, enabled: true };
    }
    async status(registrationId: string): Promise<PublicAuthStatus> { requireValue(text(registrationId), 'invalid_registration_id'); const value = await this.read(registrationId); validateStored(value, registrationId); return publicStatus(registrationId, value, this.now()); }
    async prepareSignIn(registrationId: string, binding: CallbackBinding): Promise<NativeAuthorizationStart> {
        requireValue(text(registrationId) && text(binding.id), 'invalid_registration_id');
        binding = structuredClone(binding);
        loopback(binding.redirectUri);
        for (const [id, pending] of this.pending)
            if (pending.expiresAt <= this.now())
                this.pending.delete(id);
        requireValue(this.pending.size + this.preparing.size < 4 && !this.preparing.has(registrationId) && !Array.from(this.pending.values()).some(value => value.registrationId === registrationId), 'authorization_already_pending');
        this.preparing.add(registrationId);
        try {
            await this.native(() => this.options.policy.assertListener(binding));
            const stored = structuredClone(await this.read(registrationId));
            validateStored(stored, registrationId);
            if (!stored) {
                const decision = await this.native(() => this.options.policy.authorizeNewRegistration(registrationId));
                requireValue(decision.kind === 'local-personal-project' && decision.scope === 'current-owner-local-installation' && text(decision.decisionRef, 512), 'local_registration_not_authorized');
            }
            const hostId = await this.native(() => this.options.host.getOrCreate(() => `urn:uuid:${randomUUID()}`));
            requireValue(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(hostId) && (!stored || stored.hostId === hostId), 'host_identity_mismatch');
            const discovery = await this.discovery(), attemptId = randomUUID(), state = random(), nonce = random(), verifier = random(), expiresAt = this.now() + 300000;
            const query = new URLSearchParams({ client_id: stored?.clientId ?? 'dynamic_agent_client', ext_agent_host_id: hostId, response_type: 'code', redirect_uri: binding.redirectUri, scope: SCOPES, resource: RESOURCE, state, nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') });
            if (!stored)
                query.set('agent_name_hint', 'Aerynth');
            else if (stored.idToken)
                query.set('id_token_hint', stored.idToken);
            this.pending.set(attemptId, { registrationId, version: stored?.version ?? null, hostId, binding: structuredClone(binding), clientId: stored?.clientId ?? null, state, nonce, verifier, expiresAt, discovery });
            return { attemptId, authorizationUrl: AUTHORIZATION_ENDPOINT + '?' + query.toString(), expiresAt };
        }
        finally {
            this.preparing.delete(registrationId);
        }
    }
    cancelSignIn(attemptId: string): void { this.pending.delete(attemptId); }
    async completeCallback(attemptId: string, callbackUrl: string, binding: CallbackBinding): Promise<PublicAuthStatus> {
        const pending = this.pending.get(attemptId);
        requireValue(pending && pending.expiresAt > this.now(), 'authorization_attempt_unavailable');
        requireValue(text(callbackUrl, 16384) && binding.id === pending.binding.id && binding.redirectUri === pending.binding.redirectUri, 'callback_binding_mismatch');
        await this.native(() => this.options.policy.assertListener(structuredClone(binding)));
        let url: URL;
        try {
            url = new URL(callbackUrl);
        }
        catch {
            throw new ProviderError('invalid_callback');
        }
        const expected = loopback(binding.redirectUri);
        requireValue(url.origin === expected.origin && url.pathname === expected.pathname && !url.hash && !url.username && !url.password, 'callback_binding_mismatch');
        for (const key of ['state', 'code', 'client_id', 'error', 'iss'])
            requireValue(url.searchParams.getAll(key).length <= 1, 'ambiguous_callback');
        requireValue(same(url.searchParams.get('state') ?? '', pending.state), 'oauth_state_mismatch');
        this.pending.delete(attemptId);
        requireValue(!url.searchParams.has('iss') || url.searchParams.get('iss') === ISSUER, 'callback_issuer_mismatch');
        if (url.searchParams.has('error'))
            throw new ProviderError(url.searchParams.get('error') === 'access_denied' ? 'authorization_denied' : 'authorization_failed');
        const code = url.searchParams.get('code'), clientId = url.searchParams.get('client_id') ?? pending.clientId;
        requireValue(text(code, 4096) && text(clientId) && clientId !== 'dynamic_agent_client' && (!pending.clientId || pending.clientId === clientId), 'callback_client_mismatch');
        return this.locked(pending.registrationId, async () => {
            let current = structuredClone(await this.read(pending.registrationId));
            validateStored(current, pending.registrationId);
            requireValue((current?.version ?? null) === pending.version, 'registration_changed');
            if (!current) {
                current = { registrationId: pending.registrationId, version: 1, hostId: pending.hostId, clientId, identity: null, accessToken: null, refreshToken: null, idToken: null, scopes: [], expiresAt: 0, nonce: '', enabled: false };
                await this.save(current.registrationId, null, current);
            }
            nextVersion(current);
            const data = await this.requestJSON(TOKEN_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: pending.verifier, redirect_uri: pending.binding.redirectUri, resource: RESOURCE }).toString() });
            const next = await this.tokens(data, current, pending.nonce, pending.discovery, true);
            await this.save(current.registrationId, current.version, next);
            return publicStatus(next.registrationId, next, this.now());
        });
    }
    async refresh(registrationId: string, expectedVersion: number): Promise<PublicAuthStatus> {
        requireValue(text(registrationId) && Number.isSafeInteger(expectedVersion) && expectedVersion >= 1, 'invalid_registration_version');
        return this.locked(registrationId, async () => {
            const current = structuredClone(await this.read(registrationId));
            validateStored(current, registrationId);
            requireValue(current && current.version === expectedVersion && current.enabled && current.identity && current.refreshToken, 'refresh_unavailable');
            nextVersion(current);
            let receivedRotation = false, committing = false;
            try {
                const discovery = await this.discovery(), data = await this.requestJSON(TOKEN_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: current.clientId, refresh_token: current.refreshToken, resource: RESOURCE }).toString() });
                receivedRotation = true;
                const next = await this.tokens(data, current, current.nonce, discovery, false);
                committing = true;
                await this.save(registrationId, current.version, next);
                return publicStatus(registrationId, next, this.now());
            }
            catch (error) {
                if (!committing && (receivedRotation || error instanceof ProviderError && terminalRefresh.has(error.code))) {
                    nextVersion(current);
                    await this.save(registrationId, current.version, cleared(current));
                }
                throw error instanceof ProviderError ? error : new ProviderError('refresh_storage_unavailable');
            }
        });
    }
    async signOut(registrationId: string, expectedVersion: number): Promise<{
        status: PublicAuthStatus;
        remoteRevocation: 'confirmed' | 'unconfirmed' | 'not-needed';
    }> {
        requireValue(text(registrationId) && Number.isSafeInteger(expectedVersion), 'invalid_registration_version');
        for (const [id, value] of this.pending)
            if (value.registrationId === registrationId)
                this.pending.delete(id);
        return this.locked(registrationId, async () => {
            const current = structuredClone(await this.read(registrationId));
            validateStored(current, registrationId);
            requireValue(current && current.version === expectedVersion, 'registration_changed');
            nextVersion(current);
            let remoteRevocation: 'confirmed' | 'unconfirmed' | 'not-needed' = current.refreshToken ? 'unconfirmed' : 'not-needed';
            if (current.refreshToken)
                try {
                    const discovery = await this.discovery();
                    requireValue(discovery.revocation, 'revocation_unavailable');
                    const signal = AbortSignal.timeout(15000), response = await abortable((this.options.fetch ?? fetch)(discovery.revocation, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: current.refreshToken, token_type_hint: 'refresh_token', client_id: current.clientId }).toString(), redirect: 'error', signal }), signal);
                    if (response.status === 200)
                        remoteRevocation = 'confirmed';
                    await response.body?.cancel().catch(() => { });
                }
                catch { /* explicit local sign-out still clears; never claim remote success */ }
            nextVersion(current);
            const next = cleared(current);
            await this.save(registrationId, current.version, next);
            return { status: publicStatus(registrationId, next, this.now()), remoteRevocation };
        });
    }
    /** Private native-broker credential read. Never refreshes, retries or selects another account. */
    async resolvePlanCredential(registrationId: string, expectedVersion: number): Promise<NativeCredential> {
        requireValue(text(registrationId) && Number.isSafeInteger(expectedVersion), 'invalid_registration_version');
        const current = structuredClone(await this.read(registrationId));
        validateStored(current, registrationId);
        requireValue(current && current.version === expectedVersion && publicStatus(registrationId, current, this.now()).planUsageEnabled && current.identity && current.accessToken, 'plan_credentials_unavailable');
        return { providerId: 'chatgpt-plan-responses', kind: 'chatgpt-plan', bearer: current.accessToken, expiresAt: current.expiresAt, scopes: [...current.scopes], boundaryDigest: digest(JSON.stringify({ registrationId, version: current.version, hostId: current.hostId, identity: current.identity, scopes: current.scopes, expiresAt: current.expiresAt })) };
    }
}
