import test from 'node:test';
import assert from 'node:assert/strict';
import { mountVelaPanel } from '../src/panel.ts';
import { velaPanelStatus } from '../src/panel-status.ts';
import { VELA_CONTRACT, type VelaClient, type VelaState, type VelaRequest, type VelaPlan, type ActionReceipt } from '../src/contracts.ts';

const manifest = { id: 'manifest:synthetic', createdAt: '2026-11-02T00:00:00Z', policyVersion: 'policy:synthetic', discovered: [], included: [], omitted: [], contentBytes: 0, coverage: 'explicit-resources-only' as const };
const request = (patch: Partial<VelaRequest> = {}): VelaRequest => ({ id: 'request:synthetic', conversationId: 'conversation:synthetic', intent: 'Synthetic panel request', state: 'provider-unavailable', createdAt: manifest.createdAt, updatedAt: manifest.createdAt, providerId: 'synthetic-planner', context: manifest, ...patch });
function state(): VelaState {
  return { contract: VELA_CONTRACT, identity: { id: 'system:vela', name: 'Vela', role: 'application-assistant' }, conversation: null,
    planner: { providerId: 'synthetic-planner', available: false, busy: false }, capabilities: [], requests: [], plans: [], receipts: [],
    preferences: { version: 1, mode: 'normal', monitoringEnabled: false, delegationEnabled: false, allowedEventTypes: [], minimumSeverity: 'warning', maxInterruptionsPerHour: 0, source: 'default', updatedAt: manifest.createdAt, learning: 'disabled' }, attention: [], lastPresenceAt: null, coverage: 'authorized-app-events-only' };
}
function clientFor(read: () => Promise<VelaState>, patch: Partial<VelaClient> = {}): VelaClient {
  const unused = async (): Promise<never> => { throw new Error('Unexpected command in the synthetic panel harness'); };
  return { state: read, open: read, request: unused, search: unused, native: unused, review: unused, apply: unused, cancel: unused, preferences: unused, reviewAttention: unused, ...patch };
}

