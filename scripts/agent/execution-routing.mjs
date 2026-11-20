import { canonical } from './evidence-trust.mjs';

const dayMs = 86_400_000;
const difficulties = new Set(['simple', 'moderate', 'complex']);
const safeLabel = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value);
const routeKey = route => [route?.provider,route?.model,route?.effort,route?.client_version].every(safeLabel) ?
  JSON.stringify([route.provider,route.model,route.effort,route.client_version]) : null;
const routeFields = ({provider,model,effort,client_version}) => ({provider,model,effort,client_version});
const finiteCount = n => Number.isSafeInteger(n) && n >= 0;
const totalUsd = n => Number.isFinite(n) && n >= 0;

export function executionEvidenceScope(task, plan, request) {
  return {
    repository:task.repository,revision:plan.task_revision,workflow_policy_revision:plan.policy_revision,
    primary_class:plan.primary_class,classes:[...plan.selected_classes].sort(),risks:[...plan.detected_risks].sort(),
    paths:[...plan.affected_paths].sort(),check_ids:[...plan.required_check_ids].sort(),
    acceptance_profile_id:plan.acceptance_profile_id,criteria:[...plan.task_acceptance_criterion_ids].sort(),
    capabilities:[...plan.prerequisite_capabilities].sort(),
    difficulty:request.difficulty,context_profile:request.context_profile,failed_before:request.failed_before,
  };
}

function catalogSupports(route, catalog) {
  if (!routeKey(route) || route.provider !== catalog.provider || route.client_version !== catalog.client_version) return false;
  const matches = catalog.models.filter(entry => entry?.model === route.model);
  return matches.length === 1 && Array.isArray(matches[0].efforts) && matches[0].efforts.includes(route.effort);
}

/**
 * Evaluate caller-supplied reviewed holdouts. The execution owner authenticates
 * their provenance and separately authorizes any policy promotion.
 */
export function suggestExecutionRoute(task, plan, input, now = Date.now()) {
  const {configured,catalog,request,reviews} = input ?? {};
  const baselineKey = routeKey(configured);
  const keep = reason => ({
    schema_version:1,status:'keep_configured',authorized:false,
    route:baselineKey ? routeFields(configured) : null,reason,
  });
  if (input?.schema_version !== 1 || !Array.isArray(reviews) || reviews.length > 100 ||
      !request || !difficulties.has(request.difficulty) || !safeLabel(request.context_profile) ||
      typeof request.failed_before !== 'boolean' || !plan.affected_paths.length) return keep('scope_incomplete');
  const fetched = Date.parse(catalog?.fetched_at);
  if (!Number.isFinite(now) || !Number.isFinite(fetched) || now < fetched || now - fetched >= dayMs ||
      !Array.isArray(catalog.models) || !catalogSupports(configured,catalog)) return keep('catalog_unqualified');

  const scope = canonical(executionEvidenceScope(task,plan,request));
  const blocked = new Set(), eligible = [], seen = new Set();
  for (const review of reviews) {
    if (!safeLabel(review?.id) || review.independently_reviewed !== true || review.holdout !== true ||
        !(Date.parse(review.expires_at) > now) || canonical(review.scope) !== scope ||
        routeKey(review.configured) !== baselineKey || !catalogSupports(review.candidate,catalog)) continue;
    if (seen.has(review.id)) return keep('review_identity_reused');
    seen.add(review.id);
    const key = routeKey(review.candidate);
    if (key === baselineKey) continue;
    const result = review.paired;
    if (!finiteCount(result?.count) || result.count < 1 ||
        ![result.baseline_verified,result.candidate_verified].every(value => finiteCount(value) && value <= result.count)) continue;
    if (result.guardrails_passed === false || result.candidate_verified < result.baseline_verified) {
      blocked.add(key);
      continue;
    }
    if (result.count < 2 || result.guardrails_passed !== true || result.baseline_verified !== result.count ||
        result.candidate_verified !== result.count || !finiteCount(result.baseline_tokens) ||
        !finiteCount(result.candidate_tokens) || result.candidate_tokens >= result.baseline_tokens) continue;

    const hasCost = totalUsd(result.baseline_cost_usd) && totalUsd(result.candidate_cost_usd);
    if (hasCost && result.candidate_cost_usd > result.baseline_cost_usd) {
      blocked.add(key);
      continue;
    }
    eligible.push({
      key,review,
      tokenRatio:result.candidate_tokens / result.baseline_tokens,
      costRatio:hasCost ? (result.baseline_cost_usd ? result.candidate_cost_usd / result.baseline_cost_usd : 1) : null,
    });
  }
  const usable = eligible.filter(entry => !blocked.has(entry.key));
  if (!usable.length) return keep('no_qualified_improvement');

  const compareCost = usable.every(entry => entry.costRatio !== null);
  usable.sort((a,b) => (compareCost ? a.costRatio-b.costRatio : 0) ||
    a.tokenRatio-b.tokenRatio || b.review.paired.count-a.review.paired.count || a.review.id.localeCompare(b.review.id));
  const best = usable[0].review;
  return {
    schema_version:1,status:'candidate',authorized:false,route:routeFields(best.candidate),
    configured:routeFields(configured),evidence_id:best.id,verified_pairs:best.paired.count,
    comparison_basis:compareCost ? 'observed_usd_then_provider_tokens' : 'provider_tokens',
  };
}
