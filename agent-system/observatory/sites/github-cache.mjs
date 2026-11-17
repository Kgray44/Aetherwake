import { githubSnapshot } from './github.mjs';

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
  if (old && !lost && !changed) {
    return { ...old, api: old.api ?? apiStatus(key === null ? 'anonymous' : 'unverified') };
  }
  const reason = lost ? MISSING : changed ? UNCERTAIN : 'GitHub refresh in progress';
  const result = {
    repository: 'Kgray44/Aetherwake', page_size: 12, checked_at: old?.checked_at ?? null,
    retry_at: row.rate_until > now ? row.rate_until : null, api: apiStatus(lost ? 'missing' : key === null ? 'anonymous' : 'unverified'),
  };
  for (const group of GROUPS) result[group] = retain(old, group, reason);
  return result;
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
      AND (github_snapshot.retry_at <= ? OR github_snapshot.credential_key IS NOT ?)
      AND NOT (github_snapshot.auth_mode = 'authenticated' AND excluded.auth_mode = 'anonymous')
    RETURNING snapshot, credential_key, validators, rate_failures
  `).bind(mode, lease, now, now, now, key).first();
  if (!claim) {
    const row = await db.prepare('SELECT snapshot, auth_mode, credential_key, rate_until FROM github_snapshot WHERE id = ?').bind(1).first();
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
  let hasFailure = false;
  for (const group of GROUPS) {
    const incoming = snapshot[group];
    // Do not discard a complete, pinned record set when a newer read misses any files.
    if (incoming.status === 'unavailable' || (group === 'records' && incoming.errors?.length && old?.records?.observed_at)) {
      hasFailure = true;
      snapshot[group] = retain(old, group, incoming.reason || 'GitHub records refresh incomplete');
    }
  }
  const retryDelay = snapshot.api.authentication !== 'rejected' && hasFailure ? FAILURE_RETRY_MS : REFRESH_MS;
  const next = snapshot.retry_at || (Date.parse(snapshot.checked_at) + retryDelay);
  await db.prepare(`
    UPDATE github_snapshot SET retry_at = ?, snapshot = ?, lease_until = 0, credential_key = ?, validators = ?,
      rate_until = ?, rate_failures = ?
    WHERE id = 1 AND lease_until = ? AND auth_mode = ?
  `).bind(next, JSON.stringify(snapshot), key, JSON.stringify(validators), snapshot.retry_at ?? 0, rateFailures, lease, mode).run();
  return snapshot;
}
