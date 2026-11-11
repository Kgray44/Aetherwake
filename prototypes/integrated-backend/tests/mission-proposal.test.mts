import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ServiceError } from '../src/contracts.mts';
import type { MissionTaskPlan } from '../src/mission-contracts.mts';
import { nativeMissionExecutors } from '../src/mission-native.mts';
import { compileMissionProposal, MISSION_PROPOSAL_CONTRACT, MISSION_PROPOSAL_SCHEMA, type MissionProposal } from '../src/mission-proposal.mts';
import { missionPlanningSpecialists } from '../src/mission-specialists.mts';
import { validateMissionPlan } from '../src/mission-service.mts';

const scope = { projectId: 'project-1', workspaceId: 'workspace-1' };
const objective = '  Inspect backend work after checking memory and CPU.  ';
const task = (id: string, executor: string, dependencies: string[] = []): MissionTaskPlan => ({
  id, executor, dependencies, criterion: `verified-${id}`, objective: `Host description for ${id}`,
  claims: [{ resource: `test.${id}`, mode: 'read' }], timeoutMs: 6000, maxAttempts: 2,
});
const catalog = {
  cpu: task('sample-cpu', 'sample.cpu'),
  ram: task('sample-ram', 'sample.ram'),
  inspect: task('source-check', 'inspect.backend-source', ['sample-ram']),
};
const entry = (capability: string, after: string[] = []) => ({ capability, after });
const proposal = (tasks: ReturnType<typeof entry>[], unsupported: string[] = []) => JSON.stringify({ tasks, unsupported });
const compile = (text: string) => compileMissionProposal(text, objective, scope, catalog);
const rejects = (text: string, code: string) => assert.throws(() => compile(text), error =>
  error instanceof ServiceError && error.code === code && error.message === code);

test('versions provider candidates while preserving the host plan produced by legacy inputs', () => {
  const candidate: MissionProposal = {
    contract: 'aerynth.vela-mission-proposal@1', tasks: [entry('cpu'), entry('ram', ['cpu'])], unsupported: [],
  };
  assert.equal(MISSION_PROPOSAL_CONTRACT, candidate.contract);
  assert(MISSION_PROPOSAL_SCHEMA.required.includes('contract'));
  assert.deepEqual(MISSION_PROPOSAL_SCHEMA.properties.contract.enum, [candidate.contract]);
  const plan = compile(JSON.stringify(candidate));
  assert.deepEqual(plan, compile(proposal(candidate.tasks)));
  validateMissionPlan(plan, nativeMissionExecutors);
  assert(!Object.hasOwn(plan, 'contract'));
  rejects(JSON.stringify({ ...candidate, contract: 'aerynth.vela-mission-proposal@2' }), 'unsupported_mission_proposal_contract');
  rejects(JSON.stringify({ ...candidate, contract: 'aerynth.vela-mission@1' }), 'unsupported_mission_proposal_contract');
  rejects(JSON.stringify({ ...candidate, scope }), 'invalid_mission_proposal');
});

test('compiles dependencies and joins every verified result using host-owned tasks', () => {
  const original = structuredClone(catalog);
  const plan = compile(proposal([entry('inspect', ['cpu']), entry('ram'), entry('cpu')]));
  validateMissionPlan(plan, nativeMissionExecutors);
  assert.equal(plan.objective, objective);
  assert.deepEqual(plan.scope, scope);
  assert.deepEqual(plan.criteria, ['verified-sample-cpu', 'verified-sample-ram', 'verified-source-check', 'joined-evidence']);
  assert.deepEqual(plan.tasks.slice(0, 3), [original.cpu, original.ram,
    { ...original.inspect, dependencies: ['sample-cpu', 'sample-ram'] }]);
  assert.equal(plan.tasks[3].executor, 'join.samples');
  assert.deepEqual(plan.tasks[3].dependencies, ['sample-cpu', 'sample-ram', 'source-check']);
  assert.deepEqual(plan, compile(proposal([entry('cpu'), entry('inspect', ['ram', 'cpu']), entry('ram')])));
  plan.tasks[0].claims[0].mode = 'exclusive';
  assert.deepEqual(catalog, original);
});

test('rejects unknown or duplicate capabilities, dangling edges, and cycles', () => {
  rejects(proposal([entry('cpu'), entry('__proto__')]), 'mission_proposal_unknown_capability');
  rejects(proposal([entry('cpu'), entry('report')]), 'mission_proposal_unknown_capability');
  rejects(proposal([entry('cpu'), entry('cpu')]), 'mission_proposal_duplicate_capability');
  rejects(proposal([entry('cpu', ['inspect']), entry('ram')]), 'missing_mission_dependency');
  rejects(proposal([entry('cpu'), entry('inspect')]), 'missing_mission_dependency');
  rejects(proposal([entry('cpu', ['ram', 'ram']), entry('ram')]), 'invalid_mission_proposal_dependencies');
  rejects(proposal([entry('cpu', ['cpu']), entry('ram')]), 'mission_dependency_cycle');
  rejects(proposal([entry('cpu', ['ram']), entry('ram', ['cpu'])]), 'mission_dependency_cycle');
  rejects(proposal([entry('inspect'), entry('ram', ['inspect'])]), 'mission_dependency_cycle');
});

