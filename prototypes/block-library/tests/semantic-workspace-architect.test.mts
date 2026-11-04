import test from 'node:test';
import assert from 'node:assert/strict';
import { createSemanticWorkspaceArchitect, type SemanticWorkspaceRequest } from '../semantic-workspace-architect.mts';
import type { BlockKind, CanonicalTemplateHost, ResourceCandidate } from '../contracts.ts';
import { blockDefinition } from '../registry.ts';
const input = { requestId: 'synthetic:semantic', prompt: 'A greenhouse propagation station for rare orchids', projectId: 'project:orchids',
  supportedKinds: ['note', 'checklist', 'conversation', 'file'] as BlockKind[] };
const response = () => ({ title: 'Orchid propagation', rationale: 'Keep observations, propagation tasks and a project conversation together.', roles: [
  { key: 'observations', label: 'Propagation observations', kind: 'note', resourceId: 'note:orchids', compact: false },
  { key: 'care', label: 'Propagation schedule', kind: 'checklist', resourceId: null, compact: false },
  { key: 'discussion', label: 'Orchid project discussion', kind: 'conversation', resourceId: null, compact: true },
] });
function fixture() {
  let resources: ResourceCandidate[] = [{ id: 'note:orchids', kind: 'note', title: 'Current orchid observations', projectId: input.projectId, version: 3 },
    { id: 'note:other', kind: 'note', title: 'Unrelated private project', projectId: 'project:other', version: 1 }];
  const unavailable = new Set<string>();
  const host: Pick<CanonicalTemplateHost, 'capabilities' | 'workspacePlanningResources'> = {
    capabilities: () => ({ revision: 1, kinds: Object.fromEntries(input.supportedKinds.map(kind => [kind, { state: unavailable.has(kind) ? 'unavailable' : 'available' }])),
      providers: { local: { state: 'available' } }, velaPlanning: { state: 'available' } }) as any,
    workspacePlanningResources: () => ({ resources: structuredClone(resources), complete: true }),
  };
  return { host, unavailable, replace(value: ResourceCandidate[]) { resources = value; }, get resources() { return structuredClone(resources); } };
}
test('arbitrary semantic roles bind exact authorized resources and use deterministic valid geometry, without mutation or source content', async () => {
  const f = fixture(); let request!: SemanticWorkspaceRequest;
  const planner = createSemanticWorkspaceArchitect(f.host, { async propose(value) { request = value; return response(); } });
  const result = await planner.plan(input);
  assert.equal(result.provenance.providerId, 'openai-api-vela'); assert.equal(result.provenance.requestId, input.requestId);
  assert.equal(request.payload.candidates.length, 1); assert.doesNotMatch(JSON.stringify(request), /note:other|Unrelated private/);
  assert.deepEqual(result.body.resources[0].source, { mode: 'reference', kind: 'note', resourceId: 'note:orchids', expectedVersion: 3 });
  assert.equal(result.body.resources[1].source.mode, 'new'); assert.equal(result.body.resources[2].source.mode, 'new');
  for (const placement of result.body.placements) {
    const resource = result.body.resources.find(role => role.key === placement.resourceKey)!, minimum = blockDefinition(resource.source.kind).minimumSize;
    assert.ok(placement.presentation.width >= minimum.width && placement.presentation.height >= minimum.height && placement.presentation.y >= 144);
  }
  assert.equal(f.resources.length, 2, 'Planning never creates a canonical resource');
});
test('invented or duplicated references and unsupported creation fail closed', async () => {
  for (const mutate of [
    (raw: any) => { raw.roles[0].resourceId = 'note:invented'; },
    (raw: any) => { raw.roles[1] = { ...raw.roles[0], key: 'duplicate' }; },
    (raw: any) => { raw.roles[0].kind = 'file'; raw.roles[0].resourceId = null; },
    (raw: any) => { raw.roles[0].kind = 'imaginary_block'; },
    (raw: any) => { raw.roles[0].key = '__proto__'; },
  ]) {
    const f = fixture(), raw = response(); mutate(raw);
    await assert.rejects(createSemanticWorkspaceArchitect(f.host, { async propose() { return raw; } }).plan(input),
      /semantic_workspace|invalid_semantic/);
  }
});
test('source edits, revocation and capability changes during model planning invalidate the entire proposal', async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => f.replace(f.resources.map(item => ({ ...item, version: item.version + 1 }))),
    (f: ReturnType<typeof fixture>) => f.replace([]),
    (f: ReturnType<typeof fixture>) => f.unavailable.add('note'),
  ]) {
    const f = fixture();
    await assert.rejects(createSemanticWorkspaceArchitect(f.host, { async propose(request) { mutate(f); request.validate(); return response(); } }).plan(input),
      /semantic_workspace_sources_changed|semantic_workspace_capabilities_changed/);
  }
});
test('cancellation and malformed extra output cannot become an applied blueprint', async () => {
  const f = fixture(), controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(createSemanticWorkspaceArchitect(f.host, { async propose() { calls++; return response(); } }).plan(input, controller.signal), /semantic_workspace_cancelled/);
  assert.equal(calls, 0);
  await assert.rejects(createSemanticWorkspaceArchitect(f.host, { async propose() { return { ...response(), execute: true }; } }).plan(input), /invalid_semantic_workspace/);
});
