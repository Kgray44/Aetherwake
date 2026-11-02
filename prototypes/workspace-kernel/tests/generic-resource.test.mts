import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceKernel } from '../kernel.mts';

test('specialized domains compose one generic canonical identity with events and no note, conversation or workspace', () => {
  const kernel=WorkspaceKernel.open(':memory:');
  try {
    const resource=kernel.createGenericResource('Synthetic domain identity',null,{origin:'user',correlationId:'synthetic-domain-create'});
    assert.equal(resource.kind,'generic');assert.equal(resource.version,1);
    assert.equal(kernel.getResource(resource.id).resource.id,resource.id);
    const updated=kernel.touchGenericResource(resource.id,1);
    assert.equal(updated.version,2);assert.equal(updated.title,resource.title);assert.equal(updated.project_id,resource.project_id);
    assert.throws(()=>kernel.touchGenericResource(resource.id,1),/Resource version changed/);
    kernel.withTransaction(db=>{
      for(const table of ['notes','conversation_refs','workspaces','blocks']) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n,0);
      db.exec('CREATE TABLE synthetic_domain(resource_id TEXT PRIMARY KEY REFERENCES resources(id), value TEXT NOT NULL)');
      const count=db.prepare('SELECT count(*) AS n FROM resources').get()!.n;
      assert.throws(()=>kernel.withTransaction(()=>{
        const aborted=kernel.createGenericResource('Synthetic aborted identity');
        db.prepare('INSERT INTO synthetic_domain VALUES(?,?)').run(aborted.id,'owned domain content');
        throw Error('synthetic rollback');
      }),/synthetic rollback/);
      assert.equal(db.prepare('SELECT count(*) AS n FROM resources').get()!.n,count);
      assert.equal(db.prepare('SELECT count(*) AS n FROM synthetic_domain').get()!.n,0);
      assert.throws(()=>kernel.withTransaction(()=>{kernel.touchGenericResource(resource.id,2);throw Error('touch rollback');}),/touch rollback/);
      assert.equal(kernel.getResource(resource.id).resource.version,2);
    });
  } finally {kernel.close();}
});
