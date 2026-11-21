// Map Task Engine diagnostics into the existing v1 attempt record categories.
export const executionFailureCategories = Object.freeze({
  worker:'environment',
  provider:'environment',
  lease:'environment',
  time_limit:'environment',
  storage:'environment',
  checkout:'environment',
  git:'integration',
  verification:'unknown',
  implementation:'implementation',
});
