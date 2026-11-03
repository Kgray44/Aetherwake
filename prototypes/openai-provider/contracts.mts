/** Native-process module contracts. No secret-bearing type is a renderer RPC. */
import type { ReasoningEffort } from './model-controls.ts';
export type ProviderId = 'chatgpt-plan-responses' | 'openai-api-vela';
export type AssistantId = 'ordinary' | 'vela';
/** Safe catalog observation only. No credentials, raw body/header object,
 * URL, configuration/account/client/host identity or entitlement claim. */
export interface ModelCatalogDiagnostic {
    readonly contract: 'aerynth.model-catalog-diagnostic@1';
    readonly outcome: 'accepted' | 'http-error' | 'invalid-catalog' | 'unavailable';
    readonly httpStatus: number | null;
    readonly serverRequestId: string | null;
    readonly bodyShape: 'error' | 'detail' | 'models' | 'data' | 'other' | 'invalid-json' | 'unavailable';
    /** Fixed knownRemoteCode allowlist only; unrecognized values are null. */
    readonly remoteCode: string | null;
    /** Selected route array length / explicitly list-visible rows, <=2048.
     * Null means unobserved or outside the bounded catalog schema. */
    readonly returnedCount: number | null;
    readonly listedCount: number | null;
    /** Same request observation clock as the existing catalog result. */
    readonly observedAt: number;
    /** Exact consumed JSON bytes on success; saturates at the route's limit+1
     * on overflow. No body content is retained or exposed. */
    readonly responseBytes?: number | null;
}
export interface TurnInput {
    readonly executionId: string;
    readonly requestId: string;
    readonly configurationId: string;
    readonly providerId: ProviderId;
    readonly assistant: AssistantId;
    readonly model: string;
    readonly instructions: string;
    readonly messages: readonly {
        readonly role: 'user' | 'assistant' | 'developer';
        readonly content: string;
    }[];
    readonly contextDigest: string;
    readonly reasoningEffort?: ReasoningEffort;
    readonly webSearch?: true;
}
export type WebCitation = { url: string; title: string; start: number; end: number };
export interface DispatchReview {
    readonly executionId: string;
    readonly requestId: string;
    readonly configurationId: string;
    readonly providerId: ProviderId;
    readonly model: string;
    readonly contextDigest: string;
    readonly bodyDigest: string;
    readonly bodyBytes: number;
}
/** Only supplied by the native credential broker. Never constructed from renderer fields. */
export interface NativeCredential {
    readonly providerId: ProviderId;
    readonly kind: 'chatgpt-plan' | 'openai-api-key';
    readonly boundaryDigest: string;
    readonly bearer: string;
    readonly expiresAt?: number;
    readonly scopes?: readonly string[];
    readonly organization?: string;
    readonly project?: string;
}
export interface NativeDispatchPort {
    /** Validate/consume the existing native approval and budget against exact egress. */
    authorize(review: DispatchReview): Promise<void>;
    resolveCredential(configurationId: string, providerId: ProviderId): Promise<NativeCredential>;
    /** Recheck current scope/catalog/session/version after asynchronous secret resolution. */
    revalidate(review: DispatchReview, boundaryDigest: string): Promise<void>;
    resolveCatalog(configurationId: string, providerId: ProviderId): Promise<{
        boundaryDigest: string;
        expiresAt: number;
        models: readonly string[];
    }>;
}
export interface ReportedUsage {
    source: 'provider-reported';
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedInputTokens?: number;
}
export type TurnOutcome = 'completed' | 'incomplete' | 'failed' | 'unknown' | 'cancelled-before-dispatch';
/** Bodyless native HTTP observation. No raw headers/body, message, URL,
 * credential, account, model, configuration or execution identity. */
