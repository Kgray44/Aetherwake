/** Pure admission checks for a proposed two-job collector. These functions do
 * not authenticate caller-supplied JSON and must run only behind a trusted
 * GitHub API reader in the protected collector job. No signing/dispatch here. */
import {createHash} from 'node:crypto';
import {canonical} from './evidence-trust.mjs';
const admittedObservations=new WeakSet();
const sha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
export function admitCollectorObservation({expected,run,probe,workflowBytes}) {
  if(!expected||!sha(expected.source_head)||!sha(expected.workflow_revision)||!Number.isSafeInteger(expected.run_id)||expected.run_id<1||!Number.isSafeInteger(expected.run_attempt)||expected.run_attempt<1)throw Error('Invalid trusted expected identity');
  if(!/^[A-Za-z0-9][A-Za-z0-9-]*\/(?!\.{1,2}$)[A-Za-z0-9_.-]+$/.test(expected.repository??''))throw Error('Invalid trusted repository');
  if(typeof expected.default_branch!=='string'||!expected.default_branch.trim()||typeof expected.probe_job_name!=='string'||!expected.probe_job_name.trim())throw Error('Missing trusted branch/job identity');
  if(!/^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(expected.workflow_path??''))throw Error('Invalid trusted workflow path');
  if(!Array.isArray(expected.required_probe_steps)||!expected.required_probe_steps.length||expected.required_probe_steps.some(s=>typeof s!=='string'||!s.trim())||new Set(expected.required_probe_steps).size!==expected.required_probe_steps.length)throw Error('Invalid trusted step obligations');
  if(!/^[a-f0-9]{64}$/.test(expected.workflow_sha256??''))throw Error('Missing trusted workflow digest');
  if(run.repository?.full_name!==expected.repository||run.id!==expected.run_id||run.run_attempt!==expected.run_attempt)throw Error('Run identity mismatch');
  if(run.event!=='workflow_dispatch'||run.head_branch!==expected.default_branch||run.head_sha!==expected.workflow_revision||run.path!==expected.workflow_path)throw Error('Untrusted workflow identity');
  if(createHash('sha256').update(workflowBytes).digest('hex')!==expected.workflow_sha256)throw Error('Workflow integrity mismatch');
  if(probe.run_id!==run.id||probe.run_attempt!==run.run_attempt||probe.name!==expected.probe_job_name||(!Number.isSafeInteger(probe.id)||probe.id<1))throw Error('Probe identity mismatch');
  if(probe.status!=='completed'||probe.conclusion!=='success')throw Error('Probe is not successful');
  const steps=probe.steps??[];
  for(const name of expected.required_probe_steps??[]) {
    const matching=steps.filter(s=>s.name===name);
    if(matching.length!==1||matching[0].status!=='completed'||matching[0].conclusion!=='success')throw Error('Required probe step missing or unsuccessful');
  }
  if(!expected.required_probe_steps?.length)throw Error('No trusted probe obligations');
  const admitted=Object.freeze({version:1,kind:'ci-command-observation',repository:expected.repository,source_head:expected.source_head,workflow_revision:expected.workflow_revision,workflow_sha256:expected.workflow_sha256,run_id:run.id,run_attempt:run.run_attempt,job_id:probe.id,job_conclusion:'success',claim:'reviewed-command-exited-zero',task_verified:false,owner_accepted:false});
  admittedObservations.add(admitted);
  return admitted;
}
export function buildCollectorArtifact(admitted) {
  // Artifact is built in collector isolation from approved fields, never copied
  // from an untrusted producer's artifact, job output, log body or task result.
  if(!admittedObservations.has(admitted)||admitted?.kind!=='ci-command-observation'||admitted.claim!=='reviewed-command-exited-zero'||admitted.task_verified!==false||admitted.owner_accepted!==false)throw Error('Wrong observation type');
  const keys=['version','kind','repository','source_head','workflow_revision','workflow_sha256','run_id','run_attempt','job_id','job_conclusion','claim','task_verified','owner_accepted'];
  const record=Object.fromEntries(keys.map(k=>[k,admitted[k]]));
  const bytes=Buffer.from(canonical(record)+'\n');
  return {bytes,sha256:createHash('sha256').update(bytes).digest('hex')};
}
