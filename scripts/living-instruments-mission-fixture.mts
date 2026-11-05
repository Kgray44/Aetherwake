import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { BackendCore } from '../prototypes/integrated-backend/src/core.mts';
import type { DesktopSnapshot } from '../prototypes/application-contract/contracts.ts';
import type { MissionPreview, MissionProjection, MissionWorkroom, MissionWorkroomPreview, MissionWorkroomResource } from '../prototypes/integrated-backend/src/mission-contracts.mts';

/** Private verifier fixture. Caller owns a fresh synthetic-only Core/profile and
 * an active workspace, storage admission, profile budget and final Core close.
 * Measurements are real host samples; their workspace is explicitly synthetic.
 * Uses only public canonical commands, with no provider configuration/dispatch,
 * executor replacement, database edits, fake events or artificial active state. */
export async function seedLivingMission(core: BackendCore) {
  const providerActivityBefore = await core.command('providerActivity', {});
  const origin = await core.command('desktop', { type: 'snapshot' }) as DesktopSnapshot;
  assert(origin.activeWorkspaceId, 'A fresh synthetic active workspace is required');
  const objective = 'Measure CPU and RAM', deadline = performance.now() + 8000;
  const preview = await core.command('missions', { name: 'preview', input: { objective } }) as MissionPreview;
  assert(preview.plan, 'The canonical native sampling plan must be available');
  assert(preview.plan.tasks.every(task => !task.specialist), 'This fixture must use local native executors only');
  let mission = await core.command('missions', { name: 'start', input: { objective, fingerprint: preview.fingerprint, requestId: randomUUID() } }) as MissionProjection;
  while (mission.outcome !== 'verified' && performance.now() < deadline) {
    assert(['queued', 'running'].includes(mission.outcome), 'Native sampling mission did not remain eligible for verification: ' + mission.outcome);
    await delay(20);
    mission = await core.command('missions', { name: 'read', input: { id: mission.id } }) as MissionProjection;
  }
  assert.equal(mission.outcome, 'verified', 'Native CPU/RAM sampling must verify within 8 seconds');
  assert(performance.now() <= deadline, 'Native mission exceeded the bounded 8-second window');
  const dependencyEdges = mission.tasks.flatMap(task => task.dependencies.map(dependsOn => ({ taskId: task.id, dependsOn })));
  assert(dependencyEdges.length, 'The native plan must contain real dependency edges');
  assert(dependencyEdges.every(edge => mission.tasks.some(task => task.id === edge.dependsOn)), 'Every dependency must reference a real canonical task');
  const evidence = mission.tasks.flatMap(task => task.attempts.flatMap(attempt => attempt.evidence ? [{ taskId: task.id, executor: attempt.executor,
    attemptId: attempt.id, evidenceId: attempt.evidence.id, source: attempt.evidence.source, observedAt: attempt.evidence.observedAt,
    passed: attempt.verification?.passed === true, verificationEvidenceIds: attempt.verification?.evidenceIds ?? [] }] : []));
  for (const executor of ['sample.cpu', 'sample.ram']) assert(evidence.some(value => value.executor === executor && value.source && value.observedAt && value.passed && value.verificationEvidenceIds.includes(value.evidenceId)), 'Actual verified source evidence is required for ' + executor);

  const roomReview = await core.command('missions', { name: 'workroom-preview', input: { id: mission.id } }) as MissionWorkroomPreview;
  const room = await core.command('missions', { name: 'workroom-apply', input: { id: mission.id, reviewId: roomReview.reviewId } }) as MissionWorkroom;
  const desktop = await core.command('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId: room.workspaceId } }) as DesktopSnapshot;
  const cards = Object.fromEntries(Object.entries(room.missionCards ?? {}).map(([kind, resourceId]) => {
    const block = desktop.blocks.find(block => block.resource_id === resourceId);
    assert(block && desktop.resources.some(resource => resource.id === resourceId), 'Every workroom card must have a real canonical placement and resource');
    return [kind, { resourceId: resourceId!, blockId: block.id }];
  }));
  assert(cards.stream && cards.graph, 'Reviewed workroom must contain actual Stream and Graph cards');
  const stream = await core.command('missions', { name: 'workroom-resource', input: { resourceId: cards.stream.resourceId } }) as MissionWorkroomResource;
  const graph = await core.command('missions', { name: 'workroom-resource', input: { resourceId: cards.graph.resourceId } }) as MissionWorkroomResource;
  assert(stream?.dashboard?.kind === 'stream' && graph?.dashboard?.kind === 'graph', 'Workroom resources must resolve to their actual canonical dashboards');
  assert(stream.dashboard.events.length, 'Actual persisted lifecycle rows are required');
  const graphEdges = graph.dashboard.tasks.flatMap(task => task.dependencies.map(dependsOn => ({ taskId: task.id, dependsOn })));
  assert.deepEqual(graphEdges, dependencyEdges, 'Graph must preserve the native plan dependencies');
  let projectionReadableFromWorkroom = false, workroomReadError: string | null = null;
  try {
    const actual = await core.command('missions', { name: 'read', input: { id: mission.id } }) as MissionProjection;
    assert.equal(actual.id, mission.id); assert.equal(actual.outcome, 'verified'); mission = actual; projectionReadableFromWorkroom = true;
  } catch (error) { workroomReadError = error instanceof Error ? error.message : String(error); }
  const providerActivityAfter = await core.command('providerActivity', {});
  assert.deepEqual(providerActivityAfter, providerActivityBefore, 'Every supported provider activity counter must remain unchanged; unknown values are retained');
  return { contract: 'aerynth.living-mission-fixture@1' as const, missionId: mission.id, originWorkspaceId: origin.activeWorkspaceId,
    workspaceId: room.workspaceId, outcome: mission.outcome, streamResourceId: cards.stream.resourceId, graphResourceId: cards.graph.resourceId, cards,
    conversationResourceId: room.missionConversationResourceId ?? null, checklistResourceId: room.missionChecklistResourceId ?? null,
    timelineResourceId: room.missionTimelineResourceId ?? null, agentCardResourceIds: room.missionAgentCards ?? {},
    streamEventIds: stream.dashboard.events.map(event => event.eventId), streamDashboardKeys: Object.keys(stream.dashboard),
    dependencyEdges, evidence, projectionReadableFromWorkroom, workroomReadError, providerActivityBefore, providerActivityAfter };
}
