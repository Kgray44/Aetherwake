import test from 'node:test';
import assert from 'node:assert/strict';
import { projectTurnHttpDiagnostic } from '../../application-contract/provider-diagnostics.ts';
const facts = { contract:'aerynth.turn-http-diagnostic@1',httpStatus:200,contentType:'json',hasBody:true,serverRequestId:'req_fixture',bodyShape:'unavailable',remoteCode:null };
test('public HTTP facts whitelist scalars without getters, bodies or outcome authority',()=>{
 assert.deepEqual(projectTurnHttpDiagnostic({...facts,body:'PRIVATE',headers:{Authorization:'PRIVATE'},outcome:'completed'}),facts);
 for(const value of [{...facts,httpStatus:700},{...facts,remoteCode:'PRIVATE'},{...facts,serverRequestId:'Bearer PRIVATE'},{...facts,contentType:'application/json;PRIVATE'},Object.create(facts),{...facts,get bodyShape(){throw Error('must not invoke');}}])assert.equal(projectTurnHttpDiagnostic(value),undefined);
 const first=projectTurnHttpDiagnostic(facts)!;first.httpStatus;assert.notEqual(first,facts);
});
