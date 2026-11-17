export const REPO = 'Kgray44/Aetherwake';
const API = 'https://api.github.com/repos/' + REPO;
const MAX_RECORD_FILES = 12;
const MAX_DIRECTORY_READS = 6;
const MAX_RECORDS = 750;
const RECORD_DIRS = ['agent-system/records', 'agent-system/observatory/records'];
const PAGE_SIZE = 12;

export const isRevision = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);

export async function readBounded(stream, maxBytes) {
  if (!stream) return '';
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let result = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return result + decoder.decode();
      size += value.byteLength;
      if (size > maxBytes) throw new RangeError('Response exceeds size limit');
      result += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

const MIN_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 15 * MIN_BACKOFF_MS;
export const RATE_REASON = 'GitHub rate limit reached';
export const AUTH_REASON = 'GitHub read credential rejected';
const INVALID_REASON = 'GitHub response unavailable or invalid';
const ETAG = /^(?:W\/)?"[\x21\x23-\x7e]{0,250}"$/;

const integerHeader = (headers, name) => {
  const value = headers.get(name);
  return /^\d{1,16}$/.test(value ?? '') && Number.isSafeInteger(Number(value)) ? Number(value) : null;
};

function retryAfterAt(headers, now) {
  const value = headers.get('retry-after');
  if (value === null) return null;
  const seconds = integerHeader(headers, 'retry-after');
  const at = seconds === null ? Date.parse(value) : now + seconds * 1000;
  return Number.isSafeInteger(at) && at <= 8.64e15 && at >= now ? at : null;
}

function rateHeaders(headers, now) {
  const remaining = integerHeader(headers, 'x-ratelimit-remaining');
  const limit = integerHeader(headers, 'x-ratelimit-limit');
  const seconds = integerHeader(headers, 'x-ratelimit-reset');
  const resetMs = seconds !== null && seconds <= 8.64e12 ? seconds * 1000 : null;
  return {
    remaining,
    limit,
    reset_at: resetMs === null ? null : new Date(resetMs).toISOString(),
    observed_at: remaining !== null || limit !== null || resetMs !== null ? new Date(now).toISOString() : null,
  };
}

function unavailable(reason) {
  return { status: 'unavailable', reason, items: [] };
}

export function githubReader(fetcher, signal, token, now, previousApi, previousFailures) {
  let authentication = token
    ? (['authenticated', 'rejected'].includes(previousApi?.authentication) ? previousApi.authentication : 'unverified')
    : 'anonymous';
  let rate = previousApi ?? { remaining: null, limit: null, reset_at: null, observed_at: null };
  let retryAt = 0;
  let haltReason = null;
  let rateFailures = previousFailures;
  let checkedResponse = false;

  async function get(path, maxBytes = 512 * 1024, etag = null) {
    if (haltReason) throw new Error(haltReason);
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'Aetherwake-Engineering-Observatory' };
    if (token) {
      headers.Authorization = 'Bearer ' + token;
      if (ETAG.test(etag ?? '')) headers['If-None-Match'] = etag;
    }
    const response = await fetcher(API + path, { headers, signal, redirect: 'manual' });
    const seenAt = now();
    const observed = rateHeaders(response.headers, seenAt);
    if (observed.observed_at) rate = observed;
    const retry = retryAfterAt(response.headers, seenAt);
    const exhausted = observed.remaining === 0;
    let secondary = false;
    if (response.status === 403 && !exhausted && retry === null) {
      // GitHub may report secondary throttling only in the 403 message.
      try {
        const error = JSON.parse(await readBounded(response.body, 8192));
        secondary = /secondary rate limit|abuse detection/i.test(error?.message ?? '');
      } catch { /* Unrecognized 403 is a permission failure for a configured credential. */ }
    }
    const throttled = exhausted || retry !== null || secondary || response.status === 429;
    if (throttled) {
      rateFailures = Math.min(previousFailures + 1, 5);
      const reset = exhausted ? Date.parse(observed.reset_at) : 0;
      const fallback = seenAt + Math.min(MAX_BACKOFF_MS, MIN_BACKOFF_MS * 2 ** (rateFailures - 1));
      retryAt = Math.max(retry ?? 0, reset > seenAt ? reset : 0,
        (retry === null && !(reset > seenAt)) || (exhausted && !(reset > seenAt)) ? fallback : 0) + 1000;
      haltReason = RATE_REASON;
    }
    if (token && (response.status === 401 || (response.status === 403 && !throttled))) {
      authentication = 'rejected';
      rate = { remaining: null, limit: null, reset_at: null, observed_at: null };
      haltReason = AUTH_REASON;
    }
    if (response.status === 304 && token && headers['If-None-Match']) {
      checkedResponse = true;
      authentication = 'authenticated';
      return { unchanged: true, etag: ETAG.test(response.headers.get('etag') ?? '') ? response.headers.get('etag') : etag };
    }
    if (!response.ok) {
      if (!response.bodyUsed) await response.body?.cancel();
      const error = new Error(haltReason || 'GitHub HTTP ' + response.status);
      error.status = response.status;
      throw error;
    }
    checkedResponse = true;
    if (token) authentication = 'authenticated';
    const validator = response.headers.get('etag');
    return { data: JSON.parse(await readBounded(response.body, maxBytes)), etag: token && ETAG.test(validator ?? '') ? validator : null,
      hasNext: /;\s*rel="next"/.test(response.headers.get('link') ?? '') };
  }

  return {
    get,
    halted: () => haltReason,
    status() {
      const { remaining, limit, reset_at, observed_at } = rate;
      return {
        retryAt, rateFailures: retryAt || !checkedResponse ? rateFailures : 0,
        api: { authentication, remaining, limit, reset_at, observed_at },
      };
    },
  };
}

