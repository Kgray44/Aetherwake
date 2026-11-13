// Test-only retention for fixed synthetic objectives. Never export a profile or ledger.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const names = ['illustration.png', 'illustration-notes.txt', 'report.txt'] as const;
export const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
export function preflightArtifactEvidence(destination: string) {
  assert.ok(isAbsolute(destination), 'Evidence destination must be absolute');
  let occupied = existsSync(destination);
  try { lstatSync(destination); occupied = true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  assert.ok(!occupied, 'Evidence destination must be new');
  const parent = realpathSync.native(dirname(destination));
  const target = join(parent, destination.split(/[\\/]/).at(-1)!);
  const part = relative(realpathSync.native(repository), target);
  assert.ok(part.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) || isAbsolute(part),
    'Evidence must remain outside the public checkout');
  assert.equal(resolve(destination), target, 'Evidence destination must use a canonical parent');
}
export function retainArtifactEvidence(destination: string, input: {
  provider: 'simulated' | 'real-openai-api'; objective: string; missionId: string; reportId: string;
  png: Buffer; notes: Buffer; report: string; verifiedInferenceRequests?: number;
}) {
  preflightArtifactEvidence(destination);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
  // Hash all tracked changes and new helper source separately. Do not retain the patch or paths.
  const source = { commit: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'),
    dirty: git('status', '--porcelain').length > 0,
    trackedDiffSha256: digest(git('diff', 'HEAD', '--binary')),
    harnessSha256: digest(readFileSync(fileURLToPath(import.meta.url))) };
  const bytes = [input.png, input.notes, Buffer.from(input.report)];
  assert.ok(bytes.every(value => value.length > 0 && value.length <= 32 * 1024 * 1024));
  mkdirSync(destination, { mode: 0o700 });
  for (let i = 0; i < names.length; i++) writeFileSync(join(destination, names[i]), bytes[i], { flag: 'wx', mode: 0o600 });
  const manifest = {
    schema: 'aerynth.fi-acc-16-evidence@1', recordedAt: new Date().toISOString(), source,
    environment: { platform: process.platform, arch: process.arch, node: process.version },
    evidence: { provider: input.provider, objectiveClass: 'fixed-synthetic', execution: 'source-mode',
      dialog: 'simulated-ports', packagedUI: 'not-tested', independentQuality: 'pending', ownerAcceptance: 'pending',
      revocation: 'not-tested', originalChatUI: 'not-tested' },
    objective: input.objective, missionId: input.missionId, reportId: input.reportId,
    checks: { workspaceResourceReadback: true, reportRestored: true, duplicateStartSameMission: true,
      ...(input.verifiedInferenceRequests === undefined ? { oneInferenceUsage: true } :
        { verifiedInferenceRequests: input.verifiedInferenceRequests }),
      mutatedTextBlocksMission: true, sameReportMarkedStale: true },
    files: names.map((name, i) => ({ name, bytes: bytes[i].length, sha256: digest(bytes[i]) })),
  };
  writeFileSync(join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  verifyArtifactEvidence(destination);
  return manifest;
}
export function verifyArtifactEvidence(directory: string) {
  assert.ok(lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink());
  assert.deepEqual(readdirSync(directory).sort(), [...names, 'manifest.json'].sort());
  assert.ok(lstatSync(join(directory, 'manifest.json')).isFile() && !lstatSync(join(directory, 'manifest.json')).isSymbolicLink());
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.schema, 'aerynth.fi-acc-16-evidence@1');
  assert.deepEqual(manifest.files.map((file: { name: string }) => file.name), names);
  for (const file of manifest.files) {
    const path = join(directory, file.name);
    assert.ok(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink());
    const bytes = readFileSync(path);
    assert.equal(bytes.length, file.bytes);
    assert.equal(digest(bytes), file.sha256);
  }
  return manifest;
}
