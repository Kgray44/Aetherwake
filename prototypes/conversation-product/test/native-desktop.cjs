/* Actual desktop only. No launch, provider, fixture store, or canonical write API. */
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createDriver } = require('../../visual-experience/cinematic-v3/native/desktop-verify.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const digest = data => createHash('sha256').update(data).digest('hex');
const MAX_PNGS = 6, MAX_PNG_BYTES = 8 * 1024 * 1024;
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
    provider:'No provider commands are issued by this helper; execution state is independently checked empty.', actions:[], checks:[], captures:[], partial:{}, passed:false,
    limits:{maxPngs:MAX_PNGS,maxPngBytes:MAX_PNG_BYTES,scope:'combined journey and restore for this private profile'},
    limitations:['GPU draw acknowledgements and focused capture do not establish monitor presentation or performance acceptance.',
      'Branch review is exercised through the real UI; its private review record is not exposed by the read-only product contract.',
      'Native focus can be denied by Windows; a missing focused GPU acknowledgement is a failure, never a substitute screenshot.'],
  };
  let driver, budget={count:0,bytes:0,files:[]};
  const check = (name, detail) => receipt.checks.push({name, ...(detail===undefined?{}:{detail})});
  try {
    assert(privateRoot && path.isAbsolute(privateRoot), 'Host must provide its already-authorized absolute private profile');
    // Host owns private-root validation/lifecycle; this helper never opens SQLite.
    for(const file of ['src/contracts.ts','src/service.mts','src/canonical-host.mts','src/ui.ts','src/style.css','test/native-desktop.cjs']) {
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
      const node=[...root.querySelectorAll(${JSON.stringify(tag)})].find(e=>${exact?'e.textContent.trim()===':'e.textContent.includes('}${JSON.stringify(text)}${exact?'':')'});
      if(!node)throw Error('Missing visible control '+${JSON.stringify(text)});
      const parts=[];let e=node;while(e!==root){const type=e.tagName.toLowerCase(),siblings=[...e.parentElement.children].filter(c=>c.tagName===e.tagName);parts.unshift(type+':nth-of-type('+(siblings.indexOf(e)+1)+')');e=e.parentElement;}return ${JSON.stringify(scope)}+' > '+parts.join(' > ');
    })()`);
    const fieldOf = async (scope,label,tag='input') => js(`(()=>{const root=document.querySelector(${JSON.stringify(scope)}),l=[...root.querySelectorAll('label')].find(e=>e.querySelector('span')?.textContent===${JSON.stringify(label)}),node=l?.querySelector(${JSON.stringify(tag)});if(!node)throw Error('Missing field '+${JSON.stringify(label)});const parts=[];let e=node;while(e!==root){const peers=[...e.parentElement.children].filter(p=>p.tagName===e.tagName);parts.unshift(e.tagName.toLowerCase()+':nth-of-type('+(peers.indexOf(e)+1)+')');e=e.parentElement;}return ${JSON.stringify(scope)}+' > '+parts.join(' > ');})()`);
    const click = async selector => {await focus();receipt.actions.push({type:'native-mouse',selector,at:Date.now()});return driver.click(selector);};
    const clickText = async (text,scope='.cp-manager',tag='button',exact=true) => click(await selectorOf(scope,text,tag,exact));
    const key = (keyCode,modifiers=[]) => {for(const type of ['keyDown','keyUp'])win.webContents.sendInputEvent({type,keyCode,modifiers});};
    const type = async (selector,value) => {await click(selector);key('A',['control']);await win.webContents.insertText(String(value));receipt.actions.push({type:'native-keyboard-select-and-insert',selector,characters:String(value).length});await pause(100);};
    const choose = async (selector,value) => {
      const index=await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return [...e.options].findIndex(o=>o.value===${JSON.stringify(value)}&&!o.disabled)})()`);assert(index>=0,'Unavailable option '+value);await click(selector);key('Home');for(let i=0;i<index;i++)key('Down');key('Return');await pause(140);assert.equal(await js(`document.querySelector(${JSON.stringify(selector)}).value`),value,'Native select applied');
    };
    const read = async (name,input={}) => {
      assert(['list','search','detail','collections','projects','discover'].includes(name),'Acceptance bridge is read-only');
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
      const before=await js('(()=>{const s=window.__aerynth.snapshot();return {draws:s.metrics.draws,frames:s.gpu?.framesRendered}})()');assert(Number.isFinite(before.frames),'Actual GPU renderer is unavailable');
      const end=Date.now()+6000;let acknowledgement;
      while(Date.now()<end){await pause(80);const value=await js('(()=>{const s=window.__aerynth.snapshot();return {draws:s.metrics.draws,frames:s.gpu?.framesRendered,active:s.active,failed:s.graphicsFailed}})()');if(win.isFocused()&&!value.failed&&value.active&&value.frames>before.frames&&value.draws>before.draws){acknowledgement=value;break;}}
      assert(acknowledgement,'new_focused_gpu_draw_not_acknowledged');assert(win.isFocused(),'Focus lost before capture');const png=(await win.webContents.capturePage()).toPNG();assert(win.isFocused(),'Focus lost during capture');assert(budget.bytes+png.length<=MAX_PNG_BYTES,'Combined 8 MiB PNG budget exceeded');
      const file=path.join(out,name+'.png');await fs.writeFile(file,png);const item={name,file,bytes:png.length,sha256:digest(png),focused:true,before,acknowledgement};budget.count++;budget.bytes+=png.length;budget.files.push(item);receipt.captures.push(item);await fs.writeFile(budgetPath,checkedJson(budget));
    };
    const manager = async () => {if(!await js('(()=>{const e=document.querySelector(".cp-manager");return !!e&&e.getClientRects().length>0})()')){await click('#workspace-manager');await click('#conversation-manager');}await idle();};
    const search = async text => {await type('.cp-manager input[type="search"]',text);await pause(350);await idle();};
    const open = async title => {await search(title);await clickText(title,'.cp-results','button',false);await idle();assert.equal(await js('document.querySelector(".cp-detail input[aria-label=\"Conversation title\"]").value'),title);};
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
      for(const saved of expected.details){const actual=await read('detail',{resourceId:saved.conversation.resourceId});assert.deepEqual(normalize(actual),saved,'Fresh backend preserves exact canonical conversation state');await open(saved.conversation.title);assert.deepEqual(await js('[...document.querySelectorAll(".cp-message")].map(e=>({id:e.dataset.messageId,content:e.querySelector(".cp-message-content").textContent}))'),saved.messages.map(m=>({id:m.id,content:m.content})),'Fresh UI reads the same message IDs and content');}
      const collections=await read('collections');for(const saved of expected.collections)assert.deepEqual(normalizeCollection(collections.find(c=>c.id===saved.id)),saved,'Fresh backend preserves exact collection metadata and membership');
      await open(expected.ui.title);assert.equal(await js('document.querySelector(".cp-composer textarea").value'),expected.ui.draft,'Manager draft survives actual process restart');await assertOffline();await capture('06-restart-restored');check('fresh-process-exact-canonical-and-ui-restore');receipt.expectedPath=expectedPath;
    }else{
      const token=Date.now().toString(36),parentTitle='Synthetic offline parent '+token,renamedTitle='Synthetic organized parent '+token,childTitle='Synthetic sibling '+token,folderTitle='Synthetic conversation folder '+token,projectTitle='Synthetic conversation project '+token;
      const origin='Synthetic durable origin for offline acceptance.',parentOnly='Synthetic parent-only post-fork marker.',finding='Synthetic sibling result: temperature is 12.';
      let projectId=null;
      await click('#workspace-manager');
      if(await js('!!document.querySelector("#new-project")')){await click('#new-project');await type('#project-title',projectTitle);await click('dialog[open] button[type="submit"]');await wait('!document.querySelector("dialog[open]")');projectId=(await desktop()).projects.find(p=>p.title===projectTitle)?.id;assert(projectId,'Actual project creation is durable');}
      else{key('Escape');receipt.limitations.push('Project creation control unavailable; no project association was claimed.');}
      await manager();await type('.cp-create input[aria-label="New conversation title"]',parentTitle);await choose('.cp-create select[aria-label="New conversation provider"]','local');await clickText('New conversation');await idle();
      let parent=(await read('list',{text:parentTitle})).items.find(c=>c.title===parentTitle);assert(parent,'Real canonical conversation exists');assert.equal(parent.providerId,'local');receipt.partial.parentResourceId=parent.resourceId;
      await send(origin);await send(parentOnly);let parentDetail=await read('detail',{resourceId:parent.resourceId});assert.deepEqual(parentDetail.messages.items.map(m=>m.content),[origin,parentOnly]);await capture('01-local-history');
      await type('.cp-manager input[aria-label="New folder title"]',folderTitle);await clickText('New folder');await idle();let folder=(await read('collections')).find(c=>c.title===folderTitle);assert(folder,'Real canonical folder exists');
      await choose('.cp-detail > div:first-child > select',folder.id);await clickText('Add to folder');await idle();await clickText('Favorite');await idle();
      await type('input[aria-label="Conversation title"]',renamedTitle);await clickText('Rename','.cp-detail > div:first-child');await idle();
      if(projectId){await choose(await fieldOf('.cp-detail > div:first-child','Project association','select'),projectId);await clickText('Associate project');await idle();}
      parentDetail=await read('detail',{resourceId:parent.resourceId});assert.equal(parentDetail.conversation.title,renamedTitle);assert.equal(parentDetail.conversation.favorite,true);assert.equal(parentDetail.conversation.projectId,projectId);assert(parentDetail.conversation.collectionIds.includes(folder.id));
      await search(parentOnly);await clickText(renamedTitle,'.cp-results','button',false);await idle();assert.equal(await js('document.querySelector(".cp-message[data-message-id=\"'+parentDetail.messages.items[1].id+'\"] .cp-message-content").textContent'),parentOnly);check('actual-history-search-message-navigation-and-organization');await capture('02-organized-history');
      const forkMessage=parentDetail.messages.items[0];await clickText('Branch from here',`.cp-message[data-message-id="${forkMessage.id}"]`);await type('input[aria-label="Branch title"]',childTitle);await choose(await fieldOf('.cp-secondary','Provider','select'),'local');await clickText('Create branch and review context');await idle();await wait('document.querySelector(".cp-secondary").textContent.includes("awaiting your review")');check('branch-context-prepared-before-review');await clickText('Approve selected context');await idle();
      const child=(await read('list',{text:childTitle})).items.find(c=>c.title===childTitle);assert(child);receipt.partial.childResourceId=child.resourceId;await send(finding);let childDetail=await read('detail',{resourceId:child.resourceId});assert.deepEqual(childDetail.messages.items.map(m=>m.content),[origin,finding]);assert.equal(childDetail.messages.items[0].id,forkMessage.id);assert.equal(childDetail.messages.items[0].inherited,true);assert.equal(childDetail.lineage.length,1);assert.equal(childDetail.lineage[0].sourceMessageId,forkMessage.id);
      await choose('.cp-detail > div:first-child > select',folder.id);await clickText('Add to folder');await idle();await capture('03-independent-branch');
      const source=childDetail.messages.items.find(m=>m.content===finding);await selectMessageText(source.id);await clickText('Publish selected excerpt',`.cp-message[data-message-id="${source.id}"]`);await idle();childDetail=await read('detail',{resourceId:child.resourceId});const share=childDetail.shares.find(s=>s.sourceMessageId===source.id);assert(share);assert.equal(share.state,'discoverable');
      await open(renamedTitle);await clickText('Connected Branches and source scopes','.cp-secondary','summary');await choose(await fieldOf('.cp-secondary','Mode','select'),'connected');await clickText('Save policy');await idle();await clickText('Connected Branches and source scopes','.cp-secondary','summary');await clickText('Discover branch excerpts');await idle();await clickText('Inspect source excerpt','.cp-share');await idle();assert.equal(await js('document.querySelector(".cp-share blockquote").textContent'),finding);await clickText('Attach to future context','.cp-share');await idle();
      parentDetail=await read('detail',{resourceId:parent.resourceId});assert.equal(parentDetail.policy.mode,'connected');assert.equal(parentDetail.shares.find(s=>s.id===share.id).state,'attached');assert.equal(parentDetail.shares.find(s=>s.id===share.id).attached,true);assert(!parentDetail.messages.items.some(m=>m.content===finding),'Sharing does not merge transcripts');assert.deepEqual(parentDetail.messages.items.map(m=>m.content),[origin,parentOnly]);await capture('04-inspected-attached-not-sent');
      const draft='Synthetic unsent draft retained across manager and restart.';await type('.cp-composer textarea',draft);await clickText('Close','.cp-manager > header');await wait('(()=>{const e=document.querySelector(".cp-manager");return !e||e.getClientRects().length===0})()');await manager();await idle();assert.equal(await js('document.querySelector(".cp-composer textarea").value'),draft,'Temporary surface preserves unsent draft');
      await js('window.__aerynth.flush()');await assertOffline();await capture('05-saved-manager');
      const expected={contract:'aerynth.conversation-restore@1',createdAt:new Date().toISOString(),details:[normalize(await read('detail',{resourceId:parent.resourceId})),normalize(await read('detail',{resourceId:child.resourceId}))],collections:(await read('collections')).filter(c=>c.id===folder.id).map(normalizeCollection),ui:{title:renamedTitle,draft},sourceHashes:receipt.moduleHashes,buildAssets:receipt.verifiedBuildAssets};
      await fs.writeFile(expectedPath,checkedJson(expected));receipt.expectedPath=expectedPath;check('exact-canonical-ids-content-organization-policy-and-draft-saved');
    }
    receipt.passed=true;
  }catch(error){receipt.error={message:error.message,stack:error.stack};if(driver)try{receipt.partial.ui=await driver.js('({title:document.querySelector(".cp-detail input[aria-label=\"Conversation title\"]")?.value,status:document.querySelector(".cp-status")?.textContent,managerMounted:!!document.querySelector(".cp-manager")})');}catch{} }
  // Preserve partial receipts even when focus/GPU capture failed. Never fabricate a failure image.
  await fs.writeFile(path.join(out,restore?'restore.json':'journey.json'),checkedJson(receipt));
  console.log(JSON.stringify({passed:receipt.passed,restore,error:receipt.error?.message,evidence:out,captures:receipt.captures.length,provider:'no provider commands issued by helper'}));
  process.exitCode=receipt.passed?0:1;app.quit();return receipt;
};