test('temporary roles cannot add tools, provider controls, or dependencies', () => {
  const model = { provider: 'chatgpt-plan-responses' as const, model: 'synthetic-model', connectionVersion: 1, settingsStamp: 'synthetic' };
  const [slot] = missionPlanningSpecialists(model).filter(task => task.id.startsWith('temporary-specialist'));
  const supported = { ...catalog, [slot.id]: slot };
  const role = { title: 'Measurement reviewer', responsibility: 'Identify one source of measurement error.' };
  const compileRole = (candidate: object) => compileMissionProposal(JSON.stringify({
    tasks: [entry('cpu'), candidate], unsupported: [],
  }), objective, scope, supported);
  const task = compileRole({ ...entry(slot.id), role }).tasks.find(task => task.id === slot.id)!;
  assert.equal(task.specialist?.model, model.model);
  assert.equal(task.specialist?.role, role.title);
  assert.equal(task.specialist?.webSearch, undefined);
  assert.equal(task.maxAttempts, 1);
  for (const candidate of [
    entry(slot.id),
    { ...entry(slot.id, ['cpu']), role },
    { ...entry(slot.id), role: { ...role, tool: 'web_search' } },
    { ...entry(slot.id), role: { ...role, title: 'Invalid\nrole' } },
    { ...entry(slot.id), role: { ...role, responsibility: '😀'.repeat(76) } },
    { ...entry('ram'), role },
  ]) assert.throws(() => compileRole(candidate), /invalid_mission_temporary_role/);
});

test('rejects an unsupported outcome even when some tasks could run', () => {
  rejects(proposal([entry('cpu'), entry('ram')], ['External publish request includes a quoted "[destination]"']),
    'mission_proposal_unsupported_objective');
  rejects(proposal([], ['The objective needs a capability outside the catalog']), 'mission_proposal_unsupported_objective');
  rejects(proposal([], [' ']), 'invalid_mission_proposal');
  rejects(proposal([], ['🔐'.repeat(61)]), 'invalid_mission_proposal');
});

test('rejects ambiguous or out-of-budget JSON without exposing model content', () => {
  const valid = proposal([entry('cpu'), entry('ram')]);
  rejects('```json\n' + valid + '\n```', 'invalid_mission_proposal');
  rejects(valid + ' 🗝️'.repeat(1500), 'mission_proposal_too_large');
  rejects('['.repeat(200) + ']'.repeat(200), 'invalid_mission_proposal');
  rejects('{"tasks":[],"tasks":[],"unsupported":[]}', 'invalid_mission_proposal');
  rejects(valid.replace('"unsupported":[]', '"unsupported":["external send"],"unsupp\\u006frted":[]'), 'invalid_mission_proposal');
  rejects(valid.replace('"capability":"cpu"', '"capability":"cpu","objective":"rewrite authorization"'), 'invalid_mission_proposal');
  rejects(valid.replace('"after":[]', '"after":[["ram"]]'), 'invalid_mission_proposal');
  rejects(proposal([entry('cpu')]), 'mission_proposal_task_count');
  rejects(proposal(Array.from({ length: 7 }, () => entry('cpu'))), 'mission_proposal_task_count');
});

test('accepts a full six-task graph with bounded depth and edge count', () => {
  const keys = ['a', 'b', 'c', 'd', 'e', 'f'];
  const templates = Object.fromEntries(keys.map(key => [key, task(key, 'sample.cpu')]));
  const plan = compileMissionProposal(proposal(keys.map((key, index) => entry(key, keys.slice(0, index)))), objective, scope, templates);
  validateMissionPlan(plan, nativeMissionExecutors);
  assert.deepEqual(plan.tasks.map(task => task.id), [...keys, 'report']);
  assert.deepEqual(plan.tasks.at(-1)?.dependencies, keys);
});

test('a compiled specialist-only graph cannot promote validated reports into a verified objective',()=>{
  const selection={provider:'chatgpt-plan-responses' as const,model:'synthetic-model',connectionVersion:1,settingsStamp:'synthetic'};
  const templates=missionPlanningSpecialists(selection).filter(task=>task.id.startsWith('temporary-specialist'));
  const plan=compileMissionProposal(JSON.stringify({tasks:templates.map(task=>({capability:task.id,after:[],role:{title:'Independent reviewer',responsibility:'Review a reported software claim.'}})),unsupported:[]}),objective,scope,Object.fromEntries(templates.map(task=>[task.id,task])));
  assert.equal(plan.coverage?.status,'partial');assert.match(plan.coverage!.limitations.join(' '),/provider reports.*independent domain evidence/su);
  assert.ok(plan.tasks.slice(0,-1).every(task=>task.executor==='chatgpt.specialist'));
});
