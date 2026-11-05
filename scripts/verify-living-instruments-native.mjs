/** Owned Windows Electron/CDP verification. Synthetic profile only; no provider commands.
 * Run from repository root with Node >=24.18. Never controls an existing process.
 * Evidence is private; source hashes bind captures to the built candidate.
 */
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { seedLivingMission } from './living-instruments-mission-fixture.mts';
import { BackendCore } from '../prototypes/integrated-backend/src/core.mts';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(repo, 'prototypes/visual-experience/cinematic-v3');
const MiB = 1048576, started = Date.now(), deadline = started + 120000;
const visualOnly = process.argv.includes('--visual-only');
const missionOnly = process.argv.includes('--mission-only');
const timerOnly = process.argv.includes('--timer-only');
const dropOnly = process.argv.includes('--drop-only');
const interactionOnly = process.argv.includes('--interaction-only') || dropOnly;
assert(Number(visualOnly)+Number(missionOnly)+Number(timerOnly)+Number(interactionOnly)<=1,'Choose exactly one focused mode');
assert.equal(process.platform, 'win32', 'Windows native verification required');
const guard = path.join(process.env.LOCALAPPDATA, 'AeroStorageWatch/ReserveGuard.ps1');
function admission() { const result = execFileSync('powershell.exe', ['-NoProfile', '-File', guard, '-EstimatedCBytes', String(256 * MiB), '-EstimatedDBytes', '0'], { encoding: 'utf8', windowsHide: true }); const receipt = JSON.parse(result.trim()); assert.equal(receipt.allowed, true, 'storage reserve admission denied'); return receipt; }
const reserve = admission();
const profile = path.join(process.env.LOCALAPPDATA, 'Aerynth', 'review-living-instruments-' + started);
assert.match(path.basename(profile), /^review-living-instruments-\d+$/);
await mkdir(profile, { recursive: false });
const evidence = path.join(profile, 'living-instruments-evidence'); await mkdir(evidence);
const receipt = { contract: 'aerynth.living-instruments-native@1', started: new Date(started).toISOString(), profile, syntheticOnly: true, passed: false, reserve, source: {}, checks: [], captures: [], errors: [], limits: { runtimeMs: 120000, totalAllocationBytes: 256 * MiB, profileBytes: 128 * MiB, pngBytes: 16 * MiB, jsonBytes: MiB }, limitations: ['Actual Electron renderer controlled through owned localhost CDP; software pointer input at observed unobscured control bounds and reviewed application controller, not physical OS input. Preload user-activation gates remain intact.', 'Local synthetic canonical resources; no provider, voice, credential, account or external-source commands issued by this runner.', 'Recorded-time review is retained headers only; editable planning records are separate and do not reconstruct historical state.', 'Screenshots are native renderer evidence, not artistic, monitor-presentation, accessibility or performance acceptance.', 'Unpersisted presentation choices are temporary; the focused orientation scenario does not itself save or verify those preferences. Restart verifies only the canonical fields named in each check.', 'No native-process provider-attempt observer is exposed in normal mode; zero provider executions is checked from canonical state, not inferred zero network activity.', 'ReserveGuard bounds this owned operation; external applications and already-running writers are outside its coverage.'] };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const file of ['prototypes/block-library/direct-resource-view.ts','scripts/living-instruments-mission-fixture.mts','prototypes/block-library/mission-flow.ts','prototypes/visual-experience/cinematic-v3/src/mission-workroom-view.ts','prototypes/block-library/view.ts','prototypes/block-library/placement-drop.ts','prototypes/block-library/registry.ts','prototypes/visual-experience/cinematic-v3/src/application.ts','prototypes/visual-experience/cinematic-v3/src/main.ts','prototypes/timeline-product/contracts.ts','prototypes/timeline-product/service.mts','prototypes/integrated-backend/src/timeline-domain.mts','prototypes/visual-experience/cinematic-v3/native/product-commands.cjs','prototypes/visual-experience/cinematic-v3/src/product-clients.ts','prototypes/visual-experience/cinematic-v3/src/vela-visual-state.ts','prototypes/visual-experience/cinematic-v3/src/vela-shape.ts','prototypes/visual-experience/cinematic-v3/src/renderer.ts','prototypes/block-library/timeline-view.ts','prototypes/block-library/temporal-planning.ts','prototypes/visual-experience/cinematic-v3/src/clock-timer-view.ts','prototypes/block-library/temporal-projection.ts','prototypes/block-library/stream-view.ts','prototypes/block-library/showroom.ts','prototypes/visual-experience/cinematic-v3/dist/index.html']) receipt.source[file] = hash(await readFile(path.join(repo, file)));
for (const file of await readdir(path.join(root, 'dist/assets'))) if (/\.(js|css)$/.test(file)) receipt.source['dist/assets/' + file] = hash(await readFile(path.join(root, 'dist/assets', file)));
const children = new Set(); let cdp, core, pngBytes = 0;let foregroundGuard=false,foregroundLost=false;
receipt.rendererErrors = [];
function checkDeadline() { assert(Date.now() < deadline, 'native run deadline'); }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ownedSize(directory) { let bytes = 0; for (const entry of await readdir(directory, { withFileTypes: true })) { const full = path.join(directory, entry.name); if (entry.isDirectory()) bytes += await ownedSize(full); else bytes += (await stat(full)).size; } return bytes; }
async function budget() { checkDeadline(); const bytes = await ownedSize(profile); assert(bytes <= 128 * MiB, 'owned profile byte budget'); receipt.profileBytes = bytes; }
function killOwned(child) { if (child && child.exitCode === null) { try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 }); } catch {} } }
const hardStop = setTimeout(() => { for (const child of children) killOwned(child); }, 118000);
async function diagnose(label,error){
  if(!cdp)return;receipt.diagnostics??=[];const entry={label,error,at:new Date().toISOString()};receipt.diagnostics.push(entry);
  try{entry.dom=await cdp.evaluate(`(()=>{const rect=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}};return{url:location.href,activeElement:document.activeElement?{tag:document.activeElement.tagName,id:document.activeElement.id,className:document.activeElement.className}:null,surfaces:[...document.querySelectorAll('[data-surface-id]')].slice(0,20).map(n=>({id:n.dataset.surfaceId,hidden:n.hidden,inert:n.inert,rect:rect(n),text:n.textContent.slice(0,1000)})),timelines:[...document.querySelectorAll('.aw-timeline')].slice(0,8).map(n=>{const t=n.querySelector('.aw-timeline-track'),dot=t?.querySelector('.aw-timeline-dot:not([hidden])');return{id:n.dataset.resourceId,busy:n.getAttribute('aria-busy'),optionsOpen:n.querySelector('.aw-timeline-options')?.open,status:n.querySelector('.aw-timeline-status')?.textContent,rect:rect(n),track:t?{rect:rect(t),scrollTop:t.scrollTop,scrollLeft:t.scrollLeft,clientHeight:t.clientHeight,scrollHeight:t.scrollHeight,overflow:getComputedStyle(t).overflow,ticks:t.querySelectorAll('.aw-timeline-tick').length}:null,dot:dot?{rect:rect(dot),transform:getComputedStyle(dot).transform}:null}}),missionCards:[...document.querySelectorAll('.aw-mission-workroom')].slice(0,16).map(n=>({kind:n.dataset.missionWorkroomCard,mission:n.dataset.missionId,hidden:n.hidden,inert:n.inert,text:n.textContent.slice(0,1500),rect:rect(n)})),application:window.__aerynth?.application()?.navigation,snapshot:{active:window.__aerynth?.snapshot().active,graphicsFailed:window.__aerynth?.snapshot().graphicsFailed}}})()`);
    if(receipt.diagnostics.length<=3&&pngBytes<13*MiB)await capture('diagnostic-'+receipt.diagnostics.length);
  }catch(failure){entry.diagnosticError=failure.message;}
}
async function requireForeground(){if(!foregroundGuard||!cdp)return;if(foregroundLost)throw Error('owned_native_foreground_lost_abort');const active=await cdp.evaluate('window.__aerynth.snapshot().active');if(active!==true){foregroundLost=true;await diagnose('foreground lost; interaction abort','Observed snapshot.active was not true; no refocus attempted');throw Error('owned_native_foreground_lost_abort');}}
async function wait(label,fn,ms=10000){const until=Math.min(deadline-2000,Date.now()+ms);let last,diagnosed=false;while(Date.now()<until){checkDeadline();await requireForeground();try{const value=await fn();if(value)return value;}catch(error){last=error.message;}if(!diagnosed&&Date.now()>=until-650){diagnosed=true;await diagnose('before timeout: '+label,last??'condition did not become ready');}await sleep(100);}throw Error(label+': timed out'+(last?' ('+last+')':''));}
async function launch() {
  await budget();
  const exe = path.join(root, 'node_modules/electron/dist/electron.exe');
  const environment = { ...process.env, AERYNTH_NODE_BIN: process.execPath }; delete environment.ELECTRON_RUN_AS_NODE;
  const child = spawn(exe, ['.', '--profile=' + profile, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--aerynth-capture-visible'], { cwd: root, env: environment, windowsHide: true, stdio: ['ignore','pipe','pipe'] }); children.add(child);
  let log = '', browserUrl; const record = chunk => { log = (log + chunk.toString()).slice(-24000); browserUrl = /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/.exec(log)?.[1] ?? browserUrl; };
  child.stderr.on('data', record); child.stdout.on('data', record); child.on('error', error => { receipt.errors.push(error.message); });
  await wait('owned Electron CDP endpoint', () => { if (child.exitCode !== null) throw Error('Electron exited: ' + log.slice(-2000)); return browserUrl; }, 20000);
  const origin = new URL(browserUrl).origin.replace('ws:', 'http:');
  const target = await wait('owned page target', async () => (await (await fetch(origin + '/json/list', { signal: AbortSignal.timeout(3000) })).json()).find(value => value.type === 'page' && value.url.startsWith('file:')));
  const socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let id = 0; const pending = new Map(); socket.addEventListener('message', event => { const value = JSON.parse(event.data); if (value.method === 'Runtime.exceptionThrown' || value.method === 'Log.entryAdded' && value.params.entry.level === 'error' || value.method === 'Runtime.consoleAPICalled' && value.params.type === 'error') receipt.rendererErrors.push(JSON.stringify(value).slice(0,4000)); const item = pending.get(value.id); if (item) { pending.delete(value.id); clearTimeout(item.timer); value.error ? item.reject(Error(JSON.stringify(value.error))) : item.resolve(value.result); } });
  const command = (method, params = {}) => new Promise((resolve, reject) => { checkDeadline(); const key = ++id; const timer = setTimeout(() => { pending.delete(key); reject(Error(method + ' deadline')); }, Math.max(1, Math.min(8000, deadline - Date.now() - 1000))); pending.set(key, { resolve, reject, timer }); socket.send(JSON.stringify({ id: key, method, params })); });
  const evaluate = async expression => { const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.text + ': ' + result.exceptionDetails.exception?.description); return result.result?.value; };
  cdp = { child, command, evaluate, socket, log: () => log };
  await wait('actual application ready', () => evaluate('!!window.__aerynth?.application()?.resources'), 20000);
  await command('Runtime.enable'); await command('Log.enable'); await command('Page.bringToFront');await wait('owned native foreground before interaction',()=>evaluate('window.__aerynth.snapshot().active===true'));foregroundGuard=true;
  receipt.rendererSamples ??= []; receipt.rendererSamples.push({phase:'ready',observation:await evaluate('(()=>{const s=window.__aerynth.snapshot();return {metrics:s.metrics,gpu:s.gpu,graphicsFailed:s.graphicsFailed,active:s.active}})()')});
  receipt.processes ??= []; receipt.processes.push({ pid: child.pid, page: target.url });
  return cdp;
}
async function closeNative() { foregroundGuard=false;if (!cdp) return; const owned = cdp; try { await owned.evaluate('window.__aerynth.flush().then(()=>window.close())'); } catch {} await wait('owned Electron close', () => owned.child.exitCode !== null, 7000).catch(() => killOwned(owned.child)); owned.socket.close(); receipt.processes.at(-1).exitCode = owned.child.exitCode; cdp = null; }
async function capture(name, clip, observation) { await budget(); const capturedAt=new Date().toISOString();const { data } = await cdp.command('Page.captureScreenshot', { format: 'png', ...(clip?{clip}: {}) }); const png = Buffer.from(data, 'base64'); assert(png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), 'PNG required'); assert(pngBytes + png.length <= 16 * MiB, 'PNG budget'); pngBytes += png.length; const file = path.join(evidence, name + '.png'); await writeFile(file, png, { flag: 'wx' }); receipt.captures.push({ file, bytes: png.length, sha256: hash(png),capturedAt,...(clip?{clip}:{}),...(observation?{observation}:{}) }); }
async function captureWidget(name,expression){const view=await cdp.evaluate(`(()=>{const n=${expression};if(!n)throw Error('widget missing');const r=n.getBoundingClientRect();return{rect:{x:r.x,y:r.y,w:r.width,h:r.height},viewport:{w:innerWidth,h:innerHeight}}})()`);const r=view.rect,x=Math.max(0,r.x-8),y=Math.max(0,r.y-8),right=Math.min(view.viewport.w,r.x+r.w+8),bottom=Math.min(view.viewport.h,r.y+r.h+8);assert(right>x&&bottom>y);await capture(name,{x,y,width:right-x,height:bottom-y,scale:1},{...view,capture:'Observed native widget bounds, viewport-intersected; no image editing'});}
async function step(name, work) { if(visualOnly&&!name.startsWith('Visual native')&&!name.startsWith('Native GPU')){(receipt.skippedChecks??=[]).push(name);return;} if(missionOnly&&!name.startsWith('Mission native')&&!name.startsWith('Native GPU')){(receipt.skippedChecks??=[]).push(name);return;} if (interactionOnly && !(dropOnly?['LI03 interaction','LI15 interaction','Native GPU']:['LI03 interaction','LI04 interaction','LI16 interaction','LI15 interaction','Native GPU']).some(prefix=>name.startsWith(prefix))) { (receipt.skippedChecks ??= []).push(name); return; } if (timerOnly && !name.startsWith('LI12') && !name.startsWith('LI15 native timer restart') && !name.startsWith('Native GPU')) { (receipt.skippedChecks ??= []).push(name); return; } checkDeadline(); const began = Date.now(); try { const value = await work(); receipt.checks.push({ name, passed: true, ms: Date.now() - began, ...(value ? { observation: value } : {}) }); } catch (error) { await diagnose('failed step: '+name,error.message);receipt.checks.push({ name, passed: false, ms: Date.now() - began, error: error.message });if(foregroundLost)throw error; } }
const expr = value => JSON.stringify(value);
async function pointerTarget(expression) {
  const menuNeeded=await cdp.evaluate(`(()=>{const n=${expression},menu=n?.closest('.aw-timeline-options');return !!menu&&!menu.open&&!!n.closest('.aw-timeline-options-panel')})()`);if(menuNeeded)await pointerClick(`document.querySelector('.aw-timeline-options > summary')`);
  let previous;
  const point=await wait('visible unobscured software pointer target',async()=>{
    const p=await cdp.evaluate(`(()=>{const b=${expression};if(!b||b.disabled||b.closest('[hidden],[inert]'))return null;b.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});const r=b.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);if(r.width<=0||r.height<=0||x<0||y<0||x>=innerWidth||y>=innerHeight||!hit||!(hit===b||b.contains(hit)))return null;return{x,y}})()`);
    if(!p){previous=null;return false;}const stable=previous&&Math.abs(previous.x-p.x)<1&&Math.abs(previous.y-p.y)<1;previous=p;return stable&&p;
  });
  return point;
}
async function pointerClick(expression) {
  const point=await pointerTarget(expression);await requireForeground();
  await cdp.command('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
  await cdp.command('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
  await cdp.command('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
}
async function clickText(container,text){await pointerClick(`[...document.querySelector(${expr(container)})?.querySelectorAll('button')??[]].find(n=>n.textContent.trim()===${expr(text)})`);}
async function keyInput(key,code,virtualKey,modifiers=0){await requireForeground();for(const type of ['keyDown','keyUp'])await cdp.command('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:virtualKey,nativeVirtualKeyCode:virtualKey,modifiers});}
async function dragInput(expression, destination, cancel=false, beforeRelease){
  const source=await pointerTarget(expression),target=typeof destination==='function'?destination(source):destination;
  await cdp.command('Input.dispatchMouseEvent',{type:'mouseMoved',...source});
  await cdp.command('Input.dispatchMouseEvent',{type:'mousePressed',...source,button:'left',clickCount:1});
  try{
    for(let step=1;step<=5;step++){await cdp.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:source.x+(target.x-source.x)*step/5,y:source.y+(target.y-source.y)*step/5,button:'left',buttons:1});await sleep(30);}
    await sleep(180);const observation=beforeRelease?await beforeRelease():null;
    if(cancel)await keyInput('Escape','Escape',27);
    return {source,target,cancel,observation};
  }finally{await cdp.command('Input.dispatchMouseEvent',{type:'mouseReleased',...target,button:'left',clickCount:1});}
}
async function rpc(name, input) { const value = await cdp.evaluate(`window.aerynthHost.command(${expr(name)},${expr(input)})`); assert(value && value.ok !== false, JSON.stringify(value)); return value.result?.result ?? value.result ?? value; }
let timelineId, streamId, expected, timerId, savedPlans, savedTimer, interactionPlanId, interactionPlacement, interactionResource, interactionFinalPlans, missionFixture, missionCanonical;
try {
  core = new BackendCore({ path: path.join(profile, 'aerynth.sqlite'), provider: 'fixture', contentPolicy: 'synthetic-only' });
  const project = (await core.command('desktop', { type: 'createProject', title: 'SYNTHETIC Living Instruments native review' })).projects[0];
  const workspace = await core.command('desktop', { type: 'createWorkspace', projectId: project.id, title: 'SYNTHETIC instrument review' });
  const workspaceId = workspace.activeWorkspaceId;
  const templates = (await core.command('agents', { name: 'templates', input: {} })).result;
  const agent = (await core.command('agents', { name: 'create', input: { commandId: 'synthetic-living-source', title: 'SYNTHETIC retained source', projectId: project.id, profile: templates[0].profile } })).result;
  const now = Date.now();
  const view = { schemaVersion: 1, mode: 'activity', scope: { projectId: project.id, resourceIds: [agent.agent.resourceId] }, sources: { providerIds: [], eventTypes: [], classifications: ['observed','reported','inferred','simulated'] }, viewport: { from: new Date(now - 60000).toISOString(), to: new Date(now + 60000).toISOString(), displayTimeZone: 'America/New_York' }, selection: null };
  timelineId = (await core.command('timelines', { name: 'create', input: { commandId: 'synthetic-living-timeline', title: 'SYNTHETIC retained Timeline', projectId: project.id, view } })).result.resourceId;
  if(interactionOnly){const plan=await core.command('timelines',{name:'planning',input:{op:'create',commandId:'synthetic-interaction-plan',resourceId:timelineId,expectedVersion:1,values:{title:'SYNTHETIC pointer and keyboard plan',startAt:new Date(now-20000).toISOString(),durationMs:30000,timeZone:'UTC',laneId:'Interaction review'}}});interactionPlanId=plan.result.item.id;receipt.interactionSetup={classification:'simulated',method:'Offline canonical Timeline planning service setup, not native creation proof',planningItemId:interactionPlanId};}
  if(!interactionOnly&&!visualOnly){const stream = await core.command('desktop', { type: 'createResource', kind: 'stream', title: 'SYNTHETIC native Stream', workspaceId }); streamId = stream.resources.find(value => value.kind === 'stream').id;}
  receipt.fixture = { timelineId, streamId, workspaceId }; receipt.seedProviderActivity = await core.command('providerActivity', {});
  if(missionOnly){missionFixture=await seedLivingMission(core);receipt.missionFixture=missionFixture;receipt.missionScope='Real local CPU/RAM public-command mission and retained canonical workroom cards in a fresh synthetic workspace; no provider or microphone commands';}
  await core.command('close', {}); core = null;
  await launch();
  if(visualOnly){
    const readTimeline=()=>rpc('timelines',{name:'read',input:{resourceId:timelineId}});
    const ready=()=>wait('quiet Timeline current projection',()=>cdp.evaluate(`document.querySelector('.aw-timeline')?.getAttribute('aria-busy')==='false'`));
    const installProbe=()=>cdp.evaluate(`(()=>{const t=document.querySelector('.aw-timeline-track'),state={track:t,events:[],handler:null};state.handler=e=>{if(e.type!=='wheel'&&e.buttons!==1&&e.type!=='pointerup')return;const r=t.getBoundingClientRect();if(state.events.length<64)state.events.push({type:e.type,clientX:e.clientX,clientY:e.clientY,buttons:e.buttons,deltaX:e.deltaX??0,deltaY:e.deltaY??0,deltaMode:e.deltaMode??0,shiftKey:e.shiftKey,rect:{x:r.x,y:r.y,w:r.width,h:r.height},extent:Math.max(80,t.clientWidth-28),atMs:performance.now()});};for(const type of ['wheel','pointerdown','pointermove','pointerup'])t.addEventListener(type,state.handler,{capture:true,passive:true});window.__nativeTimelineProbe=state;})()`);
    const probeEvents=()=>cdp.evaluate(`window.__nativeTimelineProbe?.events??[]`);
    const clearProbe=()=>cdp.evaluate(`(()=>{const s=window.__nativeTimelineProbe;if(s)for(const type of ['wheel','pointerdown','pointermove','pointerup'])s.track.removeEventListener(type,s.handler,true);delete window.__nativeTimelineProbe;})()`);
    const quietObservation=()=>cdp.evaluate(`(()=>{const n=document.querySelector('.aw-timeline'),t=n.querySelector('.aw-timeline-track'),menu=n.querySelector('.aw-timeline-options'),rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}},dot=t.querySelector('.aw-timeline-dot:not([hidden])');return{resourceId:n.dataset.resourceId,optionsOpen:menu.open,visibleControlsOutsideTrack:[...n.querySelectorAll('button,input,select,summary')].filter(e=>!e.closest('.aw-timeline-track')&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden').map(e=>({tag:e.tagName,text:e.textContent.trim().slice(0,80),label:e.getAttribute('aria-label')})),track:{rect:rect(t),clientWidth:t.clientWidth,clientHeight:t.clientHeight,scrollTop:t.scrollTop,scrollLeft:t.scrollLeft,scrollHeight:t.scrollHeight,overflow:getComputedStyle(t).overflow,ticks:t.querySelectorAll('.aw-timeline-tick').length},dot:dot?{rect:rect(dot),transform:getComputedStyle(dot).transform}:null,range:n.querySelector('.aw-timeline-range').textContent,status:n.querySelector('.aw-timeline-status').textContent}})()`);
    await step('Visual native quiet Timeline default',async()=>{
      await cdp.evaluate(`window.__aerynth.openResource({resourceId:${expr(timelineId)},preferredPresentation:'direct'})`);await ready();await sleep(350);const view=await quietObservation();assert.equal(view.optionsOpen,false);assert.deepEqual(view.visibleControlsOutsideTrack.map(c=>c.label),['Timeline options']);assert(view.track.ticks>0);assert.equal(view.track.scrollTop,0);assert(view.dot);await capture('visual-timeline-quiet-default');await captureWidget('visual-timeline-quiet-widget',`document.querySelector('.aw-timeline')`);return view;
    });
    await step('Visual native pointer-anchored wheel zoom and background pan commit',async()=>{
      await ready();await installProbe();
      try{
        let before=await readTimeline();const view=await quietObservation(),point={x:view.track.rect.x+view.track.rect.w*.35,y:view.track.rect.y+view.track.rect.h*.78};
        await cdp.command('Input.dispatchMouseEvent',{type:'mouseMoved',...point});for(let i=0;i<3;i++)await cdp.command('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:-40});
        let after=await wait('one coalesced canonical wheel zoom',async()=>{const d=await readTimeline();return d.resource.version>before.resource.version&&d;}),events=(await probeEvents()).filter(e=>e.type==='wheel');assert(events.length>0,'native delivered wheel events required');
        let from=Date.parse(before.view.viewport.from),to=Date.parse(before.view.viewport.to);
        for(const e of events){const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?e.extent:1),fraction=Math.max(0,Math.min(1,(e.clientX-e.rect.x-14)/e.extent)),anchor=from+fraction*(to-from),span=Math.max(1000,Math.min(315576000000,(to-from)*Math.exp(Math.max(-1,Math.min(1,delta*.002)))));from=Date.parse(new Date(anchor-fraction*span).toISOString());to=Date.parse(new Date(anchor+(1-fraction)*span).toISOString());}
        const wheel={requested:{point,count:3,deltaY:-40},delivered:events,expected:{from:new Date(from).toISOString(),to:new Date(to).toISOString()},before:before.view,after:after.view,versions:[before.resource.version,after.resource.version]};receipt.visualWheel=wheel;
        assert.equal(after.resource.version,before.resource.version+1);assert.equal(after.view.viewport.from,wheel.expected.from);assert.equal(after.view.viewport.to,wheel.expected.to);await ready();
        await clearProbe();await installProbe();before=after;const gesture=await dragInput(`document.querySelector('.aw-timeline-track')`,p=>({x:p.x+44,y:p.y}));after=await wait('canonical background pointer pan',async()=>{const d=await readTimeline();return d.resource.version>before.resource.version&&d;});events=await probeEvents();const down=events.find(e=>e.type==='pointerdown'),move=events.filter(e=>e.type==='pointermove'&&e.buttons===1).at(-1);assert(down&&move,'native delivered drag coordinates required');const delta=(move.clientX-move.rect.x-14)-(down.clientX-down.rect.x-14),shift=-delta/move.extent*(Date.parse(before.view.viewport.to)-Date.parse(before.view.viewport.from));
        const pan={gesture,delivered:events,expectedShiftMs:shift,before:before.view,after:after.view,versions:[before.resource.version,after.resource.version]};receipt.visualPan=pan;assert.equal(after.resource.version,before.resource.version+1);assert.equal(after.view.viewport.from,new Date(Date.parse(before.view.viewport.from)+shift).toISOString());assert.equal(after.view.viewport.to,new Date(Date.parse(before.view.viewport.to)+shift).toISOString());await ready();const quiet=await quietObservation();assert.equal(quiet.optionsOpen,false);await capture('visual-timeline-direct-navigation');return{wheel,pan,quiet};
      }finally{await clearProbe();}
    });
    await step('Visual native Escape cancels background pan without canonical write',async()=>{
      await ready();const before=await readTimeline(),gesture=await dragInput(`document.querySelector('.aw-timeline-track')`,p=>({x:p.x+36,y:p.y}),true,quietObservation);await sleep(300);const after=await readTimeline();assert.equal(after.resource.version,before.resource.version);assert.deepEqual(after.view,before.view);assert(await cdp.evaluate(`!!document.querySelector('.aw-timeline-track')&&!document.querySelector('.aw-timeline').closest('[inert]')`),'Escape must cancel navigation while retaining the active instrument');assert(await cdp.evaluate(`document.activeElement===document.querySelector('.aw-timeline-track')`),'Native track focus must own cancellation');return{gesture,version:after.resource.version,unchanged:true,view:await quietObservation()};
    });
    await step('Visual native Stream showroom branch and join composition',async()=>{
      if(await cdp.evaluate(`!!document.querySelector('[data-surface-id="canonical-resource"]:not([inert]) .aw-contextual-dismiss')`))await pointerClick(`document.querySelector('[data-surface-id="canonical-resource"]:not([inert]) .aw-contextual-dismiss')`);await wait('previous resource surface fully closed',()=>cdp.evaluate(`!document.querySelector('[data-surface-id="canonical-resource"]')`));await pointerClick(`document.querySelector('.aw-workspace-add')`);await wait('Stream showroom tile',()=>cdp.evaluate(`!!document.querySelector('[data-block-kind="stream"]')`));await pointerClick(`document.querySelector('[data-block-kind="stream"]')`);
      const sample=await wait('purpose-specific Stream branch preview',()=>cdp.evaluate(`(()=>{const n=document.querySelector('.aw-library__detail .aw-showroom-example-branches'),j=document.querySelector('.aw-library__detail .aw-showroom-example-join');return n&&j&&{branches:n.children.length,text:n.textContent,join:j.textContent,label:n.closest('.aw-showroom-demo')?.textContent.slice(0,450)}})()`));assert.equal(sample.branches,2);await cdp.evaluate(`document.querySelector('.aw-library__detail .aw-showroom-demo').scrollIntoView({block:'nearest',behavior:'instant'})`);await sleep(150);await capture('visual-stream-showroom-branches');await captureWidget('visual-stream-showroom-widget',`document.querySelector('.aw-library__detail .aw-showroom-demo')`);return{classification:'simulated',...sample};
    });
  }
  if(missionOnly){
    const scope=kind=>'[data-surface-id="canonical-resource"] .aw-mission-workroom[data-mission-workroom-card="'+kind+'"][data-mission-id="'+missionFixture.missionId+'"]';
    const openCard=async(kind,id)=>{await cdp.evaluate(`window.__aerynth.openResource({resourceId:${expr(id)},preferredPresentation:'direct'})`);await wait('actual canonical mission '+kind+' card',()=>cdp.evaluate(`!!document.querySelector(${expr(scope(kind))})`));};
    const observedFlow=kind=>cdp.evaluate(`(()=>{const c=document.querySelector(${expr(scope(kind))}),f=c?.querySelector('.aw-mission-flow');return {kind:${expr(kind)},missionId:c?.dataset.missionId,revision:c?.dataset.missionRevision,flowHidden:f?.hidden,mode:f?.dataset.mode,nodes:[...c?.querySelectorAll('.aw-mission-task')??[]].map(n=>({id:n.dataset.missionTaskId,join:n.dataset.join,state:n.dataset.taskState,label:n.getAttribute('aria-label'),position:getComputedStyle(n).position,rect:(()=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()})),edges:[...c?.querySelectorAll('.aw-mission-edge')??[]].map(n=>({from:n.dataset.from,to:n.dataset.to})),coverage:f?.querySelector('.aw-stream-coverage')?.textContent,status:c?.textContent.slice(0,600)}})()`);
    await step('Mission native Stream actual dependency branches, multi-parent join and Forensic',async()=>{
      missionCanonical=await rpc('missions',{name:'read',input:{id:missionFixture.missionId}});assert.equal(missionCanonical.outcome,'verified');
      await openCard('stream',missionFixture.streamResourceId);await wait('actual mission Stream Flow nodes',async()=>{const f=await observedFlow('stream');return f.mode==='flow'&&f.nodes.length>0&&f;});
      await sleep(250);const flow=await observedFlow('stream'),expected=missionFixture.dependencyEdges.map(e=>e.dependsOn+'>'+e.taskId).sort();assert.deepEqual(flow.edges.map(e=>e.from+'>'+e.to).sort(),expected);
      assert.deepEqual(flow.nodes.map(n=>n.id).sort(),missionCanonical.tasks.map(t=>t.id).sort());
      const parents=new Map();for(const e of flow.edges)parents.set(e.to,(parents.get(e.to)??0)+1);assert(flow.nodes.some(n=>n.join==='true'&&parents.get(n.id)>1),'actual multi-parent join required');
      const roots=flow.nodes.filter(n=>!flow.edges.some(e=>e.to===n.id));assert(roots.length>=2,'actual independent native sample branches required');assert(flow.nodes.every(n=>n.position==='absolute'),'native Flow task nodes must have absolute positioning');assert(new Set(roots.map(n=>Math.round(n.rect.x))).size>=2,'independent roots must occupy different native horizontal positions');for(const child of flow.nodes.filter(n=>n.join==='true')){const parents=flow.edges.filter(e=>e.to===child.id).map(e=>flow.nodes.find(n=>n.id===e.from));assert(parents.every(p=>child.rect.y>p.rect.y),'native join must appear below its actual parents');}
      await sleep(300);await capture('mission-stream-flow');await pointerClick(`document.querySelector(${expr(scope('stream')+' [data-workroom-mode="forensic"]')})`);
      const forensic=await wait('actual retained mission journal rows',()=>cdp.evaluate(`(()=>{const c=document.querySelector(${expr(scope('stream'))}),f=c.querySelector('.aw-mission-flow');const rows=[...c.querySelectorAll('[data-stream-event-id]')].map(n=>({id:n.dataset.streamEventId,cursor:Number(n.dataset.streamCursor),text:n.textContent}));return rows.length&&f.hidden&&{rows,coverage:c.querySelector('p[role="status"]')?.textContent}})()`));
      const canonical=await rpc('missions',{name:'workroom-resource',input:{resourceId:missionFixture.streamResourceId}}),ids=new Set(canonical.dashboard.events.map(e=>e.eventId));assert(forensic.rows.every(row=>ids.has(row.id)),'every displayed journal event must be retained canonically');
      await capture('mission-stream-forensic');await pointerClick(`document.querySelector(${expr(scope('stream')+' [data-workroom-mode="glimpse"]')})`);const glimpse=await wait('actual mission Glimpse',async()=>{const f=await observedFlow('stream');return f.mode==='glimpse'&&f.nodes.length&&f;});assert(glimpse.nodes.length<=24);
      return{flow,roots:roots.map(n=>n.id),forensic,glimpse};
    });
    await step('Mission native Graph actual source/task metadata and dependency provenance',async()=>{
      await openCard('graph',missionFixture.graphResourceId);await wait('actual mission Graph nodes',async()=>{const f=await observedFlow('graph');return f.nodes.length&&f;});const flow=await observedFlow('graph');assert.deepEqual(flow.edges.map(e=>e.from+'>'+e.to).sort(),missionFixture.dependencyEdges.map(e=>e.dependsOn+'>'+e.taskId).sort());
      const cpu=missionFixture.evidence.find(e=>e.executor==='sample.cpu');assert(cpu);await pointerClick(`document.querySelector(${expr(scope('graph')+' [data-mission-task-id="'+cpu.taskId+'"]')})`);
      const metadata=await wait('actual authorized task inspector',()=>cdp.evaluate(`(()=>{const c=document.querySelector(${expr(scope('graph'))}),i=c.querySelector('.aw-stream-inspector');if(!i||i.hidden)return null;return Object.fromEntries([...i.querySelectorAll('dt')].map(n=>[n.textContent,n.nextElementSibling?.textContent]));})()`));assert.equal(metadata['Task ID'],cpu.taskId);assert.equal(metadata.Executor,'sample.cpu');assert(Object.values(metadata).includes(cpu.evidenceId));assert(Object.values(metadata).includes(cpu.source));
      await cdp.evaluate(`document.querySelector(${expr(scope('graph')+' .aw-stream-inspector')}).scrollIntoView({block:'center',behavior:'instant'})`);await capture('mission-graph-task-source');return{flow,metadata,canonicalEvidence:cpu};
    });
    await step('Mission native generated Timeline uses the canonical temporal instrument',async()=>{
      assert(missionFixture.timelineResourceId,'generated canonical Timeline required');const timelineSelector='[data-surface-id="canonical-resource"] .aw-timeline[data-resource-id="'+missionFixture.timelineResourceId+'"]';await openCard('timeline',missionFixture.timelineResourceId);await wait('generated sibling primary Timeline',()=>cdp.evaluate(`document.querySelector(${expr(timelineSelector)})?.getAttribute('aria-busy')==='false'`));
      const diagnostic=await cdp.evaluate(`(()=>{const n=document.querySelector(${expr(timelineSelector)}),t=n.querySelector('.aw-timeline-track'),tick=t.querySelector('.aw-timeline-tick'),dot=t.querySelector('.aw-timeline-dot:not([hidden])');const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}};return{timelineId:n.dataset.resourceId,forensicListHidden:n.querySelector('.aw-timeline-items').hidden,range:n.querySelector('.aw-timeline-range').textContent,track:{scrollTop:t.scrollTop,scrollLeft:t.scrollLeft,clientHeight:t.clientHeight,clientWidth:t.clientWidth,scrollHeight:t.scrollHeight,scrollWidth:t.scrollWidth,rect:rect(t),overflow:getComputedStyle(t).overflow},ticks:t.querySelectorAll('.aw-timeline-tick').length,firstTick:rect(tick),firstDot:{rect:rect(dot),transform:dot?getComputedStyle(dot).transform:null},supportsOverflowClip:CSS.supports('overflow','clip'),coverage:n.querySelector('.aw-timeline-coverage').textContent}})()`);assert.equal(diagnostic.timelineId,missionFixture.timelineResourceId);assert.equal(diagnostic.forensicListHidden,true);assert(diagnostic.track.clientWidth>0);await capture('mission-canonical-timeline');
      await pointerClick(`document.querySelector(${expr(timelineSelector+' .aw-timeline-options > summary')})`);const save=await cdp.evaluate(`(()=>{const n=document.querySelector(${expr(timelineSelector)}),buttons=[...n.querySelectorAll('.aw-timeline-options-panel button')].filter(b=>b.textContent==='Save view');if(buttons[0])buttons[0].scrollIntoView({block:'nearest',behavior:'instant'});const b=buttons[0],r=b?.getBoundingClientRect(),hit=r?document.elementFromPoint(r.x+r.width/2,r.y+r.height/2):null;return{count:buttons.length,insideFilters:!!b?.closest('.aw-timeline-filters'),visible:!!r&&r.width>0&&r.height>0&&(hit===b||b.contains(hit)),disabled:b?.disabled,optionsOpen:n.querySelector('.aw-timeline-options').open}})()`);assert.equal(save.count,1);assert.equal(save.insideFilters,false);assert.equal(save.visible,true);await keyInput('Escape','Escape',27);
      const before=await rpc('timelines',{name:'read',input:{resourceId:missionFixture.timelineResourceId}});await pointerClick(`document.querySelector(${expr(timelineSelector+' .aw-timeline-track')})`);await keyInput('Escape','Escape',27);await wait('idle graph Escape dismisses canonical parent',()=>cdp.evaluate(`!document.querySelector('[data-surface-id="canonical-resource"]')`));const after=await rpc('timelines',{name:'read',input:{resourceId:missionFixture.timelineResourceId}});assert.equal(after.resource.version,before.resource.version);await openCard('timeline',missionFixture.timelineResourceId);await wait('reopened sibling Timeline',()=>cdp.evaluate(`document.querySelector(${expr(timelineSelector)})?.getAttribute('aria-busy')==='false'`));return{...diagnostic,saveAffordance:save,idleEscape:{dismissedParent:true,unchangedVersion:after.resource.version,reopened:true}};
    });
    await step('Mission native navigation suspends and clears prior dependency projection',async()=>{
      await openCard('graph',missionFixture.graphResourceId);await wait('mission graph before navigation',async()=>(await observedFlow('graph')).nodes.length>0);
      const before=await cdp.evaluate(`({nodes:document.querySelectorAll('.aw-mission-task').length,inspectors:document.querySelectorAll('.aw-mission-flow .aw-stream-inspector:not([hidden])').length})`);
      await cdp.evaluate(`window.__aerynth.execute({type:'navigate',target:{kind:'workspace',workspaceId:${expr(missionFixture.originWorkspaceId)}}})`);
      const after=await wait('prior mission Flow removed after real navigation',()=>cdp.evaluate(`(()=>{const s=window.__aerynth.application();return s.activeWorkspaceId===${expr(missionFixture.originWorkspaceId)}&&document.querySelectorAll('.aw-mission-task').length===0&&{workspaceId:s.activeWorkspaceId,nodes:0,missionText:[...document.querySelectorAll('.aw-mission-flow')].map(n=>n.textContent),scope:'Navigation/inactive cleanup only; host-policy revocation not exercised'}})()`));return{before,after};
    });
  }
  if(interactionOnly) {
    await step('LI03 interaction native Library pointer drop, canonical geometry, undo and redo',async()=>{
      const before=await rpc('desktop',{type:'snapshot'});
      await pointerClick(`document.querySelector('.aw-workspace-add')`);
      await wait('registered Note drag source',()=>cdp.evaluate(`!!document.querySelector('[data-block-kind="note"][data-library-grab="true"]')`));
      const expression=`document.querySelector('[data-block-kind="note"][data-library-grab="true"]')`,source=await pointerTarget(expression);
      const diagnostics={source,probes:[],selected:null};receipt.dropDiagnostics=diagnostics;
      let candidate,gesture;
      await cdp.command('Input.dispatchMouseEvent',{type:'mouseMoved',...source});
      await cdp.command('Input.dispatchMouseEvent',{type:'mousePressed',...source,button:'left',clickCount:1});
      try{
        const fractions=[[.23,.60],[.77,.60],[.23,.42],[.77,.42],[.50,.76],[.15,.60],[.85,.60],[.50,.42],[.35,.72],[.65,.72],[.35,.40],[.65,.40],[.18,.72],[.82,.72],[.50,.55]];
        for(const [fx,fy] of fractions){
          const point=await cdp.evaluate(`({x:Math.round(innerWidth*${fx}),y:Math.round(innerHeight*${fy})})`);
          await cdp.command('Input.dispatchMouseEvent',{type:'mouseMoved',...point,button:'left',buttons:1});await sleep(100);
          const observe=()=>cdp.evaluate(`(()=>{const s=window.__aerynth.application(),v=s.viewport??{x:0,y:0,zoom:1},x=${point.x},y=${point.y},hit=document.elementFromPoint(x,y),scope=hit?.closest('[data-surface-id],dialog,#vela'),r=document.querySelector('[data-surface-id="block-library"]')?.getBoundingClientRect();return{x,y,world:{x:x/v.zoom+v.x,y:y/v.zoom+v.y},viewport:v,navigation:s.navigation,workspaceId:s.activeWorkspaceId,libraryRect:r?{x:r.x,y:r.y,w:r.width,h:r.height}:null,hit:hit?{tag:hit.tagName,id:hit.id,className:typeof hit.className==='string'?hit.className:'SVG'}:null,scope:scope?{tag:scope.tagName,id:scope.id,surface:scope.getAttribute('data-surface-id')}:null,allowed:document.querySelector('.aw-library__carried')?.dataset.dropAllowed??null,ghost:!!document.querySelector('.aw-library__carried'),atMs:performance.now()}})()`);
          const current=await observe();diagnostics.probes.push(current);
          if(current.allowed==='true'){
            await cdp.command('Input.dispatchMouseEvent',{type:'mouseMoved',...point,button:'left',buttons:1});await sleep(40);const confirmed=await observe();diagnostics.probes.at(-1).confirmed=confirmed;
            if(confirmed.allowed==='true'){candidate=confirmed;diagnostics.selected=confirmed;break;}
          }
        }
        gesture={source,target:candidate?{x:candidate.x,y:candidate.y}:null,probeCount:diagnostics.probes.length,allowed:!!candidate};receipt.dropGesture=gesture;
        if(!candidate)await keyInput('Escape','Escape',27);
      }finally{const last=candidate??diagnostics.probes.at(-1)??source;await cdp.command('Input.dispatchMouseEvent',{type:'mouseReleased',x:last.x,y:last.y,button:'left',clickCount:1});}
      assert(candidate,'No genuinely allowed workspace point was found in the bounded native drag probes; see dropDiagnostics');
      const after=await wait('canonical note insertion from pointer drop',async()=>{const d=await rpc('desktop',{type:'snapshot'});return d.blocks.length===before.blocks.length+1&&d;});
      const block=after.blocks.find(b=>!before.blocks.some(old=>old.id===b.id)),resource=after.resources.find(r=>r.id===block.resource_id);assert.equal(resource.kind,'note');assert(!before.resources.some(r=>r.id===resource.id));
      assert(Math.abs(block.x+block.width/2-candidate.world.x)<=2,'world x from client drop');assert(Math.abs(block.y+block.height/2-candidate.world.y)<=2,'world y from client drop');
      await cdp.evaluate(`window.__aerynth.execute({type:'undo'})`);const undone=await wait('canonical drop placement undone',async()=>{const d=await rpc('desktop',{type:'snapshot'});return !d.blocks.some(b=>b.id===block.id)&&d;});assert(undone.resources.some(r=>r.id===resource.id),'undo preserves canonical source resource');
      await cdp.evaluate(`window.__aerynth.execute({type:'redo'})`);const redone=await wait('canonical drop placement restored',async()=>{const d=await rpc('desktop',{type:'snapshot'});return d.blocks.find(b=>b.id===block.id);});assert.equal(redone.resource_id,resource.id);assert.deepEqual({x:redone.x,y:redone.y,width:redone.width,height:redone.height},{x:block.x,y:block.y,width:block.width,height:block.height});
      interactionPlacement=redone;interactionResource=resource;await sleep(300);await capture('interaction-library-drop');return{gesture,candidate,placement:redone,resource:{id:resource.id,kind:resource.kind},undoPreservedResource:true};
    });
    const readPlans=async()=>{const doc=await rpc('timelines',{name:'read',input:{resourceId:timelineId}});return {doc,planning:await rpc('timelines',{name:'planning',input:{op:'list',resourceId:timelineId,expectedVersion:doc.resource.version}})};};
    const planExpression=()=>`document.querySelector('[data-planned-id='+${expr(JSON.stringify(interactionPlanId))}+']')`;
    const planReady=()=>wait('current editable canonical planned band',()=>cdp.evaluate(`(()=>{const b=${planExpression()};return b&&!b.hidden&&!b.querySelector('button').disabled&&document.querySelector('.aw-timeline').getAttribute('aria-busy')==='false'})()`));
    await step('LI04 interaction native plan pointer move, duration resize and Escape cancel',async()=>{
      await cdp.evaluate(`window.__aerynth.openResource({resourceId:${expr(timelineId)},preferredPresentation:'direct'})`);await planReady();
      await cdp.evaluate(`(()=>{const snap=document.querySelector('.aw-timeline-planning [aria-label="Drag / keyboard snap"]');snap.value='1000';snap.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      let before=await readPlans(),item=before.planning.items.find(p=>p.id===interactionPlanId);assert(item);
      const extent=await cdp.evaluate(`Math.max(80,document.querySelector('.aw-timeline-track').clientWidth-28)`),span=Date.parse(before.doc.view.viewport.to)-Date.parse(before.doc.view.viewport.from),deltaX=48,deltaMs=Math.round(deltaX/extent*span/1000)*1000;
      const moved=await dragInput(`${planExpression()}.querySelector('button')`,p=>({x:p.x+deltaX,y:p.y}));
      let after=await wait('native planned move canonical timestamp',async()=>{const p=await readPlans();return p.doc.resource.version>before.doc.resource.version&&p;});let movedItem=after.planning.items.find(p=>p.id===interactionPlanId);assert.equal(Date.parse(movedItem.startAt)-Date.parse(item.startAt),deltaMs);assert.equal(movedItem.durationMs,item.durationMs);assert.equal(movedItem.id,item.id);await planReady();
      before=after;item=movedItem;const resizeX=28,resizeMs=Math.round(resizeX/extent*span/1000)*1000;
      const resized=await dragInput(`${planExpression()}.querySelector('button:last-child')`,p=>({x:p.x+resizeX,y:p.y}));
      after=await wait('native duration handle canonical interval',async()=>{const p=await readPlans();return p.doc.resource.version>before.doc.resource.version&&p;});const resizedItem=after.planning.items.find(p=>p.id===interactionPlanId);assert.equal(resizedItem.durationMs,item.durationMs+resizeMs);assert.equal(resizedItem.startAt,item.startAt);await planReady();
      const canonical=after;const cancelled=await dragInput(`${planExpression()}.querySelector('button')`,p=>({x:p.x+36,y:p.y}),true,()=>cdp.evaluate(`(()=>{const r=${planExpression()}.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()`));await sleep(350);
      const unchanged=await readPlans();assert.equal(unchanged.doc.resource.version,canonical.doc.resource.version);assert.deepEqual(unchanged.planning.items,canonical.planning.items);
      interactionFinalPlans=unchanged.planning.items;await cdp.evaluate(`${planExpression()}.scrollIntoView({block:'center',behavior:'instant'})`);await capture('interaction-planning-pointer');return {move:moved,moveExpectedMs:deltaMs,resize:resized,resizeExpectedMs:resizeMs,cancel:cancelled,item:resizedItem,unchangedVersion:unchanged.doc.resource.version};
    });
    await step('LI16 interaction real keyboard editing under reduced motion',async()=>{
      await planReady();await cdp.evaluate(`window.__aerynth.setReduced(true);const n=document.createElement('aside');n.id='native-reduced-review';n.textContent='REVIEW: reduced motion enabled; synthetic local resources; real keyboard controls';n.style.cssText='position:fixed;top:75px;left:24px;z-index:2147483647;background:#102331;color:white;padding:10px';document.body.append(n)`);assert.equal(await cdp.evaluate(`window.__aerynth.snapshot().reduced`),true);
      try{
        await pointerClick(`${planExpression()}.querySelector('button')`);const before=await readPlans(),item=before.planning.items.find(p=>p.id===interactionPlanId);await keyInput('ArrowRight','ArrowRight',39);
        let after=await wait('keyboard move canonical update',async()=>{const p=await readPlans();return p.doc.resource.version>before.doc.resource.version&&p;});assert.equal(Date.parse(after.planning.items.find(p=>p.id===interactionPlanId).startAt)-Date.parse(item.startAt),1000);await planReady();
        await pointerClick(`${planExpression()}.querySelector('button')`);const durationBefore=after.planning.items.find(p=>p.id===interactionPlanId).durationMs,version=after.doc.resource.version;await keyInput('ArrowRight','ArrowRight',39,1);
        after=await wait('keyboard duration canonical update',async()=>{const p=await readPlans();return p.doc.resource.version>version&&p;});assert.equal(after.planning.items.find(p=>p.id===interactionPlanId).durationMs,durationBefore+1000);interactionFinalPlans=after.planning.items;await capture('interaction-reduced-keyboard');return {reduced:true,item:after.planning.items.find(p=>p.id===interactionPlanId),backendOrVoiceActivity:false};
      }finally{await cdp.evaluate(`window.__aerynth.setReduced(false);document.querySelector('#native-reduced-review')?.remove()`);}
    });
  }
  await step('LI05 actual Timeline axis, selection, orientation and canonical zoom', async () => {
    await cdp.evaluate(`window.__aerynth.openResource({resourceId:${expr(timelineId)},preferredPresentation:'direct'})`);
    await wait('Timeline actual retained nodes', () => cdp.evaluate(`(()=>{const n=document.querySelector('.aw-timeline');return n?.getAttribute('aria-busy')==='false'&&n.querySelector('.aw-timeline-dot:not([hidden])')})()`.replace("&&n.querySelector('.aw-timeline-dot:not([hidden])')", "&&!!n.querySelector('.aw-timeline-dot:not([hidden])')")));
    const observation = await cdp.evaluate(`(()=>{const n=document.querySelector('.aw-timeline');const dot=n.querySelector('.aw-timeline-dot:not([hidden])');dot.click();return {ticks:n.querySelectorAll('.aw-timeline-tick').length,listHidden:n.querySelector('.aw-timeline-items').hidden,selected:dot.dataset.eventId,range:n.querySelector('.aw-timeline-range').textContent}})()`); assert(observation.ticks > 0 && observation.listHidden);
    for (const orientation of ['vertical','multilane','horizontal']) { await cdp.evaluate(`(()=>{const n=document.querySelector('.aw-timeline select[aria-label="Orientation"]');n.value=${expr(orientation)};n.dispatchEvent(new Event('change',{bubbles:true}));})()`); assert.equal(await cdp.evaluate(`document.querySelector('.aw-timeline').dataset.orientation`), orientation); }
    await clickText('.aw-timeline', 'Filters'); await clickText('.aw-timeline', 'Save view'); await wait('selection saved', async () => { const doc = await rpc('timelines', { name: 'read', input: { resourceId: timelineId } }); return doc.view?.selection?.eventId === observation.selected; });
    await wait('viewer save settled', () => cdp.evaluate(`document.querySelector('.aw-timeline').getAttribute('aria-busy')==='false'`));
    const before = await rpc('timelines', { name: 'read', input: { resourceId: timelineId } }); await clickText('.aw-timeline', 'Zoom in');
    expected = await wait('canonical zoom saved', async () => { const doc = await rpc('timelines', { name: 'read', input: { resourceId: timelineId } }); return doc.resource.version > before.resource.version && doc; });
    assert.equal(Date.parse(expected.view.viewport.to) - Date.parse(expected.view.viewport.from), (Date.parse(before.view.viewport.to) - Date.parse(before.view.viewport.from)) / 2); assert.equal(expected.view.selection.eventId, observation.selected);
    await sleep(400); await capture('timeline-horizontal');
    await cdp.evaluate(`(()=>{const n=document.querySelector('.aw-timeline select[aria-label="Orientation"]');n.value='vertical';n.dispatchEvent(new Event('change',{bubbles:true}));})()`); await sleep(400); await capture('timeline-vertical'); return observation;
  });
  await step('LI04 native canonical planning create/edit/delete/undo', async () => {
    await cdp.evaluate(`document.querySelector('.aw-timeline-planning').open=true`);
    await wait('planning supported and editable',()=>cdp.evaluate(`[...document.querySelectorAll('.aw-timeline-planning button')].some(n=>n.textContent==='New planning item'&&!n.disabled)`));
    await clickText('.aw-timeline-planning','New planning item');
    const doc=await rpc('timelines',{name:'read',input:{resourceId:timelineId}}), initialStart=new Date((Date.parse(doc.view.viewport.from)+Date.parse(doc.view.viewport.to))/2).toISOString();
    await cdp.evaluate(`(()=>{const set=(label,value)=>{const n=document.querySelector('.aw-timeline-planning [aria-label="'+label+'"]');n.value=value;n.dispatchEvent(new Event('input',{bubbles:true}));};set('Plan title','SYNTHETIC native plan');set('Plan start (ISO with UTC offset)',${expr(initialStart)});set('Plan duration (milliseconds)','90000');set('Plan timezone (IANA)','America/New_York');set('Plan lane','Review');})()`);
    await clickText('.aw-timeline-planning','Create planning item');
    const readPlans=async()=>{const doc=await rpc('timelines',{name:'read',input:{resourceId:timelineId}});return rpc('timelines',{name:'planning',input:{op:'list',resourceId:timelineId,expectedVersion:doc.resource.version}});};
    let plans=await wait('canonical plan creation',async()=>{const p=await readPlans();return p.items?.length===1&&p;});assert.equal(plans.items[0].startAt,initialStart);assert.equal(plans.items[0].durationMs,90000);
    await wait('planning edit acknowledgment',()=>cdp.evaluate(`[...document.querySelectorAll('.aw-timeline-planning button')].some(n=>n.textContent==='Update planning item'&&!n.disabled)`));
    await cdp.evaluate(`document.querySelector('.aw-timeline-planning [aria-label="Plan title"]').value='SYNTHETIC revised native plan'`);
    await clickText('.aw-timeline-planning','Update planning item');
    await wait('canonical plan revision',async()=>{const p=await readPlans();return p.items?.[0]?.title==='SYNTHETIC revised native plan';});
    await wait('planning delete ready',()=>cdp.evaluate(`[...document.querySelectorAll('.aw-timeline-planning button')].some(n=>n.textContent==='Delete planning item'&&!n.disabled)`));
    await clickText('.aw-timeline-planning','Delete planning item');await wait('canonical plan deleted',async()=>(await readPlans()).items?.length===0);
    await wait('planning undo ready',()=>cdp.evaluate(`[...document.querySelectorAll('.aw-timeline-planning button')].some(n=>n.textContent==='Undo planning change'&&!n.disabled)`));
    await clickText('.aw-timeline-planning','Undo planning change');plans=await wait('canonical undo restores planned intention',async()=>{const p=await readPlans();return p.items?.length===1&&p;});
    assert.equal(plans.items[0].title,'SYNTHETIC revised native plan');savedPlans=plans.items;expected=await rpc('timelines',{name:'read',input:{resourceId:timelineId}});
    await cdp.evaluate(`(()=>{const o=document.querySelector('.aw-timeline [aria-label="Orientation"]');o.value='horizontal';o.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.aw-timeline-plan-band')?.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});})()`);await sleep(400);await cdp.evaluate(`document.querySelector('.aw-timeline-plan-band')?.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})`);await capture('timeline-planning');return {items:savedPlans,resourceVersion:plans.resourceVersion};
  });
  await step('LI19 actual Stream Flow and Forensic remain distinct', async () => {
    await cdp.evaluate(`window.__aerynth.openResource({resourceId:${expr(streamId)},preferredPresentation:'direct'})`);
    await wait('Stream modes', () => cdp.evaluate(`!!document.querySelector('.aw-stream-modes')`));
    const flow = await cdp.evaluate(`(()=>{const n=document.querySelector('.aw-stream-modes');return {buttons:[...n.querySelectorAll('button')].map(b=>({name:b.textContent,pressed:b.getAttribute('aria-pressed')})),graph:!!document.querySelector('.aw-stream-graph')}})()`); assert(flow.buttons.some(b => b.name === 'Flow' && b.pressed === 'true'));
    await clickText('.aw-stream-modes', 'Forensic'); assert.equal(await cdp.evaluate(`[...document.querySelectorAll('.aw-stream-modes button')].find(n=>n.textContent==='Forensic').getAttribute('aria-pressed')`), 'true');
    await clickText('.aw-stream-modes', 'Flow'); await sleep(400); await capture('stream-flow'); return flow;
  });
  await step('LI02 actual Library finite synthetic replay', async () => {
    await cdp.evaluate(`document.querySelector('[data-surface-id="canonical-resource"] .aw-contextual-dismiss')?.click()`);
    const controls = await cdp.evaluate(`[...document.querySelectorAll('button')].filter(n=>/library/i.test(n.textContent+' '+n.id+' '+n.getAttribute('aria-label'))).map(n=>({id:n.id,text:n.textContent,aria:n.getAttribute('aria-label')}))`); receipt.libraryControls = controls;
    await cdp.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(n=>n.textContent.trim()==='Block Library'||n.id==='add-block'||n.getAttribute('aria-label')==='Block Library');if(!b)throw Error('library entry unavailable');b.click()})()`);
    await wait('library mounted', () => cdp.evaluate(`!!document.querySelector('[data-block-kind="timeline"]')`));
    await cdp.evaluate(`document.querySelector('[data-block-kind="timeline"]').click()`);
    await wait('library demonstration', () => cdp.evaluate(`!!document.querySelector('[data-demo-replay]')`));
    const state = await cdp.evaluate(`(()=>{document.querySelector('[data-demo-replay]').click();return {synthetic:document.querySelector('.aw-showroom-demo').textContent,step:document.querySelector('.aw-showroom-demo .aw-showroom-miniature').dataset.step}})()`); await sleep(1200);
    state.after = await cdp.evaluate(`document.querySelector('.aw-showroom-demo .aw-showroom-miniature')?.dataset.step`); assert.notEqual(state.step, state.after); await capture('library-replay');
    const before = await rpc('desktop', {type:'snapshot'});
    await cdp.evaluate(`document.querySelector('[data-block-kind="note"]').click()`);
    await wait('canonical Note add control', () => cdp.evaluate(`!![...document.querySelectorAll('.aw-library__detail button')].find(n=>n.textContent==='Add New Note'&&!n.disabled)`));
    await clickText('.aw-library__detail','Add New Note');
    const after = await wait('canonical library-created Note block', async()=>{const snapshot=await rpc('desktop',{type:'snapshot'});return snapshot.blocks.length>before.blocks.length&&snapshot;});
    const added=after.blocks.find(b=>!before.blocks.some(old=>old.id===b.id)); assert(added);assert(after.resources.some(r=>r.id===added.resource_id&&r.kind==='note'));state.canonicalAdd={blockId:added.id,resourceId:added.resource_id}; return state;
  });
  await step('LI12 native countdown preset/start/pause/resume and real world dials',async()=>{
    await cdp.evaluate(`document.querySelector('[data-surface-id="block-library"] .aw-contextual-dismiss')?.click()`);
    await cdp.evaluate(`window.__aerynth.execute({type:'createWorkspace',projectId:null,title:'SYNTHETIC native timer review'})`);
    await pointerClick(`document.querySelector('.aw-workspace-add')`);
    await wait('clock library tile',()=>cdp.evaluate(`!!document.querySelector('[data-block-kind="clock_timer"]')`));
    await pointerClick(`document.querySelector('[data-block-kind="clock_timer"]')`);
    await wait('native canonical clock Add ready',()=>cdp.evaluate(`[...document.querySelectorAll('.aw-library__detail button')].some(n=>n.textContent==='Add New Clock & Timers'&&!n.disabled)`));
    await clickText('.aw-library__detail','Add New Clock & Timers');
    const created=await wait('native Library canonical clock resource',async()=>{const d=await rpc('desktop',{type:'snapshot'});return d.resources.find(r=>r.kind==='clock_timer');});timerId=created.id;assert(timerId);
    await cdp.evaluate(`window.__aerynth.openResource({resourceId:${expr(timerId)},preferredPresentation:'direct'})`);
    await wait('native clock view ready',()=>cdp.evaluate(`!!document.querySelector('.aw-clock-timer [data-clock-action="presetFocus"]:not(:disabled)')`));
    await cdp.evaluate(`document.querySelector('.aw-clock-timer [data-clock-action="presetFocus"]').closest('details').open=true;document.querySelector('.aw-clock-timer [data-clock-action="presetFocus"]').click()`);
    await clickText('.aw-clock-timer','Add timer');
    const readTimer=()=>rpc('clockTimers',{name:'read',input:{resourceId:timerId}});
    let doc=await wait('real preset canonical countdown',async()=>{const d=await readTimer();return d.timers?.length===1&&d;});assert.equal(doc.timers[0].durationMs,1500000);assert.equal(doc.timers[0].state,'ready');
    await wait('start control ready',()=>cdp.evaluate(`!!document.querySelector('.aw-clock-timer [data-clock-action="startTimer"]:not(:disabled)')`));await clickText('.aw-clock-timer','Start');
    doc=await wait('trusted native running countdown',async()=>{const d=await readTimer();return d.timers[0].state==='running'&&d;});const running=doc.timers[0];await sleep(250);
    doc=await readTimer();assert(doc.timers[0].remainingMs<running.remainingMs,'trusted elapsed time must decrease');
    await wait('pause ready',()=>cdp.evaluate(`!!document.querySelector('.aw-clock-timer [data-clock-action="pauseTimer"]:not(:disabled):not([hidden])')`));await clickText('.aw-clock-timer','Pause');doc=await wait('canonical paused',async()=>{const d=await readTimer();return d.timers[0].state==='paused'&&d;});
    const held=doc.timers[0].remainingMs;await sleep(200);assert.equal((await readTimer()).timers[0].remainingMs,held);
    await wait('resume control ready',()=>cdp.evaluate(`!!document.querySelector('.aw-clock-timer [data-clock-action="resumeTimer"]:not(:disabled):not([hidden])')`));await clickText('.aw-clock-timer','Resume');doc=await wait('canonical resumed',async()=>{const d=await readTimer();return d.timers[0].state==='running'&&d;});await capture('timer-running');
    await clickText('.aw-clock-timer','Clock');
    await cdp.evaluate(`(()=>{const field=document.querySelector('.aw-clock-timer [aria-label="IANA time zone"]');field.closest('details').open=true;field.value='Asia/Tokyo';document.querySelector('.aw-clock-timer [aria-label="World clock name"]').value='SYNTHETIC Tokyo';})()`);await clickText('.aw-clock-timer','Add world clock');
    doc=await wait('canonical world clock saved',async()=>{const d=await readTimer();return d.worldClocks?.some(c=>c.timeZone==='Asia/Tokyo')&&d;});
    await wait('world dial reflects real clock',()=>cdp.evaluate(`!!document.querySelector('.aw-clock-timer-dial--world[data-clock-zone="Asia/Tokyo"]')`));await capture('world-clock-dials');
    await clickText('.aw-clock-timer','Timers');await wait('pause after world view',()=>cdp.evaluate(`!!document.querySelector('.aw-clock-timer [data-clock-action="pauseTimer"]:not(:disabled):not([hidden])')`));await clickText('.aw-clock-timer','Pause');savedTimer=await wait('timer held before restart',async()=>{const d=await readTimer();return d.timers[0].state==='paused'&&d;});
    return {resourceId:timerId,timer:savedTimer.timers[0],worldClocks:savedTimer.worldClocks};
  });
  await step('Bounded renderer callback and heap observations',async()=>{
    await cdp.command('Performance.enable');const before=await cdp.command('Performance.getMetrics');
    const intervals=await cdp.evaluate(`new Promise(resolve=>{const intervals=[];let previous=performance.now(),began=previous;function sample(now){intervals.push(now-previous);previous=now;if(now-began>=3000||intervals.length>=240)resolve(intervals);else requestAnimationFrame(sample);}requestAnimationFrame(sample);})`);
    const after=await cdp.command('Performance.getMetrics'),sorted=[...intervals].sort((a,b)=>a-b),percentile=q=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*q))];
    return {kind:'renderer callback intervals only; no monitor presentation or input latency claim',intervalsMs:intervals,p50Ms:percentile(.5),p95Ms:percentile(.95),p99Ms:percentile(.99),intervalsOver16_67Ms:intervals.filter(v=>v>16.67).length,before:before.metrics,after:after.metrics};
  });
  await step('SYNTHETIC thirteen-state native geometry and bounded morph evidence',async()=>{
    const states=['idle','aware','wake-armed','listening','interpreting','planning','acting','coordinating','speaking','waiting','needs-input','verified','blocked'];
    await cdp.evaluate(`window.__aerynth.execute({type:'createWorkspace',projectId:null,title:'SYNTHETIC EMPTY geometry study'})`);
    await wait('own empty geometry workspace',()=>cdp.evaluate(`(()=>{const s=window.__aerynth.application();return s.navigation.kind==='workspace'&&!s.blocks.some(b=>b.workspace_id===s.activeWorkspaceId)})()`));
    const before=(await rpc('desktop',{type:'snapshot'})).resources.map(r=>({id:r.id,version:r.version}));
    const observation=()=>cdp.evaluate(`(()=>{const s=window.__aerynth.snapshot();const banner=document.querySelector('[data-synthetic-vela-study]');return {study:s.visualStudy,bounds:s.gpu?.presenceBounds,frames:s.gpu?.framesRendered,projection:s.gpu?.presenceProjection,rendererTimeMs:performance.now(),viewport:{w:innerWidth,h:innerHeight},banner:banner?.textContent}})()`);
    async function capturePresence(name){const view=await observation();assert.equal(view.study?.classification,'simulated');const b=view.bounds;assert(b&&[b.x,b.y,b.w,b.h].every(Number.isFinite)&&b.w>0&&b.h>0,'actual renderer presence bounds required');const left=Math.max(0,Math.floor(b.x-24)),top=Math.max(0,Math.floor(b.y-24)),right=Math.min(view.viewport.w,Math.ceil(b.x+b.w+24)),bottom=Math.min(view.viewport.h,Math.ceil(b.y+b.h+24));assert(right>left&&bottom>top,'observed presence must intersect viewport');view.viewportClipped=b.x<0||b.y<0||b.x+b.w>view.viewport.w||b.y+b.h>view.viewport.h;await capture(name,{x:left,y:top,width:right-left,height:bottom-top,scale:.75},view);return view;}
    const targets=[],transition=[];
    try{
      assert(await cdp.evaluate(`typeof window.__aerynth.setVelaVisualStateForReview==='function'`),'explicit geometry fixture required');
      await cdp.evaluate(`window.__aerynth.setPresenceScaleForReview(null);window.__aerynth.setVelaVisualStateForReview('idle')`);await sleep(900);
      const banner=await observation();assert.match(banner.banner,/SYNTHETIC geometry study/);await capture('synthetic-vela-study-banner',undefined,banner);
      for(const state of states){await cdp.evaluate(`window.__aerynth.setVelaVisualStateForReview(${expr(state)})`);await sleep(900);const view=await capturePresence('synthetic-vela-target-'+state);assert.equal(view.study.state,state);targets.push({state,rendererTimeMs:view.rendererTimeMs,frames:view.frames,bounds:view.bounds,viewportClipped:view.viewportClipped});}
      await cdp.evaluate(`window.__aerynth.setVelaVisualStateForReview('interpreting')`);await sleep(900);
      const began=await cdp.evaluate(`(()=>{window.__aerynth.setVelaVisualStateForReview('acting');return performance.now()})()`);
      for(let frame=0;frame<6;frame++){if(frame)await sleep(90);const view=await capturePresence('synthetic-vela-morph-'+String(frame).padStart(2,'0'));transition.push({frame,elapsedRendererMs:view.rendererTimeMs-began,frames:view.frames,bounds:view.bounds});}
    }finally{await cdp.evaluate(`window.__aerynth.setVelaVisualStateForReview(null);window.__aerynth.setPresenceScaleForReview(null)`);}
    assert.equal((await observation()).study,null,'geometry fixture must end');
    const after=(await rpc('desktop',{type:'snapshot'})).resources.map(r=>({id:r.id,version:r.version}));assert.deepEqual(after,before,'geometry fixture must not mutate canonical resources');
    return {classification:'simulated',backendMappingValidated:false,targets,transition,uniquePngHashes:new Set(receipt.captures.filter(c=>c.file.includes('synthetic-vela-')).map(c=>c.sha256)).size,limits:'Crops use actual current renderer presence bounds at 0.75 capture scale; viewport-clipped bounds are disclosed. Hashes/timing are evidence only, not subjective distinctness or motion acceptance.'};
  });
  if(!interactionOnly&&!timerOnly)receipt.limitations.push('All thirteen Vela silhouettes are explicitly simulated geometry studies, not native evidence of thirteen live backend or voice states. Crops carry synthetic filenames/receipt classification; full-frame banner capture proves the unavoidable fixture label.');
  receipt.rendererSamples.push({phase:'after-populated-views',observation:await cdp.evaluate('(()=>{const s=window.__aerynth.snapshot();return {metrics:s.metrics,gpu:s.gpu,graphicsFailed:s.graphicsFailed,active:s.active}})()')});
  await cdp.evaluate('window.__aerynth.flush()'); await closeNative(); await budget();
  if(missionOnly)await step('Mission native restart retains actual mission evidence and graph binding',async()=>{
    await launch();await cdp.evaluate(`window.__aerynth.execute({type:'navigate',target:{kind:'workspace',workspaceId:${expr(missionFixture.workspaceId)}}})`);const mission=await rpc('missions',{name:'read',input:{id:missionFixture.missionId}});assert.equal(mission.outcome,'verified');assert.deepEqual(mission.tasks.map(t=>({id:t.id,dependencies:t.dependencies})),missionCanonical.tasks.map(t=>({id:t.id,dependencies:t.dependencies})));
    await cdp.evaluate(`window.__aerynth.openResource({resourceId:${expr(missionFixture.graphResourceId)},preferredPresentation:'direct'})`);await wait('restored canonical mission Graph',()=>cdp.evaluate(`!!document.querySelector('[data-surface-id="canonical-resource"] [data-mission-id="'+${expr(missionFixture.missionId)}+'"] .aw-mission-task')`));return{missionId:mission.id,outcome:mission.outcome,graphResourceId:missionFixture.graphResourceId,tasks:mission.tasks.map(t=>({id:t.id,state:t.state,dependencies:t.dependencies}))};
  });
  if(interactionOnly)await step('LI15 interaction restart retains dropped placement and edited plan',async()=>{
    assert(interactionPlacement&&interactionResource&&(dropOnly||interactionFinalPlans),'interaction prerequisites required');await launch();const desktop=await rpc('desktop',{type:'snapshot'}),placement=desktop.blocks.find(b=>b.id===interactionPlacement.id);assert(placement);assert.equal(placement.resource_id,interactionResource.id);assert.deepEqual({x:placement.x,y:placement.y,width:placement.width,height:placement.height},{x:interactionPlacement.x,y:interactionPlacement.y,width:interactionPlacement.width,height:interactionPlacement.height});
    if(dropOnly)return {placement,resourceId:interactionResource.id,scope:'Dropped canonical resource and placement after undo/redo/restart'};const doc=await rpc('timelines',{name:'read',input:{resourceId:timelineId}}),plans=await rpc('timelines',{name:'planning',input:{op:'list',resourceId:timelineId,expectedVersion:doc.resource.version}});assert.deepEqual(plans.items,interactionFinalPlans);return {placement,plannedItems:plans.items};
  });
  if (timerOnly) await step('LI15 native timer restart retains paused duration and world zone', async () => {
    assert(timerId && savedTimer, 'Timer lifecycle must pass before restart');
    await launch();
    const timer = await rpc('clockTimers', { name: 'read', input: { resourceId: timerId } });
    assert.equal(timer.timers[0].state, 'paused');
    assert.equal(timer.timers[0].remainingMs, savedTimer.timers[0].remainingMs);
    assert.equal(timer.worldClocks[0].timeZone, 'Asia/Tokyo');
    return { resourceId: timerId, state: timer.timers[0].state, remainingMs: timer.timers[0].remainingMs, timeZone: timer.worldClocks[0].timeZone };
  });
  await step('LI15 restart restores exact canonical Timeline viewport and selected event', async () => {
    assert(expected, 'initial canonical zoom required'); await launch();
    const restored = await rpc('timelines', { name: 'read', input: { resourceId: timelineId } }); assert.deepEqual(restored.view, expected.view); assert.equal(restored.resource.id, timelineId);
    await cdp.evaluate(`window.__aerynth.openResource({resourceId:${expr(timelineId)},preferredPresentation:'direct'})`); await wait('restored Timeline', () => cdp.evaluate(`document.querySelector('.aw-timeline')?.getAttribute('aria-busy')==='false'`)); const plans=await rpc('timelines',{name:'planning',input:{op:'list',resourceId:timelineId,expectedVersion:restored.resource.version}});assert.deepEqual(plans.items,savedPlans);const timer=await rpc('clockTimers',{name:'read',input:{resourceId:timerId}});assert.equal(timer.timers[0].state,'paused');assert.equal(timer.timers[0].remainingMs,savedTimer.timers[0].remainingMs);assert.equal(timer.worldClocks[0].timeZone,'Asia/Tokyo');return { resourceId: timelineId, selection: restored.view.selection, viewport: restored.view.viewport,planningItems:plans.items,timerResourceId:timerId };
  });
  await closeNative();
  core = new BackendCore({ path: path.join(profile, 'aerynth.sqlite'), provider: 'fixture', contentPolicy: 'synthetic-only' });
  const snapshot = await core.command('snapshot', {}); receipt.canonicalExecutionCount = Object.keys(snapshot.executions).length; assert.equal(receipt.canonicalExecutionCount, 0); await core.command('close', {}); core = null;
  await step('Native GPU compile and renderer diagnostics', async () => { assert(!receipt.rendererErrors.some(error => /shader|compile|webgl|gpu|gl_invalid/i.test(error)), 'GPU compilation/render error: '+receipt.rendererErrors.join(' ')); for(const sample of receipt.rendererSamples){assert.notEqual(sample.observation.graphicsFailed,true);assert.equal(sample.observation.gpu?.contextLost,false);assert.equal(sample.observation.metrics?.errors?.length,0);} return {samples:receipt.rendererSamples.length,consoleErrors:receipt.rendererErrors.length}; });
  receipt.passed = receipt.checks.every(check => check.passed);
} catch (error) { receipt.errors.push(error.stack ?? error.message); if (cdp) { receipt.nativeLog = cdp.log().slice(-6000); await capture('failure').catch(() => {}); } }
finally { if (core) await core.command('close', {}).catch(() => {}); await closeNative().catch(() => {}); for (const child of children) killOwned(child); clearTimeout(hardStop); receipt.elapsedMs = Date.now() - started; receipt.finished = new Date().toISOString(); await budget().catch(error => receipt.errors.push(error.message)); const json = JSON.stringify(receipt, null, 2); assert(Buffer.byteLength(json) <= MiB, 'receipt JSON budget'); const file = path.join(evidence, 'journey.json'); await writeFile(file, json, { flag: 'wx' }); console.log(JSON.stringify({ passed: receipt.passed, receipt: file, checks: receipt.checks.map(({name,passed,error}) => ({name,passed,error})), errors: receipt.errors, elapsedMs: receipt.elapsedMs })); }
process.exitCode = receipt.passed ? 0 : 1;
