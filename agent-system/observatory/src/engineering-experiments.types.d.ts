/** The caller attests that both Task IDs used this exact workload and protocol. */
type ArmProtocol = {
  provider: string;
  model: string;
  effort: string;
  environmentDigest: string;
  requirementsDigest: string;
  verificationDigest: string;
};

export type EngineeringExperimentPair = {
  id: string;
  baselineTaskId: string;
  candidateTaskId: string;
  workloadDigest: string;
  difficulty: 'simple' | 'moderate' | 'complex';
  protocol?: { baseline: ArmProtocol; candidate: ArmProtocol };
};

type ExperimentArm = {
  taskId: string;
  state: string;
  verified: boolean;
  attempts: number;
  failedAttempts: number;
  firstAttemptVerified: boolean;
  observedTokens: number | null;
  observedCachedInputTokens: number | null;
  observedUncachedInputTokens: number | null;
  observedOutputTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  attemptWindowMs: number | null;
  observedStageMs: Record<'checkoutProvisioningMs' | 'checkoutValidationMs' | 'modelTurnMs' | 'candidateVerificationMs', number | null>;
};

export type EngineeringExperiments = {
  schemaVersion: 1;
  pairs: (EngineeringExperimentPair & {
    taskClass: string | null;
    status: 'measured' | 'incomplete' | 'unmatched' | 'quality_regression';
    protocolCoverage: 'legacy_declared' | 'matched_declaration' | 'unmatched';
    baseline: ExperimentArm | null;
    candidate: ExperimentArm | null;
    tokenReductionPercent: number | null;
    attemptWindowDeltaMs: number | null;
    costDeltaUsd: number | null;
  })[];
};
