import { createHash } from 'node:crypto';
import { BLIND_INPUT_SHA256, readBlindInputs, type BlindCheckpoint } from './blind-runner.mts';
import { distribution, summarizeTokenUsage } from './report.mts';

/** Scores are supplied by the independent evaluator after predictions are frozen. */
export interface BlindCaseGrade {
  id: string;
  candidates?: { relevant: number; returned: number; hits: number };
  disclosure?: { invalid: number };
  contradiction?: boolean;
  answer?: boolean;
}

function summarizeSettlements(prediction: BlindCheckpoint) {
  const seen = new Set<string>();
  const groups = new Map<string, { transport: string; requestedModel: string; settledCalls: number; times: number[]; usage: unknown[] }>();
  let casesWithReceipts = 0;
  for (const { result } of prediction.results) {
    if (!result || typeof result !== 'object' || !Object.hasOwn(result, 'settlements')) continue;
    const { transport, requestedModel, calls, settlements } = result as Record<string, unknown>;
    if ((transport !== 'live' && transport !== 'synthetic') || typeof requestedModel !== 'string' || !requestedModel.trim() ||
      !Array.isArray(settlements) || calls !== settlements.length ||
      (prediction.route && (transport !== prediction.route.transport || requestedModel !== prediction.route.model))) {
      throw new Error('blind_settlement_binding');
    }
    const key = JSON.stringify([transport, requestedModel]);
    const group = groups.get(key) ?? { transport, requestedModel, settledCalls: 0, times: [], usage: [] };
    for (const receipt of settlements) {
      if (typeof receipt?.executionId !== 'string' || !receipt.executionId.trim() || seen.has(receipt.executionId)) {
        throw new Error('blind_settlement_execution');
      }
      seen.add(receipt.executionId);
      if (typeof receipt.elapsedMs === 'number' && Number.isFinite(receipt.elapsedMs) && receipt.elapsedMs >= 0) {
        group.times.push(receipt.elapsedMs);
      }
      group.usage.push(receipt.usage);
    }
    casesWithReceipts++;
    group.settledCalls += settlements.length;
    groups.set(key, group);
  }
  return { casesWithReceipts, groups: [...groups.values()].map(({ times, usage, ...group }) => ({
    ...group, latencyMs: distribution(times), usage: summarizeTokenUsage(usage),
  })) };
}

export function reportBlindQuality(input: Buffer, prediction: BlindCheckpoint, evaluation: {
  evaluator: string;
  predictionSha256: string;
  rubricSha256: string;
  grades: readonly BlindCaseGrade[];
}) {
  const hash = /^[a-f0-9]{64}$/;
  const { predictionSha256, ...payload } = prediction;
  if (!hash.test(predictionSha256) || predictionSha256 !== evaluation.predictionSha256 ||
    !hash.test(evaluation.rubricSha256) || !evaluation.evaluator.trim() ||
    payload.contract !== 'aerynth.cie-blind-predictions@1' || payload.inputSha256 !== BLIND_INPUT_SHA256 ||
    createHash('sha256').update(JSON.stringify(payload)).digest('hex') !== predictionSha256) throw new Error('blind_grade_binding');
  const expected = readBlindInputs(input);
  if (!Array.isArray(payload.results) || payload.results.length > expected.length ||
    payload.results.some((result, index) => result?.id !== expected[index].id ||
      !Number.isFinite(result.endToEndMs) || result.endToEndMs < 0) ||
    payload.complete !== (payload.results.length === expected.length && payload.stopped === null)) {
    throw new Error('blind_grade_cases');
  }
  const predicted = new Set(payload.results.map(result => result.id));
  const scored = new Set<string>();
  const candidates = { cases: 0, relevant: 0, returned: 0, hits: 0 };
  const disclosure = { cases: 0, invalid: 0, casesWithInvalid: 0 };
  const contradiction = { cases: 0, passed: 0 };
  const answer = { cases: 0, passed: 0 };
  const count = (value: number) => Number.isSafeInteger(value) && value >= 0;
  for (const grade of evaluation.grades) {
    if (!predicted.has(grade.id) || scored.has(grade.id)) throw new Error('blind_grade_cases');
    scored.add(grade.id);
    if (grade.candidates) {
      const { relevant, returned, hits } = grade.candidates;
      if (![relevant, returned, hits].every(count) || hits > Math.min(relevant, returned)) {
        throw new Error('blind_grade_candidate_counts');
      }
      candidates.cases++;
      candidates.relevant += relevant;
      candidates.returned += returned;
      candidates.hits += hits;
    }
    if (grade.disclosure) {
      if (!count(grade.disclosure.invalid)) throw new Error('blind_grade_disclosure_count');
      disclosure.cases++;
      disclosure.invalid += grade.disclosure.invalid;
      disclosure.casesWithInvalid += Number(grade.disclosure.invalid > 0);
    }
    for (const metric of ['contradiction', 'answer'] as const) {
      const verdict = grade[metric];
      if (verdict === undefined) continue;
      if (typeof verdict !== 'boolean') throw new Error('blind_grade_verdict');
      const totals = metric === 'answer' ? answer : contradiction;
      totals.cases++;
      totals.passed += Number(verdict);
    }
  }
  return {
    contract: 'aerynth.cie-blind-quality@1',
    evaluator: evaluation.evaluator, predictionSha256, rubricSha256: evaluation.rubricSha256,
    expectedCases: expected.length, predictedCases: predicted.size, casesWithGrades: scored.size,
    stopped: payload.stopped,
    endToEndMs: distribution(payload.results.map(result => result.endToEndMs)),
    providerObservations: summarizeSettlements(prediction),
    candidates: { ...candidates, recall: candidates.relevant ? candidates.hits / candidates.relevant : null,
      precision: candidates.returned ? candidates.hits / candidates.returned : null },
    disclosure, contradiction, answer,
  };
}
