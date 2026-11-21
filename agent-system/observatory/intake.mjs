const validClasses=new Set(['visual','bug','backend','performance','security','research','documentation','feature','maintenance','integration']);

function cleanString(v,max=1000){return typeof v==='string'?v.trim().slice(0,max):''}
export const TASK_OBJECTIVE_MAX = 100_000;
// The wire limit also covers JSON escapes and the existing scope fields.
export const TASK_REQUEST_MAX_BYTES = 1024 * 1024;
export function validTaskObjective(value) {
  if (typeof value !== 'string' || value.length > 2 * TASK_OBJECTIVE_MAX ||
      !value.isWellFormed() || value.trim().length < 12) return false;
  let count = 0;
  for (const character of value) {
    if (++count > TASK_OBJECTIVE_MAX) return false;
  }
  let meaningfulLength = 0;
  for (const character of value.trim()) {
    if (++meaningfulLength >= 12) return true;
  }
  return false;
}
const list = value => Array.isArray(value) ? value : [];
export const requirementKinds=['git','requirement','document','artifact','issue','pull_request','url'];
const validRequirements = refs => refs===undefined || Array.isArray(refs) && refs.length<=50 &&
  refs.every(ref=>ref && requirementKinds.includes(ref.kind) && typeof ref.uri==='string' &&
    ref.uri.trim() && ref.uri.length<=1000 &&
    (ref.revision===undefined || typeof ref.revision==='string' && ref.revision.length<=128));
const validDeliverables = items => items===undefined || Array.isArray(items) && items.length<=30 &&
  items.every(item=>typeof item==='string' && item.trim() && item.length<=500);
export function proposalChecks(body) {
  return {
    outcome: cleanString(body.title,160).length >= 4 && validTaskObjective(body.objective),
    classification: validClasses.has(cleanString(body.primary,32)),
    prerequisites: list(body.dependencies).length <= 100 && list(body.capabilities).length <= 100 &&
      (body.merged_dependencies === undefined || Array.isArray(body.merged_dependencies) &&
        body.merged_dependencies.length <= 100 && body.merged_dependencies.every(id =>
          typeof id === 'string' && list(body.dependencies).includes(id))),
    inputs: validRequirements(body.requirements),
    deliverables: validDeliverables(body.deliverables),
    acceptance: Boolean(cleanString(body.profile_id,100)) &&
      list(body.criteria).length <= 50 && list(body.criteria).some(item => cleanString(item,1000)),
  };
}
export function validateNewTask(b){
  if(!b||typeof b!=='object'||Array.isArray(b))throw Error('Task body must be an object');
  const title=cleanString(b.title,160), objective=b.objective;
  const primary=cleanString(b.primary,32),profile=cleanString(b.profile_id,100);
  const checks=proposalChecks(b);
  if(!validTaskObjective(objective))throw Error('Objective must contain 12 to 100,000 Unicode characters.');
  if(!checks.outcome)throw Error('Title must contain at least 4 characters.');
  if(!checks.classification)throw Error('Unsupported task classification');
  if(!profile)throw Error('Verification profile is required');
  const deps=Array.isArray(b.dependencies)?b.dependencies:[];
  const criteria=Array.isArray(b.criteria)?b.criteria:[];
  const capabilities=Array.isArray(b.capabilities)?b.capabilities:[];
  if(!checks.prerequisites||criteria.length>50)throw Error('Too many dependencies or criteria');
  const ids=deps.map(x=>cleanString(x,128)).filter(Boolean);
  const accept=criteria.map((x,i)=>({id:'criterion-'+(i+1),description:cleanString(x,1000)})).filter(x=>x.description);
  if(!checks.inputs)throw Error('Use up to 50 typed requirement or input artifact references.');
  if(!checks.deliverables)throw Error('Use up to 30 planned deliverables of 500 characters each.');
  if(!checks.acceptance)throw Error('At least one acceptance criterion is required');
  return {title,objective,primary,profile,ids,accept,
    mergedIds:[...new Set((b.merged_dependencies ?? []).map(id=>cleanString(id,128)).filter(Boolean))],
    capabilities:capabilities.map(x=>cleanString(x,128)).filter(Boolean),
    requirements:b.requirements?.map(({kind,uri,revision})=>({kind,uri:uri.trim(),...(revision?.trim()?{revision:revision.trim()}:{})})),
    deliverables:b.deliverables?.map(item=>item.trim())};
}
export function proposedTask(body,rev,uuid=()=>crypto.randomUUID()){
  const v=validateNewTask(body);
  if(!rev||!/^[0-9a-f]{40}$/.test(rev))throw Error('A checked-out Git revision is required to create a task');
  const now=new Date().toISOString(),id='task_'+uuid();
  return {schema_version:1,record_type:'task',id,created_at:now,repository:'Kgray44/Aetherwake',revision:rev,title:v.title,objective:v.objective,classification:{primary:v.primary,secondary:[]},prerequisites:{task_ids:v.ids,capabilities:v.capabilities,...(v.mergedIds.length?{merged_task_ids:v.mergedIds}:{})},acceptance:{profile_id:v.profile,criteria:v.accept},state:'proposed',owner_acceptance:'not_reviewed',artifacts:[],
    ...(v.requirements?.length?{requirements:v.requirements}:{}),...(v.deliverables?.length?{deliverables:v.deliverables}:{})};
}
