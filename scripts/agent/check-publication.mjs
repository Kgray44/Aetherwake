/** Data-only preparation, not an authenticated publisher. Run only in a reviewed
 * trusted-base verifier with GitHub-issued event and fresh API PR facts. */
import {verifyBundle} from './verify.mjs';
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
export function prepareExactHeadCheck({eventName,event,currentPullRequest,repository,verifierRevision,expectedBaseRef,bundle,verification={}}) {
  if (eventName !== 'pull_request_target') throw Error('Trusted PR-target context required');
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/(?!\.{1,2}$)[A-Za-z0-9_.-]+$/.test(repository ?? '') || !sha(verifierRevision)) throw Error('Invalid trusted verifier identity');
  const pr = event?.pull_request, current = currentPullRequest;
  if (event?.repository?.full_name !== repository || !Number.isSafeInteger(event?.number) || event.number < 1 || pr?.number !== event.number || current?.number !== event.number) throw Error('PR repository/number mismatch');
  if (pr?.base?.repo?.full_name !== repository || current?.base?.repo?.full_name !== repository || pr.base.sha !== verifierRevision || current.base.sha !== verifierRevision) throw Error('Verifier/base revision mismatch');
  if (pr.state !== 'open' || current.state !== 'open' || !sha(pr?.head?.sha) || current?.head?.sha !== pr.head.sha || current?.head?.repo?.full_name !== pr?.head?.repo?.full_name || typeof pr?.head?.repo?.full_name !== 'string') throw Error('Closed, stale or mismatched source head');
  if (typeof expectedBaseRef !== 'string' || !expectedBaseRef.trim() || pr.base.ref !== expectedBaseRef || current.base.ref !== expectedBaseRef) throw Error('PR target branch mismatch or missing trusted target branch');
  if (!Array.isArray(verification.paths) || verification.paths.some(path => typeof path !== 'string' || !path || path.startsWith('/') || path.split('/').includes('..'))) throw Error('Trusted complete changed paths required');
  if (!sha(verification.testedRevision)) throw Error('Exact independently established tested revision required');
  // Expected repository/source cannot be overridden by options or candidate data.
  const result = verifyBundle(bundle, {...verification,repository,revision:pr.head.sha});
  // A permissive profile or pending manual gate never produces blocking success.
  const success = result.ok === true && result.policy === 'enforce' && result.manual_pending === false;
  return Object.freeze({
    repository, pull_request_number: event.number, verifier_revision: verifierRevision,
    request: Object.freeze({name:'AADS evidence (exact source head)',head_sha:pr.head.sha,status:'completed',conclusion:success?'success':'failure',
      output:Object.freeze({title:success?'Required evidence verified':'Required evidence not verified',
        summary:`Source head: ${pr.head.sha}\nTested revision: ${verification.testedRevision}\nTrusted verifier revision: ${verifierRevision}\nEvidence policy checks: ${success?'passed':'not satisfied'}. This check does not grant Task or owner acceptance.`})}),
    // Do not publish candidate-controlled IDs, issue messages, paths or artifacts.
    task_accepted:false,owner_accepted:false,
  });
}
