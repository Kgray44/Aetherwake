import test from 'node:test';
import assert from 'node:assert/strict';
import { mountVelaPanel, type VelaPanelPresentation, type VelaPanelManifestation } from '../src/panel.ts';
import { velaPanelStatus } from '../src/panel-status.ts';
import { VELA_CONTRACT, type VelaClient, type VelaState, type VelaRequest, type VelaPlan, type ActionReceipt, type VelaLocalDispatch, type VelaMessage } from '../src/contracts.ts';

const manifest = { id: 'manifest:synthetic', createdAt: '2026-11-02T00:00:00Z', policyVersion: 'policy:synthetic', discovered: [], included: [], omitted: [], contentBytes: 0, coverage: 'explicit-resources-only' as const };
const request = (patch: Partial<VelaRequest> = {}): VelaRequest => ({ id: 'request:synthetic', conversationId: 'conversation:synthetic', intent: 'Synthetic panel request', state: 'provider-unavailable', createdAt: manifest.createdAt, updatedAt: manifest.createdAt, providerId: 'synthetic-planner', context: manifest, ...patch });
function state(): VelaState {
  return { contract: VELA_CONTRACT, identity: { id: 'system:vela', name: 'Vela', role: 'application-assistant' }, conversation: { resourceId: 'conversation:synthetic', revision: 1, messages: [] },
    planner: { providerId: 'synthetic-planner', available: false, busy: false }, capabilities: [], requests: [], plans: [], receipts: [],
    preferences: { version: 1, mode: 'normal', monitoringEnabled: false, delegationEnabled: false, allowedEventTypes: [], minimumSeverity: 'warning', maxInterruptionsPerHour: 0, source: 'default', updatedAt: manifest.createdAt, learning: 'disabled' }, attention: [], lastPresenceAt: null, coverage: 'authorized-app-events-only', presentation: { schemaVersion: 1, version: 1, view: 'current', selectedRequestId: null, pinnedRequestIds: [], dismissedRequestIds: [] } };
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
  className = ''; title = ''; disabled = false; checked = false; open = false; hidden = false;
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
  matches(selector: string) { const plan = selector.match(/^\[data-plan-id="([^"]+)"\]$/); return plan ? this.dataset.planId === plan[1] : selector === 'details[open]' ? this.tagName === 'details' && this.open : selector === '[hidden]' ? this.hidden : this.tagName === selector; }
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

test('a verified result is concise, counts only this request and opens its canonical plan and workspace', async () => {
  const doc = new Document(), root = doc.createElement('main'), canonical = state(), opened: unknown[] = [];
  const plan: VelaPlan = { id: 'plan:result', requestId: 'request:synthetic', version: 1, fingerprint: 'synthetic',
    summary: 'Create the requested workspace', steps: [{ id: 'create', explanation: 'Create the workspace', action: { type: 'createWorkspace', title: 'Garden', projectId: null } }],
    targets: [], scope: { principalId: 'synthetic', policyVersion: 'synthetic', resourceIds: [], projectIds: [], workspaceIds: [] },
    state: 'applied', createdAt: manifest.createdAt, expiresAt: manifest.createdAt, contribution: null };
  canonical.requests = [request({ state: 'completed', providerId: null, planId: plan.id })]; canonical.plans = [plan];
  const receipt: ActionReceipt = { id: 'receipt:result', planId: plan.id, requestId: plan.requestId, stepId: 'create', commandId: 'command:result', source: 'vela',
    providerId: null, state: 'applied', startedAt: manifest.createdAt, hostReceiptId: 'host:result', taskVerified: false, createdWorkspaceId: 'workspace:result' };
  canonical.receipts = [receipt, { ...receipt, id: 'receipt:older', requestId: 'request:older', planId: 'plan:older' }];
  canonical.conversation!.messages = [{ id: 'message:result', requestId: plan.requestId, planId: plan.id, role: 'assistant', content: 'Created “Garden”.', source: 'vela-native', classification: 'observed' }];
  const panel = mountVelaPanel(root as unknown as HTMLElement, clientFor(async () => canonical), { onOpenSubject: value => opened.push(value) });
  await settles(() => !!named(root, 'Open completed plan'));
  assert.equal(root.find(node => node.className === 'vela-core-plans')!.children.length, 0);
  assert.equal(root.find(node => node.className === 'vela-mission-jobs-done')!.textContent, '1 job done');
  assert.equal(displayed(root.find(node => node.dataset.planId === plan.id)!), false);
  assert.equal(root.find(node => node.className === 'vela-core-status')!.hidden, true);
  named(root, 'Open completed plan').fire('click');
  assert.equal(displayed(root.find(node => node.dataset.planId === plan.id)!), true);
  named(root, 'Open workspace').fire('click'); assert.deepEqual(opened, [{ kind: 'workspace', id: 'workspace:result' }]);
  named(root, 'Close Vela controls').fire('click'); assert.equal(doc.activeElement, named(root, 'Open completed plan'));
  canonical.receipts = []; await panel.refresh();
  assert.equal(displayed(root.find(node => node.dataset.planId === plan.id)!), false, 'Unconfirmed details stay behind the icon');
  named(root, 'Open response details').fire('click'); assert.equal(displayed(root.find(node => node.dataset.planId === plan.id)!), true);
  assert.equal(named(root, 'Open completed plan'), undefined);
  panel.dispose();
});

test('native review uses only its operation reference and counts verified jobs only for the current request',async()=>{
  const doc=new Document(),root=doc.createElement('main'),canonical=state(),calls:unknown[]=[];
  canonical.requests=[request({state:'responded',providerId:null,nativeResponse:{schemaVersion:1,classification:'observed'},response:{kind:'answer',messageId:'message:host'}})];
  canonical.conversation!.messages=[{id:'message:host',requestId:'request:synthetic',role:'assistant',content:'Review the selected window before I change it.',source:'vela-native',classification:'observed',responseKind:'answer'}];
  const pending:NonNullable<VelaState['hostOperations']>[number]={id:'operation:current',requestId:'request:synthetic',workflowId:'workflow:current',capabilityId:'windows.computer.prepare',state:'awaiting-review',title:'Window control',summary:'Review options',reviewAvailable:true};
  canonical.hostOperations=[{...pending,id:'operation:older',requestId:'request:older',state:'observed',reviewAvailable:false,receiptId:'receipt:older',jobsDone:50},pending];
  const panel=mountVelaPanel(root as unknown as HTMLElement,clientFor(async()=>canonical,{hostOperation:async input=>{
    calls.push(input);pending.state='observed';pending.reviewAvailable=false;pending.receiptId='receipt:current';pending.jobsDone=1;
    canonical.hostOperations!.push({...pending,id:'operation:duplicate'}, {...pending,id:'operation:scope-only',receiptId:'receipt:scope',jobsDone:0});
    canonical.conversation!.messages[0].content='Moved the selected window.';return pending;
  }}));
  await settles(()=>!!named(root,'Review options'));assert.equal(root.find(node=>node.className==='vela-mission-jobs-done'),undefined);
  named(root,'Review options').fire('click');await settles(()=>calls.length===1&&!!root.find(node=>node.className==='vela-mission-jobs-done'));
  assert.deepEqual(calls,[{operationId:'operation:current'}]);assert.equal(root.find(node=>node.className==='vela-mission-jobs-done')!.textContent,'1 job done');
  assert.equal(named(root,'Review options'),undefined);
  canonical.requests.push(request({id:'request:new',state:'responded',providerId:null,nativeResponse:{schemaVersion:1,classification:'observed'},response:{kind:'answer',messageId:'message:new'}}));
  canonical.conversation!.messages.push({id:'message:new',requestId:'request:new',role:'assistant',content:'Hello.',source:'vela-native',classification:'observed',responseKind:'answer'});
  await panel.refresh();assert.equal(root.find(node=>node.className==='vela-mission-jobs-done'),undefined,'previous request jobs cannot carry into a new response');panel.dispose();
});

test('source-observed read jobs repaint for the current request without promoting partial or unknown outcomes',async()=>{
 const doc=new Document(),root=doc.createElement('main'),canonical=state(),message={id:'message:read-jobs',requestId:'request:synthetic',role:'assistant' as const,content:'The observed work is recorded; the whole request remains partial.',source:'provider' as const,classification:'reported' as const,providerId:'openai-api-vela',providerContribution:{providerId:'openai-api-vela',classification:'reported' as const},responseKind:'answer' as const};
 const current=request({state:'responded',providerId:'openai-api-vela',toolWorkflow:{id:'workflow:current',phase:'partial',completedReadJobs:1},response:{kind:'answer',messageId:message.id}});canonical.requests=[current];canonical.conversation!.messages=[message];canonical.hostOperations=[{id:'operation:mutation',requestId:current.id,workflowId:'workflow:current',capabilityId:'application.createWorkspace',state:'observed',title:'Workspace',summary:'Created',receiptId:'receipt:mutation',reviewAvailable:false,jobsDone:1},{id:'operation:older',requestId:'request:older',workflowId:'workflow:older',capabilityId:'application.createWorkspace',state:'observed',title:'Older',summary:'Older',receiptId:'receipt:older',reviewAvailable:false,jobsDone:50}];
 const panel=mountVelaPanel(root as unknown as HTMLElement,clientFor(async()=>canonical));try{await settles(()=>!!root.find(node=>node.className==='vela-mission-jobs-done'));assert.equal(root.find(node=>node.className==='vela-mission-jobs-done')!.textContent,'2 jobs done');assert.equal(current.toolWorkflow!.phase,'partial');
  current.toolWorkflow!.completedReadJobs=2;await panel.refresh();assert.equal(root.find(node=>node.className==='vela-mission-jobs-done')!.textContent,'3 jobs done','count-only changes repaint the unchanged primary reply');
  current.state='unknown';current.toolWorkflow!.phase='unknown';current.response={kind:'inability',messageId:message.id};canonical.conversation!.messages=[{id:message.id,requestId:current.id,role:'assistant',source:'vela-native',classification:'observed',content:'I could not confirm the last step.',responseKind:'inability'}];await panel.refresh();assert.equal(root.find(node=>node.className==='vela-mission-jobs-done')!.textContent,'3 jobs done');assert.equal(current.state,'unknown');
  canonical.requests.push(request({id:'request:new',state:'responded',providerId:null,nativeResponse:{schemaVersion:1,classification:'observed'},response:{kind:'answer',messageId:'message:new'}}));canonical.conversation!.messages.push({id:'message:new',requestId:'request:new',role:'assistant',source:'vela-native',classification:'observed',content:'A new request.',responseKind:'answer'});await panel.refresh();assert.equal(root.find(node=>node.className==='vela-mission-jobs-done'),undefined);
 }finally{panel.dispose();}
});

test('completed typed replies expose one speak icon and stop only the same speech attempt without resending text',async()=>{
 const doc=new Document(),root=doc.createElement('main'),canonical=state(),spoken:unknown[]=[],stopped:string[]=[];let turns=0;
 const message={id:'message:reply',role:'assistant' as const,requestId:'request:synthetic',content:'Here is your answer.',source:'provider' as const,providerId:'openai-api-vela',classification:'reported' as const,responseKind:'answer' as const,providerContribution:{providerId:'openai-api-vela',classification:'reported' as const,executionId:'execution:synthetic'}};
 canonical.requests=[request({state:'responded',providerId:'openai-api-vela',response:{kind:'answer',messageId:message.id}})];canonical.conversation!.messages=[message];
 let listener:((value:{active:boolean;microphoneOn:boolean;speaking:boolean;speech?:{state:string;messageId:string|null;attemptId:string|null;contentDigest:string|null}})=>void)|undefined;
 const panel=mountVelaPanel(root as unknown as HTMLElement,clientFor(async()=>canonical,{request:async()=>{turns++;return request();}}),{
  voice:{element:doc.createElement('section') as unknown as HTMLElement,setVisible(){},start:async()=>{},speak:async value=>{spoken.push(value);listener?.({active:true,microphoneOn:false,speaking:true,speech:{state:'speaking',messageId:message.id,attemptId:'speech:exact',contentDigest:'a'.repeat(64)}});},stopSpeech:async id=>{stopped.push(id);},subscribe:fn=>{listener=fn;return ()=>{listener=undefined;};}}
 });
 await settles(()=>!!named(root,'Speak response'));assert.equal(spoken.length,0,'hydration never speaks automatically');
 named(root,'Speak response').fire('click');await settles(()=>!!named(root,'Stop speaking'));
 assert.deepEqual(spoken,[{id:message.id,content:message.content}]);named(root,'Stop speaking').fire('click');await settles(()=>stopped.length===1);
 assert.deepEqual(stopped,['speech:exact']);assert.equal(turns,0);assert.equal(canonical.conversation!.messages.length,1);
 listener?.({active:true,microphoneOn:false,speaking:true,speech:{state:'speaking',messageId:'message:other',attemptId:'speech:other',contentDigest:'b'.repeat(64)}});
 assert.ok(named(root,'Speak response'));assert.equal(named(root,'Stop speaking'),undefined,'another session cannot be stopped by this reply icon');panel.dispose();
});
test('current native success and partial mission primary footers expose speech without adding history speech or claiming unverified completion',async()=>{
 for(const kind of ['native','mission'] as const){const doc=new Document(),root=doc.createElement('main'),canonical=state(),spoken:unknown[]=[];const message:VelaMessage={id:'message:spoken-'+kind,role:'assistant',content:kind==='native'?'Created “Garden”.':'I collected the available evidence. The investigation remains incomplete.',source:'vela-native',classification:'observed'};
  if(kind==='native'){const plan:VelaPlan={id:'plan:spoken-native',requestId:'request:synthetic',version:1,fingerprint:'synthetic',summary:'Create workspace',steps:[{id:'create',explanation:'Create workspace',action:{type:'createWorkspace',title:'Garden',projectId:null}}],targets:[],scope:{principalId:'synthetic',policyVersion:'synthetic',resourceIds:[],projectIds:[],workspaceIds:[]},state:'applied',createdAt:manifest.createdAt,expiresAt:manifest.createdAt,contribution:null};message.requestId=plan.requestId;message.planId=plan.id;canonical.requests=[request({state:'completed',providerId:null,planId:plan.id})];canonical.plans=[plan];canonical.receipts=[{id:'receipt:spoken',planId:plan.id,requestId:plan.requestId,stepId:'create',commandId:'command:spoken',source:'vela',providerId:null,state:'applied',startedAt:manifest.createdAt,hostReceiptId:'host:spoken',taskVerified:false}];}
  else{message.responseKind='answer';message.missionReport={missionId:'mission:spoken',workspaceId:'workspace:spoken',projectId:null,jobsDone:1};}
  canonical.conversation!.messages=[message];const panel=mountVelaPanel(root as unknown as HTMLElement,clientFor(async()=>canonical),{voice:{element:doc.createElement('section') as unknown as HTMLElement,setVisible(){},start:async()=>{},speak:async value=>{spoken.push(value);}}});await settles(()=>!!named(root,'Speak response'));assert.equal(spoken.length,0);named(root,'Speak response').fire('click');await settles(()=>spoken.length===1);assert.deepEqual(spoken,[{id:message.id,content:message.content}]);
  canonical.presentation={...canonical.presentation!,version:2,view:'history'};await panel.refresh();assert.equal(named(root,'Speak response'),undefined,'history has no separate speech controls');canonical.presentation={...canonical.presentation!,version:3,view:'current'};await panel.refresh();assert(named(root,'Speak response'));
  if(kind==='native')canonical.receipts=[];else canonical.conversation!.messages=[];await panel.refresh();assert.equal(named(root,'Speak response'),undefined,'unconfirmed or out-of-scope primaries are not speakable');assert.equal(spoken.length,1);panel.dispose();
 }
});

test('voice remains behind its icon and typed talk starts once through the native port without a parallel text turn', async () => {
  const doc = new Document(), root = doc.createElement('main'), canonical = state(), calls: string[] = [], visibility: boolean[] = [];
  let textTurns = 0, release!: () => void;
  const started = new Promise<void>(resolve => { release = resolve; });
  const panel = mountVelaPanel(root as unknown as HTMLElement, clientFor(async () => canonical, { request: async () => { textTurns++; return request(); } }), {
    voice: { element: doc.createElement('section') as unknown as HTMLElement, setVisible: value => { visibility.push(value); }, start: async intent => { calls.push(intent!); await started; } },
  });
  await settles(() => !!named(root, 'Voice'));
  assert.equal(visibility.includes(true), false);
  const composer = root.find(node => node.tagName === 'textarea')!;
  composer.value = 'Let’s talk instead'; composer.fire('input'); composer.fire('keydown', { key: 'Enter' });
  assert.deepEqual(calls, ['Let’s talk instead']); assert.equal(textTurns, 0); assert.equal(visibility.at(-1), true);
  composer.value = 'Keep this newer draft'; composer.fire('input'); release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(composer.value, 'Keep this newer draft');
  panel.close(); assert.equal(visibility.at(-1), false); panel.dispose();
});

test('ordinary reviewed app changes use the same natural Yes or No surface and retain exact native approval', async () => {
  const doc = new Document(), root = doc.createElement('main'), canonical = state(), reviews: unknown[] = [], applies: string[] = [];
  const plan: VelaPlan = {id:'plan:natural',requestId:'request:synthetic',version:1,fingerprint:'exact:native:fingerprint',summary:'Create the requested workspace',
    steps:[{id:'create',explanation:'Create the workspace',action:{type:'createWorkspace',title:'Garden',projectId:null}}],targets:[],
    scope:{principalId:'synthetic',policyVersion:'synthetic',resourceIds:[],projectIds:[],workspaceIds:[]},state:'prepared',createdAt:manifest.createdAt,expiresAt:manifest.createdAt,contribution:null};
  canonical.requests=[request({state:'awaiting-review',planId:plan.id})];canonical.plans=[plan];
  const panel=mountVelaPanel(root as unknown as HTMLElement,clientFor(async()=>canonical,{
    review:async input=>{reviews.push(input);plan.state=input.decision==='approve'?'approved':'rejected';return plan;},
    apply:async id=>{applies.push(id);plan.state='applied';return plan;},
  }));
  await settles(()=>!!named(root,'Yes, do that'));
  assert.ok(displayed(named(root,'Yes, do that'))); assert.ok(displayed(named(root,'No')));
  assert.equal(displayed(root.find(node=>node.dataset.planId===plan.id)!),false);
  named(root,'Yes, do that').fire('click');await settles(()=>applies.length===1);
  assert.deepEqual(reviews,[{planId:plan.id,fingerprint:plan.fingerprint,decision:'approve'}]);assert.deepEqual(applies,[plan.id]);
  assert.equal(root.find(node=>node.className==='vela-mission-jobs-done'),undefined,'Missing effect receipts cannot produce a success pill');panel.dispose();
});

test('dedicated file icon selects a whole folder once for the next message without sending it automatically',async()=>{
  const doc=new Document(),root=doc.createElement('main'),canonical=state(),picks:unknown[]=[],turns:{resourceIds:string[];resourceRefs?:unknown[]}[]=[];
  const panel=mountVelaPanel(root as unknown as HTMLElement,clientFor(async()=>canonical,{
    pickSources:async input=>{picks.push(input);return {resources:[{id:'folder:one',kind:'folder',title:'Project docs',version:2,projectId:null}]};},
    request:async input=>{turns.push(input);return request();},
  }));
  await settles(()=>!!named(root,'Add files or folders'));named(root,'Add files or folders').fire('click');named(root,'Choose a folder…').fire('click');
  await settles(()=>!!named(root,'Project docs ×'));assert.deepEqual(picks,[{kind:'folder',destination:'context'}]);assert.equal(turns.length,0);
  const composer=root.find(node=>node.tagName==='textarea')!;composer.value='Look at these sources';composer.fire('input');composer.fire('keydown',{key:'Enter'});
  await settles(()=>turns.length===1);assert.deepEqual(turns[0].resourceIds,['folder:one']);assert.deepEqual(turns[0].resourceRefs,[{id:'folder:one',kind:'resource',resourceKind:'folder',title:'Project docs',version:2,projectId:null}]);panel.dispose();
});

test('ordinary investigations reach the canonical intelligence request without a pre-model mission classifier', async () => {
  const doc = new Document(), root = doc.createElement('main'), canonical = state(), previews: string[] = [], turns: string[] = [];
  const panel = mountVelaPanel(root as unknown as HTMLElement, clientFor(async () => canonical, { request: async input => { turns.push(input.intent); return request(); } }), {
    missions: { element: doc.createElement('section') as unknown as HTMLElement, preview: async intent => { previews.push(intent); return null; }, review() { throw Error('No mission was proposed'); }, setVisible() {} },
  });
  await settles(() => !!named(root, 'Send to Vela'));
  const composer = root.find(node => node.tagName === 'textarea')!;
  composer.value = 'Can you investigate why the Minecraft server is lagging?'; composer.fire('input'); composer.fire('keydown', { key: 'Enter' });
  await settles(() => turns.length === 1 && root.find(node => node.className === 'vela-core-status')!.dataset.requestState !== 'submitting');
  assert.deepEqual(previews, []);
  composer.value = 'Hello Vela'; composer.fire('input'); composer.fire('keydown', { key: 'Enter' });
  await settles(() => turns.length === 2 && root.find(node => node.className === 'vela-core-status')!.dataset.requestState !== 'submitting'); assert.equal(previews.length, 0);
  const unfamiliar='My computer feels like it is wading through mud; work out what is going on.';
  composer.value=unfamiliar;composer.fire('input');composer.fire('keydown',{key:'Enter'});
  await settles(()=>turns.length===3);assert.deepEqual(previews,[]);assert.equal(turns[2],unfamiliar);panel.dispose();
});

test('an explicit mission request opens canonical review without sending an ordinary turn', async () => {
  const doc = new Document(), root = doc.createElement('main'), canonical = state();
  const previews: string[] = [], reports: string[] = [];
  const scope = { workspaceId: 'workspace:synthetic', projectId: null };
  const offer = { kind: 'planning-offer' as const, scope, objective: 'Synthetic mission', fingerprint: 'preview:synthetic' };
  let started: ((id: string) => void) | undefined;
  let available = true, ordinary = 0;
  const panel = mountVelaPanel(root as unknown as HTMLElement, clientFor(async () => canonical, {
    request: async () => { ordinary++; return request(); },
  }), { missions: {
    element: doc.createElement('section') as unknown as HTMLElement,
    preview: async intent => { previews.push(intent); return available ? offer : null; },
    review: (preview, onStarted) => { assert.equal(preview, offer); started = onStarted; },
    openReport: id => { reports.push(id); }, setVisible() {},
  } });
  await settles(() => !!named(root, 'Send to Vela'));
  const composer = root.find(node => node.tagName === 'textarea')!;
  const objective = 'Run a mission to measure CPU and RAM';
  composer.value = objective; composer.fire('input'); composer.fire('keydown', { key: 'Enter' });
  await settles(() => !!started);
  assert.deepEqual(previews, [objective]);
  assert.equal(ordinary, 0);
  assert.equal(composer.value, objective);
  started!('mission:verified');
  assert.deepEqual(reports, ['mission:verified']);
  assert.equal(composer.value, '');
  available = false;
  composer.value = objective; composer.fire('input'); composer.fire('keydown', { key: 'Enter' });
  await settles(() => root.find(node => node.className === 'vela-core-error')!.textContent.includes('mission workspace'));
  assert.equal(ordinary, 0);
  assert.equal(composer.value, objective);
  panel.dispose();
});

test('saved routing controls show origins, preserve preferences when editing limits and offer one-send Auto', async () => {
  const doc = new Document(), root = doc.createElement('main'), canonical = state();
  canonical.planningProviders = [{ providerId: 'chatgpt-plan-responses', available: true }];
  canonical.routingSettings = {
    profiles: [{ scope: 'global', id: null, version: 2, defaults: { providerId: 'chatgpt-plan-responses' } }],
    effective: { mode: 'auto', providerId: 'chatgpt-plan-responses' }, origins: { mode: 'default', providerId: 'global' },
  };
  const changes: Parameters<NonNullable<VelaClient['saveRoutingSettings']>>[0][] = [];
  const turns: Parameters<VelaClient['request']>[0][] = [];
  const client = clientFor(async () => canonical, {
    saveRoutingSettings: async change => {
      changes.push(change);
      const profile = { scope: change.scope, id: change.id, version: change.expectedVersion + 1, defaults: change.defaults };
      canonical.routingSettings!.profiles = [profile];
      return profile;
    },
    request: async input => { turns.push(input); return request(); },
  });
  const panel = mountVelaPanel(root as unknown as HTMLElement, client);
  await settles(() => root.textContent.includes('Provider ChatGPT plan (global)'));
  const limit = root.find(node => node.tagName === 'label' && node.textContent === 'All provider attempts')!.children[1];
  limit.value = '3';
  named(root, 'Save attempt limits').fire('click');
  await settles(() => changes.length === 1);
  assert.deepEqual(changes[0], { scope: 'global', id: null, expectedVersion: 2,
    defaults: { providerId: 'chatgpt-plan-responses', attemptLimits: { total: 3 } } });
  const composer = root.find(node => node.tagName === 'textarea')!;
  named(root, 'Provider').fire('click');
  named(root, 'Automatic').fire('click');
  composer.value = 'First request';
  composer.fire('input');
  composer.fire('keydown', { key: 'Enter' });
  await settles(() => turns.length === 1 && root.find(node => node.className === 'vela-core-status')?.dataset.requestState !== 'submitting');
  assert.equal(turns[0].overrideDefaults, true);
  composer.value = 'Second request';
  composer.fire('input');
  composer.fire('keydown', { key: 'Enter' });
  await settles(() => turns.length === 2);
  assert.equal(turns[1].overrideDefaults, undefined);
  panel.dispose();
});

test('ordinary sends use runtime history by default and Start fresh applies to one send', async () => {
  const doc=new Document(),root=doc.createElement('main'),canonical=state();
  canonical.planningProviders=[{providerId:'chatgpt-plan-responses',available:true}];
  const turns:Parameters<VelaClient['request']>[0][]=[];
  const panel=mountVelaPanel(root as unknown as HTMLElement,clientFor(async()=>canonical,{
    request:async input=>{turns.push(input);return request({state:'responded'});},
  }));
  await settles(()=>!!root.find(node=>node.tagName==='label'&&node.textContent==='Start fresh for this send'));
  const fresh=root.find(node=>node.tagName==='label'&&node.textContent==='Start fresh for this send')!.children[1];
  const composer=root.find(node=>node.tagName==='textarea')!;
  for(const [index,startFresh]of [false,true,false].entries()){
    fresh.checked=startFresh;composer.value='Synthetic continuity turn '+index;composer.fire('input');composer.fire('keydown',{key:'Enter'});
    await settles(()=>turns.length===index+1&&root.find(node=>node.className==='vela-core-status')?.dataset.requestState!=='submitting');
    assert.equal(turns[index].includeRecentHistory,startFresh?false:undefined);assert.equal(fresh.checked,false);
  }
  panel.dispose();
});

test('continuing an answer selects one exchange and preserves that selection after cancelling review', async () => {
  const doc = new Document(), root = doc.createElement('main'), canonical = state();
  const source = request({ id: '11111111-1111-4111-8111-111111111111', state: 'responded',
    providerId: 'chatgpt-plan-responses', response: { kind: 'answer', messageId: 'synthetic:answer' },
    provenance: { schemaVersion: 1, dependencies: [], digest: 'a'.repeat(64) } });
  canonical.requests = [source];
  canonical.conversation!.messages = [{ id: source.response!.messageId, requestId: source.id, role: 'assistant',
    content: 'Synthetic earlier answer', source: 'provider', classification: 'reported', responseKind: 'answer',
    providerId: source.providerId!, providerContribution: { providerId: source.providerId!, classification: 'reported', executionId: 'synthetic:execution' } }];
  canonical.planningProviders = [{ providerId: 'chatgpt-plan-responses', available: true }, { providerId: 'codex-app-server', available: false }];
  const turns: Parameters<VelaClient['request']>[0][] = [];
  const panel = mountVelaPanel(root as unknown as HTMLElement, clientFor(async () => canonical, {
    request: async input => { turns.push(input); throw Error('authorization_cancelled'); },
  }));
  await settles(() => !!named(root, 'Continue with Codex'));
  named(root, 'Continue with Codex').fire('click');
  assert.equal(turns.length, 0);
  assert.equal(displayed(named(root, 'Remove selected provider exchange')), true);
  const composer = root.find(node => node.tagName === 'textarea')!;
  composer.value = 'Inspect this finding in the repository.';
  composer.fire('input');
  composer.fire('keydown', { key: 'Enter' });
  await settles(() => turns.length === 1 && root.textContent.includes('Your draft is still here.'));
  assert.equal(turns[0].providerId, 'codex-app-server');
  assert.equal(turns[0].handoffSourceRequestId, source.id);
  assert.equal(turns[0].includeRecentHistory, undefined);
  assert.equal(composer.value, turns[0].intent);
  named(root, 'Remove selected provider exchange').fire('click');
  assert.equal(named(root, 'Remove selected provider exchange'), undefined);
  panel.dispose();
});

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
  assert.equal(composer.value, 'Synthetic request');
  const terminal = status.textContent; await panel.refresh(); await panel.refresh(); assert.equal(status.textContent, terminal); assert.doesNotMatch(status.textContent, /^Ready|Request:/);
  named(root, 'Provider').fire('click'); assert.equal(displayed(named(root, 'Check connection')), true); named(root, 'Check connection').fire('click');
  await settles(() => connections === 1 && root.find(node => node.className === 'vela-core-provider')!.textContent.includes('· available'));
  assert.equal(status.dataset.requestState, 'provider-unavailable'); assert.equal(status.textContent, terminal, 'connecting does not rewrite a historical request outcome');
  client.request = async () => { throw new Error('vela_planner_unavailable'); };
  composer.value = 'Can you organize my workspace?'; composer.fire('input');
  form.fire('submit'); await settles(() => root.find(node => node.className === 'vela-core-error')!.textContent.includes('couldn’t reach the AI'));
  assert.equal(composer.value, 'Can you organize my workspace?');
  client.request = async () => { canonical = { ...canonical, requests: [request({ state: 'unknown' })] }; throw new Error('Synthetic lost command response'); };
  composer.value = 'Synthetic retry request'; composer.fire('input');
  form.fire('submit'); await settles(() => status.dataset.actionState === 'failed' && status.dataset.requestState === 'unknown');
  await panel.refresh(); assert.match(status.textContent, /outcome is unknown/); assert.equal(status.dataset.actionState, undefined);
  panel.dispose(); assert.equal(root.children.length, 0);
});