/** Minimal DOM harness exercises the component's async state/render boundaries; no browser or native window. */
class Node {
  readonly tagName: string;
  ownerDocument: Document;
  children: Node[] = [];
  parent: Node | null = null;
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  listeners = new Map<string, (() => unknown)[]>();
  className = ''; disabled = false; checked = false;
  value = ''; private text = '';
  constructor(tagName: string, doc: Document) { this.tagName = tagName; this.ownerDocument = doc; }
  get textContent(): string { return this.text + this.children.map(child => child.textContent).join(''); }
  set textContent(value: string) { this.text = value; this.children = []; }
  get options() { return this.children.filter(child => child.tagName === 'option'); }
  get selectedOptions() { return this.options.filter(child => child.value === this.value); }
  append(...nodes: Node[]) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes: Node[]) { this.text = ''; this.children = []; this.append(...nodes); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  addEventListener(name: string, callback: () => unknown) { this.listeners.set(name, [...this.listeners.get(name) ?? [], callback]); }
  fire(name: string) { for (const callback of this.listeners.get(name) ?? []) (callback as (event: unknown) => unknown)({ preventDefault() {} }); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  find(predicate: (node: Node) => boolean): Node | undefined { return predicate(this) ? this : this.children.map(child => child.find(predicate)).find(Boolean); }
}
class Document { createElement(tag: string) { return new Node(tag, this); } }
async function settles(check: () => boolean) { for (let i = 0; i < 50 && !check(); i++) await new Promise(resolve => setImmediate(resolve)); assert.ok(check(), 'component settled at its canonical state'); }

test('terminal status survives request completion and refresh; connection probe is explicit and state is observed afterward', async () => {
  const doc = new Document(), root = doc.createElement('main'); let canonical = state(), connections = 0;
  let resolveRequest!: (value: VelaRequest) => void;
  const client = clientFor(async () => canonical, {
    request: async () => new Promise<VelaRequest>(resolve => { resolveRequest = resolve; }),
  });
  const panel = mountVelaPanel(root as unknown as HTMLElement, client, { onConnectProvider: async () => { connections++; canonical = { ...canonical, planner: { providerId: 'synthetic-planner', available: true, busy: false } }; } });
  const status = root.find(node => node.className === 'vela-core-status')!;
  await settles(() => status.dataset.requestState === 'idle'); await panel.open(); assert.equal(connections, 0);
  const form = root.find(node => node.className === 'vela-core-compose')!;
  form.fire('submit'); assert.equal(status.dataset.requestState, 'submitting'); assert.doesNotMatch(status.textContent, /provider.*running|Waiting for the identified planning provider/);
  canonical = { ...canonical, requests: [request({ errorCode: 'provider_authorization_required' })] }; resolveRequest(canonical.requests[0]);
  await settles(() => status.dataset.requestState === 'provider-unavailable'); assert.match(status.textContent, /Planning was not authorized/); assert.equal(status.dataset.requestId, 'request:synthetic');
  const terminal = status.textContent; await panel.refresh(); await panel.refresh(); assert.equal(status.textContent, terminal); assert.doesNotMatch(status.textContent, /^Ready|Request:/);
  root.find(node => node.tagName === 'button' && node.textContent === 'Check planning connection')!.fire('click');
  await settles(() => connections === 1 && root.find(node => node.className === 'vela-core-provider')!.textContent.includes('· available'));
  assert.equal(status.dataset.requestState, 'provider-unavailable'); assert.equal(status.textContent, terminal, 'connecting does not rewrite a historical request outcome');
  client.request = async () => { canonical = { ...canonical, requests: [request({ state: 'unknown' })] }; throw new Error('Synthetic lost command response'); };
  form.fire('submit'); await settles(() => status.dataset.actionState === 'failed' && status.dataset.requestState === 'unknown');
  await panel.refresh(); assert.match(status.textContent, /outcome is unknown/); assert.equal(status.dataset.actionState, undefined);
  panel.dispose(); assert.equal(root.children.length, 0);
});

test('status distinguishes review, applied receipts, partial failure and unknown outcomes without asserting delegated task completion', () => {
  const canonical = state(); canonical.requests = [request({ state: 'awaiting-review', planId: 'plan:synthetic' })];
  const plan: VelaPlan = { id: 'plan:synthetic', requestId: 'request:synthetic', version: 1, fingerprint: 'synthetic', summary: 'Synthetic command', steps: [{ id: 'one', explanation: 'Synthetic delegation', action: { type: 'delegateTask', title: 'Synthetic task', objective: 'Synthetic only', providerId: 'synthetic-planner', resourceIds: [], constraints: [] } }], targets: [], scope: { principalId: 'synthetic', policyVersion: 'synthetic', resourceIds: [], projectIds: [], workspaceIds: [] }, state: 'prepared', createdAt: manifest.createdAt, expiresAt: manifest.createdAt, contribution: null };
  canonical.plans = [plan]; assert.match(velaPanelStatus(canonical).message, /ready for review/);
  plan.state = 'rejected'; assert.match(velaPanelStatus(canonical).message, /rejected/);
  plan.state = 'applied'; canonical.requests[0].state = 'completed'; assert.match(velaPanelStatus(canonical).message, /complete host receipts are unavailable/); assert.doesNotMatch(velaPanelStatus(canonical).message, /plan was applied/);
  const receipt: ActionReceipt = { id: 'receipt:synthetic', planId: plan.id, requestId: plan.requestId, stepId: 'one', commandId: 'command:synthetic', source: 'vela', providerId: 'synthetic-planner', state: 'applied', startedAt: manifest.createdAt, hostReceiptId: 'host:synthetic', taskVerified: false };
  canonical.receipts = [receipt]; assert.match(velaPanelStatus(canonical).message, /plan was applied/); assert.match(velaPanelStatus(canonical).message, /task completion remains unverified/);
  canonical.requests[0].state = 'unknown'; plan.state = 'unknown'; assert.match(velaPanelStatus(canonical).message, /outcome is unknown/); assert.match(velaPanelStatus(canonical).message, /1 earlier command outcome/);
  canonical.requests[0].state = 'failed'; plan.state = 'failed'; assert.match(velaPanelStatus(canonical).message, /request failed/);
});

test('explicit workspace project survives refresh and selecting an available project re-enables the real capability', async () => {
  const doc = new Document(), root = doc.createElement('main'), canonical = state();
  canonical.capabilities = [{ id: 'workspaceFromResources', label: 'Synthetic capability metadata', effect: 'create', scope: 'synthetic', authorization: 'host-policy', schema: {}, reversible: 'host-dependent' }];
  canonical.applicationContext = { currentProjectId: 'project:a', currentWorkspaceId: null, references: [{ id: 'project:a', kind: 'project', title: 'Synthetic project', version: 1 }] };
  const panel = mountVelaPanel(root as unknown as HTMLElement, clientFor(async () => canonical));
  await settles(() => root.find(node => node.className === 'vela-core-status')!.dataset.requestState === 'idle');
  const project = root.find(node => node.tagName === 'select')!, create = root.find(node => node.tagName === 'button' && node.textContent === 'Create workspace with selected resources')!;
  assert.equal(project.value, 'project:a'); project.fire('change'); canonical.applicationContext.currentProjectId = null; await panel.refresh(); assert.equal(project.value, 'project:a');
  canonical.applicationContext.references = []; await panel.refresh(); assert.equal(create.disabled, true);
  project.value = ''; project.fire('change'); assert.equal(create.disabled, false); await panel.refresh(); assert.equal(project.value, '');
  panel.dispose();
});
