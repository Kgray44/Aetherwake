// Synthetic test transport inherited by the actual Backend worker. No network fallback.
import assert from 'node:assert/strict';
let step=0;
const scenario=process.env.AERYNTH_WORKER_HOP_SCENARIO;
assert(['roundtrip','absent','shutdown','shutdown-computer','effect-denied'].includes(scenario));
globalThis.fetch=async(url,init)=>{
 assert.equal(new URL(String(url)).origin,'https://api.openai.com');
 if(String(url)==='https://api.openai.com/v1/models')return Response.json({data:[{id:'gpt-6-luna'}]});
 assert.equal(String(url),'https://api.openai.com/v1/responses');assert.equal(init.method,'POST');
 assert.equal(new Headers(init.headers).get('authorization'),'Bearer SYNTHETIC_ONLY_WORKER_HOP');
 const body=JSON.parse(init.body),envelope=JSON.parse(body.instructions.match(/Pinned host tools: ([^\n]+)/u)[1]);
 const outputs=body.input.filter(item=>item.type==='function_call_output').map(item=>JSON.parse(item.output));
 const descriptors=outputs.find(item=>Array.isArray(item.descriptors))?.descriptors;
 const calls=[];let text='';step++;
 const call=(name,args)=>calls.push({type:'function_call',id:'synthetic-item-'+step+'-'+calls.length,call_id:'synthetic-call-'+step+'-'+calls.length,name,arguments:JSON.stringify(args),status:'completed'});
 if(scenario==='absent')text='Synthetic native services are unavailable.';
 else if(step===1)call('aerynth_get_capability_schemas',{catalogDigest:envelope.catalogDigest,ids:scenario==='effect-denied'?['windows.computer.prepare']:scenario==='shutdown'?['windows.memory.diagnose']:scenario==='shutdown-computer'?['windows.computer.discover']:['windows.memory.diagnose','windows.computer.discover']});
 else if(step===2){
  const ids=scenario==='effect-denied'?['windows.computer.prepare']:scenario==='shutdown'?['windows.memory.diagnose']:scenario==='shutdown-computer'?['windows.computer.discover']:['windows.memory.diagnose','windows.computer.discover'];
  for(const id of ids){const descriptor=descriptors.find(item=>item.id===id);assert.equal(descriptor.availability,'available');call('aerynth_invoke_capability',{catalogDigest:envelope.catalogDigest,capabilityId:id,schemaDigest:descriptor.schemaDigest,invocationId:'synthetic-invoke-'+id,argumentsJson:JSON.stringify(scenario==='effect-denied'?{type:'activate',windowRef:'synthetic-window'}:{})});}
 }else{text='Synthetic native round trip completed.';assert.equal(step,3);}
 const id='synthetic-response-'+step,output=calls.length?calls:[{type:'message',id:'synthetic-answer',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]}];
 return new Response([{type:'response.created',response:{id}},...(text?[{type:'response.output_text.delta',delta:text}]:[]),{type:'response.completed',response:{id,status:'completed',model:'gpt-6-luna',output,usage:{input_tokens:2,output_tokens:1,total_tokens:3}}}].map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});
};
