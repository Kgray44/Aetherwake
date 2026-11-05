import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { BackendCore } from '../src/core.mts';

test('production workspace inspection reads inactive canonical layouts without navigation, normalization, events or writes', async () => {
  const directory=mkdtempSync(join(tmpdir(),'aerynth-inspection-core-'));
  const core=new BackendCore({path:join(directory,'canonical.sqlite'),provider:'fixture',contentPolicy:'synthetic-only'});
  const owner=core as any, db=owner.db;
  try {
    const project=await core.command('desktop',{type:'createProject',title:'Synthetic inspection project'});
    const projectId=project.projects[0].id;
    const one=await core.command('desktop',{type:'createWorkspace',title:'Synthetic inactive workspace',projectId});
    const workspaceId=one.activeWorkspaceId!;
    await core.command('desktop',{type:'createResource',kind:'note',title:'Synthetic identity',workspaceId});
    await core.command('desktop',{type:'createWorkspace',title:'Synthetic current workspace',projectId:null});
    const engine=owner.desktop.nativeBlockServices().engine;
    const expected=engine.inspectWorkspace(workspaceId);
    const before=db.prepare('SELECT total_changes() AS n').get().n;
    const session=db.prepare('SELECT json FROM desktop_session').get().json;
    const journal=db.prepare('SELECT count(*) AS n FROM intelligence_events').get().n;
    const oldProject=engine.project, oldSnapshot=owner.desktop.snapshot;
    engine.project=()=>{throw Error('inspection_must_not_project_or_initialize');};
    owner.desktop.snapshot=()=>{throw Error('inspection_must_not_normalize_navigation');};
    db.exec('PRAGMA query_only=ON');
    try {
      for(let i=0;i<3;i++) assert.deepEqual((await core.command('library',{name:'inspectWorkspace',input:{workspaceId}})).result,expected);
      assert.equal(db.prepare('SELECT total_changes() AS n').get().n,before);
      assert.equal(db.prepare('SELECT json FROM desktop_session').get().json,session);
      assert.equal(db.prepare('SELECT count(*) AS n FROM intelligence_events').get().n,journal);
    } finally {db.exec('PRAGMA query_only=OFF');engine.project=oldProject;owner.desktop.snapshot=oldSnapshot;}
    for(const input of [{workspaceId,extra:true},{workspaceId:''},{workspaceId:42},null])
      await assert.rejects(core.command('library',{name:'inspectWorkspace',input} as any),/invalid_workspace_inspection/);
    await assert.rejects(core.command('library',{name:'inspectWorkspace',input:{workspaceId:'unknown'}}),/workspace_unavailable/);
    db.prepare("UPDATE projects SET state='archived' WHERE id=?").run(projectId);
    await assert.rejects(core.command('library',{name:'inspectWorkspace',input:{workspaceId}}),/workspace_unavailable/);
    db.prepare("UPDATE projects SET state='active' WHERE id=?").run(projectId);
    db.prepare("UPDATE workspaces SET state='archived' WHERE id=?").run(workspaceId);
    await assert.rejects(core.command('library',{name:'inspectWorkspace',input:{workspaceId}}),/workspace_unavailable/);
  } finally {
    await core.command('close',{});
    const target=resolve(directory),part=relative(resolve(tmpdir()),target);
    assert(part.startsWith('aerynth-inspection-core-')&&!part.startsWith('..')&&!isAbsolute(part));
    rmSync(target,{recursive:true,force:true});
  }
});