export async function capture(work) {
  try { return { status: 'available', ...await work() }; }
  catch (error) {
    const reason = [RATE_REASON, AUTH_REASON].includes(error.message) || /^GitHub HTTP \d{3}$/.test(error.message)
      ? error.message : INVALID_REASON;
    return unavailable(reason);
  }
}

const recordPath = path => path.split('/').map(encodeURIComponent).join('/');

async function contractRecords(get, revision, validate) {
  const directories = [...RECORD_DIRS];
  const absent = [];
  const errors = [];
  const files = [];
  const records = new Map();
  let reads = 0;
  let truncated = false;
  let rejected = 0;

  while (directories.length && reads < MAX_DIRECTORY_READS && files.length < MAX_RECORD_FILES) {
    const dir = directories.shift();
    reads++;
    try {
      const entries = await get('/contents/' + recordPath(dir) + '?ref=' + revision);
      if (!Array.isArray(entries)) throw new Error('Invalid directory listing');
      if (entries.length >= 1000) truncated = true;
      for (const entry of entries) {
        if (typeof entry.path !== 'string' || !entry.path.startsWith(dir + '/') ||
            entry.path.slice(dir.length + 1).includes('/')) continue;
        if (entry.type === 'dir') directories.push(entry.path);
        if (entry.type === 'file' && entry.path.endsWith('.json')) files.push(entry);
      }
    } catch (error) {
      if (error.status === 404 && error.message === 'GitHub HTTP 404' && RECORD_DIRS.includes(dir)) absent.push(dir);
      else errors.push(dir);
    }
  }

  truncated ||= directories.length > 0 || files.length > MAX_RECORD_FILES;
  for (const { path, sha, size } of files.slice(0, MAX_RECORD_FILES)) {
    try {
      if (!isRevision(sha) || !Number.isFinite(size) || size > 128 * 1024) throw new Error('File exceeds limits');
      const blob = await get('/git/blobs/' + sha, 256 * 1024);
      if (blob.sha !== sha || blob.encoding !== 'base64') throw new Error('Invalid Git blob');
      const bytes = Uint8Array.from(atob(blob.content.replace(/\s/g, '')), x => x.charCodeAt(0));
      const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      for (const record of Array.isArray(data) ? data : [data]) {
        if (records.size >= MAX_RECORDS) {
          truncated = true;
          break;
        }
        if (!validate(record) || record.repository.toLowerCase() !== REPO.toLowerCase()) {
          rejected++;
          continue;
        }
        const key = record.record_type + ':' + record.id;
        if (!records.has(key)) records.set(key, { record, path, sha });
      }
    } catch {
      errors.push(path);
    }
  }
  return {
    status: errors.length || truncated || rejected ? 'partial' : 'available',
    ref: 'refs/heads/main', revision, absent, errors, truncated, rejected,
    items: [...records.values()],
  };
}

