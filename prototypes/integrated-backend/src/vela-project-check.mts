import { createHash } from 'node:crypto';
import { closeSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { check } from '../../vela-core/src/capabilities.ts';
import type { VelaProjectCheckKind, VelaProjectCheckReceipt } from '../../vela-core/src/contracts.ts';
import { observeVelaFileEdit, readVelaFileEditTarget, validateVelaFileEditHead, type VelaFileEditRecord } from './vela-file-edit.mts';

export interface VelaProjectCheckReview<RequestId extends string | null = string> {
  requestId: RequestId;
  reviewId: string;
  expiresAt: string;
  kind: VelaProjectCheckKind;
  cwd: string;
  argv: string[];
  inputs: string[];
  artifactPath?: string;
}

const maxSourceBytes = 256 * 1024;
const samePath = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function compilerAt(config: string, root: string) {
  for (let directory = dirname(config); ; directory = dirname(directory)) {
    const file = join(directory, 'node_modules', 'typescript', 'lib', 'tsc.js');
    const stat = lstatSync(file, { throwIfNoEntry: false });
    if (stat) {
      check(stat.isFile() && stat.nlink === 1 && samePath(realpathSync.native(file), file) &&
        stat.size > 0 && stat.size <= maxSourceBytes, 'vela_typescript_compiler_unavailable');
      const fd = openSync(file, 'r');
      try {
        const bytes = Buffer.alloc(stat.size + 1);
        check(readSync(fd, bytes) === stat.size, 'vela_typescript_compiler_unavailable');
        return { file, digest: createHash('sha256').update(bytes.subarray(0, stat.size)).digest('hex') };
      } finally { closeSync(fd); }
    }
    if (samePath(directory, root)) break;
  }
  check(false, 'vela_typescript_compiler_unavailable');
}

export function planVelaProjectCheck(record: VelaFileEditRecord | undefined, kind: VelaProjectCheckKind, paths: string[], privateRoot?: string, artifactPath?: string) {
  const inputPattern = {
    'node-test': /(?:\.test|\.spec)\.(?:mjs|cjs|js|mts|ts)$/iu,
    typescript: /^tsconfig(?:\.[a-z0-9_-]+)*\.json$/iu,
    'node-benchmark': /\.bench\.(?:mjs|cjs|js)$/iu,
    'node-build': /\.build\.(?:mjs|cjs|js)$/iu,
  }[kind];
  check(inputPattern instanceof RegExp, 'vela_project_check_invalid');
  check(kind === 'node-build' ? !record && typeof artifactPath === 'string' && artifactPath.length > 0 : artifactPath === undefined, 'vela_build_destination_required');
  check(Array.isArray(paths) && paths.length >= 1 && paths.length <= (kind === 'node-test' ? 4 : 1) &&
    paths.every(path => typeof path === 'string'), 'vela_project_check_invalid');
  if (record) {
    check(record.state === 'applied', 'vela_project_check_requires_applied_edit');
    validateVelaFileEditHead(record.files[0].target);
    check(record.files.every(file => observeVelaFileEdit(file, privateRoot).state === 'applied'), 'vela_project_check_stale');
  }
  const targets = paths.map(path => {
    check(inputPattern.test(basename(path)), 'vela_project_check_invalid_input');
    return readVelaFileEditTarget(path, privateRoot, false, maxSourceBytes).target;
  });
  const { root, head } = record?.files[0].target ?? targets[0];
  check(targets.every(target => samePath(target.root, root) && target.head === head), 'vela_project_check_repository_mismatch');
  const artifactTarget = artifactPath ? readVelaFileEditTarget(artifactPath, privateRoot, true).target : undefined;
  if (artifactTarget) check(samePath(artifactTarget.root, root) && artifactTarget.head === head, 'vela_project_check_repository_mismatch');
  check(new Set(targets.map(target => target.path.toLowerCase())).size === targets.length, 'vela_project_check_invalid_input');
  const inputs = targets.map(target => target.relativePath);
  const compiler = kind === 'typescript' ? compilerAt(targets[0].path, root) : undefined;
  const argv = compiler
    ? [process.execPath, './' + relative(root, compiler.file).split(sep).join('/'), '--noEmit', '--incremental', 'false', '--pretty', 'false', '--project', './' + inputs[0]]
    : kind === 'node-benchmark' || kind === 'node-build' ? [process.execPath, '--', './' + inputs[0]]
      : [process.execPath, '--test', '--test-isolation=none', '--test-reporter=tap', '--', ...inputs.map(path => './' + path)];
  return { cwd: root, head, targets, compiler, argv, inputs, artifactTarget };
}

export function interpretVelaProjectCheck(kind: VelaProjectCheckKind, result: { exitCode: number; stdout: string; stderr: string }):
  Pick<VelaProjectCheckReceipt, 'state' | 'exitCode' | 'testCount' | 'benchmark'> & { artifactText?: string } {
  const { exitCode, stdout, stderr } = result;
  if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 65536) return { state: 'limited' };
  if (kind === 'typescript') return { state: exitCode === 0 ? 'passed' : 'failed', exitCode };
  if (kind === 'node-build') {
    if (exitCode !== 0) return { state: 'failed', exitCode };
    if (!stdout.length) return { state: 'unknown', exitCode };
    return Buffer.byteLength(stdout) > 8192 ? { state: 'limited', exitCode } : { state: 'passed', exitCode, artifactText: stdout };
  }
  if (kind === 'node-benchmark') {
    if (exitCode !== 0) return { state: 'failed', exitCode };
    let report: unknown;
    try { report = JSON.parse(stdout.trim()); } catch { return { state: 'unknown', exitCode }; }
    if (!report || typeof report !== 'object' || Object.keys(report).length !== 3) return { state: 'unknown', exitCode };
    const { samples, medianMs, p95Ms } = report as NonNullable<VelaProjectCheckReceipt['benchmark']>;
    if (!Number.isSafeInteger(samples) || samples < 1 || samples > 1_000_000 ||
      !Number.isFinite(medianMs) || medianMs < 0 || !Number.isFinite(p95Ms) || p95Ms < medianMs || p95Ms > 20_000)
      return { state: 'unknown', exitCode };
    return { state: 'passed', exitCode, benchmark: { samples, medianMs, p95Ms } };
  }
  const footer = /(?:^|\r?\n)# tests ([0-9]+)\r?\n# suites [0-9]+\r?\n# pass ([0-9]+)\r?\n# fail [0-9]+\r?\n# cancelled [0-9]+\r?\n# skipped [0-9]+\r?\n# todo [0-9]+\r?\n# duration_ms [\d.]+$/u.exec(stdout.trimEnd());
  const total = footer ? Number(footer[1]) : NaN, passed = footer ? Number(footer[2]) : NaN;
  const testCount = Number.isSafeInteger(total) && Number.isSafeInteger(passed) && passed <= total ? total : undefined;
  const state = exitCode !== 0 ? 'failed' : testCount !== undefined && passed > 0 ? 'passed' : 'unknown';
  return { state, exitCode, ...(testCount === undefined ? {} : { testCount }) };
}
