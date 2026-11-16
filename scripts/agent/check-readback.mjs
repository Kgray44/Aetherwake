/** Bounded GET-only readback. Trusted event, App ID, verification configuration
 * and check ID must come from the isolated publisher, never candidate data.
 * This module does not publish, provision authority, or grant Task acceptance. */
import {prepareExactHeadCheck} from './check-publication.mjs';
export async function readExactHeadCheck({preparation,checkRunId,expectedAppId,token,fetchImpl=fetch}) {
  const repository=preparation?.repository, number=preparation?.event?.number;
  if(!/^[A-Za-z0-9][A-Za-z0-9-]*\/(?!\.{1,2}$)[A-Za-z0-9_.-]+$/.test(repository??'') ||
    !Number.isSafeInteger(number)||number<1||!Number.isSafeInteger(checkRunId)||checkRunId<1||
    !Number.isSafeInteger(expectedAppId)||expectedAppId<1)throw Error('Invalid trusted check identity');
  if(typeof token!=='string'||!token.trim()||/[\r\n]/.test(token))throw Error('Check readback authentication required');
  // Fail malformed preparation before using the credential. This does not
  // authenticate event JSON; only the isolated trusted caller can supply it.
  prepareExactHeadCheck({...preparation,currentPullRequest:preparation.event?.pull_request});
  const root='https://api.github.com/repos/'+repository, signal=AbortSignal.timeout(15000);
  async function get(path) {
    signal.throwIfAborted();
    const response=await fetchImpl(root+path,{method:'GET',redirect:'error',signal,
      headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',Authorization:'Bearer '+token}});
    if(!response.ok)throw Error('Check readback HTTP '+response.status);
    const limit=1024*1024;
    if(Number(response.headers.get('content-length')??0)>limit)throw Error('Check readback response too large');
    if(!response.body)throw Error('Missing check readback body');
    const reader=response.body.getReader(),chunks=[];let size=0;
    while(true){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>limit){await reader.cancel();throw Error('Check readback response too large');}chunks.push(value);}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  const before=await get('/pulls/'+number);
  const expected=prepareExactHeadCheck({...preparation,currentPullRequest:before});
  const check=await get('/check-runs/'+checkRunId), request=expected.request;
  if(check.id!==checkRunId||check.url!==root+'/check-runs/'+checkRunId||check.app?.id!==expectedAppId||
    check.head_sha!==request.head_sha||check.name!==request.name||check.status!=='completed'||check.conclusion!==request.conclusion||
    check.output?.title!==request.output.title||check.output?.summary!==request.output.summary)throw Error('Published check identity or result mismatch');
  // A head/base move while observing must not produce a current-head receipt.
  const after=await get('/pulls/'+number);
  const final=prepareExactHeadCheck({...preparation,currentPullRequest:after});
  if(JSON.stringify(final.request)!==JSON.stringify(request))throw Error('Verification changed during readback');
  return Object.freeze({version:1,kind:'exact-head-check-readback',repository,pull_request_number:number,
    check_run_id:checkRunId,app_id:expectedAppId,source_head:request.head_sha,verifier_revision:expected.verifier_revision,
    conclusion:check.conclusion,matched:true,request_count:3,task_accepted:false,owner_accepted:false});
}
