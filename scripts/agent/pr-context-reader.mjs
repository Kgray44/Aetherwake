/** Read-only input acquisition for a future isolated trusted verifier.
 * Expected identities must come from its GitHub-issued event, not candidate
 * files. This module never writes checks or makes caller JSON authoritative. */
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const repo=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9-]*\/(?!\.{1,2}$)[A-Za-z0-9_.-]+$/.test(value);
const validPath=value=>typeof value==='string'&&value.length>0&&!/[\\\x00-\x1f\x7f]/.test(value)&&!value.startsWith('/')&&!/^[a-z]:/i.test(value)&&!value.split('/').some(part=>!part||part==='.'||part==='..');
export async function readExactPRContext({repository,number,expectedHead,expectedBase,expectedBaseRef,token,fetchImpl=fetch}) {
  if(!repo(repository)||!Number.isSafeInteger(number)||number<1||!sha(expectedHead)||!sha(expectedBase)||typeof expectedBaseRef!=='string'||!expectedBaseRef.trim())throw Error('Invalid trusted PR identity');
  if(typeof token!=='string'||!token.trim()||/[\r\n]/.test(token))throw Error('Authenticated reader required');
  const root='https://api.github.com/repos/'+repository;
  async function get(suffix){
    const response=await fetchImpl(root+suffix,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',Authorization:'Bearer '+token}});
    if(!response.ok)throw Error('PR reader HTTP '+response.status);
    const maxBytes=8*1024*1024;
    if(Number(response.headers.get('content-length')??0)>maxBytes)throw Error('PR response too large');
    const stream=response.body.getReader(),chunks=[];let bytes=0;
    while(true){const {done,value}=await stream.read();if(done)break;bytes+=value.byteLength;if(bytes>maxBytes){await stream.cancel();throw Error('PR response too large');}chunks.push(value);}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  function admit(pr){
    if(pr?.number!==number||pr.state!=='open'||pr.head?.sha!==expectedHead||pr.base?.sha!==expectedBase||pr.base?.ref!==expectedBaseRef||pr.base?.repo?.full_name!==repository||!repo(pr.head?.repo?.full_name))throw Error('PR identity changed or mismatched');
    if(!Number.isSafeInteger(pr.changed_files)||pr.changed_files<0||pr.changed_files>=300)throw Error('PR changed-file coverage unavailable');
  }
  const before=await get('/pulls/'+number);admit(before);
  const files=[],seen=new Set(),paths=new Set();
  // Immutable SHA inputs avoid the ABA race inherent in paginated PR files.
  // GitHub includes at most 300 files on compare page 1. Reject the cap itself
  // because the endpoint has no separate total-file-count truncation proof.
  const comparison=await get('/compare/'+expectedBase+'...'+expectedHead+'?per_page=1&page=1');
  const batch=comparison?.files;
  if(comparison?.base_commit?.sha!==expectedBase||!sha(comparison?.merge_base_commit?.sha)||!Array.isArray(batch)||batch.length>=300||batch.length!==before.changed_files)throw Error('Immutable changed-file coverage unavailable');
    for(const file of batch){
      if(!validPath(file?.filename)||seen.has(file.filename)||!['added','removed','modified','renamed','copied','changed','unchanged'].includes(file.status))throw Error('Invalid or duplicate PR file identity');
      if(file.status==='renamed'&&!validPath(file.previous_filename))throw Error('Missing rename source path');
      if(file.previous_filename!==undefined&&!validPath(file.previous_filename))throw Error('Invalid previous file path');
      seen.add(file.filename);paths.add(file.filename);if(file.previous_filename!==undefined)paths.add(file.previous_filename);
      files.push(file.filename);
    }
  const current=await get('/pulls/'+number);admit(current);
  if(current.changed_files!==before.changed_files||current.head.repo.full_name!==before.head.repo.full_name)throw Error('PR changed during collection');
  return {currentPullRequest:{number:current.number,state:current.state,head:{sha:current.head.sha,repo:{full_name:current.head.repo.full_name}},base:{ref:current.base.ref,sha:current.base.sha,repo:{full_name:current.base.repo.full_name}}},paths:[...paths].sort(),coverage:{changed_files:files.length,complete:true,method:'immutable-sha-comparison',source_head:expectedHead,base_revision:expectedBase,merge_base_revision:comparison.merge_base_commit.sha},task_accepted:false,owner_accepted:false};
}
