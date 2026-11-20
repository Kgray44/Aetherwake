// Contract records describe reported evidence, not authenticated acceptance receipts.
// Even matching linked evidence cannot establish acceptance. Partial projections
// remain valid, but missing or inconsistent attempt linkage is shown explicitly.
export function attemptMatchesEvidence(attempt,record) {
  return attempt.id===record.attempt_id && attempt.task_id===record.task_id &&
    (attempt.revision===record.revision||Boolean(attempt.candidate_revision&&attempt.candidate_revision===record.revision));
}
export function criterionEvidenceStatus(evidence, revision, attempts = []) {
  const claims = evidence.filter(record => record.result === 'passed' && record.synthetic === false && record.revision === revision);
  if (!claims.length) return 'unverified';
  const linked = claims.some(record => attempts.some(attempt => attemptMatchesEvidence(attempt,record)));
  return linked ? 'reported_pass_unverified' : 'unverified_missing_attempt';
}
export function ownerReviewByCriterion(task,canonical) {
  const lifecycle=canonical?.lifecycle;
  const attempt=canonical?.attempts?.at(-1);
  const revision=attempt?.candidate_revision;
  if (canonical?.task?.id!==task.id || canonical.task.owner_acceptance!=='accepted' ||
      !['completed','archived'].includes(lifecycle?.stored_state) || attempt?.state!=='succeeded' ||
      typeof revision!=='string'||!/^[a-f0-9]{40}$/.test(revision)) return new Map();
  const at=(canonical.events??[]).findLast(receipt=>receipt.kind==='accept'&&
    receipt.attempt_id===attempt.id&&receipt.revision===revision)?.at;
  const criteria=new Set((task.acceptance?.criteria??[]).map(item=>item.id));
  return new Map((lifecycle.evidence??[]).filter(item=>criteria.has(item.criterion_id)&&item.revision===revision&&
    typeof item.uri==='string'&&item.uri.length>0).map(item=>[item.criterion_id,{...item,at}]));
}

export function evidenceClaimStatus(record, attempts = []) {
  return record.result === 'passed' ? criterionEvidenceStatus([record], record.revision, attempts) : 'reported_' + record.result;
}
