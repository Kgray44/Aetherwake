import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { BackendCore } from '../integrated-backend/src/core.mts';
import type { DesktopSnapshot, BlockKind } from '../application-contract/contracts.ts';
import type { CreatedBlock, CreatedSubjectBlock } from './contracts.ts';
import type { NoteDocument } from './note-contracts.ts';
import type { ConversationDraft } from '../conversation-product/src/contracts.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
type Preflight = { factories: number; cases: number; names: string[]; sha256: string };
const { preflight } = require('./tests/workspace-functional-expressions.cjs') as { preflight(): Preflight };
export const functionalLabels = Object.freeze({
  project: 'Synthetic combined functional project',
  workspace: 'Synthetic distinct functional workspace',
  alternate: 'Synthetic project reference workspace',
  local: 'Synthetic local conversation',
  codex: 'Synthetic Codex identity only',
  note: 'Synthetic functional Note',
  group: 'Synthetic task manager',
  stream: 'Synthetic recorded activity',
  recoveryTask: 'Synthetic untouched recovery task',
  nativeTask: 'Synthetic native combined task',
  message: 'Synthetic native local message. This records user text without a model response.',
  localDraft: 'Synthetic new local unsent draft after recording the message.',
  noteText: 'Synthetic native Note edit. Existing autosave persists this after the explicit recovery decision.',
});
type ResourcePlacement = { blockId: string; resourceId: string };
export type FunctionalWorkspaceSeed = {
  contract: 'aerynth.functional-workspace-native@1';
  syntheticOnly: true;
  labels: typeof functionalLabels;
  projectId: string;
  workspaceId: string;
  alternateWorkspaceId: string;
  placements: Record<'local' | 'codex' | 'note' | 'group' | 'stream', ResourcePlacement> & { project: { blockId: string } };
  recoveryTaskId: string;
  documents: Record<string, NoteDocument>;
  drafts: Record<string, ConversationDraft>;
  expected: DesktopSnapshot;
  alternate: Pick<DesktopSnapshot, 'blocks' | 'viewport' | 'organization' | 'presence'>;
  baselineEventCursor: number;
  hashes: Record<string, string>;
  validation: { preflightSha256: string; helperSha256: string; expressionHelperSha256: string; commonHelperSha256: string };
  codexScope: 'prepared identity only; no native session, capability probe or turn';
};

/** Offline canonical fixture, distinct from the later native actions. Preparing
 * a Codex identity does not connect to App Server or establish execution. */
