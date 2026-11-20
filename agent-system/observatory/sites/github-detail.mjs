import { capture, githubReader, isRevision, linkedPullNumbers, REPO, runItems } from './github.mjs';

const WEB = 'https://github.com/' + REPO;
const JOB_LIMIT = 25;
const STEP_LIMIT = 40;
const BODY_LIMIT = 8000;
const PULL_SECTION_LIMIT = 20;
const positive = n => Number.isSafeInteger(n) && n > 0;
const count = n => Number.isSafeInteger(n) && n >= 0 ? n : null;
const text = (v, limit = 240) => typeof v === 'string' ? v.slice(0, limit) : null;
const redact = value => value?.replace(/\b(?:gh[pousr]_[a-z0-9_]{20,}|github_pat_[a-z0-9_]{20,})\b/gi, '[redacted credential]');
const time = v => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
const ref = (name, sha) => ({ ref: text(name), sha: isRevision(sha) ? sha : null });
const names = values => Array.isArray(values) ? values.slice(0, 25).map(user => text(user?.login, 100)).filter(Boolean) : [];
const logins = v => text(v?.login, 100);
const lifecycle = v => ({ status: text(v.status, 48), conclusion: text(v.conclusion, 48) });

function pull(data, number) {
  if (data?.number !== number || data.base?.repo?.full_name !== REPO || !isRevision(data.base?.sha) || !isRevision(data.head?.sha)) {
    throw new Error('Pull request identity mismatch');
  }
  const labels = Array.isArray(data.labels) ? data.labels.slice(0, 40) : [];
  return {
    kind: 'pull', number, title: text(data.title), body: redact(text(data.body, BODY_LIMIT)),
    body_truncated: typeof data.body === 'string' && data.body.length > BODY_LIMIT,
    state: text(data.state, 48), draft: data.draft === true, merged: data.merged === true,
    author: logins(data.user), assignees: names(data.assignees), requested_reviewers: names(data.requested_reviewers),
    labels: labels.filter(label => typeof label?.name === 'string').map(label => ({
      name: text(label.name, 100), color: /^[a-f0-9]{6}$/i.test(label.color ?? '') ? label.color : null,
    })),
    milestone: data.milestone ? {
      title: text(data.milestone.title), number: count(data.milestone.number),
      state: text(data.milestone.state, 48), due_on: time(data.milestone.due_on),
    } : null,
    maintainer_can_modify: typeof data.maintainer_can_modify === 'boolean' ? data.maintainer_can_modify : null,
    base: ref(data.base.ref, data.base.sha), head: ref(data.head.ref, data.head.sha),
    merge_commit_sha: isRevision(data.merge_commit_sha) ? data.merge_commit_sha : null,
    created_at: time(data.created_at), updated_at: time(data.updated_at),
    closed_at: time(data.closed_at), merged_at: time(data.merged_at),
    changed_files: count(data.changed_files), additions: count(data.additions), deletions: count(data.deletions),
    commits: count(data.commits), comments: count(data.comments), review_comments: count(data.review_comments),
    url: WEB + '/pull/' + number,
  };
}

function run(data, id) {
  if (data?.id !== id || data.repository?.full_name !== REPO || !positive(data.run_attempt) || !isRevision(data.head_sha)) {
    throw new Error('Workflow run identity mismatch');
  }
  return {
    kind: 'run', id, name: text(data.name), title: text(data.display_title), event: text(data.event, 48),
    state: text(data.conclusion || data.status, 48), ...lifecycle(data),
    attempt: data.run_attempt, run_number: count(data.run_number), author: logins(data.actor),
    workflow_id: positive(data.workflow_id) ? data.workflow_id : null,
    path: text(data.path),
    head_repository_id: positive(data.head_repository?.id) ? data.head_repository.id : null,
    repository_owned_head: data.head_repository?.full_name === REPO,
    pull_requests: linkedPullNumbers(data),
    head: ref(data.head_branch, data.head_sha), created_at: time(data.created_at),
    started_at: time(data.run_started_at), updated_at: time(data.updated_at),
    url: WEB + '/actions/runs/' + id,
  };
}