test('workspace evidence is an explicit dedicated API composer choice', async () => {
  const doc = new Document(), root = doc.createElement('main'), canonical = state();
  canonical.planningProviders = [{ providerId: 'openai-api-vela', available: true }];
  canonical.applicationContext = { currentProjectId: null, currentWorkspaceId: 'workspace:synthetic', references: [] };
  const turns: Parameters<VelaClient['request']>[0][] = [];
  const panel = mountVelaPanel(root as unknown as HTMLElement, clientFor(async () => canonical, {
    request: async input => { turns.push(input); throw Error('authorization_cancelled'); },
  }));
  try {
    await settles(() => !!named(root, 'Vela API'));
    await panel.refresh();
    const option = root.find(node => node.tagName === 'label' && node.textContent === 'Review current workspace state')!.querySelector('input')!;
    assert.equal(option.disabled, true);
    named(root, 'Vela API').fire('click');
    assert.equal(option.disabled, false);
    assert.equal(option.checked, false);
    option.checked = true;
    const composer = root.find(node => node.tagName === 'textarea')!;
    composer.value = 'Which placed material supports a release?';
    composer.fire('input');
    composer.fire('keydown', { key: 'Enter' });
    await settles(() => turns.length === 1);
    assert.equal(turns[0].semanticContext, true);
    assert.equal(turns[0].workspaceState, true);
    assert.equal(turns[0].providerId, 'openai-api-vela');
    assert.deepEqual(turns[0].resourceIds, []);
    assert.equal(option.checked, false);
  } finally { panel.dispose(); }
});

