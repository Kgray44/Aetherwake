import { TASK_REQUEST_MAX_BYTES } from '../intake.mjs';

export const REPO = 'Kgray44/Aetherwake';
const API_ORIGIN = 'https://api.github.com';
const API = API_ORIGIN + '/repos/' + REPO;
const COUNT_QUERY = `query ObservatoryPullRequestTotals {
  repository(owner: "Kgray44", name: "Aetherwake") {
    nameWithOwner
    all: pullRequests(first: 1) { totalCount }
    open: pullRequests(first: 1, states: [OPEN]) { totalCount }
    merged: pullRequests(first: 1, states: [MERGED]) { totalCount }
    closed: pullRequests(first: 1, states: [CLOSED]) { totalCount }
  }
}`;
const MAX_RECORD_FILES = 12;
const MAX_DIRECTORY_READS = 6;
const MAX_RECORDS = 750;
const RECORD_DIRS = ['agent-system/records', 'agent-system/observatory/records'];
const ISSUE_PAGE_SIZE = 12;
const ACTIVITY_PAGE_SIZE = 40;
const MAX_PULL_RESPONSE_BYTES = 2 * 1024 * 1024;
const REPO_URL = 'https://github.com/' + REPO;

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

export function unavailablePullTotals(reason, retained) {
  return retained?.observed_at
    ? { ...retained, status: 'stale', reason }
    : { status:'unavailable', observed_at:null, total:null, open:null, merged:null, closed:null, reason };
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

  function throttle(seenAt, reset = 0, retry = null, exhausted = false) {
    rateFailures = Math.min(previousFailures + 1, 5);
    const fallback = seenAt + Math.min(MAX_BACKOFF_MS, MIN_BACKOFF_MS * 2 ** (rateFailures - 1));
    retryAt = Math.max(retry ?? 0, reset > seenAt ? reset : 0,
      (retry === null && !(reset > seenAt)) || (exhausted && !(reset > seenAt)) ? fallback : 0) + 1000;
    haltReason = RATE_REASON;
  }

  async function request(path, maxBytes, etag, graphql = false) {
    if (haltReason) throw new Error(haltReason);
    if (graphql && !token) throw new Error(AUTH_REASON);
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'Aetherwake-Engineering-Observatory' };
    if (token) {
      headers.Authorization = 'Bearer ' + token;
      if (ETAG.test(etag ?? '')) headers['If-None-Match'] = etag;
    }
    const init = { headers, signal, redirect:'manual' };
    if (graphql) {
      headers['Content-Type'] = 'application/json';
      Object.assign(init, {method:'POST', body:JSON.stringify({query:COUNT_QUERY})});
    }
    const response = await fetcher(graphql ? API_ORIGIN + '/graphql' : API + path, init);
    const seenAt = now();
    const observed = rateHeaders(response.headers, seenAt);
    if (!graphql && observed.observed_at) rate = observed;
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
    if (throttled) throttle(seenAt, exhausted ? Date.parse(observed.reset_at) : 0, retry, exhausted);
    const rejected = token && (response.status === 401 || (response.status === 403 && !throttled));
    if (rejected && !graphql) {
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
      const error = new Error(haltReason || (rejected ? AUTH_REASON : 'GitHub HTTP ' + response.status));
      error.status = response.status;
      throw error;
    }
    if (!graphql) {
      checkedResponse = true;
      if (token) authentication = 'authenticated';
    }
    const validator = response.headers.get('etag');
    const data = JSON.parse(await readBounded(response.body, maxBytes));
    if (graphql && Array.isArray(data?.errors) && data.errors.some(error =>
      error?.type === 'RATE_LIMITED' || /secondary rate limit|rate limit exceeded|abuse detection/i.test(error?.message ?? ''))) {
      if (!haltReason) throttle(seenAt);
      throw new Error(RATE_REASON);
    }
    return { data, etag: token && ETAG.test(validator ?? '') ? validator : null,
      hasNext: /;\s*rel="next"/.test(response.headers.get('link') ?? '') };
  }

  return {
    get: (path, maxBytes = 512 * 1024, etag = null) => request(path, maxBytes, etag),
    pullTotals: () => request(null, 16 * 1024, null, true),
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
      if (!isRevision(sha) || !Number.isFinite(size) || size > TASK_REQUEST_MAX_BYTES) throw new Error('File exceeds limits');
      const blob = await get('/git/blobs/' + sha, 2 * TASK_REQUEST_MAX_BYTES);
      if (blob.sha !== sha || blob.encoding !== 'base64') throw new Error('Invalid Git blob');
      const bytes = Uint8Array.from(atob(blob.content.replace(/\s/g, '')), x => x.charCodeAt(0));
      if (bytes.byteLength > TASK_REQUEST_MAX_BYTES) throw new Error('Git blob exceeds limits');
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

const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
const text = value => typeof value === 'string' && value.length ? value : null;
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

function issueItems(data) {
  if (!Array.isArray(data)) throw new Error('Invalid GitHub issue list');
  return data.filter(item => positiveInteger(item?.number) && !item.pull_request).slice(0, ISSUE_PAGE_SIZE)
    .map(item => ({
      label: '#' + item.number,
      title: text(item.title)?.slice(0, 200),
      state: item.state,
      url: REPO_URL + '/issues/' + item.number,
      date: item.updated_at,
    }));
}

function newestFirst(rows) {
  return rows.sort((left, right) =>
    (Date.parse(right.created_at) || 0) - (Date.parse(left.created_at) || 0) || right.id - left.id
  ).slice(0, ACTIVITY_PAGE_SIZE);
}

function pullItems(data) {
  if (!Array.isArray(data)) throw new Error('Invalid GitHub pull request list');
  return newestFirst(data.filter(item => positiveInteger(item?.number)).map(item => {
    const created = date(item.created_at);
    const updated = date(item.updated_at);
    const mergedAt = date(item.merged_at);
    const merged = mergedAt ? true : typeof item.merged === 'boolean' ? item.merged : item.merged_at === null ? false : null;
    return {
      id: positiveInteger(item.id) ? item.id : item.number,
      number: item.number,
      label: '#' + item.number,
      title: text(item.title)?.slice(0, 200) ?? null,
      state: text(item.state),
      url: REPO_URL + '/pull/' + item.number,
      revision: isRevision(item.head?.sha) ? item.head.sha : null,
      date: updated,
      created_at: created,
      updated_at: updated,
      author: text(item.user?.login),
      head_ref: text(item.head?.ref),
      base_ref: text(item.base?.ref),
      draft: typeof item.draft === 'boolean' ? item.draft : null,
      merged,
      merged_at: mergedAt,
    };
  }));
}

export function linkedPullNumbers(run) {
  return Array.isArray(run.pull_requests)&&run.repository?.full_name===REPO&&positiveInteger(run.repository.id)
    ? [...new Set(run.pull_requests.filter(pr=>positiveInteger(pr?.number)&&pr.base?.repo?.id===run.repository.id&&
      pr.head?.sha===run.head_sha).map(pr=>pr.number))].slice(0,20)
    : null;
}

export function runItems(data) {
  if (!Array.isArray(data)) throw new Error('Invalid GitHub workflow run list');
  return newestFirst(data.filter(item => positiveInteger(item?.id)).map(item => {
    const created = date(item.created_at);
    const updated = date(item.updated_at);
    const status = text(item.status);
    const conclusion = text(item.conclusion);
    const workflow = text(item.name);
    const pullRequests = linkedPullNumbers(item);
    return {
      id: item.id,
      label: workflow ?? String(item.id),
      title: text(item.display_title)?.slice(0, 200) ?? null,
      state: conclusion ?? status,
      url: REPO_URL + '/actions/runs/' + item.id,
      revision: isRevision(item.head_sha) ? item.head_sha : null,
      date: updated,
      created_at: created,
      updated_at: updated,
      author: text(item.actor?.login),
      branch: text(item.head_branch),
      workflow,
      workflow_id: positiveInteger(item.workflow_id) ? item.workflow_id : null,
      head_repository_id: positiveInteger(item.head_repository?.id) ? item.head_repository.id : null,
      event: text(item.event),
      ...(pullRequests ? {pull_requests:pullRequests} : {}),
      attempt: positiveInteger(item.run_attempt) ? item.run_attempt : null,
      status,
      conclusion,
    };
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
    const usable = prior?.observed_at && (key === 'main' ? isRevision(prior.revision) : Array.isArray(prior.items)) &&
      (key !== 'ci' || Number.isSafeInteger(prior.repository_total));
    const etag = usable ? oldValidators[path] : null;
    if (token && ETAG.test(etag ?? '')) validators[path] = etag;
    const result = await capture(async () => {
      const response = await reader.get(path, maxBytes, etag);
      const converted = response.unchanged
        ? (key === 'main' ? { revision: prior.revision } : {
          items: prior.items,
          ...(key === 'ci' ? { repository_total: prior.repository_total } : {}),
        })
        : convert(response.data);
      if (response.etag) validators[path] = response.etag;
      else delete validators[path];
      updated[key] = new Date(now()).toISOString();
      return converted;
    });
    return result;
  }

  const main = await resource('main', '/git/ref/heads/main', ref => {
    if (ref.ref !== 'refs/heads/main' || !isRevision(ref.object?.sha)) throw new Error('Invalid main ref');
    return { revision: ref.object.sha };
  }, 16 * 1024);
  const issues = await resource('issues', '/issues?state=all&sort=updated&direction=desc&per_page=' + ISSUE_PAGE_SIZE,
    data => ({ items: issueItems(data) }));
  const pulls = await resource('pulls', '/pulls?state=all&sort=created&direction=desc&per_page=' + ACTIVITY_PAGE_SIZE,
    data => ({ items: pullItems(data) }), MAX_PULL_RESPONSE_BYTES);
  const ci = await resource('ci', '/actions/runs?per_page=' + ACTIVITY_PAGE_SIZE,
    data => {
      const items = runItems(data.workflow_runs);
      return { items, repository_total:Number.isSafeInteger(data.total_count) && data.total_count >= items.length ? data.total_count : null };
    });

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

  pulls.totals = await readPullTotals(reader, token, now);
  ci.repository_total ??= null;
  const { api, retryAt, rateFailures } = reader.status();
  const snapshot = {
    repository: REPO, retry_at: retryAt || null, checked_at: new Date(now()).toISOString(),
    main, records, issues, pulls, ci, page_size: ISSUE_PAGE_SIZE, api,
  };
  for (const [group, value] of Object.entries(updated)) snapshot[group].observed_at = value;
  return { snapshot, validators, rateFailures };
}

async function readPullTotals(reader, token, now) {
  if (!token) return unavailablePullTotals('GitHub read credential unavailable');
  const result = await capture(async () => {
    const { data } = await reader.pullTotals();
    const repo = data?.data?.repository;
    if (Array.isArray(data?.errors) && data.errors.some(error => ['FORBIDDEN', 'UNAUTHORIZED'].includes(error?.type))) {
      throw new Error(AUTH_REASON);
    }
    if (repo?.nameWithOwner !== REPO || (data.errors !== undefined && (!Array.isArray(data.errors) || data.errors.length))) {
      throw new Error(INVALID_REASON);
    }
    const total = repo.all?.totalCount;
    const open = repo.open?.totalCount;
    const merged = repo.merged?.totalCount;
    const closed = repo.closed?.totalCount;
    if (![total, open, merged, closed].every(value => Number.isSafeInteger(value) && value >= 0) ||
        total !== open + merged + closed) throw new Error(INVALID_REASON);
    return { observed_at:new Date(now()).toISOString(), total, open, merged, closed, reason:null };
  });
  return result.status === 'available' ? result : unavailablePullTotals(result.reason);
}