function jobs(data, target) {
  const total = count(data?.total_count);
  if (total === null || !Array.isArray(data.jobs) || data.jobs.length !== Math.min(total, JOB_LIMIT) ||
      new Set(data.jobs.map(job => job?.id)).size !== data.jobs.length) throw new Error('Incomplete workflow jobs');
  const listed = data.jobs.map(job => {
    if (!positive(job?.id) || job.run_id !== target.id ||
        (job.head_sha !== undefined && job.head_sha !== target.head.sha) ||
        (job.run_attempt !== undefined && job.run_attempt !== target.attempt)) throw new Error('Job identity mismatch');
    const raw = Array.isArray(job.steps) ? job.steps : [];
    return {
      id: job.id, name: text(job.name), ...lifecycle(job),
      started_at: time(job.started_at), completed_at: time(job.completed_at),
      url: target.url + '/job/' + job.id, steps_truncated: raw.length > STEP_LIMIT,
      steps: raw.slice(0, STEP_LIMIT).filter(step => positive(step?.number)).map(step => ({
        number: step.number, name: text(step.name), ...lifecycle(step),
        started_at: time(step.started_at), completed_at: time(step.completed_at),
      })),
    };
  });
  return { jobs: listed, total_jobs: total, jobs_truncated: total > JOB_LIMIT };
}


function pullFile(file) {
  if (typeof file?.filename !== 'string' || !file.filename || !file.status) throw new Error('Invalid pull request file');
  return {
    path: text(file.filename, 512), status: text(file.status, 48),
    additions: count(file.additions), deletions: count(file.deletions),
    previous_path: text(file.previous_filename, 512),
  };
}

function pullReview(review) {
  if (!positive(review?.id)) throw new Error('Invalid pull request review');
  return { id: review.id, author: logins(review.user), state: text(review.state, 48), submitted_at: time(review.submitted_at) };
}

function pullCommit(commit) {
  if (!isRevision(commit?.sha)) throw new Error('Invalid pull request commit');
  return { revision:commit.sha, committed_at:time(commit.commit?.committer?.date) };
}

async function pullSections(reader, path, detail, previous, validators, next, now) {
  const output = {};
  const sameSource = previous?.head.sha === detail.head.sha && previous?.base.sha === detail.base.sha;
  const reasons = [];
  const sections = [['files', pullFile, detail.changed_files ?? 0], ['reviews', pullReview, null]];
  if (detail.commits > 0) sections.push(['commits', pullCommit, detail.commits]);
  for (const [kind, convert, total] of sections) {
    const field = kind === 'commits' ? 'commit_items' : kind;
    // These are observations of GitHub's live PR subcollections. The source
    // SHAs come from the core PR read and do not attest a submitted evidence set.
    const retained = (kind === 'reviews' || sameSource) && previous?.[kind + '_observed_at'] ? previous : null;
    const outcome = await capture(async () => {
      const response = await reader.get(path + '/' + kind + '?per_page=' + PULL_SECTION_LIMIT,
        512 * 1024, retained ? validators[kind] : null);
      if (!response.unchanged && (!Array.isArray(response.data) || response.data.length > PULL_SECTION_LIMIT)) {
        throw new Error('Invalid pull request section');
      }
      const items = response.unchanged ? retained[field] : response.data.map(convert);
      const truncated = response.unchanged ? retained[kind + '_truncated']
        : response.hasNext || (total === null ? items.length === PULL_SECTION_LIMIT : items.length < total);
      if (kind === 'commits' && (items.length !== Math.min(total, PULL_SECTION_LIMIT) ||
          new Set(items.map(item=>item.revision)).size !== items.length ||
          (!truncated && !items.some(item=>item.revision===detail.head.sha)))) {
        throw new Error('Pull request commits did not match the observed revision and count');
      }
      next[kind] = response.etag;
      return { items, truncated };
    });
    output[field] = outcome.status === 'available' ? outcome.items : retained?.[field] ?? [];
    output[kind + '_status'] = outcome.status === 'available'
      ? (outcome.truncated ? 'partial' : 'available') : retained ? 'stale' : 'unavailable';
    output[kind + '_truncated'] = outcome.truncated ?? retained?.[kind + '_truncated'] ?? false;
    output[kind + '_observed_at'] = outcome.status === 'available'
      ? new Date(now()).toISOString() : retained?.[kind + '_observed_at'] ?? null;
    output[kind + '_reason'] = outcome.reason ?? (outcome.truncated ? 'GitHub section exceeded the display limit' : null);
    if (kind !== 'commits') {
      if (outcome.reason) reasons.push(outcome.reason);
      else if (outcome.truncated) reasons.push('GitHub pull ' + kind + ' exceeded the display limit');
    }
    if (outcome.status !== 'available' && retained) next[kind] = validators[kind];
  }
  return { output, reason: reasons.find(value => !value.includes('exceeded the display limit')) ?? reasons[0] ?? null };
}

