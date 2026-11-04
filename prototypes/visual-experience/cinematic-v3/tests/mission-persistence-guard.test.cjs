const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {assertMissionPersistenceReopen,sourceDigest,digest}=require('../native/mission-persistence.cjs');
function fixture(t){
  const localAppData=fs.mkdtempSync(path.join(os.tmpdir(),'aerynth-persistence-guard-')),profile=path.join(localAppData,'Aerynth','review-vela-missions-123456');
  fs.mkdirSync(path.join(profile,'mission-evidence'),{recursive:true});t.after(()=>{assert.equal(path.dirname(localAppData),path.resolve(os.tmpdir()));assert(path.basename(localAppData).startsWith('aerynth-persistence-guard-'));fs.rmSync(localAppData,{recursive:true,force:true});});
  const source={hashes:{'canonical-source':'a'.repeat(64)},buildAssets:{'bundle.js':'b'.repeat(64)}},argv=['electron','.','--integration-vela-missions','--missions-persistence-live-only','--missions-persistence-reopen-only','--bootstrap-vela-api','--profile='+profile],
    checkpoint={contract:'aerynth.vela-persistence-checkpoint@1',profile:path.basename(profile),sourceDigest:sourceDigest(source),conversationId:'conversation:synthetic',requestId:'request:synthetic',userMessageId:'message:1',answerMessageId:'message:2',userContentDigest:digest('Synthetic decision'),answerContentDigest:digest('Synthetic answer'),provenanceDigest:digest('Synthetic proof'),canonicalMessageCount:38,agedNativeTurns:18,apiCalls:1},
    receipt={contract:'aerynth.vela-missions-integration@1',passed:true,nativeCloseConfirmed:true,slotFailure:null,errors:[],startupErrors:[],source,persistence:{phase:'seed',checkpoint}};
  const write=()=>{fs.writeFileSync(path.join(profile,'mission-evidence','journey.json'),JSON.stringify(receipt));fs.writeFileSync(path.join(profile,'mission-evidence','persistence-checkpoint.json'),JSON.stringify(checkpoint));};write();
  return {profile,localAppData,source,argv,checkpoint,receipt,write,check:()=>assertMissionPersistenceReopen({profile,localAppData,source,argv})};
}
test('only exact passed synthetic profile and source-bound closed phase may reopen',t=>{const f=fixture(t);assert.deepEqual(f.check(),f.checkpoint);
  f.argv.splice(f.argv.indexOf('--missions-persistence-reopen-only'),1);assert.throws(f.check,/persistence_reopen_flags_required/);});
test('failed or unclosed phase never becomes a reopen authorization',t=>{const f=fixture(t);for(const key of ['passed','nativeCloseConfirmed']){f.receipt[key]=false;f.write();assert.throws(f.check,/passed_persistence_seed_required/);f.receipt[key]=true;}});
test('changed source, copied profile marker, foreign parent and mixed journey flags fail closed',t=>{const f=fixture(t);
  f.source.hashes['canonical-source']='c'.repeat(64);assert.throws(f.check,/bound_persistence_checkpoint_required/);f.source.hashes['canonical-source']='a'.repeat(64);
  f.checkpoint.profile='review-vela-missions-999';f.write();assert.throws(f.check,/bound_persistence_checkpoint_required/);f.checkpoint.profile=path.basename(f.profile);f.write();
  assert.throws(()=>assertMissionPersistenceReopen({...f,localAppData:path.join(f.localAppData,'foreign')}),/owned_persistence_parent_required/);
  f.argv.push('--missions-api-live-only');assert.throws(f.check,/one_persistence_journey_required/);});
test('a reopen is single attempt and cannot reuse or overwrite its evidence directory',t=>{const f=fixture(t);fs.mkdirSync(path.join(f.profile,'mission-reopen-evidence'));assert.throws(f.check,/persistence_reopen_already_attempted/);});
test('forged marker content and insufficient aging are rejected even when source identity matches',t=>{const f=fixture(t);f.checkpoint.agedNativeTurns=1;f.write();assert.throws(f.check,/bound_persistence_checkpoint_required/);
  f.checkpoint.agedNativeTurns=18;f.receipt.persistence.checkpoint={...f.checkpoint,userMessageId:'different'};f.write();assert.throws(f.check,/bound_persistence_checkpoint_required/);});
