'use strict';
const id=v=>typeof v==='string'&&/^[a-z0-9][a-z0-9_.:-]{0,127}$/iu.test(v);
const text=(v,max)=>typeof v==='string'&&Buffer.byteLength(v)<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]|\p{Bidi_Control}/u.test(v);
function safeHostOperationView(v){
 const required=['id','requestId','workflowId','capabilityId','state','title','summary','reviewAvailable'];
 if(!v||typeof v!=='object'||Array.isArray(v)||!required.every(k=>Object.hasOwn(v,k))||Object.keys(v).some(k=>![...required,'receiptId','jobsDone'].includes(k))||
   ![v.id,v.requestId,v.workflowId,v.capabilityId].every(id)||!['observed','no-op','awaiting-review','running','denied','unavailable','unknown','discovery-failed'].includes(v.state)||
   !text(v.title,512)||!text(v.summary,8192)||typeof v.reviewAvailable!=='boolean'||v.receiptId!==undefined&&!id(v.receiptId)||
   v.jobsDone!==undefined&&(!Number.isSafeInteger(v.jobsDone)||v.jobsDone<0)||Buffer.byteLength(JSON.stringify(v))>12288)throw Error('invalid_host_operation_view');
 return structuredClone(v);
}
module.exports={safeHostOperationView};