test('selecting a prior exchange uses reviewed evidence even when Vela API answered it', async () => {
  const doc = new Document(), root = doc.createElement('main'), canonical = state();
  const source = request({ id: '11111111-1111-4111-8111-111111111111', state: 'responded', providerId: 'openai-api-vela',
    response: { kind: 'answer', messageId: 'synthetic:earlier' }, provenance: { schemaVersion: 1, dependencies: [], digest: 'a'.repeat(64) } });
  canonical.requests = [source];
  canonical.conversation!.messages = [{ id: source.response!.messageId, requestId: source.id, role: 'assistant', content: 'Earlier schedule.',
    source: 'provider', classification: 'reported', responseKind: 'answer', providerId: source.providerId!,
    providerContribution: { providerId: source.providerId!, classification: 'reported', executionId: 'synthetic:execution' } }];
  canonical.planningProviders = [{ providerId: 'openai-api-vela', available: true }];
  const turns: Parameters<VelaClient['request']>[0][] = [];
  const panel = mountVelaPanel(root as unknown as HTMLElement, clientFor(async () => canonical, {
    request: async input => { turns.push(input); throw Error('authorization_cancelled'); },
  }));
  try {
    await settles(() => named(root, 'Use this exchange as evidence')?.hidden === false);
    named(root, 'Use this exchange as evidence').fire('click');
    assert.equal(turns.length, 0);
    const composer = root.find(node => node.tagName === 'textarea')!;
    composer.value = 'What did we agree earlier?';
    composer.fire('input');
    composer.fire('keydown', { key: 'Enter' });
    await settles(() => turns.length === 1);
    assert.equal(turns[0].semanticContext, true);
    assert.equal(turns[0].handoffSourceRequestId, source.id);
    assert.equal(turns[0].providerId, 'openai-api-vela');
  } finally { panel.dispose(); }
});

