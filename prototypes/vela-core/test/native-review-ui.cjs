/* Historical applied-plan readability ONLY. No new assistant/provider qualification.
 * The explicit native host supplies a dedicated clone; this module never clones data.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {createDriver} = require('../../visual-experience/cinematic-v3/native/desktop-verify.cjs');
const runtime = path.resolve(__dirname,'../../visual-experience/cinematic-v3/.runtime');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const stable = value => Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const digest = value => hash(JSON.stringify(stable(value)));
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
const inside = (root,file) => {const part=path.relative(root,file);return !!part&&!part.startsWith('..')&&!path.isAbsolute(part);};
const sort = values => [...values].sort((a,b)=>a.id.localeCompare(b.id));
const placements = (desktop,id) => sort((desktop.navigationBlocks??desktop.blocks).filter(block=>block.workspace_id===id));
const note = value => Object.fromEntries(['id','title','kind','project_id','version','content','state'].map(key=>[key,value[key]??null]));
const chat = value => ({conversation:value.conversation,messages:value.messages.items,total:value.messages.total});
const identity = value => Object.fromEntries(['identity','conversation','requests','plans','receipts','preferences','adaptation','planningReferences'].map(key=>[key,value[key]]));
function durableIdentity(value) {
  const result=structuredClone(value);assert.equal(typeof result.adaptation?.applicationAvailable,'boolean','Unknown runtime adaptation capability');
  delete result.adaptation.applicationAvailable;return result;
}
function reviewDeadline(value) {
  assert(value===undefined||Number.isFinite(value)&&value>1500&&value<=85000,'invalid_vela_review_ui_deadline');
  return Math.min(value??25000,25000);
}
function assertCheckpoint(actual,expected,original) {
  assert.equal(expected.contract,'aerynth.vela-live-restore@1');
  assert.equal(original.contract,'aerynth.actual-vela-live-workspace@1');assert.equal(original.passed,true);assert.equal(original.restore,false);assert.equal(original.resume,false);
  assert(original.nativeReview&&original.providerEvidence,'Successful original native provider evidence required');
  assert.deepEqual(original.nativeReview,expected.nativeReview);assert.deepEqual(original.providerEvidence.execution,expected.executions[0]);
  assert.equal(digest(original.nativeReview.prompt),original.nativeReview.promptDigest);assert.equal(digest(original.nativeReview.context),original.nativeReview.contextDigest);
  assert.deepEqual(expected.vela.requests.find(item=>item.id===expected.requestId)?.context,original.nativeReview.context);
  const originalInputs=original.providerEvidence.output.messages.filter(item=>item.role==='user');assert.equal(originalInputs.length,1);assert.equal(originalInputs[0].content,original.nativeReview.prompt);
  assert.deepEqual(actual.executions,expected.executions,'Clone must retain only the original canonical execution');
  assert.deepEqual(durableIdentity(identity(actual.vela)),durableIdentity(expected.vela),'Clone canonical Vela history/requests/plans/receipts/preferences mismatch');
  assert.deepEqual(actual.vela.attention,expected.attention);
  const d=actual.desktop;
  assert.deepEqual(d.projects,[expected.project]);assert.deepEqual(sort(d.workspaces),sort([expected.origin,expected.workspace]));
  assert.deepEqual(placements(d,expected.origin.id),expected.originPlacements);assert.deepEqual(placements(d,expected.workspace.id),expected.targetPlacements);
  assert.equal((d.navigationBlocks??d.blocks).length,4,'Unknown cloned layout');assert.equal(d.activeWorkspaceId,expected.workspace.id,'Clone must open the recorded workspace without navigation');
  assert.deepEqual(d.navigation,{kind:'workspace',workspaceId:expected.workspace.id});
  assert.deepEqual(chat(actual.chat),expected.chat);assert.deepEqual(chat(actual.provider),original.providerEvidence.output);
  assert.deepEqual(note(d.resources.find(item=>item.id===expected.note.id)),expected.note);
  assert.deepEqual(d.resources.map(item=>item.id).sort(),[expected.chat.conversation.resourceId,expected.note.id,expected.vela.conversation.resourceId,original.providerEvidence.execution.resourceId].sort(),'Unexpected clone resource set');
  const request=actual.vela.requests.find(item=>item.id===expected.requestId),plan=actual.vela.plans.find(item=>item.id===expected.planId);
  assert(request?.state==='completed'&&plan?.state==='applied','Historical review requires the recorded applied plan');
  assert(request.intent.length>=500,'Review source must retain the actual long request');
  assert.equal(plan.steps.length,1);assert.equal(plan.steps[0].action.type,'workspaceFromResources');assert.equal(actual.vela.preferences.delegationEnabled,false);
  assert.equal(actual.vela.receipts.length,1);assert.equal(actual.vela.receipts[0].state,'applied');assert.equal(actual.vela.receipts[0].providerId,null);
  assert.equal(actual.executions[0].state,'provider_completed');assert.equal(actual.executions[0].taskVerified,false);
  const execution=actual.executions[0],contribution=original.providerEvidence.contribution;
  assert.equal(execution.providerId,'codex-app-server');assert(execution.binding?.nativeThreadId&&execution.turnId,'Retained native provider identities required');
  assert.equal(contribution.executionId,execution.id);assert.equal(contribution.providerId,execution.providerId);assert.equal(contribution.nativeThreadId,execution.binding.nativeThreadId);assert.equal(contribution.nativeTurnId,execution.turnId);assert.deepEqual(plan.contribution,contribution);
  assert(!actual.executions.some(item=>['queued','running','starting','cancelling'].includes(item.state)),'Active execution forbids review-only mode');
}
function canonicalProjection(value) {
  const d=value.desktop;
  return {desktop:Object.fromEntries(['projects','workspaces','resources','blocks','navigationBlocks','activeWorkspaceId','navigation','viewport','organization','presence'].map(key=>[key,d[key]])),vela:identity(value.vela),attention:value.vela.attention,chat:chat(value.chat),provider:chat(value.provider),executions:value.executions};
}
const rectValid = r => r&&['left','top','right','bottom','width','height'].every(key=>Number.isFinite(r[key]))&&r.width>0&&r.height>0;
const intersects = (a,b) => Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1;
function assertGeometry(frame) {
  assert(frame&&['shell','flow','compose','editor'].every(key=>rectValid(frame[key]?.rect)),'Unknown review geometry');
  assert(Number.isFinite(frame.effectiveOpacity)&&frame.effectiveOpacity>=.99,'Historical reading surface is not opaque');
  assert(Number.isFinite(frame.view?.width)&&Number.isFinite(frame.view?.height)&&frame.shell.rect.left>=0&&frame.shell.rect.top>=0&&frame.shell.rect.right<=frame.view.width+1&&frame.shell.rect.bottom<=frame.view.height+1,'Reading surface is clipped by the native viewport');
  assert(frame.flow.overflowY==='auto'||frame.flow.overflowY==='scroll','Conversation must own a bounded native scroll');
  assert(frame.flow.rect.bottom<=frame.compose.rect.top+1.5,'Reading viewport overlaps the stable composer');
  assert(frame.groups.length>0&&frame.groups.length<=80,'Unknown reading groups');
  for(const group of frame.groups){
    assert(group.scrollOwner==='flow'||group.scrollOwner==='evidence','Reading text has the wrong scroll owner');
    assert(rectValid(group.rect)&&rectValid(group.ownerRect),'Unknown text ownership geometry');
    if(group.scrollOwner!=='evidence')assert(group.rect.top>=group.ownerRect.top-1.5&&group.rect.bottom<=group.ownerRect.bottom+1.5&&group.rect.left>=group.ownerRect.left-1.5&&group.rect.right<=group.ownerRect.right+1.5,'Reading group escapes its message/plan owner');
    assert(group.lines.length>0&&group.lines.length<=2048,'Missing or unbounded actual text rectangles');
    for(const line of group.lines){
      assert(rectValid(line.rect),'Unknown actual text rectangle');
      if(group.scrollOwner!=='evidence')assert(line.rect.top>=group.rect.top-1.5&&line.rect.bottom<=group.rect.bottom+1.5&&line.rect.left>=group.rect.left-1.5&&line.rect.right<=group.rect.right+1.5,'Text paints outside its nonshrinking reading group: '+group.key);
    }
  }
  const visible=frame.groups.flatMap(group=>group.lines.filter(line=>line.visible).map(line=>({group:group.key,rect:line.visible})));
  for(let i=0;i<visible.length;i++)for(let k=i+1;k<visible.length;k++)if(visible[i].group!==visible[k].group)assert(!intersects(visible[i].rect,visible[k].rect),'Visible reading text groups overlap: '+visible[i].group+' / '+visible[k].group);
  assert(frame.editor.name==='Message Vela'&&!frame.editor.disabled&&frame.editor.hitTest===true,'Composer accessibility changed or editor is occluded');
  for(const control of frame.controls){assert(control.name&&control.nodeId&&rectValid(control.rect),'Missing or inaccessible actual reading control');if(!control.insideFlow)assert(control.hitTest===true&&control.rect.left>=frame.compose.rect.left-1&&control.rect.right<=frame.compose.rect.right+1&&control.rect.top>=frame.compose.rect.top-1&&control.rect.bottom<=frame.compose.rect.bottom+1,'Composer control is clipped, occluded or outside its owner');}
  assert(!frame.controls.some(control=>/Approve and apply|Apply approved plan|Reject plan/.test(control.name)),'Applied history must not expose actionable review controls');
  return frame;
}
function assertRetained(before,after) {
  for(const key of ['shell','flow','compose','editor']){
    assert.equal(after[key].nodeId,before[key].nodeId,'Reading/editor DOM identity changed: '+key);
    for(const field of ['left','top','width','height'])assert(Math.abs(after[key].rect[field]-before[key].rect[field])<=.75,'Reading/editor placement changed: '+key+'.'+field);
  }
  for(const key of ['value','selectionStart','selectionEnd'])assert.equal(after.editor[key],before.editor[key],'Composer recovery/selection changed');
  assert.deepEqual(after.groups.map(group=>[group.key,group.nodeId]),before.groups.map(group=>[group.key,group.nodeId]),'Keyed reading controls were replaced');
  assert.deepEqual(after.controls.map(control=>[control.key,control.nodeId,control.name,control.disabled]),before.controls.map(control=>[control.key,control.nodeId,control.name,control.disabled]),'Reading controls changed');
  for(const [index,control] of before.controls.entries()){
    const next=after.controls[index];for(const field of ['left','width','height'])assert(Math.abs(next.rect[field]-control.rect[field])<=.75,'Reading control geometry changed');
    const previousTop=control.rect.top+(control.insideFlow?before.flow.scrollTop:0),nextTop=next.rect.top+(next.insideFlow?after.flow.scrollTop:0);assert(Math.abs(nextTop-previousTop)<=.75,'Reading control placement changed outside native scroll');
  }
}
function assertEventScope(before,after,coverage) {
  assert(coverage&&!coverage.truncated&&!coverage.gapObserved,'Original provider scope is incomplete');
  const scoped=value=>value.events.filter(event=>event.cursor>coverage.afterCursor&&event.cursor<=coverage.latestCursor);
  const previous=scoped(before),current=scoped(after);assert.equal(previous.length,coverage.latestCursor-coverage.afterCursor,'Cloned provider scope is unavailable');
  assert(previous.every((event,index)=>event.cursor===coverage.afterCursor+index+1),'Cloned provider scope has a cursor gap');assert.deepEqual(current,previous,'Historical provider scope changed');
  const beforeIds=new Map(before.events.map(event=>[event.eventId,event]));for(const event of after.events)if(beforeIds.has(event.eventId))assert.deepEqual(event,beforeIds.get(event.eventId),'Retained event changed');
  const latest=before.events.at(-1)?.cursor;assert(Number.isSafeInteger(latest),'Unknown event baseline');
  const added=after.events.filter(event=>event.cursor>latest);assert(added.length<=8&&added.every((event,index)=>event.cursor===latest+index+1&&event.nativeSequence===null&&event.executionId===null&&event.classification==='observed'&&['application/vela.open','application/openVela','application/setViewport'].includes(event.type)),'Review emitted a new provider, grant or action event');
  return added;
}
function recordVisibleLines(frame,seen,required) {
  for(const group of frame.groups)for(const [index,line] of group.lines.entries()){
    const key=group.key+':'+index;required.add(key);
    if(line.visible&&line.visible.width>=line.rect.width-1.5&&line.visible.height>=line.rect.height-1.5)seen.add(key);
  }
}
/** Browser-only OBSERVATION. A WeakMap tags references in memory; no DOM attributes/content/styles are changed. */
function collectGeometry(document,expected) {
  const win=document.defaultView,key=Symbol.for('aerynth.review-ui.readonly-node-probe');
  const registry=win[key]??(win[key]={nodes:new WeakMap(),next:1});
  const id=node=>{if(!registry.nodes.has(node))registry.nodes.set(node,registry.next++);return registry.nodes.get(node);};
  const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
  const scrollPort=node=>{const r=rect(node),left=r.left+node.clientLeft,top=r.top+node.clientTop;return {left,top,right:left+node.clientWidth,bottom:top+node.clientHeight,width:node.clientWidth,height:node.clientHeight};};
  const hitTest=node=>{const r=rect(node),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return hit===node||node.contains(hit);};
  const visible=node=>{for(let n=node;n;n=n.parentElement){const s=win.getComputedStyle(n);if(n.hidden||n.inert||s.display==='none'||s.visibility!=='visible'||Number(s.opacity)<=0)return false;if(n.tagName==='DETAILS'&&!n.open&&!n.querySelector('summary')?.contains(node))return false;}return node.getClientRects().length>0;};
  const shell=document.querySelector('#vela-assistant-surface .vela-core'),flow=shell?.querySelector('.vela-core-scroll'),compose=shell?.querySelector('.vela-core-compose'),editor=compose?.querySelector('textarea');
  if(!shell||!flow||!compose||!editor)throw Error('Actual historical Vela panel unavailable');
  const flowRect=scrollPort(flow),groups=[],controls=[];
  const clip=(a,b)=>{const out={left:Math.max(a.left,b.left),top:Math.max(a.top,b.top),right:Math.min(a.right,b.right),bottom:Math.min(a.bottom,b.bottom)};out.width=out.right-out.left;out.height=out.bottom-out.top;return out.width>0&&out.height>0?out:null;};
  const group=(node,key,owner)=>{
    if(!visible(node)||!node.textContent.trim())return;
    let scrollOwner='flow';for(let n=node;n&&n!==flow;n=n.parentElement){const s=win.getComputedStyle(n);if(/auto|scroll|hidden|clip/.test(s.overflowY)&&n.scrollHeight>n.clientHeight+1){scrollOwner=n.tagName==='PRE'?'evidence':'unexpected';break;}}
    const lines=[],walker=document.createTreeWalker(node,win.NodeFilter.SHOW_TEXT);let text;
    while((text=walker.nextNode())){if(!text.textContent.trim())continue;const range=document.createRange();range.selectNodeContents(text);for(const r of range.getClientRects()){if(r.width<=0||r.height<=0)continue;const box={left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};let shown=clip(box,flowRect);for(let n=node;n&&n!==flow&&shown;n=n.parentElement){const s=win.getComputedStyle(n);if(/auto|scroll|hidden|clip/.test(s.overflowY))shown=clip(shown,scrollPort(n));}lines.push({rect:box,visible:shown});}}
    groups.push({key,nodeId:id(node),rect:rect(node),ownerRect:rect(owner),scrollOwner,lines,textLength:node.textContent.length});
  };
  const articles=[...shell.querySelectorAll('.vela-core-message')];
  if(JSON.stringify(articles.map(n=>n.dataset.messageId))!==JSON.stringify(expected.messageIds))throw Error('Historical message IDs are not rendered exactly');
  for(const article of articles){const content=article.querySelector('p');if(content?.textContent!==expected.messages.find(item=>item.id===article.dataset.messageId)?.content)throw Error('Actual historical message text differs from canonical content');group(article.querySelector('strong'),'message:'+article.dataset.messageId+':author',article);group(content,'message:'+article.dataset.messageId+':content',article);}
  const card=shell.querySelector('[data-plan-id="'+expected.planId+'"]');if(!card||card.dataset.planState!=='applied')throw Error('Actual applied plan unavailable');
  if(card.querySelector('h3')?.textContent!==expected.summary)throw Error('Actual historical plan summary differs from canonical content');
  for(const [index,node] of [...card.querySelectorAll(':scope > p,:scope > h3,.vela-core-effects p')].entries())group(node,'plan:'+index,card);
  const details=card.querySelector('.vela-core-plan-details'),summary=details?.querySelector('summary'),pre=details?.querySelector('pre');if(!details||!summary||!pre)throw Error('Actual plan evidence unavailable');
  group(summary,'plan:evidence-summary',card);if(details.open)group(pre,'plan:evidence',card);
  const all=[...card.querySelectorAll('button,summary'),...compose.querySelectorAll('button')];
  for(const [index,node] of all.entries())if(visible(node))controls.push({key:index,nodeId:id(node),name:node.getAttribute('aria-label')||node.textContent.trim(),disabled:!!node.disabled,insideFlow:flow.contains(node),hitTest:hitTest(node),rect:rect(node)});
  const described=node=>({nodeId:id(node),rect:rect(node)});
  let effectiveOpacity=1;for(let node=shell;node;node=node.parentElement)effectiveOpacity*=Number(win.getComputedStyle(node).opacity);
  return {effectiveOpacity,view:{width:win.innerWidth,height:win.innerHeight},shell:described(shell),flow:{...described(flow),clipRect:flowRect,scrollTop:flow.scrollTop,scrollHeight:flow.scrollHeight,clientHeight:flow.clientHeight,overflowY:win.getComputedStyle(flow).overflowY,background:win.getComputedStyle(flow).backgroundImage},compose:described(compose),editor:{...described(editor),name:editor.getAttribute('aria-label'),hitTest:hitTest(editor),value:editor.value,selectionStart:editor.selectionStart,selectionEnd:editor.selectionEnd,disabled:editor.disabled},groups,controls,evidence:{open:details.open,scrollTop:pre.scrollTop,scrollHeight:pre.scrollHeight,clientHeight:pre.clientHeight,text:pre.textContent},activeNodeId:document.activeElement?id(document.activeElement):null};
}
async function verifyReviewUi({win,privateRoot,source,startupErrors=[],getNativeRequestDiagnostics},slot) {
  const out=path.join(runtime,'application-evidence','vela-review-ui-'+Date.now()),receipt={contract:'aerynth.actual-vela-review-ui@1',mode:'historical-applied-review-only',at:new Date().toISOString(),passed:false,source,privateRoot,actions:[],checks:[],captures:[],frames:[],consoleErrors:startupErrors.slice(0,32).map(item=>({message:String(item.message).slice(0,2048),line:item.line,source:String(item.source??'').slice(0,300)})),bounds:{deadlineMs:slot.deadline-slot.started,pngs:2,pngBytes:8*1024*1024,providerTurns:0,requests:0,grants:0,nativeActions:0},slot:{startedAt:slot.started},limitations:['This mode rechecks rendering of a genuine historical applied plan in a dedicated clone. It is not a new assistant/provider/delegation proof.','GPU acknowledgement is not monitor presentation, performance or artistic acceptance.','Runtime adaptation.applicationAvailable is host-derived; durable policy and user evidence remain exact.']};
  await fs.mkdir(out,{recursive:true});let driver,baseline,sourceFiles;
  const encoded=value=>{const bytes=JSON.stringify(value,null,2);assert(Buffer.byteLength(bytes)<=2*1024*1024,'Review UI receipt exceeds2MiB');return bytes;};
  const consoleError=(event,...args)=>{const {consoleRecord}=require('./native-live.cjs')._offline;const item=consoleRecord(event&&typeof event==='object'&&'level'in event?event:args[0],...args.slice(1));if(item){receipt.consoleErrors.push(item);receipt.consoleErrors=receipt.consoleErrors.slice(-32);}};
  win.webContents.on('console-message',consoleError);
  try {
    assert(process.argv.includes('--integration-vela-live')&&process.argv.includes('--verify-review-ui'),'Explicit review-only flags required');
    assert(!process.argv.some(value=>['--verify-restore','--resume-reviewed-plan','--integration-live'].includes(value)),'Review UI mode cannot submit, restore or resume');
    assert(path.isAbsolute(privateRoot)&&/^[a-z]:[\\/]/i.test(privateRoot)&&!inside(path.resolve(__dirname,'../../..'),privateRoot)&&/^review-vela-review-ui-\d+$/.test(path.basename(privateRoot)),'Fresh external explicit review UI profile required');
    const arg=process.argv.find(value=>value.startsWith('--review-source-evidence='))?.slice('--review-source-evidence='.length);
    assert(arg&&path.isAbsolute(arg)&&inside(runtime,path.resolve(arg))&&path.basename(arg)==='journey.json','Exact successful source receipt required');
    const readBounded=async file=>{const stat=await slot.bound(()=>fs.stat(file));assert(stat.size<=2*1024*1024,'Oversized review source');const bytes=await slot.bound(()=>fs.readFile(file));return {file,bytes,sha256:hash(bytes),value:JSON.parse(bytes)};};
    const original=await readBounded(arg);assert(original.value.passed===true&&!original.value.restore&&!original.value.resume,'Source must be the successful original journey');
    const expectedPath=original.value.expectedFile;assert(expectedPath&&path.isAbsolute(expectedPath)&&/^[a-z]:[\\/]/i.test(expectedPath)&&/^review-vela-live-\d+$/.test(path.basename(path.dirname(expectedPath)))&&path.basename(expectedPath)==='vela-live-expected.json','Closed original live-test checkpoint path required');
    assert.notEqual(await fs.realpath(privateRoot),await fs.realpath(path.dirname(expectedPath)),'Original profile cannot be reviewed in place');
    const expected=await readBounded(expectedPath),copy=await readBounded(path.join(privateRoot,'vela-live-expected.json'));assert.equal(copy.sha256,expected.sha256,'Clone checkpoint differs from original');sourceFiles=[original,expected,copy];
    receipt.reviewSource=sourceFiles.map(({file,sha256,bytes})=>({file,sha256,bytes:bytes.length}));receipt.originalSource=original.value.source;receipt.originalAssets=original.value.assets;
    assert(source?.hashes&&source?.buildAssets&&Object.keys(source.buildAssets).length,'Current exact source/assets required');
    receipt.moduleHashes={};for(const file of [__filename,path.join(__dirname,'native-live.cjs'),path.resolve(__dirname,'../src/panel.ts'),path.resolve(__dirname,'../src/panel.css'),path.resolve(__dirname,'../../visual-experience/cinematic-v3/native/desktop-verify.cjs')]){const name=path.relative(path.resolve(__dirname,'../../..'),file).replaceAll('\\','/'),actual=hash(await slot.bound(()=>fs.readFile(file)));if(source.hashes[name])assert.equal(actual,source.hashes[name],'Current host source differs from actual review module');receipt.moduleHashes[name]=actual;}
    receipt.assets={};const assetRoot=path.resolve(runtime,'../dist/assets');for(const [name,sha] of Object.entries(source.buildAssets)){const file=path.resolve(assetRoot,name);assert(inside(assetRoot,file),'Invalid current asset path');const actual=hash(await fs.readFile(file));assert.equal(actual,sha);receipt.assets[name]=actual;}
    const budgetFile=path.join(privateRoot,'vela-review-ui-capture-budget.json');await assert.rejects(fs.stat(budgetFile),error=>error.code==='ENOENT','Review profile capture budget already exists');
    driver=await slot.bound(()=>createDriver(win,{assertActive:()=>slot.check()}));const js=code=>slot.bound(()=>driver.js(code));
    const read=(command,input={})=>{assert(command==='executionStatus'||command==='replay'||command==='desktop'&&input.type==='snapshot'||command==='vela'&&input.name==='state'||command==='conversation'&&input.name==='detail','Review helper RPC must be read-only');return js(`window.aerynthHost.command(${JSON.stringify(command)},${JSON.stringify(input)})`);};
    const draw=()=>js(`(()=>{const s=window.__aerynth.snapshot();return{frames:s.gpu?.framesRendered,draws:s.metrics.draws,active:s.active,failed:s.graphicsFailed}})()`);let captureBefore;
    const snapshot=async()=>{const desktop=await read('desktop',{type:'snapshot'}),vela=await read('vela',{name:'state',input:{}}),executions=await read('executionStatus');return {desktop,vela,executions,chat:await read('conversation',{name:'detail',input:{resourceId:expected.value.chat.conversation.resourceId,limit:50}}),provider:await read('conversation',{name:'detail',input:{resourceId:original.value.providerEvidence.execution.resourceId,limit:50}})};};
    baseline=await snapshot();assertCheckpoint(baseline,expected.value,original.value);const beforeEvents=await read('replay'),coverage=original.value.providerEvidence.reference.eventCoverage;assertEventScope(beforeEvents,beforeEvents,coverage);assert(beforeEvents.events.filter(event=>event.cursor>coverage.latestCursor).every(event=>event.nativeSequence===null),'Clone contains a new native provider notification after the original turn');assert.equal(receipt.consoleErrors.length,0,'Startup console or shader errors');receipt.baseline={canonicalDigest:digest(canonicalProjection(baseline)),eventDigest:digest(beforeEvents),layoutVersion:baseline.desktop.layoutVersion,adaptationAvailable:{current:baseline.vela.adaptation.applicationAvailable,checkpoint:expected.value.vela.adaptation.applicationAvailable}};receipt.checks.push('clone-canonical-checkpoint-before-input');
    const until=async(predicate,label)=>{const end=Math.min(slot.workDeadline,slot.now()+2500);while(slot.now()<end){if(await slot.bound(predicate))return;await slot.bound(()=>pause(60));}throw Error('Review UI did not settle: '+label);};
    const visible=selector=>js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e?.getBoundingClientRect();if(!r||r.width<=0||r.height<=0||e.hidden||e.disabled||e.closest('[inert]'))throw Error('Unknown input target geometry');const x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2),hit=document.elementFromPoint(x,y);if(hit!==e&&!e.contains(hit))throw Error('Review target occluded');return{x,y}})()`);
    const click=async selector=>{assert(baseline,'No input before clone proof');await visible(selector);receipt.actions.push({type:'native-mouse',selector});await slot.bound(()=>driver.click(selector));};
    captureBefore=await draw();await click('#vela');await until(()=>js(`!!document.querySelector('#vela-assistant-surface[open] .vela-core-scroll')`),'actual Vela surface');
    const spec={planId:expected.value.planId,summary:baseline.vela.plans[0].summary,messageIds:expected.value.vela.conversation.messages.map(message=>message.id),messages:expected.value.vela.conversation.messages.map(({id,content})=>({id,content}))};
    const measureRaw=()=>js(`(${collectGeometry.toString()})(document,${JSON.stringify(spec)})`),measure=async()=>assertGeometry(await measureRaw());
    const settled=async()=>{let previous,current,count=0;await until(async()=>{current=await measureRaw();assert(Number.isFinite(current.effectiveOpacity),'Unknown reading opacity');if(current.effectiveOpacity<.99){count=0;return false;}assertGeometry(current);const signature=digest({bounds:['shell','flow','compose','editor'].map(key=>current[key].rect),scroll:[current.flow.scrollTop,current.evidence.scrollTop],groups:current.groups.map(group=>group.rect)});count=signature===previous?count+1:0;previous=signature;return count>=2;},'opaque stable reading geometry');return current;};
    const first=await settled();assert.equal(first.evidence.open,false,'Historical evidence must start collapsed');
    const expectedEvidence={actions:baseline.vela.plans[0].steps,targets:baseline.vela.plans[0].targets,provider:baseline.vela.plans[0].contribution,receipts:baseline.vela.receipts};assert.deepEqual(JSON.parse(first.evidence.text),expectedEvidence,'Actual evidence content mismatch');
    const flow='#vela-assistant-surface .vela-core-scroll',details=`#vela-assistant-surface [data-plan-id="${spec.planId}"] .vela-core-plan-details`,pre=details+' pre';
    const wheel=async(selector,direction,amount)=>{const p=selector===flow?await js(`(()=>{const e=document.querySelector(${JSON.stringify(flow)}),r=e.getBoundingClientRect(),x=Math.round(r.left+6),y=Math.round(r.top+r.height/2);if(document.elementFromPoint(x,y)!==e)throw Error('Native outer scroll gutter is occluded');return{x,y}})()`):await visible(selector),before=await measure();slot.check();win.webContents.sendInputEvent({type:'mouseMove',...p});win.webContents.sendInputEvent({type:'mouseWheel',...p,deltaY:direction==='down'?-amount:amount,deltaX:0,canScroll:true});receipt.actions.push({type:'native-wheel',selector,direction,amount});await slot.bound(()=>pause(90));return {before,after:await measure()};};
    const seen=new Set(),required=new Set();
    const remember=frame=>{assertRetained(first,{...frame,groups:frame.groups.filter(group=>group.key!=='plan:evidence')});recordVisibleLines(frame,seen,required);receipt.frames.push({effectiveOpacity:frame.effectiveOpacity,flow:frame.flow,groups:frame.groups.map(group=>({key:group.key,nodeId:group.nodeId,rect:group.rect,ownerRect:group.ownerRect,scrollOwner:group.scrollOwner,lines:group.lines})),editor:frame.editor,evidence:{...frame.evidence,text:undefined}});assert(receipt.frames.length<=36&&Buffer.byteLength(JSON.stringify(receipt.frames))<=1024*1024,'Review sampling bound');};
    const toEdge=async(selector,direction)=>{remember(await measure());for(let i=0;i<14;i++){const frame=await measure(),area=selector===pre?frame.evidence:frame.flow;const edge=direction==='up'?area.scrollTop<=1:area.scrollTop+area.clientHeight>=area.scrollHeight-1;if(edge)return frame;const result=await wheel(selector,direction,Math.max(32,Math.floor(area.clientHeight*.7)));const next=selector===pre?result.after.evidence:result.after.flow;assert(direction==='up'?next.scrollTop<area.scrollTop:next.scrollTop>area.scrollTop,'Actual native scroll did not move its owner');remember(result.after);}throw Error('Historical reading content exceeds bounded native scroll');};
    // Start at the actual top, then traverse every ordinary reading group without a synthetic scrollTop write.
    await toEdge(flow,'up');remember(await settled());
    const capture=async name=>{assert(receipt.captures.length<2);const before=captureBefore??await draw();assert(Number.isFinite(before.frames)&&Number.isFinite(before.draws),'Actual GPU draw counters required');
      // An actual native focus traversal is the only fallback for a writing-paused scene.
      if(await js(`document.body.classList.contains('writing')`)){slot.check();for(const type of ['keyDown','keyUp'])win.webContents.sendInputEvent({type,keyCode:'Tab'});receipt.actions.push({type:'native-keyboard',key:'Tab',reason:'leave paused writing focus'});}
      let acknowledgement;await until(async()=>{const next=await draw();if(next.active&&!next.failed&&next.frames>before.frames&&next.draws>before.draws){acknowledgement=next;return true;}return false;},'fresh draw after actual review interaction');
      const frame=await settled();remember(frame);const png=(await slot.bound(()=>win.webContents.capturePage())).toPNG();slot.check();assert(receipt.captures.reduce((n,x)=>n+x.bytes,0)+png.length<=8*1024*1024,'Review PNG bound');const file=path.join(out,name+'.png');await fs.writeFile(file,png);receipt.captures.push({file,bytes:png.length,sha256:hash(png),focused:true,before,acknowledgement});await fs.writeFile(budgetFile,encoded({count:receipt.captures.length,bytes:receipt.captures.reduce((n,x)=>n+x.bytes,0),files:receipt.captures}));};
    await capture('01-historical-long-request-collapsed');await toEdge(flow,'down');const atSummary=await measure();remember(atSummary);captureBefore=await draw();await click(details+' > summary');await until(async()=> (await measure()).evidence.open,'actual technical evidence open');
    await toEdge(flow,'down');await toEdge(pre,'down');await capture('02-historical-applied-plan-open-evidence');await click(details+' > summary');await until(async()=>!(await measure()).evidence.open,'actual technical evidence closed');remember(await settled());
    assert(receipt.frames.some(frame=>frame.groups.some(group=>group.key==='message:'+baseline.vela.requests[0].inputMessageId+':content'&&group.lines.some(line=>line.visible))),'Long original request was not actually visible');
    assert(receipt.frames.some(frame=>frame.groups.some(group=>group.key==='plan:evidence'&&group.lines.some(line=>line.visible))),'Technical evidence was not actually visible');
    receipt.textReachability={requiredLines:required.size,fullyVisibleLines:seen.size,missing:[...required].filter(key=>!seen.has(key))};assert.deepEqual(receipt.textReachability.missing,[],'Actual historical text must be reachable through native scroll');
    const after=await snapshot();assert.deepEqual(canonicalProjection(after),canonicalProjection(baseline),'Review changed canonical resources/layout/content/provider state');const afterEvents=await read('replay');receipt.allowedUiEvents=assertEventScope(beforeEvents,afterEvents,original.value.providerEvidence.reference.eventCoverage);receipt.final={canonicalDigest:digest(canonicalProjection(after)),eventDigest:digest(afterEvents),layoutVersion:after.desktop.layoutVersion};
    const diagnostics=typeof getNativeRequestDiagnostics==='function'?getNativeRequestDiagnostics():[];assert(Array.isArray(diagnostics)&&diagnostics.length===0,'Review-only mode must not start native preview/review/grant/request');receipt.nativeRequestDiagnostics=diagnostics;
    for(const item of sourceFiles)assert.equal(hash(await fs.readFile(item.file)),item.sha256,'Original source/checkpoint changed');assert.equal(receipt.consoleErrors.length,0,'Startup/runtime console or shader errors');receipt.checks.push('actual-reading-text-nonoverlap-scroll-evidence-stable-composer','canonical-and-provider-state-retained');slot.check();receipt.passed=true;
  }catch(error){receipt.error={message:String(error.message??error),stack:error.stack};if(slot.failure())receipt.abort={reason:slot.failure().message,nativeWindows:slot.focusFailureSnapshot()};}
  finally{win.webContents.removeListener('console-message',consoleError);}
  receipt.slot.elapsedMs=slot.now()-slot.started;await fs.writeFile(path.join(out,'review-ui.json'),encoded(receipt));console.log(JSON.stringify({status:'vela-review-ui-terminal',passed:receipt.passed,evidence:out,captures:receipt.captures.length,error:receipt.error?.message,scope:'historical applied-plan rendering only; zero new provider turns/grants/actions'}));process.exitCode=receipt.passed?0:1;return receipt;
}
exports.reviewDeadline=reviewDeadline;exports.verifyReviewUi=verifyReviewUi;
exports._offline={reviewDeadline,durableIdentity,assertCheckpoint,canonicalProjection,assertGeometry,assertRetained,assertEventScope,recordVisibleLines,collectGeometry};
