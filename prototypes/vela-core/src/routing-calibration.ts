import type { ReasoningEffort } from '../../openai-provider/model-controls.ts';

export const VELA_CALIBRATION_MODES = ['off', 'observe', 'shadow', 'adaptive'] as const;
export type VelaCalibrationMode = typeof VELA_CALIBRATION_MODES[number];
export type VelaRoutingFeedback = 'useful' | 'needs-correction';
export interface VelaRoutingSample {
  requestId: string;
  projectId: string | null;
  model: string;
  effort: ReasoningEffort;
  depth: 'quick' | 'deep';
  evidence: 'observed' | 'simulated';
  completed: boolean;
  modelConfirmed: boolean;
  elapsedMs: number;
  firstOutputMs?: number;
  totalTokens?: number;
  feedback?: VelaRoutingFeedback;
}
export interface VelaCalibrationEstimate {
  model: string;
  attempts: number;
  completed: number;
  judgments: number;
  useful: number;
  p50Ms: number;
  p95Ms: number;
  p50FirstOutputMs?: number;
  medianReportedTokens: number;
}
export interface VelaCalibrationComparison {
  mode: 'shadow' | 'adaptive';
  baseline: VelaCalibrationEstimate;
  alternative: VelaCalibrationEstimate;
}

const percentile = (values: number[], fraction: number) =>
  values.sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];

function estimate(model: string, samples: VelaRoutingSample[]): VelaCalibrationEstimate | undefined {
  const attempts = samples.length;
  if (attempts < 12) return;
  const completed = samples.filter(sample => sample.completed && sample.modelConfirmed);
  const judgments = completed.filter(sample => sample.feedback);
  const useful = judgments.filter(sample => sample.feedback === 'useful').length;
  const tokens = completed.flatMap(sample => sample.totalTokens === undefined ? [] : [sample.totalTokens]);
  if (completed.length / attempts < 0.9 || judgments.length < 6 || useful / judgments.length < 0.8 || tokens.length < 6) return;
  const latency = completed.map(sample => sample.elapsedMs);
  const first = completed.flatMap(sample => sample.firstOutputMs === undefined ? [] : [sample.firstOutputMs]);
  return { model, attempts, completed: completed.length, judgments: judgments.length, useful,
    p50Ms: percentile([...latency], 0.5), p95Ms: percentile(latency, 0.95),
    ...(first.length >= 6 ? { p50FirstOutputMs: percentile(first, 0.5) } : {}), medianReportedTokens: percentile(tokens, 0.5) };
}

/** Compare only observed, same-scope turns at the same supported effort. */
export function compareVelaCalibration(input: {
  mode: 'shadow' | 'adaptive';
  projectId: string | null;
  depth: VelaRoutingSample['depth'];
  effort: ReasoningEffort;
  baseline: string;
  candidates: readonly string[];
  samples: readonly VelaRoutingSample[];
}): VelaCalibrationComparison | undefined {
  const samples = input.samples.filter(sample => sample.evidence === 'observed' && sample.projectId === input.projectId &&
    sample.depth === input.depth && sample.effort === input.effort);
  const forModel = (model: string) => estimate(model, samples.filter(sample => sample.model === model));
  const baseline = forModel(input.baseline);
  if (!baseline) return;
  const alternatives = input.candidates.filter(model => model !== baseline.model).flatMap(model => forModel(model) ?? []);
  const alternative = alternatives.filter(item => item.p95Ms <= baseline.p95Ms * 0.85 && baseline.p95Ms - item.p95Ms >= 100 &&
    item.p50Ms <= baseline.p50Ms && item.medianReportedTokens <= baseline.medianReportedTokens &&
    item.completed / item.attempts >= baseline.completed / baseline.attempts &&
    item.useful / item.judgments >= baseline.useful / baseline.judgments)
    .sort((a, b) => a.p95Ms - b.p95Ms || a.medianReportedTokens - b.medianReportedTokens || a.model.localeCompare(b.model))[0];
  return alternative && { mode: input.mode, baseline, alternative };
}
