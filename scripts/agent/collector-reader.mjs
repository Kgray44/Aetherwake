/** Read-only transport for the proposed isolated collector. `expected` MUST come
 * from the collector's trusted event/policy, never the probe or its artifacts.
 * A transport fixture does not constitute authenticated production evidence. */
import {admitCollectorObservation,buildCollectorArtifact} from './collector-admission.mjs';
export async function collectGitHubCommand({expected,token,fetchImpl=fetch}) {
  if(typeof token!=='string'||!token.trim()||/[\r\n]/.test(token))throw Error('Collector authentication required');
  // Validate trusted policy before constructing URLs or making any request.
  if(!expected||!/^[A-Za-z0-9][A-Za-z0-9-]*\/(?!\.{1,2}$)[A-Za-z0-9_.-]+$/.test(expected.repository??'')||!Number.isSafeInteger(expected.run_id)||expected.run_id<1||!Number.isSafeInteger(expected.run_attempt)||expected.run_attempt<1||!/^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(expected.workflow_path??'')||!/^[a-f0-9]{40}$/.test(expected.workflow_revision??'')||!/^[a-f0-9]{40}$/.test(expected.source_head??''))throw Error('Invalid trusted collector identity');
  if(!/^[a-f0-9]{64}$/.test(expected.workflow_sha256??'')||typeof expected.default_branch!=='string'||!expected.default_branch.trim()||typeof expected.probe_job_name!=='string'||!expected.probe_job_name.trim()||!Array.isArray(expected.required_probe_steps)||!expected.required_probe_steps.length||expected.required_probe_steps.some(s=>typeof s!=='string'||!s.trim())||new Set(expected.required_probe_steps).size!==expected.required_probe_steps.length)throw Error('Invalid trusted collector policy');
  const root='https://api.github.com/repos/'+expected.repository;
  async function get(path){
    const response=await fetchImpl(root+path,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',Authorization:'Bearer '+token}});
    if(!response.ok)throw Error('Collector API HTTP '+response.status);
    const limit=8*1024*1024;
    if(Number(response.headers.get('content-length')??0)>limit)throw Error('Collector response too large');
    const stream=response.body.getReader();const chunks=[];let size=0;
    while(true){const {done,value}=await stream.read();if(done)break;size+=value.byteLength;if(size>limit){await stream.cancel();throw Error('Collector response too large');}chunks.push(value);}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  const run=await get('/actions/runs/'+expected.run_id+'/attempts/'+expected.run_attempt);
  const jobs=[];let total=null;
  for(let page=1;page<=10;page++){
    const result=await get('/actions/runs/'+expected.run_id+'/attempts/'+expected.run_attempt+'/jobs?per_page=100&page='+page);
    if(!Array.isArray(result.jobs)||!Number.isSafeInteger(result.total_count)||result.total_count<0||result.total_count>1000)throw Error('Invalid collector job coverage');
    if(total!==null&&total!==result.total_count)throw Error('Collector job coverage changed');total=result.total_count;
    jobs.push(...result.jobs);
    if(jobs.length>total||new Set(jobs.map(j=>j.id)).size!==jobs.length)throw Error('Duplicate or excess collector jobs');
    if(jobs.some(j=>!Number.isSafeInteger(j.id)||j.id<1||j.run_id!==expected.run_id||(Object.hasOwn(j,'run_attempt')&&j.run_attempt!==expected.run_attempt)))throw Error('Collector job identity mismatch');
    if(jobs.length===total)break;
    if(!result.jobs.length||page===10)throw Error('Incomplete collector jobs');
  }
  const probes=jobs.filter(j=>j.name===expected.probe_job_name);
  if(probes.length!==1)throw Error('Expected exactly one probe job');
  const file=await get('/contents/'+expected.workflow_path+'?ref='+expected.workflow_revision);
  if(file.type!=='file'||file.encoding!=='base64'||typeof file.content!=='string')throw Error('Invalid immutable workflow response');
  const workflowBytes=Buffer.from(file.content,'base64');
  // GitHub's attempt-specific jobs endpoint may omit job.run_attempt. The
  // transport binds this field from the selected endpoint; admission still
  // independently verifies the fetched run's attempt against trusted expected.
  const probe={...probes[0],run_attempt:expected.run_attempt};
  return buildCollectorArtifact(admitCollectorObservation({expected,run,probe,workflowBytes}));
}
