import assert from 'node:assert/strict';
import { existsSync, mkdirSync, realpathSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { BackendCore } from '../integrated-backend/src/core.mts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const libraryNativeLabels = Object.freeze({
  project: 'Synthetic Library AC project',
  workspace: 'Synthetic native Blank workspace',
  instance: 'Synthetic native template instance',
  template: 'Synthetic native reusable workspace',
  chat: 'Synthetic native Library Chat',
  note: 'Synthetic native reusable Note',
  task: 'Synthetic native Library Task',
});
export type LibraryNativeSeed = {
  contract: 'aerynth.library-template-native@1';
  syntheticOnly: true;
  labels: typeof libraryNativeLabels;
  hashes: Record<string, string>;
  ordinaryCounts: { projects: 0; workspaces: 0; resources: 0 };
};

/** Prepare schema only. Every ordinary identity must be created by native UI. */
export async function prepareLibraryNative(profile: string): Promise<LibraryNativeSeed> {
  assert(isAbsolute(profile), 'absolute_new_profile_required');
  profile = resolve(profile);
  assert(/^review-workspace-native-ac-/.test(basename(profile)), 'dedicated_library_profile_required');
  assert(!existsSync(profile), 'existing_profiles_must_be_preserved');
  if (process.platform === 'win32') {
    const physical = join(realpathSync(dirname(profile)), basename(profile)), onC = /^C:/i.test(physical), onD = /^D:/i.test(physical);
    assert(onC || onD, 'bounded_C_or_D_profile_required');
    const guard = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-File', join(homedir(), 'AppData/Local/AeroStorageWatch/ReserveGuard.ps1'), '-EstimatedCBytes', String(onC ? 536870912 : 16777216), '-EstimatedDBytes', String(onD ? 536870912 : 0)], { encoding: 'utf8', windowsHide: true, timeout: 15000 }));
    assert.equal(guard.allowed, true, 'storage_reserve_denied');
  }
  mkdirSync(profile, { recursive: false });
  const database = join(profile, 'aerynth.sqlite'), core = new BackendCore({ path: database, privateRoot: profile, cwd: root, provider: 'codex', contentPolicy: 'local-private', retention: { maxEvents: 10000 } });
  try {
    const desktop = await core.command('desktop', { type: 'snapshot' });
    assert.deepEqual([desktop.projects.length, desktop.workspaces.length, desktop.resources.length, desktop.blocks.length], [0, 0, 0, 0]);
    assert.equal(Object.keys((await core.command('snapshot', {})).executions).length, 0);
  } finally { await core.command('close', {}); }
  assert(statSync(database).size <= 32 * 1024 * 1024, 'empty_library_database_checkpoint_exceeded');
  const hashes: Record<string, string> = {};
  for (const relative of [
    ...['prepare-library-native.mts', 'tests/library-native.cjs', 'tests/workspace-native.cjs', 'service.mts', 'canonical-host.mts', 'registry.ts'].map(name => 'prototypes/block-library/' + name),
    'prototypes/integrated-backend/src/core.mts', 'prototypes/workspace-engine/engine.mts',
  ]) {
    hashes[relative] = createHash('sha256').update(readFileSync(join(root, relative))).digest('hex');
  }
  const seed: LibraryNativeSeed = { contract: 'aerynth.library-template-native@1', syntheticOnly: true, labels: libraryNativeLabels, hashes, ordinaryCounts: { projects: 0, workspaces: 0, resources: 0 } };
  const bytes = Buffer.from(JSON.stringify(seed, null, 2));
  assert(bytes.length <= 65536, 'library_seed_bytes_exceeded');
  writeFileSync(join(profile, 'library-native-seed.json'), bytes, { flag: 'wx' });
  return seed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const profile = process.argv.find(value => value.startsWith('--profile='))?.slice(10);
  assert(profile, 'explicit_new_private_profile_required');
  await prepareLibraryNative(profile);
  process.stdout.write(JSON.stringify({ prepared: true, ordinaryProjects: 0, ordinaryWorkspaces: 0, ordinaryResources: 0, evidence: 'Schema preparation only; no UI, model turn or native acceptance.' }) + '\n');
}
