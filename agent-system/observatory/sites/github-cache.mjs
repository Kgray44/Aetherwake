import { githubSnapshot } from './github.mjs';

const GROUPS = ['main', 'records', 'issues', 'pulls', 'ci'];
const REFRESH_MS = 15 * 60 * 1000;
const FAILURE_RETRY_MS = 60 * 1000;
const LEASE_MS = 30 * 1000;

export async function cachedGitHub(db, fetcher, validate, token, now = Date.now()) {
  const mode = token ? 'authenticated' : 'anonymous';
  const lease = now + LEASE_MS;

  // One Worker refreshes at a time. Existing responses stay readable while it runs.
  const claim = await db.prepare(`
    INSERT INTO github_snapshot (id, auth_mode, retry_at) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET auth_mode = excluded.auth_mode, retry_at = excluded.retry_at
    WHERE github_snapshot.retry_at <= ? OR github_snapshot.auth_mode <> excluded.auth_mode
    RETURNING snapshot
  `).bind(mode, lease, now).first();
  if (!claim) {
    const { snapshot, retry_at } = await db.prepare('SELECT snapshot, retry_at FROM github_snapshot WHERE id = ?').bind(1).first();
    if (snapshot) return JSON.parse(snapshot);
    const pending = { status: 'unavailable', reason: 'GitHub refresh in progress', items: [] };
    return {
      repository: 'Kgray44/Aetherwake', page_size: 12, checked_at: null,
      retry_at, main: pending, records: pending, issues: pending, pulls: pending, ci: pending,
    };
  }

  const old = claim.snapshot && JSON.parse(claim.snapshot);
  const fresh = await githubSnapshot(fetcher, validate, token);
  const hasFailure = GROUPS.some(key => fresh[key].status === 'unavailable');
  for (const key of GROUPS) {
    if (fresh[key].status !== 'unavailable') {
      fresh[key].observed_at = fresh.checked_at;
    } else if (old?.[key].observed_at) {
      fresh[key] = { ...old[key], status: 'stale', reason: fresh[key].reason };
    }
  }
  const next = fresh.retry_at || (Date.parse(fresh.checked_at) + (hasFailure ? FAILURE_RETRY_MS : REFRESH_MS));
  await db.prepare('UPDATE github_snapshot SET retry_at = ?, snapshot = ? WHERE id = 1 AND retry_at = ? AND auth_mode = ?')
    .bind(next, JSON.stringify(fresh), lease, mode).run();
  return fresh;
}
