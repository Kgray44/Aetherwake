/** Bounded read-only GitHub observation. Never promotes a green run to Task acceptance. */
export async function observeGitHubRun({repository,sourceHead,runId,expectedWorkflowPath,token,fetchImpl=fetch}) {
  if(!/^[A-Za-z0-9][A-Za-z0-9-]*\/(?!\.{1,2}$)[A-Za-z0-9_.-]+$/.test(repository??''))throw Error('Invalid repository');
  if(!/^[a-f0-9]{40}$/i.test(sourceHead??''))throw Error('Expected exact source head');
  if(!/^[1-9][0-9]*$/.test(String(runId)))throw Error('Invalid run ID');
  if(!/^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(expectedWorkflowPath??''))throw Error('Expected reviewed workflow path');
  let requests=0;
  async function get(suffix) {
    requests++;
    const response=await fetchImpl('https://api.github.com/repos/'+repository+suffix,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(token?{Authorization:'Bearer '+token}:{})}});
    if(!response.ok){const error=Error('GitHub observation HTTP '+response.status);error.status=response.status;error.retryAfter=response.headers.get('retry-after');error.rateLimitReset=response.headers.get('x-ratelimit-reset');throw error;}
    if(Number(response.headers.get('content-length')??0)>8*1024*1024)throw Error('GitHub response too large');
    const reader=response.body.getReader(), chunks=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8*1024*1024){await reader.cancel();throw Error('GitHub response too large');}chunks.push(value);}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  const run=await get('/actions/runs/'+runId);
  if(run.repository?.full_name!==repository||run.head_sha!==sourceHead||String(run.id)!==String(runId))throw Error('GitHub run repository/head/ID mismatch');
  if(!Number.isSafeInteger(run.run_attempt)||run.run_attempt<1)throw Error('Invalid GitHub run attempt');
  if(run.path!==expectedWorkflowPath)throw Error('GitHub workflow identity mismatch');
  const jobs=[];let total=0;
  for(let page=1;page<=10;page++){
    const result=await get('/actions/runs/'+runId+'/attempts/'+run.run_attempt+'/jobs?per_page=100&page='+page);
    if(!Array.isArray(result.jobs)||!Number.isSafeInteger(result.total_count)||result.total_count<0)throw Error('Invalid GitHub jobs response');
    total=result.total_count;jobs.push(...result.jobs);
    if(jobs.length>=total)break;
    if(result.jobs.length===0||page===10)throw Error('GitHub job coverage incomplete');
  }
  if(new Set(jobs.map(j=>j.id)).size!==jobs.length)throw Error('Duplicate GitHub jobs');
  const observedAt=new Date().toISOString();
  return {
    version:1,source:'github-rest',collection_method:'independent-read-only-api',observed_at:observedAt,
    repository,source_head:sourceHead,run_id:run.id,run_attempt:run.run_attempt,workflow_path:run.path,
    status:run.status,conclusion:run.conclusion,event:run.event,
    url:'https://github.com/'+repository+'/actions/runs/'+runId,
    created_at:run.created_at??null,started_at:run.run_started_at??null,updated_at:run.updated_at??null,
    jobs:jobs.map(j=>({id:j.id,name:j.name,status:j.status,conclusion:j.conclusion,started_at:j.started_at??null,completed_at:j.completed_at??null})),
    coverage:{jobs:{availability:'observed',covered:jobs.length,total},source_head:{availability:'observed'},tested_revision:{availability:'unavailable',reason:'Run metadata does not prove the commit actually checked out by test steps'},workflow_integrity:{availability:'unavailable',reason:'Workflow path is identity, not proof its definition and invoked scripts preserved required standards'},artifact_bytes:{availability:'unavailable'},owner_acceptance:{availability:'unavailable'}},
    request_count:requests,task_verified:false,owner_accepted:false
  };
}
