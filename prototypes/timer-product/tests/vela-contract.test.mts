import test from 'node:test';
import assert from 'node:assert/strict';
import { validClockTimerAction, clockTimerRequiresReview, CLOCK_TIMER_ACTION_PROPERTIES } from '../vela-contract.ts';
import type { ClockTimerAction, TimerOperation } from '../contracts.ts';

const action=(operations:TimerOperation[]=[]):ClockTimerAction=>({type:'clockTimer',request:{name:'create',input:{title:'Synthetic clock',projectId:null,operations}},
  workspaceId:null,focus:null,query:null});
test('finite Vela timer contract validates every domain operation without an arbitrary JSON command escape',()=>{
  const operations:TimerOperation[]=[{type:'createTimer',key:'timer',name:'Synthetic timer',durationMs:1000,start:true},
    ...(['startTimer','pauseTimer','resumeTimer','resetTimer','cancelTimer','deleteTimer'] as const).map(type=>({type,timerId:'timer:1'})),
    ...(['extendTimer','shortenTimer'] as const).map(type=>({type,timerId:'timer:1',amountMs:1000})),{type:'renameTimer',timerId:'timer:1',name:'Changed'},
    ...(['stopwatchStart','stopwatchPause','stopwatchResume','stopwatchReset','stopwatchLap'] as const).map(type=>({type})),
    {type:'addWorldClock',key:'tokyo',timeZone:'Asia/Tokyo',label:'Tokyo'},{type:'renameWorldClock',clockId:'clock:1',label:'New name'},
    {type:'removeWorldClock',clockId:'clock:1'},{type:'acknowledgeExpiry',expiryId:'expiry:1'}];
  for(const operation of operations)assert.equal(validClockTimerAction(action([operation])),true,operation.type);
  const inspect=(value:unknown)=>{if(!value||typeof value!=='object')return;const object=value as Record<string,unknown>;
    if(object.type==='object')assert.equal(object.additionalProperties,false);for(const child of Object.values(object))inspect(child);};
  inspect(CLOCK_TIMER_ACTION_PROPERTIES);
});
test('unknown fields, provider command identities, invalid zones/versions/durations and unbounded payloads fail closed',()=>{
  const base=action([{type:'createTimer',key:'timer',name:'Timer',durationMs:1000}]);
  for(const candidate of [
    {...base,extra:true},{...base,request:{...base.request,extra:true}},
    {...base,request:{name:'create',input:{...base.request.input,commandId:'provider:chosen'}}},
    action([{type:'execute',code:'arbitrary'} as any]),action([{type:'createTimer',key:'timer',name:'Timer',durationMs:0}]),
    action([{type:'addWorldClock',key:'clock',label:'Nope',timeZone:'Not/AZone'}]),
    {...base,request:{name:'mutate',input:{resourceId:'r:1',expectedVersion:0,operations:[{type:'stopwatchStart'}]}}},
    {...base,request:{name:'readClock',input:{timeZone:'+03:00'}}},
    {...base,focus:{mode:'timer',timerId:'timer:1',timerKey:'timer'}},
    {...base,query:{target:'timers',states:['running','running']}},
    action(Array.from({length:33},()=>({type:'stopwatchReset' as const}))),
  ])assert.equal(validClockTimerAction(candidate),false,JSON.stringify(candidate));
});
test('timer/world-clock removal is always review-required and routine lifecycle remains host-policy',()=>{
  assert.equal(clockTimerRequiresReview(action([{type:'deleteTimer',timerId:'timer:1'}])),true);
  assert.equal(clockTimerRequiresReview(action([{type:'removeWorldClock',clockId:'clock:1'}])),true);
  assert.equal(clockTimerRequiresReview(action([{type:'cancelTimer',timerId:'timer:1'}])),false);
});
