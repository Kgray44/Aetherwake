import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { contextExperimentScope, evaluateContextRollout, routeTask, taskClasses } from '../scripts/agent/task-router.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const config = JSON.parse(readFileSync(new URL('../agent-system/task-classes.json', import.meta.url),'utf8'));
const schema = JSON.parse(readFileSync(new URL('../agent-system/contracts/v1.schema.json', import.meta.url),'utf8'));

function fixture(primary='bug', secondary=[]) {
 return {
  schema_version:1,record_type:'task',id:'task_opaque_example',title:'Repair verified behavior',
  objective:'Repair behavior with documented proof',repository:'Kgray44/Aetherwake',
  revision:'a'.repeat(40),created_at:'2026-11-15T00:00:00Z',
  classification:{primary,secondary},
  prerequisites:{task_ids:[],capabilities:[]},
  acceptance:{profile_id:'sample-profile',criteria:[{id:'expected',description:'observable correct result'}]},
  state:'ready'
 };
}

test('Phase B classification matches canonical v1 Task primary enum',()=>{
 assert.deepEqual(taskClasses,schema.$defs.Task.properties.classification.properties.primary.enum);
 for(const cls of taskClasses) {
  assert.ok(config.classes[cls].skill.startsWith('.agents/skills/'));
  assert.ok(config.classes[cls].checks.length > 0);
  const file=readFileSync(resolve(root,config.classes[cls].skill),'utf8');
  assert.match(file,/Task acceptance/);
 }
});

test('primary class chooses a workflow and secondary classes compose checks without substitution',()=>{
 const result=routeTask(fixture('bug',['visual','performance']),['src/rendering/particles.ts']);
 assert.equal(result.primary_class,'bug');
 assert.deepEqual(result.selected_classes,['bug','visual','performance']);
 assert.ok(result.required_check_ids.includes('regression-test'));
 assert.ok(result.required_check_ids.includes('rendered-frames'));
 assert.ok(result.required_check_ids.includes('before-after-comparison'));
 assert.equal(result.task_id,'task_opaque_example');
 assert.equal(result.governance.required,true);
 assert.deepEqual(result.governance.router_argv.slice(0,2),['node','scripts/governance-router.mjs']);
});

test('sensitive file paths can only add, never remove, security gates',()=>{
 const simple=routeTask(fixture('bug'));
 const risky=routeTask(fixture('bug'),['src/security/authz.ts']);
 for(const check of simple.required_check_ids) assert.ok(risky.required_check_ids.includes(check));
 for(const check of config.additive_risks.security.checks) assert.ok(risky.required_check_ids.includes(check));
});

test('visual and Windows desktop admission risks add applicable checks',()=>{
 const r=routeTask(fixture('maintenance'),['src/rendering/nebula.ts','src/native/window.ts']);
 assert.ok(r.required_check_ids.includes('rendered-frames'));
 assert.ok(r.required_check_ids.includes('native-test-admission'));
});

test('reject unknown classes and inadequate v1 task metadata',()=>{
 assert.throws(()=>routeTask(fixture('historical-mission')),/Unknown primary/);
 assert.throws(()=>routeTask(fixture('bug',['invented-class'])),/Unknown secondary/);
 const missing=fixture(); delete missing.prerequisites;
 assert.throws(()=>routeTask(missing),/prerequisites/);
 const bad=fixture();bad.revision='main';
 assert.throws(()=>routeTask(bad),/40-character/);
});

test('reject path traversal and never execute task-provided commands',()=>{
 assert.throws(()=>routeTask(fixture(),['../../outside']),/inside repository/);
 assert.throws(()=>routeTask(fixture(),['/tmp/private']),/inside repository/);
 const r=routeTask(fixture(),['src/security/clean.ts']);
 assert.equal(r.governance.router_argv.at(-1),'src/security/clean.ts');
});

test('CLI explains missing input without claiming completion',()=>{
 const cli=resolve(root,'scripts/agent/task-router.mjs');
 const process=spawnSync(processExecPath(),[cli,'--json'],{encoding:'utf8'});
 assert.equal(process.status,1);
 assert.match(process.stderr,/--task-file/);
});
function processExecPath(){return process.execPath;}


test('all ten categories preserve configured checks and universal review obligations', () => {
 for (const cls of taskClasses) {
  const route = routeTask(fixture(cls));
  for (const check of [...config.classes[cls].checks, ...config.universal_checks]) assert.ok(route.required_check_ids.includes(check), `${cls}: ${check}`);
  assert.equal(route.workflow_skills[0], config.classes[cls].skill);
  assert.equal(route.scope_coverage, 'unavailable');
 }
});

test('connected renderer, native brokers and backend owners add actual obligations and skills', () => {
 const cases = [
  ['prototypes/visual-experience/cinematic-v3/src/renderer.ts', ['rendered-frames','measured-baseline','gpu-rendered-evidence']],
  ['prototypes/visual-experience/cinematic-v3/native/desktop-main.cjs', ['authorization-tests','native-test-admission']],
  ['prototypes/integrated-backend/src/service.mts', ['interface-contract','security-review']],
  ['prototypes/integrated-backend/src/windows-gpu-readback.mts', ['native-test-admission','gpu-rendered-evidence','measured-baseline']]
 ];
 for (const [path, checks] of cases) {
  const r=routeTask(fixture('documentation'),[path]);
  for(const check of checks) assert.ok(r.required_check_ids.includes(check), `${path}: ${check}`);
  assert.ok(r.required_check_ids.includes('authority-audit'));
 }
 const r=routeTask(fixture('bug'),[cases[0][0]]);
 assert.ok(r.workflow_skills.includes(config.classes.visual.skill));
 assert.ok(r.workflow_skills.includes(config.classes.performance.skill));
});

