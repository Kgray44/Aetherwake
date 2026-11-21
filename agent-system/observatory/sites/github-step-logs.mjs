import { REPO, isRevision } from './github.mjs';

const api = 'https://api.github.com/repos/' + REPO;
const byteLimit = 64 * 1024;
const factLimit = 12;
const positive = value => Number.isSafeInteger(value) && value > 0;
const classes = /\b(AssertionError|ERR_ASSERTION|TypeError|ReferenceError|SyntaxError|TimeoutError|TS\d{4})\b/g;

function signedLocation(value) {
  if (typeof value !== 'string' || value.length > 8192) return null;
  try {
    const url = new URL(value);
    const trusted = url.hostname === 'pipelines.actions.githubusercontent.com' ||
      /^productionresultssa\d{1,3}\.blob\.core\.windows\.net$/.test(url.hostname) &&
      url.pathname.startsWith('/actions-results/');
    return trusted && url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      !url.hash && url.search && url.pathname !== '/' ? url : null;
  } catch { return null; }
}

function collectFacts(text, paths, clipped) {
  const facts = new Map();
  function add(fact) {
    if (facts.size < factLimit) facts.set(JSON.stringify(fact), fact);
  }
  const lines = text.split(/\r?\n/);
  if (clipped || !text.endsWith('\n')) lines.pop();
  for (const line of lines) {
    if (line.length > 2048) continue;
    for (const result of line.matchAll(classes)) add({ kind:'error_class', code:result[1] });
    const exit = /\b(?:process completed with exit code|exit status)\s+(\d{1,3})\b/i.exec(line);
    if (exit && Number(exit[1]) <= 255) add({ kind:'exit_code', code:Number(exit[1]) });
    const tap = /\bnot ok (\d{1,7})(?:\s|$)/.exec(line);
    if (tap && Number(tap[1]) > 0) add({kind:'test_ordinal',code:Number(tap[1])});

    // The persisted path originates in the exact PR, never in the log text.
    const normalized = line.replaceAll('\\', '/');
    const annotation = /\bfile=([^,]+),line=(\d{1,7})(?:,col=(\d{1,7}))?[, :]/.exec(normalized);
    const location = /(?:^|[\s(/])([^\s():]+):(\d{1,7})(?::(\d{1,7}))?(?=$|[)\s])/g;
    for (const [, file, row, column] of [...(annotation ? [annotation] : []), ...normalized.matchAll(location)]) {
      const path = paths.find(candidate => file === candidate || file.endsWith('/' + candidate));
      if (path && Number(row) > 0) add({ kind:'source_location', path, line:Number(row),
        ...(Number(column) > 0 ? { column:Number(column) } : {}) });
    }
  }
  return [...facts.values()];
}

async function readSample(stream) {
  if (!stream) return { text:'', clipped:false };
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  let clipped = false;
  try {
    while (bytes < byteLimit) {
      const { value, done } = await reader.read();
      if (done) return { text:text+decoder.decode(), clipped:false };
      const part = value.subarray(0, byteLimit - bytes);
      bytes += part.byteLength;
      text += decoder.decode(part, {stream:true});
    }
    clipped = true;
    return { text, clipped };
  } finally {
    // Release the remaining provider response without storing it.
    if (clipped) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function githubStepLog({ fetcher, token, signal, apiVersion, job, step, paths }) {
  const identity = { head_sha:job.head_sha, workflow_id:job.workflow_id, run_id:job.run_id,
    run_attempt:job.attempt, job_id:job.job_id, step_number:step.number };
  const unavailable = status => ({ source:'github_actions_step_log', ...identity, status });
  if (!token || !isRevision(identity.head_sha) || ![identity.workflow_id,identity.run_id,identity.run_attempt,
    identity.job_id,identity.step_number].every(positive)) return unavailable('unavailable');
  try {
    const response = await fetcher(api + '/actions/jobs/' + identity.job_id + '/steps/' + identity.step_number + '/logs', {
      redirect:'manual', signal, cache:'no-store',
      headers:{ Accept:'application/vnd.github+json', Authorization:'Bearer '+token,
        'X-GitHub-Api-Version':apiVersion, 'User-Agent':'Aetherwake-Engineering-Observatory' },
    });
    if (response.status !== 302) {
      await response.body?.cancel();
      return unavailable('unavailable');
    }
    const location = signedLocation(response.headers.get('location'));
    await response.body?.cancel();
    if (!location) return unavailable('redirect_rejected');
    const downloaded = await fetcher(location.href, {
      redirect:'manual', credentials:'omit', referrerPolicy:'no-referrer', signal, cache:'no-store',
      headers:{ Accept:'text/plain', Range:'bytes=-'+byteLimit },
    });
    const type = downloaded.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (![200,206].includes(downloaded.status) || !['text/plain','application/octet-stream'].includes(type)) {
      await downloaded.body?.cancel();
      return unavailable('unavailable');
    }
    const sample = await readSample(downloaded.body);
    // A suffix range can start in a partial line. Never parse that line.
    const suffix = downloaded.status === 206;
    const newline = sample.text.indexOf('\n');
    const text = suffix ? newline < 0 ? '' : sample.text.slice(newline + 1) : sample.text;
    return { ...unavailable('observed'), bounded:sample.clipped || suffix,
      facts:collectFacts(text, paths, sample.clipped) };
  } catch { return unavailable('unavailable'); }
}
