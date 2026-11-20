type TokenBucket =
  | 'inputTokens' | 'outputTokens' | 'totalTokens'
  | 'cachedInputTokens' | 'uncachedInputTokens'
  | 'reasoningOutputTokens' | 'cacheWriteInputTokens';

/** Null indicates a missing or unrepresentable total. Samples count source turns. */
export type ObservedEngineeringTokens = Record<TokenBucket, number | null> & {
  turns: number;
  samples: Record<TokenBucket, number>;
};

type ModelLabels = { provider: string | null; model: string | null };
type Measurement = { observed: ObservedEngineeringTokens };

export type EngineeringTokenAccounting = Measurement & {
  schemaVersion: 1;
  unattributedTurns: number;
  byAttempt: (Measurement & ModelLabels & {
    taskId: string;
    attemptId: string;
    revision: string;
    attemptNumber: number | null;
    state: string;
    coverage: 'complete' | 'partial' | 'unavailable';
  })[];
  byTask: (Measurement & {
    taskId: string;
    taskClass: string | null;
    attempts: number;
    completeAttempts: number;
    verified: boolean;
  })[];
  byModel: (Measurement & ModelLabels & { attempts: number })[];
  byClass: (Measurement & {
    taskClass: string | null;
    tasks: number;
    attempts: number;
    completeAttempts: number;
    verifiedTasks: number;
    missingAttemptTasks: number;
    tokensPerVerifiedTask: number | null;
    verifiedTasksPerMillionTokens: number | null;
  })[];
  daily: (Measurement & { date: string })[];
};