test('empty and unknown scope never imply safe coverage', () => {
 for (const paths of [[],['unknown/new-owner.ts']]) {
  const r=routeTask(fixture(),paths);
  assert.ok(r.required_check_ids.includes('affected-scope-review'));
  assert.ok(r.required_check_ids.includes('governance-coverage'));
  assert.notEqual(r.scope_coverage,'complete');
 }
});

test('ambiguous and cross-platform path aliases fail closed; backslash separators retain risks', () => {
 for(const path of ['src/security/../innocent.ts','..\\outside','C:\\private\\key','//server/share','src//security/key','./src/security/key','src/secret\u0000']) assert.throws(()=>routeTask(fixture(),[path]),/inside repository/);
 assert.throws(()=>routeTask(fixture(),null),/array/);
 assert.ok(routeTask(fixture(),['prototypes\\integrated-backend\\src\\service.mts']).required_check_ids.includes('security-review'));
});

test('root instructions expose targeted skills and current architecture without authority changes',()=>{
 const instructions=readFileSync(resolve(root,'AGENTS.md'),'utf8');
 assert.match(instructions,/scripts\/agent\/task-router.mjs/);
 assert.match(instructions,/\.agents\/skills\//);
 assert.match(instructions,/prototypes\/integrated-backend\//);
 assert.match(instructions,/governance-context/);
});

test('Windows case aliases cannot suppress risk checks',()=>{
 assert.ok(routeTask(fixture(),['PROTOTYPES/INTEGRATED-BACKEND/SRC/service.mts']).required_check_ids.includes('security-review'));
});

test('proposes known Aerynth test relationships and groups duplicate focused commands', () => {
  const source = 'prototypes/integrated-backend/src/task-objectives.mts';
  const dependency = 'prototypes/task-product/service.mts';
  const directTest = 'prototypes/integrated-backend/tests/task-objectives.test.mts';
  const unknown = 'some/other/dependency.ts';
  const result = routeTask(fixture('bug'), [source, dependency, directTest, unknown]);
  assert.deepEqual(result.verification_plan.unmapped_paths, [unknown]);
  const [command] = result.verification_plan.focused_commands;
  assert.deepEqual(command, {
    cwd: 'prototypes/integrated-backend',
    argv: ['node', '--test', 'tests/task-objective-core.test.mts', 'tests/task-objectives.test.mts', 'tests/task-reference-targets.test.mts']
  });
  assert.equal(result.verification_plan.focused_commands.length, 1);
  assert.ok(result.required_check_ids.includes('negative-paths'));
  assert.ok(result.required_check_ids.includes('integration-tests'));
});

test('unknown paths and classifications do not establish test independence', () => {
  const result = routeTask(fixture('security', ['visual']), ['some/unknown.mjs']);
  assert.deepEqual(result.verification_plan.focused_commands, []);
  assert.deepEqual(result.verification_plan.unmapped_paths, ['some/unknown.mjs']);
  assert.ok(result.required_check_ids.includes('authorization-tests'));
  assert.ok(result.required_check_ids.includes('visual-review'));
});

test('compact context stays off without scoped independently reviewed full-cost improvements', () => {
  const task=fixture('performance');
  const plan=routeTask(task,['scripts/governance-context.mjs']);
  const now=Date.parse('2026-11-20T00:00:00Z');
  const review=(receipt,workload)=>({
    review_receipt:receipt.repeat(64),workload_digest:workload.repeat(64),expires_at:'2026-11-21T00:00:00Z',
    independently_reviewed:true,matched:true,holdout:true,baseline_verified:true,candidate_verified:true,
    guardrails_passed:true,baseline_full_cost_usd:10,candidate_full_cost_usd:8,
  });
  const reviews=[review('a','b'),review('c','d')];
  const args={schema_version:1,configured:'json',candidate:'compact',scope:contextExperimentScope(task,plan),reviews};
  const evaluate=(evidence=args,proposal=plan)=>evaluateContextRollout(task,proposal,evidence,now);
  assert.deepEqual(evaluate(),{status:'candidate',authorized:false,format:'compact',verified_pairs:2,fallback:'json'});
  assert.equal(evaluate(undefined,routeTask(task,['scripts/agent/task-router.mjs'])).reason,'scope_incomplete');
  assert.equal(evaluate({...args,reviews:[reviews[0],{...reviews[1],candidate_full_cost_usd:null}]}).reason,'no_qualified_improvement');
  assert.equal(evaluate({...args,reviews:[reviews[0],{...reviews[1],candidate_full_cost_usd:10}]}).reason,'no_qualified_improvement');
  assert.equal(evaluate({...args,reviews:[...reviews,{...review('e','f'),candidate_full_cost_usd:11}]}).reason,'regression');
  assert.equal(evaluate({...args,reviews:[...reviews,{...review('e','f'),guardrails_passed:false}]}).reason,'regression');
  assert.equal(evaluate({...args,reviews:[...reviews,reviews[0]]}).reason,'review_identity_reused');
});
