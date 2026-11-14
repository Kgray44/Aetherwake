/**
 * Exact, local CIE lookup for a declared operational cohort.
 * The source owner resolves authorization, evidence revision and effective policy.
 * This projection is intentionally separate from provider context assembly.
 */
export function retrieveExperientialContext<Scope, Finding>(
  request: { scope: Scope; experimentId: string; cohort: string },
  source: {
    cohort: string;
    resolve(scope: Scope, experimentId: string, cohort: string): Finding | null;
  },
): Finding | null {
  if (request.cohort !== source.cohort) return null;
  return source.resolve(request.scope, request.experimentId, request.cohort);
}
