import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BackendCore } from '../integrated-backend/src/core.mts';
import { prepareNativeScale } from './prepare-native-scale.mts';
import type { BlockInstanceSettings } from './contracts.ts';
import type { NoteDocument } from './note-contracts.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), require = createRequire(import.meta.url);
const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');
/** Reuses the bounded canonical allocator. No UI, provider startup, alternative
 * database, constraint solver or renderer. Existing profiles are never reused. */
export async function prepareDragGlide(profile: string) {
  // The allocator admits512MiB on the resolved physical drive, caps its main
  // database at32MiB and refuses existing profiles before allocating anything.
  const initial = await prepareNativeScale(profile, 3);
  const path = join(profile, 'aerynth.sqlite'), core = new BackendCore({ path,privateRoot:profile,cwd:root,provider:'codex',contentPolicy:'local-private',retention:{maxEvents:10000} });
  try {
    let desktop = await core.command('desktop',{type:'snapshot'});
    const note = desktop.resources.find(value => value.kind === 'note')!;
    const movingBlockId = desktop.blocks.find(value => value.resource_id === note.id)!.id;
    for (const [kind,x,y,width,height] of [['note',128,272,420,360],['conversation',700,250,360,420],['task',1100,320,320,260]] as const) {
      const resource = desktop.resources.find(value => value.kind === kind)!;
      const block = desktop.blocks.find(value => value.resource_id === resource.id)!;
      desktop = await core.command('desktop',{type:'geometry',blockId:block.id,expectedVersion:block.version,shape:'rounded',rotation:0,placement:{x,y,width,height,z:block.z}});
    }
    desktop = await core.command('desktop',{type:'setPresence',workspaceId:initial.workspaceId,expectedVersion:desktop.presence!.version,placement:{x:1505,y:150}});
    desktop = await core.command('desktop',{type:'setViewport',workspaceId:initial.workspaceId,viewport:{x:0,y:0,zoom:1}});
    const settings = (await core.command('library',{name:'getBlockSettings',input:movingBlockId})).result as BlockInstanceSettings;
    await core.command('library',{name:'configureBlock',input:{placementId:movingBlockId,expectedVersion:settings.version,configuration:{schemaVersion:1,textScale:1,contentMode:'auto'}}});
    const current = (await core.command('notes',{name:'readNote',input:note.id})).result as NoteDocument;
    if (!current.draft) await core.command('notes',{name:'saveNoteDraft',input:{resourceId:note.id,expectedDraftVersion:0,baseResourceVersion:note.version,content:'Synthetic recovered drag continuity draft.\n'+'Native selection and scroll must survive every layout mode.\n'.repeat(96)}});
    const document = (await core.command('notes',{name:'readNote',input:note.id})).result as NoteDocument;
    assert(document.draft && document.draft.content !== document.resource.content);
    desktop = await core.command('desktop',{type:'snapshot'});
    const configurations = Object.fromEntries(await Promise.all(desktop.blocks.map(async block => [block.id,(await core.command('library',{name:'getBlockSettings',input:block.id})).result])));
    assert.equal(Object.keys((await core.command('snapshot',{})).executions).length,0);
    const hashes = Object.fromEntries(['prototypes/block-library/prepare-drag-glide-native.mts','prototypes/block-library/prepare-native-scale.mts','prototypes/block-library/direct-manipulation.ts','prototypes/block-library/service.mts','prototypes/integrated-backend/src/core.mts','prototypes/workspace-engine/engine.mts','prototypes/workspace-engine/organization.mts','prototypes/workspace-engine/structured-grid.mts'].map(name => [name,digest(readFileSync(join(root,name)))]));
    const validation = { preflightSha256:require('./tests/drag-glide-expressions.cjs').preflight().sha256,
      ...Object.fromEntries(['drag-glide-native.cjs','drag-glide-expressions.cjs','workspace-approach-expressions.cjs','library-native.cjs','native-console.cjs'].map(name => [name,digest(readFileSync(join(root,'prototypes/block-library/tests',name)))])) };
    const seed = {contract:'aerynth.drag-glide-seed@1',syntheticOnly:true,workspaceId:initial.workspaceId,movingBlockId,document,configurations,expected:desktop,hashes,validation,delta:{x:96,y:48},preparation:'Actual Core/library/engine; no native content creation or provider operation'};
    const bytes = Buffer.from(JSON.stringify(seed)); assert(bytes.length <= 262144); assert(statSync(path).size < 32*1024*1024);
    await core.command('close',{});
    assert(statSync(path).size < 32*1024*1024);
    writeFileSync(join(profile,'drag-glide-seed.json'),bytes,{flag:'wx'});
    return seed;
  } finally { await core.command('close',{}).catch(()=>{}); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const profile = process.argv.find(value => value.startsWith('--profile='))?.slice(10); assert(profile,'Pass --profile=<new absolute private profile>');
  const seed = await prepareDragGlide(profile); console.log(JSON.stringify({profile,workspaceId:seed.workspaceId,prepared:true,nativeRun:false,providerExecution:false}));
}
