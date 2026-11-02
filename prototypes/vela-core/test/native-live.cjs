/* Actual desktop live acceptance. The parent launches it and operates native consent.
 * One real workspace-planning turn only. No delegation, grants, retries, or provider API calls here.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createDriver } = require('../../visual-experience/cinematic-v3/native/desktop-verify.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = value => createHash('sha256').update(value).digest('hex');
const runtime = path.resolve(__dirname, '../../visual-experience/cinematic-v3/.runtime');
const inside = (root, file) => { const relative = path.relative(path.resolve(root), path.resolve(file)); return relative && !relative.startsWith('..') && !path.isAbsolute(relative); };
const encode = value => { const data = JSON.stringify(value, null, 2); assert(Buffer.byteLength(data) <= 2 * 1024 * 1024, 'Private live receipt exceeds 2 MiB'); return data; };
const sorted = values => [...values].sort((a,b) => a.id.localeCompare(b.id));
const placements = (desktop, workspaceId) => sorted((desktop.navigationBlocks ?? desktop.blocks).filter(block => block.workspace_id === workspaceId));
const noteIdentity = note => ({id:note.id, title:note.title, kind:note.kind, project_id:note.project_id ?? null, version:note.version, content:note.content, state:note.state});
const chatIdentity = detail => ({conversation:detail.conversation, messages:detail.messages.items, total:detail.messages.total});
const velaIdentity = state => ({identity:state.identity, conversation:state.conversation, requests:state.requests, plans:state.plans, receipts:state.receipts, preferences:state.preferences, adaptation:state.adaptation, planningReferences:state.planningReferences});

exports.verify = async ({win, app, privateRoot, source}) => {
  const restore = process.argv.includes('--verify-restore');
  const out = path.join(runtime, 'application-evidence', 'vela-live-' + Date.now());
  assert(inside(runtime, out), 'Evidence must remain in ignored runtime');
  assert(privateRoot && path.isAbsolute(privateRoot), 'Actual host-owned external private profile is required');
  await fs.mkdir(out, {recursive:true});
  const expectedFile = path.join(privateRoot, 'vela-live-expected.json');
  const budgetFile = path.join(privateRoot, 'vela-live-capture-budget.json');
  const receipt = {
    contract:'aerynth.actual-vela-live-workspace@1', at:new Date().toISOString(), restore, source, passed:false,
    host:'Actual released desktop, Vela, Library, canonical SQLite, and identified native Codex planning adapter',
    syntheticSources:true, actions:[], checks:[], captures:[], consoleErrors:[], partial:{},
    bounds:{planningRequests:1, realTurns:1, delegatedTurns:0, automaticRetries:0, pngs:6, pngBytes:12*1024*1024},
    consent:{method:'Actual native host dialog, operated externally by the parent', automaticGrants:false, dialogObservation:'The helper does not claim to observe an OS dialog or the operator decision.'},
    recording:{requested:false, reason:'This bounded helper uses focused PNG captures; no recording is started.'},
    limitations:[
      'Workspace-planning phase only. Delegation requires a separately bounded live acceptance batch.',
      'Provider completion and reported planning output do not verify a delegated task; taskVerified remains false.',
      'GPU draw acknowledgements and focused captures do not prove monitor presentation, artistic acceptance, or performance.',
      'A failed or invalid provider response is preserved without proposal substitution or automatic retry.',
    ],
  };
  let driver, budget = {count:0, bytes:0, files:[]};
  const check = (name, detail) => receipt.checks.push({name, ...(detail === undefined ? {} : {detail})});
  const consoleError = (_event, details, message, line, sourceId) => {
    const structured = details && typeof details === 'object', level = structured ? details.level : details;
    if (level !== 'error' && level !== 3) return;
    receipt.consoleErrors.push({message:String(structured ? details.message : message).slice(0,2048), line:structured ? details.lineNumber : line, source:String(structured ? details.sourceId : sourceId).slice(0,300)});
    if (receipt.consoleErrors.length > 32) receipt.consoleErrors.shift();
  };
  win.webContents.on('console-message', consoleError);
  const diagnostic = async () => {
    if (!driver) return {error:'driver_not_ready'};
    try { return await driver.js(`(()=>{try{return {status:document.querySelector('.vela-core-status')?.textContent,requestState:document.querySelector('.vela-core-status')?.dataset.requestState,requestId:document.querySelector('.vela-core-status')?.dataset.requestId,planState:document.querySelector('.vela-core-status')?.dataset.planState,actionState:document.querySelector('.vela-core-status')?.dataset.actionState,provider:document.querySelector('.vela-core-provider')?.textContent,selection:document.querySelector('.vela-core-selection')?.textContent,library:document.querySelector('.aw-library__status')?.textContent,command:document.querySelector('#command-error')?.textContent,panels:[...document.querySelectorAll('dialog[open]')].map(e=>e.id||e.getAttribute('aria-label')),plans:[...document.querySelectorAll('.vela-core-plan')].map(e=>e.textContent.slice(0,6000)),blocks:[...document.querySelectorAll('[data-block]')].map(e=>({id:e.dataset.block,expanded:e.classList.contains('expanded')}))}}catch(error){return {error:String(error)}}})()`); }
    catch (error) { return {error:String(error.message ?? error)}; }
  };
  try {
    assert(process.argv.includes('--integration-vela-live'), 'Explicit live acceptance flag required');
    assert(!process.argv.includes('--integration-live'), 'Do not combine with the legacy live helper/auto-consent flag');
    assert(source?.hashes && source?.buildAssets && Object.keys(source.buildAssets).length, 'Exact host source and loaded asset hashes required');
    receipt.moduleHashes = {};
    for (const name of ['contracts.ts','panel.ts','panel-status.ts','panel.css','service.mts','canonical-host.mts','capabilities.ts','codex-planning-adapter.mts']) receipt.moduleHashes['prototypes/vela-core/src/' + name] = hash(await fs.readFile(path.resolve(__dirname, '../src', name)));
    receipt.moduleHashes['prototypes/vela-core/test/native-live.cjs'] = hash(await fs.readFile(__filename));
    receipt.assets = {};
    for (const [name, expected] of Object.entries(source.buildAssets)) {
      const root = path.resolve(runtime, '../dist/assets'), file = path.resolve(root, name);
      assert(inside(root, file), 'Invalid loaded asset path');
      const actual = hash(await fs.readFile(file)); assert.equal(actual, expected, 'Actual loaded asset hash ' + name); receipt.assets[name] = actual;
    }
    try { budget = JSON.parse(await fs.readFile(budgetFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    assert(Number.isInteger(budget.count) && budget.count >= 0 && budget.count <= 6 && Number.isInteger(budget.bytes) && budget.bytes >= 0 && budget.bytes <= 12*1024*1024 && Array.isArray(budget.files), 'Invalid existing capture budget; preserve it and use a fresh owned profile');
    driver = await createDriver(win);
    const {js} = driver;
    // All RPC assertions are read-only. Every mutation below is an actual native UI gesture.
    const read = (command, input) => {
      assert(command === 'executionStatus' || command === 'replay' || command === 'desktop' && input?.type === 'snapshot' || command === 'vela' && ['state','search'].includes(input?.name) || command === 'conversation' && ['detail','list'].includes(input?.name) || command === 'notes' && input?.name === 'readNote', 'Live helper RPC must remain read-only');
      return js(`window.aerynthHost.command(${JSON.stringify(command)},${JSON.stringify(input ?? {})})`);
    };
    const desktop = () => read('desktop', {type:'snapshot'});
    const state = () => read('vela', {name:'state', input:{}});
    const chat = id => read('conversation', {name:'detail', input:{resourceId:id, limit:50}});
    const executions = () => read('executionStatus', {});
    const until = async (predicate, label, timeout=20000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) { if (await predicate()) return; await pause(100); }
      receipt.partial.timeout = {label, ui:await diagnostic()}; throw Error('Timed out: ' + label + '; ' + JSON.stringify(receipt.partial.timeout.ui));
    };
    const focus = async () => {
      if (!win.isFocused()) console.log(JSON.stringify({status:'vela-live-focus-required', instruction:'Activate the existing Aerynth window. Native consent is operated separately by the parent.'}));
      await until(async () => win.isFocused() && win.isVisible() && !win.isMinimized(), 'positive native foreground focus', 45000);
    };
    const click = async selector => { await focus(); receipt.actions.push({type:'native-mouse', selector, at:Date.now()}); await driver.click(selector); };
    const control = (scope, text, tag='button', contains=false) => js(`(()=>{const root=document.querySelector(${JSON.stringify(scope)});if(!root)throw Error('Missing control scope');const node=[...root.querySelectorAll(${JSON.stringify(tag)})].find(e=>${contains ? 'e.textContent.includes(' + JSON.stringify(text) + ')' : 'e.textContent.trim()===' + JSON.stringify(text)});if(!node)throw Error('Missing control '+${JSON.stringify(text)});const parts=[];let e=node;while(e!==root){const peers=[...e.parentElement.children].filter(p=>p.tagName===e.tagName);parts.unshift(e.tagName.toLowerCase()+':nth-of-type('+(peers.indexOf(e)+1)+')');e=e.parentElement;}return ${JSON.stringify(scope)}+' > '+parts.join(' > ')})()`);
    const clickText = async (text, scope, tag='button', contains=false) => click(await control(scope, text, tag, contains));
    const field = (scope, text, tag='input') => js(`(()=>{const root=document.querySelector(${JSON.stringify(scope)}),label=[...root.querySelectorAll('label')].find(e=>(e.querySelector('span')?.textContent??[...e.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join('')).trim()===${JSON.stringify(text)}),node=label?.querySelector(${JSON.stringify(tag)});if(!node)throw Error('Missing field '+${JSON.stringify(text)});const parts=[];let e=node;while(e!==root){const peers=[...e.parentElement.children].filter(p=>p.tagName===e.tagName);parts.unshift(e.tagName.toLowerCase()+':nth-of-type('+(peers.indexOf(e)+1)+')');e=e.parentElement;}return ${JSON.stringify(scope)}+' > '+parts.join(' > ')})()`);
    const key = (keyCode, modifiers=[]) => { for (const type of ['keyDown','keyUp']) win.webContents.sendInputEvent({type,keyCode,modifiers}); };
    const type = async (selector, value) => { await click(selector); key('A',['control']); await win.webContents.insertText(String(value)); receipt.actions.push({type:'native-keyboard-select-and-insert', selector, characters:String(value).length}); await pause(100); };
    const choose = async (selector, value) => {
      const index = await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return [...e.options].findIndex(o=>o.value===${JSON.stringify(value)}&&!o.disabled)})()`);
      assert(index >= 0, 'Actual choice unavailable: ' + value); await click(selector); key('Home'); for (let i=0; i<index; i++) key('Down'); key('Return');
      await until(() => js(`document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(value)}`), 'native select value');
    };
    const toggle = async (selector, value) => { if (await js(`document.querySelector(${JSON.stringify(selector)}).checked`) !== value) await click(selector); assert.equal(await js(`document.querySelector(${JSON.stringify(selector)}).checked`), value); };
    const capture = async name => {
      assert(budget.count < 6, 'Combined six-PNG profile budget exhausted'); await focus();
      const before = await js(`(()=>{const s=window.__aerynth.snapshot();return {frames:s.gpu?.framesRendered,draws:s.metrics.draws}})()`); assert(Number.isFinite(before.frames), 'Actual GPU renderer unavailable');
      let acknowledgement;
      await until(async () => { const next=await js(`(()=>{const s=window.__aerynth.snapshot();return {frames:s.gpu?.framesRendered,draws:s.metrics.draws,active:s.active,failed:s.graphicsFailed}})()`); if(win.isFocused()&&next.active&&!next.failed&&next.frames>before.frames&&next.draws>before.draws){acknowledgement=next;return true;}return false; }, 'new focused actual GPU draw acknowledgement', 6000);
      assert(win.isFocused(), 'Focus lost before capture'); const png=(await win.webContents.capturePage()).toPNG(); assert(win.isFocused(), 'Focus lost during capture'); assert(budget.bytes + png.length <= 12*1024*1024, 'Combined PNG byte budget exceeded');
      const file=path.join(out,name+'.png'); await fs.writeFile(file,png); const item={file,bytes:png.length,sha256:hash(png),focused:true,before,acknowledgement}; budget.count++;budget.bytes+=png.length;budget.files.push(item);receipt.captures.push(item);await fs.writeFile(budgetFile,encode(budget));
    };
    const velaSurface = '#vela-assistant-surface[data-surface-id="vela"]';
    const librarySurface = 'dialog.aw-contextual-surface[data-surface-id="block-library"]';
    const openVela = async () => {
      if (!await js(`(()=>{const e=document.querySelector(${JSON.stringify(velaSurface)});return !!e&&e.open&&!e.inert&&e.getClientRects().length>0})()`)) await click('#vela');
      await until(() => js(`!!document.querySelector(${JSON.stringify(velaSurface + ' .vela-core')})`), 'actual Vela contextual panel');
      const current=await state(); assert.deepEqual(current.identity,{id:'system:vela',name:'Vela',role:'application-assistant'}); assert(current.conversation?.resourceId); return current;
    };
    const closeVela = async () => { await click('#vela-assistant-surface .aw-contextual-dismiss'); await until(() => js(`!document.querySelector(${JSON.stringify(velaSurface)})`), 'actual Vela surface closed'); };
    const navigate = async workspaceId => {
      await click('#workspace-manager'); await click(`[data-workspace="${workspaceId}"]`);
      await until(async () => {const d=await desktop(); return d.navigation.kind==='workspace'&&d.navigation.workspaceId===workspaceId;}, 'actual workspace navigation');
    };
    const workingBlock = async (workspaceId, resourceId) => {
      const d=await desktop(); assert.equal(d.activeWorkspaceId,workspaceId); const block=d.blocks.find(b=>b.resource_id===resourceId); assert(block,'Canonical placement unavailable');
      await click('#layout-manager'); await click(`[data-locate="${block.id}"]`);
      await until(() => js(`!!document.querySelector(${JSON.stringify(`[data-block="${block.id}"]`)})`), 'actual canonical block mounted');
      if (!await js(`document.querySelector(${JSON.stringify(`[data-block="${block.id}"]`)})?.classList.contains('expanded')`)) await click(`[data-block="${block.id}"] .unfold`);
      await until(() => js(`(()=>{const e=document.querySelector(${JSON.stringify(`[data-block="${block.id}"] textarea`)});return !!e&&!e.disabled&&!e.hidden&&e.getClientRects().length>0})()`), 'working canonical block editor');
      return block;
    };
    const recordChat = async (workspaceId, resourceId, content) => {
      const d=await chat(resourceId); assert.equal(d.conversation.providerId,'local'); const before=d.messages.total;
      const block=await workingBlock(workspaceId,resourceId); await type(`[data-block="${block.id}"] .conversation-compose textarea`,content); await click(`[data-block="${block.id}"] .conversation-compose button[type="submit"]`);
      await until(async () => {const actual=await chat(resourceId);return actual.messages.total===before+1&&actual.messages.items.at(-1)?.content===content;}, 'durable local canonical message');
      await until(() => js(`document.querySelector(${JSON.stringify(`[data-block="${block.id}"] .conversation-transcript`)})?.textContent.includes(${JSON.stringify(content)})`), 'working chat renders the durable local message');
      assert(!(await chat(resourceId)).messages.items.some(m=>m.role==='assistant')); return block;
    };
    const editNote = async (workspaceId, resourceId, content) => {
      const block=await workingBlock(workspaceId,resourceId); await type(`[data-block="${block.id}"] .working-content textarea`,content);
      await until(async () => (await desktop()).resources.find(r=>r.id===resourceId)?.content===content, 'canonical committed note text', 30000); return block;
    };
    const verifyExecution = async (request, plan, initialExecutionIds=[]) => {
      const observed=await executions(), fresh=observed.filter(e=>!initialExecutionIds.includes(e.id)); assert.equal(fresh.length,1,'Exactly one real planning turn; no retries/delegation');
      const execution=fresh[0], contribution=plan.contribution, current=await state(), reference=current.planningReferences[request.id];
      assert(contribution&&reference,'Canonical provider attribution and observation required'); assert.equal(execution.providerId,'codex-app-server'); assert.equal(execution.state,'provider_completed'); assert.equal(execution.taskVerified,false); assert(execution.binding?.nativeThreadId&&execution.turnId);
      assert.equal(contribution.classification,'reported'); assert.equal(contribution.providerId,execution.providerId); assert.equal(contribution.executionId,execution.id); assert.equal(contribution.planningConversationId,execution.resourceId); assert.equal(contribution.nativeThreadId,execution.binding.nativeThreadId); assert.equal(contribution.nativeTurnId,execution.turnId); assert(contribution.sourceMessageId);
      assert.notEqual(execution.resourceId,current.conversation.resourceId,'Codex has a distinct canonical planning conversation'); assert.equal(reference.executionId,execution.id); assert.equal(reference.stage,'proposal-ready'); assert.equal(reference.nativeThreadId,execution.binding.nativeThreadId); assert.equal(reference.nativeTurnId,execution.turnId);
      const output=await chat(execution.resourceId), message=output.messages.items.find(m=>m.id===contribution.sourceMessageId); assert(message&&message.role==='assistant'&&message.provenance==='application','Observed provider output must be retained in the canonical Codex conversation');
      assert.equal(output.conversation.providerId,'codex-app-server');
      const replay=await read('replay',{}), events=replay.events.filter(e=>e.executionId===execution.id); assert(events.length,'Actual canonical planning event references required'); assert(!events.some(e=>e.classification==='simulated'),'No fixture output may qualify a live run');
      const evidence={execution,contribution,reference,output:chatIdentity(output),eventRefs:events.map(e=>({eventId:e.eventId,cursor:e.cursor,type:e.type,classification:e.classification,itemType:e.payload?.itemType})),coverage:{replayTruncated:replay.truncated,adapter:reference.eventCoverage}};
      receipt.providerEvidence=evidence;
      assert(!replay.truncated&&!reference.eventCoverage.truncated&&!reference.eventCoverage.gapObserved,'Planning event coverage is incomplete; preserve this partial live evidence');
      const tools=events.filter(e=>e.payload?.itemType&&['commandExecution','fileChange','mcpToolCall','dynamicToolCall','webSearch','imageGeneration','collabAgentToolCall'].includes(e.payload.itemType)); assert.deepEqual(tools,[],'Available complete planning evidence must contain no tool or file-change items');
      check('actual-distinct-codex-planning-execution-and-native-ids',{resourceId:execution.resourceId,executionId:execution.id,nativeThreadId:execution.binding.nativeThreadId,nativeTurnId:execution.turnId,taskVerified:false}); return evidence;
    };

    await focus();
    if (restore) {
      const expected=JSON.parse(await fs.readFile(expectedFile,'utf8')); assert.equal(expected.contract,'aerynth.vela-live-restore@1'); assert.deepEqual(receipt.moduleHashes,expected.moduleHashes); assert.deepEqual(receipt.assets,expected.assets); assert.deepEqual(source.hashes,expected.hostSourceHashes);
      const beforeExecutions=await executions(); assert.deepEqual(beforeExecutions,expected.executions,'Restart retains the exact execution and native IDs without starting a turn');
      let current=await openVela(); assert.deepEqual(velaIdentity(current),expected.vela,'Canonical identity, context, real plan/receipts and preferences persist exactly');
      for(const attention of expected.attention)assert.deepEqual(current.attention.find(item=>item.id===attention.id),attention,'Opening never marks a retained attention event reviewed');
      const d=await desktop(); assert.deepEqual(d.projects.find(p=>p.id===expected.project.id),expected.project); assert.deepEqual(d.workspaces.find(w=>w.id===expected.origin.id),expected.origin); assert.deepEqual(d.workspaces.find(w=>w.id===expected.workspace.id),expected.workspace); assert.deepEqual(placements(d,expected.origin.id),expected.originPlacements); assert.deepEqual(placements(d,expected.workspace.id),expected.targetPlacements);
      assert.deepEqual(noteIdentity(d.resources.find(r=>r.id===expected.note.id)),expected.note); assert.deepEqual(chatIdentity(await chat(expected.chat.conversation.resourceId)),expected.chat);
      await until(() => js(`document.querySelector('.vela-core-status')?.dataset.requestState==='completed'&&document.querySelector('.vela-core-status')?.dataset.planState==='applied'`),'restored truthful completed plan UI');
      receipt.providerEvidence=await verifyExecution(current.requests.find(r=>r.id===expected.requestId),current.plans.find(p=>p.id===expected.planId)); assert.deepEqual(receipt.providerEvidence.execution,expected.executions[0]);
      await capture('05-restored-real-plan-receipts'); await closeVela(); await navigate(expected.workspace.id);
      const chatBlock=await workingBlock(expected.workspace.id,expected.chat.conversation.resourceId); await until(() => js(`document.querySelector(${JSON.stringify(`[data-block="${chatBlock.id}"] .conversation-transcript`)})?.textContent.includes(${JSON.stringify(expected.chat.messages.at(-1).content)})`),'restored working chat content');
      const noteBlock=await workingBlock(expected.workspace.id,expected.note.id); assert.equal(await js(`document.querySelector(${JSON.stringify(`[data-block="${noteBlock.id}"] textarea`)}).value`),expected.note.content);
      assert.deepEqual(await executions(),beforeExecutions,'Read-only restore and working-view inspection starts no execution'); check('restart-exact-canonical-content-placements-real-plan-and-execution');
    } else {
      const initial=await desktop(), initialVela=await state(), initialExecutionIds=(await executions()).map(e=>e.id);
      assert.equal(initialExecutionIds.length,0,'Live journey requires a fresh owned profile'); assert.equal(initial.projects.length,0,'Do not mix acceptance egress with existing projects'); assert.equal(initial.workspaces.length,0); assert(initial.resources.every(r=>r.id===initialVela.conversation?.resourceId),'Only the canonical Vela identity may pre-exist'); assert.equal(initialVela.requests.length,0);
      const token=Date.now().toString(36), names={project:'Synthetic Vela live project '+token,origin:'Synthetic Vela source workspace '+token,chat:'Synthetic Vela source chat '+token,note:'Synthetic Vela source note '+token,target:'Synthetic Vela planned workspace '+token};
      await click('#workspace-manager'); await click('#new-project'); await type('#project-title',names.project); await click('dialog[open] button[type="submit"]'); await until(() => js(`!document.querySelector('dialog[open]')`),'actual project created');
      const project=(await desktop()).projects.find(p=>p.title===names.project); assert(project); receipt.partial.project=project;
      await click('#workspace-manager'); await click('#new-workspace'); await type('#workspace-title',names.origin); await choose('dialog[open] select[name="projectId"]',project.id); await click('dialog[open] button[type="submit"]'); await until(() => js(`!document.querySelector('dialog[open]')`),'actual source workspace created');
      const origin=(await desktop()).workspaces.find(w=>w.title===names.origin); assert(origin&&origin.project_id===project.id); if((await desktop()).activeWorkspaceId!==origin.id)await navigate(origin.id);
      const createResource=async(kind,title)=>{
        const before=new Set((await desktop()).resources.map(r=>r.id)); await click('.aw-workspace-add');
        await until(() => js(`(()=>{const e=document.querySelector(${JSON.stringify(librarySurface)});return !!e&&e.open&&!e.inert&&e.getClientRects().length>0&&!!e.querySelector('.aw-library__detail form')&&!e.querySelector('.aw-library')?.hasAttribute('aria-busy')})()`),'released Library ready');
        await clickText(kind==='conversation'?'Conversation':'Note',librarySurface+' .aw-library__list','button',true);
        await type(await field(librarySurface+' .aw-library__detail','Title'),title);
        if(kind==='conversation')await choose(await field(librarySurface+' .aw-library__detail','Conversation backend','select'),'local');
        await clickText('Add New '+(kind==='conversation'?'Conversation':'Note'),librarySurface+' .aw-library__detail');
        await until(async()=>!await js(`!!document.querySelector(${JSON.stringify(librarySurface)})`)&&(await desktop()).resources.some(r=>!before.has(r.id)&&r.title===title),'released Library canonical resource creation');
        const resource=(await desktop()).resources.find(r=>!before.has(r.id)&&r.title===title); assert(resource&&resource.kind===kind&&resource.project_id===project.id); return resource;
      };
      const localChat=await createResource('conversation',names.chat); assert.equal(localChat.providerId,'local'); const sourceChat='Synthetic local source message '+token+'.'; await recordChat(origin.id,localChat.id,sourceChat);
      const localNote=await createResource('note',names.note), sourceNote='# Synthetic live Vela source\n\nSelected note marker '+token+'.'; await editNote(origin.id,localNote.id,sourceNote);
      const sourceDesktop=await desktop(), originPlacements=placements(sourceDesktop,origin.id); assert.deepEqual(originPlacements.map(p=>p.resource_id).sort(),[localChat.id,localNote.id].sort()); receipt.partial.sources={origin,chatId:localChat.id,noteId:localNote.id}; await capture('01-released-canonical-chat-note');
      let current=await openVela(); assert(current.capabilities.some(c=>c.id==='workspaceFromResources')&&current.nativeCapabilities.workspaceFromResources.available,'Registered released workspace capability is required'); assert.equal(current.preferences.delegationEnabled,false,'This batch does not enable delegation');
      for(const resource of [localChat,localNote]){
        await type('.vela-core-search input[type="search"]',resource.title); await clickText('Search','.vela-core-search');
        const found=await read('vela',{name:'search',input:resource.title}),ref=found.find(r=>r.id===resource.id); assert(ref&&ref.kind==='resource');
        const label=ref.title+' · '+ref.resourceKind+' · v'+ref.version; await until(() => js(`[...document.querySelectorAll('.vela-core-results label span')].some(e=>e.textContent===${JSON.stringify(label)})`),'exact canonical resource search result');
        await toggle(await field('.vela-core-results',label),true); check('actual-resource-selected-in-vela-search',{id:ref.id,version:ref.version,kind:ref.resourceKind});
      }
      await clickText('Check planning connection','.vela-core-provider-controls');
      await until(() => js(`(()=>{const b=[...document.querySelectorAll('.vela-core-provider-controls button')].find(e=>e.textContent==='Check planning connection');return !!b&&!b.disabled})()`),'explicit planning connection check settled',30000);
      current=await state(); receipt.partial.planner=current.planner; assert.equal(current.planner.providerId,'codex-app-server'); assert(current.planner.available&&!current.planner.busy,'Actual identified planning provider unavailable'); assert.deepEqual(await executions(),[],'Connection probe starts no model turn'); assert((await js(`document.querySelector('.vela-core-provider').textContent`)).includes('codex-app-server')); await capture('02-selected-sources-real-planner');
      const intent='Propose exactly one workspaceFromResources action to create a workspace titled '+JSON.stringify(names.target)+' in the current synthetic project '+JSON.stringify(names.project)+' (canonical project ID '+project.id+'). Reuse exactly the two selected existing resources, chat '+localChat.id+' and note '+localNote.id+', with no resource copies or content changes. Use their exact authorized IDs from the context manifest. No delegation, other actions, tools, shell, file access, file writes, or network actions. Return the required typed JSON proposal only; do not claim any action is applied.';
      await type('.vela-core-compose textarea',intent); await toggle(await field('.vela-core-compose','Allow this request and selected content to be sent to the identified planning provider'),true);
      const priorRequests=new Set(current.requests.map(r=>r.id)); receipt.operatorRequired={phase:'workspace-planning',at:new Date().toISOString(),providerId:current.planner.providerId,resourceIds:[localChat.id,localNote.id],instruction:'Parent must inspect the actual native Authorize Vela planning dialog and choose Plan once only if the exact request/context is acceptable. The helper never clicks or grants native consent.'};
      console.log(JSON.stringify({status:'vela-live-native-consent-operator-required',...receipt.operatorRequired})); await clickText('Prepare plan','.vela-core-compose');
      let request, lastStatus='', notices=0; const planningStarted=Date.now();
      await until(async()=>{
        const s=await state(); request=s.requests.find(r=>!priorRequests.has(r.id)); receipt.partial.lastPlanning={request,observations:s.planningReferences,executions:await executions(),ui:await diagnostic()};
        const status=request?.state??'awaiting-native-consent'; if(status!==lastStatus&&notices++<12){console.log(JSON.stringify({status:'vela-live-planning-state',state:status,requestId:request?.id,elapsedMs:Date.now()-planningStarted}));lastStatus=status;}
        if(!request){const ui=receipt.partial.lastPlanning.ui;if(ui.requestState==='unknown'||ui.actionState==='failed'||/authorization_cancelled|authorization cancelled/i.test(ui.status??''))throw Error('Native planning request did not start: '+ui.status);return false;}
        return request.state!=='planning';
      },'single actual planning request and terminal outcome (parent operates native consent)',240000);
      current=await state(); const newRequests=current.requests.filter(r=>!priorRequests.has(r.id)); assert.equal(newRequests.length,1); assert.equal(request.state,'awaiting-review','Actual provider must return a valid plan; no fallback is permitted'); const plan=current.plans.find(p=>p.id===request.planId); assert(plan&&plan.state==='prepared'&&plan.contribution);
      assert.equal(plan.steps.length,1,'Only the requested workspace action may be approved'); const action=plan.steps[0].action; assert.equal(action.type,'workspaceFromResources'); assert.equal(action.title,names.target); assert.equal(action.projectId,project.id); assert.deepEqual([...action.resourceIds].sort(),[localChat.id,localNote.id].sort());
      assert.deepEqual(request.context.included.map(ref=>ref.id).sort(),[localChat.id,localNote.id].sort()); assert(request.context.discovered.some(ref=>ref.id===project.id&&ref.kind==='project')); assert.equal(request.context.included.find(ref=>ref.id===localNote.id).content,sourceNote); assert(request.context.included.find(ref=>ref.id===localChat.id).content.includes(sourceChat)); assert(!current.receipts.some(r=>r.planId===plan.id),'Proposal has no applied effects'); assert(!(await desktop()).workspaces.some(w=>w.title===names.target));
      const evidence=await verifyExecution(request,plan,initialExecutionIds); assert.notEqual(evidence.execution.resourceId,localChat.id); receipt.partial.realPlan={request,plan};
      await until(() => js(`document.querySelector('.vela-core-status')?.dataset.requestId===${JSON.stringify(request.id)}&&document.querySelector('.vela-core-status')?.dataset.requestState==='awaiting-review'&&document.querySelector('.vela-core-status')?.dataset.planState==='prepared'`),'canonical real proposal rendered for review');
      assert.equal(await js(`document.querySelector('.vela-core-plan pre')?.textContent`),JSON.stringify(action,null,2),'Actual UI presents exact typed action before approval'); await capture('03-real-provider-plan-review');
      await clickText('Approve and apply reviewed plan','.vela-core-plan');
      await until(async()=>{const s=await state(),p=s.plans.find(p=>p.id===plan.id);receipt.partial.application={plan:p,receipts:s.receipts.filter(r=>r.planId===plan.id)};if(p&&['failed','cancelled','unknown'].includes(p.state))throw Error('Reviewed workspace application ended '+p.state);return p?.state==='applied';},'actual reviewed plan host application');
      current=await state(); const applied=current.receipts.filter(r=>r.planId===plan.id); assert.equal(applied.length,1); const appliedReceipt=applied[0]; assert.equal(appliedReceipt.state,'applied'); assert.equal(appliedReceipt.source,'vela'); assert.equal(appliedReceipt.providerId,null,'Workspace effects are native application commands, attributed separately from provider proposal'); assert.equal(appliedReceipt.taskVerified,false); assert(appliedReceipt.hostReceiptId&&appliedReceipt.createdWorkspaceId);
      await until(() => js(`document.querySelector('.vela-core-status')?.dataset.requestState==='completed'&&document.querySelector('.vela-core-status')?.dataset.planState==='applied'&&document.querySelector('.vela-core-status')?.textContent.includes('Host receipts confirm')`),'truthful rendered applied receipts');
      let d=await desktop(); const workspace=d.workspaces.find(w=>w.id===appliedReceipt.createdWorkspaceId); assert(workspace&&workspace.title===names.target&&workspace.project_id===project.id); assert.deepEqual(placements(d,workspace.id).map(p=>p.resource_id).sort(),[localChat.id,localNote.id].sort()); assert.deepEqual(placements(d,origin.id),originPlacements,'Original placements remain canonical and unchanged'); for(const id of [localChat.id,localNote.id])assert.equal(d.resources.filter(r=>r.id===id).length,1,'Workspace action reuses each resource once');
      await closeVela(); await navigate(workspace.id); await recordChat(workspace.id,localChat.id,'Synthetic same-ID chat works after Vela workspace creation '+token+'.'); await editNote(workspace.id,localNote.id,sourceNote+'\n\nThe same canonical note remains editable in the Vela-created workspace.');
      await capture('04-applied-working-same-id-resources');
      d=await desktop(); current=await state(); assert.deepEqual(await executions(),[evidence.execution],'Local editing starts no extra turn');
      const expected={contract:'aerynth.vela-live-restore@1',moduleHashes:receipt.moduleHashes,assets:receipt.assets,hostSourceHashes:source.hashes,project:d.projects.find(p=>p.id===project.id),origin:d.workspaces.find(w=>w.id===origin.id),workspace:d.workspaces.find(w=>w.id===workspace.id),originPlacements:placements(d,origin.id),targetPlacements:placements(d,workspace.id),chat:chatIdentity(await chat(localChat.id)),note:noteIdentity(d.resources.find(r=>r.id===localNote.id)),vela:velaIdentity(current),attention:current.attention,executions:await executions(),requestId:request.id,planId:plan.id};
      await fs.writeFile(expectedFile,encode(expected)); check('real-reviewed-workspace-reuses-working-canonical-chat-note',{projectId:project.id,workspaceId:workspace.id,chatId:localChat.id,noteId:localNote.id,planId:plan.id,hostReceiptId:appliedReceipt.hostReceiptId}); receipt.expectedFile=expectedFile;
    }
    receipt.passed=true;
  } catch(error) {
    receipt.error={message:String(error.message??error),stack:error.stack}; receipt.partial.ui=await diagnostic();
    if(driver)for(const [key,command,input] of [['vela','vela',{name:'state',input:{}}],['executions','executionStatus',{}]])try{receipt.partial[key]=await driver.js(`window.aerynthHost.command(${JSON.stringify(command)},${JSON.stringify(input)})`);}catch(readError){receipt.partial[key]={readError:String(readError.message??readError)};}
    if(driver&&Array.isArray(receipt.partial.executions))for(const execution of receipt.partial.executions.slice(0,1))try{receipt.partial.providerOutput=await driver.js(`window.aerynthHost.command('conversation',${JSON.stringify({name:'detail',input:{resourceId:execution.resourceId,limit:50}})})`);}catch(readError){receipt.partial.providerOutput={readError:String(readError.message??readError)};}
  }
  win.webContents.removeListener('console-message',consoleError);
  await fs.writeFile(path.join(out,restore?'restore.json':'journey.json'),encode(receipt));
  console.log(JSON.stringify({status:'vela-live-terminal',passed:receipt.passed,restore,error:receipt.error?.message,evidence:out,captures:receipt.captures.length,scope:'one actual workspace-planning turn, no delegation or automatic retries'}));
  process.exitCode=receipt.passed?0:1; app.quit(); return receipt;
};
