export const DIAGNOSTIC = Object.freeze({
  key: 'observatory',
  name: 'Engineering Observatory diagnostic',
  id: 419657988,
  file: 'engineering-observatory.yml',
  path: '.github/workflows/engineering-observatory.yml',
  ref: 'main',
});

export const isFailedConclusion = value => ['failure', 'timed_out', 'startup_failure'].includes(value);
export const isCancellableRun = value => ['queued', 'in_progress', 'pending', 'requested'].includes(value);
export const diagnosticRunName = id => 'Observatory diagnostic ' + id;
