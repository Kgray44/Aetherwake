import { MAX_SYNC_BYTES, validateProjection, storeProjection } from './sync.mjs';
import { proposedTask } from '../intake.mjs';
import { isRevision, readBounded } from './github.mjs';
import { cachedGitHub } from './github-cache.mjs';

const MAX_PROPOSALS = 500;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'private, no-store',
  'x-content-type-options': 'nosniff',
};
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
const error = (message, status) => json({ error: message }, status);

export function createWorker({ assets, validate, sourceRevision, validateEvent, fetcher = fetch }) {
  async function api(request, env, url) {
    // Sites dispatch sets this header after authenticating the visitor and applying
    // the owner-only access policy. Service credentials lack visitor identity.
    const owner = request.headers.get('oai-authenticated-user-id');
    if (!owner) return error('ChatGPT sign-in required', 401);

    const verification = request.headers.get('x-observatory-verification');
    if (verification !== null && !UUID.test(verification)) return error('Invalid verification namespace', 400);
    const namespace = verification === null ? 'live' : 'verification:' + verification;
    const overview = url.pathname === '/api/overview';
    const intake = url.pathname === '/api/tasks';
    const sync = url.pathname === '/api/sync';
    if (!overview && !intake && !sync) return error('Not found', 404);
    if (overview ? request.method !== 'GET' : request.method !== 'POST') {
      return error('Method not allowed', 405);
    }
    if ((intake || sync) && (request.headers.get('origin') !== url.origin ||
        ![null, 'same-origin'].includes(request.headers.get('sec-fetch-site')))) {
      return error('Same-origin request required', 403);
    }
    if ((intake || sync) && request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return error('Expected application/json', 415);
    }
    if (!env.DB) return error('Proposal storage unavailable', 503);

    if (sync) {
      let projection;
      try { projection = validateProjection(JSON.parse(await readBounded(request.body, MAX_SYNC_BYTES)), validate, validateEvent); }
      catch (cause) { return error(cause instanceof RangeError ? 'Payload too large' : 'Invalid private projection', cause instanceof RangeError ? 413 : 400); }
      const saved = await storeProjection(env.DB, owner, namespace, projection);
      return saved ? json({ stored: true, authority: 'local-task-records', approval: 'not-granted' }) : error('Older or conflicting projection', 409);
    }
    if (overview) {
      const [snapshot, rows, projectionRow] = await Promise.all([
        cachedGitHub(env.DB, fetcher, validate, env.GITHUB_READ_TOKEN),
        env.DB.prepare('SELECT record FROM proposals WHERE owner_id = ? AND namespace = ? ORDER BY created_at DESC, task_id DESC LIMIT ?')
          .bind(owner, namespace, MAX_PROPOSALS).all(),
        env.DB.prepare('SELECT payload FROM private_projection WHERE owner_id = ? AND namespace = ?').bind(owner, namespace).first(),
      ]);
      const projection = projectionRow ? JSON.parse(projectionRow.payload) : null;
      const projectedIds = new Set((projection?.records ?? []).map(r => r.record_type + ':' + r.id));
      const { items, ...recordCoverage } = snapshot.records;
      return json({
        schema_version: 1,
        revision: snapshot.main.revision ?? null,
        deployed_revision: sourceRevision,
        generated_at: new Date().toISOString(),
        source: 'GitHub main + private Sites records',
        records: [...items.map(item => item.record), ...rows.results.map(row => JSON.parse(row.record))].filter(r => !projectedIds.has(r.record_type + ':' + r.id)).concat(projection?.records ?? []),
        execution: projection ? { authority: projection.authority, generated_at: projection.generated_at, events: projection.events, coverage: projection.coverage, acceptance: 'imported records are not approval receipts' } : null,
        github: {
          ...snapshot,
          records: {
            ...recordCoverage,
            total: items.length,
            provenance: items.map(({ record, path, sha }) => ({ id: record.id, type: record.record_type, path, blob: sha })),
          },
        },
        proposals: { total: rows.results.length, limit: MAX_PROPOSALS, verification: verification !== null },
        telemetry_note: 'Unavailable measurements are not zero; PR merge does not imply task acceptance.',
      });
    }

    let body;
    try {
      body = JSON.parse(await readBounded(request.body, 64 * 1024));
    } catch (cause) {
      return cause instanceof RangeError ? error('Payload too large', 413) : error('Invalid JSON', 400);
    }
    const { main } = await cachedGitHub(env.DB, fetcher, validate, env.GITHUB_READ_TOKEN);
    if (main.status !== 'available' || !isRevision(main.revision)) {
      return error('A current GitHub main revision is required before submitting. Check the GitHub feed for retry details.', 503);
    }

    let task;
    try {
      task = proposedTask(body, main.revision);
    } catch (cause) {
      return error(cause.message, 400);
    }
    if (!validate(task)) return error('Task did not match the engineering contract', 400);

    const result = await env.DB.prepare(`
      INSERT INTO proposals (owner_id, namespace, task_id, created_at, record)
      SELECT ?, ?, ?, ?, ? WHERE
      (SELECT COUNT(*) FROM proposals WHERE owner_id = ? AND namespace = ?) < ?
    `).bind(owner, namespace, task.id, task.created_at, JSON.stringify(task), owner, namespace, MAX_PROPOSALS).run();
    if (result.meta.changes !== 1) return error('Proposal limit reached', 409);
    return json({
      task,
      storage: verification === null ? 'private-sites-d1' : 'isolated-verification-d1',
      note: 'Task is proposed. No execution or owner approval has been initiated.',
    }, 201);
  }

  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        try { return await api(request, env, url); }
        catch { return error('Observatory data temporarily unavailable', 503); }
      }
      if (!['GET', 'HEAD'].includes(request.method)) return error('Method not allowed', 405);
      const asset = Object.hasOwn(assets, url.pathname) && assets[url.pathname];
      if (!asset) return error('Not found', 404);
      return new Response(request.method === 'HEAD' ? null : asset.content, {
        headers: {
          'content-type': asset.type,
          'content-security-policy': CSP,
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
        },
      });
    },
  };
}

