import type { BackendCore } from '../src/core.mts';
import { createMissionAdmission } from '../src/mission-admission.mts';
import { MISSION_LIMITS } from '../src/mission-contracts.mts';
import type { MissionService } from '../src/mission-service.mts';

/** Deterministic physical-memory input through the real governor and lease gate. */
export function fixtureMissionMemory(core: BackendCore) {
  const host = core as unknown as {
    missionAdmission: ReturnType<typeof createMissionAdmission>;
    missions: MissionService;
  };
  let availableMemory = 1024 ** 3;
  host.missionAdmission.dispose();
  host.missionAdmission = createMissionAdmission({ maxWorkers: MISSION_LIMITS.workers,
    availableMemory: () => availableMemory, readWindowsPressure: null });
  return (bytes: number) => {
    availableMemory = bytes;
    host.missions.capacityChanged();
  };
}
