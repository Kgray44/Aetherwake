#!/usr/bin/env node
/**
 * Phase B: deterministic engineering-task workflow selection.
 * This is NOT Vela MissionService's task router and does not replace governance.
 * No model calls, task status writes, shell execution, or fabricated acceptance.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, relative, sep } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const config = JSON.parse(readFileSync(new URL('../../agent-system/task-classes.json', import.meta.url), 'utf8'));
export const taskClasses = Object.freeze(Object.keys(config.classes));
const shaPattern = /^[a-f\d]{40}$/i;

function invalid(message) { throw new Error(message); }
function safePath(value) {
  if (typeof value !== 'string' || !value.trim()) invalid('Path must be a nonempty string');
  const absolute = resolve(root, value);
  const rel = relative(root, absolute);
  if (rel === '..' || rel.startsWith('..' + sep) || rel.startsWith('/') || rel === '') invalid('Path must remain inside repository: ' + value);
  return rel.replaceAll('\\', '/');
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
  const paths = unique(inputPaths.map(safePath));
  const risks = unique([
    ...selected.filter(c => Object.hasOwn(config.additive_risks,c)),
    ...config.path_risks.filter(r => paths.some(p => r.path_prefixes.some(prefix => p.startsWith(prefix)))).map(r => r.risk)
  ]);
  const checks = unique([
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
    task_id: task.id,
    task_revision: task.revision,
    primary_class: task.classification.primary,
    selected_classes: selected,
    detected_risks: risks,
    affected_paths: paths,
    workflow_skills: selected.map(c => config.classes[c].skill),
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
function usage() {
  return 'Usage: node scripts/agent/task-router.mjs --task-file <v1-task.json> [--path <repo-path>]... [--json]';
}
function main(argv) {
  let file; const paths=[]; let json=false;
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];
    if(arg==='--task-file') { file=argv[++i]; if(!file) invalid('--task-file requires path'); }
    else if(arg==='--path') { const p=argv[++i]; if(!p) invalid('--path requires value'); paths.push(p); }
    else if(arg==='--json') json=true;
    else if(arg==='--help' || arg==='-h') { console.log(usage()); return; }
    else invalid('Unknown argument: ' + arg);
  }
  if(!file) invalid(usage());
  const task=JSON.parse(readFileSync(resolve(process.cwd(),file),'utf8'));
  const plan=routeTask(task,paths);
  if(json) console.log(JSON.stringify(plan,null,2));
  else {
    console.log('Engineering Task: ' + plan.task_id + ' (' + plan.primary_class + ')');
    console.log('Skills: ' + plan.workflow_skills.join(', '));
    console.log('Checks: ' + plan.required_check_ids.join(', '));
    console.log('Governance router args: ' + JSON.stringify(plan.governance.router_argv));
    console.log('Governance context args: ' + JSON.stringify(plan.governance.context_argv));
    for(const w of plan.warnings) console.log('NOTICE: ' + w);
  }
}
if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)){
  try { main(process.argv.slice(2)); } catch(error) { console.error('Task routing failed: ' + error.message); process.exitCode=1; }
}
