import { MIMEType } from 'node:util';
import type { DispatchReview, ModelCatalogDiagnostic, NativeCredential, ProviderId, ReportedUsage, TransportOptions, TurnHttpDiagnostic, TurnInput, TurnResult, WebCitation } from './contracts.mts';
import { abortable, boundedJSON, digest, exact, knownRemoteCode, ProviderError, record, requireValue, text } from './common.mts';
import { supportsOrdinaryReasoning, supportsOrdinaryWebSearch } from './model-controls.ts';
export const RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';
export const MODELS_ENDPOINT = 'https://api.openai.com/v1/models';
export const RESPONSES_REQUEST_BYTES = 262144;
export const RESPONSES_MESSAGE_LIMIT = 128;
const defaults = { requestBytes: RESPONSES_REQUEST_BYTES, eventBytes: 262144, streamBytes: 2 * 1024 * 1024, outputBytes: 262144, timeoutMs: 90000 };
export function prepareResponsesTurn(input: TurnInput, maxBytes = defaults.requestBytes): {
    body: string;
    review: DispatchReview;
} {
    requireValue(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= defaults.requestBytes, 'invalid_request_limit');
    requireValue(record(input) && exact(input, ['executionId', 'requestId', 'configurationId', 'providerId', 'assistant', 'model', 'instructions', 'messages', 'contextDigest', ...(Object.hasOwn(input, 'reasoningEffort') ? ['reasoningEffort'] : []), ...(Object.hasOwn(input, 'webSearch') ? ['webSearch'] : [])]), 'invalid_turn');
    requireValue(!Object.hasOwn(input, 'webSearch') || input.webSearch === true && input.providerId === 'chatgpt-plan-responses' && input.assistant === 'ordinary', 'invalid_web_search_scope');
    requireValue(['executionId', 'requestId', 'configurationId', 'model'].every(key => text(input[key as keyof TurnInput])), 'invalid_turn_identity');
    requireValue(input.providerId === 'chatgpt-plan-responses' && input.assistant === 'ordinary' || input.providerId === 'openai-api-vela' && input.assistant === 'vela', 'provider_identity_mismatch');
    requireValue(!Object.hasOwn(input, 'reasoningEffort') ||
        input.providerId === 'chatgpt-plan-responses' && supportsOrdinaryReasoning(input.model, input.reasoningEffort), 'unsupported_reasoning_effort');
    requireValue(!input.webSearch || supportsOrdinaryWebSearch(input.model), 'unsupported_web_search_model');
    requireValue(typeof input.contextDigest === 'string' && /^[a-f0-9]{64}$/.test(input.contextDigest), 'invalid_context_digest');
    requireValue(typeof input.instructions === 'string' && Array.isArray(input.messages) && input.messages.length > 0 && input.messages.length <= RESPONSES_MESSAGE_LIMIT, 'invalid_context');
    let units = input.instructions.length;
    for (const message of input.messages) {
        requireValue(record(message) && exact(message, ['role', 'content']) && typeof message.role === 'string' && ['user', 'assistant', 'developer'].includes(message.role) && typeof message.content === 'string', 'invalid_input_message');
        units += message.content.length;
        requireValue(units <= maxBytes, 'request_capacity_exceeded');
    }
    // The only supported hosted tool is explicitly requested ordinary web search.
    const body = JSON.stringify({
        model: input.model,
        instructions: input.instructions,
        input: input.messages.map(({ role, content }) => ({ role, content })),
        store: false,
        stream: true,
        ...(input.reasoningEffort === undefined ? {} : { reasoning: { effort: input.reasoningEffort } }),
        ...(input.webSearch ? { tools: [{ type: 'web_search' }], tool_choice: 'required' } : {}),
    });
    const bodyBytes = Buffer.byteLength(body);
    requireValue(bodyBytes <= maxBytes, 'request_capacity_exceeded');
    return { body, review: { executionId: input.executionId, requestId: input.requestId, configurationId: input.configurationId, providerId: input.providerId, model: input.model, contextDigest: input.contextDigest, bodyDigest: digest(body), bodyBytes } };
}
/** Inspect provider metadata only. Search queries and tool payloads are not retained. */
function webSearchEvidence(output: readonly Record<string, unknown>[], streamedText: string): NonNullable<TurnResult['webSearch']> {
    const completed = output.some(item => item.type === 'web_search_call' && item.status === 'completed');
    const parts = output.flatMap(item => item.type === 'message' && item.role === 'assistant' && Array.isArray(item.content) ? item.content.filter(part => record(part) && part.type === 'output_text' && typeof part.text === 'string') : []);
    const citations: WebCitation[] = [];
    // Citation offsets refer to the associated text part. Keep them only when
    // the terminal content is the same text that will appear in the transcript.
    if (!completed || parts.map(part => part.text).join('') !== streamedText) return { completed, citations };
    let offset = 0;
    for (const part of parts) {
        const characters = Array.from(part.text as string);
        const annotations = Array.isArray(part.annotations) ? part.annotations.slice(0, 64) : [];
        for (const entry of annotations) {
            if (citations.length === 32) return { completed, citations };
            if (!record(entry) || entry.type !== 'url_citation' || !text(entry.url, 2048) || !text(entry.title, 300)) continue;
            const start = Number(entry.start_index), end = Number(entry.end_index);
            if (typeof entry.start_index !== 'number' || typeof entry.end_index !== 'number' || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > characters.length) continue;
            let url: URL;
            try { url = new URL(entry.url); } catch { continue; }
            if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) continue;
            citations.push({ url: url.href, title: entry.title, start: offset + characters.slice(0, start).join('').length, end: offset + characters.slice(0, end).join('').length });
        }
        offset += (part.text as string).length;
    }
    return { completed, citations };
}
function credentialHeaders(credential: NativeCredential, providerId: ProviderId, now: number): Record<string, string> {
    requireValue(credential.providerId === providerId && text(credential.bearer, 65536) && typeof credential.boundaryDigest === 'string' && /^[a-f0-9]{64}$/.test(credential.boundaryDigest), 'credential_boundary_mismatch');
    requireValue(credential.expiresAt === undefined || Number.isFinite(credential.expiresAt) && credential.expiresAt > now, 'credential_expired');
    if (providerId === 'chatgpt-plan-responses')
        requireValue(credential.kind === 'chatgpt-plan' && credential.scopes?.includes('chatgpt.tokens.use.direct') && !credential.organization && !credential.project, 'chatgpt_plan_grant_required');
    else
        requireValue(credential.kind === 'openai-api-key', 'api_billing_route_required');
    const headers: Record<string, string> = { Authorization: 'Bearer ' + credential.bearer };
    for (const [key, value] of [['OpenAI-Organization', credential.organization], ['OpenAI-Project', credential.project]] as const)
        if (value !== undefined) {
            requireValue(text(value), 'invalid_native_header');
            headers[key] = value;
        }
    return headers;
}
function usage(value: unknown): ReportedUsage | undefined {
    if (!record(value) || !['input_tokens', 'output_tokens', 'total_tokens'].every(key => Number.isSafeInteger(value[key]) && Number(value[key]) >= 0))
        return;
    const cached = record(value.input_tokens_details) ? value.input_tokens_details.cached_tokens : undefined;
    return { source: 'provider-reported', inputTokens: Number(value.input_tokens), outputTokens: Number(value.output_tokens), totalTokens: Number(value.total_tokens), ...(Number.isSafeInteger(cached) && Number(cached) >= 0 && Number(cached) <= Number(value.input_tokens) ? { cachedInputTokens: Number(cached) } : {}) };
}
function turnContentType(response: Response): TurnHttpDiagnostic['contentType'] {
    let value: string | null;
    try { value = response.headers.get('content-type'); } catch { return 'other'; }
    if (value === null) return 'missing';
    let essence: string;
    try { essence = new MIMEType(value).essence; } catch { return 'other'; }
    // MIME type/subtype are case-insensitive; parameters do not change the
    // essence. The parser rejects a comma-separated list, not a single SSE type.
    if (essence === 'text/event-stream') return 'event-stream';
    if (essence === 'text/html') return 'html';
    if (essence === 'application/json' || essence.split('/')[1]?.endsWith('+json')) return 'json';
    return essence.startsWith('text/') ? 'text' : 'other';
}
function turnHttpDiagnostic(response: Response, credential: NativeCredential): Readonly<TurnHttpDiagnostic> {
    return Object.freeze(Object.assign(Object.create(null), { contract: 'aerynth.turn-http-diagnostic@1',
        httpStatus: Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : null,
        contentType: turnContentType(response), hasBody: response.body !== null, serverRequestId: responseRequestId(response, credential), bodyShape: 'unavailable', remoteCode: null }));
}
function turnErrorFacts(data: unknown): Pick<TurnHttpDiagnostic, 'bodyShape' | 'remoteCode'> {
    const remote = knownRemoteCode(ownData(ownData(data, 'error'), 'code') ?? ownData(data, 'code') ?? ownData(ownData(data, 'detail'), 'code'));
    return { bodyShape: record(data) ? Object.hasOwn(data, 'error') ? 'error' : Object.hasOwn(data, 'detail') ? 'detail' : 'other' : 'other', remoteCode: remote === 'provider_failed' ? null : remote };
}
/** No persistence, auto retries, tool execution, agent instructions or credentials from UI. */
export class ResponsesTransport {
    private readonly options: TransportOptions;
    private readonly limits: typeof defaults;
    private readonly active = new Set<string>();
    constructor(options: TransportOptions) { this.options = options; this.limits = { ...defaults, ...options.limits }; for (const [key, value] of Object.entries(this.limits))
        requireValue(Number.isSafeInteger(value) && value > 0 && value <= defaults[key as keyof typeof defaults], 'invalid_transport_limit'); }
    async turn(input: TurnInput, signal?: AbortSignal): Promise<TurnResult> {
        const frozen = structuredClone(input), { body, review } = prepareResponsesTurn(frozen, this.limits.requestBytes);
        requireValue(!this.active.has(frozen.executionId), 'execution_already_in_flight');
        this.active.add(frozen.executionId);
        const controller = new AbortController(), result: TurnResult = { providerId: frozen.providerId, executionId: frozen.executionId, requestId: frozen.requestId, outcome: 'unknown', dispatched: false, partialText: '', cancellation: { requested: false, serverConfirmed: false }, taskVerified: false };
        const isAllowedOutputItem = (item: unknown): item is Record<string, unknown> => record(item) && (item.type === 'message' || item.type === 'reasoning' || frozen.webSearch === true && item.type === 'web_search_call');
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, timedOut = false, terminal = false;
        const cancelled = () => { result.cancellation.requested = true; controller.abort(); void reader?.cancel().catch(() => { }); };
        signal?.addEventListener('abort', cancelled, { once: true });
        if (signal?.aborted)
            cancelled();
        const timer = setTimeout(() => { timedOut = true; controller.abort(); void reader?.cancel().catch(() => { }); }, this.limits.timeoutMs);
        try {
            if (controller.signal.aborted) {
                result.outcome = 'cancelled-before-dispatch';
                return result;
            }
            await abortable(this.options.native.authorize(Object.freeze(review)), controller.signal);
            const credential = structuredClone(await abortable(this.options.native.resolveCredential(frozen.configurationId, frozen.providerId), controller.signal));
            const catalog = structuredClone(await abortable(this.options.native.resolveCatalog(frozen.configurationId, frozen.providerId), controller.signal)), now = this.options.now?.() ?? Date.now();
            const headers = credentialHeaders(credential, frozen.providerId, now);
            requireValue(catalog.boundaryDigest === credential.boundaryDigest && Number.isFinite(catalog.expiresAt) && catalog.expiresAt > now && catalog.models.includes(frozen.model), 'model_catalog_stale_or_unauthorized');
            await abortable(this.options.native.revalidate(review, credential.boundaryDigest), controller.signal);
            const dispatchTime = this.options.now?.() ?? Date.now();
            credentialHeaders(credential, frozen.providerId, dispatchTime);
            requireValue(catalog.expiresAt > dispatchTime, 'model_catalog_stale_or_unauthorized');
            if (controller.signal.aborted) {
                result.outcome = 'cancelled-before-dispatch';
                return result;
            }
            result.dispatched = true;
            const response = await abortable((this.options.fetch ?? fetch)(RESPONSES_ENDPOINT, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body, signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store' }), controller.signal);
            result.httpDiagnostic = turnHttpDiagnostic(response, credential);
            if (!response.ok) {
                let code = 'provider_failed';
                try {
                    const data = await boundedJSON(response, 262144, controller.signal);
                    result.httpDiagnostic = Object.freeze(Object.assign(Object.create(null), result.httpDiagnostic, turnErrorFacts(data)));
                    code = knownRemoteCode(ownData(ownData(data, 'error'), 'code'));
                }
                catch (error) {
                    if (error instanceof ProviderError && error.code === 'invalid_json_response')
                        result.httpDiagnostic = Object.freeze(Object.assign(Object.create(null), result.httpDiagnostic, { bodyShape: 'invalid-json', remoteCode: null }));
                    // Never reflect error bodies or replace the received HTTP facts.
                }
                result.outcome = controller.signal.aborted || response.status >= 500 || response.status === 408 ? 'unknown' : 'failed';
                result.errorCode = controller.signal.aborted ? 'provider_timeout' : code;
                return result;
            }
            // The live ChatGPT plan endpoint can omit Content-Type on HTTP 200.
            // For that case, establish stream identity from the actual SSE frames.
            const verifyFraming =
                frozen.providerId === 'chatgpt-plan-responses' &&
                response.status === 200 &&
                result.httpDiagnostic.contentType === 'missing';
            requireValue(
                response.body && (result.httpDiagnostic.contentType === 'event-stream' || verifyFraming),
                'invalid_stream_response',
            );
            reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8', { fatal: true });
            let buffer = '', streamBytes = 0, outputBytes = 0;
            const emit = async (event: Parameters<TransportOptions['onEvent']>[0]) => { await abortable(Promise.resolve(this.options.onEvent(event)), controller.signal); };
            const terminalError = (payload: unknown) => {
                const failure = knownRemoteCode(ownData(payload, 'code') ?? ownData(payload, 'type'));
                result.httpDiagnostic = Object.freeze(Object.assign(Object.create(null), result.httpDiagnostic, {
                    bodyShape: 'error', remoteCode: failure === 'provider_failed' ? null : failure,
                }));
                return failure;
            };
            const consume = async (block: string) => {
                const lines = block.split('\n');
                if (verifyFraming)
                    requireValue(lines.every(line => !line || /^(?::|data:|event:|id:|retry:)/.test(line)), 'invalid_stream_response');
                const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
                if (!data || data === '[DONE]')
                    return;
                requireValue(Buffer.byteLength(data) <= this.limits.eventBytes, 'event_capacity_exceeded');
                let event: unknown;
                try {
                    event = JSON.parse(data);
                }
                catch {
                    throw new ProviderError('invalid_stream_json');
                }
                requireValue(record(event) && typeof event.type === 'string', 'invalid_stream_event');
                const declared = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
                requireValue(!declared || declared === event.type, 'stream_event_type_mismatch');
                if (verifyFraming && !result.responseId)
                    requireValue(event.type === 'response.created', 'invalid_stream_response');
                if (event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta') {
                    requireValue(typeof event.delta === 'string', 'invalid_text_delta');
                    outputBytes += Buffer.byteLength(event.delta);
                    requireValue(outputBytes <= this.limits.outputBytes, 'output_capacity_exceeded');
                    if (event.type === 'response.refusal.delta') {
                        result.refusalText = (result.refusalText ?? '') + event.delta;
                        await emit({ type: 'provider/refusal-delta', providerId: frozen.providerId, executionId: frozen.executionId, delta: event.delta });
                    }
                    else {
                        result.partialText += event.delta;
                        await emit({ type: 'provider/text-delta', providerId: frozen.providerId, executionId: frozen.executionId, delta: event.delta });
                    }
                }
                else if (event.type === 'response.created') {
                    requireValue(record(event.response) && text(event.response.id, 256) && !result.responseId, 'invalid_created_response');
                    result.responseId = event.response.id;
                    await emit({ type: 'provider/response-created', providerId: frozen.providerId, executionId: frozen.executionId, responseId: event.response.id });
                }
                else if (['response.completed', 'response.incomplete', 'response.failed'].includes(event.type)) {
                    requireValue(record(event.response) && text(event.response.id, 256) && (!result.responseId || result.responseId === event.response.id), 'response_identity_mismatch');
                    result.responseId = event.response.id;
                    if (event.response.output !== undefined)
                        requireValue(Array.isArray(event.response.output) && event.response.output.length <= 128 && event.response.output.every(isAllowedOutputItem), 'unsupported_provider_output');
                    const expected = event.type.slice('response.'.length);
                    requireValue(event.response.status === expected, 'response_terminal_mismatch');
                    result.outcome = expected as 'completed' | 'incomplete' | 'failed';
                    if (frozen.webSearch && expected === 'completed') result.webSearch = webSearchEvidence((event.response.output as Record<string, unknown>[] | undefined) ?? [], result.partialText);
                    result.reportedModel = typeof event.response.model === 'string' ? event.response.model : undefined;
                    result.usage = usage(event.response.usage);
                    if (result.usage)
                        await emit({ type: 'provider/usage', providerId: frozen.providerId, executionId: frozen.executionId, usage: result.usage });
                    if (expected === 'failed')
                        result.errorCode = terminalError(event.response.error);
                    if (expected === 'incomplete')
                        result.errorCode = 'provider_incomplete';
                    terminal = true;
                }
                else if (event.type === 'error') {
                    result.outcome = 'failed';
                    result.errorCode = terminalError(record(event.error) ? event.error : event);
                    terminal = true;
                }
                else if (['response.output_item.added', 'response.output_item.done'].includes(event.type) && !isAllowedOutputItem(event.item))
                    throw new ProviderError('unsupported_provider_output');
                else if (event.type.startsWith('response.function_call_arguments.') || event.type.startsWith('response.mcp_') || !frozen.webSearch && event.type.startsWith('response.web_search_call.'))
                    throw new ProviderError('unsupported_provider_output');
            };
            while (!terminal) {
                const next = await abortable(reader.read(), controller.signal);
                if (next.done) {
                    decoder.decode();
                    break;
                }
                streamBytes += next.value.length;
                requireValue(streamBytes <= this.limits.streamBytes, 'stream_capacity_exceeded');
                buffer = (buffer + decoder.decode(next.value, { stream: true })).replace(/\r\n/g, '\n');
                let end: number;
                while (!terminal && (end = buffer.indexOf('\n\n')) >= 0) {
                    const block = buffer.slice(0, end);
                    buffer = buffer.slice(end + 2);
                    requireValue(Buffer.byteLength(block) <= this.limits.eventBytes, 'event_capacity_exceeded');
                    await consume(block);
                }
                if (!terminal)
                    requireValue(Buffer.byteLength(buffer) <= this.limits.eventBytes, 'event_capacity_exceeded');
            }
            if (!terminal) {
                result.outcome = 'unknown';
                result.errorCode = timedOut ? 'provider_timeout'
                    : result.cancellation.requested ? 'cancellation_unconfirmed'
                    : verifyFraming && !result.responseId ? 'invalid_stream_response'
                    : 'stream_terminal_unobserved';
            }
            return result;
        }
        catch (error) {
            result.outcome = result.dispatched ? 'unknown' : result.cancellation.requested ? 'cancelled-before-dispatch' : 'failed';
            result.errorCode = timedOut ? 'provider_timeout' : result.cancellation.requested ? 'cancellation_unconfirmed' : error instanceof ProviderError ? error.code : 'provider_transport_unavailable';
            return result;
        }
        finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', cancelled);
            void reader?.cancel().catch(() => { });
            this.active.delete(frozen.executionId);
        }
    }
}
/** Inspect only own data properties; diagnostic projection never invokes body
 * accessors, serializers or arbitrary remote text. Parsed JSON normally has none. */
function ownData(value: unknown, key: string): unknown {
    if (!record(value)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}
function catalogFacts(data: unknown, providerId: ProviderId): Pick<ModelCatalogDiagnostic, 'bodyShape' | 'remoteCode' | 'returnedCount' | 'listedCount'> {
    const shape = record(data) ? (['error', 'detail', 'models', 'data'] as const).find(key => Object.hasOwn(data, key)) ?? 'other' : 'other';
    const remote = knownRemoteCode(ownData(ownData(data, 'error'), 'code') ?? ownData(data, 'code') ?? ownData(ownData(data, 'detail'), 'code'));
    const rows = ownData(data, providerId === 'chatgpt-plan-responses' ? 'models' : 'data');
    const bounded = Array.isArray(rows) && rows.length <= 2048;
    return { bodyShape: shape, remoteCode: remote === 'provider_failed' ? null : remote, returnedCount: bounded ? rows.length : null,
        listedCount: bounded ? providerId === 'chatgpt-plan-responses' ? rows.reduce((count, row) => count + Number(ownData(row, 'visibility') === 'list'), 0) : rows.length : null };
}
function responseRequestId(response: Response, credential: NativeCredential): string | null {
    try {
        const value = response.headers.get('x-request-id');
        if (!value || !/^req_[A-Za-z0-9_-]{1,128}$/.test(value)) return null;
        if ([credential.bearer, credential.organization, credential.project, credential.boundaryDigest].some(secret => typeof secret === 'string' && secret.length > 0 && value.includes(secret))) return null;
        return value;
    } catch { return null; }
}
/** Native-only explicit catalog request. Does not establish inference entitlement. */
export async function fetchModelCatalog(options: {
    providerId: ProviderId;
    configurationId: string;
    resolveCredential: TransportOptions['native']['resolveCredential'];
    fetch?: typeof fetch;
    now?: () => number;
    /** Once, synchronously, after outcome; observer failures cannot alter it. */
    onDiagnostic?: (diagnostic: Readonly<ModelCatalogDiagnostic>) => void;
}): Promise<{
    providerId: ProviderId;
    boundaryDigest: string;
    observedAt: number;
    catalogOnly: true;
    models: {
        id: string;
        label: string;
    }[];
}> {
    let outcome: ModelCatalogDiagnostic['outcome'] = 'unavailable', httpStatus: number | null = null, serverRequestId: string | null = null, observedAt = Date.now(), responseBytes: number | null = null;
    let facts: Pick<ModelCatalogDiagnostic, 'bodyShape' | 'remoteCode' | 'returnedCount' | 'listedCount'> = { bodyShape: 'unavailable', remoteCode: null, returnedCount: null, listedCount: null };
    try {
        requireValue((options.providerId === 'chatgpt-plan-responses' || options.providerId === 'openai-api-vela') && text(options.configurationId), 'invalid_catalog_configuration');
        const now = options.now?.() ?? Date.now(); if (Number.isSafeInteger(now) && now >= 0 && now <= 8640000000000000) observedAt = now;
        const credential = await options.resolveCredential(options.configurationId, options.providerId), headers = credentialHeaders(credential, options.providerId, now);
        const signal = AbortSignal.timeout(15000), response = await abortable((options.fetch ?? fetch)(MODELS_ENDPOINT, { headers, redirect: 'error', credentials: 'omit', cache: 'no-store', signal }), signal);
        httpStatus = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : null;
        serverRequestId = responseRequestId(response, credential);
        if (!response.ok) {
            outcome = 'http-error';
            try { facts = catalogFacts(await boundedJSON(response, 262144, signal, bytes => { responseBytes = bytes; }), options.providerId); }
            catch (error) { if (error instanceof ProviderError && error.code === 'invalid_json_response') facts = { ...facts, bodyShape: 'invalid-json' }; }
            throw new ProviderError('model_catalog_unavailable');
        }
        outcome = 'invalid-catalog';
        let data: unknown;
        // The live account catalog exceeded the old 256 KiB ceiling. Keep a
        // separate 2 MiB success ceiling; errors retain the smaller limit.
        try { data = await boundedJSON(response, 2097152, signal, bytes => { responseBytes = bytes; }); }
        catch (error) { if (error instanceof ProviderError && error.code === 'invalid_json_response') facts = { ...facts, bodyShape: 'invalid-json' }; throw error; }
        facts = catalogFacts(data, options.providerId);
        requireValue(record(data), 'invalid_model_catalog');
        const rows = options.providerId === 'chatgpt-plan-responses' ? data.models : data.data;
        requireValue(Array.isArray(rows) && rows.length <= 2048, 'invalid_model_catalog');
        const models: {
            id: string;
            label: string;
        }[] = [];
        for (const row of rows) {
            requireValue(record(row), 'invalid_model_catalog');
            if (options.providerId === 'chatgpt-plan-responses') {
                if (row.visibility !== 'list')
                    continue;
                requireValue(text(row.slug) && text(row.display_name), 'invalid_model_catalog');
                models.push({ id: row.slug, label: row.display_name });
            }
            else {
                requireValue(text(row.id), 'invalid_model_catalog');
                models.push({ id: row.id, label: row.id });
            }
        }
        requireValue(new Set(models.map(model => model.id)).size === models.length, 'ambiguous_model_catalog');
        outcome = 'accepted';
        return { providerId: options.providerId, boundaryDigest: credential.boundaryDigest, observedAt: now, catalogOnly: true, models };
    } finally {
        // Null prototype + frozen own scalars: no inherited toJSON/getter or
        // secret-bearing body/cause/credential object can cross this callback.
        const diagnostic: Readonly<ModelCatalogDiagnostic> = Object.freeze(Object.assign(Object.create(null), { contract: 'aerynth.model-catalog-diagnostic@1', outcome, httpStatus, serverRequestId,
            bodyShape: facts.bodyShape, remoteCode: facts.remoteCode, returnedCount: facts.returnedCount, listedCount: facts.listedCount, observedAt, responseBytes }));
        try {
            const observation: unknown = options.onDiagnostic?.(diagnostic);
            if (observation instanceof Promise) void Promise.prototype.then.call(observation, undefined, () => {});
        } catch { /* observation is not dispatch/catalog authority */ }
    }
}
