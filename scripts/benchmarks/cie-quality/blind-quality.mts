import { createHash } from 'node:crypto';
import { BLIND_INPUT_SHA256, readBlindInputs, type BlindCheckpoint } from './blind-runner.mts';

/** Scores are supplied by the independent evaluator after predictions are frozen. */
export interface BlindCaseGrade {
  id: string;
  candidates?: { relevant: number; returned: number; hits: number };
  disclosure?: { invalid: number };
  contradiction?: boolean;
  answer?: boolean;
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
    payload.results.some((result, index) => result?.id !== expected[index].id) ||
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
    candidates: { ...candidates, recall: candidates.relevant ? candidates.hits / candidates.relevant : null,
      precision: candidates.returned ? candidates.hits / candidates.returned : null },
    disclosure, contradiction, answer,
  };
}