export interface TurnHttpDiagnostic {
    readonly contract: 'aerynth.turn-http-diagnostic@1';
    readonly httpStatus: number | null;
    readonly contentType: 'event-stream' | 'json' | 'text' | 'html' | 'other' | 'missing';
    readonly hasBody: boolean;
    readonly serverRequestId: string | null;
    readonly bodyShape: 'error' | 'detail' | 'other' | 'invalid-json' | 'unavailable';
    /** Existing fixed knownRemoteCode allowlist only; otherwise null. */
    readonly remoteCode: string | null;
}
export type TurnEvent = {
    type: 'provider/text-delta';
    providerId: ProviderId;
    executionId: string;
    delta: string;
} | {
    type: 'provider/refusal-delta';
    providerId: ProviderId;
    executionId: string;
    delta: string;
} | {
    type: 'provider/response-created';
    providerId: ProviderId;
    executionId: string;
    responseId: string;
} | {
    type: 'provider/usage';
    providerId: ProviderId;
    executionId: string;
    usage: ReportedUsage;
};
export interface TurnResult {
    providerId: ProviderId;
    executionId: string;
    requestId: string;
    outcome: TurnOutcome;
    incompleteReason?: 'max_output_tokens' | 'content_filter';
    dispatched: boolean;
    partialText: string;
    refusalText?: string;
    responseId?: string;
    reportedModel?: string;
    webSearch?: { completed: boolean; citations: WebCitation[] };
    usage?: ReportedUsage;
    errorCode?: string;
    /** Absent until an HTTP response was actually received; not outcome proof. */
    httpDiagnostic?: Readonly<TurnHttpDiagnostic>;
    cancellation: {
        requested: boolean;
        serverConfirmed: false;
    };
    taskVerified: false;
}
export interface TransportOptions {
    native: NativeDispatchPort;
    fetch?: typeof fetch;
    now?: () => number;
    onEvent: (event: TurnEvent) => Promise<void> | void;
    limits?: {
        requestBytes?: number;
        eventBytes?: number;
        streamBytes?: number;
        outputBytes?: number;
        timeoutMs?: number;
    };
}
export interface Identity {
    issuer: 'https://auth.openai.com';
    subject: string;
    clientId: string;
}
/** This object and its tokens belong exclusively to injected protected native storage. */
export interface PrivateRegistration {
    registrationId: string;
    version: number;
    hostId: string;
    clientId: string;
    identity: Identity | null;
    accessToken: string | null;
    refreshToken: string | null;
    idToken: string | null;
    scopes: string[];
    expiresAt: number;
    nonce: string;
    enabled: boolean;
}
export interface NativeCredentialVault {
    read(registrationId: string): Promise<PrivateRegistration | null>;
    compareAndSwap(registrationId: string, expectedVersion: number | null, next: PrivateRegistration): Promise<void>;
    /** Mandatory cross-process exclusion; an in-memory mutex is not adequate. */
    withLock<T>(registrationId: string, operation: () => Promise<T>): Promise<T>;
}
export interface NativeHostIdentityStore {
    getOrCreate(make: () => string): Promise<string>;
}
export interface CallbackBinding {
    readonly id: string;
    readonly redirectUri: string;
}
export interface NativeRegistrationPolicy {
    /** Checks the actual native listener; a renderer boolean is not listener proof. */
    assertListener(binding: CallbackBinding): Promise<void>;
    /** Explicit owner-local personal-project decision; no commercial/distribution approval. */
    authorizeNewRegistration(registrationId: string): Promise<{
        kind: 'local-personal-project';
        scope: 'current-owner-local-installation';
        decisionRef: string;
    }>;
}
export interface AuthOptions {
    vault: NativeCredentialVault;
    host: NativeHostIdentityStore;
    policy: NativeRegistrationPolicy;
    fetch?: typeof fetch;
    now?: () => number;
}
export interface PublicAuthStatus {
    providerId: 'chatgpt-plan-responses';
    registrationId: string;
    state: 'disconnected' | 'identity-only' | 'ready' | 'expired';
    planUsageEnabled: boolean;
    sessionRefreshAvailable: boolean;
    nativeAccountHistory: false;
    nativeAccountMemory: false;
    billingRoute: 'chatgpt-plan';
    version: number | null;
}
/** PRIVATE host return. Authorization URL can contain retained identity hints: never send to renderer/logs. */
export interface NativeAuthorizationStart {
    attemptId: string;
    authorizationUrl: string;
    expiresAt: number;
}
