// Contract records describe reported evidence, not authenticated acceptance receipts.
// Even matching linked evidence cannot establish acceptance. Partial projections
// remain valid, but missing or inconsistent attempt linkage is shown explicitly.
export function criterionEvidenceStatus(evidence, revision, attempts = []) {
  const claims = evidence.filter(record => record.result === 'passed' && record.synthetic === false && record.revision === revision);
  if (!claims.length) return 'unverified';
  const linked = claims.some(record => attempts.some(attempt => attempt.id === record.attempt_id && attempt.task_id === record.task_id && attempt.revision === record.revision));
  return linked ? 'reported_pass_unverified' : 'unverified_missing_attempt';
}
export function evidenceClaimStatus(record, attempts = []) {
  return record.result === 'passed' ? criterionEvidenceStatus([record], record.revision, attempts) : 'reported_' + record.result;
}
