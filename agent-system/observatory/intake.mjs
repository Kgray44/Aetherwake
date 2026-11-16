const validClasses=new Set(['visual','bug','backend','performance','security','research','documentation','feature','maintenance','integration']);

function cleanString(v,max=1000){return typeof v==='string'?v.trim().slice(0,max):''}
export function validateNewTask(b){
  if(!b||typeof b!=='object'||Array.isArray(b))throw Error('Task body must be an object');
  const title=cleanString(b.title,160), objective=cleanString(b.objective,6000);
  const primary=cleanString(b.primary,32),profile=cleanString(b.profile_id,100);
  if(title.length<4||objective.length<12)throw Error('Title (4+) and objective (12+) are required');
  if(!validClasses.has(primary))throw Error('Unsupported task classification');
  if(!profile)throw Error('Verification profile is required');
  const deps=Array.isArray(b.dependencies)?b.dependencies:[];
  const criteria=Array.isArray(b.criteria)?b.criteria:[];
  const capabilities=Array.isArray(b.capabilities)?b.capabilities:[];
  if(deps.length>100||criteria.length>50||capabilities.length>100)throw Error('Too many dependencies or criteria');
  const ids=deps.map(x=>cleanString(x,128)).filter(Boolean);
  const accept=criteria.map((x,i)=>({id:'criterion-'+(i+1),description:cleanString(x,1000)})).filter(x=>x.description);
  if(!accept.length)throw Error('At least one acceptance criterion is required');
  return {title,objective,primary,profile,ids,accept,capabilities:capabilities.map(x=>cleanString(x,128)).filter(Boolean)};
}
export function proposedTask(body,rev,uuid=()=>crypto.randomUUID()){
  const v=validateNewTask(body);
  if(!rev||!/^[0-9a-f]{40}$/.test(rev))throw Error('A checked-out Git revision is required to create a task');
  const now=new Date().toISOString(),id='task_'+uuid();
  return {schema_version:1,record_type:'task',id,created_at:now,repository:'Kgray44/Aetherwake',revision:rev,title:v.title,objective:v.objective,classification:{primary:v.primary,secondary:[]},prerequisites:{task_ids:v.ids,capabilities:v.capabilities},acceptance:{profile_id:v.profile,criteria:v.accept},state:'proposed',owner_acceptance:'not_reviewed',artifacts:[]};
}
