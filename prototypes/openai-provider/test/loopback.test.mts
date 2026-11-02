import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { connect } from 'node:net';
import { createLoopbackListener } from '../loopback.mts';
const state = 's'.repeat(43);
function get(uri: string, options: {
    method?: string;
    headers?: Record<string, string>;
    path?: string;
} = {}): Promise<{
    status: number;
    body: string;
}> { return new Promise((resolve, reject) => { const url = new URL(uri); const req = request({ hostname: '127.0.0.1', port: Number(url.port), path: options.path ?? url.pathname + url.search, method: options.method ?? 'GET', headers: options.headers ?? {}, timeout: 1000 }, response => { let body = ''; response.on('data', chunk => { body += String(chunk); if (body.length > 2048)
    req.destroy(); }); response.on('end', () => resolve({ status: response.statusCode ?? 0, body })); }); req.on('timeout', () => req.destroy(Error('fixture_timeout'))); req.on('error', reject); req.end(); }); }
test('offline real loopback: ephemeral127 listener proof, exact matching callback, one consumption and immediate native closure', async () => {
    const listener = await createLoopbackListener({ timeoutMs: 2000 });
    try {
        const binding = listener.binding;
        assert.match(binding.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
        await listener.assertBinding(structuredClone(binding));
        listener.bindAttempt('attempt-fixture', state);
        const callback = listener.waitCallback('attempt-fixture');
        const response = await get(binding.redirectUri + '?state=' + state + '&code=synthetic-code&client_id=synthetic-client');
        assert.equal(response.status, 200);
        assert.equal(response.body, 'You may return to Aerynth.');
        assert.equal(await callback, binding.redirectUri + '?state=' + state + '&code=synthetic-code&client_id=synthetic-client');
        assert.ok(!response.body.includes('synthetic-code'));
        await assert.rejects(listener.waitCallback('attempt-fixture'), /callback_attempt_unavailable/);
        await listener.assertBinding(binding);
        await listener.close();
        await assert.rejects(listener.assertBinding(binding), /callback_binding_unavailable/);
        await assert.rejects(get(binding.redirectUri));
    }
    finally {
        await listener.close();
    }
});
test('offline real loopback: method/host/path/body/state/duplicate/absoluteURL/fragment rejection does not consume valid attempt', async () => {
    const listener = await createLoopbackListener({ timeoutMs: 3000 });
    try {
        listener.bindAttempt('attempt-fixture', state);
        const correct = '/auth/callback?state=' + state + '&code=synthetic';
        for (const options of [{ method: 'POST' }, { headers: { Host: 'evil.example' } }, { headers: { 'Content-Length': '1' } }, { path: '/wrong?state=' + state }, { path: '/auth/callback?state=wrong' }, { path: correct + '&state=' + state }, { path: 'http://evil.example' + correct }, { path: correct + '#fragment' }] as {
            method?: string;
            headers?: Record<string, string>;
            path?: string;
        }[]) {
            const result = await get(listener.binding.redirectUri, { ...options, path: options.path ?? correct });
            assert.equal(result.status, 400);
            assert.ok(!result.body.includes(state));
        }
        const callback = listener.waitCallback('attempt-fixture');
        assert.equal((await get(listener.binding.redirectUri, { path: correct })).status, 200);
        assert.equal(await callback, listener.binding.redirectUri + '?state=' + state + '&code=synthetic');
    }
    finally {
        await listener.close();
    }
});
test('offline real loopback: URL/request budgets are bounded and foreign listener proof cannot authorize', async () => {
    const listener = await createLoopbackListener({ timeoutMs: 2000, maxRequests: 2, maxUrlBytes: 128 });
    try {
        await assert.rejects(listener.assertBinding({ ...listener.binding, id: 'forged' }), /callback_binding_unavailable/);
        listener.bindAttempt('attempt', state);
        await assert.rejects(listener.waitCallback('foreign-attempt'), /callback_attempt_unavailable/);
        const pending = listener.waitCallback('attempt');
        const observed = assert.rejects(pending, /callback_closed/);
        assert.equal((await get(listener.binding.redirectUri + '?state=' + state + '&code=' + 'x'.repeat(200))).status, 400);
        assert.equal((await get(listener.binding.redirectUri + '?state=bad')).status, 400);
        await get(listener.binding.redirectUri + '?state=bad').catch(() => { });
        await observed;
        await assert.rejects(listener.assertBinding(listener.binding), /callback_binding_unavailable/);
    }
    finally {
        await listener.close();
    }
});
test('offline real loopback: expiry/explicit cancel reject waiters, prevent rebinding and leave no listener', async () => {
    const expired = await createLoopbackListener({ timeoutMs: 25 });
    expired.bindAttempt('expired', state);
    await assert.rejects(expired.waitCallback('expired'), /callback_expired/);
    await assert.rejects(expired.assertBinding(expired.binding), /callback_binding_unavailable/);
    await expired.close();
    const cancelled = await createLoopbackListener({ timeoutMs: 2000 });
    cancelled.bindAttempt('cancelled', state);
    assert.throws(() => cancelled.bindAttempt('again', state), /callback_attempt_unavailable/);
    const wait = assert.rejects(cancelled.waitCallback('cancelled'), /callback_closed/);
    await cancelled.close();
    await wait;
    await assert.rejects(get(cancelled.binding.redirectUri));
});
test('offline real loopback: oversized raw HTTP headers cannot surface a callback', async () => {
    const listener = await createLoopbackListener({ timeoutMs: 2000 });
    try {
        listener.bindAttempt('attempt', state);
        const url = new URL(listener.binding.redirectUri);
        await new Promise<void>((resolve, reject) => { const socket = connect(Number(url.port), '127.0.0.1', () => socket.write('GET /auth/callback?state=' + state + ' HTTP/1.1\r\nHost: ' + url.host + '\r\nX-Huge: ' + 'x'.repeat(22000) + '\r\n\r\n')); socket.on('error', () => resolve()); socket.on('close', () => resolve()); socket.setTimeout(1000, () => { socket.destroy(); reject(Error('raw_fixture_timeout')); }); });
        await listener.assertBinding(listener.binding);
        const result = listener.waitCallback('attempt');
        const rejected = assert.rejects(result, /callback_closed/);
        await listener.close();
        await rejected;
    }
    finally {
        await listener.close();
    }
});
