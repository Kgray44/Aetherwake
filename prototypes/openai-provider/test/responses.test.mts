import test from 'node:test';
import assert from 'node:assert/strict';
import { ResponsesTransport, prepareResponsesTurn, fetchModelCatalog, RESPONSES_ENDPOINT, MODELS_ENDPOINT } from '../responses.mts';
import type { ModelCatalogDiagnostic, NativeCredential, NativeDispatchPort, TurnInput, TurnEvent } from '../contracts.mts';
import { digest } from '../common.mts';
const boundary = 'a'.repeat(64);
const input = (): TurnInput => ({ executionId: 'execution-1', requestId: 'request-1', configurationId: 'ordinary-profile', providerId: 'chatgpt-plan-responses', assistant: 'ordinary', model: 'fixture-model', instructions: 'Ordinary assistant instruction, no coding agent harness.', messages: [{ role: 'user', content: 'Hello\n世界' }], contextDigest: 'b'.repeat(64) });
const credential = (): NativeCredential => ({ providerId: 'chatgpt-plan-responses', kind: 'chatgpt-plan', boundaryDigest: boundary, bearer: 'synthetic-plan-token', scopes: ['chatgpt.tokens.use.direct'], expiresAt: Date.now() + 60000 });
function ports(overrides: Partial<NativeDispatchPort> = {}): NativeDispatchPort { return { authorize: async () => { }, resolveCredential: async () => credential(), resolveCatalog: async () => ({ boundaryDigest: boundary, expiresAt: Date.now() + 60000, models: ['fixture-model'] }), revalidate: async () => { }, ...overrides }; }
const frame = (event: unknown) => `event: ${(event as {
    type: string;
}).type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`;
const created = { type: 'response.created', response: { id: 'response-fixture', status: 'in_progress' } };
const delta = { type: 'response.output_text.delta', delta: 'Hello 世界' };
const completed = { type: 'response.completed', response: { id: 'response-fixture', status: 'completed', model: 'fixture-model', usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15, input_tokens_details: { cached_tokens: 4 } } } };
function stream(events: unknown[], chunk = 999999): Response { const bytes = Buffer.from(events.map(frame).join('')); let offset = 0; return new Response(new ReadableStream({ pull(controller) { if (offset >= bytes.length) {
        controller.close();
        return;
    } controller.enqueue(bytes.subarray(offset, offset += chunk)); } }), { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } }); }
