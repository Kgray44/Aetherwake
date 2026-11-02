/** Native-process module contracts. No secret-bearing type is a renderer RPC. */
export type ProviderId = 'chatgpt-plan-responses' | 'openai-api-vela';
export type AssistantId = 'ordinary' | 'vela';
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
}
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
    dispatched: boolean;
    partialText: string;
    refusalText?: string;
    responseId?: string;
    reportedModel?: string;
    usage?: ReportedUsage;
    errorCode?: string;
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
