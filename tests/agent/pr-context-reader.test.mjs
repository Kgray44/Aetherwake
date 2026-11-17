import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readExactPRContext} from '../../scripts/agent/pr-context-reader.mjs';
const repository='example/repo',head='a'.repeat(40),base='b'.repeat(40);
const input=()=>({repository,number:7,expectedHead:head,expectedBase:base,expectedBaseRef:'main',token:'synthetic-token'});
const pr=(changed_files=1)=>({number:7,state:'open',head:{sha:head,repo:{full_name:'fork/repo'}},base:{ref:'main',sha:base,repo:{full_name:repository}},changed_files});
const comparison=files=>({base_commit:{sha:base},merge_base_commit:{sha:'c'.repeat(40)},files});
function transport(responses){const calls=[];return {calls,fetchImpl:async(url,options)=>{calls.push({url,options});const value=responses.shift();if(value instanceof Response)return value;return new Response(JSON.stringify(value));}};}
test('reads immutable comparison paths and sanitizes returned data',async()=>{const t=transport([pr(),comparison([{filename:'src/new.mjs',previous_filename:'src/old.mjs',status:'renamed',patch:'PRIVATE PATCH'}]),pr()]);const result=await readExactPRContext({...input(),fetchImpl:t.fetchImpl});assert.deepEqual(result.paths,['src/new.mjs','src/old.mjs']);assert.equal(result.currentPullRequest.head.sha,head);assert.ok(!JSON.stringify(result).includes('PRIVATE'));assert.equal(t.calls.length,3);assert.equal(t.calls[1].url,`https://api.github.com/repos/example/repo/compare/${base}...${head}?per_page=1&page=1`);for(const {options} of t.calls){assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer synthetic-token');}});
test('invalid caller identities and missing auth make no requests',async()=>{let calls=0;for(const patch of [{token:undefined},{number:0},{expectedHead:'main'},{expectedBase:'b'},{repository:'../x'}])await assert.rejects(()=>readExactPRContext({...input(),...patch,fetchImpl:async()=>{calls++;throw Error('network')}}));assert.equal(calls,0);});
test('rejects closed wrong-source wrong-base or capped PR before comparison',async()=>{for(const patch of [{state:'closed'},{head:{...pr().head,sha:'c'.repeat(40)}},{base:{...pr().base,sha:'c'.repeat(40)}},{number:8},{changed_files:300},{changed_files:3001}]){const t=transport([{...pr(),...patch}]);await assert.rejects(()=>readExactPRContext({...input(),fetchImpl:t.fetchImpl}));assert.equal(t.calls.length,1);}});
test('rejects moved identity or changed count after immutable comparison',async()=>{for(const patch of [{head:{...pr().head,sha:'c'.repeat(40)}},{changed_files:2},{state:'closed'}]){const t=transport([pr(),comparison([{filename:'src/a',status:'modified'}]),{...pr(),...patch}]);await assert.rejects(()=>readExactPRContext({...input(),fetchImpl:t.fetchImpl}));}});
test('rejects incomplete excessive duplicate and unsafe comparison files',async()=>{for(const files of [[],[{filename:'a',status:'modified'},{filename:'b',status:'added'}],[{filename:'../secret',status:'modified'}],[{filename:'a',status:'renamed'}],[{filename:'a',previous_filename:'../secret',status:'renamed'}],[{filename:'a',status:'unknown'}]]){const t=transport([pr(),comparison(files),pr()]);await assert.rejects(()=>readExactPRContext({...input(),fetchImpl:t.fetchImpl}));}const t=transport([pr(2),comparison([{filename:'a',status:'added'},{filename:'a',status:'added'}]),pr(2)]);await assert.rejects(()=>readExactPRContext({...input(),fetchImpl:t.fetchImpl}));});
test('rejects wrong comparison base and unprovable file truncation',async()=>{for(const result of [{...comparison([{filename:'a',status:'added'}]),base_commit:{sha:'d'.repeat(40)}},comparison(Array.from({length:300},(_,i)=>({filename:'f'+i,status:'added'}))),{...comparison([]),files:undefined}]){const t=transport([pr(),result,pr()]);await assert.rejects(()=>readExactPRContext({...input(),fetchImpl:t.fetchImpl}));}});
test('ABA movement cannot substitute mutable PR paths for exact SHA diff',async()=>{const calls=[];const malicious=[{filename:'docs/harmless.md',status:'modified'}];const immutable=[{filename:'scripts/security-sensitive.mjs',status:'modified'}];const fetchImpl=async(url)=>{calls.push(url);return new Response(JSON.stringify(url.includes('/files')?malicious:url.includes('/compare/')?comparison(immutable):pr()));};const result=await readExactPRContext({...input(),fetchImpl});assert.deepEqual(result.paths,['scripts/security-sensitive.mjs']);assert.equal(calls.some(url=>url.includes('/files')),false);});
test('empty diff requires immutable zero-file confirmation and identity recheck',async()=>{const t=transport([pr(0),comparison([]),pr(0)]);const result=await readExactPRContext({...input(),fetchImpl:t.fetchImpl});assert.deepEqual(result.paths,[]);assert.equal(result.coverage.complete,true);assert.equal(t.calls.length,3);});
test('HTTP and oversized failures remain failures',async()=>{for(const response of [new Response('{}',{status:403}),new Response('{}',{headers:{'content-length':'9000000'}})]){const t=transport([response]);await assert.rejects(()=>readExactPRContext({...input(),fetchImpl:t.fetchImpl}));}});
test('accepts 299 immutable files with diverged merge base but rejects ambiguous cap',async()=>{const files=Array.from({length:299},(_,i)=>({filename:'src/f'+i,status:'modified'}));const t=transport([pr(299),comparison(files),pr(299)]);const result=await readExactPRContext({...input(),fetchImpl:t.fetchImpl});assert.equal(result.paths.length,299);assert.equal(result.coverage.merge_base_revision,'c'.repeat(40));assert.notEqual(result.coverage.merge_base_revision,base);});

test('rejects a retarget to another branch at the same base commit', async () => {
  const retargeted = pr();
  retargeted.base.ref = 'release';
  const exactDiff = comparison([{filename:'src/a.mjs',status:'modified'}]);
  for (const values of [[retargeted, exactDiff, pr()], [pr(), exactDiff, retargeted]]) {
    const t = transport(values);
    await assert.rejects(() => readExactPRContext({...input(), fetchImpl:t.fetchImpl}), /identity/);
  }
});

test('returns the verified target branch and requires it as trusted input', async () => {
  const exactDiff = comparison([{filename:'src/a.mjs',status:'modified'}]);
  const t = transport([pr(), exactDiff, pr()]);
  const result = await readExactPRContext({...input(), fetchImpl:t.fetchImpl});
  assert.equal(result.currentPullRequest.base.ref, 'main');

  const missingRef = transport([pr(), exactDiff, pr()]);
  await assert.rejects(() => readExactPRContext({...input(), expectedBaseRef:undefined, fetchImpl:missingRef.fetchImpl}), /Invalid trusted PR identity/);
  assert.equal(missingRef.calls.length, 0);
});
