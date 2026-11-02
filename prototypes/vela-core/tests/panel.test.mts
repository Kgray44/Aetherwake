import test from 'node:test';
import assert from 'node:assert/strict';
import { mountVelaPanel, type VelaPanelPresentation } from '../src/panel.ts';
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
  listeners = new Map<string, ((event: any) => unknown)[]>();
  className = ''; disabled = false; checked = false; open = false; hidden = false;
  selectionStart = 0; selectionEnd = 0;
  value = ''; private text = '';
  constructor(tagName: string, doc: Document) { this.tagName = tagName; this.ownerDocument = doc; }
  get textContent(): string { return this.text + this.children.map(child => child.textContent).join(''); }
  set textContent(value: string) { this.text = value; this.children = []; }
  get options() { return this.children.filter(child => child.tagName === 'option'); }
  get selectedOptions() { return this.options.filter(child => child.value === this.value); }
  get firstElementChild() { return this.children[0] ?? null; }
  append(...nodes: Node[]) { for (const node of nodes) { node.remove(); node.parent = this; this.children.push(node); } }
  prepend(...nodes: Node[]) { for (const node of [...nodes].reverse()) { node.remove(); node.parent = this; this.children.unshift(node); } }
  replaceChildren(...nodes: Node[]) { this.text = ''; for (const child of this.children) child.parent = null; this.children = []; this.append(...nodes); }
  insertBefore(node: Node, next: Node | null) { node.remove(); node.parent = this; const index = next ? this.children.indexOf(next) : -1; this.children.splice(index < 0 ? this.children.length : index, 0, node); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  addEventListener(name: string, callback: (event: any) => unknown) { this.listeners.set(name, [...this.listeners.get(name) ?? [], callback]); }
  fire(name: string, extra: Record<string, unknown> = {}) { const event = { target: this, key: '', defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra }; for (let node: Node | null = this; node; node = node.parent) { for (const callback of node.listeners.get(name) ?? []) callback(event); if (event.stopped) break; } return event; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
  contains(node: Node | null): boolean { return node === this || this.children.some(child => child.contains(node)); }
  matches(selector: string) { const plan = selector.match(/^\[data-plan-id="([^"]+)"\]$/); return plan ? this.dataset.planId === plan[1] : selector === 'details[open]' ? this.tagName === 'details' && this.open : this.tagName === selector; }
  closest(selector: string): Node | null { return this.matches(selector) ? this : this.parent?.closest(selector) ?? null; }
  querySelectorAll(selector: string): Node[] { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  focus() { this.ownerDocument.activeElement = this; }
  scrollIntoView() {}
  requestSubmit() { this.fire('submit'); }
  find(predicate: (node: Node) => boolean): Node | undefined { return predicate(this) ? this : this.children.map(child => child.find(predicate)).find(Boolean); }
}
class Document { activeElement: Node | null = null; createElement(tag: string) { return new Node(tag, this); } }
async function settles(check: () => boolean) { for (let i = 0; i < 50 && !check(); i++) await new Promise(resolve => setImmediate(resolve)); assert.ok(check(), 'component settled at its canonical state'); }
const named = (root: Node, text: string) => root.find(node => node.tagName === 'button' && (node.getAttribute('aria-label') === text || node.textContent === text))!;
function displayed(node: Node) { for (let parent: Node | null = node; parent; parent = parent.parent) { if (parent.hidden) return false; if (parent.tagName === 'details' && !parent.open && !parent.children[0]?.contains(node)) return false; } return true; }

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
  const composer = root.find(node => node.tagName === 'textarea')!; composer.value = 'Synthetic request'; composer.fire('input');
  form.fire('submit'); assert.equal(status.dataset.requestState, 'submitting'); assert.doesNotMatch(status.textContent, /provider.*running|Waiting for the identified planning provider/);
  canonical = { ...canonical, requests: [request({ errorCode: 'provider_authorization_required' })] }; resolveRequest(canonical.requests[0]);
  await settles(() => status.dataset.requestState === 'provider-unavailable'); assert.match(status.textContent, /Provider access was not enabled/); assert.equal(status.dataset.requestId, 'request:synthetic');
  const terminal = status.textContent; await panel.refresh(); await panel.refresh(); assert.equal(status.textContent, terminal); assert.doesNotMatch(status.textContent, /^Ready|Request:/);
  named(root, 'Provider').fire('click'); assert.equal(displayed(named(root, 'Check connection')), true); named(root, 'Check connection').fire('click');
  await settles(() => connections === 1 && root.find(node => node.className === 'vela-core-provider')!.textContent.includes('· available'));
  assert.equal(status.dataset.requestState, 'provider-unavailable'); assert.equal(status.textContent, terminal, 'connecting does not rewrite a historical request outcome');
  client.request = async () => { canonical = { ...canonical, requests: [request({ state: 'unknown' })] }; throw new Error('Synthetic lost command response'); };
  composer.value = 'Synthetic retry request'; composer.fire('input');
  form.fire('submit'); await settles(() => status.dataset.actionState === 'failed' && status.dataset.requestState === 'unknown');
  await panel.refresh(); assert.match(status.textContent, /outcome is unknown/); assert.equal(status.dataset.actionState, undefined);
  panel.dispose(); assert.equal(root.children.length, 0);
});

test('status distinguishes review, applied receipts, partial failure and unknown outcomes without asserting delegated task completion', () => {
  const canonical = state(); canonical.requests = [request({ state: 'awaiting-review', planId: 'plan:synthetic' })];
  const plan: VelaPlan = { id: 'plan:synthetic', requestId: 'request:synthetic', version: 1, fingerprint: 'synthetic', summary: 'Synthetic command', steps: [{ id: 'one', explanation: 'Synthetic delegation', action: { type: 'delegateTask', title: 'Synthetic task', objective: 'Synthetic only', providerId: 'synthetic-planner', resourceIds: [], constraints: [] } }], targets: [], scope: { principalId: 'synthetic', policyVersion: 'synthetic', resourceIds: [], projectIds: [], workspaceIds: [] }, state: 'prepared', createdAt: manifest.createdAt, expiresAt: manifest.createdAt, contribution: null };
  canonical.plans = [plan]; assert.match(velaPanelStatus(canonical).message, /ready for review/);
  plan.state = 'rejected'; assert.match(velaPanelStatus(canonical).message, /rejected/);
  plan.state = 'applied'; canonical.requests[0].state = 'completed'; assert.match(velaPanelStatus(canonical).message, /some results are missing/); assert.doesNotMatch(velaPanelStatus(canonical).message, /plan was applied/);
  const receipt: ActionReceipt = { id: 'receipt:synthetic', planId: plan.id, requestId: plan.requestId, stepId: 'one', commandId: 'command:synthetic', source: 'vela', providerId: 'synthetic-planner', state: 'applied', startedAt: manifest.createdAt, hostReceiptId: 'host:synthetic', taskVerified: false };
  canonical.receipts = [receipt]; assert.match(velaPanelStatus(canonical).message, /plan was applied/); assert.match(velaPanelStatus(canonical).message, /task completion remains unverified/);
  canonical.requests[0].state = 'unknown'; plan.state = 'unknown'; assert.match(velaPanelStatus(canonical).message, /outcome is unknown/); assert.match(velaPanelStatus(canonical).message, /1 earlier step/);
  canonical.requests[0].state = 'failed'; plan.state = 'failed'; assert.match(velaPanelStatus(canonical).message, /request stopped/);
  canonical.requests = [request({ state: 'planning', providerId: 'codex-app-server' })]; canonical.plans = []; assert.match(velaPanelStatus(canonical).message, /with Codex/); assert.doesNotMatch(velaPanelStatus(canonical).message, /codex-app-server/);
});

test('explicit workspace project survives refresh and selecting an available project re-enables the real capability', async () => {
  const doc = new Document(), root = doc.createElement('main'), canonical = state();
  canonical.capabilities = [{ id: 'workspaceFromResources', label: 'Synthetic capability metadata', effect: 'create', scope: 'synthetic', authorization: 'host-policy', schema: {}, reversible: 'host-dependent' }];
  canonical.applicationContext = { currentProjectId: 'project:a', currentWorkspaceId: null, references: [{ id: 'project:a', kind: 'project', title: 'Synthetic project', version: 1 }] };
  const panel = mountVelaPanel(root as unknown as HTMLElement, clientFor(async () => canonical, { search: async () => [{ id: 'source:a', kind: 'resource', title: 'Synthetic source', version: 1 }] }));
  await settles(() => root.find(node => node.className === 'vela-core-status')!.dataset.requestState === 'idle');
  const project = root.find(node => node.tagName === 'select')!, create = root.find(node => node.tagName === 'button' && node.textContent === 'Create workspace with selected resources')!;
  root.find(node => node.className === 'vela-core-search')!.fire('submit'); await settles(() => !!root.find(node => node.tagName === 'input' && node.parent?.textContent === 'Synthetic source'));
  const include = root.find(node => node.tagName === 'input' && node.parent?.textContent === 'Synthetic source')!; include.checked = true; include.fire('change');
  assert.equal(project.value, 'project:a'); project.fire('change'); canonical.applicationContext.currentProjectId = null; await panel.refresh(); assert.equal(project.value, 'project:a');
  canonical.applicationContext.references = []; await panel.refresh(); assert.equal(create.disabled, true);
  project.value = ''; project.fire('change'); assert.equal(create.disabled, false); await panel.refresh(); assert.equal(project.value, '');
  panel.dispose();
});

test('empty presence is only a composer; icon controls unfold one context and Escape restores its invoker before the host surface', async () => {
  const doc = new Document(), root = doc.createElement('main'), canonical = state(); let mutations = 0;
  const panel = mountVelaPanel(root as unknown as HTMLElement, clientFor(async () => canonical, { native: async () => { mutations++; throw new Error('No action on opening tools'); } }));
  await settles(() => root.find(node => node.className === 'vela-core-status')!.dataset.requestState === 'idle');
  assert.equal(root.find(node => node.className === 'vela-core-empty'), undefined); assert.equal(root.find(node => node.className === 'vela-core-scroll')!.hidden, true); assert.equal(displayed(named(root, 'Create note')), false); assert.equal(displayed(root.find(node => node.className === 'vela-core-provider-controls')!), false);
  const input = root.find(node => node.tagName === 'textarea')!; assert.equal(input.getAttribute('aria-label'), 'Message Vela'); assert.equal(input.parent?.tagName, 'form'); assert.equal(displayed(named(root, 'Send to Vela')), true);
  named(root, 'Local tools').fire('click'); const local = root.find(node => node.className === 'vela-core-tools')!, more = root.find(node => node.className.includes('vela-core-contextual'))!;
  assert.equal(local.open, true); assert.equal(more.hidden, false); const title = root.find(node => node.tagName === 'input' && node.parent?.textContent === 'Name')!; assert.equal(doc.activeElement, title); assert.equal(named(root, 'Local tools').getAttribute('aria-expanded'), 'true');
  named(root, 'Add sources').fire('click'); assert.equal(local.hidden, true); assert.equal(displayed(named(root, 'Create note')), false); assert.equal(named(root, 'Local tools').getAttribute('aria-expanded'), 'false');
  const search = root.find(node => node.tagName === 'input' && node.parent?.className === 'vela-core-search')!; assert.equal(doc.activeElement, search);
  const first = search.fire('keydown', { key: 'Escape' }); assert.equal(more.hidden, true); assert.equal(doc.activeElement, named(root, 'Add sources')); assert.equal(first.defaultPrevented, true); assert.equal(first.stopped, true);
  assert.equal(named(root, 'Add sources').fire('keydown', { key: 'Escape' }).defaultPrevented, false, 'Outer surface retains its own Escape handling'); assert.equal(mutations, 0); panel.dispose();
});

test('Enter submits, Shift+Enter adds a newline, IME never submits, and later text/selection/consent survive a pending request', async () => {
  const doc = new Document(), root = doc.createElement('main'); let canonical = state(), resolve!: (value: VelaRequest) => void; canonical.planner = { providerId: 'codex-app-server', available: true, busy: false };
  const calls: Parameters<VelaClient['request']>[0][] = [];
  const panel = mountVelaPanel(root as unknown as HTMLElement, clientFor(async () => canonical, { request: async input => { calls.push(input); return new Promise(r => { resolve = r; }); } }));
  await settles(() => root.find(node => node.className === 'vela-core-status')!.dataset.requestState === 'idle');
  const input = root.find(node => node.tagName === 'textarea')!, consent = root.find(node => !!node.parent?.className.includes('vela-core-consent') && node.tagName === 'input')!;
  input.value = 'The exact submitted plan request'; input.fire('input'); consent.checked = true; consent.fire('change');
  assert.equal(input.fire('keydown', { key: 'Enter', shiftKey: true }).defaultPrevented, false); input.fire('compositionstart'); input.fire('keydown', { key: 'Enter' }); input.fire('compositionend'); input.fire('keydown', { key: 'Enter', isComposing: true }); input.fire('keydown', { key: 'Enter', keyCode: 229 }); assert.equal(calls.length, 0);
  assert.equal(input.fire('keydown', { key: 'Enter' }).defaultPrevented, true); assert.equal(calls.length, 1); assert.equal(calls[0].intent, 'The exact submitted plan request'); assert.equal(calls[0].authorizeProvider, true); assert.equal(consent.checked, false, 'Provider choice is one request at a time');
  input.value = 'Later text typed while waiting'; input.selectionStart = 2; input.selectionEnd = 8; input.fire('input'); consent.checked = true; consent.fire('change');
  canonical = { ...canonical, requests: [request({ state: 'awaiting-review' })] }; resolve(canonical.requests[0]); await settles(() => root.find(node => node.className === 'vela-core-status')!.dataset.requestState === 'awaiting-review');
  assert.equal(root.find(node => node.tagName === 'textarea'), input); assert.equal(input.value, 'Later text typed while waiting'); assert.equal(input.selectionStart, 2); assert.equal(input.selectionEnd, 8); assert.equal(consent.checked, true); panel.dispose();
});

test('canonical conversation nodes stay mounted across refresh and message/provider identity remains explicit', async () => {
  const doc = new Document(), root = doc.createElement('main'), canonical = state(); canonical.conversation = { resourceId: 'chat:vela', revision: 2, messages: [{ id: 'message:you', role: 'user', content: 'Exact canonical user text', source: 'user', classification: 'observed' }, { id: 'message:provider', role: 'assistant', content: 'Exact attributed proposal', source: 'provider', providerId: 'codex-app-server', classification: 'reported' }] };
  const panel = mountVelaPanel(root as unknown as HTMLElement, clientFor(async () => canonical)); await settles(() => !!root.find(node => node.dataset.messageId === 'message:provider'));
  const user = root.find(node => node.dataset.messageId === 'message:you')!, provider = root.find(node => node.dataset.messageId === 'message:provider')!; await panel.refresh();
  assert.equal(root.find(node => node.dataset.messageId === 'message:you'), user); assert.equal(root.find(node => node.dataset.messageId === 'message:provider'), provider); assert.equal(user.children[1].textContent, 'Exact canonical user text'); assert.equal(provider.children[0].textContent, 'Codex · contribution'); panel.dispose();
});

test('readable plan effects and consequential text stay visible while JSON is disclosed, with review before exact apply', async () => {
  const doc = new Document(), root = doc.createElement('main'), canonical = state(), calls: unknown[] = [];
  const plan: VelaPlan = { id: 'plan:edit', requestId: 'request:synthetic', version: 1, fingerprint: 'exact:reviewed-fingerprint', summary: 'Update the research note', steps: [{ id: 'edit', explanation: 'Replace this note only', action: { type: 'content', resourceId: 'note:one', expectedVersion: 7, content: 'Exact replacement text' } }], targets: [{ id: 'note:one', kind: 'resource', title: 'Research note', version: 7 }], scope: { principalId: 'synthetic', policyVersion: 'policy:synthetic', resourceIds: ['note:one'], projectIds: [], workspaceIds: [] }, state: 'prepared', createdAt: manifest.createdAt, expiresAt: manifest.createdAt, contribution: { providerId: 'codex-app-server', classification: 'reported' } };
  canonical.plans = [plan]; canonical.requests = [request({ state: 'awaiting-review', planId: plan.id })];
  const panel = mountVelaPanel(root as unknown as HTMLElement, clientFor(async () => canonical, { review: async input => { calls.push(input); plan.state = 'approved'; return plan; }, apply: async id => { calls.push(id); plan.state = 'applied'; canonical.requests[0].state = 'completed'; canonical.receipts = [{ id: 'receipt:actual-port-fixture', planId: plan.id, requestId: plan.requestId, stepId: 'edit', commandId: 'command:fixture', source: 'vela', providerId: null, state: 'applied', startedAt: manifest.createdAt, hostReceiptId: 'host:fixture', taskVerified: false }]; return plan; } }));
  await settles(() => !!root.find(node => node.dataset.planId === plan.id)); assert.equal(calls.length, 0); const preview = root.find(node => node.className === 'vela-core-change-preview')!; assert.equal(preview.textContent, 'Exact replacement text'); assert.equal(displayed(preview), true);
  const raw = root.find(node => node.tagName === 'pre' && node.textContent.includes('expectedVersion'))!; assert.equal(displayed(raw), false); assert.equal(displayed(named(root, 'Approve and apply')), true);
  named(root, 'Approve and apply').focus(); named(root, 'Approve and apply').fire('click'); await settles(() => calls.length === 2 && root.find(node => node.className === 'vela-core-status')!.dataset.requestState === 'completed');
  assert.deepEqual(calls, [{ planId: plan.id, fingerprint: plan.fingerprint, decision: 'approve' }, plan.id]); assert.match(root.find(node => node.className === 'vela-core-status')!.textContent, /reviewed plan was applied/); assert.equal(doc.activeElement, root.find(node => node.dataset.planId === plan.id)); panel.dispose();
});

test('unavailable native tools are disabled by actual host availability and attention opens without marking anything reviewed', async () => {
  const doc = new Document(), root = doc.createElement('main'), canonical = state() as VelaState & { nativeCapabilities: Record<string, { available: boolean }> }; let nativeCalls = 0; const reviewed: string[][] = [];
  canonical.nativeCapabilities = { createResource: { available: false }, workspaceFromResources: { available: false } }; canonical.capabilities = [{ id: 'createResource', label: 'Catalog entry only', effect: 'create', scope: 'synthetic', authorization: 'host-policy', schema: {}, reversible: 'host-dependent' }]; canonical.preferences.mode = 'quiet'; canonical.preferences.monitoringEnabled = true;
  canonical.attention = [{ id: 'event:one', type: 'task.completed', source: 'application', occurredAt: manifest.createdAt, receivedAt: manifest.createdAt, subject: null, severity: 'info', classification: 'observed', summary: 'A saved task was completed', correlationId: 'synthetic:correlation', disposition: 'silent', reason: 'Quiet mode', reviewedAt: null, dismissedAt: null }];
  const panel = mountVelaPanel(root as unknown as HTMLElement, clientFor(async () => canonical, { native: async () => { nativeCalls++; throw new Error('Unavailable'); }, reviewAttention: async ids => { reviewed.push(ids); canonical.attention[0].reviewedAt = manifest.createdAt; } }));
  await settles(() => !!root.find(node => node.className === 'vela-core-availability')); named(root, 'Local tools').fire('click'); assert.equal(named(root, 'Create note').disabled, true); named(root, 'Create note').fire('click'); assert.equal(nativeCalls, 0); assert.match(root.find(node => node.className === 'vela-core-availability')!.textContent, /unavailable/);
  named(root, 'Attention, 1 update').fire('click'); assert.equal(displayed(named(root, 'Mark reviewed')), true); assert.equal(reviewed.length, 0); named(root, 'Mark reviewed').fire('click'); await settles(() => reviewed.length === 1); assert.deepEqual(reviewed, [['event:one']]); panel.dispose();
});

test('read-only refresh preserves keyed plan disclosures, reading focus and pending approval controls without replaying actions', async () => {
  const doc = new Document(), root = doc.createElement('main'), canonical = state(); let reviews = 0, applies = 0, finishReview!: () => void;
  const plan: VelaPlan = { id: 'plan:current', requestId: 'request:synthetic', version: 1, fingerprint: 'exact:current', summary: 'Create the reviewed note', steps: [{ id: 'create', explanation: 'Only this local note', action: { type: 'createResource', kind: 'note', title: 'Reviewed note', workspaceId: null } }], targets: [], scope: { principalId: 'synthetic', policyVersion: 'policy:synthetic', resourceIds: [], projectIds: [], workspaceIds: [] }, state: 'prepared', createdAt: manifest.createdAt, expiresAt: manifest.createdAt, contribution: null };
  canonical.plans = [{ ...structuredClone(plan), id: 'plan:earlier', state: 'applied' }, plan]; canonical.requests = [request({ state: 'awaiting-review', planId: plan.id })];
  const panel = mountVelaPanel(root as unknown as HTMLElement, clientFor(async () => structuredClone(canonical), {
    review: async () => { reviews++; await new Promise<void>(resolve => { finishReview = resolve; }); plan.state = 'approved'; return structuredClone(plan); },
    apply: async () => { applies++; plan.state = 'applied'; canonical.requests[0].state = 'completed'; return structuredClone(plan); },
  }));
  await settles(() => !!root.find(node => node.dataset.planId === plan.id));
  const currentCard = root.find(node => node.dataset.planId === plan.id)!, earlierCard = root.find(node => node.dataset.planId === 'plan:earlier')!, history = root.find(node => node.className === 'vela-core-plan-history')!;
  const evidence = currentCard.find(node => node.className === 'vela-core-plan-details')!, earlierEvidence = earlierCard.find(node => node.className === 'vela-core-plan-details')!, approve = named(currentCard, 'Approve and apply');
  history.open = evidence.open = earlierEvidence.open = true; earlierEvidence.children[0].focus();
  await panel.refresh(); await panel.refresh();
  assert.equal(root.find(node => node.dataset.planId === plan.id), currentCard); assert.equal(root.find(node => node.dataset.planId === 'plan:earlier'), earlierCard); assert.equal(root.find(node => node.className === 'vela-core-plan-history'), history);
  assert.equal(history.open, true); assert.equal(evidence.open, true); assert.equal(earlierEvidence.open, true); assert.equal(doc.activeElement, earlierEvidence.children[0]); assert.equal(reviews, 0); assert.equal(applies, 0);
  approve.focus(); approve.fire('click'); assert.equal(reviews, 1); assert.equal(approve.disabled, true);
  await panel.refresh(); assert.equal(named(root, 'Approve and apply'), approve); assert.equal(approve.disabled, true); assert.equal(doc.activeElement, approve); assert.equal(evidence.open, true);
  approve.fire('click'); assert.equal(reviews, 1); assert.equal(applies, 0); finishReview();
  await settles(() => applies === 1 && root.find(node => node.dataset.planId === plan.id)?.dataset.planState === 'applied');
  assert.equal(reviews, 1); assert.equal(root.find(node => node.dataset.planId === plan.id)!.find(node => node.className === 'vela-core-plan-details')!.open, true); panel.dispose();
});

test('presentation is a content-free observed baseline and meaningful state changes, never invented planning or automatic attention review', async () => {
  const doc = new Document(), root = doc.createElement('main'), canonical = state(), observed: VelaPanelPresentation[] = [];
  canonical.conversation = { resourceId: 'chat:vela', revision: 1, messages: [{ id: 'message:existing', role: 'user', content: 'Existing retained history', source: 'user', classification: 'observed' }] };
  const panel = mountVelaPanel(root as unknown as HTMLElement, clientFor(async () => structuredClone(canonical)), { onPresentation: value => { observed.push(value); } });
  await settles(() => observed.length === 1); assert.deepEqual(observed[0], { phase: 'idle', context: null, messageIds: ['message:existing'], planIds: [] }); assert(Object.isFrozen(observed[0]));
  await panel.refresh(); await panel.open(); assert.equal(observed.length, 1, 'Hydrating unchanged old history is not a new arrival');
  const input = root.find(node => node.tagName === 'textarea')!; input.value = 'Unsubmitted private draft'; input.fire('input'); assert.equal(observed.at(-1)!.phase, 'receiving'); const count = observed.length; input.value += ' more'; input.fire('input'); assert.equal(observed.length, count, 'Keystrokes do not replay a state transition');
  named(root, 'Add sources').fire('click'); assert.equal(observed.at(-1)!.context, 'sources'); named(root, 'Close Vela controls').fire('click'); assert.equal(observed.at(-1)!.context, null);
  canonical.requests = [request({ state: 'planning' })]; await panel.refresh(); assert.equal(observed.at(-1)!.phase, 'planning', 'Only recorded planning state is planning');
  const plan: VelaPlan = { id: 'plan:observed', requestId: 'request:synthetic', version: 1, fingerprint: 'synthetic:observed', summary: 'Observed local note', steps: [{ id: 'one', explanation: 'Synthetic fixture only', action: { type: 'createResource', kind: 'note', title: 'Observed note', workspaceId: null } }], targets: [], scope: { principalId: 'synthetic', policyVersion: 'synthetic', resourceIds: [], projectIds: [], workspaceIds: [] }, state: 'prepared', createdAt: manifest.createdAt, expiresAt: manifest.createdAt, contribution: null };
  canonical.requests[0].state = 'awaiting-review'; canonical.requests[0].planId = plan.id; canonical.plans = [plan]; await panel.refresh(); assert.equal(observed.at(-1)!.phase, 'review'); assert.deepEqual(observed.at(-1)!.planIds, [plan.id]);
  plan.state = 'applying'; await panel.refresh(); assert.equal(observed.at(-1)!.phase, 'applying'); canonical.requests[0].state = 'unknown'; plan.state = 'unknown'; await panel.refresh(); assert.equal(observed.at(-1)!.phase, 'error');
  canonical.requests = []; canonical.plans = []; input.value = ''; canonical.attention = [{ id: 'event:unreviewed', type: 'task.completed', source: 'application', occurredAt: manifest.createdAt, receivedAt: manifest.createdAt, subject: null, severity: 'info', classification: 'observed', summary: 'Actual saved event fixture', correlationId: 'synthetic', disposition: 'silent', reason: 'Quiet mode', reviewedAt: null, dismissedAt: null }]; await panel.refresh(); assert.equal(observed.at(-1)!.phase, 'idle', 'An unopened silent digest does not invent attention activity');
  named(root, 'Attention, 1 update').fire('click'); assert.equal(observed.at(-1)!.phase, 'attention'); assert.equal(canonical.attention[0].reviewedAt, null);
  for (const value of observed) { assert.deepEqual(Object.keys(value).sort(), ['context', 'messageIds', 'phase', 'planIds']); assert(!JSON.stringify(value).includes('Unsubmitted')); assert(!JSON.stringify(value).includes('Existing retained history')); }
  panel.dispose(); const ended = observed.length; input.fire('input'); assert.equal(observed.length, ended);
});

test('provider opt-in is contextual, one-shot, identified and cannot silently move to a different provider', async () => {
  const doc = new Document(), root = doc.createElement('main'), canonical = state(); canonical.planner = { providerId: 'codex-app-server', available: true, busy: false };
  const panel = mountVelaPanel(root as unknown as HTMLElement, clientFor(async () => canonical)); await settles(() => root.find(node => node.className === 'vela-core-status')!.dataset.requestState === 'idle');
  const consent = root.find(node => node.tagName === 'input' && !!node.parent?.className.includes('vela-core-consent'))!; assert.equal(displayed(consent), false); assert.equal(consent.checked, false);
  named(root, 'Provider').fire('click'); assert.equal(displayed(consent), true); assert.match(consent.parent!.textContent, /Use Codex for this request/); consent.checked = true; consent.fire('change');
  const choice = root.find(node => node.className.includes('vela-core-provider-choice'))!; assert.equal(choice.hidden, false); assert.match(choice.textContent, /Codex/); named(root, 'Close Vela controls').fire('click'); assert.equal(displayed(choice), true);
  canonical.planner.providerId = 'other-identified-provider'; await panel.refresh(); assert.equal(consent.checked, false); assert.equal(choice.hidden, true); assert.match(consent.parent!.textContent, /other-identified-provider/); panel.dispose();
});

test('responded conversational outcomes show one attributed message without plan controls and preserve pending text/caret and observed presentation', async () => {
  for (const kind of ['answer', 'clarification', 'inability'] as const) {
    const doc = new Document(), root = doc.createElement('main'), canonical = state(), observed: VelaPanelPresentation[] = []; let finish!: (value: VelaRequest) => void, calls = 0;
    canonical.planner = { providerId: 'codex-app-server', available: true, busy: false }; canonical.conversation = { resourceId: 'chat:vela', revision: 1, messages: [] };
    const panel = mountVelaPanel(root as unknown as HTMLElement, clientFor(async () => canonical, { request: async input => { calls++; assert.equal(input.authorizeProvider, true); return new Promise(resolve => { finish = resolve; }); } }), { onPresentation: value => observed.push(value) });
    await settles(() => observed.length === 1); const input = root.find(node => node.tagName === 'textarea')!;
    named(root, 'Provider').fire('click'); const consent = root.find(node => node.tagName === 'input' && !!node.parent?.className.includes('vela-core-consent'))!; consent.checked = true; consent.fire('change'); named(root, 'Close Vela controls').fire('click');
    input.value = 'An ordinary conversational question'; input.fire('input'); input.fire('keydown', { key: 'Enter' }); assert.equal(calls, 1); assert.equal(consent.checked, false);
    input.value = 'Later unsent text'; input.selectionStart = 2; input.selectionEnd = 7; input.fire('input');
    canonical.requests = [request({ state: 'responded', response: { kind, messageId: 'message:actual-response' } })];
    canonical.conversation.messages = [{ id: 'message:submitted', role: 'user', content: 'An ordinary conversational question', source: 'user', classification: 'observed' }, { id: 'message:actual-response', role: 'assistant', content: 'Exact canonical reported ' + kind + '.', source: 'provider', providerId: 'codex-app-server', classification: 'reported', responseKind: kind, providerContribution: { providerId: 'codex-app-server', classification: 'reported', executionId: 'execution:synthetic-client-reference' } }];
    finish(canonical.requests[0]); await settles(() => root.find(node => node.className === 'vela-core-status')!.dataset.requestState === 'responded');
    const provider = root.find(node => node.dataset.messageId === 'message:actual-response')!; assert.equal(provider.children[0].textContent, 'Codex · contribution'); assert.equal(provider.children[1].textContent, 'Exact canonical reported ' + kind + '.'); assert.equal(root.find(node => node.className === 'vela-core-plans')!.children.length, 0); assert.equal(named(root, 'Approve and apply'), undefined);
    assert.equal(root.find(node => node.tagName === 'textarea'), input); assert.equal(input.value, 'Later unsent text'); assert.equal(input.selectionStart, 2); assert.equal(input.selectionEnd, 7); assert.doesNotMatch(root.find(node => node.className === 'vela-core-status')!.textContent, /applied|complete|running|missing/i);
    assert(observed.some(value => value.messageIds.includes('message:actual-response'))); assert(observed.every(value => !['planning', 'review', 'applying'].includes(value.phase))); assert.equal(observed.at(-1)!.phase, 'receiving', 'Only the later user draft remains active'); assert.deepEqual(observed.at(-1)!.planIds, []); panel.dispose();
  }
});

test('collection review labels retain distinct collection and resource identities even when IDs coincide', async () => {
  const doc = new Document(), root = doc.createElement('main'), canonical = state();
  const plan: VelaPlan = {
    id: 'plan:membership', requestId: 'request:synthetic', version: 1,
    fingerprint: 'synthetic:membership', summary: 'Organize the existing chat',
    steps: [{ id: 'membership', explanation: 'Use canonical membership', action: { type: 'collectionMembership', collectionId: 'shared:id', resourceId: 'shared:id', member: true } }],
    targets: [
      { id: 'shared:id', kind: 'collection', title: 'Work collection', version: 1 },
      { id: 'shared:id', kind: 'resource', title: 'Authorized chat', version: 1 },
    ],
    scope: { principalId: 'synthetic', policyVersion: 'synthetic', resourceIds: ['shared:id'], collectionIds: ['shared:id'], projectIds: [], workspaceIds: [] },
    state: 'prepared', createdAt: manifest.createdAt, expiresAt: manifest.createdAt, contribution: null,
  };
  canonical.plans = [plan]; canonical.requests = [request({ state: 'awaiting-review', planId: plan.id })];
  const panel = mountVelaPanel(root as unknown as HTMLElement, clientFor(async () => canonical));
  await settles(() => !!root.find(node => node.className === 'vela-core-effects'));
  assert.equal(root.find(node => node.className === 'vela-core-effects')!.textContent, 'Add Authorized chat to Work collection');
  panel.dispose();
});

test('SYNTHETIC hidden-DOM prepared long-request/open-evidence fixture preserves reading and pending review without executing anything', async () => {
  // Structural CPU regression only. This harness has no layout engine and cannot qualify pixels/native/provider behavior.
  const doc = new Document(), root = doc.createElement('main'), canonical = state(); let writes = 0;
  const long = ('Synthetic long request for the prepared-review DOM fixture. ').repeat(48);
  const plan: VelaPlan = { id: 'plan:synthetic-long-review', requestId: 'request:synthetic', version: 1, fingerprint: 'synthetic:long-review',
    summary: 'Synthetic proposed workspace using two existing synthetic resources',
    steps: [{ id: 'one', explanation: 'Synthetic typed evidence only', action: { type: 'workspaceFromResources', title: 'Synthetic proposed workspace', projectId: null, resourceIds: ['synthetic:chat', 'synthetic:note'] } }],
    targets: [{ id: 'synthetic:chat', kind: 'resource', resourceKind: 'conversation', title: 'Synthetic chat', version: 1 }, { id: 'synthetic:note', kind: 'resource', resourceKind: 'note', title: 'Synthetic note', version: 1 }],
    scope: { principalId: 'synthetic', policyVersion: 'synthetic', resourceIds: ['synthetic:chat', 'synthetic:note'], workspaceIds: [], projectIds: [] }, contribution: null,
    state: 'prepared', createdAt: manifest.createdAt, expiresAt: manifest.createdAt };
  canonical.requests = [request({ intent: long, state: 'awaiting-review', planId: plan.id })]; canonical.plans = [plan];
  canonical.conversation = { resourceId: 'conversation:synthetic', revision: 3, messages: [
    { id: 'synthetic:long-message', role: 'user', content: long, source: 'user', classification: 'observed' },
    { id: 'synthetic:proposal-message', role: 'assistant', content: plan.summary, source: 'provider', providerId: 'synthetic-fixture-only', classification: 'reported' },
  ] };
  const unexpected = async (): Promise<never> => { writes++; throw new Error('Synthetic read-only fixture executed a command'); };
  const panel = mountVelaPanel(root as unknown as HTMLElement, clientFor(async () => structuredClone(canonical), { request: unexpected, review: unexpected, apply: unexpected, native: unexpected }));
  await settles(() => !!root.find(node => node.dataset.planId === plan.id));
  const editor = root.find(node => node.tagName === 'textarea')!, message = root.find(node => node.dataset.messageId === 'synthetic:long-message')!, card = root.find(node => node.dataset.planId === plan.id)!, evidence = card.find(node => node.className === 'vela-core-plan-details')!, approve = named(root, 'Approve and apply'), reject = named(root, 'Reject plan');
  editor.value = 'Synthetic unsent recovery text'; editor.selectionStart = 4; editor.selectionEnd = 12; editor.fire('input'); evidence.open = true; evidence.fire('toggle'); evidence.children[0].focus();
  const typed = JSON.parse(evidence.find(node => node.tagName === 'pre')!.textContent); assert.deepEqual(typed.actions, plan.steps); assert.deepEqual(typed.targets, plan.targets); assert.deepEqual(typed.receipts, []);
  assert.equal(message.children[1].textContent, long); assert.equal(displayed(approve), true); assert.equal(displayed(reject), true);
  await panel.refresh(); await panel.refresh();
  assert.equal(root.find(node => node.dataset.messageId === 'synthetic:long-message'), message); assert.equal(root.find(node => node.dataset.planId === plan.id), card); assert.equal(evidence.open, true); assert.equal(doc.activeElement, evidence.children[0]);
  assert.equal(named(root, 'Approve and apply'), approve); assert.equal(named(root, 'Reject plan'), reject); assert.equal(approve.disabled, false);
  assert.equal(root.find(node => node.tagName === 'textarea'), editor); assert.equal(editor.value, 'Synthetic unsent recovery text'); assert.equal(editor.selectionStart, 4); assert.equal(editor.selectionEnd, 12); assert.equal(writes, 0); panel.dispose();
});
