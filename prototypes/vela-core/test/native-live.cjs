/* Actual desktop live acceptance. The parent launches it and operates native consent.
 * One real workspace-planning turn only. No delegation, grants, retries, or provider API calls here.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
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
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,stable(value[key])])) : value;
const digest = value => hash(JSON.stringify(stable(value)));
/** Renderer replay is a global last-250 slice; its truncated flag is not a scoped provider gap. */
const planningCoverage = (replay, reference, executionId, archived) => {
  const coverage=reference.eventCoverage;assert(coverage&&!coverage.truncated&&!coverage.gapObserved,'Canonical planning adapter reported an actual coverage gap');
  assert(Number.isSafeInteger(coverage.afterCursor)&&Number.isSafeInteger(coverage.latestCursor)&&coverage.latestCursor>coverage.afterCursor,'Invalid scoped planning cursor window');
  const window=replay.events.filter(e=>e.cursor>coverage.afterCursor&&e.cursor<=coverage.latestCursor),complete=window.length===coverage.latestCursor-coverage.afterCursor&&window.every((e,i)=>e.cursor===coverage.afterCursor+i+1);
  let events=replay.events.filter(e=>e.executionId===executionId&&e.cursor>coverage.afterCursor&&e.cursor<=coverage.latestCursor),source='current-scoped-cursor-window';
  if(!complete){
    assert(archived&&archived.execution.id===executionId,'Current replay does not cover the execution window; original bound evidence is required');
    assert.deepEqual(archived.reference.eventCoverage,coverage);assert.deepEqual(archived.coverage.adapter,coverage);
    events=archived.eventRefs;assert(events.length&&events[0].type==='vela.planning.running','Original execution tail does not start with its canonical running observation');
    assert(events.every((e,i)=>e.cursor>coverage.afterCursor&&e.cursor<=coverage.latestCursor&&(!i||e.cursor===events[i-1].cursor+1)),'Original execution event tail has a cursor gap');
    assert.equal(events.at(-1).cursor,coverage.latestCursor);assert.equal(events.at(-1).type,'turn/completed');
    for(const event of reference.eventRefs)assert(events.some(e=>e.eventId===event.eventId&&e.cursor===event.cursor&&e.type===event.type&&e.classification===event.classification),'Canonical adapter event is missing from original evidence');
    const currentIds=new Map(replay.events.map(e=>[e.eventId,e]));for(const event of events){const now=currentIds.get(event.eventId);if(now)for(const key of ['cursor','type','classification'])assert.equal(now[key],event[key],'Retained event disagrees with original evidence');}
    assert(currentIds.has(events.at(-1).eventId),'Canonical terminal event is outside the current retained replay');source='original-contiguous-execution-tail-and-canonical-scoped-coverage';
  }
  assert(events.length&&events.some(e=>e.type==='turn/completed'),'Canonical completed execution event required');assert(!events.some(e=>e.classification==='simulated'),'No fixture event may qualify live evidence');
  return {events,coverage:{globalReplayTruncated:!!replay.truncated,currentScopedWindowComplete:complete,source,adapter:coverage,originalGlobalReplayTruncated:archived?.coverage.replayTruncated}};
};
const originalEvidence = async file => {assert(file&&path.isAbsolute(file)&&inside(runtime,file)&&path.basename(file)==='journey.json','Original ignored-runtime journey receipt required');const stat=await fs.stat(file);assert(stat.size<=2*1024*1024,'Original receipt exceeds bound');const bytes=await fs.readFile(file),value=JSON.parse(bytes);assert.equal(value.contract,'aerynth.actual-vela-live-workspace@1');return {file,sha256:hash(bytes),value};};

const SLOT_LIMIT_MS = 85000;
const CLEANUP_RESERVE_MS = 1500;
const reviewPreload = path.resolve(__dirname, '../../visual-experience/cinematic-v3/native/vela-review-preload.cjs');
function trustedReviewWindow(win, windows) {
  const matches = windows.filter(child => {
    try {
      if (child === win || child.isDestroyed() || child.webContents.isDestroyed() || child.getParentWindow() !== win || !child.isModal() || !child.isVisible() || child.isMinimized() || !child.isFocused() || win.isEnabled()) return false;
      const prefs = child.webContents.getLastWebPreferences(), url = child.webContents.getURL();
      return prefs.contextIsolation === true && prefs.sandbox === true && prefs.nodeIntegration === false && path.resolve(prefs.preload ?? '') === reviewPreload && prefs.additionalArguments?.some(v => /^--vela-review-token=[a-f0-9-]{36}$/.test(v)) && url.startsWith('data:text/html;charset=utf-8,') && decodeURIComponent(url.slice(url.indexOf(',') + 1)).includes('<title>Vela · Review sharing</title>');
    } catch { return false; }
  });
  assert(matches.length <= 1, 'ambiguous_native_review_owner'); return matches[0] ?? null;
}
/** Pure lifecycle guard. It never focuses a window, sends input, calls a provider or grants consent. */
function createSlot({win, slotStartedAt, deadlineMs = SLOT_LIMIT_MS, now = () => performance.now(), windows = () => require('electron').BrowserWindow.getAllWindows()}) {
  assert(Number.isFinite(deadlineMs) && deadlineMs > CLEANUP_RESERVE_MS && deadlineMs <= SLOT_LIMIT_MS, 'invalid_vela_live_deadline');
  const started = slotStartedAt ?? now(); assert(Number.isFinite(started) && started <= now(), 'invalid_vela_live_slot_start');
  const deadline = started + deadlineMs, workDeadline = deadline - CLEANUP_RESERVE_MS;
  let failure, consentPending = false, rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; }); aborted.catch(() => {});
  const abort = error => { if (!failure) { failure = error; rejectAbort(error); } return failure; };
  const check = (allowReview = false) => {
    if (failure) throw failure;
    if (now() >= workDeadline) throw abort(Error('vela_live_slot_deadline'));
    try {
      assert(!win.isDestroyed() && !win.webContents.isDestroyed() && win.isVisible() && !win.isMinimized(), 'native_verification_focus_lost');
      if (win.isFocused() && win.isEnabled()) return {kind:'parent'};
      const child = allowReview && consentPending ? trustedReviewWindow(win, windows()) : null;
      if (child) return {kind:'native-review', child};
      throw Error('native_verification_focus_lost');
    } catch (error) { throw abort(error); }
  };
  return { started, deadline, workDeadline, now, abort, check, remaining: () => Math.max(0, workDeadline - now()),
    consent(value) { consentPending = value; },
    async bound(operation, allowReview = false) { check(allowReview); const result = await Promise.race([Promise.resolve().then(operation), aborted]); check(allowReview); return result; },
    failure: () => failure,
  };
}
const consoleRecord = (details, message, line, source) => {
  const structured = details && typeof details === 'object', level = structured ? details.level : details;
  return level === 'error' || level === 3 ? {message:String(structured ? details.message : message).slice(0,2048), line:structured ? details.lineNumber : line, source:String(structured ? details.sourceId : source).slice(0,300)} : null;
};
async function cancelObservedPlanning(slot, callback) {
  if (!slot.failure() || !slot.pendingRequestId || slot.cancellationRequested) return undefined;
  slot.cancellationRequested=true;
  const result={requestId:slot.pendingRequestId,status:'native-callback-not-wired',confirmed:false};
  if(typeof callback!=='function')return result;
  result.status='requested';
  let cleanupTimer;
  try {
    const response=await Promise.race([Promise.resolve().then(()=>callback({requestId:slot.pendingRequestId,reason:slot.failure().message==='vela_live_slot_deadline'?'deadline':'focus-lost'})).then(value=>({kind:'returned',value})),new Promise(resolve=>{cleanupTimer=setTimeout(()=>resolve({kind:'bounded'}),Math.max(0,Math.min(900,slot.deadline-slot.now())));})]);
    result.status=response.kind==='returned'?'host-returned':'cleanup-deadline-unconfirmed';
    if(response.kind==='returned'&&response.value&&typeof response.value==='object')result.hostResponse={id:typeof response.value.id==='string'?response.value.id.slice(0,200):null,state:typeof response.value.state==='string'?response.value.state.slice(0,100):null};
  } catch(error){result.status='host-error-unconfirmed';result.error=String(error.message??error).slice(0,500);} finally {clearTimeout(cleanupTimer);}
  return result;
}
exports._offline = {createSlot, trustedReviewWindow, consoleRecord, cancelObservedPlanning, SLOT_LIMIT_MS, CLEANUP_RESERVE_MS};

