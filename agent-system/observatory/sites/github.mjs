const REPO = 'Kgray44/Aetherwake';
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

function githubReader(fetcher, signal) {
  return async function get(path, maxBytes = 512 * 1024) {
    const response = await fetcher(API + path, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Aetherwake-Engineering-Observatory' },
      signal, redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      const error = new Error(response.status === 429 || response.headers.get('x-ratelimit-remaining') === '0'
        ? 'GitHub rate limit reached' : 'GitHub HTTP ' + response.status);
      error.status = response.status;
      throw error;
    }
    return JSON.parse(await readBounded(response.body, maxBytes));
  };
}

async function capture(work) {
  try { return { status: 'available', ...await work() }; }
  catch (error) {
    const reason = /^GitHub (HTTP \d{3}|rate limit reached)$/.test(error.message)
      ? error.message : 'GitHub response unavailable or invalid';
    return { status: 'unavailable', reason, items: [] };
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
      if (error.status === 404 && RECORD_DIRS.includes(dir)) absent.push(dir);
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

export async function githubSnapshot(fetcher, validate) {
  const get = githubReader(fetcher, AbortSignal.timeout(8000));
  const [main, issues, pulls, ci] = await Promise.all([
    capture(async () => {
      const ref = await get('/git/ref/heads/main', 16 * 1024);
      if (ref.ref !== 'refs/heads/main' || !isRevision(ref.object?.sha)) throw new Error('Invalid main ref');
      return { revision: ref.object.sha };
    }),
    capture(async () => {
      const items = await get('/issues?state=all&sort=updated&per_page=' + PAGE_SIZE);
      return { items: linkedItems(items.filter(item => !item.pull_request), 'issue') };
    }),
    capture(async () => {
      const items = await get('/pulls?state=all&sort=updated&per_page=' + PAGE_SIZE);
      return { items: linkedItems(items, 'pr') };
    }),
    capture(async () => {
      const { workflow_runs } = await get('/actions/runs?branch=main&per_page=' + PAGE_SIZE);
      return { items: linkedItems(workflow_runs, 'run') };
    }),
  ]);
  const records = main.revision
    ? await contractRecords(get, main.revision, validate)
    : { status: 'unavailable', reason: main.reason, items: [] };
  return { repository: REPO, checked_at: new Date().toISOString(), main, records, issues, pulls, ci, page_size: PAGE_SIZE };
}
