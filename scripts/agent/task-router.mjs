#!/usr/bin/env node
/**
 * Phase B: deterministic engineering-task workflow selection.
 * This is NOT Vela MissionService's task router and does not replace governance.
 * No model calls, task status writes, shell execution, or fabricated acceptance.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createSnapshot, checkFreshness, writeSnapshot } from './context.mjs';
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
  paths = [], owners = [], checkout = process.cwd(), contextFile, includeGovernance = false
} = {}) {
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
    result.governance_context = JSON.parse(execFileSync(process.execPath, [
      ...plan.governance.context_argv.slice(1), '--json'
    ], { cwd: checkout, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
  }
  if (contextFile && !reused) await writeSnapshot(contextFile, snapshot);
  return result;
}

function usage() {
  return 'Usage: node scripts/agent/task-router.mjs --task-file <v1-task.json> [--path <repo-path>]... [--json] [--prepare --owner component=tracked/path [--context-file <private.json>] [--with-governance --json]]';
}
async function main(argv) {
  let file, contextFile;
  const paths=[], owners=[];
  let json=false, prepare=false, includeGovernance=false;
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];
    if(arg==='--task-file') { file=argv[++i]; if(!file) invalid('--task-file requires path'); }
    else if(arg==='--path') { const p=argv[++i]; if(!p) invalid('--path requires value'); paths.push(p); }
    else if(arg==='--owner') { const owner=argv[++i]; if(!owner) invalid('--owner requires value'); owners.push(owner); }
    else if(arg==='--context-file') { contextFile=argv[++i]; if(!contextFile) invalid('--context-file requires path'); }
    else if(arg==='--prepare') prepare=true;
    else if(arg==='--with-governance') includeGovernance=true;
    else if(arg==='--json') json=true;
    else if(arg==='--help' || arg==='-h') { console.log(usage()); return; }
    else invalid('Unknown argument: ' + arg);
  }
  if(!file) invalid(usage());
  const task=JSON.parse(readFileSync(resolve(process.cwd(),file),'utf8'));
  if(!prepare && (contextFile || owners.length)) invalid('Context options require --prepare');
  if(includeGovernance && !(prepare && json)) invalid('--with-governance requires --prepare and --json');
  const plan=prepare ? await prepareTask(task,{paths,owners,contextFile,includeGovernance}) : routeTask(task,paths);
  if(json) console.log(JSON.stringify(plan,null,2));
  else {
    console.log('Engineering Task: ' + plan.task_id + ' (' + plan.primary_class + ')');
    if(prepare) console.log('Context: ' + plan.context_snapshot.id + (plan.context_reused ? ' (reused)' : ' (created)'));
    console.log('Skills: ' + plan.workflow_skills.join(', '));
    console.log('Checks: ' + plan.required_check_ids.join(', '));
    console.log('Governance router args: ' + JSON.stringify(plan.governance.router_argv));
    console.log('Governance context args: ' + JSON.stringify(plan.governance.context_argv));
    for(const w of plan.warnings) console.log('NOTICE: ' + w);
  }
}
if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)){
  main(process.argv.slice(2)).catch(error => { console.error('Task routing failed: ' + error.message); process.exitCode=1; });
}
