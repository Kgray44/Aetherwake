/** Presentation only. Inputs are existing authorized observations; this module
 * neither starts work nor treats provider completion as verified task success. */
export type VelaVisualState = 'idle' | 'aware' | 'wake-armed' | 'listening' | 'interpreting' | 'planning' | 'acting' | 'coordinating' | 'speaking' | 'waiting' | 'needs-input' | 'verified' | 'blocked';
export interface VelaVisualEvidence {
  panelPhase?: string;
  pendingRequest?: boolean;
  planning?: boolean;
  applying?: boolean;
  needsInput?: boolean;
  voice?: { active: boolean; microphoneOn: boolean; speaking: boolean };
  wake?: { phase: string; detector: string; microphone: string; actualPlaybackActive?: boolean; backendWorking?: boolean };
  mission?: { outcome: string; runningTasks: number; waits: number };
}
export const velaVisualLabels: Record<VelaVisualState, string> = {
  idle: 'Idle', aware: 'Aware of your input', 'wake-armed': 'Wake word armed locally', listening: 'Microphone live',
  interpreting: 'Processing the current request', planning: 'Preparing a plan', acting: 'Applying an action', coordinating: 'Coordinating active mission tasks',
  speaking: 'Observed audio playback', waiting: 'Waiting', 'needs-input': 'Needs your input', verified: 'Mission verified', blocked: 'Blocked or unavailable',
};
export function velaVisualState(evidence: VelaVisualEvidence): VelaVisualState {
  const mission = evidence.mission;
  if (evidence.panelPhase === 'error' || evidence.wake?.phase === 'ERROR' || mission && ['blocked', 'failed', 'uncertain'].includes(mission.outcome)) return 'blocked';
  if (evidence.needsInput || evidence.panelPhase === 'review' || evidence.panelPhase === 'attention') return 'needs-input';
  if (evidence.voice?.speaking || evidence.wake?.actualPlaybackActive) return 'speaking';
  if (evidence.voice?.active && evidence.voice.microphoneOn || evidence.wake?.phase === 'LISTENING' && evidence.wake.microphone === 'live') return 'listening';
  if (mission?.outcome === 'running' && mission.runningTasks > 1) return 'coordinating';
  if (evidence.applying || evidence.panelPhase === 'applying' || mission?.outcome === 'running' && mission.runningTasks === 1) return 'acting';
  if (evidence.planning || evidence.panelPhase === 'planning') return 'planning';
  if (evidence.pendingRequest || evidence.panelPhase === 'thinking' || evidence.wake?.backendWorking || evidence.wake?.phase === 'WORKING') return 'interpreting';
  if (mission && (mission.waits > 0 || ['queued', 'paused', 'cancelling'].includes(mission.outcome))) return 'waiting';
  if (mission?.outcome === 'verified') return 'verified';
  if (evidence.wake?.phase === 'ARMED' && evidence.wake.detector === 'armed' && evidence.wake.microphone === 'wake-only') return 'wake-armed';
  if (evidence.panelPhase === 'receiving') return 'aware';
  return 'idle';
}
