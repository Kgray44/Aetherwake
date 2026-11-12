import { execFileSync, spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { writeFileSync } from 'node:fs';

const lockfiles = execFileSync('git', ['ls-files', '-z', '--', ':(glob)**/package-lock.json', 'package-lock.json'],
  { encoding: 'utf8' }).split('\0').filter(Boolean);
if (!lockfiles.length) throw new Error('No tracked npm lockfiles to audit');

async function audit(lockfile) {
  // This gate runs on Ubuntu. Each audit uses the committed lockfile and does
  // not install dependencies or run lifecycle hooks.
  const child = spawn('npm', ['audit', '--json', '--audit-level=high'], {
    cwd: dirname(lockfile), stdio: ['ignore', 'pipe', 'ignore'],
  });
  const exited = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  try {
    const chunks = [];
    for await (const chunk of child.stdout) chunks.push(chunk);
    const exitCode = await exited;
    const data = JSON.parse(Buffer.concat(chunks));
    const counts = data.metadata?.vulnerabilities;
    if (!counts || data.error || ![counts.high, counts.critical].every(Number.isInteger)) {
      return { lockfile, status: 'audit-unavailable', exitCode };
    }
    const blocking = Object.values(data.vulnerabilities).filter(vulnerability =>
      ['high', 'critical'].includes(vulnerability.severity)).map(({ name, severity, range }) => ({ name, severity, range }));
    const status = exitCode === 0 && !counts.high && !counts.critical ? 'passed' : 'failed';
    return { lockfile, status, exitCode, counts, blocking };
  } catch {
    return { lockfile, status: 'audit-unavailable' };
  }
}

const reports = await Promise.all(lockfiles.map(audit));
const report = { schema: 'aerynth.dependency-audit@1', revision: process.env.GITHUB_SHA ?? null, lockfiles: reports };
const output = JSON.stringify(report, null, 2);
writeFileSync(process.argv[2], output + '\n');
console.log(output);
if (reports.some(result => result.status !== 'passed')) process.exitCode = 1;
