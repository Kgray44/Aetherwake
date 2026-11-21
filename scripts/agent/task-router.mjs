#!/usr/bin/env node
/**
 * Phase B: deterministic engineering-task workflow selection.
 * This is NOT Vela MissionService's task router and does not replace governance.
 * No model calls, task status writes, shell execution, or fabricated acceptance.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createSnapshot, checkFreshness, taskDigest, writeSnapshot } from './context.mjs';
import { canonical } from './evidence-trust.mjs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const config = JSON.parse(readFileSync(new URL('../../agent-system/task-classes.json', import.meta.url), 'utf8'));
export const taskClasses = Object.freeze(Object.keys(config.classes));
const shaPattern = /^[a-f\d]{40}$/i;

function invalid(message) { throw new Error(message); }
function safePath(value) {
  if (typeof value !== 'string' || !value.trim()) invalid('Path must be a nonempty string');
  // Reject aliases before normalization so traversal and Windows paths cannot
  // erase risk-bearing segments differently across operating systems.
  const normalized = value.replaceAll('\\', '/');
  if (/^[a-z]:/i.test(normalized) || normalized.startsWith('/') || /[\x00-\x1f\x7f]/.test(normalized)
      || normalized.split('/').some(part => !part || part === '.' || part === '..')) invalid('Path must remain inside repository without ambiguous segments: ' + value);
  return normalized;
}
function unique(strings) { return [...new Set(strings)]; }
function requiredString(obj, key) {
  if (typeof obj?.[key] !== 'string' || !obj[key].trim()) invalid('Task missing required ' + key);
}
function focusedVerification(paths) {
  const jobs = new Map();
  const unmapped = [];
  const sources = [];
  const addTests = (cwd, files) => {
    const tests = jobs.get(cwd) ?? new Set();
    for (const file of files) tests.add(file);
    jobs.set(cwd, tests);
  };
  for (const path of paths) {
    const direct = path.match(/^prototypes\/integrated-backend\/(tests\/[A-Za-z0-9][A-Za-z0-9_-]*\.test\.mts)$/);
    if (direct) {
      addTests('prototypes/integrated-backend', [direct[1]]);
      sources.push({ path, relationship: 'changed-test', tests: [direct[1]] });
      continue;
    }
    const targets = config.verification_targets.filter(target => target.paths.includes(path));
    if (!targets.length) unmapped.push(path);
    for (const target of targets) {
      addTests(target.cwd, target.tests);
      sources.push({ path, relationship: target.id, tests: target.tests });
    }
  }
  return {
    focused_commands: [...jobs].map(([cwd, tests]) => ({ cwd, argv: ['node', '--test', ...[...tests].sort()] })),
    known_relationships: sources,
    unmapped_paths: unmapped,
    coverage: 'Known first-pass checks. Affected scope, integration, risk-specific obligations and acceptance still require review.',
    reused_evidence: []
  };
}
export function routeTask(task, inputPaths = []) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) invalid('Task must be an object');
  if (task.schema_version !== 1 || task.record_type !== 'task') invalid('Expected foundation v1 Task record');
  for (const name of ['id','title','objective','repository','created_at']) requiredString(task,name);
  if (typeof task.revision !== 'string' || !shaPattern.test(task.revision)) invalid('Task revision must be full 40-character Git SHA');
  if (!task.classification || !taskClasses.includes(task.classification.primary)) invalid('Unknown primary task class');
  const secondary = task.classification.secondary ?? [];
  if (!Array.isArray(secondary) || secondary.some(c => !taskClasses.includes(c))) invalid('Unknown secondary task class');
  if (!task.prerequisites || !Array.isArray(task.prerequisites.task_ids) || !Array.isArray(task.prerequisites.capabilities)) invalid('Task prerequisites must specify task_ids and capabilities');
  if (!task.acceptance || typeof task.acceptance.profile_id !== 'string' || !Array.isArray(task.acceptance.criteria) || !task.acceptance.criteria.length) invalid('Task requires acceptance profile_id and nonempty criteria');
  if (typeof task.state !== 'string') invalid('Task requires state');
  const selected = unique([task.classification.primary,...secondary]);
  if (!Array.isArray(inputPaths)) invalid('Affected paths must be an array');
  const paths = unique(inputPaths.map(safePath));
  const risks = unique([
    ...selected.filter(c => Object.hasOwn(config.additive_risks,c)),
    ...config.path_risks.filter(r => paths.some(p => r.path_prefixes.some(prefix => p.toLowerCase().startsWith(prefix.toLowerCase())))).map(r => r.risk)
  ]);
  const checks = unique([
    ...config.universal_checks,
    ...selected.flatMap(c => config.classes[c].checks),
    ...risks.flatMap(r => config.additive_risks[r].checks)
  ]);
  const warnings = [
    'Classification adds checks but cannot waive ratified governance, Trust, required approval, native-test admission, or owner visual acceptance.',
    'Path-based risk detection is advisory and not exhaustive; inspect actual source ownership and applicable charters.',
    'This is a workflow proposal, not VerificationProfile Evidence or a claim of completed tests.'
  ];
  return {
    schema_version: 1,
    policy_revision: config.policy_revision,
    task_id: task.id,
    task_revision: task.revision,
    primary_class: task.classification.primary,
    selected_classes: selected,
    detected_risks: risks,
    affected_paths: paths,
    workflow_skills: unique([...selected, ...risks.filter(r => Object.hasOwn(config.classes, r))]).map(c => config.classes[c].skill),
    scope_coverage: paths.length ? 'requires-owner-review' : 'unavailable',
    task_acceptance_criterion_ids: task.acceptance.criteria.map(c => c.id),
    required_check_ids: checks,
    verification_plan: focusedVerification(paths),
    acceptance_profile_id: task.acceptance.profile_id,
    prerequisite_task_ids: task.prerequisites.task_ids,
    prerequisite_capabilities: task.prerequisites.capabilities,
    governance: {
      router_argv: ['node','scripts/governance-router.mjs','--task',task.objective,...paths.flatMap(p => ['--path',p])],
      context_argv: ['node','scripts/governance-context.mjs','--task',task.objective,...paths.flatMap(p => ['--path',p])],
      required: true
    },
    warnings
  };
}
/** Prepare the existing workflow proposal and a source-verified reusable snapshot. */
export async function prepareTask(task, {
  paths = [], owners = [], checkout = process.cwd(), contextFile, includeGovernance = false, governanceFormat = 'json'
} = {}) {
  if (!['json','compact'].includes(governanceFormat) || (!includeGovernance && governanceFormat !== 'json')) {
    invalid('Compact governance requires governance preparation');
  }
  const plan = routeTask(task, paths);
  if (!owners.length) invalid('Provide source-backed ownership with --owner component=tracked/path');
  let snapshot;
  if (contextFile) {
    try {
      snapshot = JSON.parse(await readFile(contextFile, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (snapshot) {
    const recordedOwners = snapshot.components?.map(({ name, owner_ref }) => name + '=' + owner_ref.uri);
    const sameOwners = recordedOwners && owners.length === recordedOwners.length &&
      owners.every((owner, index) => owner.replaceAll('\\', '/') === recordedOwners[index]);
    if (!sameOwners || !await checkFreshness(snapshot, task, task.revision, checkout)) {
      invalid('Context file is stale or its ownership scope differs. Use a new context file.');
    }
  }
  const reused = Boolean(snapshot);
  if (!snapshot) {
    snapshot = await createSnapshot({ root: checkout, task, repository: task.repository, owners });
    if (snapshot.freshness !== 'current') invalid('Task context is not current: ' + snapshot.warnings.join('; '));
  }
  const result = { ...plan, context_snapshot: snapshot, context_reused: reused };
  if (includeGovernance) {
    const payload = execFileSync(process.execPath, [
      ...plan.governance.context_argv.slice(1), '--'+governanceFormat
    ], { cwd: checkout, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    result.governance_context = governanceFormat === 'json' ? JSON.parse(payload) : payload.trimEnd();
    if (governanceFormat === 'compact') result.governance_format = 'compact';
  }
  if (contextFile && !reused) await writeSnapshot(contextFile, snapshot);
  return result;
}

export function contextExperimentScope(task, plan) {
  return {
    revision:plan.task_revision, policy_revision:plan.policy_revision, task_digest:taskDigest(task),
    affected_paths:[...plan.affected_paths].sort(), checks:[...plan.required_check_ids].sort(),
  };
}

/** Apply the independently reviewed holdout and regression rules from PR #326 to a context-only trial. */
export function evaluateContextRollout(task, plan, evidence, now = Date.now()) {
  const keep = reason => ({status:'keep_configured', authorized:false, reason});
  if (!plan.affected_paths.length || evidence?.schema_version!==1 ||
      evidence.configured!=='json' || evidence.candidate!=='compact' ||
      canonical(evidence.scope)!==canonical(contextExperimentScope(task,plan)) ||
      !Array.isArray(evidence.reviews) || evidence.reviews.length>100 || !Number.isFinite(now)) {
    return keep('scope_incomplete');
  }
  const sha256 = value => typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
  const usd = value => Number.isFinite(value) && value>=0;
  const receipts = new Set(), workloads = new Set();
  for (const review of evidence.reviews) {
    if (review?.independently_reviewed!==true || !sha256(review.review_receipt) ||
        !sha256(review.workload_digest) || !(Date.parse(review.expires_at)>now)) continue;
    if (review.guardrails_passed===false || review.candidate_verified===false ||
        (usd(review.baseline_full_cost_usd) && usd(review.candidate_full_cost_usd) &&
        review.candidate_full_cost_usd>review.baseline_full_cost_usd)) return keep('regression');
    if (review.holdout!==true || review.matched!==true || review.guardrails_passed!==true ||
        review.baseline_verified!==true || review.candidate_verified!==true ||
        !usd(review.baseline_full_cost_usd) || !usd(review.candidate_full_cost_usd) ||
        review.candidate_full_cost_usd>=review.baseline_full_cost_usd) continue;
    if (receipts.has(review.review_receipt)||workloads.has(review.workload_digest)) return keep('review_identity_reused');
    receipts.add(review.review_receipt);
    workloads.add(review.workload_digest);
  }
  return receipts.size<2 ? keep('no_qualified_improvement') :
    {status:'candidate', authorized:false, format:'compact', verified_pairs:receipts.size, fallback:'json'};
}

function usage() {
  return 'Usage: node scripts/agent/task-router.mjs --task-file <v1-task.json> [--path <repo-path>]... [--json] [--execution-evidence <private.json> --json] [--prepare --owner component=tracked/path [--context-file <private.json>] [--with-governance [--compact-governance] --json]]';
}
async function main(argv) {
  let file, contextFile, executionEvidence;
  const paths=[], owners=[];
  let json=false, prepare=false, includeGovernance=false, governanceFormat='json';
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];
    if(arg==='--task-file') { file=argv[++i]; if(!file) invalid('--task-file requires path'); }
    else if(arg==='--path') { const p=argv[++i]; if(!p) invalid('--path requires value'); paths.push(p); }
    else if(arg==='--owner') { const owner=argv[++i]; if(!owner) invalid('--owner requires value'); owners.push(owner); }
    else if(arg==='--context-file') { contextFile=argv[++i]; if(!contextFile) invalid('--context-file requires path'); }
    else if(arg==='--prepare') prepare=true;
    else if(arg==='--with-governance') includeGovernance=true;
    else if(arg==='--compact-governance') governanceFormat='compact';
    else if(arg==='--execution-evidence') { executionEvidence=argv[++i]; if(!executionEvidence) invalid('--execution-evidence requires path'); }
    else if(arg==='--json') json=true;
    else if(arg==='--help' || arg==='-h') { console.log(usage()); return; }
    else invalid('Unknown argument: ' + arg);
  }
  if(!file) invalid(usage());
  const task=JSON.parse(readFileSync(resolve(process.cwd(),file),'utf8'));
  if(!prepare && (contextFile || owners.length)) invalid('Context options require --prepare');
  if(includeGovernance && !(prepare && json)) invalid('--with-governance requires --prepare and --json');
  if(governanceFormat==='compact'&&!includeGovernance) invalid('--compact-governance requires --with-governance');
  if(executionEvidence&&!json) invalid('--execution-evidence requires --json');
  const plan=prepare ? await prepareTask(task,{paths,owners,contextFile,includeGovernance,governanceFormat}) : routeTask(task,paths);
  if(executionEvidence) plan.context_rollout=evaluateContextRollout(task,plan,JSON.parse(await readFile(executionEvidence,'utf8')));
  if(json) console.log(JSON.stringify(plan,null,2));
  else {
    console.log('Engineering Task: ' + plan.task_id + ' (' + plan.primary_class + ')');
    if(prepare) console.log('Context: ' + plan.context_snapshot.id + (plan.context_reused ? ' (reused)' : ' (created)'));
    console.log('Skills: ' + plan.workflow_skills.join(', '));
    console.log('Checks: ' + plan.required_check_ids.join(', '));
    for (const command of plan.verification_plan.focused_commands) {
      console.log('Focused check from ' + command.cwd + ': ' + JSON.stringify(command.argv));
    }
    if (plan.verification_plan.unmapped_paths.length) {
      console.log('Focused mapping unavailable for ' + plan.verification_plan.unmapped_paths.length + ' path(s).');
    }
    console.log('Governance router args: ' + JSON.stringify(plan.governance.router_argv));
    console.log('Governance context args: ' + JSON.stringify(plan.governance.context_argv));
    for(const w of plan.warnings) console.log('NOTICE: ' + w);
  }
}
if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)){
  main(process.argv.slice(2)).catch(error => { console.error('Task routing failed: ' + error.message); process.exitCode=1; });
}
