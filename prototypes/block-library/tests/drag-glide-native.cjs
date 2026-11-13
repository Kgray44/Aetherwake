const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {createDriver}=require('../../visual-experience/cinematic-v3/native/desktop-verify.cjs');
const {createGuard,options:sharedOptions,captureAllowed,consoleHandler}=require('./library-native.cjs');
const {compileExpression}=require('./library-native-expressions.cjs');
const {expressions:x,preflight}=require('./drag-glide-expressions.cjs');
const hash=b=>createHash('sha256').update(b).digest('hex'),q=JSON.stringify;
const isBuildAssetName=name=>/^[a-zA-Z0-9_.-]+\.(js|mjs|css)$/.test(name);
exports.isBuildAssetName=isBuildAssetName;
const canonical=s=>Object.fromEntries(['projects','workspaces','resources','relationships'].map(k=>[k,s[k]]));
const workspace=s=>Object.fromEntries(['activeWorkspaceId','layoutVersion','canUndo','canRedo','blocks','viewport','organization','presence'].map(k=>[k,s[k]]));
exports.canonical=canonical;exports.workspace=workspace;exports.preflight=preflight;
exports.assertMove=(before,after,id,delta)=>{
  assert.equal(after.layoutVersion,before.layoutVersion+1,'One native release is one canonical revision');
  const a=before.blocks.find(b=>b.id===id),b=after.blocks.find(b=>b.id===id);assert(a&&b);
  assert.deepEqual(b,{...a,x:a.x+delta.x,y:a.y+delta.y,version:a.version+1});
  assert.deepEqual(after.blocks.filter(b=>b.id!==id),before.blocks.filter(b=>b.id!==id));
  for(const key of ['viewport','presence','organization'])assert.deepEqual(after[key],before[key]);assert.deepEqual(canonical(after),canonical(before));
};
exports.assertUndo=(before,after,id)=>{
  assert.equal(after.layoutVersion,before.layoutVersion+2,'Undo reverses the single drag entry');
  // The existing engine restores the whole saved snapshot and advances every
  // restored record's version. Geometry/data stay exact; versions are fenced.
  assert.deepEqual(after.blocks,before.blocks.map(b=>({...b,version:b.version+(b.id===id?2:1)})));
  assert.deepEqual(after.viewport,before.viewport);assert.deepEqual(after.presence,{...before.presence,version:before.presence.version+1});assert.deepEqual(after.organization,{...before.organization,revision:before.organization.revision+1});assert.deepEqual(canonical(after),canonical(before));
};
/** Source-only helper; Root creates/owns the exact native slot and observer. */
exports.verify=async({win,app,privateRoot,call,source,moduleStarted,startupErrors,session,localURL})=>{
  const output=path.resolve(__dirname,'../../visual-experience/cinematic-v3/.runtime/application-evidence/drag-glide-'+Date.now()+'-'+randomUUID().slice(0,8));
  const receipt={contract:'aerynth.drag-glide-evidence@1',passed:false,syntheticOnly:true,source,actions:[],modes:[],screenshots:[],errors:[],limitations:['Prepared canonical three-card fixture, not native content creation.','Atomic observer measures actual Three scene geometry and renderer submission versus same-frame DOM; not GPU readback or OS presentation.','Bounded lag/convergence and optional captured motion do not establish sustained performance, native IME or artistic acceptance.']};
  let guard,limits,consoleSource,recorder,probe,shot;
  const onConsole=consoleHandler(receipt),startup=()=>{receipt.startupErrorCount=Array.isArray(startupErrors)?startupErrors.length:-1;};
  try{
    limits={...sharedOptions(process.argv,moduleStarted),maxScreenshots:3};assert(limits.deadlineMs<=30000);receipt.limits=limits;guard=createGuard(win,limits);startup();assert.equal(receipt.startupErrorCount,0,'Missing original startup collector or observed error');
    assert(path.isAbsolute(privateRoot));consoleSource=win.webContents;consoleSource.on('console-message',onConsole);
    const checkpointName='drag-glide-expected.json',markerName='drag-glide-initial-started.json';
    if(!limits.restore)for(const name of [checkpointName,markerName]){let exists=false;try{await guard.around(()=>fs.stat(path.join(privateRoot,name)));exists=true;}catch(e){if(e.code!=='ENOENT')throw e;}assert(!exists,'consumed_initial_profile_use_separate_restore');}
    const read=async(name,maximum)=>{const file=path.join(privateRoot,name);assert((await guard.around(()=>fs.stat(file))).size<=maximum);const bytes=await guard.around(()=>fs.readFile(file));return {value:JSON.parse(bytes.toString('utf8')),sha256:hash(bytes)};};
    const prepared=await read('drag-glide-seed.json',262144),seed=prepared.value;
    assert.equal(seed.contract,'aerynth.drag-glide-seed@1');assert.equal(seed.syntheticOnly,true);assert.equal(seed.expected.blocks.length,3);assert(seed.document.draft&&seed.document.draft.content!==seed.document.resource.content);assert.deepEqual(seed.delta,{x:96,y:48});
    assert(source?.hashes&&source?.buildAssets&&Object.keys(source.buildAssets).length>0);assert.equal(typeof call,'function');
    for(const [name,digest]of Object.entries(seed.hashes)){assert(/^prototypes\/[a-zA-Z0-9_./-]+$/.test(name)&&!name.includes('..'));assert.equal(hash(await guard.around(()=>fs.readFile(path.resolve(__dirname,'../../..',name)))),digest,'Preparation source changed: '+name);if(!name.includes('/prepare-'))assert.equal(source.hashes[name],digest,'Host source differs: '+name);}
    const validation={preflightSha256:preflight().sha256};for(const name of ['drag-glide-native.cjs','drag-glide-expressions.cjs','workspace-approach-expressions.cjs','library-native-expressions.cjs','library-native.cjs','native-console.cjs'])validation[name]=hash(await guard.around(()=>fs.readFile(path.join(__dirname,name))));assert.deepEqual(validation,seed.validation);receipt.validation=validation;
    let assetBytes=0;
    for (const [name,digest] of Object.entries(source.buildAssets)) {
      assert(isBuildAssetName(name), 'invalid_drag_glide_build_asset');
      const file=path.resolve(__dirname,'../../visual-experience/cinematic-v3/dist/assets',name);
      assetBytes+=(await guard.around(()=>fs.stat(file))).size;
      assert(assetBytes<=16777216);
      assert.equal(hash(await guard.around(()=>fs.readFile(file))),digest);
    }
    receipt.verifiedAssetBytes=assetBytes;
    if(!limits.restore){const marker=Buffer.from(JSON.stringify({seedSha256:prepared.sha256,startedAt:Date.now()}));assert(marker.length<=1024);await guard.around(()=>fs.writeFile(path.join(privateRoot,markerName),marker,{flag:'wx'}));}
    const driver=await guard.around(()=>createDriver(win,{assertActive:guard.check}));
    const js=code=>guard.around(()=>driver.js(compileExpression(code))),wait=code=>guard.around(()=>driver.wait(compileExpression(code),Math.min(6000,Math.max(1,limits.deadlineAt-Date.now())))),snapshot=()=>guard.around(()=>driver.snapshot());
    const click=async selector=>{receipt.actions.push({action:'native click',selector});await guard.around(()=>driver.click(selector));};
    const key=(keyCode,modifiers=[])=>{guard.input({type:'keyDown',keyCode,modifiers});guard.input({type:'keyUp',keyCode,modifiers});};
    const id=seed.movingBlockId,card='[data-block='+q(id)+']',editor=card+' textarea';probe=()=>js(x.glide(id));
    const invariant=async s=>{assert.deepEqual(canonical(s),canonical(seed.expected));assert.deepEqual(s.viewport,seed.expected.viewport);assert.deepEqual({...s.presence,version:0},{...seed.expected.presence,version:0});assert.deepEqual((await guard.around(()=>call('notes',{name:'readNote',input:seed.document.resource.id}))).result,seed.document);assert.deepEqual(await js(x.host('executionStatus',{})),[]);const privateState=await guard.around(()=>call('snapshot',{}));const counts={executionCount:Object.keys(privateState.executions).length,bindingCount:Object.values(privateState.bindings).flat().length,assistantMessageCount:privateState.graph.messages.filter(message=>message.role==='assistant').length};assert.deepEqual(counts,{executionCount:0,bindingCount:0,assistantMessageCount:0});receipt.providerObservations??=[];assert(receipt.providerObservations.length<16);receipt.providerObservations.push({at:new Date().toISOString(),...counts});for(const [blockId,expected]of Object.entries(seed.configurations))assert.deepEqual((await guard.around(()=>call('library',{name:'getBlockSettings',input:blockId}))).result,expected);};
    shot=async(name,diagnostic=false)=>{assert(receipt.screenshots.length<3);const before=await probe();if(!diagnostic){assert(before.ready&&before.lag>=1,'A real active draw with nonzero spring lag is required');await wait(x.glideReady(id,before.drawSequence));}const health=await js(x.graphics());assert(captureAllowed(health,diagnostic));const png=(await guard.capture()).toPNG();receipt.pngBytes=(receipt.pngBytes??0)+png.length;assert(receipt.pngBytes<=8388608);await guard.around(()=>fs.mkdir(output,{recursive:true}));await guard.around(()=>fs.writeFile(path.join(output,name+'.png'),png,{flag:'wx'}));const after=await probe();receipt.screenshots.push({file:name+'.png',bytes:png.length,sha256:hash(png),diagnostic,health,before,after,meaning:'Native capture interval bracketed by atomic submission observations; no exact image-pixel/frame equivalence claim'});};
    await wait(x.ready());receipt.viewport=await js(x.viewport());assert.deepEqual(seed.minimumViewport,{width:1600,height:1000});assert(receipt.viewport.width>=1600&&receipt.viewport.height>=1000,'Actual bounded viewport is too small; no window resize is permitted');await wait(x.activeWorkspace(seed.workspaceId));await wait(x.glideReady(id,-1,true));let state=await snapshot();await invariant(state);
    if(limits.restore){const expected=(await read(checkpointName,131072)).value;assert.equal(expected.contract,'aerynth.drag-glide-checkpoint@1');assert.equal(expected.seedSha256,prepared.sha256);assert.deepEqual(expected.source,source.hashes);assert.deepEqual(expected.assets,source.buildAssets);assert.deepEqual(workspace(state),expected.workspace);receipt.exactFreshProcessRestore=true;receipt.restoredFrame=await js(x.glide(id,-1,true));}
    else{
      assert.deepEqual(workspace(state),workspace(seed.expected));
      await click(card+' .unfold');await wait(x.expanded(card,true));if(await js(x.buttonExists(card,'Edit')))await click(await js(x.buttonPath(card,'Edit')));await wait(x.exists(editor));await click(editor);key('Home',['control']);key('Right',['shift']);const returnDraw=(await probe()).drawSequence;await click(card+' .unfold');await wait(x.expanded(card,false));await wait(x.glideReady(id,returnDraw,true));await js(x.rememberEditor(editor));
      if(process.argv.includes('--record-drag-glide')){assert(session&&localURL);recorder=await guard.around(()=>require('../../visual-experience/cinematic-v3/native/application-recording.cjs').startWindowRecording(win,session,localURL));}
      for(const mode of ['fluid','freeform','structured']){
        const selector='.aw-workspace-layout button[data-organization-mode='+q(mode)+']',beforeMode=await snapshot(),modeDraw=(await probe()).drawSequence;await click(selector);await wait(x.organizationIs(mode));await wait(x.enabled(selector));await wait(x.glideReady(id,modeDraw,true));state=await snapshot();assert.deepEqual(state.blocks,beforeMode.blocks,'Mode entry preserves known nonoverlapping fixture geometry');assert.equal(state.layoutVersion,beforeMode.layoutVersion+1);assert.deepEqual(state.presence,beforeMode.presence);assert.deepEqual(state.organization,{...beforeMode.organization,mode,revision:beforeMode.organization.revision+1});await invariant(state);
        const before=state,start=await js(x.surfacePoint(card+' .card-kind-label',card));assert(start,'Actual unobstructed card header required');const trace=[];guard.input({type:'mouseMove',...start});guard.input({type:'mouseDown',...start,button:'left',clickCount:1});
        let draw=-1;for(let n=1;n<=4;n++){guard.input({type:'mouseMove',x:start.x+24*n,y:start.y+12*n,modifiers:['leftbuttondown']});await wait(x.glideReady(id,draw));const frame=await probe();assert(frame.ready);assert.equal(frame.reduced,false,'Native lag case requires ordinary motion; reduced mode is source-qualified separately');draw=frame.drawSequence;trace.push(frame);}
        assert(trace.some(frame=>frame.lag>=1),'Moving card must visibly lag the outline through the existing spring');await shot(mode+'-active-glide');await wait(x.glideConverged(id));const converged=await probe();assert(converged.ready&&converged.converged);guard.input({type:'mouseUp',x:start.x+96,y:start.y+48,button:'left',clickCount:1});await wait(x.layoutAfter(before.layoutVersion));await wait(x.glideReady(id,converged.drawSequence,true));const after=await snapshot();exports.assertMove(before,after,id,seed.delta);await invariant(after);
        const retained=await js(x.retainedEditor(editor));assert(retained.sameNode&&retained.sameText&&retained.sameSelection&&retained.scrollDelta<=1,'Drag retains real editor, draft, caret and scroll');const undoDraw=(await probe()).drawSequence;
        const actions='[data-surface-id="workspace-actions"]';
        const undo=actions+' [data-action="undo"]';
        await click('.aw-workspace-layout [aria-label="Workspace actions"]');
        const history=actions+' [data-action="history-toggle"]';
        await wait(x.exists(history));
        if (await js(x.exists(history+'[aria-expanded="false"]'))) await click(history);
        await wait(x.exists(history+'[aria-expanded="true"]'));
        await wait(x.enabled(undo));
        await click(undo);
        await wait(x.layoutAfter(after.layoutVersion));
        await click(actions+' .aw-contextual-dismiss');
        await wait(x.absent(actions));
        await wait(x.glideReady(id,undoDraw,true));state=await snapshot();exports.assertUndo(before,state,id);await invariant(state);const retainedAfterUndo=await js(x.retainedEditor(editor));assert(retainedAfterUndo.sameNode&&retainedAfterUndo.sameText&&retainedAfterUndo.sameSelection&&retainedAfterUndo.scrollDelta<=1,'Undo retains the editor/draft/caret/scroll in every mode');receipt.modes.push({mode,before:workspace(before),after:workspace(after),afterUndo:workspace(state),trace,converged,retained,retainedAfterUndo});
      }
      const checkpoint=Buffer.from(JSON.stringify({contract:'aerynth.drag-glide-checkpoint@1',seedSha256:prepared.sha256,source:source.hashes,assets:source.buildAssets,workspace:workspace(state)}));assert(checkpoint.length<=131072);await guard.around(()=>fs.writeFile(path.join(privateRoot,checkpointName),checkpoint,{flag:'wx'}));
    }
    await invariant(await snapshot());assert(captureAllowed(await js(x.graphics())));assert.deepEqual(receipt.errors,[]);startup();assert.equal(receipt.startupErrorCount,0);receipt.passed=true;
  }catch(error){receipt.error=String(error?.stack??error).slice(0,12000);if(probe)try{receipt.failureFrame=await probe();}catch{}if(shot&&receipt.screenshots.length<3)try{await shot('drag-glide-failure',true);}catch(e){receipt.captureFailure=String(e?.message??e).slice(0,1000);}}
  finally{if(recorder)try{await guard.around(()=>fs.mkdir(output,{recursive:true}));receipt.recording=await guard.around(()=>recorder.stop(path.join(output,'native-drag-glide.webm')));}catch(e){receipt.passed=false;receipt.recordingError=String(e?.message??e).slice(0,1000);}startup();if(receipt.startupErrorCount||receipt.errors.length)receipt.passed=false;receipt.elapsedFromHostStartMs=Date.now()-moduleStarted;try{consoleSource?.removeListener('console-message',onConsole);guard?.dispose();}catch{receipt.passed=false;}try{const bytes=Buffer.from(JSON.stringify(receipt,null,2));assert(bytes.length<=524288);await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'drag-glide.json'),bytes,{flag:'wx'});}catch(e){receipt.passed=false;receipt.error=String(e?.message??e).slice(0,1000);}finally{process.stdout.write(JSON.stringify({passed:receipt.passed,evidence:output,error:receipt.error})+'\n');app.exit(receipt.passed?0:1);}}
  return receipt;
};