function linkedItems(data, kind) {
  if (!Array.isArray(data)) throw new Error('Invalid GitHub list');
  const number = item => kind === 'run' ? item.id : item.number;
  const base = kind === 'run' ? '/actions/runs/' : kind === 'pr' ? '/pull/' : '/issues/';
  return data.filter(item => Number.isSafeInteger(number(item)) && number(item) > 0)
    .map(item => ({
      label: kind === 'run' ? item.name : '#' + number(item),
      title: (kind === 'run' ? item.display_title : item.title)?.slice(0, 200),
      state: kind === 'run' ? item.conclusion || item.status : item.state,
      url: 'https://github.com/' + REPO + base + number(item),
      revision: kind === 'run' ? item.head_sha : kind === 'pr' ? item.head?.sha : undefined,
      date: item.updated_at,
    }));
}

function completeRecords(records, revision) {
  return records?.revision === revision && !!records.observed_at && Array.isArray(records.items) &&
    Array.isArray(records.errors) && !records.errors.length && !records.truncated && records.rejected === 0;
}

export async function githubSnapshot(fetcher, validate, token, {
  now = Date.now, previous, oldValidators = {}, previousApi, previousFailures = 0,
} = {}) {
  const reader = githubReader(fetcher, AbortSignal.timeout(8000), token, now, previousApi, previousFailures);
  const validators = {};
  const updated = {};
  async function resource(key, path, convert, maxBytes) {
    const prior = previous?.[key];
    const usable = prior?.observed_at && (key === 'main' ? isRevision(prior.revision) : Array.isArray(prior.items));
    const etag = usable ? oldValidators[key] : null;
    if (token && ETAG.test(etag ?? '')) validators[key] = etag;
    const result = await capture(async () => {
      const response = await reader.get(path, maxBytes, etag);
      const converted = response.unchanged
        ? (key === 'main' ? { revision: prior.revision } : { items: prior.items })
        : convert(response.data);
      if (response.etag) validators[key] = response.etag;
      else delete validators[key];
      updated[key] = new Date(now()).toISOString();
      return converted;
    });
    return result;
  }

  const main = await resource('main', '/git/ref/heads/main', ref => {
    if (ref.ref !== 'refs/heads/main' || !isRevision(ref.object?.sha)) throw new Error('Invalid main ref');
    return { revision: ref.object.sha };
  }, 16 * 1024);
  const issues = await resource('issues', '/issues?state=all&sort=updated&direction=desc&per_page=' + PAGE_SIZE,
    data => ({ items: linkedItems(data.filter(item => !item.pull_request), 'issue') }));
  const pulls = await resource('pulls', '/pulls?state=all&sort=updated&direction=desc&per_page=' + PAGE_SIZE,
    data => ({ items: linkedItems(data, 'pr') }));
  const ci = await resource('ci', '/actions/runs?branch=main&per_page=' + PAGE_SIZE,
    data => ({ items: linkedItems(data.workflow_runs, 'run') }));

  let records;
  if (main.revision && completeRecords(previous?.records, main.revision)) {
    const { reason, ...retained } = previous.records;
    records = { ...retained, status: 'available' };
  } else if (!main.revision || reader.halted()) {
    records = unavailable(reader.halted() || main.reason);
  } else {
    const get = async (...args) => (await reader.get(...args)).data;
    records = await contractRecords(get, main.revision, validate);
    if (records.errors.length && reader.halted()) records = unavailable(reader.halted());
    else updated.records = new Date(now()).toISOString();
  }

  const { api, retryAt, rateFailures } = reader.status();
  const snapshot = {
    repository: REPO, retry_at: retryAt || null, checked_at: new Date(now()).toISOString(),
    main, records, issues, pulls, ci, page_size: PAGE_SIZE, api,
  };
  for (const [group, value] of Object.entries(updated)) snapshot[group].observed_at = value;
  return { snapshot, validators, rateFailures };
}
