import { readFileSync, writeFileSync } from 'node:fs';

const [input, output] = process.argv.slice(2);
const pages = JSON.parse(readFileSync(input, 'utf8'));
const duration = (start, end) => start && end ? (Date.parse(end) - Date.parse(start)) / 1000 : null;
const jobs = pages.flatMap(page => page.jobs)
  .filter(job => job.name !== 'Aerynth required checks')
  .map(job => ({
    name: job.name, conclusion: job.conclusion, attempt: job.run_attempt,
    queuedAt: job.created_at, startedAt: job.started_at, completedAt: job.completed_at,
    queueSeconds: duration(job.created_at, job.started_at),
    runSeconds: duration(job.started_at, job.completed_at),
    steps: job.steps.map(step => ({
      name: step.name, conclusion: step.conclusion, runSeconds: duration(step.started_at, step.completed_at),
    })),
  }));
const completed = jobs.filter(job => job.completedAt && job.startedAt);
if (!completed.length) throw new Error('No completed verification jobs in workflow timing response');
const firstStart = completed.map(job => job.startedAt).sort()[0];
const lastFinish = completed.reduce((last, job) => job.completedAt > last.completedAt ? job : last);
const parallelWallSeconds = duration(firstStart, lastFinish.completedAt);
const report = { schema: 'aerynth.ci-timings@1', revision: process.env.GITHUB_SHA,
  runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT), parallelWallSeconds, lastFinishingJob: lastFinish.name, jobs };
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(`Verification jobs spanned ${parallelWallSeconds}s from first start to final completion. Last to finish was ${lastFinish.name}.`);