function fixture(native = ports(), fetcher: typeof fetch = async () => stream([created, delta, completed]), limits = {}) { const events: TurnEvent[] = []; return { transport: new ResponsesTransport({ native, fetch: fetcher, onEvent: event => { events.push(event); }, limits }), events }; }
test('offline: exact approved egress, fixed endpoint, native identity, Unicode fragmented SSE and reported usage', async () => {
    let calls = 0;
    const prepared = prepareResponsesTurn(input());
    const { transport, events } = fixture(ports({ authorize: async (review) => { assert.equal(review.bodyDigest, digest(prepared.body)); assert.equal(review.bodyBytes, Buffer.byteLength(prepared.body)); } }), async (url, init) => { calls++; assert.equal(url, RESPONSES_ENDPOINT); assert.equal(init?.redirect, 'error'); assert.equal(init?.method, 'POST'); assert.equal(init?.body, prepared.body); const body = JSON.parse(String(init?.body)); assert.deepEqual(Object.keys(body), ['model', 'instructions', 'input', 'store', 'stream']); assert.equal(body.store, false); assert.equal(body.stream, true); assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer synthetic-plan-token'); return stream([created, delta, completed], 1); });
    const result = await transport.turn(input());
    assert.equal(calls, 1);
    assert.equal(result.outcome, 'completed');
    assert.equal(result.partialText, 'Hello 世界');
    assert.equal(result.taskVerified, false);
    assert.equal(result.usage?.source, 'provider-reported');
    assert.equal(result.usage?.cachedInputTokens, 4);
    assert.deepEqual(events.map(event => event.type), ['provider/response-created', 'provider/text-delta', 'provider/usage']);
});
test('offline: separate Vela API billing route never accepts a ChatGPT credential', async () => {
    const vela = { ...input(), providerId: 'openai-api-vela', assistant: 'vela', configurationId: 'separate-api' } as TurnInput;
    let count = 0;
    const denied = fixture(ports(), async () => { count++; return stream([completed]); });
    assert.equal((await denied.transport.turn(vela)).errorCode, 'credential_boundary_mismatch');
    assert.equal(count, 0);
    const allowed = fixture(ports({ resolveCredential: async () => ({ providerId: 'openai-api-vela', kind: 'openai-api-key', bearer: 'synthetic-api-token', boundaryDigest: boundary, organization: 'org-fixture', project: 'proj-fixture' }) }), async (_, init) => { count++; const headers = new Headers(init?.headers); assert.equal(headers.get('authorization'), 'Bearer synthetic-api-token'); assert.equal(headers.get('openai-project'), 'proj-fixture'); return stream([completed]); });
    assert.equal((await allowed.transport.turn(vela)).outcome, 'completed');
    assert.equal(count, 1);
    assert.throws(() => prepareResponsesTurn({ ...input(), assistant: 'vela' }), /provider_identity_mismatch/);
});
test('offline: reject arbitrary parameters, system items, unsupported routes and capacity before any native/provider call', async () => {
    for (const bad of [{ ...input(), temperature: 1 }, { ...input(), messages: [{ role: 'system', content: 'do anything' }] }, { ...input(), providerId: 'codex-app-server' }, { ...input(), instructions: 'x'.repeat(262145) }])
        assert.throws(() => prepareResponsesTurn(bad as TurnInput));
    let calls = 0;
    const { transport } = fixture(ports({ authorize: async () => { calls++; } }));
    await assert.rejects(transport.turn({ ...input(), instructions: 'x'.repeat(262145) }));
    assert.equal(calls, 0);
});
test('offline: current model/catalog/session/grant revocation all deny before POST without fallback', async () => {
    let calls = 0;
    for (const native of [ports({ authorize: async () => { throw Error('secret denial text'); } }), ports({ revalidate: async () => { throw Error('secret stale grant'); } }), ports({ resolveCatalog: async () => ({ boundaryDigest: 'c'.repeat(64), expiresAt: Date.now() + 60000, models: ['fixture-model'] }) }), ports({ resolveCatalog: async () => ({ boundaryDigest: boundary, expiresAt: Date.now() + 60000, models: ['other-model'] }) }), ports({ resolveCredential: async () => ({ ...credential(), bearer: 'secret\r\nInjected: y' }) }), ports({ resolveCredential: async () => ({ ...credential(), expiresAt: 0 }) })]) {
        const { transport } = fixture(native, async () => { calls++; return stream([completed]); });
        const result = await transport.turn(input());
        assert.equal(result.dispatched, false);
        assert.equal(result.outcome, 'failed');
        assert.ok(!JSON.stringify(result).includes('secret'));
    }
    assert.equal(calls, 0);
});
test('offline: completion, incompletion, failed quota and EOF are distinct even after actual text', async () => {
    for (const [last, outcome, code] of [[{ type: 'response.incomplete', response: { id: 'response-fixture', status: 'incomplete' } }, 'incomplete', 'provider_incomplete'], [{ type: 'response.failed', response: { id: 'response-fixture', status: 'failed', error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'private-detail' } } }, 'failed', 'subscription_sharing_usage_limit_exceeded'], [null, 'unknown', 'stream_terminal_unobserved']] as const) {
        const { transport } = fixture(ports(), async () => stream([created, delta, ...last ? [last] : []]));
        const result = await transport.turn(input());
        assert.equal(result.partialText, 'Hello 世界');
        assert.equal(result.outcome, outcome);
        assert.equal(result.errorCode, code);
        assert.ok(!JSON.stringify(result).includes('private-detail'));
    }
});
test('offline: refused text is distinct; no inferred tokens, task result or hosted tool execution', async () => {
    const { transport, events } = fixture(ports(), async () => stream([created, { type: 'response.refusal.delta', delta: 'Cannot comply.' }, { ...completed, response: { ...completed.response, usage: { input_tokens: -2 } } }]));
    const result = await transport.turn(input());
    assert.equal(result.refusalText, 'Cannot comply.');
    assert.equal(result.partialText, '');
    assert.equal(result.usage, undefined);
    assert.equal(events[1]?.type, 'provider/refusal-delta');
    const unsupported = fixture(ports(), async () => stream([{ type: 'response.output_item.added', item: { type: 'function_call', name: 'run-shell' } }]));
    assert.equal((await unsupported.transport.turn(input())).errorCode, 'unsupported_provider_output');
});
test('offline: per-event cap accepts a large chunk of multiple small events; stream and output caps fail honestly', async () => {
    const many = [created, ...Array.from({ length: 20 }, () => ({ type: 'response.output_text.delta', delta: 'a' })), completed];
    const one = fixture(ports(), async () => stream(many), { eventBytes: 512 });
    assert.equal((await one.transport.turn(input())).partialText, 'a'.repeat(20));
    for (const limits of [{ eventBytes: 32 }, { streamBytes: 32 }, { outputBytes: 2 }]) {
        const { transport } = fixture(ports(), async () => stream([created, delta, completed]), limits);
        const result = await transport.turn(input());
        assert.equal(result.outcome, 'unknown');
        assert.match(result.errorCode ?? '', /capacity_exceeded/);
    }
});
test('offline: pre-dispatch cancellation does not send; post-dispatch cancellation and timeout do not claim server cancellation', async () => {
    let count = 0;
    const aborted = new AbortController();
    aborted.abort();
    const noSend = fixture(ports(), async () => { count++; return stream([completed]); });
    assert.equal((await noSend.transport.turn(input(), aborted.signal)).outcome, 'cancelled-before-dispatch');
    assert.equal(count, 0);
    const controller = new AbortController();
    const { transport } = fixture(ports(), async () => new Response(new ReadableStream({ start(stream) { stream.enqueue(Buffer.from(frame(delta))); setTimeout(() => controller.abort(), 5); } }), { headers: { 'content-type': 'text/event-stream' } }));
    const result = await transport.turn(input(), controller.signal);
    assert.equal(result.outcome, 'unknown');
    assert.equal(result.cancellation.requested, true);
    assert.equal(result.cancellation.serverConfirmed, false);
    const timed = fixture(ports(), async () => new Response(new ReadableStream({}), { headers: { 'content-type': 'text/event-stream' } }), { timeoutMs: 5 });
    assert.equal((await timed.transport.turn(input())).errorCode, 'provider_timeout');
});
test('offline: concurrent execution is refused and native timeout cannot send late', async () => {
    let release!: () => void, count = 0;
    const { transport } = fixture(ports({ authorize: () => new Promise<void>(resolve => { release = resolve; }) }), async () => { count++; return stream([completed]); }, { timeoutMs: 10 });
    const first = transport.turn(input());
    await assert.rejects(transport.turn(input()), /execution_already_in_flight/);
    assert.equal((await first).dispatched, false);
    release();
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(count, 0);
});
test('offline: protocol mismatches, invalid JSON/UTF8 and mismatched response IDs remain unknown', async () => {
    for (const response of [stream([created, { ...completed, response: { ...completed.response, id: 'other-response' } }]), new Response('event: wrong\ndata: {"type":"response.completed"}\n\n', { headers: { 'content-type': 'text/event-stream' } }), new Response('data: nope\n\n', { headers: { 'content-type': 'text/event-stream' } }), new Response(Uint8Array.of(255), { headers: { 'content-type': 'text/event-stream' } }), new Response('{}', { headers: { 'content-type': 'application/json' } })]) {
        const { transport } = fixture(ports(), async () => response);
        assert.equal((await transport.turn(input())).outcome, 'unknown');
    }
});
test('offline: HTTP error bodies are sanitized, no automatic retry or billing fallback', async () => {
    for (const [status, outcome] of [[429, 'failed'], [503, 'unknown']] as const) {
        let calls = 0;
        const { transport } = fixture(ports(), async () => { calls++; return Response.json({ error: { code: 'rate_limit_exceeded', message: 'secret diagnostic' } }, { status }); });
        const result = await transport.turn(input());
        assert.equal(result.outcome, outcome);
        assert.equal(result.errorCode, 'rate_limit_exceeded');
        assert.equal(calls, 1);
        assert.ok(!JSON.stringify(result).includes('secret'));
    }
});
test('offline: catalog uses selected route token, preserves authorized order and labels entitlement unproved', async () => {
    let count = 0;
    const result = await fetchModelCatalog({ providerId: 'chatgpt-plan-responses', configurationId: 'ordinary-profile', resolveCredential: async () => credential(), fetch: async (url, init) => { count++; assert.equal(url, MODELS_ENDPOINT); assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer synthetic-plan-token'); return Response.json({ models: [{ slug: 'z', display_name: 'Z', visibility: 'list' }, { slug: 'hidden', display_name: 'Hidden', visibility: 'hide' }, { slug: 'a', display_name: 'A', visibility: 'list' }] }); } });
    assert.deepEqual(result.models.map(model => model.id), ['z', 'a']);
    assert.equal(result.catalogOnly, true);
    assert.equal(count, 1);
    await assert.rejects(fetchModelCatalog({ providerId: 'chatgpt-plan-responses', configurationId: 'x', resolveCredential: async () => credential(), fetch: async () => Response.json({ models: [{ slug: 'a', display_name: 'A', visibility: 'list' }, { slug: 'a', display_name: 'A', visibility: 'list' }] }) }), /ambiguous_model_catalog/);
});
test('offline: final dispatch rechecks expiry and terminal hidden tool output cannot be accepted as ordinary chat', async () => {
    let now = 1000, calls = 0;
    const native = ports({ resolveCredential: async () => ({ ...credential(), expiresAt: 2000 }), resolveCatalog: async () => ({ boundaryDigest: boundary, expiresAt: 2000, models: ['fixture-model'] }), revalidate: async () => { now = 2001; } });
    const transport = new ResponsesTransport({ native, now: () => now, onEvent: () => { }, fetch: async () => { calls++; return stream([completed]); } });
    assert.equal((await transport.turn(input())).dispatched, false);
    assert.equal(calls, 0);
    const hidden = fixture(ports(), async () => stream([{ ...completed, response: { ...completed.response, output: [{ type: 'function_call', name: 'execute' }] } }]));
    assert.equal((await hidden.transport.turn(input())).errorCode, 'unsupported_provider_output');
});

const catalogClock = 1700000000000;
const catalogBody = () => ({ models: [{ slug: 'private-model-z', display_name: 'Private model Z', visibility: 'list' }, { slug: 'private-hidden', display_name: 'Private hidden', visibility: 'hide' }, { slug: 'private-model-a', display_name: 'Private model A', visibility: 'list' }] });
async function observedCatalog(response: Response, observer?: (value: Readonly<ModelCatalogDiagnostic>) => void) {
    const diagnostics: Readonly<ModelCatalogDiagnostic>[] = []; let calls = 0;
    let result, error;
    try { result = await fetchModelCatalog({ providerId: 'chatgpt-plan-responses', configurationId: 'private-configuration', now: () => catalogClock, resolveCredential: async () => credential(), fetch: async (url, init) => { calls++; assert.equal(url, MODELS_ENDPOINT); assert.equal(init?.redirect, 'error'); assert.equal(init?.credentials, 'omit'); assert.equal(init?.cache, 'no-store'); return response; }, onDiagnostic: value => { diagnostics.push(value); return observer?.(value); } }); }
    catch (caught) { error = caught; }
    assert.equal(calls, 1); assert.equal(diagnostics.length, 1);
    const diagnostic = diagnostics[0]; assert.equal(Object.getPrototypeOf(diagnostic), null); assert.equal(Object.isFrozen(diagnostic), true);
    assert(Object.values(Object.getOwnPropertyDescriptors(diagnostic)).every(descriptor => 'value' in descriptor && descriptor.get === undefined && descriptor.set === undefined));
    return { result, error, diagnostic };
}

test('offline: catalog diagnostic is once-only frozen bodyless scalars with HTTP request identity and bounded returned/listed counts', async () => {
    const { result, error, diagnostic } = await observedCatalog(Response.json(catalogBody(), { headers: { 'x-request-id': 'req_catalog123' } }));
    assert.equal(error, undefined); assert.deepEqual(result?.models.map(model => model.id), ['private-model-z', 'private-model-a']);
    assert.deepEqual({ ...diagnostic }, { contract: 'aerynth.model-catalog-diagnostic@1', outcome: 'accepted', httpStatus: 200, serverRequestId: 'req_catalog123', bodyShape: 'models', remoteCode: null, returnedCount: 3, listedCount: 2, observedAt: catalogClock, responseBytes: Buffer.byteLength(JSON.stringify(catalogBody())) });
    const serialized = JSON.stringify(diagnostic); for (const secret of ['private-', 'synthetic-plan-token', boundary, 'Private model', 'Authorization', 'https://']) assert.equal(serialized.includes(secret), false);
});

test('offline: model GET HTTP403 retains only allowlisted code/status/request ID and preserves the catalog error', async () => {
    const { error, diagnostic } = await observedCatalog(Response.json({ error: { code: 'subscription_sharing_user_not_eligible', message: 'PRIVATE account/client/host and https://private.invalid/path', account_id: 'private-account' } }, { status: 403, headers: { 'x-request-id': 'req_denied123' } }), () => { throw Error('private observer failure'); });
    assert.match(String(error), /model_catalog_unavailable/); assert.equal(diagnostic.outcome, 'http-error'); assert.equal(diagnostic.httpStatus, 403); assert.equal(diagnostic.bodyShape, 'error'); assert.equal(diagnostic.remoteCode, 'subscription_sharing_user_not_eligible'); assert.equal(diagnostic.returnedCount, null); assert.equal(diagnostic.listedCount, null);
    assert.equal(JSON.stringify(diagnostic).includes('PRIVATE'), false); assert.equal(JSON.stringify(diagnostic).includes('private-account'), false);
    const unknown = await observedCatalog(Response.json({ error: { code: 'private-arbitrary-code', message: 'PRIVATE raw body' } }, { status: 403 })); assert.equal(unknown.diagnostic.remoteCode, null); assert.equal(unknown.diagnostic.serverRequestId, null);
});

test('offline: unstructured detail is classified without retaining its content or extracting a code from prose', async () => {
    for (const detail of ['PRIVATE subscription_sharing_user_not_eligible is mentioned in prose with account=secret', { message: 'PRIVATE detail', arbitrary: 'https://private.invalid' }]) {
        const { error, diagnostic } = await observedCatalog(Response.json({ detail }, { status: 403 })); assert.match(String(error), /model_catalog_unavailable/); assert.equal(diagnostic.bodyShape, 'detail'); assert.equal(diagnostic.remoteCode, null); assert.equal(diagnostic.httpStatus, 403); assert.equal(JSON.stringify(diagnostic).includes('PRIVATE'), false);
    }
    const structured = await observedCatalog(Response.json({ detail: { code: 'rate_limit_exceeded', message: 'PRIVATE' } }, { status: 429 })); assert.equal(structured.diagnostic.remoteCode, 'rate_limit_exceeded');
});

test('offline: HTTP200 malformed JSON/schema/duplicate catalog have distinct safe observations and preserve strict parser errors', async () => {
    const invalidJSON = await observedCatalog(new Response('{PRIVATE invalid JSON', { status: 200 })); assert.match(String(invalidJSON.error), /invalid_json_response/); assert.equal(invalidJSON.diagnostic.outcome, 'invalid-catalog'); assert.equal(invalidJSON.diagnostic.bodyShape, 'invalid-json'); assert.equal(invalidJSON.diagnostic.httpStatus, 200);
    const invalidDenied = await observedCatalog(new Response('{PRIVATE invalid JSON', { status: 403 })); assert.match(String(invalidDenied.error), /model_catalog_unavailable/); assert.equal(invalidDenied.diagnostic.outcome, 'http-error'); assert.equal(invalidDenied.diagnostic.bodyShape, 'invalid-json');
    const wrongRoute = await observedCatalog(Response.json({ data: [{ id: 'PRIVATE-api-model' }] })); assert.match(String(wrongRoute.error), /invalid_model_catalog/); assert.equal(wrongRoute.diagnostic.bodyShape, 'data'); assert.equal(wrongRoute.diagnostic.returnedCount, null);
    const badRow = await observedCatalog(Response.json({ models: [{ visibility: 'list', private: 'PRIVATE' }] })); assert.match(String(badRow.error), /invalid_model_catalog/); assert.equal(badRow.diagnostic.bodyShape, 'models'); assert.equal(badRow.diagnostic.listedCount, 1);
    const duplicate = await observedCatalog(Response.json({ models: [catalogBody().models[0], catalogBody().models[0]] })); assert.match(String(duplicate.error), /ambiguous_model_catalog/); assert.equal(duplicate.diagnostic.outcome, 'invalid-catalog'); assert.equal(duplicate.diagnostic.returnedCount, 2);
    const empty = await observedCatalog(Response.json({ models: [] })); assert.equal(empty.error, undefined); assert.equal(empty.diagnostic.outcome, 'accepted'); assert.equal(empty.diagnostic.listedCount, 0); assert.equal(empty.result?.catalogOnly, true);
});

test('offline: catalog diagnostic preserves byte/row ceilings and unavailable shape without retry or raw body on failure', async () => {
    const large = 'PRIVATE'.repeat(300000);
    const ok = await observedCatalog(new Response(large)); assert.match(String(ok.error), /response_capacity_exceeded/); assert.equal(ok.diagnostic.outcome, 'invalid-catalog'); assert.equal(ok.diagnostic.bodyShape, 'unavailable');
    const denied = await observedCatalog(new Response(large, { status: 403 })); assert.match(String(denied.error), /model_catalog_unavailable/); assert.equal(denied.diagnostic.outcome, 'http-error'); assert.equal(denied.diagnostic.bodyShape, 'unavailable');
    const rows = await observedCatalog(Response.json({ models: Array.from({ length: 2049 }, () => ({ visibility: 'hide' })) })); assert.match(String(rows.error), /invalid_model_catalog/); assert.equal(rows.diagnostic.returnedCount, null); assert.equal(rows.diagnostic.listedCount, null);
    const other = await observedCatalog(Response.json(['PRIVATE'])); assert.match(String(other.error), /invalid_model_catalog/); assert.equal(other.diagnostic.bodyShape, 'other');
});

test('offline: bounded account catalog metadata above the former 256 KiB ceiling projects only listed model identities', async () => {
    const body = { ...catalogBody(), metadata: 'PRIVATE'.repeat(50000) };
    const { result, error, diagnostic } = await observedCatalog(Response.json(body));
    assert.equal(error, undefined);
    assert.equal(diagnostic.outcome, 'accepted');
    assert.equal(diagnostic.responseBytes, Buffer.byteLength(JSON.stringify(body)));
    assert(diagnostic.responseBytes! > 262144 && diagnostic.responseBytes! < 2097152);
    assert.deepEqual(result?.models.map(row => row.id), ['private-model-z', 'private-model-a']);
    assert.equal(JSON.stringify(diagnostic).includes('PRIVATE'), false);
});

test('offline: server request ID rejects non-ASCII, URI/control data and credential echoes', async () => {
    for (const requestId of ['PRIVATE', 'req_space value', 'req_é', 'https://private.invalid', 'req_synthetic-plan-token', 'req_' + 'a'.repeat(129)]) {
        const { diagnostic } = await observedCatalog(Response.json(catalogBody(), { headers: { 'x-request-id': requestId } })); assert.equal(diagnostic.serverRequestId, null);
    }
    const control = Response.json(catalogBody()); Object.defineProperty(control, 'headers', { value: { get: (key: string) => { assert.equal(key, 'x-request-id'); return 'req_a\r\nPRIVATE'; } } }); assert.equal((await observedCatalog(control)).diagnostic.serverRequestId, null);
    const diagnostics: ModelCatalogDiagnostic[] = [], response = Response.json({ data: [{ id: 'private-api-model' }] }, { headers: { 'x-request-id': 'req_org-private' } });
    await fetchModelCatalog({ providerId: 'openai-api-vela', configurationId: 'private-vela', resolveCredential: async () => ({ providerId: 'openai-api-vela', kind: 'openai-api-key', bearer: 'private-api-key', boundaryDigest: boundary, organization: 'org-private', project: 'project-private' }), fetch: async () => response, onDiagnostic: value => { diagnostics.push(value); } });
    assert.equal(diagnostics[0].bodyShape, 'data'); assert.equal(diagnostics[0].serverRequestId, null); assert.equal(diagnostics[0].listedCount, 1);
});

test('offline: unavailable credential/fetch and 15s abort observations are isolated, once-only, and cannot leak exception messages', async () => {
    for (const stage of ['credential', 'fetch'] as const) {
        const observations: ModelCatalogDiagnostic[] = []; let fetches = 0;
        await assert.rejects(fetchModelCatalog({ providerId: 'chatgpt-plan-responses', configurationId: 'private', resolveCredential: async () => { if (stage === 'credential') throw Error('PRIVATE vault'); return credential(); }, fetch: async () => { fetches++; throw Error('PRIVATE network https://private.invalid'); }, onDiagnostic: value => { observations.push(value); } }));
        assert.equal(fetches, stage === 'fetch' ? 1 : 0); assert.equal(observations.length, 1); assert.equal(observations[0].outcome, 'unavailable'); assert.equal(observations[0].httpStatus, null); assert.equal(observations[0].bodyShape, 'unavailable'); assert.equal(JSON.stringify(observations).includes('PRIVATE'), false);
    }
    const original = AbortSignal.timeout, controller = new AbortController(), observations: ModelCatalogDiagnostic[] = []; let fetches = 0;
    try {
        AbortSignal.timeout = milliseconds => { assert.equal(milliseconds, 15000); return controller.signal; };
        await assert.rejects(fetchModelCatalog({ providerId: 'chatgpt-plan-responses', configurationId: 'private', resolveCredential: async () => credential(), fetch: async () => { fetches++; queueMicrotask(() => controller.abort()); return new Promise<Response>(() => {}); }, onDiagnostic: value => { observations.push(value); } }), /operation_aborted/);
        assert.equal(fetches, 1); assert.equal(observations.length, 1); assert.equal(observations[0].outcome, 'unavailable');
    } finally { AbortSignal.timeout = original; }
});

test('offline: diagnostic projection/serialization has no inherited payload getters and observer promises cannot reject the catalog', async () => {
    const response = Response.json(catalogBody()); let getters = 0; const keys = ['error', 'detail', 'toJSON'] as const, prior = keys.map(key => Object.getOwnPropertyDescriptor(Object.prototype, key));
    try {
        for (const key of keys) Object.defineProperty(Object.prototype, key, { configurable: true, get() { getters++; throw Error('PRIVATE getter must never be invoked'); } });
        const { error, diagnostic } = await observedCatalog(response, async () => { throw Error('PRIVATE async observer'); });
        assert.equal(error, undefined); assert.equal(JSON.stringify(diagnostic).includes('PRIVATE'), false); assert.equal(getters, 0);
        await new Promise(resolve => setImmediate(resolve));
    } finally { keys.forEach((key, index) => { if (prior[index]) Object.defineProperty(Object.prototype, key, prior[index]!); else delete (Object.prototype as Record<string, unknown>)[key]; }); }
    let thenGets = 0;
    const { error } = await observedCatalog(Response.json(catalogBody()), () => Object.defineProperty({}, 'then', { get() { thenGets++; throw Error('PRIVATE then getter'); } }));
    assert.equal(error, undefined); assert.equal(thenGets, 0);
});
