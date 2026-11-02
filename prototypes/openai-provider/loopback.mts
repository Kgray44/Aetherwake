import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Socket } from 'node:net';
import type { CallbackBinding } from './contracts.mts';
import { ProviderError, requireValue, text } from './common.mts';
export interface NativeLoopbackListener {
    readonly binding: CallbackBinding;
    bindAttempt(attemptId: string, state: string): void;
    waitCallback(attemptId: string): Promise<string>;
    assertBinding(binding: CallbackBinding): Promise<void>;
    close(): Promise<void>;
}
/** Real native listener only. No browser, auth HTTP request, URL logger or app API. */
export async function createLoopbackListener(options: {
    timeoutMs?: number;
    maxRequests?: number;
    maxUrlBytes?: number;
} = {}): Promise<NativeLoopbackListener> {
    const limits = { timeoutMs: 300000, maxRequests: 32, maxUrlBytes: 16384, ...options };
    for (const [key, max] of Object.entries({ timeoutMs: 300000, maxRequests: 32, maxUrlBytes: 16384 }))
        requireValue(Number.isSafeInteger(limits[key as keyof typeof limits]) && limits[key as keyof typeof limits] > 0 && limits[key as keyof typeof limits] <= max, 'invalid_listener_limit');
    let phase: 'listening' | 'received' | 'closed' = 'listening', attempt: string | null = null, expectedState: string | null = null, read = false, requests = 0;
    let resolve!: (url: string) => void, reject!: (error: Error) => void;
    const callback = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
    void callback.catch(() => { });
    const sockets = new Set<Socket>(), expiresAt = Date.now() + limits.timeoutMs;
    const respond = (response: ServerResponse, status: number) => { response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Pragma': 'no-cache', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff', 'Connection': 'close' }); response.end(status === 200 ? 'You may return to Aerynth.' : 'Callback unavailable.'); };
    let binding: CallbackBinding;
    const server = createServer({ maxHeaderSize: 20000 }, (request: IncomingMessage, response: ServerResponse) => {
        requests++;
        if (requests > limits.maxRequests) {
            respond(response, 429);
            void close();
            return;
        }
        if (phase !== 'listening' || !attempt || !expectedState || Date.now() >= expiresAt) {
            respond(response, 410);
            return;
        }
        const url = request.url ?? '', rawHost = request.rawHeaders.filter((_, index) => index % 2 === 0).filter(value => value.toLowerCase() === 'host').length;
        if (request.socket.remoteAddress !== '127.0.0.1' || request.socket.localAddress !== '127.0.0.1' || request.method !== 'GET' || rawHost !== 1 || request.headers.host !== new URL(binding.redirectUri).host || request.headers['transfer-encoding'] !== undefined || request.headers['content-length'] !== undefined && request.headers['content-length'] !== '0' || Buffer.byteLength(url) > limits.maxUrlBytes || !url.startsWith('/auth/callback?')) {
            respond(response, 400);
            request.resume();
            return;
        }
        let parsed: URL;
        try {
            parsed = new URL(url, binding.redirectUri);
        }
        catch {
            respond(response, 400);
            return;
        }
        if (parsed.pathname !== '/auth/callback' || parsed.hash || parsed.searchParams.getAll('state').length !== 1) {
            respond(response, 400);
            return;
        }
        const received = Buffer.from(parsed.searchParams.get('state') ?? ''), expected = Buffer.from(expectedState);
        if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
            respond(response, 400);
            return;
        }
        phase = 'received';
        respond(response, 200);
        resolve(binding.redirectUri + parsed.search);
        server.close();
        server.closeIdleConnections();
    });
    server.maxHeadersCount = 32;
    server.maxRequestsPerSocket = 1;
    server.headersTimeout = 2000;
    server.requestTimeout = 2000;
    server.keepAliveTimeout = 1;
    server.setTimeout(2000, socket => socket.destroy());
    server.on('connection', socket => { if (sockets.size >= 8) {
        socket.destroy();
        return;
    } sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
    server.on('clientError', (_error, socket) => { socket.destroy(); });
    await new Promise<void>((yes, no) => { const fail = () => { server.close(); no(new ProviderError('loopback_listener_unavailable')); }; server.once('error', fail); server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => { server.off('error', fail); yes(); }); });
    const address = server.address();
    requireValue(address && typeof address !== 'string' && address.address === '127.0.0.1' && address.port > 0, 'loopback_listener_unavailable');
    binding = Object.freeze({ id: randomBytes(32).toString('base64url'), redirectUri: `http://127.0.0.1:${address.port}/auth/callback` });
    const timer = setTimeout(() => { reject(new ProviderError('callback_expired')); void close(); }, limits.timeoutMs);
    server.on('error', () => { reject(new ProviderError('loopback_listener_unavailable')); void close(); });
    async function close() { if (phase === 'closed')
        return; phase = 'closed'; clearTimeout(timer); reject(new ProviderError('callback_closed')); server.close(); server.closeAllConnections(); for (const socket of sockets)
        socket.destroy(); sockets.clear(); }
    return { binding, bindAttempt: (id, state) => { requireValue(phase === 'listening' && Date.now() < expiresAt && attempt === null && text(id) && /^[A-Za-z0-9_-]{32,128}$/.test(state), 'callback_attempt_unavailable'); attempt = id; expectedState = state; }, waitCallback: async (id) => { requireValue(attempt === id && !read && phase !== 'closed', 'callback_attempt_unavailable'); read = true; return callback; }, assertBinding: async (value) => { requireValue(phase !== 'closed' && Date.now() < expiresAt && value.id === binding.id && value.redirectUri === binding.redirectUri, 'callback_binding_unavailable'); }, close };
}
