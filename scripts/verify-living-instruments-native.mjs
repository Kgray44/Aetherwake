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
import { BackendCore } from '../prototypes/integrated-backend/src/core.mts';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(repo, 'prototypes/visual-experience/cinematic-v3');
const MiB = 1048576, started = Date.now(), deadline = started + 120000;
const timerOnly = process.argv.includes('--timer-only');
assert.equal(process.platform, 'win32', 'Windows native verification required');
const guard = path.join(process.env.LOCALAPPDATA, 'AeroStorageWatch/ReserveGuard.ps1');
function admission() { const result = execFileSync('powershell.exe', ['-NoProfile', '-File', guard, '-EstimatedCBytes', String(256 * MiB), '-EstimatedDBytes', '0'], { encoding: 'utf8', windowsHide: true }); const receipt = JSON.parse(result.trim()); assert.equal(receipt.allowed, true, 'storage reserve admission denied'); return receipt; }
const reserve = admission();
const profile = path.join(process.env.LOCALAPPDATA, 'Aerynth', 'review-living-instruments-' + started);
assert.match(path.basename(profile), /^review-living-instruments-\d+$/);
await mkdir(profile, { recursive: false });
const evidence = path.join(profile, 'living-instruments-evidence'); await mkdir(evidence);
const receipt = { contract: 'aerynth.living-instruments-native@1', started: new Date(started).toISOString(), profile, syntheticOnly: true, passed: false, reserve, source: {}, checks: [], captures: [], errors: [], limits: { runtimeMs: 120000, totalAllocationBytes: 256 * MiB, profileBytes: 128 * MiB, pngBytes: 16 * MiB, jsonBytes: MiB }, limitations: ['Actual Electron renderer controlled through owned localhost CDP; software pointer input at observed unobscured control bounds and reviewed application controller, not physical OS input. Preload user-activation gates remain intact.', 'Local synthetic canonical resources; no provider, voice, credential, account or external-source commands issued by this runner.', 'Recorded-time review is retained headers only; editable planning records are separate and do not reconstruct historical state.', 'Screenshots are native renderer evidence, not artistic, monitor-presentation, accessibility or performance acceptance.', 'Presentation orientation/detail are temporary. Restart verifies canonical viewport/selection/resource identity.', 'No native-process provider-attempt observer is exposed in normal mode; zero provider executions is checked from canonical state, not inferred zero network activity.', 'ReserveGuard bounds this owned operation; external applications and already-running writers are outside its coverage.'] };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const file of ['prototypes/visual-experience/cinematic-v3/src/main.ts','prototypes/timeline-product/contracts.ts','prototypes/timeline-product/service.mts','prototypes/integrated-backend/src/timeline-domain.mts','prototypes/visual-experience/cinematic-v3/native/product-commands.cjs','prototypes/visual-experience/cinematic-v3/src/product-clients.ts','prototypes/visual-experience/cinematic-v3/src/vela-visual-state.ts','prototypes/visual-experience/cinematic-v3/src/vela-shape.ts','prototypes/visual-experience/cinematic-v3/src/renderer.ts','prototypes/block-library/timeline-view.ts','prototypes/block-library/temporal-planning.ts','prototypes/visual-experience/cinematic-v3/src/clock-timer-view.ts','prototypes/block-library/temporal-projection.ts','prototypes/block-library/stream-view.ts','prototypes/block-library/showroom.ts','prototypes/visual-experience/cinematic-v3/dist/index.html']) receipt.source[file] = hash(await readFile(path.join(repo, file)));
for (const file of await readdir(path.join(root, 'dist/assets'))) if (/\.(js|css)$/.test(file)) receipt.source['dist/assets/' + file] = hash(await readFile(path.join(root, 'dist/assets', file)));
const children = new Set(); let cdp, core, pngBytes = 0;
receipt.rendererErrors = [];
function checkDeadline() { assert(Date.now() < deadline, 'native run deadline'); }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ownedSize(directory) { let bytes = 0; for (const entry of await readdir(directory, { withFileTypes: true })) { const full = path.join(directory, entry.name); if (entry.isDirectory()) bytes += await ownedSize(full); else bytes += (await stat(full)).size; } return bytes; }
async function budget() { checkDeadline(); const bytes = await ownedSize(profile); assert(bytes <= 128 * MiB, 'owned profile byte budget'); receipt.profileBytes = bytes; }
function killOwned(child) { if (child && child.exitCode === null) { try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 }); } catch {} } }
const hardStop = setTimeout(() => { for (const child of children) killOwned(child); }, 118000);
async function wait(label, fn, ms = 10000) { const until = Math.min(deadline - 2000, Date.now() + ms); let last; while (Date.now() < until) { checkDeadline(); try { const value = await fn(); if (value) return value; } catch (error) { last = error.message; } await sleep(100); } throw Error(label + ': timed out' + (last ? ' (' + last + ')' : '')); }
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
  await command('Runtime.enable'); await command('Log.enable'); await command('Page.bringToFront');
  receipt.rendererSamples ??= []; receipt.rendererSamples.push({phase:'ready',observation:await evaluate('(()=>{const s=window.__aerynth.snapshot();return {metrics:s.metrics,gpu:s.gpu,graphicsFailed:s.graphicsFailed,active:s.active}})()')});
  receipt.processes ??= []; receipt.processes.push({ pid: child.pid, page: target.url });
  return cdp;
}
async function closeNative() { if (!cdp) return; const owned = cdp; try { await owned.evaluate('window.__aerynth.flush().then(()=>window.close())'); } catch {} await wait('owned Electron close', () => owned.child.exitCode !== null, 7000).catch(() => killOwned(owned.child)); owned.socket.close(); receipt.processes.at(-1).exitCode = owned.child.exitCode; cdp = null; }
async function capture(name, clip, observation) { await budget(); const capturedAt=new Date().toISOString();const { data } = await cdp.command('Page.captureScreenshot', { format: 'png', ...(clip?{clip}: {}) }); const png = Buffer.from(data, 'base64'); assert(png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), 'PNG required'); assert(pngBytes + png.length <= 16 * MiB, 'PNG budget'); pngBytes += png.length; const file = path.join(evidence, name + '.png'); await writeFile(file, png, { flag: 'wx' }); receipt.captures.push({ file, bytes: png.length, sha256: hash(png),capturedAt,...(clip?{clip}:{}),...(observation?{observation}:{}) }); }
async function step(name, work) { if (timerOnly && !name.startsWith('LI12') && !name.startsWith('LI15 native timer restart') && !name.startsWith('Native GPU')) { (receipt.skippedChecks ??= []).push(name); return; } checkDeadline(); const began = Date.now(); try { const value = await work(); receipt.checks.push({ name, passed: true, ms: Date.now() - began, ...(value ? { observation: value } : {}) }); } catch (error) { receipt.checks.push({ name, passed: false, ms: Date.now() - began, error: error.message }); } }
const expr = value => JSON.stringify(value);
async function pointerClick(expression) {
  let previous;
  const point=await wait('visible unobscured software pointer target',async()=>{
    const p=await cdp.evaluate(`(()=>{const b=${expression};if(!b||b.disabled||b.closest('[hidden],[inert]'))return null;b.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});const r=b.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);if(r.width<=0||r.height<=0||x<0||y<0||x>=innerWidth||y>=innerHeight||!hit||!(hit===b||b.contains(hit)))return null;return{x,y}})()`);
    if(!p){previous=null;return false;}const stable=previous&&Math.abs(previous.x-p.x)<1&&Math.abs(previous.y-p.y)<1;previous=p;return stable&&p;
  });
  await cdp.command('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
  await cdp.command('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
  await cdp.command('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
}
async function clickText(container,text){await pointerClick(`[...document.querySelector(${expr(container)})?.querySelectorAll('button')??[]].find(n=>n.textContent.trim()===${expr(text)})`);}
async function rpc(name, input) { const value = await cdp.evaluate(`window.aerynthHost.command(${expr(name)},${expr(input)})`); assert(value && value.ok !== false, JSON.stringify(value)); return value.result?.result ?? value.result ?? value; }
let timelineId, streamId, expected, timerId, savedPlans, savedTimer;
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
  const stream = await core.command('desktop', { type: 'createResource', kind: 'stream', title: 'SYNTHETIC native Stream', workspaceId }); streamId = stream.resources.find(value => value.kind === 'stream').id;
  receipt.fixture = { timelineId, streamId, workspaceId }; receipt.seedProviderActivity = await core.command('providerActivity', {});
  await core.command('close', {}); core = null;
  await launch();
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
  receipt.limitations.push('All thirteen Vela silhouettes are explicitly simulated geometry studies, not native evidence of thirteen live backend or voice states. Crops carry synthetic filenames/receipt classification; full-frame banner capture proves the unavoidable fixture label.');
  receipt.rendererSamples.push({phase:'after-populated-views',observation:await cdp.evaluate('(()=>{const s=window.__aerynth.snapshot();return {metrics:s.metrics,gpu:s.gpu,graphicsFailed:s.graphicsFailed,active:s.active}})()')});
  await cdp.evaluate('window.__aerynth.flush()'); await closeNative(); await budget();
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
