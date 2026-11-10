import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,relative,isAbsolute } from 'node:path';
import { BackendCore } from '../src/core.mts';

test('canonical application events are delivered only after outer commit and remain detached from unrelated execution',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'aerynth-event-commit-')),delivered:any[]=[];
  const core=new BackendCore({path:join(dir,'canonical.sqlite'),provider:'fixture',contentPolicy:'synthetic-only'},event=>delivered.push(event));
  const owner=core as any;delivered.length=0;
  try{
    const before=(await core.command('replay',{})).events.length;
    assert.throws(()=>owner.atomic(()=>{
      const resource=owner.kernel.createGenericResource('Synthetic aborted domain');
      owner.record('checklist.changed','observed',undefined,'synthetic-aborted-event',{providerId:'aerynth-native',detached:true,resourceId:resource.id});
      assert.equal(delivered.length,0);
      throw Error('synthetic outer rollback');
    }),/synthetic outer rollback/);
    assert.equal(delivered.length,0);assert.equal((await core.command('replay',{})).events.length,before);
    let id='';owner.active={id:'synthetic-unrelated-execution',commandId:'synthetic-provider-command',turnId:'synthetic-native-turn',binding:{nativeThreadId:'synthetic-native-thread'}};
    owner.atomic(()=>{
      id=owner.kernel.createGenericResource('Synthetic committed domain').id;
      owner.atomic(()=>owner.record('checklist.created','observed',undefined,'synthetic-committed-event',{providerId:'aerynth-native',detached:true,resourceId:id,correlationId:'synthetic-domain-command'}));
      assert.equal(delivered.length,0,'nested release is not canonical outer commit');
    });
    assert.equal(delivered.length,1);const event=delivered[0];
    assert.equal(event.resourceId,id);assert.equal(event.providerId,'aerynth-native');assert.equal(event.providerInstanceId,'aerynth.canonical');
    assert.equal(event.correlationId,'synthetic-domain-command');
    for(const key of ['executionId','threadId','turnId','causationId'])assert.equal(event[key],null);
    assert.equal((await core.command('replay',{})).events.at(-1)!.eventId,event.eventId);
    owner.active=null;
    owner.emit=()=>{throw Error('synthetic delivery unavailable');};
    owner.atomic(()=>owner.record('agent.profile.changed','observed',undefined,'synthetic-durable-delivery-failure',{providerId:'aerynth-native',detached:true,resourceId:id}));
    assert.equal((await core.command('replay',{})).events.at(-1)!.type,'agent.profile.changed');
  }finally{
    owner.active=null;await core.command('close',{});
    const target=resolve(dir),part=relative(resolve(tmpdir()),target);assert(part.startsWith('aerynth-event-commit-')&&!part.startsWith('..')&&!isAbsolute(part));rmSync(target,{recursive:true,force:true});
  }
});

test('reentrant canonical observers preserve committed cursor order', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aerynth-event-commit-'));
  const path = join(dir, 'canonical.sqlite');
  const options = {path, provider: 'fixture', contentPolicy: 'synthetic-only'} as const;
  const core = new BackendCore(options);
  const owner = core as any;
  const types = ['vela.synthetic.first', 'vela.synthetic.second', 'vela.synthetic.reentrant'];
  const delivered: {type: string; cursor: number; eventId: string}[] = [];
  const receipt = ({type, cursor, eventId}: typeof delivered[number]) => ({type, cursor, eventId});
  let observerError: unknown;
  owner.emit = (event: typeof delivered[number]) => {
    if (!types.includes(event.type)) return;
    delivered.push(receipt(event));
    if (event.type === types[0]) {
      try { owner.record(types[2], 'observed', undefined, types[2]); }
      catch (error) { observerError = error; }
    }
  };
  try {
    owner.atomic(() => {
      owner.record(types[0], 'observed', undefined, types[0]);
      owner.atomic(() => owner.record(types[1], 'observed', undefined, types[1]));
      assert.deepEqual(delivered, []);
    });
    assert.equal(observerError, undefined);
    const replay = (await core.command('replay', {})).events.filter(event => types.includes(event.type)).map(receipt);
    assert.deepEqual(replay.map(event => event.type), types);
    assert.deepEqual(delivered, replay);
  } finally {
    await core.command('close', {});
    const part = relative(resolve(tmpdir()), resolve(dir));
    assert(part.startsWith('aerynth-event-commit-') && !isAbsolute(part));
    rmSync(dir, {recursive: true, force: true});
  }
});
