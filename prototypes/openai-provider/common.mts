import { createHash } from 'node:crypto';
export class ProviderError extends Error {
    readonly code: string;
    constructor(code: string) { super(code); this.name = 'ProviderError'; this.code = code; }
}
export const requireValue: (condition: unknown, code: string) => asserts condition = (condition, code) => { if (!condition)
    throw new ProviderError(code); };
export const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const text = (value: unknown, max = 200): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\r\n\x00]/.test(value);
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key));
export async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted)
        throw new ProviderError('operation_aborted');
    return new Promise((resolve, reject) => { const stop = () => { cleanup(); reject(new ProviderError('operation_aborted')); }; const cleanup = () => signal.removeEventListener('abort', stop); signal.addEventListener('abort', stop, { once: true }); promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); }); });
}
export async function boundedJSON(response: Response, max = 262144, signal?: AbortSignal): Promise<unknown> {
    requireValue(!!response.body, 'response_body_unavailable');
    const reader = response.body.getReader(), parts: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const next = await (signal ? abortable(reader.read(), signal) : reader.read());
            if (next.done)
                break;
            size += next.value.length;
            requireValue(size <= max, 'response_capacity_exceeded');
            parts.push(next.value);
        }
        const buffer = Buffer.concat(parts);
        try {
            return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
        }
        catch {
            throw new ProviderError('invalid_json_response');
        }
    }
    finally {
        void reader.cancel().catch(() => { });
    }
}
export const knownRemoteCode = (value: unknown) => typeof value === 'string' && new Set(['subscription_sharing_usage_limit_exceeded', 'subscription_sharing_usage_unavailable', 'subscription_sharing_unsupported_capability', 'subscription_sharing_route_not_supported', 'subscription_sharing_invalid_user', 'chatpass_v2_scope_not_authorized', 'chatpass_v2_invalid_authorization_context', 'subscription_sharing_user_unavailable', 'subscription_sharing_user_not_eligible', 'invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused', 'invalid_client', 'insufficient_quota', 'rate_limit_exceeded', 'invalid_api_key']).has(value) ? value : 'provider_failed';