export async function prepareFunctionalWorkspaceNative(profile: string): Promise<FunctionalWorkspaceSeed> {
  assert(isAbsolute(profile), 'absolute_new_profile_required');
  profile = resolve(profile);
  assert(/^review-workspace-native-functional-/.test(basename(profile)), 'dedicated_functional_profile_required');
  assert(!existsSync(profile), 'existing_profiles_must_be_preserved');
  const compiled = preflight();
  if (process.platform === 'win32') {
    const physical = join(realpathSync(dirname(profile)), basename(profile)), onC = /^C:/i.test(physical), onD = /^D:/i.test(physical);
    assert(onC || onD, 'bounded_C_or_D_profile_required');
    const admission = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-File', join(homedir(), 'AppData/Local/AeroStorageWatch/ReserveGuard.ps1'), '-EstimatedCBytes', String(onC ? 536870912 : 16777216), '-EstimatedDBytes', String(onD ? 536870912 : 0)], { encoding: 'utf8', windowsHide: true, timeout: 15000 }));
    assert.equal(admission.allowed, true, 'storage_reserve_denied');
  }
  mkdirSync(profile);
  const database = join(profile, 'aerynth.sqlite'), core = new BackendCore({ path: database, privateRoot: profile, cwd: root, provider: 'codex', contentPolicy: 'local-private', retention: { maxEvents: 10000 } });
  let seed!: FunctionalWorkspaceSeed;
  try {
    const empty = await core.command('desktop', { type: 'snapshot' });
    assert.deepEqual([empty.projects.length, empty.workspaces.length, empty.resources.length, empty.blocks.length], [0, 0, 0, 0]);
    let desktop = await core.command('desktop', { type: 'createProject', title: functionalLabels.project });
    const projectId = desktop.projects[0].id;
    desktop = await core.command('desktop', { type: 'createWorkspace', title: functionalLabels.workspace, projectId });
    const workspaceId = desktop.activeWorkspaceId!;
    desktop = await core.command('desktop', { type: 'setOrganization', workspaceId, expectedOrganizationRevision: desktop.organization!.revision, organization: { mode: 'freeform' } });
    desktop = await core.command('desktop', { type: 'setPresence', workspaceId, expectedVersion: desktop.presence!.version, placement: { x: 1440, y: 170 } });
    desktop = await core.command('desktop', { type: 'setViewport', workspaceId, viewport: { x: 0, y: -80, zoom: 0.9 } });
    const placements = {} as FunctionalWorkspaceSeed['placements'];
    const roles = ['local', 'codex', 'note', 'group', 'stream', 'project'] as const;
    for (const [index, role] of roles.entries()) {
      const presentation = { x: 90 + index % 3 * 460, y: 160 + Math.floor(index / 3) * 420, width: 400, height: 340, zIndex: index };
      let created: CreatedBlock | CreatedSubjectBlock;
      if (role === 'project') {
        const result = await core.command('library', { name: 'createSubjectBlock', input: { commandId: randomUUID(), workspaceId, expectedLayoutVersion: desktop.layoutVersion, kind: 'project_overview', subject: { kind: 'project', projectId }, presentation } });
        created = result.result as CreatedSubjectBlock; desktop = result.desktop!;
        placements.project = { blockId: created.placementId };
      } else if (role === 'codex') {
        // The existing conversation API deliberately supports identity staging
        // independently from fresh authenticated Library execution capability.
        const identity = await core.command('createConversation', { title: functionalLabels.codex, providerId: 'codex-app-server', commandId: randomUUID() });
        desktop = await core.command('desktop', { type: 'snapshot' });
        const resource = desktop.resources.find(r => r.id === identity.resourceId)!;
        await core.command('conversation', { name: 'organize', input: { type: 'associateProject', resourceId: resource.id, projectId, expectedVersion: resource.version } });
        desktop = await core.command('desktop', { type: 'snapshot' });
        const result = await core.command('library', { name: 'attachBlock', input: { commandId: randomUUID(), workspaceId, expectedLayoutVersion: desktop.layoutVersion, kind: 'conversation', resourceId: identity.resourceId, expectedResourceVersion: desktop.resources.find(r => r.id === identity.resourceId)!.version, presentation } });
        created = result.result as CreatedBlock; desktop = result.desktop!;
        placements.codex = { blockId: created.placementId, resourceId: identity.resourceId };
      } else {
        const kind: BlockKind = role === 'local' ? 'conversation' : role === 'group' ? 'task_group' : role;
        const result = await core.command('library', { name: 'createBlock', input: { commandId: randomUUID(), workspaceId, expectedLayoutVersion: desktop.layoutVersion, kind, title: functionalLabels[role], ...(role === 'local' ? { provider: 'local' as const } : {}), presentation } });
        created = result.result as CreatedBlock; desktop = result.desktop!;
        placements[role] = { blockId: created.placementId, resourceId: created.resourceId };
      }
      assert(statSync(database).size <= 33554432, 'functional_database_checkpoint_exceeded');
    }
    desktop = await core.command('desktop', { type: 'createResource', kind: 'task', title: functionalLabels.recoveryTask, workspaceId: null });
    const recoveryTask = desktop.resources.find(r => r.title === functionalLabels.recoveryTask)!;
    // An unplaced recovery sentinel has no project association. It must not be
    // selected by the later native membership action or counted as project work.
    const documents: Record<string, NoteDocument> = {};
    for (const [id, canonical, recovery] of [
      [placements.note.resourceId, 'Synthetic original canonical Note. The prepared recovery is separate.', 'Synthetic prepared Note recovery to review and explicitly save through native controls.'],
      [recoveryTask.id, 'Synthetic untouched canonical recovery task.', 'Synthetic untouched separate Task recovery. Never save, discard, select or overwrite it.'],
    ]) {
      const resource = desktop.resources.find(r => r.id === id)!;
      desktop = await core.command('desktop', { type: 'content', resourceId: id, expectedVersion: resource.version, content: canonical });
      const doc = (await core.command('notes', { name: 'readNote', input: id })).result as NoteDocument;
      await core.command('notes', { name: 'saveNoteDraft', input: { resourceId: id, expectedDraftVersion: doc.draftRevision, baseResourceVersion: doc.resource.version, content: recovery } });
      documents[id] = (await core.command('notes', { name: 'readNote', input: id })).result as NoteDocument;
      assert(documents[id].draft && documents[id].draft!.content !== documents[id].resource.content);
    }
    const drafts: Record<string, ConversationDraft> = {};
    for (const role of ['local', 'codex'] as const) {
      const resourceId = placements[role].resourceId;
      drafts[resourceId] = await core.command('conversation', { name: 'saveDraft', input: { resourceId, expectedVersion: 0, content: role === 'local' ? 'Synthetic prepared ordinary unsent draft.' : 'Synthetic preserved Codex unsent draft. No turn is authorized by this fixture.' } }) as ConversationDraft;
    }
    desktop = await core.command('desktop', { type: 'createWorkspace', title: functionalLabels.alternate, projectId });
    const alternateWorkspaceId = desktop.activeWorkspaceId!, alternate = { blocks: desktop.blocks, viewport: desktop.viewport, organization: desktop.organization, presence: desktop.presence };
    desktop = await core.command('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId } });
    const integration = await core.command('snapshot', {});
    assert.equal(Object.keys(integration.executions).length, 0);
    assert.equal(integration.graph.messages.length, 0);
    assert.equal(Object.keys(integration.bindings).length, 0, 'A prepared Codex identity has no native session');
    assert.equal(desktop.resources.find(r => r.id === placements.codex.resourceId)!.providerId, 'codex-app-server');
    const hashes: Record<string, string> = {};
    for (const relative of [
      ...['prepare-functional-workspace-native.mts', 'tests/workspace-functional.cjs', 'tests/workspace-functional-expressions.cjs', 'tests/workspace-native.cjs', 'service.mts', 'registry.ts'].map(name => 'prototypes/block-library/' + name),
      'prototypes/integrated-backend/src/core.mts', 'prototypes/workspace-engine/engine.mts',
    ]) hashes[relative] = createHash('sha256').update(readFileSync(join(root, relative))).digest('hex');
    const digest = (name: string) => createHash('sha256').update(readFileSync(join(root, 'prototypes/block-library/tests', name))).digest('hex');
    seed = { contract: 'aerynth.functional-workspace-native@1', syntheticOnly: true, labels: functionalLabels, projectId, workspaceId, alternateWorkspaceId, placements, recoveryTaskId: recoveryTask.id, documents, drafts, expected: desktop, alternate, baselineEventCursor: (await core.command('replay', { after: 0, limit: 1 })).latest, hashes, validation: { preflightSha256: compiled.sha256, helperSha256: digest('workspace-functional.cjs'), expressionHelperSha256: digest('workspace-functional-expressions.cjs'), commonHelperSha256: digest('workspace-approach-expressions.cjs') }, codexScope: 'prepared identity only; no native session, capability probe or turn' };
  } finally { await core.command('close', {}); }
  assert(statSync(database).size <= 33554432, 'functional_database_checkpoint_exceeded');
  const bytes = Buffer.from(JSON.stringify(seed, null, 2)); assert(bytes.length <= 262144, 'functional_seed_bytes_exceeded');
  writeFileSync(join(profile, 'workspace-functional-seed.json'), bytes, { flag: 'wx' });
  return seed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const profile = process.argv.find(arg => arg.startsWith('--profile='))?.slice(10); assert(profile, 'explicit_new_private_profile_required');
  const seed = await prepareFunctionalWorkspaceNative(profile);
  process.stdout.write(JSON.stringify({ prepared: true, nativeRun: false, providerExecution: false, blocks: seed.expected.blocks.length, workspaces: seed.expected.workspaces.length, codex: seed.codexScope }) + '\n');
}
