import { mcp } from './mcp.mjs';
import { MAX_SYNC_BYTES, validateProjection, storeProjection } from './sync.mjs';
import { proposedTask } from '../intake.mjs';
import { isRevision, readBounded } from './github.mjs';
import { cachedGitHub, cachedGitHubDetail } from './github-cache.mjs';
import { publishProposal } from './github-proposals.mjs';
import { changeProposal, operationId as UUID, proposalControl } from './proposal-controls.mjs';
import { ciAccess, ciStatus, submitCI } from './ci-controls.mjs';
import { combinedTelemetry, ingestTaskTelemetry, sha256, telemetryBaseline } from './task-telemetry.mjs';
import { telemetryTaskId } from '../telemetry-delta.mjs';

const MAX_PROPOSALS = 500;
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
    const publish = url.pathname.match(/^\/api\/tasks\/task_([a-f0-9-]+)\/publish$/);
    const control = url.pathname.match(/^\/api\/tasks\/(task_[a-f0-9-]+)\/control$/);
    const sync = url.pathname === '/api/sync';
    const automaticSync = url.pathname.startsWith('/api/task-telemetry/');
    const detailsRoute = url.pathname.match(/^\/api\/github\/(pulls|runs|histories)\/([1-9][0-9]*)$/);
    const detailId = detailsRoute ? Number(detailsRoute[2]) : null;
    const ciActions = url.pathname === '/api/github/actions';
    if (detailsRoute && !Number.isSafeInteger(detailId)) return error('Invalid GitHub detail ID', 400);
    if (!overview && !intake && !sync && !automaticSync && !publish && !detailsRoute && !control && !ciActions) return error('Not found', 404);
    const readOnly = overview || detailsRoute || ((control || automaticSync || ciActions) && request.method === 'GET');
    if (readOnly ? request.method !== 'GET' : request.method !== 'POST') {
      return error('Method not allowed', 405);
    }
    if (!readOnly && (request.headers.get('origin') !== url.origin ||
        ![null, 'same-origin'].includes(request.headers.get('sec-fetch-site')))) {
      return error('Same-origin request required', 403);
    }
    if (!readOnly && request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return error('Expected application/json', 415);
    }
    if (!env.DB) return error('Proposal storage unavailable', 503);

    if (ciActions) {
      const access = ciAccess(env, owner, verification);
      if (!access.enabled) return readOnly && !url.searchParams.has('operation')
        ? json({ access, operations: [] }) : error(access.reason, 403);
      const options = { db: env.DB, owner, fetcher, token: env.GITHUB_ACTIONS_TOKEN };
      if (readOnly) {
        const result = await ciStatus({ ...options, id: url.searchParams.get('operation') });
        return json({ access, ...result.body }, result.status);
      }
      let body;
      try { body = JSON.parse(await readBounded(request.body, 4096)); }
      catch (cause) { return error('Invalid CI operation payload', cause instanceof RangeError ? 413 : 400); }
      const result = await submitCI({ ...options, body });
      return json(result.body, result.status);
    }

    const syncScope = () => sha256(JSON.stringify(['observatory-telemetry-v1', owner, namespace]));
    if (automaticSync) {
      const id = decodeURIComponent(url.pathname.slice('/api/task-telemetry/'.length));
      if (!telemetryTaskId.test(id)) return error('Invalid telemetry Task ID', 400);
      if (request.headers.get('x-observatory-sync-scope') !== await syncScope()) {
        return error('Telemetry connection changed. Reload and reconnect.', 403);
      }
      if (readOnly) return json({ baseline: await telemetryBaseline(env.DB, owner, namespace, id) });
      let body;
      try { body = JSON.parse(await readBounded(request.body, MAX_SYNC_BYTES)); }
      catch (cause) { return error('Invalid telemetry update payload', cause instanceof RangeError ? 413 : 400); }
      const result = await ingestTaskTelemetry({ db: env.DB, owner, namespace, id, body, validate, validateEvent });
      return json(result.body, result.status);
    }

    if (control) {
      const id = control[1];
      if (!UUID.test(id.slice(5))) return error('Invalid proposal ID', 400);
      if (readOnly) {
        const row = await env.DB.prepare(`SELECT version, priority, receipts FROM proposals
          WHERE owner_id = ? AND namespace = ? AND task_id = ? AND github_state IS NULL`)
          .bind(owner, namespace, id).first();
        return row ? json(proposalControl(row)) : error('Private proposal not found', 404);
      }
      let action;
      try { action = JSON.parse(await readBounded(request.body, 128 * 1024)); }
      catch (cause) { return error('Invalid proposal action payload', cause instanceof RangeError ? 413 : 400); }
      const result = await changeProposal({ db: env.DB, owner, namespace, id, action, validate });
      return json(result.body, result.status);
    }

    if (publish) {
      if (verification !== null || !UUID.test(publish[1])) return error('Not found', 404);
      const github = await publishProposal(env.DB, fetcher, env.GITHUB_PROPOSAL_TOKEN, owner, 'task_' + publish[1], validate);
      return github ? json({ github }) : error('Proposal not found', 404);
    }
    const readToken = env.GITHUB_READ_TOKEN || env.GITHUB_PROPOSAL_TOKEN;
    if (detailsRoute) return json(await cachedGitHubDetail(env.DB, fetcher, readToken, detailsRoute[1], detailId));

    if (sync) {
      let projection;
      try { projection = validateProjection(JSON.parse(await readBounded(request.body, MAX_SYNC_BYTES)), validate, validateEvent); }
      catch (cause) { return error(cause instanceof RangeError ? 'Payload too large' : 'Invalid private projection', cause instanceof RangeError ? 413 : 400); }
      const saved = await storeProjection(env.DB, owner, namespace, projection);
      return saved ? json({ stored: true, authority: 'local-task-records', approval: 'not-granted' }) : error('Older/conflicting projection or verification namespace limit reached', 409);
    }
    if (overview) {
      const [snapshot, rows, projectionRow, taskTelemetry, telemetryScope] = await Promise.all([
        cachedGitHub(env.DB, fetcher, validate, readToken),
        env.DB.prepare('SELECT record, task_id, github_state, stale_revision, version, priority FROM proposals WHERE owner_id = ? AND namespace = ? ORDER BY created_at DESC, task_id DESC LIMIT ?')
          .bind(owner, namespace, MAX_PROPOSALS).all(),
        env.DB.prepare('SELECT payload FROM private_projection WHERE owner_id = ? AND namespace = ?').bind(owner, namespace).first(),
        env.DB.prepare('SELECT task_id, digest, received_at, payload FROM task_telemetry WHERE owner_id = ? AND namespace = ? ORDER BY received_at DESC, task_id')
          .bind(owner, namespace).all(),
        syncScope(),
      ]);
      const projection = combinedTelemetry(projectionRow ? JSON.parse(projectionRow.payload) : null, taskTelemetry.results);
      const projectedIds = new Set((projection?.records ?? []).map(r => r.record_type + ':' + r.id));
      const { items, ...recordCoverage } = snapshot.records;
      return json({
        schema_version: 1,
        revision: snapshot.main.revision ?? null,
        deployed_revision: sourceRevision,
        generated_at: new Date().toISOString(),
        source: 'GitHub main + private Sites records',
        records: [...items.map(item => item.record), ...rows.results.map(row => JSON.parse(row.record))].filter(r => !projectedIds.has(r.record_type + ':' + r.id)).concat(projection?.records ?? []),
        telemetry_scope: telemetryScope,
        execution: projection ? { authority: projection.authority, generated_at: projection.generated_at, events: projection.events,
          sources: projection.sources, coverage: projection.coverage, acceptance: 'imported records are not approval receipts' } : null,
        github: {
          ...snapshot,
          records: {
            ...recordCoverage,
            total: items.length,
            provenance: items.map(({ record, path, sha }) => ({ id: record.id, type: record.record_type, path, blob: sha })),
          },
        },
        proposals: {
          total: rows.results.length, limit: MAX_PROPOSALS, verification: verification !== null,
          publication_configured: Boolean(env.GITHUB_PROPOSAL_TOKEN),
          stale_revision_tasks: rows.results.filter(row => row.stale_revision === 1).map(row => row.task_id),
          publication: Object.fromEntries(rows.results.filter(row => row.github_state).map(row => [row.task_id, row.github_state])),
          controls: Object.fromEntries(rows.results.filter(row => !row.github_state && !projectedIds.has('task:' + row.task_id))
            .map(row => [row.task_id, { version: row.version, priority: row.priority }])),
        },
        telemetry_note: 'Unavailable measurements are not zero; PR merge does not imply task acceptance.',
      });
    }

    let body;
    try {
      body = JSON.parse(await readBounded(request.body, 64 * 1024));
    } catch (cause) {
      return cause instanceof RangeError ? error('Payload too large', 413) : error('Invalid JSON', 400);
    }
    const publicProposal = verification === null && request.headers.get('x-observatory-publish') === 'github';
    const requestId = request.headers.get('x-observatory-request-id');
    if (requestId !== null && !UUID.test(requestId)) return error('Invalid proposal request ID', 400);
    const existing = requestId && await env.DB.prepare(
      'SELECT record, github_state, stale_revision FROM proposals WHERE owner_id = ? AND namespace = ? AND task_id = ?',
    ).bind(owner, namespace, 'task_' + requestId).first();
    if (existing) {
      const task = JSON.parse(existing.record);
      const github = existing.github_state
        ? await publishProposal(env.DB, fetcher, env.GITHUB_PROPOSAL_TOKEN, owner, task.id, validate) : null;
      return json({ task, github, revision_was_stale: existing.stale_revision === 1 });
    }
    const { main } = await cachedGitHub(env.DB, fetcher, validate, readToken);
    const staleRevision = main.status === 'stale';
    const privateCachedRevision = staleRevision && !publicProposal && Boolean(main.observed_at);
    if (!isRevision(main.revision) || (main.status !== 'available' && !privateCachedRevision)) {
      return error('A known GitHub main revision is required. Public proposals need a current snapshot. Check the GitHub feed for retry details.', 503);
    }

    let task;
    try {
      task = proposedTask(body, main.revision, requestId ? () => requestId : undefined);
    } catch (cause) {
      return error(cause.message, 400);
    }
    if (!validate(task)) return error('Task did not match the engineering contract', 400);

    const result = await env.DB.prepare(`
      INSERT OR IGNORE INTO proposals (owner_id, namespace, task_id, created_at, record, github_state, stale_revision)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE
      (SELECT COUNT(*) FROM proposals WHERE owner_id = ? AND namespace = ?) < ?
    `).bind(owner, namespace, task.id, task.created_at, JSON.stringify(task), publicProposal ? 'pending' : null, Number(staleRevision), owner, namespace, MAX_PROPOSALS).run();
    if (result.meta.changes !== 1) return error('Proposal already submitted or proposal limit reached. Retry the same request to check.', 409);
    const github = publicProposal
      ? await publishProposal(env.DB, fetcher, env.GITHUB_PROPOSAL_TOKEN, owner, task.id, validate) : null;
    return json({
      task, github, revision_was_stale: staleRevision,
      storage: verification === null ? 'private-sites-d1' : 'isolated-verification-d1',
      note: 'Task is proposed. No execution or owner approval has been initiated.',
    }, 201);
  }

  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if(url.pathname === '/mcp') return mcp(request, env, {validate, validateEvent});
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
