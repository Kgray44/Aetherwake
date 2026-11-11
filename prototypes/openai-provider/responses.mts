import { MIMEType } from 'node:util';
import type { ApiDispatchBinding, ApiFunctionCall, ApiJsonValue, ApiRecoveryReference, ApiRecoveryResult, ApiResponseItem, DispatchReview, ModelCatalogDiagnostic, NativeCredential, ProviderId, ReportedUsage, TransportOptions, TurnHttpDiagnostic, TurnInput, TurnResult, WebCitation } from './contracts.mts';
import { abortable, boundedJSON, digest, exact, knownRemoteCode, ProviderError, record, requireValue, text } from './common.mts';
import { supportsOrdinaryReasoning, supportsOrdinaryWebSearch } from './model-controls.ts';
export const RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';
export const MODELS_ENDPOINT = 'https://api.openai.com/v1/models';
export const RESPONSES_REQUEST_BYTES = 262144;
export const RESPONSES_MESSAGE_LIMIT = 128;
export const VELA_API_MAX_OUTPUT_TOKENS = 32768;
const defaults = { requestBytes: RESPONSES_REQUEST_BYTES, eventBytes: 262144, streamBytes: 2 * 1024 * 1024, outputBytes: 262144, timeoutMs: 90000 };
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const functionName = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const fields = (value: unknown, required: string[], optional: string[] = []): value is Record<string, unknown> => record(value) && exact(value, [...required, ...optional.filter(key => Object.hasOwn(value, key))]);
function boundedJsonValue(value: unknown, maxBytes = 32768): void {
    let nodes = 0, stringBytes = 0;
    const visit = (entry: unknown, depth: number): void => {
        requireValue(++nodes <= 4096 && depth <= 24, 'api_json_capacity_exceeded');
        if (typeof entry === 'string') { stringBytes += Buffer.byteLength(entry); requireValue(stringBytes <= maxBytes, 'api_json_capacity_exceeded'); return; }
        if (entry === null || typeof entry === 'boolean' || typeof entry === 'number' && Number.isFinite(entry)) return;
        requireValue(Array.isArray(entry) || record(entry), 'invalid_api_json');
        for (const child of Object.values(entry)) visit(child, depth + 1);
    };
    visit(value, 0);
    requireValue(Buffer.byteLength(JSON.stringify(value)) <= maxBytes, 'api_json_capacity_exceeded');
}
/** Local structural checks for strict JSON schemas; the provider and canonical
 * tool host must still validate their supported schema subset and actual values. */
