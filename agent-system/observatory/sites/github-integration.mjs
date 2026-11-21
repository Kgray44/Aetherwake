import { AUTH_REASON, githubReader, isRevision, RATE_REASON, readBounded, REPO } from './github.mjs';
import { repairablePath, safeDiagnostic } from './source-repair.mjs';
import { githubStepLog } from './github-step-logs.mjs';

const positive = value => Number.isSafeInteger(value) && value > 0;
const apiVersion = '2026-03-10';
const mergeCommitReadVersion = '2022-11-28';
const passing = new Set(['success', 'neutral', 'skipped']);
const pending = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending', 'expected']);

function blocked(reason, detail, evidence = {}) {
  return { ...evidence, state: 'blocked', reason, detail };
}

function classify(error) {
  if (error.message === RATE_REASON) return blocked('rate_limited', 'GitHub is throttling requests.');
  if (error.message === AUTH_REASON || error.status === 403 || error.status === 401) {
    return blocked('permission', 'GitHub denied access to required integration evidence.');
  }
  if (error.status === 404) return blocked('repository_or_credential', 'GitHub did not expose a required resource.');
  return blocked('transport', 'GitHub integration evidence is unavailable.');
}

const normalizedName = value => typeof value === 'string' && value.length <= 240 && value.trim() ? value : null;
const runLink = id => 'https://github.com/' + REPO + '/actions/runs/' + id;
const observedTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;

