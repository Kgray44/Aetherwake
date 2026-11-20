import { AUTH_REASON, githubSnapshot, RATE_REASON, unavailablePullTotals } from './github.mjs';
import { fetchGitHubDetail } from './github-detail.mjs';
import { parseActivityHref,taskActivityHref } from '../src/github-activity.mjs';

const GROUPS = ['main', 'records', 'issues', 'pulls', 'ci'];
const REFRESH_MS = 15 * 60 * 1000;
const FAILURE_RETRY_MS = 60 * 1000;
const LEASE_MS = 30 * 1000;
const MISSING = 'GitHub read credential unavailable';
const UNCERTAIN = 'GitHub read credential awaiting verification';

const apiStatus = authentication => ({ authentication, remaining: null, limit: null, reset_at: null, observed_at: null });
const unavailable = reason => ({ status: 'unavailable', reason, items: [] });

async function credentialKey(token) {
  if (!token) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function retain(snapshot, group, reason) {
  const source = snapshot?.[group];
  return source?.observed_at ? { ...source, status: 'stale', reason } : unavailable(reason);
}

function pending(row, key, now) {
  const old = row.snapshot && JSON.parse(row.snapshot);
  const lost = key === null && row.auth_mode === 'authenticated';
  const changed = key !== row.credential_key;
  const rejected = key !== null && row.read_reject_key === key && row.read_reject_until > now;
  const rateLimited = row.rate_until > now;
  if (old && !lost && !changed && !rejected && !rateLimited) {
    return {
      ...old,
      pulls:{...old.pulls, totals:old.pulls?.totals ?? unavailablePullTotals('GitHub PR totals awaiting refresh')},
      ci:{...old.ci, repository_total:old.ci?.repository_total ?? null},
      api:old.api ?? apiStatus(key === null ? 'anonymous' : 'unverified'),
    };
  }
  const reason = lost ? MISSING : rejected ? AUTH_REASON : rateLimited ? RATE_REASON : changed ? UNCERTAIN : 'GitHub refresh in progress';
  const result = {
    repository: 'Kgray44/Aetherwake', page_size: 12, checked_at: old?.checked_at ?? null,
    retry_at: row.rate_until > now ? row.rate_until : null, api: rejected ? apiStatus('rejected') : old?.api && !changed && !lost ? old.api : apiStatus(lost ? 'missing' : key === null ? 'anonymous' : 'unverified'),
  };
  for (const group of GROUPS) result[group] = retain(old, group, reason);
  const priorTotals = old?.pulls?.totals;
  // Preserve the own status of a total already served by this credential.
  // A repository-wide cooldown can also apply when that subquery was absent.
  result.pulls.totals = !lost && !changed && !rejected && priorTotals && priorTotals.status !== 'available'
    ? priorTotals : unavailablePullTotals(reason, priorTotals);
  result.ci.repository_total ??= null;
  return result;
}

export async function peekGitHub(db, token, now = Date.now()) {
  const key = await credentialKey(token);
  const row = await db.prepare(`
    SELECT snapshot, auth_mode, credential_key, retry_at, lease_until, rate_until, read_reject_key, read_reject_until
    FROM github_snapshot WHERE id = 1
  `).bind().first();
  const refresh = !row || (
    !(key === null && row.auth_mode === 'authenticated') &&
    row.rate_until <= now && !(key !== null && row.read_reject_key === key && row.read_reject_until > now) &&
    (row.retry_at <= now || row.credential_key !== key)
  );
  const snapshot = pending(row ?? { credential_key:key }, key, now);
  if (refresh) {
    for (const group of GROUPS) {
      if (snapshot[group]?.status === 'available') snapshot[group] = {...snapshot[group],status:'stale',reason:'Refreshing GitHub data'};
    }
  }
  return { snapshot, refresh };
}

export async function cachedGitHub(db, fetcher, validate, token, now = Date.now()) {
  const key = await credentialKey(token);
  const mode = key === null ? 'anonymous' : 'authenticated';
  const lease = now + LEASE_MS;
  const started = performance.now();
  const clock = () => Math.round(now + performance.now() - started);

  // Qualify a single shared lease separately from the retry deadline. Mark prior
  // configured credentials durably so absence cannot downgrade subsequent reads.
  const claim = await db.prepare(`
    INSERT INTO github_snapshot (id, auth_mode, retry_at, lease_until) VALUES (1, ?, 0, ?)
    ON CONFLICT(id) DO UPDATE SET auth_mode = excluded.auth_mode, lease_until = excluded.lease_until
    WHERE github_snapshot.lease_until <= ? AND github_snapshot.rate_until <= ?
      AND (github_snapshot.read_reject_until <= ? OR github_snapshot.read_reject_key IS NOT ?)
      AND (github_snapshot.retry_at <= ? OR github_snapshot.credential_key IS NOT ?
        OR json_type(github_snapshot.snapshot, '$.pulls.totals') IS NULL)
      AND NOT (github_snapshot.auth_mode = 'authenticated' AND excluded.auth_mode = 'anonymous')
    RETURNING snapshot, credential_key, validators, rate_failures
  `).bind(mode, lease, now, now, now, key, now, key).first();
  if (!claim) {
    const row = await db.prepare('SELECT snapshot, auth_mode, credential_key, rate_until, read_reject_key, read_reject_until FROM github_snapshot WHERE id = ?').bind(1).first();
    return pending(row, key, now);
  }

  const old = claim.snapshot && JSON.parse(claim.snapshot);
  const sameCredential = claim.credential_key === key;
  const { snapshot, validators, rateFailures } = await githubSnapshot(fetcher, validate, token, {
    now: clock,
    previous: old,
    oldValidators: sameCredential ? JSON.parse(claim.validators) : {},
    previousApi: sameCredential ? old?.api : null,
    previousFailures: claim.rate_failures,
  });
  const incomingTotals = snapshot.pulls.totals;
  let hasFailure = false;
  for (const group of GROUPS) {
    const incoming = snapshot[group];
    // Do not discard a complete, pinned record set when a newer read misses any files.
    if (incoming.status === 'unavailable' || (group === 'records' && incoming.errors?.length && old?.records?.observed_at)) {
      hasFailure = true;
      snapshot[group] = retain(old, group, incoming.reason || 'GitHub records refresh incomplete');
    }
  }
  snapshot.pulls.totals = incomingTotals.status === 'available'
    ? incomingTotals : unavailablePullTotals(incomingTotals.reason, old?.pulls?.totals);
  snapshot.ci.repository_total ??= null;
  const retryDelay = snapshot.api.authentication !== 'rejected' && hasFailure ? FAILURE_RETRY_MS : REFRESH_MS;
  const next = snapshot.retry_at || (Date.parse(snapshot.checked_at) + retryDelay);
  await db.prepare(`
    UPDATE github_snapshot SET retry_at = ?, snapshot = ?, lease_until = 0, credential_key = ?, validators = ?,
      rate_until = ?, rate_failures = ?
    WHERE id = 1 AND lease_until = ? AND auth_mode = ?
  `).bind(next, JSON.stringify(snapshot), key, JSON.stringify(validators), snapshot.retry_at ?? 0, rateFailures, lease, mode).run();
  return snapshot;
}

function detailFallback(old, reason) {
  return old?.detail
    ? { ...old, status: 'stale', reason }
    : { detail: null, status: 'unavailable', observed_at: null, reason };
}

export async function peekTaskGitHubDetails(db, token, references, now = Date.now()) {
  if (!token) return [];
  const keys = [...new Set(references.flatMap(({uri})=>{
    const route = parseActivityHref(taskActivityHref(uri)??'');
    return route?.id ? [route.kind+':'+route.id] : [];
  }))].slice(0,32);
  if (!keys.length) return [];
  const key = await credentialKey(token);
  const placeholders = keys.map(()=>'?').join(',');
  const {results} = await db.prepare(
    'SELECT cache_key, retry_at, payload FROM github_details WHERE credential_key = ? AND cache_key IN ('+placeholders+')'
  ).bind(key,...keys).all();
  return results.flatMap(row=>{
    const snapshot = JSON.parse(row.payload);
    const detail = snapshot.detail;
    if (!detail || !snapshot.observed_at) return [];
    const status = row.retry_at <= now ? 'stale' : snapshot.status;
    const common = {cache_key:row.cache_key,status,observed_at:snapshot.observed_at};
    if (detail.kind==='pull') return [{...common,number:detail.number,title:detail.title,state:detail.state,
      created_at:detail.created_at,updated_at:detail.updated_at,closed_at:detail.closed_at,merged_at:detail.merged_at,
      merge_commit_sha:detail.merge_commit_sha,
      commit_items:detail.commit_items,commit_head:detail.head?.sha,
      commits_observed_at:detail.commits_observed_at,commits_status:status==='stale'&&detail.commits_observed_at?'stale':detail.commits_status,
      reviews:detail.reviews?.map(({id,state,submitted_at})=>({id,state,submitted_at})),
      reviews_observed_at:detail.reviews_observed_at,reviews_status:status==='stale'?'stale':detail.reviews_status}];
    if (detail.kind!=='run') return [];
    return [{...common,id:detail.id,title:detail.title,revision:detail.head?.sha,attempt:detail.attempt,
      created_at:detail.created_at,started_at:detail.started_at,updated_at:detail.updated_at,
      run_status:detail.status,conclusion:detail.conclusion,
      jobs_observed_at:detail.jobs_observed_at,jobs_stale:status==='stale'||detail.jobs_stale,
      jobs:detail.jobs?.map(({id,name,status,conclusion,started_at,completed_at})=>({id,name,status,conclusion,started_at,completed_at}))}];
  });
}

export async function cachedGitHubDetail(db, fetcher, token, kind, id, now = Date.now()) {
  if (!['pulls', 'runs', 'histories'].includes(kind) || !Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid GitHub detail identity');
  const key = await credentialKey(token);
  const cacheKey = kind + ':' + id;
  const read = () => db.prepare('SELECT credential_key, retry_at, payload, validators FROM github_details WHERE cache_key = ?')
    .bind(cacheKey).first();
  const parsed = row => row ? JSON.parse(row.payload) : null;
  const row = await read();
  if (!key) return detailFallback(parsed(row), MISSING);
  if (row?.credential_key === key && row.retry_at > now) return parsed(row);

  const lease = now + LEASE_MS;
  const started = performance.now();
  const clock = () => Math.round(now + performance.now() - started);
  // The list snapshot and detail tables share one durable repository lease and
  // rate cooldown. A compare against the detail retry also closes the race
  // where a different Worker wins and persists the same request before we claim.
  const claim = await db.prepare(
    "INSERT INTO github_snapshot(id, auth_mode, retry_at, lease_until) VALUES (1, 'authenticated', 0, ?)" +
    " ON CONFLICT(id) DO UPDATE SET auth_mode = 'authenticated', lease_until = excluded.lease_until" +
    " WHERE github_snapshot.lease_until <= ? AND github_snapshot.rate_until <= ?" +
    " AND (github_snapshot.read_reject_until <= ? OR github_snapshot.read_reject_key IS NOT ?)" +
    " AND NOT (github_snapshot.credential_key IS ? AND github_snapshot.retry_at > ?" +
    " AND COALESCE(json_extract(github_snapshot.snapshot, '$.api.authentication'), '') = 'rejected')" +
    " AND NOT EXISTS (SELECT 1 FROM github_details WHERE cache_key = ? AND credential_key = ? AND retry_at > ?)" +
    " RETURNING rate_failures"
  ).bind(lease, now, now, now, key, key, now, cacheKey, key, now).first();
  if (!claim) {
    const latest = await read();
    if (latest?.credential_key === key && latest.retry_at > now) return parsed(latest);
    const state = await db.prepare('SELECT rate_until, read_reject_key, read_reject_until, credential_key, retry_at, snapshot FROM github_snapshot WHERE id = ?').bind(1).first();
    const blocked = (state?.read_reject_key === key && state.read_reject_until > now) ||
      (state?.credential_key === key && state.retry_at > now && state.snapshot && JSON.parse(state.snapshot).api?.authentication === 'rejected');
    const reason = state?.rate_until > now ? RATE_REASON : blocked ? AUTH_REASON : 'GitHub refresh in progress';
    return detailFallback(parsed(latest), reason);
  }
  const old = parsed(row);
  const sameCredential = row?.credential_key === key;
  const { result, validators, retryAt, rateFailures, api } = await fetchGitHubDetail(fetcher, token, kind, id, {
    now: clock, previous: sameCredential ? old?.detail : null,
    validators: sameCredential ? JSON.parse(row.validators) : {}, previousFailures: claim.rate_failures,
  });
  const payload = result.detail ? result : detailFallback(old, result.reason);
  const at = clock();
  const rejected = api.authentication === 'rejected';
  const delay = payload.status === 'available' || rejected || result.reason?.includes('exceeded the display limit') ? REFRESH_MS : FAILURE_RETRY_MS;
  await db.prepare(
    'INSERT INTO github_details(cache_key, credential_key, retry_at, stored_at, payload, validators)' +
    ' SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM github_snapshot WHERE id = 1 AND lease_until = ?)' +
    ' ON CONFLICT(cache_key) DO UPDATE SET credential_key = excluded.credential_key, retry_at = excluded.retry_at,' +
    ' stored_at = excluded.stored_at, payload = excluded.payload, validators = excluded.validators'
  ).bind(cacheKey, key, retryAt || at + delay, at, JSON.stringify(payload),
    JSON.stringify(result.detail ? validators : sameCredential ? JSON.parse(row.validators) : {}), lease).run();
  await db.prepare(
    'DELETE FROM github_details WHERE cache_key IN (SELECT cache_key FROM github_details ORDER BY stored_at DESC, cache_key LIMIT -1 OFFSET 128)'
  ).bind().run();
  await db.prepare(
    'UPDATE github_snapshot SET lease_until = 0, rate_until = ?, rate_failures = ?,' +
    ' read_reject_key = CASE WHEN ? IS NULL THEN read_reject_key ELSE ? END,' +
    ' read_reject_until = CASE WHEN ? = 0 THEN read_reject_until ELSE ? END' +
    ' WHERE id = 1 AND lease_until = ?'
  ).bind(retryAt, rateFailures, rejected ? key : null, rejected ? key : null, rejected ? at + REFRESH_MS : 0,
    rejected ? at + REFRESH_MS : 0, lease).run();
  return payload;
}