function strictSchema(schema: unknown): void {
    boundedJsonValue(schema);
    requireValue(record(schema) && schema.type === 'object', 'invalid_api_schema');
    const visit = (entry: unknown): void => {
        requireValue(record(entry), 'invalid_api_schema');
        if (entry.type === 'object' || Array.isArray(entry.type) && entry.type.includes('object') || Object.hasOwn(entry, 'properties')) {
            requireValue(record(entry.properties) && entry.additionalProperties === false && Array.isArray(entry.required), 'invalid_api_schema');
            const names = Object.keys(entry.properties);
            requireValue(entry.required.length === names.length && new Set(entry.required).size === names.length && entry.required.every(name => typeof name === 'string' && names.includes(name)), 'invalid_api_schema');
            for (const child of Object.values(entry.properties)) visit(child);
        }
        for (const keyword of ['anyOf', 'allOf', 'oneOf']) if (entry[keyword] !== undefined) {
            requireValue(Array.isArray(entry[keyword]), 'invalid_api_schema');
            for (const child of entry[keyword]) visit(child);
        }
        if (entry.items !== undefined) visit(entry.items);
        if (entry.$defs !== undefined) { requireValue(record(entry.$defs), 'invalid_api_schema'); for (const child of Object.values(entry.$defs)) visit(child); }
        if (entry.$ref !== undefined) requireValue(typeof entry.$ref === 'string' && /^#\/(?:\$defs\/)?[A-Za-z0-9_/-]+$/.test(entry.$ref), 'invalid_api_schema');
    };
    visit(schema);
}
type ApiTool = { name: string; schemaDigest: string };
function partialApiFunction(value: unknown, tools: readonly ApiTool[]): boolean {
    if (!record(value) || value.type !== 'function_call' || value.status === 'completed') return false;
    requireValue(text(value.id, 256) && text(value.call_id, 256) && functionName(value.name) && tools.some(tool => tool.name === value.name) && ['in_progress', 'incomplete'].includes(String(value.status)) && typeof value.arguments === 'string' && Buffer.byteLength(value.arguments) <= 65536, 'unreviewed_api_function');
    return true;
}
function apiItem(value: unknown, tools: readonly ApiTool[]): ApiResponseItem {
    requireValue(record(value) && text(value.id, 256), 'invalid_api_response_item');
    if (value.type === 'function_call') {
        requireValue(text(value.call_id, 256) && functionName(value.name) && tools.some(tool => tool.name === value.name) && typeof value.arguments === 'string' && Buffer.byteLength(value.arguments) <= 65536 && value.status === 'completed', 'unreviewed_api_function');
        let args: unknown;
        try { args = JSON.parse(value.arguments); } catch { throw new ProviderError('invalid_api_function_arguments'); }
        requireValue(record(args), 'invalid_api_function_arguments'); boundedJsonValue(args, 65536);
        return { type: 'function_call', id: value.id, call_id: value.call_id, name: value.name, arguments: value.arguments, status: 'completed' };
    }
    if (value.type === 'reasoning') {
        requireValue(Array.isArray(value.summary) && value.summary.length <= 64 && value.summary.every(part => record(part) && part.type === 'summary_text' && typeof part.text === 'string') && (value.encrypted_content === undefined || value.encrypted_content === null || typeof value.encrypted_content === 'string'), 'invalid_api_response_item');
        // Never expose raw reasoning text. Carry encrypted state and supported summaries only.
        return { type: 'reasoning', id: value.id, summary: value.summary.map(part => ({ type: 'summary_text', text: String(part.text) })), ...(typeof value.encrypted_content === 'string' ? { encrypted_content: value.encrypted_content } : {}) };
    }
    requireValue(value.type === 'message' && value.role === 'assistant' && ['completed', 'incomplete', 'in_progress'].includes(String(value.status)) && Array.isArray(value.content) && value.content.length <= 64, 'unsupported_provider_output');
    const content = value.content.map(part => {
        requireValue(record(part), 'invalid_api_response_item');
        if (part.type === 'refusal') { requireValue(typeof part.refusal === 'string', 'invalid_api_response_item'); return { type: 'refusal' as const, refusal: part.refusal }; }
        requireValue(part.type === 'output_text' && typeof part.text === 'string' && Array.isArray(part.annotations), 'invalid_api_response_item');
        boundedJsonValue(part.annotations, 65536);
        return { type: 'output_text' as const, text: part.text, annotations: structuredClone(part.annotations) as ApiJsonValue[] };
    });
    return { type: 'message', id: value.id, role: 'assistant', status: value.status as 'completed' | 'incomplete' | 'in_progress', content };
}
/** JSON object key order is not content. Arrays, strings, IDs and call arguments
 * remain ordered/exact. A terminal item may enrich optional reasoning metadata,
 * but cannot substitute any previously observed value. */
function apiJsonEqual(left: unknown, right: unknown): boolean {
    if (left === right) return true;
    if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value,index) => apiJsonEqual(value,right[index]));
    if (!record(left) || !record(right)) return false;
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right,key) && apiJsonEqual(left[key],right[key]));
}
function reconcileApiItem(prior: ApiResponseItem | undefined, next: ApiResponseItem, terminalSnapshot = false): ApiResponseItem {
    if (!prior || apiJsonEqual(prior,next)) return next;
    requireValue(prior.id === next.id && prior.type === next.type, 'api_response_item_changed_identity');
    if (prior.type === 'reasoning' && next.type === 'reasoning') {
        requireValue(next.summary.length >= prior.summary.length && prior.summary.every((part,index) => apiJsonEqual(part,next.summary[index])), 'api_response_item_changed_reasoning_summary');
        // The streaming contract names output_item.done as the authoritative
        // encrypted continuation. A response-level snapshot cannot replace it.
        // Keep exact done bytes; duplicate item.done events still reconcile strictly.
        // https://developers.openai.com/api/reference/resources/responses/streaming-events
        if (terminalSnapshot && prior.encrypted_content !== undefined) return { ...next, encrypted_content: prior.encrypted_content };
        requireValue(prior.encrypted_content === undefined || next.encrypted_content === undefined || prior.encrypted_content === next.encrypted_content, 'api_response_item_changed_reasoning_encrypted');
        return { ...next, ...(next.encrypted_content === undefined && prior.encrypted_content !== undefined ? { encrypted_content: prior.encrypted_content } : {}) };
    }
    if (prior.type === 'message' && next.type === 'message') {
        requireValue(apiJsonEqual(prior.content,next.content), 'api_response_item_changed_message_content');
        requireValue(prior.status === next.status || prior.status === 'in_progress' && next.status !== 'in_progress', 'api_response_item_changed_message_status');
        return next;
    }
    throw new ProviderError('api_response_item_changed_function_call');
}
function apiToolCall(item: Extract<ApiResponseItem, { type: 'function_call' }>, source: { executionId: string; responseId: string; configurationVersion: number; contextDigest: string; tools: readonly ApiTool[] }): ApiFunctionCall {
    const tool = source.tools.find(tool => tool.name === item.name)!;
    return { itemId: item.id, callId: item.call_id, name: item.name, arguments: item.arguments, argumentsDigest: digest(item.arguments), schemaDigest: tool.schemaDigest,
        executionId: source.executionId, responseId: source.responseId, configurationVersion: source.configurationVersion, contextDigest: source.contextDigest, requiresHostValidation: true };
}
function prepareApi(input: TurnInput): { wire: Record<string, unknown>; binding: ApiDispatchBinding } | undefined {
    if (!Object.hasOwn(input, 'api')) return;
    const api = input.api;
    requireValue(input.providerId === 'openai-api-vela' && input.assistant === 'vela' && fields(api, ['configurationVersion', 'instructionVersion', 'maxOutputTokens'], ['reasoningEfforts', 'tools', 'parallelToolCalls', 'outputFormat', 'continuation', 'prompt', 'cache', 'retention']), 'invalid_api_turn');
    boundedJsonValue(api, RESPONSES_REQUEST_BYTES);
    requireValue(Number.isSafeInteger(api.configurationVersion) && api.configurationVersion > 0 && text(api.instructionVersion) && Number.isSafeInteger(api.maxOutputTokens) && api.maxOutputTokens > 0 && api.maxOutputTokens <= VELA_API_MAX_OUTPUT_TOKENS, 'invalid_api_turn');
    if (api.reasoningEfforts !== undefined) requireValue(Array.isArray(api.reasoningEfforts) && api.reasoningEfforts.length <= 6 && new Set(api.reasoningEfforts).size === api.reasoningEfforts.length && api.reasoningEfforts.every(effort => ['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(effort)), 'unsupported_reasoning_effort');
    const tools = api.tools ?? [];
    requireValue(Array.isArray(tools) && tools.length <= 16, 'invalid_api_tools');
    for (const tool of tools) {
        requireValue(fields(tool, ['definition', 'schemaDigest', 'authorizationRef']) && fields(tool.definition, ['type', 'name', 'description', 'parameters', 'strict']) && tool.definition.type === 'function' && functionName(tool.definition.name) && typeof tool.definition.description === 'string' && tool.definition.description.length <= 2000 && tool.definition.strict === true && sha(tool.schemaDigest) && text(tool.authorizationRef), 'invalid_api_tools');
        strictSchema(tool.definition.parameters);
        requireValue(tool.schemaDigest === digest(JSON.stringify(tool.definition)), 'api_tool_schema_changed');
    }
    requireValue(new Set(tools.map(tool => tool.definition.name)).size === tools.length, 'invalid_api_tools');
    if(api.parallelToolCalls!==undefined)requireValue(api.parallelToolCalls===true&&tools.length>0,'invalid_api_tools');
    let binding: ApiDispatchBinding = { configurationVersion: api.configurationVersion, instructionVersion: api.instructionVersion,
        ...(api.reasoningEfforts === undefined ? {} : { reasoningEfforts: [...api.reasoningEfforts] }),
        tools: tools.map(tool => ({ name: tool.definition.name, schemaDigest: tool.schemaDigest, authorizationRef: tool.authorizationRef })),
        ...(api.parallelToolCalls?{parallelToolCalls:true as const}:{}),
        ...(api.retention === undefined ? {} : { retention: structuredClone(api.retention) }) };
    const wire: Record<string, unknown> = { max_output_tokens: api.maxOutputTokens,
        ...(tools.length ? { tools: tools.map(tool => tool.definition), tool_choice: 'auto', parallel_tool_calls: api.parallelToolCalls===true } : {}) };
    if (api.outputFormat !== undefined) {
        requireValue(fields(api.outputFormat, ['type', 'name', 'schema', 'strict']) && api.outputFormat.type === 'json_schema' && functionName(api.outputFormat.name) && api.outputFormat.strict === true, 'invalid_api_output_format');
        strictSchema(api.outputFormat.schema); wire.text = { format: api.outputFormat };
    }
    if (api.retention !== undefined) {
        requireValue(fields(api.retention, ['store', 'background', 'authorizationRef']) && typeof api.retention.store === 'boolean' && typeof api.retention.background === 'boolean' && (api.retention.store || api.retention.background) && text(api.retention.authorizationRef), 'api_retention_review_required');
        wire.store = api.retention.store; wire.background = api.retention.background;
    }
    if (api.prompt !== undefined) {
        requireValue(fields(api.prompt, ['id', 'version'], ['variables']) && text(api.prompt.id) && text(api.prompt.version), 'invalid_api_prompt');
        if (api.prompt.variables !== undefined) requireValue(record(api.prompt.variables) && Object.keys(api.prompt.variables).length <= 32 && Object.entries(api.prompt.variables).every(([name, value]) => functionName(name) && typeof value === 'string' && value.length <= 4096), 'invalid_api_prompt');
        wire.prompt = api.prompt;
    }
    if (api.cache !== undefined) {
        requireValue(fields(api.cache, [], ['key', 'options']) && (api.cache.key !== undefined || api.cache.options !== undefined), 'invalid_api_cache');
        if (api.cache.key !== undefined) { requireValue(text(api.cache.key), 'invalid_api_cache'); wire.prompt_cache_key = api.cache.key; }
        if (api.cache.options !== undefined) {
            requireValue(fields(api.cache.options, ['mode', 'ttl']) && ['implicit', 'explicit'].includes(api.cache.options.mode) && api.cache.options.ttl === '30m', 'invalid_api_cache');
            wire.prompt_cache_options = api.cache.options;
        }
    }
    if (api.continuation !== undefined) {
        const continuation = api.continuation;
        requireValue(fields(continuation, ['sourceExecutionId', 'responseId', 'configurationVersion', 'contextDigest', 'sourceOutcome', 'itemsDigest', 'items', 'toolOutputs'], ['contextTransition']) && text(continuation.sourceExecutionId) && continuation.sourceExecutionId !== input.executionId && text(continuation.responseId, 256) && continuation.configurationVersion === api.configurationVersion && sha(continuation.contextDigest) && continuation.sourceOutcome === 'completed' && sha(continuation.itemsDigest) && Array.isArray(continuation.items) && continuation.items.length > 0 && Array.isArray(continuation.toolOutputs) && continuation.toolOutputs.length <= 16 && input.messages.length + continuation.items.length + continuation.toolOutputs.length <= RESPONSES_MESSAGE_LIMIT, 'invalid_api_continuation');
        const transition=continuation.contextTransition;
        if(continuation.contextDigest!==input.contextDigest)requireValue(fields(transition,['priorContextDigest','nextContextDigest','ownerReceiptId','sourceProofDigest'])&&transition.priorContextDigest===continuation.contextDigest&&transition.nextContextDigest===input.contextDigest&&sha(transition.priorContextDigest)&&sha(transition.nextContextDigest)&&sha(transition.sourceProofDigest)&&typeof transition.ownerReceiptId==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(transition.ownerReceiptId),'api_context_transition_required');
        else requireValue(transition===undefined,'invalid_api_context_transition');
        requireValue(digest(JSON.stringify(continuation.items)) === continuation.itemsDigest, 'api_continuation_changed');
        const items = continuation.items.map(item => apiItem(item, binding.tools));
        const calls = items.filter((item): item is Extract<ApiResponseItem, { type: 'function_call' }> => item.type === 'function_call');
        requireValue(calls.length > 0 && calls.length === continuation.toolOutputs.length && new Set(calls.map(call => call.call_id)).size === calls.length && new Set(items.map(item => item.id)).size === items.length && new Set(continuation.toolOutputs.map(output => output.callId)).size === calls.length, 'invalid_api_tool_outputs');
        for (const output of continuation.toolOutputs) {
            requireValue(fields(output, ['callId', 'name', 'argumentsDigest', 'output', 'receiptId']) && text(output.callId, 256) && functionName(output.name) && sha(output.argumentsDigest) && typeof output.output === 'string' && Buffer.byteLength(output.output) <= 65536 && text(output.receiptId), 'invalid_api_tool_outputs');
            const call = calls.find(call => call.call_id === output.callId);
            requireValue(call && call.name === output.name && digest(call.arguments) === output.argumentsDigest, 'api_tool_call_binding_mismatch');
        }
        wire.input = [...input.messages.map(({ role, content }) => ({ role, content })), ...items, ...continuation.toolOutputs.map(output => ({ type: 'function_call_output', call_id: output.callId, output: output.output }))];
        binding = { ...binding, continuation: { sourceExecutionId: continuation.sourceExecutionId, responseId: continuation.responseId, contextDigest: continuation.contextDigest, itemsDigest: continuation.itemsDigest,
            toolOutputs: continuation.toolOutputs.map(output => ({ callId: output.callId, name: output.name, argumentsDigest: output.argumentsDigest, outputDigest: digest(output.output), receiptId: output.receiptId })),...(transition?{contextTransition:structuredClone(transition)}:{}) } };
    }
    return { wire, binding };
}
export function prepareResponsesTurn(input: TurnInput, maxBytes = defaults.requestBytes): {
    body: string;
    review: DispatchReview;
} {
    requireValue(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= defaults.requestBytes, 'invalid_request_limit');
    requireValue(record(input) && exact(input, ['executionId', 'requestId', 'configurationId', 'providerId', 'assistant', 'model', 'instructions', 'messages', 'contextDigest', ...(Object.hasOwn(input, 'reasoningEffort') ? ['reasoningEffort'] : []), ...(Object.hasOwn(input, 'webSearch') ? ['webSearch'] : []), ...(Object.hasOwn(input, 'api') ? ['api'] : [])]), 'invalid_turn');
    requireValue(!Object.hasOwn(input, 'webSearch') || input.webSearch === true && input.providerId === 'chatgpt-plan-responses' && input.assistant === 'ordinary', 'invalid_web_search_scope');
    requireValue(['executionId', 'requestId', 'configurationId', 'model'].every(key => text(input[key as keyof TurnInput])), 'invalid_turn_identity');
    requireValue(input.providerId === 'chatgpt-plan-responses' && input.assistant === 'ordinary' || input.providerId === 'openai-api-vela' && input.assistant === 'vela', 'provider_identity_mismatch');
    requireValue(!input.webSearch || supportsOrdinaryWebSearch(input.model), 'unsupported_web_search_model');
    requireValue(typeof input.contextDigest === 'string' && /^[a-f0-9]{64}$/.test(input.contextDigest), 'invalid_context_digest');
    requireValue(typeof input.instructions === 'string' && Array.isArray(input.messages) && input.messages.length > 0 && input.messages.length <= RESPONSES_MESSAGE_LIMIT, 'invalid_context');
    let units = input.instructions.length;
    for (const message of input.messages) {
        requireValue(record(message) && exact(message, ['role', 'content']) && typeof message.role === 'string' && ['user', 'assistant', 'developer'].includes(message.role) && typeof message.content === 'string', 'invalid_input_message');
        units += message.content.length;
        requireValue(units <= maxBytes, 'request_capacity_exceeded');
    }
    const api = prepareApi(input);
    requireValue(!Object.hasOwn(input, 'reasoningEffort') ||
        input.providerId === 'chatgpt-plan-responses' && supportsOrdinaryReasoning(input.model, input.reasoningEffort) ||
        !!api && input.api!.reasoningEfforts?.includes(input.reasoningEffort!), 'unsupported_reasoning_effort');
    // The only supported hosted tool is explicitly requested ordinary web search.
    const body = JSON.stringify({
        model: input.model,
        instructions: input.instructions,
        input: input.messages.map(({ role, content }) => ({ role, content })),
        store: false,
        stream: true,
        ...(input.reasoningEffort === undefined ? {} : { reasoning: { effort: input.reasoningEffort } }),
        ...(input.webSearch ? { tools: [{ type: 'web_search' }], tool_choice: 'required' } : {}),
        ...api?.wire,
    });
    const bodyBytes = Buffer.byteLength(body);
    requireValue(bodyBytes <= maxBytes, 'request_capacity_exceeded');
    return { body, review: { executionId: input.executionId, requestId: input.requestId, configurationId: input.configurationId, providerId: input.providerId, model: input.model, contextDigest: input.contextDigest, bodyDigest: digest(body), bodyBytes, ...(api ? { api: api.binding } : {}) } };
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
    const written = record(value.input_tokens_details) ? value.input_tokens_details.cache_write_tokens : undefined;
    const reasoning = record(value.output_tokens_details) ? value.output_tokens_details.reasoning_tokens : undefined;
    return { source: 'provider-reported', inputTokens: Number(value.input_tokens), outputTokens: Number(value.output_tokens), totalTokens: Number(value.total_tokens),
        ...(Number.isSafeInteger(cached) && Number(cached) >= 0 && Number(cached) <= Number(value.input_tokens) ? { cachedInputTokens: Number(cached) } : {}),
        ...(Number.isSafeInteger(written) && Number(written) >= 0 && Number(written) <= Number(value.input_tokens) ? { cacheWriteInputTokens: Number(written) } : {}),
        ...(Number.isSafeInteger(reasoning) && Number(reasoning) >= 0 && Number(reasoning) <= Number(value.output_tokens) ? { reasoningOutputTokens: Number(reasoning) } : {}) };
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
        const observeTiming = this.options.observeTiming;
        const started = observeTiming ? performance.now() : null;
        let postAttemptMs: number | null = null, headersMs: number | null = null, firstSseBytesMs: number | null = null;
        const frozen = structuredClone(input), { body, review } = prepareResponsesTurn(frozen, this.limits.requestBytes);
        requireValue(!this.active.has(frozen.executionId), 'execution_already_in_flight');
        this.active.add(frozen.executionId);
        const controller = new AbortController(), result: TurnResult = { providerId: frozen.providerId, executionId: frozen.executionId, requestId: frozen.requestId, outcome: 'unknown', dispatched: false, partialText: '', cancellation: { requested: false, serverConfirmed: false }, taskVerified: false };
        if (frozen.api) result.api = { configurationVersion: frozen.api.configurationVersion, instructionVersion: frozen.api.instructionVersion, outputItems: [], toolCalls: [], recovery: {
            contract: 'aerynth.api-response-recovery@1', providerId: 'openai-api-vela', configurationId: frozen.configurationId, configurationVersion: frozen.api.configurationVersion,
            executionId: frozen.executionId, requestId: frozen.requestId, model: frozen.model, contextDigest: frozen.contextDigest, bodyDigest: review.bodyDigest, instructionVersion: frozen.api.instructionVersion,
            ...(frozen.api.retention ? { retention: structuredClone(frozen.api.retention) } : {}), tools: structuredClone(review.api!.tools) } };
        const isAllowedOutputItem = (item: unknown): item is Record<string, unknown> => record(item) && (item.type === 'message' || item.type === 'reasoning' || !!frozen.api && item.type === 'function_call' || frozen.webSearch === true && item.type === 'web_search_call');
        const calls = new Map<string, { callId: string; name: string; arguments: string; outputIndex: number; done: boolean }>();
        const outputItems = new Map<string, ApiResponseItem>();
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
            if (result.api) result.api.recovery = { ...result.api.recovery, boundaryDigest: credential.boundaryDigest };
            if (started !== null) postAttemptMs = performance.now() - started;
            const response = await abortable((this.options.fetch ?? fetch)(RESPONSES_ENDPOINT, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body, signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store' }), controller.signal);
            if (started !== null) headersMs = performance.now() - started;
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
            const acceptApiItem = async (value: unknown, terminalSnapshot = false): Promise<ApiResponseItem> => {
                const parsed = apiItem(value, review.api!.tools);
                const item = reconcileApiItem(outputItems.get(parsed.id),parsed,terminalSnapshot);
                const prospective = [...outputItems.values()].filter(previous => previous.id !== item.id).concat(item);
                requireValue(prospective.length <= 128 && Buffer.byteLength(JSON.stringify(prospective)) <= this.limits.outputBytes, 'output_capacity_exceeded');
                if (item.type === 'function_call') {
                    requireValue(result.responseId, 'api_response_identity_unobserved');
                    const tracked = calls.get(item.id);
                    requireValue(!tracked || tracked.callId === item.call_id && tracked.name === item.name && (!tracked.arguments || tracked.arguments === item.arguments), 'api_function_stream_mismatch');
                    requireValue(!result.api!.toolCalls.some(call => call.callId === item.call_id && call.itemId !== item.id), 'duplicate_api_tool_call');
                    if (!result.api!.toolCalls.some(call => call.itemId === item.id)) {
                        requireValue(result.api!.toolCalls.length < 16, 'api_function_capacity_exceeded');
                        const call = apiToolCall(item, { executionId: frozen.executionId, responseId: result.responseId, configurationVersion: frozen.api!.configurationVersion, contextDigest: frozen.contextDigest, tools: review.api!.tools });
                        result.api!.toolCalls.push(call);
                        await emit({ type: 'provider/function-call', providerId: 'openai-api-vela', executionId: frozen.executionId, call: structuredClone(call) });
                    }
                    if (tracked) tracked.done = true;
                }
                outputItems.set(item.id, item);
                requireValue(outputItems.size <= 128 && Buffer.byteLength(JSON.stringify([...outputItems.values()])) <= this.limits.outputBytes, 'output_capacity_exceeded');
                result.api!.outputItems = [...outputItems.values()];
                return item;
            };
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
                    if (result.api) result.api.recovery = { ...result.api.recovery, responseId: result.responseId };
                    await emit({ type: 'provider/response-created', providerId: frozen.providerId, executionId: frozen.executionId, responseId: event.response.id });
                }
                else if (['response.completed', 'response.incomplete', 'response.failed'].includes(event.type)) {
                    requireValue(record(event.response) && text(event.response.id, 256) && (!result.responseId || result.responseId === event.response.id), 'response_identity_mismatch');
                    result.responseId = event.response.id;
                    const expected = event.type.slice('response.'.length);
                    requireValue(event.response.status === expected, 'response_terminal_mismatch');
                    if (event.response.output !== undefined)
                        requireValue(Array.isArray(event.response.output) && event.response.output.length <= 128 && event.response.output.every(isAllowedOutputItem), 'unsupported_provider_output');
                    if (frozen.api) {
                        requireValue(result.api!.recovery.responseId === result.responseId && Array.isArray(event.response.output), 'api_response_identity_unobserved');
                        const terminalItems: ApiResponseItem[] = [];
                        for (const item of event.response.output) {
                            if (expected !== 'completed' && partialApiFunction(item, review.api!.tools)) continue;
                            terminalItems.push(await acceptApiItem(item,true));
                        }
                        requireValue(new Set(terminalItems.map(item => item.id)).size === terminalItems.length && outputItems.size === terminalItems.length, 'api_terminal_items_mismatch');
                        result.api!.outputItems = terminalItems;
                    }
                    result.outcome = expected as 'completed' | 'incomplete' | 'failed';
                    if (frozen.webSearch && expected === 'completed') result.webSearch = webSearchEvidence((event.response.output as Record<string, unknown>[] | undefined) ?? [], result.partialText);
                    result.reportedModel = typeof event.response.model === 'string' ? event.response.model : undefined;
                    result.usage = usage(event.response.usage);
                    if (result.usage)
                        await emit({ type: 'provider/usage', providerId: frozen.providerId, executionId: frozen.executionId, usage: result.usage });
                    if (expected === 'failed')
                        result.errorCode = terminalError(event.response.error);
                    if (expected === 'incomplete') {
                        result.errorCode = 'provider_incomplete';
                        const reason = record(event.response.incomplete_details) ? event.response.incomplete_details.reason : undefined;
                        if (reason === 'max_output_tokens' || reason === 'content_filter') result.incompleteReason = reason;
                    }
                    terminal = true;
                }
                else if (event.type === 'error') {
                    result.outcome = 'failed';
                    result.errorCode = terminalError(record(event.error) ? event.error : event);
                    terminal = true;
                }
                else if (['response.output_item.added', 'response.output_item.done'].includes(event.type)) {
                    requireValue(isAllowedOutputItem(event.item), 'unsupported_provider_output');
                    if (frozen.api && event.type === 'response.output_item.done') {
                        if (!partialApiFunction(event.item, review.api!.tools)) await acceptApiItem(event.item);
                    }
                    else if (frozen.api && event.item.type === 'function_call') {
                        const item = event.item;
                        requireValue(result.responseId && text(item.id, 256) && text(item.call_id, 256) && functionName(item.name) && review.api!.tools.some(tool => tool.name === item.name) && typeof item.arguments === 'string' && Buffer.byteLength(item.arguments) <= 65536 && Number.isSafeInteger(event.output_index) && Number(event.output_index) >= 0 && Number(event.output_index) < 128, 'unreviewed_api_function');
                        requireValue(!calls.has(item.id) && calls.size < 16 && ![...calls.values()].some(call => call.callId === item.call_id), 'duplicate_api_tool_call');
                        outputBytes += Buffer.byteLength(item.arguments);
                        requireValue(outputBytes <= this.limits.outputBytes, 'output_capacity_exceeded');
                        calls.set(item.id, { callId: item.call_id, name: item.name, arguments: item.arguments, outputIndex: Number(event.output_index), done: false });
                    }
                }
                else if (frozen.api && ['response.function_call_arguments.delta', 'response.function_call_arguments.done'].includes(event.type)) {
                    requireValue(typeof event.item_id === 'string' && Number.isSafeInteger(event.output_index), 'invalid_api_function_stream');
                    const call = calls.get(event.item_id);
                    requireValue(call && !call.done && call.outputIndex === event.output_index, 'invalid_api_function_stream');
                    if (event.type === 'response.function_call_arguments.delta') {
                        requireValue(typeof event.delta === 'string', 'invalid_api_function_arguments');
                        outputBytes += Buffer.byteLength(event.delta);
                        requireValue(outputBytes <= this.limits.outputBytes, 'output_capacity_exceeded');
                        call.arguments += event.delta;
                        requireValue(Buffer.byteLength(call.arguments) <= 65536, 'api_function_capacity_exceeded');
                        await emit({ type: 'provider/function-arguments-delta', providerId: 'openai-api-vela', executionId: frozen.executionId, itemId: event.item_id, callId: call.callId, name: call.name, delta: event.delta, configurationVersion: frozen.api.configurationVersion, contextDigest: frozen.contextDigest });
                    } else {
                        requireValue(typeof event.arguments === 'string' && (!call.arguments || call.arguments === event.arguments) && Buffer.byteLength(event.arguments) <= 65536, 'api_function_stream_mismatch');
                        call.arguments = event.arguments;
                    }
                }
                else if (event.type.startsWith('response.function_call_arguments.') || event.type.startsWith('response.mcp_') || !frozen.webSearch && event.type.startsWith('response.web_search_call.'))
                    throw new ProviderError('unsupported_provider_output');
            };
            while (!terminal) {
                const next = await abortable(reader.read(), controller.signal);
                if (next.done) {
                    decoder.decode();
                    break;
                }
                if (started !== null && firstSseBytesMs === null && next.value.length) firstSseBytesMs = performance.now() - started;
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
            if (started !== null) {
                try {
                    const observation: unknown = observeTiming?.({ postAttemptMs, headersMs, firstSseBytesMs, finishedMs: performance.now() - started });
                    if (observation instanceof Promise) void Promise.prototype.then.call(observation, undefined, () => {});
                }
                catch { /* Optional observation cannot change the transport outcome. */ }
            }
        }
    }
    /** Read/reconcile only an explicitly retained API response. Never reruns a turn. */
    async retrieve(reference: ApiRecoveryReference, signal?: AbortSignal): Promise<ApiRecoveryResult> { return this.recover('retrieve', reference, signal); }
    /** Server cancellation is available only for explicitly reviewed background runs. */
    async cancel(reference: ApiRecoveryReference, signal?: AbortSignal): Promise<ApiRecoveryResult> { return this.recover('cancel', reference, signal); }
    private async recover(operation: 'retrieve' | 'cancel', reference: ApiRecoveryReference, signal?: AbortSignal): Promise<ApiRecoveryResult> {
        const frozen = structuredClone(reference);
        requireValue(fields(frozen, ['contract', 'providerId', 'configurationId', 'configurationVersion', 'executionId', 'requestId', 'model', 'contextDigest', 'bodyDigest', 'instructionVersion', 'tools'], ['boundaryDigest', 'responseId', 'retention']) && frozen.contract === 'aerynth.api-response-recovery@1' && frozen.providerId === 'openai-api-vela' && [frozen.configurationId, frozen.executionId, frozen.requestId, frozen.model, frozen.instructionVersion].every(value => text(value)) && Number.isSafeInteger(frozen.configurationVersion) && frozen.configurationVersion > 0 && sha(frozen.contextDigest) && sha(frozen.bodyDigest) && (frozen.boundaryDigest === undefined || sha(frozen.boundaryDigest)) && (frozen.responseId === undefined || text(frozen.responseId, 256)) && Array.isArray(frozen.tools) && frozen.tools.length <= 16 && frozen.tools.every(tool => fields(tool, ['name', 'schemaDigest', 'authorizationRef']) && functionName(tool.name) && sha(tool.schemaDigest) && text(tool.authorizationRef)) && new Set(frozen.tools.map(tool => tool.name)).size === frozen.tools.length, 'invalid_api_recovery');
        const result: ApiRecoveryResult = { operation, state: 'unavailable', dispatched: false, serverCancellationConfirmed: false, taskVerified: false, ...(frozen.responseId ? { responseId: frozen.responseId } : {}) };
        const retention = frozen.retention;
        if (retention !== undefined) requireValue(fields(retention, ['store', 'background', 'authorizationRef']) && typeof retention.store === 'boolean' && typeof retention.background === 'boolean' && (retention.store || retention.background) && text(retention.authorizationRef), 'api_retention_review_required');
        if (!retention) { result.reason = 'not-retained'; return result; }
        if (operation === 'cancel' && !retention.background) { result.reason = 'not-background'; return result; }
        if (!frozen.responseId || !frozen.boundaryDigest) { result.reason = 'response-id-unavailable'; return result; }
        const activeId = 'api-recovery:' + frozen.executionId;
        requireValue(!this.active.has(activeId) && this.active.size < 16, 'execution_already_in_flight');
        this.active.add(activeId);
        const timeout = AbortSignal.timeout(this.limits.timeoutMs), abort = signal ? AbortSignal.any([signal, timeout]) : timeout;
        const review: DispatchReview = { executionId: frozen.executionId, requestId: frozen.requestId, configurationId: frozen.configurationId, providerId: 'openai-api-vela', model: frozen.model,
            contextDigest: frozen.contextDigest, bodyDigest: digest(JSON.stringify({ operation, responseId: frozen.responseId })), bodyBytes: 0,
            api: { configurationVersion: frozen.configurationVersion, instructionVersion: frozen.instructionVersion, tools: frozen.tools, retention },
            recovery: { operation, responseId: frozen.responseId, originalBodyDigest: frozen.bodyDigest } };
        try {
            await abortable(this.options.native.authorize(Object.freeze(review)), abort);
            const credential = structuredClone(await abortable(this.options.native.resolveCredential(frozen.configurationId, 'openai-api-vela'), abort));
            const headers = credentialHeaders(credential, 'openai-api-vela', this.options.now?.() ?? Date.now());
            requireValue(credential.boundaryDigest === frozen.boundaryDigest, 'credential_boundary_mismatch');
            await abortable(this.options.native.revalidate(review, credential.boundaryDigest), abort);
            credentialHeaders(credential, 'openai-api-vela', this.options.now?.() ?? Date.now());
            const endpoint = RESPONSES_ENDPOINT + '/' + encodeURIComponent(frozen.responseId) + (operation === 'cancel' ? '/cancel' : '');
            result.state = 'unknown'; result.dispatched = true;
            const response = await abortable((this.options.fetch ?? fetch)(endpoint, { method: operation === 'cancel' ? 'POST' : 'GET', headers: { ...headers, Accept: 'application/json' }, signal: abort, redirect: 'error', credentials: 'omit', cache: 'no-store' }), abort);
            if (!response.ok) { void response.body?.cancel().catch(() => {}); result.state = response.status >= 500 || response.status === 408 ? 'unknown' : 'failed'; result.errorCode = 'provider_recovery_unavailable'; return result; }
            requireValue(turnContentType(response) === 'json', 'invalid_recovery_response');
            const data = await boundedJSON(response, this.limits.outputBytes, abort);
            requireValue(record(data) && data.id === frozen.responseId && ['queued', 'in_progress', 'completed', 'incomplete', 'failed', 'cancelled'].includes(String(data.status)) && Array.isArray(data.output) && data.output.length <= 128 && (operation !== 'cancel' || data.background === true), 'invalid_recovery_response');
            const items = data.output.filter(item => data.status === 'completed' || !partialApiFunction(item, frozen.tools)).map(item => apiItem(item, frozen.tools));
            requireValue(new Set(items.map(item => item.id)).size === items.length, 'invalid_recovery_response');
            const calls = items.filter((item): item is Extract<ApiResponseItem, { type: 'function_call' }> => item.type === 'function_call').map(item => apiToolCall(item, { executionId: frozen.executionId, responseId: frozen.responseId!, configurationVersion: frozen.configurationVersion, contextDigest: frozen.contextDigest, tools: frozen.tools }));
            requireValue(calls.length <= 16 && new Set(calls.map(call => call.callId)).size === calls.length, 'duplicate_api_tool_call');
            await abortable(this.options.native.revalidate(review, credential.boundaryDigest), abort);
            result.state = 'observed'; result.responseStatus = data.status as NonNullable<ApiRecoveryResult['responseStatus']>;
            result.serverCancellationConfirmed = operation === 'cancel' && data.status === 'cancelled';
            result.outputItems = items; result.toolCalls = calls; result.usage = usage(data.usage);
            result.partialText = items.flatMap(item => item.type === 'message' ? item.content.filter((part): part is Extract<typeof part, { type: 'output_text' }> => part.type === 'output_text').map(part => part.text) : []).join('');
            result.refusalText = items.flatMap(item => item.type === 'message' ? item.content.filter((part): part is Extract<typeof part, { type: 'refusal' }> => part.type === 'refusal').map(part => part.refusal) : []).join('');
            return result;
        } catch (error) {
            result.state = result.dispatched ? 'unknown' : 'failed';
            result.errorCode = timeout.aborted ? 'provider_timeout' : signal?.aborted ? 'recovery_cancelled_locally' : error instanceof ProviderError ? error.code : 'provider_recovery_unavailable';
            return result;
        } finally { this.active.delete(activeId); }
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
