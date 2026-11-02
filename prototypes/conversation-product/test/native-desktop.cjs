/* Actual desktop only. No launch, provider, fixture store, or canonical write API. */
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createDriver } = require('../../visual-experience/cinematic-v3/native/desktop-verify.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const digest = data => createHash('sha256').update(data).digest('hex');
const MAX_PNGS = 6, MAX_PNG_BYTES = 8 * 1024 * 1024;
const titleSelector = '.cp-detail input[aria-label="Conversation title"]';
const runtime = path.resolve(__dirname, '../../visual-experience/cinematic-v3/.runtime');
const inside = (root, target) => { const relative = path.relative(path.resolve(root), path.resolve(target)); return relative && !relative.startsWith('..') && !path.isAbsolute(relative); };
const checkedJson = value => { const data = JSON.stringify(value, null, 2); assert(Buffer.byteLength(data) <= 1024 * 1024, 'Private receipt exceeds bounded 1 MiB'); return data; };
const normalize = detail => ({
  conversation: { ...detail.conversation, collectionIds: [...detail.conversation.collectionIds].sort(), projectIds: [...detail.conversation.projectIds].sort() },
  messages: detail.messages.items, lineage: [...detail.lineage].sort((a,b) => a.id.localeCompare(b.id)),
  policy: detail.policy, shares: [...detail.shares].sort((a,b) => a.id.localeCompare(b.id)),
});
const normalizeCollection = collection => ({...collection, memberIds:[...collection.memberIds].sort(), pinnedIds:[...collection.pinnedIds].sort()});

exports.verify = async ({ win, app, privateRoot, source }) => {
  const restore = process.argv.includes('--verify-restore');
  const out = path.join(runtime, 'application-evidence', 'conversation-product-' + Date.now());
  assert(inside(runtime, out), 'Evidence must remain in ignored runtime');
  await fs.mkdir(out, {recursive:true});
  const expectedPath = path.join(path.resolve(privateRoot), 'conversation-product-expected.json');
  const budgetPath = path.join(path.resolve(privateRoot), 'conversation-product-capture-budget.json');
  const receipt = { contract:'aerynth.actual-conversation-acceptance@1', at:new Date().toISOString(), restore, source,
    host:'Actual desktop + actual canonical SQLite + mounted ConversationProduct', syntheticData:true,
    provider:'No provider commands are issued by this helper; execution state is independently checked empty.', actions:[], checks:[], captures:[], consoleErrors:[], partial:{}, passed:false,
    limits:{maxPngs:MAX_PNGS,maxPngBytes:MAX_PNG_BYTES,scope:'combined journey and restore for this private profile'},
    limitations:['GPU draw acknowledgements and focused capture do not establish monitor presentation or performance acceptance.',
      'Branch review is exercised through the real UI; its private review record is not exposed by the read-only product contract.',
      'Native focus can be denied by Windows; a missing focused GPU acknowledgement is a failure, never a substitute screenshot.'],
  };
  let driver, budget={count:0,bytes:0,files:[]};
  const check = (name, detail) => receipt.checks.push({name, ...(detail===undefined?{}:{detail})});
  const consoleError = (_event,details,message,line,sourceId) => {
    const structured=details&&typeof details==='object',level=structured?details.level:details;if(level!=='error'&&level!==3)return;
    receipt.consoleErrors.push({message:String(structured?details.message:message).slice(0,2048),line:structured?details.lineNumber:line,source:String(structured?details.sourceId:sourceId).slice(0,300)});
    if(receipt.consoleErrors.length>32)receipt.consoleErrors.shift();
  };
  win.webContents.on('console-message',consoleError);
  const uiSnapshot = async () => {
    if(!driver)return {snapshotError:'driver_not_ready'};
    try{return await driver.js(`(()=>{try{const root=document.querySelector('.cp-manager'),title=document.querySelector(${JSON.stringify(titleSelector)})?.value??null,app=window.__aerynth?.application?.();return {title,status:document.querySelector('.cp-status')?.textContent??null,managerMounted:!!root,managerVisible:!!root&&root.getClientRects().length>0,busy:root?.hasAttribute('aria-busy')??false,query:root?.querySelector('input[type=search]')?.value??null,selectedResource:{reportedId:root?.dataset.resourceId??null,title,canonicalCandidates:(app?.resources??[]).filter(r=>r.kind==='conversation'&&r.title===title).map(r=>r.id),identitySource:'Mounted canonical resource ID plus rendered title checked against canonical application snapshot.'},renderedMessages:[...document.querySelectorAll('.cp-message')].slice(0,60).map(e=>({id:e.dataset.messageId,content:e.querySelector('.cp-message-content')?.textContent??null})),results:[...document.querySelectorAll('.cp-results button')].slice(0,50).map(e=>e.textContent.slice(0,700))};}catch(error){return {snapshotError:String(error)}}})()`);}
    catch(error){return {snapshotError:String(error.message??error)};}
  };
  const waitUi = async (predicate,label,expected) => {
    const deadline=Date.now()+20000;let actual;
    while(Date.now()<deadline){actual=await uiSnapshot();if(!actual.snapshotError&&predicate(actual))return actual;await pause(80);}
    receipt.partial.renderWait={label,expected,actual};
    throw Error('Timed out: '+label+'; '+JSON.stringify({status:actual?.status,renderedMessageIds:actual?.renderedMessages?.map(m=>m.id),results:actual?.results,selectedResource:actual?.selectedResource,busy:actual?.busy,snapshotError:actual?.snapshotError}));
  };
  const waitMessage = async (resourceId,title,message) => {
    await waitUi(actual=>!actual.busy&&actual.selectedResource.reportedId===resourceId&&actual.title===title&&actual.renderedMessages.some(m=>m.id===message.id&&m.content===message.content),'canonical message ID and content render',{resourceId,title,message});
    check('canonical-message-id-and-content-rendered',{resourceId,messageId:message.id,title});
  };
  try {
    assert(privateRoot && path.isAbsolute(privateRoot), 'Host must provide its already-authorized absolute private profile');
    // Host owns private-root validation/lifecycle; this helper never opens SQLite.
    for(const file of ['src/contracts.ts','src/service.mts','src/canonical-host.mts','src/ui.ts','src/draft-session.ts','src/style.css','test/native-desktop.cjs']) {
      const full=path.resolve(__dirname,'..',file); receipt.moduleHashes??={};receipt.moduleHashes['prototypes/conversation-product/'+file]=digest(await fs.readFile(full));
    }
    assert(source && source.buildAssets && Object.keys(source.buildAssets).length, 'Actual loaded build asset hashes required');
    receipt.verifiedBuildAssets={};
    for(const [file,expected] of Object.entries(source.buildAssets)) {
      const full=path.resolve(runtime,'../dist/assets',file); assert(inside(path.resolve(runtime,'../dist/assets'),full),'Invalid source asset path');
      const actual=digest(await fs.readFile(full));assert.equal(actual,expected,'Loaded asset hash '+file);receipt.verifiedBuildAssets[file]=actual;
    }
    try { budget=JSON.parse(await fs.readFile(budgetPath,'utf8')); }
    catch(error) { if(error.code!=='ENOENT')throw error; }
    assert(Number.isInteger(budget.count)&&budget.count>=0&&budget.count<=MAX_PNGS&&Number.isInteger(budget.bytes)&&budget.bytes>=0&&budget.bytes<=MAX_PNG_BYTES&&Array.isArray(budget.files),'Invalid existing capture budget; preserve and use a fresh owned profile');
    driver=await createDriver(win);
    const {js,wait}=driver;
    const focus = async () => {
      if(!win.isFocused())console.log(JSON.stringify({status:'conversation-native-focus-required',instruction:'Activate the existing Aerynth window; Windows focus calls are not treated as proof.'}));
      const until=Date.now()+30000;while(!win.isFocused()&&Date.now()<until)await pause(100);
      assert(win.isFocused(),'native_window_not_focused');assert(win.isVisible()&&!win.isMinimized(),'native_window_not_visible');
    };
    const idle = async () => {await wait('!!document.querySelector(".cp-manager")&&!document.querySelector(".cp-manager").hasAttribute("aria-busy")');await pause(100);const error=await js('document.querySelector(".cp-status")?.textContent??""');if(/(?:unavailable|failed|stale_|denied|invalid_|requires_|not_|missing|expired|error)/i.test(error))throw Error('Conversation UI: '+error);};
    const selectorOf = async (scope, text, tag='button', exact=true) => js(`(()=>{
      const root=document.querySelector(${JSON.stringify(scope)});if(!root)throw Error('Missing scope');
      const node=[...root.querySelectorAll(${JSON.stringify(tag)})].find(e=>e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden'&&${exact?'e.textContent.trim()===':'e.textContent.includes('}${JSON.stringify(text)}${exact?'':')'});
      if(!node)throw Error('Missing visible control '+${JSON.stringify(text)});
      const parts=[];let e=node;while(e!==root){const type=e.tagName.toLowerCase(),siblings=[...e.parentElement.children].filter(c=>c.tagName===e.tagName);parts.unshift(type+':nth-of-type('+(siblings.indexOf(e)+1)+')');e=e.parentElement;}return ${JSON.stringify(scope)}+' > '+parts.join(' > ');
    })()`);
    const fieldOf = async (scope,label,tag='input') => js(`(()=>{const root=document.querySelector(${JSON.stringify(scope)}),l=[...root.querySelectorAll('label')].find(e=>e.querySelector('span')?.textContent===${JSON.stringify(label)}),node=l?.querySelector(${JSON.stringify(tag)});if(!node||!node.getClientRects().length)throw Error('Missing visible field '+${JSON.stringify(label)});const parts=[];let e=node;while(e!==root){const peers=[...e.parentElement.children].filter(p=>p.tagName===e.tagName);parts.unshift(e.tagName.toLowerCase()+':nth-of-type('+(peers.indexOf(e)+1)+')');e=e.parentElement;}return ${JSON.stringify(scope)}+' > '+parts.join(' > ');})()`);
    const click = async selector => {await focus();receipt.actions.push({type:'native-mouse',selector,at:Date.now()});return driver.click(selector);};
    const clickText = async (text,scope='.cp-manager',tag='button',exact=true) => click(await selectorOf(scope,text,tag,exact));
    const disclosure = async (text,scope='.cp-manager',open=true) => {
      const selector=await selectorOf(scope,text,'summary'),current=await js(`document.querySelector(${JSON.stringify(selector)}).parentElement.open`);
      if(current!==open)await click(selector);
      await wait(`document.querySelector(${JSON.stringify(selector)}).parentElement.open===${JSON.stringify(open)}`);
      return selector;
    };
    const key = (keyCode,modifiers=[]) => {for(const type of ['keyDown','keyUp'])win.webContents.sendInputEvent({type,keyCode,modifiers});};
    const type = async (selector,value) => {await click(selector);key('A',['control']);await win.webContents.insertText(String(value));receipt.actions.push({type:'native-keyboard-select-and-insert',selector,characters:String(value).length});await pause(100);};
    const choose = async (selector,value) => {
      const index=await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return [...e.options].findIndex(o=>o.value===${JSON.stringify(value)}&&!o.disabled)})()`);assert(index>=0,'Unavailable option '+value);await click(selector);key('Home');for(let i=0;i<index;i++)key('Down');key('Return');await pause(140);assert.equal(await js(`document.querySelector(${JSON.stringify(selector)}).value`),value,'Native select applied');
    };
    const read = async (name,input={}) => {
      assert(['list','search','detail','collections','projects','discover','readDraft'].includes(name),'Acceptance bridge is read-only');
      return js(`window.aerynthHost.command('conversation',${JSON.stringify({name,input})})`);
    };
    const desktop = () => js("window.aerynthHost.command('desktop',{type:'snapshot'})");
    const assertOffline = async () => {
      const executions=await js("window.aerynthHost.command('executionStatus',{})");assert.deepEqual(executions,[],'No execution or provider turn is authorized by offline acceptance');
      const data=await desktop();assert(!data.resources.some(r=>r.execution),'No resource may imply an execution');for(const r of data.resources)assert(!(r.messages??[]).some(m=>m.role==='assistant'),'No model/assistant output in offline profile');
      check('no-execution-or-model-output');
    };
    const capture = async name => {
      assert(budget.count<MAX_PNGS,'Combined profile PNG count exhausted');await focus();
      const layout=await js(`(()=>{const root=document.querySelector('.cp-manager'),bounds=root.getBoundingClientRect(),nodes=[...root.querySelectorAll('input,select,textarea,button,summary,.cp-message-content')].filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden');return {width:root.clientWidth,scrollWidth:root.scrollWidth,overflow:nodes.map(e=>({tag:e.tagName,text:e.textContent.slice(0,100),left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right})).filter(e=>e.left<bounds.left-1||e.right>bounds.right+1)}})()`);
      assert(layout.scrollWidth<=layout.width+1,'Conversation surface has horizontal overflow: '+JSON.stringify(layout));assert.deepEqual(layout.overflow,[],'Visible conversation controls/content stay inside surface bounds');check('conversation-horizontal-bounds',layout);
      const before=await js('(()=>{const s=window.__aerynth.snapshot();return {draws:s.metrics.draws,frames:s.gpu?.framesRendered}})()');assert(Number.isFinite(before.frames),'Actual GPU renderer is unavailable');
      const end=Date.now()+6000;let acknowledgement;
      while(Date.now()<end){await pause(80);const value=await js('(()=>{const s=window.__aerynth.snapshot();return {draws:s.metrics.draws,frames:s.gpu?.framesRendered,active:s.active,failed:s.graphicsFailed}})()');if(win.isFocused()&&!value.failed&&value.active&&value.frames>before.frames&&value.draws>before.draws){acknowledgement=value;break;}}
      assert(acknowledgement,'new_focused_gpu_draw_not_acknowledged');assert(win.isFocused(),'Focus lost before capture');const png=(await win.webContents.capturePage()).toPNG();assert(win.isFocused(),'Focus lost during capture');assert(budget.bytes+png.length<=MAX_PNG_BYTES,'Combined 8 MiB PNG budget exceeded');
      const file=path.join(out,name+'.png');await fs.writeFile(file,png);const item={name,file,bytes:png.length,sha256:digest(png),focused:true,before,acknowledgement};budget.count++;budget.bytes+=png.length;budget.files.push(item);receipt.captures.push(item);await fs.writeFile(budgetPath,checkedJson(budget));
    };
    const manager = async () => {
      if(!await js('(()=>{const host=document.querySelector("#conversation-surface[data-surface-id=conversations].aw-contextual-surface"),e=host?.querySelector(".cp-manager");return !!host?.open&&!!e&&e.getClientRects().length>0})()')){await click('#workspace-manager');await click('#conversation-manager');}
      await idle();await wait('(()=>{const host=document.querySelector("#conversation-surface[data-surface-id=conversations].aw-contextual-surface");return !!host?.open&&!!host.querySelector(".cp-manager")&&!document.querySelector("#command-surface")?.open})()');check('actual-contextual-conversation-host-open');
    };
    const search = async text => {await type('.cp-manager input[type="search"]',text);await pause(350);await idle();};
    const open = async title => {await search(title);await clickText(title,'.cp-results','button',false);await idle();await waitUi(actual=>!actual.busy&&actual.title===title,'selected conversation title render',{title});};
    const send = async content => {await type('.cp-composer textarea',content);await clickText('Record message','.cp-composer');await idle();};
    const selectMessageText = async messageId => {
      const selector=`.cp-message[data-message-id="${messageId}"] .cp-message-content`;
      await driver.js(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
      await click(selector);
      const points=await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),t=e.firstChild;if(!t||t.nodeType!==Node.TEXT_NODE)throw Error('Plain source text required');const a=document.createRange(),b=document.createRange();a.setStart(t,0);a.setEnd(t,1);b.setStart(t,t.length-1);b.setEnd(t,t.length);const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return {start:{x:Math.round(x.left+1),y:Math.round(x.top+x.height/2)},end:{x:Math.round(y.right-1),y:Math.round(y.top+y.height/2)},text:e.textContent}})()`);
      await focus();win.webContents.sendInputEvent({type:'mouseMove',...points.start});win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...points.start});win.webContents.sendInputEvent({type:'mouseMove',...points.end,button:'left',modifiers:['leftButtonDown']});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...points.end});
      await pause(100);const selected=await js('window.getSelection()?.toString()');assert.equal(selected,points.text,'Native text drag selects exact canonical source excerpt');receipt.actions.push({type:'native-text-range',messageId,characters:selected.length});
    };

    await focus();await assertOffline();
    if(restore){
      const expected=JSON.parse(await fs.readFile(expectedPath,'utf8'));assert.equal(expected.contract,'aerynth.conversation-restore@1');assert.deepEqual(receipt.moduleHashes,expected.sourceHashes,'Restore uses the same module source');assert.deepEqual(receipt.verifiedBuildAssets,expected.buildAssets,'Restore uses the same actual build assets');await manager();
      for(const saved of expected.details){const actual=await read('detail',{resourceId:saved.conversation.resourceId});assert.deepEqual(normalize(actual),saved,'Fresh backend preserves exact canonical conversation state');await open(saved.conversation.title);for(const message of saved.messages)await waitMessage(saved.conversation.resourceId,saved.conversation.title,message);assert.deepEqual(await js('[...document.querySelectorAll(".cp-message")].map(e=>({id:e.dataset.messageId,content:e.querySelector(".cp-message-content").textContent}))'),saved.messages.map(m=>({id:m.id,content:m.content})),'Fresh UI reads the same message IDs and content');}
      const collections=await read('collections');for(const saved of expected.collections)assert.deepEqual(normalizeCollection(collections.find(c=>c.id===saved.id)),saved,'Fresh backend preserves exact collection metadata and membership');
      await open(expected.ui.title);assert.equal(await js('document.querySelector(".cp-composer textarea").value'),expected.ui.draft,'Manager draft survives actual process restart');assert.deepEqual(await read('readDraft',{resourceId:expected.ui.draftRecord.resourceId}),expected.ui.draftRecord,'Actual canonical draft revision and content survive restart');await assertOffline();await capture('06-restart-restored');check('fresh-process-exact-canonical-and-ui-restore');receipt.expectedPath=expectedPath;
    }else{
      const token=Date.now().toString(36),parentTitle='Synthetic offline parent '+token,renamedTitle='Synthetic organized parent '+token,childTitle='Synthetic sibling '+token,folderTitle='Synthetic conversation folder '+token,projectTitle='Synthetic conversation project '+token;
      const origin='Synthetic durable origin for offline acceptance.',parentOnly='Synthetic parent-only post-fork marker.',finding='Synthetic sibling result: temperature is 12.';
      let projectId=null;
      await click('#workspace-manager');
      if(await js('!!document.querySelector("#new-project")')){await click('#new-project');await type('#project-title',projectTitle);await click('dialog[open] button[type="submit"]');await wait('!document.querySelector("dialog[open]")');projectId=(await desktop()).projects.find(p=>p.title===projectTitle)?.id;assert(projectId,'Actual project creation is durable');}
      else{key('Escape');receipt.limitations.push('Project creation control unavailable; no project association was claimed.');}
      await manager();await disclosure('Filters','.cp-catalog');key('Escape');await wait('!document.querySelector(".cp-filters").open');assert.equal(await js('document.activeElement?.textContent'),'Filters','Escape restores disclosure summary focus');assert(await js('document.querySelector(".cp-manager").getClientRects().length>0'),'Escape closes a context control before the whole surface');check('context-disclosure-escape-and-focus');
      await disclosure('New chat','.cp-header-actions');await type('.cp-create input[aria-label="New conversation title"]',parentTitle);await choose('.cp-create select[aria-label="New conversation provider"]','local');await clickText('Create conversation','.cp-new-chat');await idle();
      let parent=(await read('list',{text:parentTitle})).items.find(c=>c.title===parentTitle);assert(parent,'Real canonical conversation exists');assert.equal(parent.providerId,'local');receipt.partial.parentResourceId=parent.resourceId;
      await send(origin);await send(parentOnly);let parentDetail=await read('detail',{resourceId:parent.resourceId});assert.deepEqual(parentDetail.messages.items.map(m=>m.content),[origin,parentOnly]);assert.equal(await js('[...document.querySelectorAll(".cp-message-actions button")].filter(e=>e.getClientRects().length).length'),0,'Message buttons remain behind contextual disclosure');assert.equal(await js('document.querySelector(".cp-chat-options").open'),false,'Reading starts with metadata controls closed');await capture('01-local-history');
      await disclosure('Organize history','.cp-catalog');await type('.cp-manager input[aria-label="New folder title"]',folderTitle);await clickText('New folder');await idle();let folder=(await read('collections')).find(c=>c.title===folderTitle);assert(folder,'Real canonical folder exists');
      await disclosure('Chat options','.cp-detail-header');await choose(await fieldOf('.cp-chat-options','Folder','select'),folder.id);await clickText('Add to folder','.cp-chat-options');await idle();await clickText('Favorite','.cp-chat-options');await idle();
      await type('input[aria-label="Conversation title"]',renamedTitle);await clickText('Rename','.cp-chat-options');await idle();
      if(projectId){await choose(await fieldOf('.cp-chat-options','Project association','select'),projectId);await clickText('Associate project','.cp-chat-options');await idle();}
      await disclosure('Chat options','.cp-detail-header',false);
      parentDetail=await read('detail',{resourceId:parent.resourceId});assert.equal(parentDetail.conversation.title,renamedTitle);assert.equal(parentDetail.conversation.favorite,true);assert.equal(parentDetail.conversation.projectId,projectId);assert(parentDetail.conversation.collectionIds.includes(folder.id));
      await search(parentOnly);const messageResult=renamedTitle+' · message\n'+parentOnly;await waitUi(actual=>!actual.busy&&actual.results.includes(messageResult),'canonical message search result render',{resourceId:parent.resourceId,messageId:parentDetail.messages.items[1].id,messageResult});await clickText(messageResult,'.cp-results');await idle();await waitMessage(parent.resourceId,renamedTitle,parentDetail.messages.items[1]);check('actual-history-search-message-navigation-and-organization');await capture('02-organized-history');
      const forkMessage=parentDetail.messages.items[0];await disclosure('Message actions',`.cp-message[data-message-id="${forkMessage.id}"]`);await clickText('Branch from here',`.cp-message[data-message-id="${forkMessage.id}"]`);await type('input[aria-label="Branch title"]',childTitle);await choose(await fieldOf('.cp-secondary','Provider','select'),'local');await clickText('Create branch and review context');await idle();await wait('document.querySelector(".cp-secondary").textContent.includes("awaiting your review")');check('branch-context-prepared-before-review');await clickText('Approve selected context');await idle();
      const child=(await read('list',{text:childTitle})).items.find(c=>c.title===childTitle);assert(child);receipt.partial.childResourceId=child.resourceId;await send(finding);let childDetail=await read('detail',{resourceId:child.resourceId});assert.deepEqual(childDetail.messages.items.map(m=>m.content),[origin,finding]);assert.equal(childDetail.messages.items[0].id,forkMessage.id);assert.equal(childDetail.messages.items[0].inherited,true);assert.equal(childDetail.lineage.length,1);assert.equal(childDetail.lineage[0].sourceMessageId,forkMessage.id);
      await disclosure('Chat options','.cp-detail-header');await choose(await fieldOf('.cp-chat-options','Folder','select'),folder.id);await clickText('Add to folder','.cp-chat-options');await idle();await disclosure('Chat options','.cp-detail-header',false);await capture('03-independent-branch');
      const source=childDetail.messages.items.find(m=>m.content===finding);await selectMessageText(source.id);await disclosure('Message actions',`.cp-message[data-message-id="${source.id}"]`);assert.equal(await js(`document.querySelector('.cp-message[data-message-id="${source.id}"] .cp-excerpt-preview').textContent`),finding,'Exact selected text survives opening the real action menu before explicit publication');assert.equal((await read('detail',{resourceId:child.resourceId})).shares.length,0,'Opening contextual actions does not publish');check('exact-excerpt-retained-without-implicit-publication');await clickText('Publish selected excerpt',`.cp-message[data-message-id="${source.id}"]`);await idle();childDetail=await read('detail',{resourceId:child.resourceId});const share=childDetail.shares.find(s=>s.sourceMessageId===source.id);assert(share);assert.equal(share.state,'discoverable');assert.deepEqual(share.range,{start:0,end:finding.length},'Publication retains the exact canonical selected range');
      await open(renamedTitle);await clickText('Connected Branches and source scopes','.cp-secondary','summary');await choose(await fieldOf('.cp-secondary','Mode','select'),'connected');await clickText('Save policy');await idle();await clickText('Connected Branches and source scopes','.cp-secondary','summary');await clickText('Discover branch excerpts');await idle();await clickText('Inspect source excerpt','.cp-share');await idle();assert.equal(await js('document.querySelector(".cp-share blockquote").textContent'),finding);await clickText('Attach to future context','.cp-share');await idle();
      parentDetail=await read('detail',{resourceId:parent.resourceId});assert.equal(parentDetail.policy.mode,'connected');assert.equal(parentDetail.shares.find(s=>s.id===share.id).state,'attached');assert.equal(parentDetail.shares.find(s=>s.id===share.id).attached,true);assert(!parentDetail.messages.items.some(m=>m.content===finding),'Sharing does not merge transcripts');assert.deepEqual(parentDetail.messages.items.map(m=>m.content),[origin,parentOnly]);await capture('04-inspected-attached-not-sent');
      const draft='Synthetic unsent draft retained across manager and restart.';await type('.cp-composer textarea',draft);await clickText('Close','.cp-manager > header');await wait('!document.querySelector("#conversation-surface")?.open');await wait('(()=>{const e=document.querySelector(".cp-manager");return !e||e.getClientRects().length===0})()');await manager();await idle();assert.equal(await js('document.querySelector(".cp-composer textarea").value'),draft,'Temporary surface preserves unsent draft');
      await js('window.__aerynth.flush()');const draftRecord=await read('readDraft',{resourceId:parent.resourceId});assert.equal(draftRecord.content,draft,'Real canonical recovery received the unsent editor text');assert(draftRecord.version>0,'Recovery is version fenced');assert(!(await read('detail',{resourceId:parent.resourceId})).messages.items.some(message=>message.content===draft),'Unsent recovery is not a canonical message');await assertOffline();await capture('05-saved-manager');
      const expected={contract:'aerynth.conversation-restore@1',createdAt:new Date().toISOString(),details:[normalize(await read('detail',{resourceId:parent.resourceId})),normalize(await read('detail',{resourceId:child.resourceId}))],collections:(await read('collections')).filter(c=>c.id===folder.id).map(normalizeCollection),ui:{title:renamedTitle,draft,draftRecord},sourceHashes:receipt.moduleHashes,buildAssets:receipt.verifiedBuildAssets};
      await fs.writeFile(expectedPath,checkedJson(expected));receipt.expectedPath=expectedPath;check('exact-canonical-ids-content-organization-policy-and-draft-saved');
    }
    receipt.passed=true;
  }catch(error){receipt.error={message:error.message,stack:error.stack};receipt.partial.ui=await uiSnapshot();}
  win.webContents.removeListener('console-message',consoleError);
  // Preserve partial receipts even when focus/GPU capture failed. Never fabricate a failure image.
  await fs.writeFile(path.join(out,restore?'restore.json':'journey.json'),checkedJson(receipt));
  console.log(JSON.stringify({passed:receipt.passed,restore,error:receipt.error?.message,evidence:out,captures:receipt.captures.length,provider:'no provider commands issued by helper'}));
  process.exitCode=receipt.passed?0:1;app.quit();return receipt;
};

/** CPU-only component assertions. This harness never creates a driver, window, database or provider. */
exports.componentChecks = async () => {
  const { mountConversationManager } = await import('../src/ui.ts');
  const prior = { document: global.document, window: global.window, CSS: global.CSS };
  let selection = null;
  class Element {
    constructor(tag, doc) { this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.parentElement=null;this.dataset={};this.attrs=new Map();this.listeners=new Map();this.className='';this.value='';this.hidden=false;this.disabled=false;this.checked=false;this.scrollTop=0;this._text='';this._open=false; }
    get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
    set textContent(value){this._text=value;this.children=[];this.firstChild={parentElement:this,textContent:value};}
    get text(){return this.textContent;}
    get open(){return this._open;}
    set open(value){if(this._open===value)return;this._open=value;this.fire('toggle');}
    get options(){return this.children.filter(child=>child.tagName==='OPTION');}
    append(...nodes){for(const node of nodes){node.remove();node.parentElement=this;this.children.push(node);}}
    replaceChildren(...nodes){for(const node of this.children)node.parentElement=null;this.children=[];this._text='';this.append(...nodes);}
    insertBefore(node,next){node.remove();node.parentElement=this;const index=next?this.children.indexOf(next):-1;this.children.splice(index<0?this.children.length:index,0,node);}
    remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null;}
    contains(node){return node===this||node?.parentElement===this||this.children.some(child=>child.contains(node));}
    setAttribute(name,value){this.attrs.set(name,value);}
    removeAttribute(name){this.attrs.delete(name);}
    hasAttribute(name){return this.attrs.has(name);}
    addEventListener(name,callback,capture=false){this.listeners.set(name,[...this.listeners.get(name)??[],{callback,capture}]);}
    matches(selector){const tag=selector.match(/^[a-z]+/i)?.[0],cls=selector.match(/\.([\w-]+)/)?.[1],attr=selector.match(/\[([\w-]+)(?:="([^"]*)")?\]/);return (!tag||this.tagName===tag.toUpperCase())&&(!cls||this.className.split(' ').includes(cls))&&(!attr||(attr[1]==='open'?this.open:attr[1].startsWith('data-')?this.dataset[attr[1].slice(5).replace(/-([a-z])/g,(_,s)=>s.toUpperCase())]===attr[2]:this.attrs.has(attr[1])&&(attr[2]===undefined||this.attrs.get(attr[1])===attr[2])));}
    querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
    querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
    closest(selector){return this.matches(selector)?this:this.parentElement?.closest(selector)??null;}
    focus(){this.ownerDocument.activeElement=this;}
    scrollIntoView(){}
    fire(type,extra={}){const event={type,target:this,defaultPrevented:false,stopped:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...extra},path=[];for(let node=this;node;node=node.parentElement)path.push(node);for(const node of [...path].reverse())for(const listener of node.listeners.get(type)??[])if(listener.capture)listener.callback(event);for(const node of path){for(const listener of node.listeners.get(type)??[])if(!listener.capture)listener.callback(event);if(event.stopped)break;}return event;}
  }
  const doc={activeElement:null,createElement(tag){return new Element(tag,this);},createRange(){return {selectNodeContents(node){this.content=node;},setEnd(_node,end){this.end=end;},toString(){return this.content.textContent.slice(0,this.end);}};}};
  global.document=doc;global.window={getSelection:()=>selection};global.CSS={escape:value=>value};
  const source='Before αβ\nselected 🧭 excerpt after',selected='αβ\nselected 🧭',start=source.indexOf(selected),calls=[];
  const detail={conversation:{resourceId:'chat:child',conversationId:'graph:child',title:'Synthetic child chat',providerId:'local',revision:2,version:1,projectId:null,projectIds:[],state:'active',createdAt:'2026-11-02T00:00:00Z',favorite:false,messageCount:1,collectionIds:[]},messages:{items:[{id:'message:source',resourceId:'chat:origin',role:'user',content:source,createdAt:'2026-11-02T00:00:00Z',provenance:'synthetic-test-source',inherited:true,sensitivity:'internal'}],total:1,offset:0,limit:50,hasMore:false},lineage:[],policy:{resourceId:'chat:child',revision:1,mode:'independent',allowedSourceIds:[],allowCrossProject:false,maxSensitivity:'internal',categories:['excerpt']},shares:[],providers:[{id:'local',label:'Local',available:true,record:true,execute:false,models:[]}]};
  const draftRecords=new Map();let pendingSend=null;
  const port={async command(name,input){calls.push({name,input});if(name==='readDraft')return {...draftRecords.get(input.resourceId)??{resourceId:input.resourceId,version:0,content:'',updatedAt:null}};if(name==='saveDraft'){const prior=draftRecords.get(input.resourceId);if((prior?.version??0)!==input.expectedVersion)throw Error('stale_draft_version');const record={resourceId:input.resourceId,version:input.expectedVersion+1,content:input.content,updatedAt:'2026-11-02T00:00:00Z'};draftRecords.set(input.resourceId,record);return {...record};}if(name==='send')return new Promise(resolve=>{pendingSend={input,resolve};});if(name==='detail')return structuredClone(detail);if(name==='providers')return detail.providers;if(name==='search')return {items:[],total:0,offset:0,limit:50,hasMore:false};if(name==='collections'||name==='projects')return [];if(name==='publish')return {id:'share:synthetic'};throw Error('Unexpected component command '+name);}};
  const root=doc.createElement('main');let closed=0,manager;
  const named=(scope,text,tag='button')=>scope.querySelectorAll(tag).find(node=>node.textContent===text);
  const openDisclosure=node=>{const summary=node.querySelector('summary');summary.fire('pointerdown');node.open=true;summary.focus();return summary;};
  const press=node=>{assert(node&&!node.disabled,'Component action is enabled');for(let parent=node.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')assert(parent.open,'Component uses the real disclosure before acting');node.fire('click');};
  const idle=async()=>{for(let i=0;i<50&&root.querySelector('.cp-manager').hasAttribute('aria-busy');i++)await new Promise(resolve=>setImmediate(resolve));assert(!root.querySelector('.cp-manager').hasAttribute('aria-busy'),'Component settles');};
  const until=async(check)=>{for(let i=0;i<50&&!check();i++)await new Promise(resolve=>setImmediate(resolve));assert(check(),'Component boundary settles');};
  const acceptSend=()=>{const {input,resolve}=pendingSend;pendingSend=null;const message={id:'message:synthetic-'+detail.conversation.revision,resourceId:input.resourceId,role:'user',content:input.content,inherited:false,provenance:'synthetic-test-source',createdAt:'2026-11-02T00:00:00Z',sensitivity:'internal'};detail.conversation.revision++;detail.conversation.messageCount++;detail.messages.items.push(message);detail.messages.total++;resolve({...message,revision:detail.conversation.revision});};
  try {
    manager=mountConversationManager(root,port,{resourceId:'chat:child',onClose:()=>closed++});await manager.ready;
    const surface=root.querySelector('.cp-manager'),draft=root.querySelector('.cp-composer').querySelector('textarea'),messages=root.querySelector('.cp-messages'),article=root.querySelector('.cp-message'),content=article.querySelector('.cp-message-content'),menu=article.querySelector('.cp-message-actions');
    assert.equal(surface.attrs.get('role'),'region','Host owns dialog semantics');assert.equal(surface.dataset.resourceId,'chat:child');assert.equal(article.dataset.sourceResourceId,'chat:origin');assert.equal(menu.open,false);assert.equal(root.querySelector('.cp-chat-options').open,false);assert.equal(root.querySelector('.cp-history-tools').open,false);assert(calls.every(call=>['detail','providers','search','collections','projects','readDraft'].includes(call.name)),'Mount performs reads only');
    draft.value='Synthetic unsent editor text';draft.selectionStart=4;draft.selectionEnd=12;draft.fire('input');messages.scrollTop=37;await manager.refresh();assert.equal(root.querySelector('.cp-composer').querySelector('textarea'),draft);assert.equal(root.querySelector('.cp-message'),article);assert.equal(draft.value,'Synthetic unsent editor text');assert.equal(draft.selectionStart,4);assert.equal(draft.selectionEnd,12);assert.equal(messages.scrollTop,37);
    selection={isCollapsed:false,rangeCount:1,anchorNode:content.firstChild,focusNode:content.firstChild,getRangeAt:()=>({startContainer:content.firstChild,startOffset:start,toString:()=>selected})};content.fire('mouseup');
    const summary=openDisclosure(menu);selection={isCollapsed:true,rangeCount:0};assert.equal(article.querySelector('.cp-excerpt-preview').textContent,selected);assert.equal(calls.filter(call=>call.name==='publish').length,0,'Opening menu never publishes');
    const copied=named(menu,'Copy');copied.focus();const escaped=copied.fire('keydown',{key:'Escape'});assert.equal(menu.open,false);assert.equal(doc.activeElement,summary);assert.equal(closed,0);assert(escaped.defaultPrevented&&escaped.stopped);
    openDisclosure(menu);press(named(menu,'Publish selected excerpt'));await idle();const published=calls.find(call=>call.name==='publish');assert.deepEqual(published.input,{sourceResourceId:'chat:origin',sourceMessageId:'message:source',range:{start,end:start+selected.length},evidence:'excerpt'});assert.equal(draft.value,'Synthetic unsent editor text');
    detail.messages.items[0].inherited=false;detail.messages.items[0].resourceId='chat:child';await manager.refresh();assert.notEqual(root.querySelector('.cp-message'),article,'Source metadata changes invalidate the cached message view');assert.equal(root.querySelector('.cp-message').dataset.sourceResourceId,'chat:child');assert(!root.querySelector('.cp-message-source').textContent.includes('inherited source'));
    surface.fire('keydown',{key:'Escape'});await until(()=>closed===1);await manager.dispose();assert.equal(draftRecords.get('chat:child').content,'Synthetic unsent editor text','Close awaits real recovery-port persistence');
    manager=mountConversationManager(root,port,{resourceId:'chat:child',onClose:()=>closed++});await manager.ready;const restored=root.querySelector('.cp-composer').querySelector('textarea'),form=root.querySelector('.cp-composer');assert.equal(restored.value,'Synthetic unsent editor text','A new manager recovers without any ManagerState memory');
    restored.value='Exact submitted text';restored.fire('input');form.fire('submit');await until(()=>!!pendingSend);const originalEditor=restored;restored.value='Later typing while Send is awaiting approval';restored.fire('input');await manager.flush();acceptSend();await idle();assert.equal(root.querySelector('.cp-composer').querySelector('textarea'),originalEditor);assert.equal(restored.value,'Later typing while Send is awaiting approval');assert.equal(draftRecords.get('chat:child').content,restored.value);
    restored.value='Accepted submission to clear';restored.fire('input');form.fire('submit');await until(()=>!!pendingSend);acceptSend();await idle();assert.equal(restored.value,'');assert.equal(draftRecords.get('chat:child').content,'');assert.match(root.querySelector('.cp-status').textContent,/Message accepted/);
    restored.value='Uncertain submission retained';restored.fire('input');form.fire('submit');await until(()=>!!pendingSend);const unknown=pendingSend;pendingSend=null;unknown.resolve({id:'execution:synthetic-unknown',resourceId:'chat:child',providerId:'local',commandId:unknown.input.commandId,state:'unknown'});await idle();assert.equal(restored.value,'Uncertain submission retained');assert.equal(named(form,'Record message').disabled,true);const sendCount=calls.filter(call=>call.name==='send').length;press(named(root,'I reviewed the send outcome'));assert.equal(calls.filter(call=>call.name==='send').length,sendCount,'Explicit review does not retry a send');
    const previous=draftRecords.get('chat:child');draftRecords.set('chat:child',{...previous,version:previous.version+1,content:'Competing editor recovery'});restored.value='This editor recovery';restored.fire('input');await assert.rejects(manager.flush(),/stale_draft_version/);assert.equal(restored.value,'This editor recovery');assert.equal(named(form,'Record message').disabled,true);press(named(root,'Keep this editor’s draft'));await until(()=>root.querySelector('.cp-draft-status').dataset.draftState==='clean');assert.equal(draftRecords.get('chat:child').content,'This editor recovery');
    return {passed:true,checks:11,scope:'synthetic CPU-only component state and recovery port; no browser layout/native/provider qualification'};
  } finally {await manager?.dispose();for(const key of Object.keys(prior))if(prior[key]===undefined)delete global[key];else global[key]=prior[key];}
};
if(require.main===module&&process.argv.includes('--component-check'))exports.componentChecks().then(result=>console.log(JSON.stringify(result)),error=>{console.error(error);process.exitCode=1;});