test('a timed-out API reply stays unknown with concise visible text and no fabricated completion', async () => {
  const doc = new Document(), root = doc.createElement('main'), canonical = state();
  canonical.requests = [request({state:'unknown',errorCode:'provider_timeout',providerId:'openai-api-vela',
    route:{kind:'conversational',depth:'quick',reason:'routine-answer',model:'gpt-6-luna'}})];
  const before=structuredClone(canonical);
  const panel=mountVelaPanel(root as unknown as HTMLElement,clientFor(async()=>canonical));
  await settles(()=>root.find(node=>node.className==='vela-core-status')!.dataset.requestState==='unknown');
  assert.equal(root.find(node=>node.className==='vela-core-status')!.textContent,'That reply timed out.');
  assert.equal(root.find(node=>node.className==='vela-manifestation-kicker')!.hidden,true,'routing metadata stays behind details even when a reply fails');
  assert.equal(root.find(node=>node.className==='vela-mission-jobs-done'),undefined);
  assert.deepEqual(canonical,before,'presentation cannot rewrite the durable unknown request');
  panel.dispose();
  for(const patch of [{planId:'unresolved-plan'},{route:{kind:'app-planning',reason:'reviewed-app-action'}},
    {errorCode:'provider_transport_unavailable'},{providerId:'codex-app-server'}] as Partial<VelaRequest>[]){
    canonical.requests=[{...before.requests[0],...patch}];
    assert.match(velaPanelStatus(canonical).message,/outcome is unknown/);
  }
  canonical.requests=before.requests;
  canonical.receipts=[{id:'receipt:prior',requestId:before.requests[0].id,planId:'plan:prior',stepId:'step:prior',
    commandId:'command:prior',source:'vela',providerId:'synthetic',state:'applied',startedAt:manifest.createdAt,hostReceiptId:'host:prior',taskVerified:false}];
  assert.match(velaPanelStatus(canonical).message,/outcome is unknown/,'effect-bearing requests retain the cautious outcome message');
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

test('model-selected search renders an openable canonical result and removes it when scope changes', async () => {
  const doc = new Document(), root = doc.createElement('main'), canonical = state();
  const plan: VelaPlan = {
    id: 'plan:search', requestId: 'request:synthetic', version: 1, fingerprint: 'synthetic',
    summary: 'Find measurements', steps: [{ id: 'search', explanation: 'Local lookup', action: { type: 'search', query: 'calibration' } }],
    targets: [], scope: { principalId: 'synthetic', policyVersion: 'synthetic', resourceIds: [], workspaceIds: [], projectIds: [] },
    state: 'applied', createdAt: manifest.createdAt, expiresAt: manifest.createdAt,
    contribution: { providerId: 'codex-app-server', classification: 'reported' },
  };
  const receipt: ActionReceipt = {
    id: 'receipt:search', planId: plan.id, requestId: plan.requestId, stepId: 'search', commandId: 'command:search',
    source: 'vela', providerId: null, state: 'applied', startedAt: manifest.createdAt, hostReceiptId: 'host:search', taskVerified: false,
  };
  const ref = { id: 'note:calibration', kind: 'resource' as const, title: 'Calibration measurements', version: 1 };
  canonical.requests = [request({ state: 'completed', planId: plan.id, providerId: 'codex-app-server' })];
  canonical.plans = [plan]; canonical.receipts = [receipt];
  canonical.conversation = { resourceId: canonical.requests[0].conversationId, revision: 2, messages: [] };
  canonical.searchResults = { [receipt.id]: [ref] };
  const opened: unknown[] = [];
  const panel = mountVelaPanel(root as unknown as HTMLElement, clientFor(async () => canonical), { onOpenSubject: value => opened.push(value) });
  await settles(() => !!named(root, ref.title)); named(root, 'Open response details').fire('click');
  assert.equal(displayed(named(root, ref.title)), true);
  named(root, ref.title).fire('click');
  assert.deepEqual(opened, [ref]);
  canonical.searchResults = { [receipt.id]: [] };
  await panel.refresh();
  assert.equal(named(root, ref.title), undefined);
  assert.match(root.textContent, /No matching resources are available/);
  panel.dispose();
});

test('a model-selected local observation is visible on the completed action', async () => {
  const doc = new Document(), root = doc.createElement('main'), canonical = state();
  const plan: VelaPlan = {
    id: 'plan:clock', requestId: 'request:synthetic', version: 1, fingerprint: 'synthetic',
    summary: 'Read the device clock', steps: [{ id: 'clock', explanation: 'Live device reading', action: { type: 'readLocalFact', capabilityId: 'local.time' } }],
    targets: [], scope: { principalId: 'synthetic', policyVersion: 'synthetic', resourceIds: [], workspaceIds: [], projectIds: [] },
    state: 'applied', createdAt: manifest.createdAt, expiresAt: manifest.createdAt,
    contribution: { providerId: 'codex-app-server', classification: 'reported' },
  };
  canonical.requests = [request({ state: 'completed', planId: plan.id, providerId: 'codex-app-server' })];
  canonical.plans = [plan];
  canonical.conversation = { resourceId: canonical.requests[0].conversationId, revision: 2, messages: [
    { id: 'observed:clock', role: 'assistant', content: 'It is 12:00 AM.', source: 'vela-native', classification: 'observed', requestId: plan.requestId, planId: plan.id },
  ] };
  const panel = mountVelaPanel(root as unknown as HTMLElement, clientFor(async () => canonical));
  await settles(() => !!root.find(node => node.className === 'vela-manifestation-value' && node.textContent === 'It is 12:00 AM.'));
  named(root, 'Open response details').fire('click');
  assert(displayed(root.find(node => node.className === 'vela-manifestation-value' && node.textContent === 'It is 12:00 AM.')!));
  assert.equal(named(root, 'Approve and apply'), undefined);
  panel.dispose();
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
  assert.equal(root.find(node => node.dataset.messageId === 'message:you'), user); assert.equal(root.find(node => node.dataset.messageId === 'message:provider'), provider); assert.equal(user.children[1].textContent, 'Exact canonical user text'); assert.equal(provider.children[0].textContent, 'Vela'); assert.equal(canonical.conversation.messages[1].providerId, 'codex-app-server'); panel.dispose();
});

test('plan icon opens consequential effects and JSON with explicit review before exact apply', async () => {
  const doc = new Document(), root = doc.createElement('main'), canonical = state(), calls: unknown[] = [];
  const plan: VelaPlan = { id: 'plan:edit', requestId: 'request:synthetic', version: 1, fingerprint: 'exact:reviewed-fingerprint', summary: 'Update the research note', steps: [{ id: 'edit', explanation: 'Replace this note only', action: { type: 'content', resourceId: 'note:one', expectedVersion: 7, content: 'Exact replacement text' } }], targets: [{ id: 'note:one', kind: 'resource', title: 'Research note', version: 7 }], scope: { principalId: 'synthetic', policyVersion: 'policy:synthetic', resourceIds: ['note:one'], projectIds: [], workspaceIds: [] }, state: 'prepared', createdAt: manifest.createdAt, expiresAt: manifest.createdAt, contribution: { providerId: 'codex-app-server', classification: 'reported' } };
  canonical.plans = [plan]; canonical.requests = [request({ state: 'awaiting-review', planId: plan.id })];
  const panel = mountVelaPanel(root as unknown as HTMLElement, clientFor(async () => canonical, { review: async input => { calls.push(input); plan.state = 'approved'; return plan; }, apply: async id => { calls.push(id); plan.state = 'applied'; canonical.requests[0].state = 'completed'; canonical.receipts = [{ id: 'receipt:actual-port-fixture', planId: plan.id, requestId: plan.requestId, stepId: 'edit', commandId: 'command:fixture', source: 'vela', providerId: null, state: 'applied', startedAt: manifest.createdAt, hostReceiptId: 'host:fixture', taskVerified: false }]; return plan; } }));
  await settles(() => !!root.find(node => node.dataset.planId === plan.id));
  assert.equal(displayed(root.find(node => node.dataset.planId === plan.id)!), false);
  named(root, 'Open response details').fire('click'); assert.equal(calls.length, 0); const preview = root.find(node => node.className === 'vela-core-change-preview')!; assert.equal(preview.textContent, 'Exact replacement text'); assert.equal(displayed(preview), true);
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
  canonical.plans = [{ ...structuredClone(plan), id: 'plan:earlier', requestId: 'request:earlier', state: 'applied' }, plan]; canonical.requests = [request({ state: 'completed', id: 'request:earlier', planId: 'plan:earlier' }), request({ state: 'awaiting-review', planId: plan.id })];
  const panel = mountVelaPanel(root as unknown as HTMLElement, clientFor(async () => structuredClone(canonical), {
    review: async () => { reviews++; await new Promise<void>(resolve => { finishReview = resolve; }); plan.state = 'approved'; return structuredClone(plan); },
    apply: async () => { applies++; plan.state = 'applied'; canonical.requests[1].state = 'completed'; return structuredClone(plan); },
  }));
  await settles(() => !!root.find(node => node.dataset.planId === plan.id));
  assert.equal(displayed(root.find(node => node.dataset.planId === plan.id)!), false);
  named(root, 'Open response details').fire('click');
  const currentCard = root.find(node => node.dataset.planId === plan.id)!, earlierCard = root.find(node => node.dataset.planId === 'plan:earlier')!, history = root.find(node => node.className === 'vela-core-plan-history')!;
  const evidence = currentCard.find(node => node.className === 'vela-core-plan-details')!, earlierEvidence = earlierCard.find(node => node.className === 'vela-core-plan-details')!, approve = named(currentCard, 'Approve and apply');
  named(root, 'History').fire('click'); assert.equal(displayed(approve), true, 'The required action remains visible while invoked history is read');
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

function localOutcome(intent: string, commandId: string): Extract<VelaLocalDispatch, { matched: true }> {
  const record = { schemaVersion: 1 as const, commandId, capabilityId: 'local.time' as const, classification: 'observed' as const, providerId: null, observedAt: manifest.createdAt, facts: { kind: 'time' as const, epochMs: Date.parse(manifest.createdAt), utc: manifest.createdAt, timeZone: 'UTC', locale: 'en-US', utcOffsetMinutes: 0, calendarDate: '2026-11-02', formatted: '12:00 AM' } };
  return { matched: true, request: request({ id: 'request:clock', intent, providerId: null, state: 'responded', local: record, response: { kind: 'answer', messageId: 'message:clock' } }), result: { ...record, messageId: 'message:clock', content: 'It is 12:00 AM (UTC).', replayed: false, timing: { classificationMs: 1, capabilityMs: 1, persistenceMs: 1, totalMs: 3 } } };
}
function retainLocal(canonical: VelaState, value: Extract<VelaLocalDispatch, { matched: true }>) {
  canonical.requests.push(value.request); canonical.conversation = { resourceId: value.request.conversationId, revision: (canonical.conversation?.revision ?? 1) + 2, messages: [...(canonical.conversation?.messages ?? []), { id: 'message:input:' + value.request.id, role: 'user', content: value.request.intent, source: 'user', classification: 'observed', requestId: value.request.id }, { id: value.result.messageId, role: 'assistant', content: value.result.content, source: 'vela-native', classification: 'observed', requestId: value.request.id, responseKind: 'answer' }] };
}

test('a failed weather plan stays behind details and a new native answer replaces its primary failure', async () => {
  const doc = new Document(), root = doc.createElement('main'), canonical = state();
  const plan: VelaPlan = { id: 'plan:old-weather', requestId: 'request:synthetic', version: 1, fingerprint: 'synthetic',
    summary: 'Check the local forecast for later today.', steps: [{ id: 'weather', explanation: 'Old weather flow', action: { type: 'readWeather', period: 'today' } }],
    targets: [], scope: { principalId: 'synthetic', policyVersion: 'synthetic', resourceIds: [], projectIds: [], workspaceIds: [] },
    state: 'failed', createdAt: manifest.createdAt, expiresAt: manifest.createdAt, contribution: null };
  canonical.requests = [request({ state: 'failed', providerId: null, planId: plan.id })]; canonical.plans = [plan];
  canonical.conversation!.messages = [{ id: 'old:failure', requestId: plan.requestId, planId: plan.id, role: 'assistant', source: 'vela-native', classification: 'observed',
    content: 'Windows did not provide a current location. Check Location services and desktop app access in Windows Settings.' }];
  const panel = mountVelaPanel(root as unknown as HTMLElement, clientFor(async () => canonical));
  await settles(() => !!root.find(node => node.dataset.planId === plan.id));
  assert.equal(displayed(root.find(node => node.dataset.planId === plan.id)!), false);
  assert.equal(root.find(node => node.className === 'vela-manifestation-content')!.textContent.includes('Windows did not provide'), false);
  const local = localOutcome('What’s the weather?', 'synthetic:weather'); local.result.content = 'Location is off for weather. Change it in Vela preferences.';
  delete local.request.local; local.request.nativeResponse = {schemaVersion:1,classification:'observed'};
  retainLocal(canonical, local); await panel.refresh();
  const body = root.find(node => node.className === 'vela-manifestation-content')!;
  assert.ok(body.textContent.startsWith(local.result.content)); assert.equal(body.textContent.includes('Check the local forecast'), false);
  assert.equal(displayed(root.find(node => node.dataset.planId === plan.id)!), false);
  panel.dispose();
});


test('pin/dismiss/reopen/history use durable CAS only; same-state refresh preserves response/editor/focus and reopening uses canonical identity', async () => {
  const doc = new Document(), root = doc.createElement('main'), canonical = state(), calls: unknown[] = []; const local = localOutcome('Synthetic saved clock question', 'synthetic:command'); retainLocal(canonical, local);
  const client = clientFor(async () => structuredClone(canonical), { presentation: async input => { calls.push(structuredClone(input)); assert.equal(input.expectedVersion, canonical.presentation!.version); canonical.presentation = { ...canonical.presentation!, ...input.patch, version: canonical.presentation!.version + 1 }; return structuredClone(canonical.presentation); } });
  const panel = mountVelaPanel(root as unknown as HTMLElement, client); await settles(() => root.find(node => node.className === 'vela-core')!.dataset.manifestationKind === 'whisper');
  const editor = root.find(node => node.tagName === 'textarea')!, value = root.find(node => node.className === 'vela-manifestation-value')!, details = root.find(node => node.className === 'vela-core-response-details')!; details.open = true; details.children[0].focus(); editor.value = 'Unsent draft'; editor.selectionStart = 2; editor.selectionEnd = 5;
  await panel.refresh(); assert.equal(root.find(node => node.className === 'vela-manifestation-value'), value); assert.equal(details.open, true); assert.equal(doc.activeElement, details.children[0]);
  named(root, 'Pin response').fire('click'); await settles(() => canonical.presentation!.version === 2 && named(root, 'Unpin response')?.disabled === false); assert.deepEqual(canonical.presentation!.pinnedRequestIds, [local.request.id]);
  named(root, 'Dismiss response').fire('click'); await settles(() => root.find(node => node.className === 'vela-core')!.dataset.manifestationKind === 'none'); assert.equal(canonical.conversation!.messages.length, 2);
  named(root, 'History').fire('click'); await settles(() => root.find(node => node.className === 'vela-core-history')!.hidden === false && named(root, 'Reopen response').disabled === false); assert.equal(displayed(root.find(node => node.dataset.messageId === local.result.messageId)!), true);
  named(root, 'Reopen response').fire('click'); await settles(() => root.find(node => node.className === 'vela-core')!.dataset.manifestationKind === 'whisper' && root.find(node => node.className === 'vela-core-history')!.hidden === true); assert.equal(canonical.presentation!.selectedRequestId, local.request.id); assert.deepEqual(canonical.presentation!.dismissedRequestIds, []); assert.equal(root.find(node => node.tagName === 'textarea'), editor); assert.equal(editor.value, 'Unsent draft'); assert.equal(editor.selectionStart, 2); assert.equal(editor.selectionEnd, 5);
  const saved = structuredClone(canonical.presentation), writes = calls.length; panel.dispose(); const reopened = mountVelaPanel(root as unknown as HTMLElement, client); await settles(() => root.find(node => node.className === 'vela-core')!.dataset.manifestationKind === 'whisper'); assert.deepEqual(canonical.presentation, saved); assert.equal(calls.length, writes); reopened.dispose();
});

test('free text takes the same request path and provider consent is one-shot', async () => {
  const doc = new Document(), root = doc.createElement('main'), canonical = state();
  canonical.planner = { providerId: 'codex-app-server', available: true, busy: false };
  const requests: Parameters<VelaClient['request']>[0][] = [];
  const client = clientFor(async () => canonical, { request: async input => { requests.push(input); return request({ state: 'responded' }); } });
  const panel = mountVelaPanel(root as unknown as HTMLElement, client);
  await settles(() => root.find(node => node.className === 'vela-core-status')!.dataset.requestState === 'idle');
  const editor = root.find(node => node.tagName === 'textarea')!, consent = root.find(node => node.tagName === 'input' && !!node.parent?.className.includes('vela-core-consent'))!;
  consent.checked = true; consent.fire('change');
  for (const intent of ['What time is it?', 'Can you organize my workspace?']) {
    editor.value = intent; editor.fire('input'); editor.fire('keydown', { key: 'Enter' });
    await settles(() => !editor.value && root.find(node => node.className === 'vela-core-compose')!.getAttribute('aria-busy') === 'false');
  }
  assert.deepEqual(requests, [
    { intent: 'What time is it?', resourceIds: [], authorizeProvider: true },
    { intent: 'Can you organize my workspace?', resourceIds: [], authorizeProvider: false },
  ]);
  assert.equal(consent.checked, false); panel.dispose();
});

test('protected Action remains discoverable behind its icon and cannot be dismissed in History', async () => {
  const doc = new Document(), root = doc.createElement('main'), canonical = state(); let reviews = 0, applies = 0;
  const plan: VelaPlan = { id: 'plan:protected', requestId: 'request:synthetic', version: 1, fingerprint: 'synthetic:protected', summary: 'Actual typed proposal fixture', steps: [{ id: 'one', explanation: 'Synthetic review only', action: { type: 'createProject', title: 'Synthetic project' } }], targets: [], scope: { principalId: 'synthetic', policyVersion: manifest.policyVersion, resourceIds: [], workspaceIds: [], projectIds: [] }, state: 'prepared', createdAt: manifest.createdAt, expiresAt: manifest.createdAt, contribution: null };
  canonical.plans = [plan]; canonical.requests = [request({ state: 'awaiting-review', planId: plan.id })];
  const panel = mountVelaPanel(root as unknown as HTMLElement, clientFor(async () => structuredClone(canonical), {
    request: async input => { const value = localOutcome(input.intent, 'synthetic:observed'); retainLocal(canonical, value); return value.request; },
    presentation: async input => { canonical.presentation = { ...canonical.presentation!, ...input.patch, version: canonical.presentation!.version + 1 }; return canonical.presentation; },
    review: async () => { reviews++; return plan; }, apply: async () => { applies++; return plan; },
  }));
  await settles(() => root.find(node => node.className === 'vela-core')!.dataset.manifestationKind === 'action'); const approve = named(root, 'Approve and apply'); assert.equal(named(root, 'Dismiss response').disabled, true);
  const editor = root.find(node => node.tagName === 'textarea')!; editor.value = 'What time is it?'; editor.fire('input'); editor.fire('keydown', { key: 'Enter' });
  await settles(() => root.find(node => node.getAttribute('aria-label') === 'Latest local response')!.textContent.includes('12:00 AM')); await panel.refresh();
  assert.equal(root.find(node => node.className === 'vela-core')!.dataset.manifestationKind, 'action'); assert.equal(displayed(approve), false); assert.equal(named(root, 'Dismiss response').disabled, true);
  named(root, 'Open response details').fire('click'); assert.equal(displayed(approve), true);
  named(root, 'History').fire('click'); await settles(() => root.find(node => node.className === 'vela-core-history')!.hidden === false); assert.equal(displayed(approve), true); assert.equal(named(root, 'Approve and apply'), approve); assert.equal(reviews, 0); assert.equal(applies, 0); panel.dispose();
});

test('a stale presentation write does not fake persistence or retry; draft/caret and canonical response remain intact', async () => {
  const doc = new Document(), root = doc.createElement('main'), canonical = state(); let writes = 0; retainLocal(canonical, localOutcome('Saved synthetic clock', 'synthetic:command'));
  const panel = mountVelaPanel(root as unknown as HTMLElement, clientFor(async () => structuredClone(canonical), { presentation: async () => { writes++; canonical.presentation!.version = 2; throw Error('stale_presentation_version'); } }));
  await settles(() => !named(root, 'Pin response').disabled); const editor = root.find(node => node.tagName === 'textarea')!; editor.value = 'Later draft'; editor.selectionStart = 2; editor.selectionEnd = 5; named(root, 'Pin response').fire('click');
  await settles(() => root.find(node => node.className === 'vela-core-error')!.hidden === false); assert.equal(writes, 1); assert.deepEqual(canonical.presentation!.pinnedRequestIds, []); assert.equal(named(root, 'Pin response').getAttribute('aria-pressed'), 'false'); assert.equal(editor.value, 'Later draft'); assert.equal(editor.selectionStart, 2); assert.equal(editor.selectionEnd, 5); assert.equal(root.find(node => node.className === 'vela-core')!.dataset.manifestationKind, 'whisper'); panel.dispose();
});

test('late pre-submit hydration cannot erase immediate local output; host observer failure never hides useful content', async () => {
  const doc = new Document(), root = doc.createElement('main'), canonical = state(), stale = structuredClone(canonical); let reads = 0, first!: (value: VelaState) => void, second!: (value: VelaState) => void;
  const panel = mountVelaPanel(root as unknown as HTMLElement, clientFor(async () => new Promise(resolve => { if (++reads === 1) first = resolve; else second = resolve; }), { request: async input => { const value = localOutcome(input.intent, 'synthetic:observed'); retainLocal(canonical, value); return value.request; } }), { onManifestation: value => { if (value) assert.equal(value.elements.manifestation, root.find(node => node.className === 'vela-manifestation')); throw Error('Synthetic unavailable optics'); } });
  const editor = root.find(node => node.tagName === 'textarea')!; editor.value = 'What time is it?'; editor.fire('input'); editor.fire('keydown', { key: 'Enter' }); await settles(() => reads === 2);
  first(stale); await new Promise(resolve => setImmediate(resolve)); assert.notEqual(root.find(node => node.className === 'vela-core')!.dataset.manifestationKind, 'whisper'); assert.equal(root.find(node => node.className === 'vela-core-error')!.hidden, true); second(structuredClone(canonical)); await settles(() => root.find(node => node.className === 'vela-manifestation')!.dataset.currentMessageId === 'message:clock'); assert.equal(root.find(node => node.className === 'vela-core-error')!.hidden, true); panel.dispose();
});

test('missing persistence is honest and provider attribution mismatches never surface as a verified Insight body', async () => {
  const doc = new Document(), root = doc.createElement('main'), canonical = state(); const local = localOutcome('Synthetic saved clock', 'synthetic:command'); retainLocal(canonical, local);
  const panel = mountVelaPanel(root as unknown as HTMLElement, clientFor(async () => structuredClone(canonical))); await settles(() => root.find(node => node.className === 'vela-core')!.dataset.manifestationKind === 'whisper'); assert.equal(named(root, 'Pin response').disabled, true); assert.match(named(root, 'Pin response').title, /unavailable/); named(root, 'History').fire('click'); assert.equal(named(root, 'Reopen response').disabled, true); assert.match(named(root, 'History').title, /temporary/); named(root, 'Current response').fire('click');
  canonical.requests = [request({ state: 'responded', response: { kind: 'answer', messageId: 'message:spoofed' } })]; canonical.conversation!.messages = [{ id: 'message:spoofed', requestId: 'request:synthetic', role: 'assistant', source: 'provider', providerId: 'wrong-provider', classification: 'reported', responseKind: 'answer', providerContribution: { providerId: 'wrong-provider', classification: 'reported' }, content: 'Synthetic misattributed body' }]; await panel.refresh(); assert.equal(root.find(node => node.className === 'vela-manifestation-content')!.textContent, ''); assert.match(root.find(node => node.className === 'vela-core-status')!.textContent, /attribution could not be verified/); assert.equal(displayed(root.find(node => node.dataset.messageId === 'message:spoofed')!), false); panel.dispose();
});

test('a new submission leaves an old selected response for latest, while a later explicit History choice survives a pending response', async () => {
  const doc = new Document(), root = doc.createElement('main'), canonical = state(); retainLocal(canonical, localOutcome('Earlier synthetic clock', 'synthetic:old')); canonical.presentation!.selectedRequestId = 'request:clock'; canonical.presentation!.view = 'history'; let finish!: (value: VelaRequest) => void;
  const client = clientFor(async () => structuredClone(canonical), {
    presentation: async input => { assert.equal(input.expectedVersion, canonical.presentation!.version); canonical.presentation = { ...canonical.presentation!, ...input.patch, version: canonical.presentation!.version + 1 }; return structuredClone(canonical.presentation); },
    request: async input => { const value = localOutcome(input.intent, 'synthetic:new-clock'); value.request.id = 'request:new-clock'; value.request.response!.messageId = value.result.messageId = 'message:new-clock'; retainLocal(canonical, value); return value.request; },
  });
  const panel = mountVelaPanel(root as unknown as HTMLElement, client); await settles(() => root.find(node => node.className === 'vela-core-history')!.hidden === false); const editor = root.find(node => node.tagName === 'textarea')!; editor.value = 'What time is it?'; editor.fire('input'); editor.fire('keydown', { key: 'Enter' }); await settles(() => canonical.presentation!.selectedRequestId === null && root.find(node => node.className === 'vela-manifestation')!.dataset.currentMessageId === 'message:new-clock'); assert.equal(canonical.presentation!.view, 'current');
  await settles(() => named(root, 'History').disabled === false); client.request = async () => new Promise(resolve => { finish = resolve; }); editor.value = 'Synthetic provider question'; editor.fire('input'); editor.fire('keydown', { key: 'Enter' }); await settles(() => !!finish); named(root, 'History').fire('click'); await settles(() => canonical.presentation!.view === 'history' && root.find(node => node.className === 'vela-core-history')!.hidden === false); const terminal = request({ id: 'request:provider-terminal', intent: 'Synthetic provider question', state: 'provider-unavailable' }); canonical.requests.push(terminal); finish(terminal); await settles(() => root.find(node => node.className === 'vela-core-compose')!.getAttribute('aria-busy') === 'false'); assert.equal(root.find(node => node.className === 'vela-core-history')!.hidden, false); assert.equal(canonical.presentation!.view, 'history'); panel.dispose();
});

test('presentation is a content-free observed baseline and meaningful state changes, never invented planning or automatic attention review', async () => {
  const doc = new Document(), root = doc.createElement('main'), canonical = state(), observed: VelaPanelPresentation[] = [];
  canonical.conversation = { resourceId: 'chat:vela', revision: 1, messages: [{ id: 'message:existing', role: 'user', content: 'Existing retained history', source: 'user', classification: 'observed' }] };
  const panel = mountVelaPanel(root as unknown as HTMLElement, clientFor(async () => structuredClone(canonical)), { onPresentation: value => { observed.push(value); } });
  await settles(() => observed.length === 1); assert.deepEqual(observed[0], { phase: 'idle', context: null, messageIds: ['message:existing'], planIds: [] }); assert(Object.isFrozen(observed[0]));
  await panel.refresh(); await panel.open(); assert.equal(observed.length, 1, 'Hydrating unchanged old history is not a new arrival');
  const input = root.find(node => node.tagName === 'textarea')!; input.value = 'Unsubmitted private draft'; input.fire('input'); assert.equal(observed.at(-1)!.phase, 'receiving'); const count = observed.length; input.value += ' more'; input.fire('input'); assert.equal(observed.length, count, 'Keystrokes do not replay a state transition');
  named(root, 'Add sources').fire('click'); assert.equal(observed.at(-1)!.context, 'sources'); named(root, 'Close Vela controls').fire('click'); assert.equal(observed.at(-1)!.context, null);
  canonical.requests = [request({ state: 'planning', conversationId: 'chat:vela' })]; await panel.refresh(); assert.equal(observed.at(-1)!.phase, 'planning', 'Only recorded planning state is planning');
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
  const choice = root.find(node => node.className.includes('vela-core-provider-choice'))!; assert.equal(choice.hidden, false); assert.match(choice.textContent, /Codex/); named(root, 'Close Vela controls').fire('click'); assert.equal(displayed(choice), false, 'Provider details stay behind the Provider icon');
  canonical.planner.providerId = 'other-identified-provider'; await panel.refresh(); assert.equal(consent.checked, false); assert.equal(choice.hidden, true); assert.match(consent.parent!.textContent, /other-identified-provider/); panel.dispose();
});

test('responded conversational outcomes show one attributed message without plan controls and preserve pending text/caret and observed presentation', async () => {
  for (const kind of ['answer', 'clarification', 'inability'] as const) {
    const doc = new Document(), root = doc.createElement('main'), canonical = state(), observed: VelaPanelPresentation[] = []; let finish!: (value: VelaRequest) => void, calls = 0;
    canonical.planner = { providerId: 'codex-app-server', available: true, busy: false }; canonical.conversation = { resourceId: 'chat:vela', revision: 1, messages: [] };
    const panel = mountVelaPanel(root as unknown as HTMLElement, clientFor(async () => canonical, { request: async input => { calls++; assert.equal(input.authorizeProvider, true); return new Promise(resolve => { finish = resolve; }); } }), { onPresentation: value => observed.push(value) });
    await settles(() => observed.length === 1); const input = root.find(node => node.tagName === 'textarea')!;
    named(root, 'Provider').fire('click'); const consent = root.find(node => node.tagName === 'input' && !!node.parent?.className.includes('vela-core-consent'))!; consent.checked = true; consent.fire('change'); named(root, 'Close Vela controls').fire('click');
    input.value = 'An ordinary conversational question'; input.fire('input'); input.fire('keydown', { key: 'Enter' }); assert.equal(calls, 1); assert.equal(consent.checked, false); assert.equal(observed.at(-1)!.phase, 'receiving');
    input.value = 'Later unsent text'; input.selectionStart = 2; input.selectionEnd = 7; input.fire('input');
    canonical.requests = [request({ state: 'responded', conversationId: 'chat:vela', providerId: 'codex-app-server', response: { kind, messageId: 'message:actual-response' } })];
    canonical.conversation.messages = [{ id: 'message:submitted', role: 'user', requestId: 'request:synthetic', content: 'An ordinary conversational question', source: 'user', classification: 'observed' }, { id: 'message:actual-response', role: 'assistant', requestId: 'request:synthetic', content: 'Exact canonical reported ' + kind + '.', source: 'provider', providerId: 'codex-app-server', classification: 'reported', responseKind: kind, providerContribution: { providerId: 'codex-app-server', classification: 'reported', executionId: 'execution:synthetic-client-reference' } }];
    finish(canonical.requests[0]); await settles(() => root.find(node => node.className === 'vela-core-status')!.dataset.requestState === 'responded');
    const provider = root.find(node => node.dataset.messageId === 'message:actual-response')!; assert.equal(provider.children[0].textContent, 'Vela'); assert.equal(provider.children[1].textContent, 'Exact canonical reported ' + kind + '.'); assert.equal(root.find(node => node.className === 'vela-core-plans')!.children.length, 0); assert.equal(named(root, 'Approve and apply'), undefined);
    assert.equal(root.find(node => node.className === 'vela-core')!.dataset.manifestationKind, 'insight'); assert.equal(root.find(node => node.className === 'vela-manifestation-kicker')!.hidden, true); const primary = root.find(node => node.className === 'vela-manifestation-content')!; assert.equal(primary.children[0].textContent, 'Exact canonical reported ' + kind + '.'); assert.equal(displayed(primary), true); assert.equal(displayed(provider), false, 'The canonical transcript is only visible when History is invoked');
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
  assert.equal(displayed(root.find(node => node.dataset.planId === plan.id)!), false);
  named(root, 'Open response details').fire('click');
  const editor = root.find(node => node.tagName === 'textarea')!, message = root.find(node => node.dataset.messageId === 'synthetic:long-message')!, card = root.find(node => node.dataset.planId === plan.id)!, evidence = card.find(node => node.className === 'vela-core-plan-details')!, approve = named(root, 'Approve and apply'), reject = named(root, 'Reject plan');
  editor.value = 'Synthetic unsent recovery text'; editor.selectionStart = 4; editor.selectionEnd = 12; editor.fire('input'); evidence.open = true; evidence.fire('toggle'); evidence.children[0].focus();
  const typed = JSON.parse(evidence.find(node => node.tagName === 'pre')!.textContent); assert.deepEqual(typed.actions, plan.steps); assert.deepEqual(typed.targets, plan.targets); assert.deepEqual(typed.receipts, []);
  assert.equal(message.children[1].textContent, long); assert.equal(displayed(approve), true); assert.equal(displayed(reject), true);
  await panel.refresh(); await panel.refresh();
  assert.equal(root.find(node => node.dataset.messageId === 'synthetic:long-message'), message); assert.equal(root.find(node => node.dataset.planId === plan.id), card); assert.equal(evidence.open, true); assert.equal(doc.activeElement, evidence.children[0]);
  assert.equal(named(root, 'Approve and apply'), approve); assert.equal(named(root, 'Reject plan'), reject); assert.equal(approve.disabled, false);
  assert.equal(root.find(node => node.tagName === 'textarea'), editor); assert.equal(editor.value, 'Synthetic unsent recovery text'); assert.equal(editor.selectionStart, 4); assert.equal(editor.selectionEnd, 12); assert.equal(writes, 0); panel.dispose();
});