async function run({win, app, privateRoot, source, startupErrors = [], cancelOwnedPlanning}, slot) {
  const restore = process.argv.includes('--verify-restore'),resume=process.argv.includes('--resume-reviewed-plan');
  const argument = name => process.argv.find(value=>value.startsWith(name+'='))?.slice(name.length+1);
  const out = path.join(runtime, 'application-evidence', 'vela-live-' + Date.now());
  assert(inside(runtime, out), 'Evidence must remain in ignored runtime');
  assert(privateRoot && path.isAbsolute(privateRoot), 'Actual host-owned external private profile is required');
  await fs.mkdir(out, {recursive:true});
  const expectedFile = path.join(privateRoot, 'vela-live-expected.json');
  const budgetFile = path.join(privateRoot, 'vela-live-capture-budget.json');
  const receipt = {
    contract:'aerynth.actual-vela-live-workspace@1', at:new Date().toISOString(), restore, resume, source, privateRoot, passed:false,
    host:'Actual released desktop, Vela, Library, canonical SQLite, and identified native Codex planning adapter',
    syntheticSources:true, actions:[], checks:[], captures:[], consoleErrors:startupErrors.slice(0,32).map(e=>({message:String(e.message).slice(0,2048),line:e.line,source:String(e.source??'').slice(0,300)})), partial:{},
    slot:{startedAt:slot.started,deadlineMs:slot.deadline-slot.started,workDeadlineAt:slot.workDeadline},
    bounds:{planningRequests:resume||restore?0:1, realTurns:resume||restore?0:1, delegatedTurns:0, automaticRetries:0, pngs:6, pngBytes:12*1024*1024},
    consent:{method:resume||restore?'Original bound native planning approval; this phase requests no provider consent':'Actual native host dialog, operated externally by the parent', automaticGrants:false, dialogObservation:'Only the actual parent-owned sharing child is observed. The parent operator alone may choose Send once; observation never implies approval.'},
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
  const consoleError = (event, ...args) => {
    const item=consoleRecord(event&&typeof event==='object'&&'level' in event?event:args[0],...args.slice(1));
    if(item){receipt.consoleErrors.push(item);if(receipt.consoleErrors.length>32)receipt.consoleErrors.shift();}
  };
  win.webContents.on('console-message', consoleError);
  const diagnostic = async () => {
    if (!driver) return {error:'driver_not_ready'};
    try { return await slot.bound(()=>driver.js(`(()=>{try{return {status:document.querySelector('.vela-core-status')?.textContent,requestState:document.querySelector('.vela-core-status')?.dataset.requestState,requestId:document.querySelector('.vela-core-status')?.dataset.requestId,planState:document.querySelector('.vela-core-status')?.dataset.planState,actionState:document.querySelector('.vela-core-status')?.dataset.actionState,provider:document.querySelector('.vela-core-provider')?.textContent,selection:document.querySelector('.vela-core-selection')?.textContent,library:document.querySelector('.aw-library__status')?.textContent,command:document.querySelector('#command-error')?.textContent,panels:[...document.querySelectorAll('dialog[open]')].map(e=>e.id||e.getAttribute('aria-label')),plans:[...document.querySelectorAll('.vela-core-plan')].map(e=>e.textContent.slice(0,6000)),blocks:[...document.querySelectorAll('[data-block]')].map(e=>({id:e.dataset.block,expanded:e.classList.contains('expanded')}))}}catch(error){return {error:String(error)}}})()`)); }
    catch (error) { return {error:String(error.message ?? error)}; }
  };
  try {
    assert(process.argv.includes('--integration-vela-live'), 'Explicit live acceptance flag required');
    assert(!(resume&&restore),'Resume reviewed application and restart verification are separate modes');
    assert(!process.argv.includes('--integration-live'), 'Do not combine with the legacy live helper/auto-consent flag');
    assert(source?.hashes && source?.buildAssets && Object.keys(source.buildAssets).length, 'Exact host source and loaded asset hashes required');
    receipt.moduleHashes = {};
    for (const name of ['contracts.ts','history-contracts.ts','bounded-history.mts','capability-catalog.mts','panel.ts','panel-status.ts','panel.css','service.mts','canonical-host.mts','capabilities.ts','codex-planning-adapter.mts']) receipt.moduleHashes['prototypes/vela-core/src/' + name] = hash(await fs.readFile(path.resolve(__dirname, '../src', name)));
    receipt.moduleHashes['prototypes/vela-core/test/native-live.cjs'] = hash(await fs.readFile(__filename));
    for(const name of ['vela-review.cjs','vela-review-preload.cjs'])receipt.moduleHashes['prototypes/visual-experience/cinematic-v3/native/'+name]=hash(await fs.readFile(path.resolve(__dirname,'../../visual-experience/cinematic-v3/native',name)));
    receipt.assets = {};
    for (const [name, expected] of Object.entries(source.buildAssets)) {
      const root = path.resolve(runtime, '../dist/assets'), file = path.resolve(root, name);
      assert(inside(root, file), 'Invalid loaded asset path');
      const actual = hash(await fs.readFile(file)); assert.equal(actual, expected, 'Actual loaded asset hash ' + name); receipt.assets[name] = actual;
    }
    try { budget = JSON.parse(await fs.readFile(budgetFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    assert(Number.isInteger(budget.count) && budget.count >= 0 && budget.count <= 6 && Number.isInteger(budget.bytes) && budget.bytes >= 0 && budget.bytes <= 12*1024*1024 && Array.isArray(budget.files), 'Invalid existing capture budget; preserve it and use a fresh owned profile');
    driver = await slot.bound(() => createDriver(win,{assertActive:()=>slot.check()}));
    const js = code => slot.bound(()=>driver.js(code));
    // All RPC assertions are read-only. Every mutation below is an actual native UI gesture.
    const read = (command, input) => {
      assert(command === 'executionStatus' || command === 'replay' || command === 'desktop' && input?.type === 'snapshot' || command === 'vela' && ['state','search'].includes(input?.name) || command === 'conversation' && ['detail','list'].includes(input?.name) || command === 'notes' && input?.name === 'readNote', 'Live helper RPC must remain read-only');
      return js(`window.aerynthHost.command(${JSON.stringify(command)},${JSON.stringify(input ?? {})})`);
    };
    const desktop = () => read('desktop', {type:'snapshot'});
    const state = () => read('vela', {name:'state', input:{}});
    const chat = id => read('conversation', {name:'detail', input:{resourceId:id, limit:50}});
    const executions = () => read('executionStatus', {});
    const until = async (predicate, label, timeout=12000) => {
      const deadline = Math.min(slot.workDeadline,slot.now()+timeout);
      while(slot.now()<deadline){slot.check();if(await slot.bound(predicate))return;await slot.bound(()=>pause(Math.min(80,slot.remaining())));}
      receipt.partial.timeout={label,ui:await diagnostic()};throw Error('Timed out: '+label+'; '+JSON.stringify(receipt.partial.timeout.ui));
    };
    const focus = async () => { slot.check(); };
    const click = async selector => { await focus(); receipt.actions.push({type:'native-mouse', selector, at:Date.now()}); await slot.bound(()=>driver.click(selector)); };
    const submitForNativeReview = async selector => {
      // The shared driver's post-mouseup parent-focus assertion cannot own a modal transition.
      // Locate and hit-test the actual parent control twice, then send only its real native gesture.
      const point = async () => js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e?.getBoundingClientRect();if(!r||!r.width||!r.height||e.disabled||e.hidden)throw Error('Native submit unavailable');const x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2),hit=document.elementFromPoint(x,y);if(hit!==e&&!e.contains(hit))throw Error('Native submit occluded');return{x,y}})()`);
      const first=await point();await slot.bound(()=>pause(80));const final=await point();assert(Math.hypot(first.x-final.x,first.y-final.y)<0.75,'Moving native submit target');
      slot.consent(true);receipt.actions.push({type:'native-mouse',selector,transition:'actual-native-sharing-review',at:Date.now()});
      for(const type of ['mouseMove','mouseDown','mouseUp']){slot.check();win.webContents.sendInputEvent({type,...final,button:'left',clickCount:1});}
    };
    const observeNativeReview = async expected => {
      let observed=false;
      while(slot.remaining()>0){
        const mode=slot.check(true);
        if(mode.kind==='native-review'){
          if(!observed){
            const shown=await slot.bound(()=>mode.child.webContents.executeJavaScript(`(()=>{const nodes=[...document.querySelectorAll('details')],exact=nodes.find(e=>e.querySelector('summary')?.textContent==='Exact provider request');return{title:document.querySelector('#review-title')?.textContent,intent:document.querySelector('.intent')?.textContent,prompt:exact?.querySelector('pre')?.textContent,digest:exact?.querySelector('small')?.textContent}})()`,true),true);
            assert.equal(shown.title,'Send to Codex?');assert.equal(shown.intent,expected.intent);assert(typeof shown.prompt==='string'&&Buffer.byteLength(shown.prompt)<=16384,'Bounded actual native prompt required');
            const promptDigest=digest(shown.prompt);assert.equal(shown.digest,'Request digest: '+promptDigest);const semantic=JSON.parse(shown.prompt.trim().split('\n').at(-1));assert.equal(semantic.intent,expected.intent);assert.equal(semantic.schemaAvailability,'complete-approved-catalog','This acceptance keeps optional discovery OFF');assert.equal(semantic.context.history,undefined,'This fresh-profile acceptance keeps optional history OFF');
            assert.deepEqual(semantic.context.included.map(r=>r.id).sort(),expected.resourceIds.slice().sort());assert(semantic.context.discovered.some(r=>r.id===expected.projectId&&r.kind==='project'));assert.equal(semantic.context.included.find(r=>r.id===expected.noteId).content,expected.noteContent);assert(semantic.context.included.find(r=>r.id===expected.chatId).content.includes(expected.chatContent));
            for(const entry of semantic.context.included)assert.equal(entry.contentDigest,digest(entry.content),'Displayed source content digest');
            receipt.nativeReview={windowId:mode.child.id,providerId:'codex-app-server',intent:shown.intent,prompt:shown.prompt,promptDigest,context:semantic.context,contextDigest:digest(semantic.context),observed:true,approvalObserved:false};observed=true;
            console.log(JSON.stringify({status:'vela-live-native-review-observed',providerId:'codex-app-server',promptDigest,promptBytes:Buffer.byteLength(shown.prompt),resourceIds:expected.resourceIds,instruction:'Parent may inspect the actual focused sharing review and choose Send once. The helper does not send consent.'}));
          }
        }else if(observed){slot.consent(false);return;}
        // Until the actual child is observed, inspect only Electron-owned window properties.
        // A preview error before opening stays bounded by this same slot; never query the parent across a modal race.
        await slot.bound(()=>pause(Math.min(60,slot.remaining())),true);
      }
      slot.check(true);
    };
    const control = (scope, text, tag='button', contains=false) => js(`(()=>{const root=document.querySelector(${JSON.stringify(scope)});if(!root)throw Error('Missing control scope');const visible=e=>{if(!e.getClientRects().length)return false;for(let n=e;n;n=n.parentElement){const s=getComputedStyle(n);if(n.hidden||n.inert||s.display==='none'||s.visibility!=='visible'||Number(s.opacity)<=0)return false;}return true;},nodes=[...root.querySelectorAll(${JSON.stringify(tag)})].filter(visible),node=nodes.find(e=>e.getAttribute('aria-label')===${JSON.stringify(text)})??nodes.find(e=>${contains ? 'e.textContent.includes(' + JSON.stringify(text) + ')' : 'e.textContent.trim()===' + JSON.stringify(text)});if(!node)throw Error('Missing visible control '+${JSON.stringify(text)});const parts=[];let e=node;while(e!==root){const peers=[...e.parentElement.children].filter(p=>p.tagName===e.tagName);parts.unshift(e.tagName.toLowerCase()+':nth-of-type('+(peers.indexOf(e)+1)+')');e=e.parentElement;}return ${JSON.stringify(scope)}+' > '+parts.join(' > ')})()`);
    const clickText = async (text, scope, tag='button', contains=false) => click(await control(scope, text, tag, contains));
    const disclose = async scope => { if (!await js(`document.querySelector(${JSON.stringify(scope)})?.open`)) await click(scope + ' > summary'); await until(() => js(`document.querySelector(${JSON.stringify(scope)})?.open`), 'actual disclosure opened: ' + scope); };
    const openContext = async (name, key, panel) => { await clickText(name, '.vela-core-compose'); await until(() => js(`(()=>{const e=document.querySelector('.vela-core'),more=e?.querySelector('.vela-core-more'),panel=e?.querySelector(${JSON.stringify(panel)});return e?.dataset.context===${JSON.stringify(key)}&&more&&!more.hidden&&panel&&!panel.hidden&&panel.open&&panel.getClientRects().length>0})()`), 'actual ' + key + ' context opened'); };
    const inspectPlan = async plan => {
      const scope = '.vela-core-plan[data-plan-id="' + plan.id + '"]', details = scope + ' .vela-core-plan-details';
      await disclose(details);
      const shown = await js(`(()=>{const e=document.querySelector(${JSON.stringify(scope)});return {summary:e.querySelector('h3').textContent,effects:e.querySelector('.vela-core-effects').textContent,evidence:JSON.parse(e.querySelector('.vela-core-plan-details pre').textContent)}})()`);
      assert.equal(shown.summary, plan.summary); assert.deepEqual(shown.evidence.actions, plan.steps, 'Actual UI presents every exact typed action before approval'); assert.deepEqual(shown.evidence.targets, plan.targets); assert.deepEqual(shown.evidence.provider, plan.contribution); assert.deepEqual(shown.evidence.receipts, [], 'Reviewed proposal still has no applied effects');
      assert(shown.effects.includes(plan.steps[0].action.title), 'Readable workspace effect names the exact proposed workspace');
      await click(details + ' > summary'); assert.equal(await js(`document.querySelector(${JSON.stringify(details)}).open`), false, 'Technical evidence can close while review remains available');
      return scope;
    };
    const field = (scope, text, tag='input') => js(`(()=>{const root=document.querySelector(${JSON.stringify(scope)}),visible=e=>{if(!e.getClientRects().length)return false;for(let n=e;n;n=n.parentElement){const s=getComputedStyle(n);if(n.hidden||n.inert||s.display==='none'||s.visibility!=='visible'||Number(s.opacity)<=0)return false;}return true;},label=[...root.querySelectorAll('label')].find(e=>visible(e)&&(e.querySelector('span')?.textContent??[...e.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join('')).trim()===${JSON.stringify(text)}),node=label?.querySelector(${JSON.stringify(tag)});if(!node||!visible(node))throw Error('Missing visible field '+${JSON.stringify(text)});const parts=[];let e=node;while(e!==root){const peers=[...e.parentElement.children].filter(p=>p.tagName===e.tagName);parts.unshift(e.tagName.toLowerCase()+':nth-of-type('+(peers.indexOf(e)+1)+')');e=e.parentElement;}return ${JSON.stringify(scope)}+' > '+parts.join(' > ')})()`);
    const key = (keyCode, modifiers=[]) => { for (const type of ['keyDown','keyUp']){slot.check();win.webContents.sendInputEvent({type,keyCode,modifiers});} };
    const type = async (selector, value) => {
      await click(selector);
      await until(() => js(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`), 'actual editing focus');
      key('A',['control']);
      await until(() => js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return e===document.activeElement&&e.selectionStart===0&&e.selectionEnd===e.value.length})()`), 'native select-all acknowledgement');
      await slot.bound(()=>win.webContents.insertText(String(value)));
      receipt.actions.push({type:'native-keyboard-select-and-insert', selector, characters:String(value).length});
      await until(() => js(`document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(String(value))}`), 'exact inserted field value');
    };
    const choose = async (selector, value) => {
      const index = await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return [...e.options].findIndex(o=>o.value===${JSON.stringify(value)}&&!o.disabled)})()`);
      assert(index >= 0, 'Actual choice unavailable: ' + value); await click(selector); key('Home'); for (let i=0; i<index; i++) key('Down'); key('Return');
      await until(() => js(`document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(value)}`), 'native select value');
    };
    const toggle = async (selector, value) => { if (await js(`document.querySelector(${JSON.stringify(selector)}).checked`) !== value) await click(selector); assert.equal(await js(`document.querySelector(${JSON.stringify(selector)}).checked`), value); };
    const capture = async name => {
      assert(budget.count < 6, 'Combined six-PNG profile budget exhausted'); await focus();
      const before = await js(`(()=>{const s=window.__aerynth.snapshot();return {frames:s.gpu?.framesRendered,draws:s.metrics.draws,writing:document.body.classList.contains('writing'),focusedTag:document.activeElement?.tagName}})()`); assert(Number.isFinite(before.frames), 'Actual GPU renderer unavailable');
      // A focused working editor deliberately suspends ambient frames. Traverse
      // focus with real input; never force production rendering or accept stale pixels.
      if (before.writing) {
        key('Tab');
        receipt.actions.push({type:'native-focus-traversal-for-capture',key:'Tab',reason:'leave paused writing focus',at:Date.now()});
      }
      let acknowledgement;
      await until(async () => { const next=await js(`(()=>{const s=window.__aerynth.snapshot();return {frames:s.gpu?.framesRendered,draws:s.metrics.draws,active:s.active,failed:s.graphicsFailed}})()`); if(win.isFocused()&&next.active&&!next.failed&&next.frames>before.frames&&next.draws>before.draws){acknowledgement=next;return true;}return false; }, 'new focused actual GPU draw acknowledgement', 6000);
      assert(win.isFocused(), 'Focus lost before capture'); const png=(await slot.bound(()=>win.webContents.capturePage())).toPNG(); assert(win.isFocused(), 'Focus lost during capture'); assert(budget.bytes + png.length <= 12*1024*1024, 'Combined PNG byte budget exceeded');
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
      await click('.aw-workspace-layout button[aria-label="Workspace actions"]'); await click(`[data-locate="${block.id}"]`);
      await until(() => js(`!!document.querySelector(${JSON.stringify(`[data-block="${block.id}"]`)})`), 'actual canonical block mounted');
      if (!await js(`document.querySelector(${JSON.stringify(`[data-block="${block.id}"]`)})?.classList.contains('expanded')`)) await click(`[data-block="${block.id}"] .unfold`);
      await until(() => js(`(()=>{const e=document.querySelector(${JSON.stringify(`[data-block="${block.id}"] textarea`)});return !!e&&!e.disabled&&!e.hidden&&e.getClientRects().length>0})()`), 'working canonical block editor');
      return block;
    };
    const recordChat = async (workspaceId, resourceId, content) => {
      const d=await chat(resourceId); assert.equal(d.conversation.providerId,'local'); const before=d.messages.total;
      const block=await workingBlock(workspaceId,resourceId); await type(`[data-block="${block.id}"] .cp-composer textarea`,content); await click(`[data-block="${block.id}"] .cp-composer button[type="submit"]`);
      await until(async () => {const actual=await chat(resourceId);return actual.messages.total===before+1&&actual.messages.items.at(-1)?.content===content;}, 'durable local canonical message');
      await until(() => js(`document.querySelector(${JSON.stringify(`[data-block="${block.id}"] .cp-messages`)})?.textContent.includes(${JSON.stringify(content)})`), 'working chat renders the durable local message');
      assert(!(await chat(resourceId)).messages.items.some(m=>m.role==='assistant')); return block;
    };
    const editNote = async (workspaceId, resourceId, content) => {
      const block=await workingBlock(workspaceId,resourceId); await type(`[data-block="${block.id}"] .working-content textarea`,content);
      await until(async () => (await desktop()).resources.find(r=>r.id===resourceId)?.content===content, 'canonical committed note text', 30000); return block;
    };
    const verifyExecution = async (request, plan, initialExecutionIds=[], archived) => {
      const observed=await executions(), fresh=observed.filter(e=>!initialExecutionIds.includes(e.id)); assert.equal(fresh.length,1,'Exactly one real planning turn; no retries/delegation');
      const execution=fresh[0], contribution=plan.contribution, current=await state(), reference=current.planningReferences[request.id];
      assert(contribution&&reference,'Canonical provider attribution and observation required'); assert.equal(execution.providerId,'codex-app-server'); assert.equal(execution.state,'provider_completed'); assert.equal(execution.taskVerified,false); assert(execution.binding?.nativeThreadId&&execution.turnId);
      assert.equal(contribution.classification,'reported'); assert.equal(contribution.providerId,execution.providerId); assert.equal(contribution.executionId,execution.id); assert.equal(contribution.planningConversationId,execution.resourceId); assert.equal(contribution.nativeThreadId,execution.binding.nativeThreadId); assert.equal(contribution.nativeTurnId,execution.turnId); assert(contribution.sourceMessageId);
      assert.notEqual(execution.resourceId,current.conversation.resourceId,'Codex has a distinct canonical planning conversation'); assert.equal(reference.executionId,execution.id); assert.equal(reference.stage,'proposal-ready'); assert.equal(reference.nativeThreadId,execution.binding.nativeThreadId); assert.equal(reference.nativeTurnId,execution.turnId);
      const output=await chat(execution.resourceId), message=output.messages.items.find(m=>m.id===contribution.sourceMessageId); assert(message&&message.role==='assistant'&&message.provenance==='application','Observed provider output must be retained in the canonical Codex conversation');
      assert.equal(output.conversation.providerId,'codex-app-server');
      if(receipt.nativeReview){const sent=output.messages.items.filter(m=>m.role==='user');assert.equal(sent.length,1,'One exact semantic provider input, no implicit thread history');assert.equal(sent[0].content,receipt.nativeReview.prompt);assert.equal(digest(sent[0].content),receipt.nativeReview.promptDigest);}
      if(archived){assert.deepEqual(execution,archived.execution,'Resume must use the exact original execution');assert.deepEqual(contribution,archived.contribution);assert.deepEqual(reference,archived.reference);assert.deepEqual(chatIdentity(output),archived.output,'Original provider output and canonical message IDs must be unchanged');}
      const replay=await read('replay',{}),proof=planningCoverage(replay,reference,execution.id,archived),events=proof.events;
      const evidence={execution,contribution,reference,output:chatIdentity(output),eventRefs:events.map(e=>({eventId:e.eventId,cursor:e.cursor,type:e.type,classification:e.classification,itemType:e.itemType??e.payload?.itemType})),coverage:{...proof.coverage,replayTruncated:replay.truncated}};
      receipt.providerEvidence=evidence;
      const tools=events.filter(e=>['commandExecution','fileChange','mcpToolCall','dynamicToolCall','webSearch','imageGeneration','collabAgentToolCall'].includes(e.itemType??e.payload?.itemType)); assert.deepEqual(tools,[],'Complete scoped planning evidence must contain no tool or file-change items');
      check('actual-distinct-codex-planning-execution-and-native-ids',{resourceId:execution.resourceId,executionId:execution.id,nativeThreadId:execution.binding.nativeThreadId,nativeTurnId:execution.turnId,taskVerified:false}); return evidence;
    };

    await focus();
    if (restore) {
      const expected=JSON.parse(await fs.readFile(expectedFile,'utf8')); assert.equal(expected.contract,'aerynth.vela-live-restore@1'); assert.deepEqual(receipt.moduleHashes,expected.moduleHashes); assert.deepEqual(receipt.assets,expected.assets); assert.deepEqual(source.hashes,expected.hostSourceHashes);
      if(expected.nativeReview){receipt.nativeReview=expected.nativeReview;assert.equal(digest(receipt.nativeReview.prompt),receipt.nativeReview.promptDigest);assert.equal(digest(receipt.nativeReview.context),receipt.nativeReview.contextDigest);assert.deepEqual(expected.vela.requests.find(r=>r.id===expected.requestId).context,receipt.nativeReview.context,'Restart retains exact reviewed source context');}
      const beforeExecutions=await executions(); assert.deepEqual(beforeExecutions,expected.executions,'Restart retains the exact execution and native IDs without starting a turn');
      let current=await openVela(); assert.deepEqual(velaIdentity(current),expected.vela,'Canonical identity, context, real plan/receipts and preferences persist exactly');
      for(const attention of expected.attention)assert.deepEqual(current.attention.find(item=>item.id===attention.id),attention,'Opening never marks a retained attention event reviewed');
      const d=await desktop(); assert.deepEqual(d.projects.find(p=>p.id===expected.project.id),expected.project); assert.deepEqual(d.workspaces.find(w=>w.id===expected.origin.id),expected.origin); assert.deepEqual(d.workspaces.find(w=>w.id===expected.workspace.id),expected.workspace); assert.deepEqual(placements(d,expected.origin.id),expected.originPlacements); assert.deepEqual(placements(d,expected.workspace.id),expected.targetPlacements);
      assert.deepEqual(noteIdentity(d.resources.find(r=>r.id===expected.note.id)),expected.note); assert.deepEqual(chatIdentity(await chat(expected.chat.conversation.resourceId)),expected.chat);
      await until(() => js(`document.querySelector('.vela-core-status')?.dataset.requestState==='completed'&&document.querySelector('.vela-core-status')?.dataset.planState==='applied'`),'restored truthful completed plan UI');
      let archived;if(expected.proposalEvidence){const original=await originalEvidence(expected.proposalEvidence.file);assert.equal(original.sha256,expected.proposalEvidence.sha256,'Original proposal receipt changed');archived=original.value.providerEvidence;receipt.proposalEvidence=expected.proposalEvidence;}
      receipt.providerEvidence=await verifyExecution(current.requests.find(r=>r.id===expected.requestId),current.plans.find(p=>p.id===expected.planId),[],archived); assert.deepEqual(receipt.providerEvidence.execution,expected.executions[0]);
      await capture('05-restored-real-plan-receipts'); await closeVela(); await navigate(expected.workspace.id);
      const chatBlock=await workingBlock(expected.workspace.id,expected.chat.conversation.resourceId); await until(() => js(`document.querySelector(${JSON.stringify(`[data-block="${chatBlock.id}"] .cp-messages`)})?.textContent.includes(${JSON.stringify(expected.chat.messages.at(-1).content)})`),'restored working chat content');
      const noteBlock=await workingBlock(expected.workspace.id,expected.note.id); assert.equal(await js(`document.querySelector(${JSON.stringify(`[data-block="${noteBlock.id}"] textarea`)}).value`),expected.note.content);
      assert.deepEqual(await executions(),beforeExecutions,'Read-only restore and working-view inspection starts no execution'); check('restart-exact-canonical-content-placements-real-plan-and-execution');
    } else if(resume) {
      const original=await originalEvidence(argument('--resume-evidence')),old=original.value,requestId=argument('--resume-request'),planId=argument('--resume-plan');
      assert(requestId&&planId,'Explicit original request and plan IDs are required for resume');assert.equal(old.passed,false);assert.equal(old.error?.message,'Planning event coverage is incomplete; preserve this partial live evidence');
      const originalRequest=old.partial.vela.requests.find(r=>r.id===requestId),originalPlan=old.partial.vela.plans.find(p=>p.id===planId),archived=old.providerEvidence;
      assert(originalRequest&&originalPlan&&archived,'Original real request, plan and native execution evidence required');assert.equal(originalRequest.planId,planId);assert.equal(originalPlan.requestId,requestId);assert.equal(originalRequest.state,'awaiting-review');assert.equal(originalPlan.state,'prepared');
      const body=Object.fromEntries(['requestId','version','summary','steps','targets','scope','contribution'].map(key=>[key,originalPlan[key]]));assert.equal(digest(body),originalPlan.fingerprint,'Original canonical plan fingerprint is invalid');
      receipt.proposalEvidence={file:original.file,sha256:original.sha256,at:old.at,source:old.source,moduleHashes:old.moduleHashes,assets:old.assets,requestId,planId,executionId:archived.execution.id,coverage:archived.coverage};
      let current=await state(),d=await desktop();const beforeExecutions=await executions();assert.equal(current.requests.length,1);assert.equal(current.plans.length,1);assert.deepEqual(current.requests[0],originalRequest,'Resume request/context must be exact');assert.deepEqual(current.plans[0],originalPlan,'Resume prepared plan/fingerprint must be exact');assert.deepEqual(beforeExecutions,[archived.execution],'Resume cannot start or substitute another execution');
      assert(Date.parse(originalPlan.expiresAt)>Date.now(),'Existing plan expired; resume cannot renew it or bypass review');assert.equal(current.receipts.filter(r=>r.planId===planId).length,0,'Resume requires a still-unapplied plan');assert.equal(current.preferences.delegationEnabled,false);
      const source=old.partial.sources,project=old.partial.project,origin=d.workspaces.find(w=>w.id===source.origin.id),localChat=d.resources.find(r=>r.id===source.chatId),localNote=d.resources.find(r=>r.id===source.noteId);
      assert(origin&&localChat&&localNote&&d.projects.some(p=>p.id===project.id));assert.equal(d.projects.length,1);assert.equal(d.workspaces.length,1);assert.equal(origin.project_id,project.id);assert.equal(localChat.kind,'conversation');assert.equal(localChat.providerId,'local');assert.equal(localNote.kind,'note');
      assert.deepEqual(d.resources.map(r=>r.id).sort(),[source.chatId,source.noteId,current.conversation.resourceId,archived.execution.resourceId].sort(),'Resume uses only the original canonical resources');
      assert.equal(originalPlan.steps.length,1);const action=originalPlan.steps[0].action;assert.equal(action.type,'workspaceFromResources');assert.equal(action.projectId,project.id);assert.deepEqual([...action.resourceIds].sort(),[source.chatId,source.noteId].sort());assert(action.title.startsWith('Synthetic Vela planned workspace '));
      const included=originalRequest.context.included;assert.deepEqual(included.map(r=>r.id).sort(),[source.chatId,source.noteId].sort());for(const entry of included){assert.equal(digest(entry.content),entry.contentDigest);assert.equal(entry.trust,'untrusted-source-data');assert.equal(entry.projectId,project.id);}
      const noteSource=included.find(r=>r.id===source.noteId),chatSource=included.find(r=>r.id===source.chatId),chatManifest=JSON.parse(chatSource.content),chatBefore=await chat(source.chatId);
      assert.equal(localNote.content,noteSource.content);assert.equal(localNote.version,noteSource.version);assert.equal((await read('vela',{name:'search',input:chatSource.title})).find(ref=>ref.id===source.chatId&&ref.kind==='resource')?.version,chatSource.version,'Vela revision token binds entity and conversation revisions');assert.equal(chatBefore.conversation.revision,chatManifest.revision);assert.equal(chatManifest.resourceId,source.chatId);assert.deepEqual(chatBefore.messages.items.map(m=>({id:m.id,role:m.role,content:m.content})),chatManifest.messages.map(m=>({id:m.id,role:m.role,content:m.content})));
      const raw=archived.output.messages.find(m=>m.id===archived.contribution.sourceMessageId);assert(raw?.role==='assistant');let json=raw.content.trim();if(json.startsWith('```')){const lines=json.split(/\r?\n/);assert(['```','```json'].includes(lines[0])&&lines.at(-1)==='```');json=lines.slice(1,-1).join('\n').trim();}const provider=JSON.parse(json);assert.equal(provider.schemaVersion,1);assert.equal(provider.summary,originalPlan.summary);assert.deepEqual(provider.steps,originalPlan.steps,'Resume plan must be the actual provider output, never a substitute');
      const evidence=await verifyExecution(originalRequest,originalPlan,[],archived),originPlacements=placements(d,origin.id);assert.deepEqual(originPlacements.map(b=>b.resource_id).sort(),[source.chatId,source.noteId].sort());assert(!d.workspaces.some(w=>w.title===action.title));
      current=await openVela();await until(()=>js(`document.querySelector('.vela-core-status')?.dataset.requestId===${JSON.stringify(requestId)}&&document.querySelector('.vela-core-status')?.dataset.requestState==='awaiting-review'&&document.querySelector('.vela-core-status')?.dataset.planState==='prepared'`),'original real plan rendered for fresh UI review');const planScope=await inspectPlan(originalPlan);await capture('03-resumed-original-plan-review');
      assert(Date.parse(originalPlan.expiresAt)>Date.now(),'Original plan expired before UI approval');await clickText('Approve and apply',planScope);
      await until(async()=>{const s=await state(),p=s.plans.find(p=>p.id===planId);receipt.partial.application={plan:p,receipts:s.receipts.filter(r=>r.planId===planId)};if(p&&['failed','cancelled','unknown'].includes(p.state))throw Error('Resumed reviewed application ended '+p.state);return p?.state==='applied';},'original reviewed plan host application');
      current=await state();const applied=current.receipts.filter(r=>r.planId===planId);assert.equal(applied.length,1);const appliedReceipt=applied[0];assert.equal(appliedReceipt.state,'applied');assert.equal(appliedReceipt.source,'vela');assert.equal(appliedReceipt.providerId,null);assert.equal(appliedReceipt.taskVerified,false);assert(appliedReceipt.hostReceiptId&&appliedReceipt.createdWorkspaceId);
      await until(()=>js(`document.querySelector('.vela-core-status')?.dataset.requestState==='completed'&&document.querySelector('.vela-core-status')?.dataset.planState==='applied'&&document.querySelector('.vela-core-status')?.textContent==='The reviewed plan was applied.'`),'resumed truthful applied receipt rendered');
      d=await desktop();const workspace=d.workspaces.find(w=>w.id===appliedReceipt.createdWorkspaceId);assert(workspace&&workspace.title===action.title&&workspace.project_id===project.id);assert.deepEqual(placements(d,workspace.id).map(b=>b.resource_id).sort(),[source.chatId,source.noteId].sort());assert.deepEqual(placements(d,origin.id),originPlacements);assert.deepEqual(await executions(),beforeExecutions,'UI application starts no provider execution');
      await closeVela();await navigate(workspace.id);await recordChat(workspace.id,source.chatId,'Synthetic same-ID local chat after original reviewed workspace application.');await editNote(workspace.id,source.noteId,noteSource.content+'\n\nThe same canonical note remains editable after the original reviewed workspace application.');await capture('04-resumed-working-same-id-resources');
      d=await desktop();current=await state();assert.deepEqual(await executions(),beforeExecutions);assert.equal(current.requests.length,1);assert.equal(current.plans.length,1);
      const expected={contract:'aerynth.vela-live-restore@1',...(receipt.nativeReview?{nativeReview:receipt.nativeReview}:{}),moduleHashes:receipt.moduleHashes,assets:receipt.assets,hostSourceHashes:receipt.source.hashes,proposalEvidence:receipt.proposalEvidence,project:d.projects.find(p=>p.id===project.id),origin:d.workspaces.find(w=>w.id===origin.id),workspace:d.workspaces.find(w=>w.id===workspace.id),originPlacements:placements(d,origin.id),targetPlacements:placements(d,workspace.id),chat:chatIdentity(await chat(source.chatId)),note:noteIdentity(d.resources.find(r=>r.id===source.noteId)),vela:velaIdentity(current),attention:current.attention,executions:beforeExecutions,requestId,planId};
      await fs.writeFile(expectedFile,encode(expected));receipt.expectedFile=expectedFile;check('original-real-proposal-reviewed-and-applied-without-new-turn',{requestId,planId,workspaceId:workspace.id,chatId:source.chatId,noteId:source.noteId,executionId:evidence.execution.id,hostReceiptId:appliedReceipt.hostReceiptId});
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
      await openContext('Add sources','sources','.vela-core-source-panel');
      const selectedRefs=[];for(const resource of [localChat,localNote]){
        await type('.vela-core-search input[type="search"]',resource.title); await clickText('Search','.vela-core-search');
        const found=await read('vela',{name:'search',input:resource.title}),ref=found.find(r=>r.id===resource.id); assert(ref&&ref.kind==='resource');
        const label=ref.title;await until(() => js(`(()=>{const e=[...document.querySelectorAll('.vela-core-results label span')].find(e=>e.textContent===${JSON.stringify(label)});return e?.closest('.vela-core-result').querySelector('.vela-core-meta').textContent===${JSON.stringify(ref.resourceKind)}})()`),'exact canonical resource title and kind search result');
        await toggle(await field('.vela-core-results',label),true);selectedRefs.push(ref);check('actual-resource-selected-in-vela-search',{id:ref.id,version:ref.version,kind:ref.resourceKind});
      }
      await openContext('Provider','provider','.vela-core-provider-controls');await clickText('Check connection','.vela-core-provider-controls');
      await until(() => js(`(()=>{const b=[...document.querySelectorAll('.vela-core-provider-controls button')].find(e=>e.textContent==='Check connection');return !!b&&!b.disabled})()`),'explicit planning connection check settled',30000);
      current=await state(); receipt.partial.planner=current.planner; assert.equal(current.planner.providerId,'codex-app-server'); assert(current.planner.available&&!current.planner.busy,'Actual identified planning provider unavailable'); assert.deepEqual(await executions(),[],'Connection probe starts no model turn'); assert.equal(await js(`document.querySelector('.vela-core-provider').textContent`),'Codex · available'); await capture('02-selected-sources-real-planner');
      const intent='Propose exactly one workspaceFromResources action to create a workspace titled '+JSON.stringify(names.target)+' in the current synthetic project '+JSON.stringify(names.project)+' (canonical project ID '+project.id+'). Reuse exactly the two selected existing resources, chat '+localChat.id+' and note '+localNote.id+', with no resource copies or content changes. Use their exact authorized IDs from the context manifest. No delegation, other actions, tools, shell, file access, file writes, or network actions. Return the required typed JSON proposal only; do not claim any action is applied.';
      await type('.vela-core-compose textarea',intent); await toggle(await field('.vela-core-provider-controls','Use Codex for this request'),true);
      const priorRequests=new Set(current.requests.map(r=>r.id)); receipt.operatorRequired={phase:'workspace-planning',at:new Date().toISOString(),providerId:current.planner.providerId,resourceIds:[localChat.id,localNote.id],instruction:'Parent must inspect the actual focused Vela sharing child and choose Send once only if its exact request/context is acceptable. The helper never clicks or grants native consent.'};
      console.log(JSON.stringify({status:'vela-live-native-consent-operator-required',...receipt.operatorRequired})); await submitForNativeReview(await control('.vela-core-compose','Send to Vela'));
      await observeNativeReview({intent,resourceIds:[localChat.id,localNote.id],projectId:project.id,chatId:localChat.id,chatContent:sourceChat,noteId:localNote.id,noteContent:sourceNote});
      let request, lastStatus='', notices=0; const planningStarted=slot.now();
      await until(async()=>{
        const s=await state();const fresh=s.requests.filter(r=>!priorRequests.has(r.id));assert(fresh.length<=1,'Only one initiating request is allowed');request=fresh[0];slot.pendingRequestId=request?.state==='planning'?request.id:undefined;receipt.partial.lastPlanning={request,observations:s.planningReferences,executions:await executions(),ui:await diagnostic()};
        const status=request?.state??'awaiting-native-consent'; if(status!==lastStatus&&notices++<12){console.log(JSON.stringify({status:'vela-live-planning-state',state:status,requestId:request?.id,elapsedMs:slot.now()-planningStarted}));lastStatus=status;}
        if(!request){const ui=receipt.partial.lastPlanning.ui;if(ui.requestState==='unknown'||ui.actionState==='failed'||/authorization_cancelled|authorization cancelled/i.test(ui.status??''))throw Error('Native planning request did not start: '+ui.status);return false;}
        return request.state!=='planning';
      },'single actual planning request and terminal outcome (parent operates native consent)',slot.remaining());
      current=await state(); const newRequests=current.requests.filter(r=>!priorRequests.has(r.id)); assert.equal(newRequests.length,1); assert.equal(request.state,'awaiting-review','Actual provider must return a valid plan; no fallback is permitted'); const plan=current.plans.find(p=>p.id===request.planId); assert(plan&&plan.state==='prepared'&&plan.contribution);
      assert.equal(plan.steps.length,1,'Only the requested workspace action may be approved'); const action=plan.steps[0].action; assert.equal(action.type,'workspaceFromResources'); assert.equal(action.title,names.target); assert.equal(action.projectId,project.id); assert.deepEqual([...action.resourceIds].sort(),[localChat.id,localNote.id].sort());
      assert.deepEqual(request.context.included.map(ref=>ref.id).sort(),[localChat.id,localNote.id].sort()); assert(request.context.discovered.some(ref=>ref.id===project.id&&ref.kind==='project')); assert.deepEqual(request.context,receipt.nativeReview.context,'Dispatch retains the exact displayed native source/context bytes');assert.equal(receipt.nativeReview.contextDigest,digest(request.context));assert.equal(request.context.included.find(ref=>ref.id===localNote.id).content,sourceNote); assert(request.context.included.find(ref=>ref.id===localChat.id).content.includes(sourceChat)); assert(!current.receipts.some(r=>r.planId===plan.id),'Proposal has no applied effects'); assert(!(await desktop()).workspaces.some(w=>w.title===names.target));
      for(const selected of selectedRefs){const included=request.context.included.find(ref=>ref.id===selected.id);assert.equal(included.title,selected.title);assert.equal(included.version,selected.version,'Reviewed context preserves the selected canonical resource freshness token');}
      const evidence=await verifyExecution(request,plan,initialExecutionIds); assert.notEqual(evidence.execution.resourceId,localChat.id); receipt.partial.realPlan={request,plan};
      await until(() => js(`document.querySelector('.vela-core-status')?.dataset.requestId===${JSON.stringify(request.id)}&&document.querySelector('.vela-core-status')?.dataset.requestState==='awaiting-review'&&document.querySelector('.vela-core-status')?.dataset.planState==='prepared'`),'canonical real proposal rendered for review');
      const planScope=await inspectPlan(plan);await capture('03-real-provider-plan-review');
      await clickText('Approve and apply',planScope);
      await until(async()=>{const s=await state(),p=s.plans.find(p=>p.id===plan.id);receipt.partial.application={plan:p,receipts:s.receipts.filter(r=>r.planId===plan.id)};if(p&&['failed','cancelled','unknown'].includes(p.state))throw Error('Reviewed workspace application ended '+p.state);return p?.state==='applied';},'actual reviewed plan host application');
      current=await state(); const applied=current.receipts.filter(r=>r.planId===plan.id); assert.equal(applied.length,1); const appliedReceipt=applied[0]; assert.equal(appliedReceipt.state,'applied'); assert.equal(appliedReceipt.source,'vela'); assert.equal(appliedReceipt.providerId,null,'Workspace effects are native application commands, attributed separately from provider proposal'); assert.equal(appliedReceipt.taskVerified,false); assert(appliedReceipt.hostReceiptId&&appliedReceipt.createdWorkspaceId);
      await until(() => js(`document.querySelector('.vela-core-status')?.dataset.requestState==='completed'&&document.querySelector('.vela-core-status')?.dataset.planState==='applied'&&document.querySelector('.vela-core-status')?.textContent==='The reviewed plan was applied.'`),'truthful rendered applied receipts');
      let d=await desktop(); const workspace=d.workspaces.find(w=>w.id===appliedReceipt.createdWorkspaceId); assert(workspace&&workspace.title===names.target&&workspace.project_id===project.id); assert.deepEqual(placements(d,workspace.id).map(p=>p.resource_id).sort(),[localChat.id,localNote.id].sort()); assert.deepEqual(placements(d,origin.id),originPlacements,'Original placements remain canonical and unchanged'); for(const id of [localChat.id,localNote.id])assert.equal(d.resources.filter(r=>r.id===id).length,1,'Workspace action reuses each resource once');
      await closeVela(); await navigate(workspace.id); await recordChat(workspace.id,localChat.id,'Synthetic same-ID chat works after Vela workspace creation '+token+'.'); await editNote(workspace.id,localNote.id,sourceNote+'\n\nThe same canonical note remains editable in the Vela-created workspace.');
      await capture('04-applied-working-same-id-resources');
      d=await desktop(); current=await state(); assert.deepEqual(await executions(),[evidence.execution],'Local editing starts no extra turn');
      const expected={contract:'aerynth.vela-live-restore@1',...(receipt.nativeReview?{nativeReview:receipt.nativeReview}:{}),moduleHashes:receipt.moduleHashes,assets:receipt.assets,hostSourceHashes:source.hashes,project:d.projects.find(p=>p.id===project.id),origin:d.workspaces.find(w=>w.id===origin.id),workspace:d.workspaces.find(w=>w.id===workspace.id),originPlacements:placements(d,origin.id),targetPlacements:placements(d,workspace.id),chat:chatIdentity(await chat(localChat.id)),note:noteIdentity(d.resources.find(r=>r.id===localNote.id)),vela:velaIdentity(current),attention:current.attention,executions:await executions(),requestId:request.id,planId:plan.id};
      await fs.writeFile(expectedFile,encode(expected)); check('real-reviewed-workspace-reuses-working-canonical-chat-note',{projectId:project.id,workspaceId:workspace.id,chatId:localChat.id,noteId:localNote.id,planId:plan.id,hostReceiptId:appliedReceipt.hostReceiptId}); receipt.expectedFile=expectedFile;
    }
    assert.equal(receipt.consoleErrors.length,0,'Observed startup/runtime console or shader errors');slot.check();receipt.passed=true;
  } catch(error) {
    if(slot.failure()){receipt.abort={reason:slot.failure().message,elapsedMs:slot.now()-slot.started};receipt.cancellation=await cancelObservedPlanning(slot,cancelOwnedPlanning);}
    receipt.error={message:String(error.message??error),stack:error.stack}; receipt.partial.ui=await diagnostic();
    if(driver&&!slot.failure())for(const [key,command,input] of [['vela','vela',{name:'state',input:{}}],['executions','executionStatus',{}]])try{receipt.partial[key]=await slot.bound(()=>driver.js(`window.aerynthHost.command(${JSON.stringify(command)},${JSON.stringify(input)})`));}catch(readError){receipt.partial[key]={readError:String(readError.message??readError)};}
    if(driver&&!slot.failure()&&Array.isArray(receipt.partial.executions))for(const execution of receipt.partial.executions.slice(0,1))try{receipt.partial.providerOutput=await slot.bound(()=>driver.js(`window.aerynthHost.command('conversation',${JSON.stringify({name:'detail',input:{resourceId:execution.resourceId,limit:50}})})`));}catch(readError){receipt.partial.providerOutput={readError:String(readError.message??readError)};}
  }
  win.webContents.removeListener('console-message',consoleError);
  receipt.slot.elapsedMs=slot.now()-slot.started;
  await fs.writeFile(path.join(out,restore?'restore.json':'journey.json'),encode(receipt));
  console.log(JSON.stringify({status:'vela-live-terminal',passed:receipt.passed,restore,resume,error:receipt.error?.message,evidence:out,captures:receipt.captures.length,scope:resume||restore?'existing real proposal; zero new provider turns, probes, or consent':'one actual workspace-planning turn, no delegation or automatic retries'}));
  receipt.slot.elapsedMs=slot.now()-slot.started;process.exitCode=receipt.passed?0:1;return receipt;
}

exports.verify = async options => {
  let slot,monitor,hardStop;
  try {
    slot=createSlot(options);
    hardStop=setTimeout(()=>{process.exitCode=1;slot.abort(Error('vela_live_slot_deadline'));options.app.quit();},Math.max(0,slot.deadline-slot.now()));hardStop.unref?.();
    monitor=setInterval(()=>{try{slot.check(true);}catch{}},40);monitor.unref?.();
    return await run(options,slot);
  } catch(error){process.exitCode=1;throw error;} finally {clearInterval(monitor);clearTimeout(hardStop);options.app.quit();}
};
