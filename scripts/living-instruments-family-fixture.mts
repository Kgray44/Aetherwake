import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { BackendCore } from '../prototypes/integrated-backend/src/core.mts';
import type { BlockKind, DesktopSnapshot } from '../prototypes/application-contract/contracts.ts';
import type { TaskDefinition, TaskObjectiveDocument, TaskObjectiveReceipt } from '../prototypes/task-product/contracts.ts';
import type { TaskTargetPage } from '../prototypes/application-contract/task-targets.ts';
import type { AgentMutationReceipt, AgentProfileData } from '../prototypes/agent-product/contracts.ts';
import type { LibraryCapabilities } from '../prototypes/block-library/contracts.ts';
import type { LibraryRequest } from '../prototypes/integrated-backend/src/contracts.mts';

/** Public canonical setup for a private native verifier. Caller owns a fresh
 * synthetic-only Core/profile, storage budget and final close. All text is
 * explicitly synthetic. No provider setup, inference, fake reply or execution. */
export async function seedLivingFamilies(core: BackendCore) {
  const before = await core.command('providerActivity', {}), commandId = () => 'synthetic-family:' + randomUUID();
  let desktop = await core.command('desktop', { type: 'createProject', title: 'SYNTHETIC instrument families' }) as DesktopSnapshot;
  const project = desktop.projects.find(value => value.title === 'SYNTHETIC instrument families')!;
  desktop = await core.command('desktop', { type: 'createWorkspace', title: 'SYNTHETIC family acceptance', projectId: project.id }) as DesktopSnapshot;
  const workspaceId = desktop.activeWorkspaceId!; assert(workspaceId);
  desktop = await core.command('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId } }) as DesktopSnapshot;
  const snapshot = async () => desktop = await core.command('desktop', { type: 'snapshot' }) as DesktopSnapshot;
  const library = async (name: LibraryRequest['name'], input: unknown) => core.command('library', { name, input } as LibraryRequest) as Promise<any>;
  const create = async (kind: BlockKind, title: string) => {
    desktop = await core.command('desktop', { type: 'createResource', kind, title, workspaceId }) as DesktopSnapshot;
    const resource = desktop.resources.find(value => value.title === title && value.kind === kind); assert(resource); return resource;
  };
  const attach = async (kind: BlockKind, resourceId: string) => {
    await snapshot(); const resource = desktop.resources.find(value => value.id === resourceId); assert(resource);
    await library('attachBlock', { commandId: commandId(), workspaceId, expectedLayoutVersion: desktop.layoutVersion, kind,
      resourceId, expectedResourceVersion: resource.version }); await snapshot();
  };
  const note = await create('note', 'SYNTHETIC field notes');
  const noteContent = '# Synthetic field guide\n\nThis local fixture contains no private user data.\n\n## Review criterion\n\nInspect the canonical heading and retain editor selection.\n\n## Source notes\n\n- Manual task status is not verified execution.\n- A saved agent is not running.\n';
  desktop = await core.command('desktop', { type: 'content', resourceId: note.id, expectedVersion: note.version, content: noteContent }) as DesktopSnapshot;
  const first = await create('task', 'SYNTHETIC inspect note heading'), second = await create('task', 'SYNTHETIC compare source notes');
  const group = await create('task_group', 'SYNTHETIC manual progress');
  desktop = await core.command('desktop', { type: 'setTaskGroupMembers', groupId: group.id, expectedVersion: group.version, taskIds: [first.id, second.id] }) as DesktopSnapshot;
  desktop = await core.command('desktop', { type: 'taskStatus', resourceId: first.id, expectedVersion: first.version, status: 'done' }) as DesktopSnapshot;

  const templates = (await core.command('agents', { name: 'templates', input: {} })).result as { profile: AgentProfileData }[]; assert(templates.length);
  const profile = structuredClone(templates[0].profile);
  profile.purpose = 'SYNTHETIC saved reviewer profile. This fixture does not start an execution.';
  profile.specialties = ['Source inspection', 'Comparison'];
  profile.settings.requiredCapabilities = { source: 'override', value: ['read-files', 'compare-sources'] };
  const agent = (await core.command('agents', { name: 'create', input: { commandId: commandId(), title: 'SYNTHETIC saved reviewer', projectId: project.id, profile } })).result as AgentMutationReceipt;
  await attach('agent', agent.agent.resourceId);
  const createObjective = async (title: string, definition: TaskDefinition) => (await core.command('taskObjectives', { name: 'create', input: {
    commandId: commandId(), title, projectId: project.id, definition,
  } })).result as TaskObjectiveReceipt;
  const dependency = await createObjective('SYNTHETIC prerequisite', { objective: 'Read the synthetic field guide before review.', requirements: [], assignees: [], dependencies: [], sources: [] });
  const targets = async (kind: 'source' | 'assignee' | 'dependency', query: string) => (await core.command('taskObjectives', { name: 'targets', input: { kind, query, limit: 10 } })).result as TaskTargetPage;
  const source = (await targets('source', note.title)).items.find(value => value.kind === 'source' && value.reference.resourceId === note.id);
  const assignee = (await targets('assignee', 'SYNTHETIC saved reviewer')).items.find(value => value.kind === 'assignee' && value.reference.kind === 'agent' && value.reference.resourceId === agent.agent.resourceId);
  const prerequisite = (await targets('dependency', 'SYNTHETIC prerequisite')).items.find(value => value.kind === 'dependency' && value.reference.resourceId === dependency.resourceId);
  assert(source?.kind === 'source' && prerequisite?.kind === 'dependency', 'Canonical source and dependency targets must be readable');
  const objective = await createObjective('SYNTHETIC review objective', { objective: 'Inspect the synthetic note without claiming execution or acceptance.',
    requirements: [{ id: 'synthetic:heading', text: 'Inspect the synthetic field-guide heading.' }, { id: 'synthetic:comparison', text: 'Compare the source notes explicitly.' }],
    sources: [source.reference], dependencies: [prerequisite.reference], assignees: assignee?.kind === 'assignee' ? [assignee.reference] : [] });
  await attach('task_objective', objective.resourceId);
  const objectiveDocument = (await core.command('taskObjectives', { name: 'read', input: { resourceId: objective.resourceId } })).result as TaskObjectiveDocument;
  assert.equal(objectiveDocument.verification, 'unreviewed'); assert.equal(objectiveDocument.acceptance.state, 'not-accepted');

  const conversation = await core.command('createConversation', { commandId: commandId(), title: 'SYNTHETIC ordinary local conversation', providerId: 'local' });
  const message = await core.command('addMessage', { resourceId: conversation.resourceId, role: 'user', content: 'SYNTHETIC local user message. No model response or delegated work was requested.', expectedRevision: 1 });
  await core.command('desktop', { type: 'attach', workspaceId, resourceId: conversation.resourceId });
  const capabilities = (await library('capabilities', {})).result as LibraryCapabilities;
  const subjects: Record<string, { blockId: string; subject: unknown }> = {}, unavailableSubjects: Record<string, unknown> = {};
  for (const [kind, subject] of [['project_overview', { kind: 'project', projectId: project.id }], ['resource_browser', { kind: 'resource-query', projectId: project.id, query: '' }]] as const) {
    const availability = capabilities.subjects?.[kind];
    if (availability?.state !== 'available') { unavailableSubjects[kind] = availability ?? { state: 'unknown' }; continue; }
    await snapshot(); const created = (await library('createSubjectBlock', { commandId: commandId(), workspaceId,
      expectedLayoutVersion: desktop.layoutVersion, kind, subject })).result;
    subjects[kind] = { blockId: created.placementId, subject: created.subject };
  }
  await snapshot();
  const placements = Object.fromEntries([['note', note.id], ['task_group', group.id], ['task_objective', objective.resourceId], ['agent', agent.agent.resourceId], ['conversation', conversation.resourceId]].map(([kind, resourceId]) => {
    const block = desktop.blocks.find(value => value.resource_id === resourceId); assert(block); return [kind, { resourceId, blockId: block.id }];
  }));
  const actualGroup = desktop.resources.find(value => value.id === group.id)!;
  assert.equal(actualGroup.taskMembers?.filter(value => value.status === 'done').length, 1);
  const after = await core.command('providerActivity', {}); assert.deepEqual(after, before, 'Provider counters must remain unchanged; unknown values stay unknown');
  return { contract: 'aerynth.living-family-fixture@1' as const, projectId: project.id, workspaceId, placements, subjects, unavailableSubjects,
    manualTaskIds: [first.id, second.id], prerequisiteResourceId: dependency.resourceId, conversationMessageId: message.id,
    expected: { noteContent, headings: ['Synthetic field guide', 'Review criterion', 'Source notes'], manualDone: 1, manualTotal: 2,
      requirementCount: 2, verifiedRequirementCount: 0, dependencyCount: 1, acceptedDependencyCount: 0, assigneeCount: objectiveDocument.assignees.length,
      verification: objectiveDocument.verification, acceptance: objectiveDocument.acceptance.state, requestedCapabilities: profile.settings.requiredCapabilities.value,
      agentExecutionStarted: false, conversationUserMessages: 1, conversationModelMessages: 0 }, providerActivityBefore: before, providerActivityAfter: after };
}
