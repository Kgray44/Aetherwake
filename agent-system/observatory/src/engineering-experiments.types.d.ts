/** The caller attests that both Task IDs used this exact workload and protocol. */
export type EngineeringExperimentPair = {
  id: string;
  baselineTaskId: string;
  candidateTaskId: string;
  workloadDigest: string;
  difficulty: 'simple' | 'moderate' | 'complex';
};

type ExperimentArm = {
  taskId: string;
  state: string;
  verified: boolean;
  attempts: number;
  failedAttempts: number;
  firstAttemptVerified: boolean;
  observedTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  attemptWindowMs: number | null;
};

export type EngineeringExperiments = {
  schemaVersion: 1;
  pairs: (EngineeringExperimentPair & {
    taskClass: string | null;
    status: 'measured' | 'incomplete' | 'unmatched' | 'quality_regression';
    baseline: ExperimentArm | null;
    candidate: ExperimentArm | null;
    tokenReductionPercent: number | null;
    attemptWindowDeltaMs: number | null;
    costDeltaUsd: number | null;
  })[];
};