export function githubIntegration(fetcher, token, mergeToken, publishToken) {
  const read = (url, init, version = apiVersion) => fetcher(url, { ...init,
    headers: { ...init.headers, 'X-GitHub-Api-Version': version } });
  async function inspect({ pr_number: number, head_sha: head, task: accepted, reviewed_source, expected_base: base,
    published_branch: publishedBranch }) {
    const task = reviewed_source ?? accepted;
    if (!token) return blocked('repository_or_credential', 'Authenticated GitHub reads are required.');
    const signal = AbortSignal.timeout(10_000);
    const reader = githubReader(read, signal, token, Date.now, null, 0);
    async function get(path, requireComplete = true) {
      const result = await reader.get(path);
      if (requireComplete && result.hasNext) throw new RangeError('Incomplete GitHub response');
      return result.data;
    }

    try {
      const [pr, main] = await Promise.all([get('/pulls/' + number), get('/git/ref/heads/main')]);
      if (pr?.number !== number || pr.base?.repo?.full_name !== REPO || pr.base.ref !== 'main' ||
          !positive(pr.base.repo.id) || !isRevision(pr.head?.sha) ||
          main?.ref !== 'refs/heads/main' || main.object?.type !== 'commit' || !isRevision(main.object.sha)) {
        return blocked('identity', 'GitHub did not confirm the repository, pull request, and target branch.');
      }
      const evidence = {
        pr_number: number, url: 'https://github.com/' + REPO + '/pull/' + number,
        observed_head: pr.head.sha, base_sha: main.object.sha, pr_created_at: observedTime(pr.created_at),
      };
      if (head !== pr.head.sha) return blocked('head_drift', 'The pull request head changed. Confirm the new revision separately.', evidence);
      if (task && (pr.head.repo?.id !== pr.base.repo.id || pr.head.repo.full_name !== REPO || pr.head.ref !== (publishedBranch ?? task.branch))) {
        return blocked('identity', 'The pull request is outside the reviewed Task branch.', evidence);
      }
      if (task) {
        const commit = await get('/commits/' + head);
        if (commit?.sha !== head || commit.parents?.length !== 1 || commit.parents[0]?.sha !== task.parent_sha ||
            !isRevision(commit.commit?.tree?.sha) || (task.tree_sha && commit.commit.tree.sha !== task.tree_sha)) {
          return blocked('identity', 'GitHub did not confirm the reviewed Task commit and its original parent.', evidence);
        }
        evidence.tree_sha = commit.commit.tree.sha;
      }
      if (pr.merged === true) {
        if (pr.state !== 'closed' || !observedTime(pr.merged_at)) {
          return blocked('merge_readback', 'GitHub did not provide a complete merge record.', evidence);
        }
        let mergedSha = pr.merge_commit_sha;
        if (!isRevision(mergedSha)) {
          // The async merge API version can omit the resulting SHA on the PR.
          // Read the older representation for the same closed, exact-head PR.
          const legacy = githubReader((url, init) => read(url, init, mergeCommitReadVersion),
            signal, token, Date.now, null, 0);
          const { data, hasNext } = await legacy.get('/pulls/' + number);
          if (hasNext || data?.number !== number || data.state !== 'closed' || data.merged !== true ||
              data.merged_at !== pr.merged_at || data.head?.sha !== head || data.base?.ref !== 'main' ||
              data.base.repo?.id !== pr.base.repo.id || data.base.repo.full_name !== REPO ||
              !isRevision(data.merge_commit_sha)) {
            return blocked('merge_readback', 'GitHub did not provide a complete merge record for the same pull request.', evidence);
          }
          mergedSha = data.merge_commit_sha;
        }
        if (main.object.sha !== mergedSha) {
          const relation = await get('/compare/' + mergedSha + '...' + main.object.sha + '?per_page=1', false);
          if (relation?.status !== 'ahead' || relation.merge_base_commit?.sha !== mergedSha) {
            return blocked('merge_readback', 'The reported merge commit could not be verified on main.', evidence);
          }
        }
        return { ...evidence, state: 'merged', merged_sha: mergedSha, merged_at: pr.merged_at };
      }
      if (pr.state !== 'open' || pr.draft) return blocked('pr_state', 'The pull request must be open and ready for review.', evidence);
      if (pr.stack) return blocked('policy', 'Stacked pull requests require separate authorization for every affected pull request.', evidence);
      if (!isRevision(pr.base.sha) || pr.base.sha !== main.object.sha || (base && base !== main.object.sha)) {
        return blocked('base_drift', 'The observed main revision changed. Inspect the new base before proceeding.', evidence);
      }
      if (pr.mergeable === false || pr.mergeable_state === 'dirty') {
        return blocked('merge_conflict', 'GitHub reports a merge conflict.', evidence);
      }

      const [rules, protection, checks, statuses, runs] = await Promise.all([
        get('/rules/branches/main?per_page=100'),
        get('/branches/main/protection').catch(error => {
          if (error.status === 404) return null;
          throw error;
        }),
        get('/commits/' + head + '/check-runs?filter=latest&per_page=100'),
        get('/commits/' + head + '/status?per_page=100'),
        get('/actions/runs?head_sha=' + head + '&per_page=100'),
      ]);
      if (!Array.isArray(rules) || !Array.isArray(checks?.check_runs) || checks.total_count !== checks.check_runs.length ||
          statuses?.sha !== head || !Array.isArray(statuses.statuses) || statuses.total_count !== statuses.statuses.length ||
          !Array.isArray(runs?.workflow_runs) || runs.total_count !== runs.workflow_runs.length ||
          checks.check_runs.some(check => check.head_sha !== head) ||
          runs.workflow_runs.some(run => run.head_sha !== head)) {
        return blocked('stale_checks', 'GitHub did not return a complete exact-head check set.', evidence);
      }
      const legacyChecks = protection?.required_status_checks?.checks ?? [];
      const required = [
        ...(protection?.required_status_checks?.contexts ?? []).filter(context =>
          !legacyChecks.some(check => check.context === context)).map(context => ({ context, source: 'legacy' })),
        ...legacyChecks.map(check => ({
          context: check.context, app: check.app_id > 0 ? check.app_id : null, source: 'legacy',
        })),
        ...rules.filter(rule => rule.type === 'required_status_checks').flatMap(rule =>
          (rule.parameters?.required_status_checks ?? []).map(check => ({
            context: check.context, app: check.integration_id > 0 ? check.integration_id : null, source: 'ruleset',
          }))),
      ];
      evidence.queue_required = rules.some(rule => rule.type === 'merge_queue');
      evidence.strict_base = protection?.required_status_checks?.strict === true ||
        rules.some(rule => rule.type === 'required_status_checks' && rule.parameters?.strict_required_status_checks_policy === true);
      evidence.review_required = Boolean(protection?.required_pull_request_reviews || rules.some(rule => rule.type === 'pull_request'));
      evidence.required_approvals = Math.max(0, protection?.required_pull_request_reviews?.required_approving_review_count ?? 0,
        ...rules.filter(rule => rule.type === 'pull_request').map(rule => rule.parameters?.required_approving_review_count ?? 0));
      evidence.policy_observed = Boolean(protection || rules.length);
      const failedRequiredCheckURLs = new Set();
      evidence.checks = required.filter((check, index) => normalizedName(check.context) &&
        required.findIndex(other => other.context === check.context && other.app === check.app && other.source === check.source) === index)
        .map(({ context, app, source }) => {
          const checkRuns = checks.check_runs.filter(check => check.name === context && (!app || check.app?.id === app));
          const commitStatus = !app && statuses.statuses.find(status => status.context === context);
          const results = checkRuns.map(check => check.conclusion ?? check.status);
          if (commitStatus) results.push(commitStatus.state);
          const state = !results.length ? 'missing' : results.some(result => !passing.has(result) && !pending.has(result))
            ? 'failed' : results.some(result => pending.has(result)) ? 'pending' : 'passed';
          for (const check of checkRuns) {
            if (positive(check.id) && !passing.has(check.conclusion ?? check.status) &&
                !pending.has(check.conclusion ?? check.status)) {
              failedRequiredCheckURLs.add('https://api.github.com/repos/' + REPO + '/check-runs/' + check.id);
            }
          }
          return { context, app: app ?? null, source, state };
        });
      evidence.workflows = runs.workflow_runs.filter(run => positive(run.id) && positive(run.workflow_id) &&
        positive(run.run_attempt) && run.repository?.id === pr.base.repo.id).slice(0, 40).map(run => ({
        run_id: run.id, workflow_id: run.workflow_id, attempt: run.run_attempt,
        head_sha: head, name: normalizedName(run.name), url: runLink(run.id),
        same_repository: run.repository?.full_name === REPO && run.head_repository?.full_name === REPO,
        status: normalizedName(run.status), conclusion: normalizedName(run.conclusion),
        created_at: observedTime(run.created_at), run_started_at: observedTime(run.run_started_at), updated_at: observedTime(run.updated_at),
      }));
      if (!evidence.policy_observed) return blocked('policy', 'No active merge protections were visible.', evidence);
      if (!evidence.checks.length || evidence.checks.some(check => check.state === 'missing')) {
        return blocked('missing_checks', 'Required check evidence is missing for this revision.', evidence);
      }
      if (evidence.checks.some(check => check.state === 'failed')) {
        const failed = evidence.workflows.filter(run => run.status === 'completed' && run.conclusion &&
          !passing.has(run.conclusion)).slice(0, 3);
        evidence.jobs = (await Promise.all(failed.map(async run => {
          try {
            const result = await get('/actions/runs/' + run.run_id + '/attempts/' + run.attempt + '/jobs?per_page=100');
            if (!Array.isArray(result?.jobs) || result.total_count !== result.jobs.length) return [];
            return result.jobs.filter(job => positive(job.id) && job.run_id === run.run_id &&
              (job.run_attempt === undefined || job.run_attempt === run.attempt) &&
              job.head_sha === head && job.status === 'completed' &&
              ['failure', 'timed_out', 'startup_failure'].includes(job.conclusion) && Array.isArray(job.steps)).slice(0, 8).map(job => ({
              job_id: job.id, run_id: run.run_id, attempt: run.attempt, workflow_id: run.workflow_id,
              name: normalizedName(job.name), conclusion: job.conclusion, head_sha: head,
              url: run.url + '/job/' + job.id,
              required_check: run.same_repository && failedRequiredCheckURLs.has(job.check_run_url),
              infrastructure: ['startup_failure', 'stale'].includes(run.conclusion) &&
                !(job.steps ?? []).some(step => step.conclusion === 'failure'),
              failed_steps: (job.steps ?? []).filter(step => step.conclusion === 'failure' && positive(step.number))
                .slice(0, 8).map(step => ({ number: step.number, name: normalizedName(step.name) })),
            }));
          } catch { return []; }
        }))).flat();
        const transient = evidence.jobs.some(job => job.infrastructure) && !evidence.jobs.some(job => job.failed_steps.length);
        return blocked(transient ? 'ci_infrastructure' : 'ci_failure', 'GitHub reports a failed required check.', evidence);
      }
      if (pr.mergeable !== true || evidence.checks.some(check => check.state === 'pending')) {
        return { ...evidence, state: 'checking' };
      }
      // GitHub evaluates required reviews, status sources, conversation resolution and other rules together.
      if (pr.mergeable_state !== 'clean') return blocked('policy', 'GitHub has not cleared all merge requirements.', evidence);
      return { ...evidence, state: 'merge_ready' };
    } catch (error) {
      const failure = classify(error);
      const retryAt = reader.status().retryAt;
      return failure.reason === 'rate_limited' && Number.isSafeInteger(retryAt) && retryAt > Date.now()
        ? {...failure,retry_at:retryAt} : failure;
    }
  }

  async function requestMerge(number, head, method, queue, base) {
    if (!mergeToken || !token || !isRevision(head) || !isRevision(base)) return { status: 'unavailable' };
    const reader = githubReader(read, AbortSignal.timeout(5000), token, Date.now, null, 0);
    try {
      const [{ data: pr }, { data: main }] = await Promise.all([
        reader.get('/pulls/' + number), reader.get('/git/ref/heads/main'),
      ]);
      if (pr?.number !== number || pr.base?.repo?.full_name !== REPO || pr.base.ref !== 'main' ||
          pr.base.sha !== base || pr.head?.sha !== head || pr.state !== 'open' || pr.draft || pr.stack ||
          main?.ref !== 'refs/heads/main' || main.object?.type !== 'commit' || main.object.sha !== base) {
        return { status: 'rejected', reason: 'head_or_base_drift' };
      }
    } catch {
      return { status: 'rejected', reason: 'target_read_unavailable' };
    }
    try {
      const response = await fetcher('https://api.github.com/repos/' + REPO + '/pulls/' + number + '/merge-async', {
        method: 'PUT', redirect: 'manual', signal: AbortSignal.timeout(10_000),
        headers: {
          Accept: 'application/vnd.github+json', 'Content-Type': 'application/json',
          'User-Agent': 'Aetherwake-Engineering-Observatory',
          'X-GitHub-Api-Version': apiVersion, Authorization: 'Bearer ' + mergeToken,
        },
        body: JSON.stringify({ sha: head, merge_method: method, merge_action: queue ? 'merge_queue' : 'direct_merge', bypass_rules: false }),
      });
      const result = JSON.parse(await readBounded(response.body, 8192));
      if ([200, 202].includes(response.status) && ['merged', 'enqueued', 'pending'].includes(result?.status)) {
        const requestId = result.details?.uuid;
        return { status: result.status, ...(typeof requestId === 'string' && /^[a-f0-9-]{36}$/.test(requestId)
          ? { github_request_id: requestId } : {}) };
      }
      if ([400, 401, 403, 404, 405, 422].includes(response.status)) {
        return { status: 'rejected', http_status: response.status };
      }
    } catch { /* A connection loss is ambiguous. Reconcile from GitHub before any further action. */ }
    return { status: 'unknown' };
  }

  async function rerunTarget(run) {
    if (!token || !positive(run.pr_number) || !isRevision(run.head_sha) || !isRevision(run.evidence?.base_sha)) return false;
    const reader = githubReader(read,AbortSignal.timeout(5000),token,Date.now,null,0);
    try {
      const [{data:pr},{data:main}] = await Promise.all([
        reader.get('/pulls/'+run.pr_number),reader.get('/git/ref/heads/main'),
      ]);
      return pr?.number === run.pr_number && pr.state === 'open' && !pr.draft &&
        pr.base?.repo?.full_name === REPO && pr.base.ref === 'main' && pr.base.sha === run.evidence.base_sha &&
        pr.head?.sha === run.head_sha && main?.ref === 'refs/heads/main' && main.object?.type === 'commit' &&
        main.object.sha === run.evidence.base_sha;
    } catch { return false; }
  }

  async function mergeStatus(number, requestId) {
    if (!mergeToken || typeof requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(requestId)) return null;
    try {
      const response = await fetcher('https://api.github.com/repos/' + REPO + '/pulls/' + number + '/merge-async/' + requestId, {
        redirect: 'manual', signal: AbortSignal.timeout(5000),
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': apiVersion,
          'User-Agent': 'Aetherwake-Engineering-Observatory', Authorization: 'Bearer ' + mergeToken },
      });
      const result = JSON.parse(await readBounded(response.body, 8192));
      return response.ok && ['pending', 'failed', 'enqueued', 'merged'].includes(result?.status) ? result.status : null;
    } catch { return null; }
  }

  async function publicationSource(task, branch) {
    if (!token) return { reason: 'Authenticated GitHub reads are required.' };
    const reader = githubReader(read, AbortSignal.timeout(8000), token, Date.now, null, 0);
    try {
      const branchRules = await reader.get('/rules/branches/' + encodeURIComponent(branch) + '?per_page=100');
      const rules = Array.isArray(branchRules.data) && !branchRules.hasNext ? branchRules.data : [];
      const frozen = rules.find(rule => rule.type === 'update' && rule.ruleset_source_type === 'Repository' &&
        rule.ruleset_source === REPO && positive(rule.ruleset_id) &&
        rules.some(item => item.ruleset_id === rule.ruleset_id && item.type === 'deletion'));
      if (!frozen) return { reason: 'The integration branch needs an active ruleset restricting updates and deletion.' };
      const ruleset = await reader.get('/rulesets/' + frozen.ruleset_id);
      if (ruleset.data?.enforcement !== 'active' || !Array.isArray(ruleset.data.bypass_actors) || ruleset.data.bypass_actors.length) {
        return { reason: 'GitHub did not confirm that the integration branch ruleset disallows bypass.' };
      }
      const ref = await reader.get('/git/ref/heads/' + branch.split('/').map(encodeURIComponent).join('/')).catch(error => {
        if (error.status === 404) return null;
        throw error;
      });
      if (ref && (ref.data?.ref !== 'refs/heads/' + branch || ref.data.object?.type !== 'commit' ||
          ref.data.object.sha !== task.head_sha)) return { reason: 'The integration branch points at a different commit.' };
      const commit = await reader.get('/commits/' + task.head_sha).catch(error => {
        if (error.status === 404) return null;
        throw error;
      });
      if (!commit && !ref) {
        return { transfer_required: true, reason: 'The reviewed commit needs transfer to the protected GitHub branch.' };
      }
      if (commit?.data?.sha !== task.head_sha ||
          commit.data.parents?.length !== 1 || commit.data.parents[0]?.sha !== task.parent_sha ||
          !isRevision(commit.data.commit?.tree?.sha)) return { reason: 'GitHub did not confirm the reviewed candidate and its parent.' };
      const [account] = REPO.split('/');
      const filtered = await reader.get('/pulls?state=open&base=main&head=' + encodeURIComponent(account + ':' + branch) + '&per_page=5');
      if (filtered.hasNext || !Array.isArray(filtered.data)) return { reason: 'GitHub did not return an unambiguous pull request set.' };
      const matching = filtered.data.filter(pr => positive(pr.number) && pr.state === 'open' && pr.head?.sha === task.head_sha &&
        pr.head.ref === branch && pr.head.repo?.full_name === REPO && pr.base?.ref === 'main' && pr.base.repo?.full_name === REPO);
      if (matching.length > 1 || (filtered.data.length && matching.length !== filtered.data.length)) {
        return { reason: 'GitHub returned a pull request outside the confirmed source identity.' };
      }
      return { available: true, branch_exists: Boolean(ref), pr_number: matching[0]?.number, tree_sha: commit.data.commit.tree.sha };
    } catch (error) {
      return { reason: error.status === 404 ? 'The exact candidate branch is not available on GitHub.' : classify(error).detail };
    }
  }

  async function openCandidatePull(task, branch, source) {
    if (!publishToken) return { status: 'rejected' };
    try {
      const post = (path, body) => fetcher('https://api.github.com/repos/' + REPO + path, {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(8000),
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': apiVersion,
          'Content-Type': 'application/json', 'User-Agent': 'Aetherwake-Engineering-Observatory', Authorization: 'Bearer ' + publishToken },
        body: JSON.stringify(body),
      });
      if (!source.branch_exists) {
        const created = await post('/git/refs', { ref: 'refs/heads/' + branch, sha: task.head_sha });
        await created.body?.cancel();
        if (created.status !== 201) return { status: [400, 401, 403, 404].includes(created.status) ? 'rejected' : 'unknown' };
      }
      const verified = await publicationSource(task, branch);
      if (!verified.available || !verified.branch_exists || verified.tree_sha !== source.tree_sha) return { status: 'unknown' };
      if (verified.pr_number) return { status: 'opened', pr_number: verified.pr_number };
      // Task titles, owner feedback, and private Task identities stay in Observatory.
      const response = await post('/pulls', { title: 'Integrate reviewed candidate ' + task.head_sha.slice(0, 12),
        base: 'main', head: branch, maintainer_can_modify: false });
      const result = JSON.parse(await readBounded(response.body, 512 * 1024));
      if (response.status === 201 && positive(result?.number)) return { status: 'opened', pr_number: result.number };
      if ([400, 401, 403, 404].includes(response.status)) return { status: 'rejected' };
    } catch { /* An independent lookup can reconcile a lost or ambiguous response. */ }
    return { status: 'unknown' };
  }

  async function repairSource(run, { includeLogs = false, evidence: observed, allowedPaths } = {}) {
    const evidence = observed ?? await inspect({ ...run, expected_base: run.evidence?.base_sha });
    if (evidence.reason !== 'ci_failure') return null;
    const jobs = (evidence.jobs ?? []).filter(job => !job.infrastructure && job.failed_steps?.length && job.head_sha === run.head_sha);
    if (!jobs.length || !token) return null;
    const reader = githubReader(read, AbortSignal.timeout(8000), token, Date.now, null, 0);
    try {
      const files = await reader.get('/pulls/' + run.pr_number + '/files?per_page=100');
      const latest = (await reader.get('/pulls/' + run.pr_number)).data;
      if (files.hasNext || !Array.isArray(files.data) || latest.number !== run.pr_number || latest.state !== 'open' ||
          latest.head?.sha !== run.head_sha || latest.base?.sha !== evidence.base_sha ||
          latest.base?.ref !== 'main' || latest.base?.repo?.full_name !== REPO) return null;
      const paths = [...new Set(files.data.filter(file => ['modified', 'added', 'renamed'].includes(file.status) &&
        repairablePath(file.filename)).map(file => file.filename))];
      if (allowedPaths && !allowedPaths.every(path=>paths.includes(path))) return null;
      const result = { head_sha:run.head_sha, base_sha:evidence.base_sha, pr_number:run.pr_number, paths,
        jobs:jobs.slice(0,5).map(job => ({ job_id:job.job_id, run_id:job.run_id, run_attempt:job.attempt,
          workflow_id:job.workflow_id, steps:job.failed_steps.slice(0,5).map(step => ({
            number:step.number, name:safeDiagnostic(step.name),
          })) })) };
      if (!includeLogs) return result;
      const targets = result.jobs.flatMap((job,index) => jobs[index].required_check
        ? job.steps.map(step=>({job:jobs[index],step})) : []).slice(0,3);
      const logSignal = AbortSignal.timeout(6500);
      await Promise.all(targets.map(async ({job,step}) => {
        step.log = await githubStepLog({ fetcher, token, signal:logSignal, apiVersion, job, step, paths:allowedPaths ?? paths });
      }));
      if (targets.some(({step})=>step.log.status === 'observed')) {
        const rebound = githubReader(read, AbortSignal.timeout(4000), token, Date.now, null, 0);
        const [fresh, main, ...runs] = await Promise.all([
          rebound.get('/pulls/' + run.pr_number),
          rebound.get('/git/ref/heads/main'),
          ...[...new Map(targets.map(({job})=>[job.run_id,job])).values()].map(async job => {
            const {data} = await rebound.get('/actions/runs/' + job.run_id);
            return data?.id === job.run_id && data.workflow_id === job.workflow_id && data.run_attempt === job.attempt &&
              data.status === 'completed' && data.head_sha === run.head_sha && data.repository?.full_name === REPO;
          }),
        ]);
        if (fresh.data?.number !== run.pr_number || fresh.data.state !== 'open' || fresh.data.head?.sha !== run.head_sha ||
            fresh.data.base?.sha !== evidence.base_sha || fresh.data.base?.ref !== 'main' ||
            fresh.data.base?.repo?.full_name !== REPO || main.data?.ref !== 'refs/heads/main' ||
            main.data.object?.type !== 'commit' || main.data.object.sha !== evidence.base_sha ||
            runs.some(match=>!match)) return null;
      }
      return result;
    } catch { return null; }
  }

  async function transferAnchor(revision) {
    if (!token || !isRevision(revision)) return false;
    const reader = githubReader(read, AbortSignal.timeout(5000), token, Date.now, null, 0);
    try { return (await reader.get('/commits/' + revision)).data?.sha === revision; }
    catch { return false; }
  }

  return { inspect, requestMerge, rerunTarget, mergeStatus, publicationSource, openCandidatePull, repairSource, transferAnchor };
}