const emptyJobs = { jobs: [], total_jobs: null, jobs_truncated: false, jobs_observed_at: null, jobs_stale: false };

export async function fetchGitHubDetail(fetcher, token, kind, id, { now, previous, validators, previousFailures }) {
  const reader = githubReader(fetcher, AbortSignal.timeout(8000), token, now, null, previousFailures);
  const path = (kind === 'pulls' ? '/pulls/' : '/actions/runs/') + id;
  const next = {};
  const core = await capture(async () => {
    const current = await reader.get(path, 256 * 1024, previous ? validators.core : null);
    const detail = current.unchanged ? previous : kind === 'pulls' ? pull(current.data, id) : run(current.data, id);
    next.core = current.etag;
    return { detail };
  });
  let result = { detail: core.detail ?? null, status: core.status, reason: core.reason ?? null, observed_at: null };
  if (core.detail) {
    if (kind === 'histories') {
      const target = core.detail;
      const filter = target.workflow_id && target.head.ref && target.created_at && target.event && target.head_repository_id
        ? new URLSearchParams({ branch: target.head.ref, event: target.event, created: '<' + target.created_at, per_page: '12' }) : null;
      const sameTarget = previous?.workflow_id === target.workflow_id && previous?.head?.ref === target.head.ref &&
        previous?.created_at === target.created_at && previous?.event === target.event && previous?.head_repository_id === target.head_repository_id;
      const earlier = await capture(async () => {
        if (!filter) throw new Error('Workflow history requires a complete target identity');
        const response = await reader.get('/actions/workflows/' + target.workflow_id + '/runs?' + filter, 768 * 1024,
          sameTarget && previous.history ? validators.history : null);
        const data = response.data;
        if (!response.unchanged && (!Array.isArray(data?.workflow_runs) || data.workflow_runs.length > 12)) {
          throw new Error('Invalid workflow history');
        }
        next.history = response.etag;
        const items = response.unchanged ? previous.history.items : runItems(data.workflow_runs).filter(item =>
          item.workflow_id === target.workflow_id && item.branch === target.head.ref && item.event === target.event &&
          item.head_repository_id === target.head_repository_id && item.created_at < target.created_at && item.id !== target.id);
        return { history: { items, status: 'available', observed_at: new Date(now()).toISOString() } };
      });
      if (!earlier.history && sameTarget && previous.history) next.history = validators.history;
      const history = earlier.history ?? (sameTarget && previous.history
        ? { ...previous.history, status: 'stale', reason: earlier.reason }
        : { items: [], status: 'unavailable', reason: earlier.reason });
      result = { detail: { ...target, history }, status: earlier.history ? 'available' : 'partial', reason: earlier.reason ?? null };
    } else if (kind === 'pulls') {
      const {output, reason} = await pullSections(reader, path, core.detail, previous, validators, next, now);
      result = { detail: { ...core.detail, ...output }, status: reason ? 'partial' : 'available', reason, observed_at: null };
    } else {
      const priorJobs = previous?.attempt === core.detail.attempt && Number.isSafeInteger(previous.total_jobs);
      const storedJobs = priorJobs ? { jobs: previous.jobs, total_jobs: previous.total_jobs, jobs_truncated: previous.jobs_truncated } : null;
      if (priorJobs) next.jobs = validators.jobs;
      const listed = await capture(async () => {
        const response = await reader.get(path + '/attempts/' + core.detail.attempt + '/jobs?per_page=' + JOB_LIMIT,
          768 * 1024, priorJobs ? validators.jobs : null);
        const observed = response.unchanged
          ? storedJobs
          : jobs(response.data, core.detail);
        next.jobs = response.etag;
        return { observed };
      });
      const observedJobs = listed.observed ? { ...listed.observed, jobs_observed_at: new Date(now()).toISOString(), jobs_stale: false }
        : storedJobs ? { ...storedJobs, jobs_observed_at: previous.jobs_observed_at ?? null, jobs_stale: true } : emptyJobs;
      result = { detail: { ...core.detail, ...observedJobs },
        status: listed.observed ? 'available' : 'partial', reason: listed.reason ?? null, observed_at: null };
      if (listed.observed && (listed.observed.jobs_truncated || listed.observed.jobs.some(job => job.steps_truncated))) {
        result.status = 'partial';
        result.reason = 'GitHub jobs or steps exceeded the display limit';
      }
    }
    result.observed_at = new Date(now()).toISOString();
  }
  return { result, validators: next, ...reader.status() };
}
