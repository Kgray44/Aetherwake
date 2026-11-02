const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {reviewDeadline,assertCheckpoint,assertGeometry,assertRetained,assertEventScope,recordVisibleLines,revealReadingControl,measureTextLines,durableIdentity}=require('./native-review-ui.cjs')._offline;
const rect=(left,top,width,height)=>({left,top,right:left+width,bottom:top+height,width,height});
function frame(){return {effectiveOpacity:1,view:{width:400,height:500},shell:{nodeId:1,rect:rect(0,0,400,500)},flow:{nodeId:2,rect:rect(0,0,400,360),overflowY:'auto',scrollTop:0},compose:{nodeId:3,rect:rect(0,380,400,120)},editor:{nodeId:4,rect:rect(10,390,380,60),name:'Message Vela',hitTest:true,disabled:false,value:'',selectionStart:0,selectionEnd:0},groups:[{key:'message:synthetic:content',nodeId:5,rect:rect(10,10,380,100),ownerRect:rect(5,5,390,110),scrollOwner:'flow',lines:[{rect:rect(10,10,200,20),visible:rect(10,10,200,20)}]},{key:'plan:0',nodeId:6,rect:rect(10,130,380,40),ownerRect:rect(5,120,390,200),scrollOwner:'flow',lines:[{rect:rect(10,130,200,20),visible:rect(10,130,200,20)}]}],controls:[{key:0,nodeId:7,name:'Plan details and evidence',disabled:false,insideFlow:true,hitTest:true,rect:rect(10,300,240,36)}]};}
test('review mode shortens but cannot extend the one global native slot',()=>{
  assert.equal(reviewDeadline(),25000);assert.equal(reviewDeadline(85000),25000);assert.equal(reviewDeadline(20000),20000);
  for(const value of [NaN,Infinity,85001,1500,-1])assert.throws(()=>reviewDeadline(value),/invalid_vela_review_ui_deadline/);
});
test('synthetic rectangle fixtures reject real visible inter-group overlap and text outside shrunken leaf geometry',()=>{
  assert.equal(assertGeometry(frame()).groups.length,2);
  const overlap=frame();overlap.groups[1].rect=rect(10,15,380,40);overlap.groups[1].ownerRect=rect(5,5,390,200);overlap.groups[1].lines=[{rect:rect(10,15,200,20),visible:rect(10,15,200,20)}];assert.throws(()=>assertGeometry(overlap),/text groups overlap/);
  const shrunken=frame();shrunken.groups[0].rect=rect(10,10,380,12);assert.throws(()=>assertGeometry(shrunken),/outside its nonshrinking reading group/);
});
function rangeDocument(textContent,boxes){
  const node={textContent},selected=[];return {node,selected,document:{defaultView:{NodeFilter:{SHOW_TEXT:4}},createTreeWalker(){let done=false;return{nextNode(){if(done)return null;done=true;return node;}};},createRange(){let start,end;return{setStart(text,offset){assert.equal(text,node);start=offset;},setEnd(text,offset){assert.equal(text,node);end=offset;},getClientRects(){assert(Number.isSafeInteger(start)&&Number.isSafeInteger(end),'Offsets must select an exact non-whitespace run');const value=textContent.slice(start,end);selected.push({value,start,end});assert(!/\s/u.test(value));return boxes(value,start,end);}};}}};
}
test('wrapped trailing whitespace advances are excluded by exact offsets while actual same-row words coalesce without clipping',()=>{
  const fixture=rangeDocument('alpha beta\n gamma ',value=>value==='alpha'?[rect(10,10,100,20)]:value==='beta'?[rect(300,10,88,20)]:[rect(10,36,120,20)]);
  const result=measureTextLines(fixture.document,fixture.node);assert.deepEqual(fixture.selected.map(x=>x.value),['alpha','beta','gamma']);assert.deepEqual(result.lines,[rect(10,10,378,20),rect(10,36,120,20)]);assert.equal(result.runs,3);assert.equal(result.fragments,3);assert.equal(fixture.node.textContent,'alpha beta\n gamma ','Measurement never changes full canonical text or whitespace');
});
test('Unicode offsets and wrapped real-word fragments remain exact; an oversized actual word still fails the unchanged geometry guard',()=>{
  const unicode=rangeDocument('\t𐐀mega  beta\n',(_value,start)=>[rect(10,start?36:10,100,20)]);measureTextLines(unicode.document,unicode.node);assert.deepEqual(unicode.selected,[{value:'𐐀mega',start:1,end:7},{value:'beta',start:9,end:13}]);
  const oversized=rangeDocument('oversized-real-word',()=>[rect(10,10,400,20)]),actual=measureTextLines(oversized.document,oversized.node);assert.equal(actual.lines[0].right,410,'Real word overflow is retained, never clamped to its owner');const f=frame();f.groups[0].lines=actual.lines.map(r=>({rect:r,visible:r}));assert.throws(()=>assertGeometry(f),/outside its nonshrinking reading group/);
  const wrapped=rangeDocument('very-long-real-word',()=>[rect(10,10,200,20),rect(10,36,100,20)]);assert.equal(measureTextLines(wrapped.document,wrapped.node).lines.length,2);
});
test('unknown, missing, incorrect scroll ownership and composer occlusion fail closed',()=>{
  for(const mutate of [f=>{f.flow.rect.width=NaN;},f=>{f.groups[0].lines=[];},f=>{f.groups[0].scrollOwner='unexpected';},f=>{f.flow.overflowY='visible';},f=>{f.compose.rect.top=350;},f=>{f.controls[0].name='';},f=>{f.controls[0].name='Approve and apply';},f=>{f.editor.name='';},f=>{f.editor.hitTest=false;},f=>{f.view.height=200;}]){const f=frame();mutate(f);assert.throws(()=>assertGeometry(f));}
});
test('legitimate clipped code lines retain their technical scroll owner without treating offscreen lines as overlapping visible text',()=>{
  const f=frame();f.groups.push({key:'plan:evidence',nodeId:8,rect:rect(10,180,380,60),ownerRect:rect(5,120,390,200),scrollOwner:'evidence',lines:[{rect:rect(20,190,200,20),visible:rect(20,190,200,20)},{rect:rect(20,800,200,20),visible:null}]});assert.doesNotThrow(()=>assertGeometry(f));
});
test('same-state native reading must retain editor, key nodes, controls, caret and bounded placement',()=>{
  assert.doesNotThrow(()=>assertRetained(frame(),structuredClone(frame())));
  for(const mutate of [f=>{f.editor.nodeId=99;},f=>{f.groups[0].nodeId=98;},f=>{f.controls[0].nodeId=97;},f=>{f.editor.value='lost text';},f=>{f.editor.selectionStart=1;},f=>{f.compose.rect.left+=2;}]){const after=frame();mutate(after);assert.throws(()=>assertRetained(frame(),after));}
});
test('every actual text line needs a fully visible native-scroll observation, not merely a clipped sliver',()=>{
  const f=frame(),seen=new Set(),required=new Set();f.groups[0].lines[0].visible.height=2;recordVisibleLines(f,seen,required);assert.equal(required.size,2);assert.equal(seen.size,1);f.groups[0].lines[0].visible.height=20;recordVisibleLines(f,seen,required);assert.equal(seen.size,required.size);
  const translucent=frame();translucent.effectiveOpacity=.4;assert.throws(()=>assertGeometry(translucent),/not opaque/);
});
test('offscreen summary requires one observed outer wheel before the sole legal native click; actual occlusion never permits a click',async()=>{
  const {createSlot}=require('./native-live.cjs')._offline;let clock=0,focused=true;
  const win={isDestroyed:()=>false,isVisible:()=>true,isMinimized:()=>false,isFocused:()=>focused,isEnabled:()=>true,webContents:{isDestroyed:()=>false}},slot=createSlot({win,now:()=>clock,slotStartedAt:0,deadlineMs:25000,windows:()=>[]});
  const clip=rect(371.05,278.613,468,253);let target=rect(401.65,210.313,411.2,36.8);const actions=[];
  const result=await revealReadingControl({slot,sample:async()=>({available:true,target,clip,hitTest:target.top>=clip.top}),scroll:async(direction,amount)=>{actions.push({type:'native-wheel',direction,amount});assert.equal(direction,'up');target=rect(target.left,target.top+amount,target.width,target.height);},wait:async ms=>{clock+=ms;}});actions.push({type:'native-click'});
  assert.equal(result.wheels,1);assert.equal(actions[0].amount,177);assert(target.top>=clip.top&&target.bottom<=clip.bottom);assert.deepEqual(actions.map(item=>item.type),['native-wheel','native-click']);
  let inputs=0;await assert.rejects(revealReadingControl({slot,sample:async()=>({available:true,target,clip,hitTest:false}),scroll:async()=>{inputs++;}}),/control occluded/);assert.equal(inputs,0);
  focused=false;await assert.rejects(revealReadingControl({slot,sample:async()=>{inputs++;return{};},scroll:async()=>{inputs++;}}),/focus_lost/);assert.equal(inputs,0);
});
test('missing or persistently clipped reading controls remain bounded without force-clicking or normal renderer probe errors',async()=>{
  let clock=0,scrolls=0;const slot={workDeadline:10000,now:()=>clock,check(){},bound:async work=>work()};
  await assert.rejects(revealReadingControl({slot,sample:async()=>({available:false}),scroll:async()=>{scrolls++;},wait:async ms=>{clock+=ms;}}),/bounded reveal/);assert.equal(scrolls,0);assert(clock<=2040);
  clock=0;const target=rect(10,-50,100,20),clip=rect(0,0,200,200);await assert.rejects(revealReadingControl({slot,sample:async()=>({available:true,target,clip,hitTest:false}),scroll:async()=>{scrolls++;},wait:async ms=>{clock+=ms;}}),/did not enter/);assert.equal(scrolls,4);
});
const event=(cursor,type='item/agentMessage/delta')=>({cursor,eventId:'synthetic:'+cursor,type,nativeSequence:cursor,executionId:'synthetic-execution',classification:'reported'});
test('historical provider scope remains exact while bounded genuine app-only UI records are recorded explicitly',()=>{
  const before={events:Array.from({length:10},(_,index)=>event(index+1))},coverage={afterCursor:2,latestCursor:8,truncated:false,gapObserved:false};
  const ui={...event(11,'application/vela.open'),nativeSequence:null,executionId:null,classification:'observed'};const after={events:[...before.events.slice(1),ui]};assert.deepEqual(assertEventScope(before,after,coverage),[ui]);
  for(const change of [x=>{x.events[3].classification='simulated';},x=>{x.events.at(-1).nativeSequence=11;},x=>{x.events.at(-1).type='vela.planning.running';},x=>{x.events.at(-1).executionId='new-execution';},x=>{x.events=x.events.filter(item=>item.cursor!==5);}]){const bad=structuredClone(after);change(bad);assert.throws(()=>assertEventScope(before,bad,coverage));}
});
test('runtime adaptation availability is qualified separately without ignoring actual user policy or evidence',()=>{
  const a={adaptation:{applicationAvailable:true,policy:{enabled:false},explicit:[]}},b={adaptation:{applicationAvailable:false,policy:{enabled:false},explicit:[]}};assert.deepEqual(durableIdentity(a),durableIdentity(b));b.adaptation.policy.enabled=true;assert.notDeepEqual(durableIdentity(a),durableIdentity(b));assert.throws(()=>durableIdentity({adaptation:{}}),/Unknown runtime/);
});
function checkpointFixture(){
  const {createHash}=require('node:crypto'),digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const execution={id:'synthetic:execution',resourceId:'synthetic:provider',state:'provider_completed',providerId:'codex-app-server',binding:{nativeThreadId:'synthetic:native-thread'},turnId:'synthetic:native-turn',taskVerified:false};
  const contribution={executionId:execution.id,providerId:execution.providerId,nativeThreadId:execution.binding.nativeThreadId,nativeTurnId:execution.turnId};
  const provider={conversation:{resourceId:'synthetic:provider'},messages:[{id:'synthetic:input',role:'user',content:'Synthetic retained prompt'}],total:1};
  const nativeReview={prompt:'Synthetic retained prompt',promptDigest:digest('Synthetic retained prompt'),context:{},contextDigest:digest({})};
  const note={id:'synthetic:note',title:'Synthetic note',kind:'note',project_id:null,version:1,content:'Synthetic note body',state:'active'};
  const source=[{id:'synthetic:source-chat',workspace_id:'synthetic:origin'},{id:'synthetic:source-note',workspace_id:'synthetic:origin'}],target=[{id:'synthetic:target-chat',workspace_id:'synthetic:target'},{id:'synthetic:target-note',workspace_id:'synthetic:target'}];
  const vela={identity:{id:'system:vela'},conversation:{resourceId:'synthetic:vela'},requests:[{id:'synthetic:request',intent:'Synthetic long historical request. '.repeat(20),state:'completed',context:{}}],plans:[{id:'synthetic:plan',state:'applied',steps:[{action:{type:'workspaceFromResources'}}],contribution}],receipts:[{state:'applied',providerId:null}],preferences:{delegationEnabled:false},adaptation:{applicationAvailable:false,policy:{enabled:false}},planningReferences:{},attention:[]};
  const expected={contract:'aerynth.vela-live-restore@1',nativeReview,executions:[execution],vela:structuredClone(vela),attention:[],project:{id:'synthetic:project'},origin:{id:'synthetic:origin'},workspace:{id:'synthetic:target'},originPlacements:source,targetPlacements:target,chat:{conversation:{resourceId:'synthetic:chat'},messages:[],total:0},note,requestId:'synthetic:request',planId:'synthetic:plan'};
  delete expected.vela.attention;
  const detail=value=>({conversation:value.conversation,messages:{items:value.messages,total:value.total}});
  const actual={desktop:{projects:[expected.project],workspaces:[expected.origin,expected.workspace],navigationBlocks:[...source,...target],activeWorkspaceId:expected.workspace.id,navigation:{kind:'workspace',workspaceId:expected.workspace.id},resources:[note,{id:'synthetic:chat'},{id:'synthetic:vela'},{id:'synthetic:provider'}]},vela,executions:[execution],chat:detail(expected.chat),provider:detail(provider)};
  const original={contract:'aerynth.actual-vela-live-workspace@1',passed:true,restore:false,resume:false,nativeReview,providerEvidence:{execution,contribution,output:provider}};
  return {actual,expected,original};
}
test('synthetic checkpoint preflight rejects resource, layout, prompt, request and receipt mismatch before any gesture',()=>{
  const f=checkpointFixture();assert.doesNotThrow(()=>assertCheckpoint(f.actual,f.expected,f.original));
  for(const mutate of [x=>{x.actual.desktop.resources.pop();},x=>{x.actual.desktop.navigationBlocks[0]={...x.actual.desktop.navigationBlocks[0],x:42};},x=>{x.actual.vela.requests[0].state='planning';},x=>{x.actual.vela.receipts=[];},x=>{x.original.passed=false;},x=>{x.original.nativeReview.prompt='Tampered synthetic prompt';}]){
    const value=structuredClone(f);mutate(value);let inputs=0;assert.throws(()=>{assertCheckpoint(value.actual,value.expected,value.original);inputs++;});assert.equal(inputs,0,'No native gesture is authorized by an invalid clone');
  }
});
test('review source and gesture lane cannot request a provider, mutate canonical data or substitute DOM input',()=>{
  const source=fs.readFileSync(path.join(__dirname,'native-review-ui.cjs'),'utf8'),live=fs.readFileSync(path.join(__dirname,'native-live.cjs'),'utf8');
  for(const forbidden of ['authorizeVela','insertText(','.scrollTop=','.scrollTop =','.focus(',"command('execute'","name:'request'","name:'review'","name:'apply'",'.dispatchEvent(','.click()'])assert(!source.includes(forbidden),forbidden);
  for(const required of ['assertCheckpoint(baseline,expected.value,original.value)','Actual native scroll did not move its owner','getClientRects()','createTreeWalker','mouseWheel','capturePage()','sourceFiles','assertEventScope','vela-review-ui-terminal'])assert(source.includes(required),required);
  assert(live.includes("reviewUi?require('./native-review-ui.cjs'):null"));assert(live.includes('review.reviewDeadline(options.deadlineMs)'));
  // Original live/restore exact same-source comparisons must remain untouched.
  assert(live.includes('assert.deepEqual(receipt.moduleHashes,expected.moduleHashes); assert.deepEqual(receipt.assets,expected.assets); assert.deepEqual(source.hashes,expected.hostSourceHashes)'));
});
