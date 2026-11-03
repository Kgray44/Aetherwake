import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, openSync, readSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { VelaError, check, isRecord, text } from '../../vela-core/src/capabilities.ts';
import type { VelaFileEditItemView, VelaFileEditVerification, VelaFileEditView, VelaProjectCheckKind, VelaProjectCheckReceipt } from '../../vela-core/src/contracts.ts';
export type { VelaFileEditView } from '../../vela-core/src/contracts.ts';

const maxBytes = 8192;
export const maxEditFiles = 4;
export const maxEditTotalBytes = 10240;
const allowed = new Set(['.c', '.cpp', '.cs', '.css', '.cjs', '.go', '.h', '.html', '.java', '.js', '.json', '.md', '.mjs', '.mts', '.py', '.rs', '.ts', '.tsx', '.txt']);
const sha = (body: string | Buffer) => createHash('sha256').update(body).digest('hex');
const samePath = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const within = (root: string, child: string) => {
  const part = relative(root, child);
  return part !== '..' && !part.startsWith('..' + sep) && !isAbsolute(part);
};
const processOptions = { windowsHide: true, timeout: 5000, maxBuffer: 32768, encoding: 'utf8' as const, stdio: 'pipe' as const };
const reviewableText = (body: string) => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]|\p{Bidi_Control}/u.test(body);

export interface VelaFileEditTarget {
  path: string;
  root: string;
  relativePath: string;
  head: string;
  /** Null means the native picker selected an absent destination. */
  beforeDigest: string | null;
  identity: string;
}
export interface VelaFileEditItem {
  target: VelaFileEditTarget;
  afterDigest: string;
  backupPath?: string;
  stagedPath?: string;
  stagedIdentity?: string;
  state?: VelaFileEditItemView['state'];
  verification?: VelaFileEditVerification;
}
export interface VelaFileEditRecord {
  requestId: string;
  executionId: string;
  outputMessageId: string;
  scopeStamp: string;
  files: VelaFileEditItem[];
  state: VelaFileEditView['state'];
  legacySingleOutput?: true;
  followUpCheck?: VelaProjectCheckKind;
  /** Output from an authorized local script, retained for exact review. */
  artifactText?: string;
  projectChecks?: VelaProjectCheckReceipt[];
}
export interface VelaFileEditReview {
  requestId: string; reviewId: string; expiresAt: string;
  files: { path: string; before: string | null; after: string; beforeDigest: string | null; afterDigest: string }[];
}

/** Existing proposals and their recovery filenames retain their original format. */
export function upgradeVelaFileEdit(record: VelaFileEditRecord | (Omit<VelaFileEditRecord, 'files'> & Omit<VelaFileEditItem, 'state'>)): VelaFileEditRecord {
  if ('files' in record) return record;
  const { target, afterDigest, backupPath, stagedPath, verification, ...rest } = record;
  const state = rest.state === 'awaiting-review' || rest.state === 'applying' ? 'pending' : rest.state;
  check(state !== 'partial', 'vela_edit_invalid_legacy_record');
  return { ...rest, files: [{ target, afterDigest, backupPath, stagedPath, verification, state }], legacySingleOutput: true };
}

const fileKey = (stat: { dev: bigint; ino: bigint }) => stat.ino === 0n ? undefined : stat.dev + ':' + stat.ino;

function regularText(file: string, byteLimit = maxBytes): { body: string; digest: string; identity: string; fileKey?: string } {
  const path = realpathSync.native(file);
  check(samePath(path, file), 'vela_edit_indirect_path');
  const initial = lstatSync(file);
  check(initial.isFile() && !initial.isSymbolicLink() && initial.nlink === 1 && initial.size <= byteLimit, 'vela_edit_file_ineligible');
  const handle = openSync(file, constants.O_RDONLY);
  try {
    const stat = fstatSync(handle);
    const identity = (value: typeof stat) => [value.dev, value.ino, value.size, value.mtimeMs, value.ctimeMs].join(':');
    check(identity(initial) === identity(stat), 'vela_edit_file_changed');
    const bytes = Buffer.alloc(stat.size + 1);
    const n = readSync(handle, bytes, 0, bytes.length, 0);
    check(n === stat.size && identity(stat) === identity(fstatSync(handle)) && samePath(realpathSync.native(file), file), 'vela_edit_file_changed');
    const actual = bytes.subarray(0, n);
    const body = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(actual);
    check(reviewableText(body), 'vela_edit_file_ineligible');
    return { body, digest: sha(actual), identity: identity(stat), fileKey: fileKey(fstatSync(handle, { bigint: true })) };
  } finally { closeSync(handle); }
}

function git(cwd: string, args: string[], literal = true) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^git_/iu.test(key)));
  return execFileSync('git.exe', ['--no-optional-locks', ...(literal ? ['--literal-pathspecs'] : []), '-C', cwd, ...args], { ...processOptions, env });
}

function eligibleLocalPath(candidate: string, privateRoot?: string) {
  check(typeof candidate === 'string' && /^[CD]:[\\/]/iu.test(candidate) &&
    candidate.length <= 180 && !/[:<>"|?*\x00-\x1f]|\p{Bidi_Control}/u.test(candidate.slice(2)), 'vela_edit_path_ineligible');
  const path = resolve(candidate);
  check(!path.split(sep).some(segment => /[. ]$/u.test(segment) || /^(?:\.git|\.codex|\.ssh|appdata|windows|program files(?: \(x86\))?|programdata)$/iu.test(segment)) &&
    (!privateRoot || !within(privateRoot, path)), 'vela_edit_path_ineligible');
  check(!/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(basename(path)), 'vela_edit_path_ineligible');
  return path;
}

function eligibleFilePath(candidate: string, privateRoot?: string) {
  check(process.platform === 'win32', 'vela_codex_write_unavailable');
  const path = eligibleLocalPath(candidate, privateRoot);
  check(allowed.has(extname(path).toLowerCase()), 'vela_edit_file_ineligible');
  return path;
}

function directoryIdentity(folder: string) {
  check(samePath(realpathSync.native(folder), folder), 'vela_edit_indirect_path');
  const stat = lstatSync(folder, { bigint: true });
  const key = fileKey(stat);
  check(stat.isDirectory() && !stat.isSymbolicLink() && key, 'vela_edit_path_ineligible');
  return key;
}

export function readVelaInspectionTarget(candidate: string, privateRoot?: string) {
  try {
    check(process.platform === 'win32', 'vela_codex_inspection_target_unavailable');
    const root = eligibleLocalPath(candidate, privateRoot);
    check(!samePath(root, homedir()) && (!privateRoot || !within(root, privateRoot)), 'vela_codex_inspection_target_unavailable');
    const identity = directoryIdentity(root);
    const actualRoot = resolve(git(root, ['rev-parse', '--show-toplevel']).trim());
    const head = git(root, ['rev-parse', '--verify', 'HEAD']).trim();
    check(samePath(root, actualRoot) && /^[a-f0-9]{40,64}$/u.test(head), 'vela_codex_inspection_target_unavailable');
    return { root, head, identity };
  } catch {
    throw new VelaError('vela_codex_inspection_target_unavailable');
  }
}

function requireAbsent(path: string) {
  check(!lstatSync(path, { throwIfNoEntry: false }), 'vela_edit_destination_exists');
}

function requireUnignored(root: string, path: string) {
  try { git(root, ['check-ignore', '--quiet', '--no-index', '--', path], false); }
  catch (error) {
    if ((error as { status?: number }).status === 1) return;
    throw new VelaError('vela_edit_repository_unavailable');
  }
  throw new VelaError('vela_edit_destination_ignored');
}

export function readVelaFileEditTarget(candidate: string, privateRoot?: string, create = false, byteLimit = maxBytes): { target: VelaFileEditTarget; body: string | null } {
  try {
    const path = eligibleFilePath(candidate, privateRoot);
    const folder = dirname(path);
    const parent = create ? directoryIdentity(folder) : undefined;
    if (create) requireAbsent(path);
    else check(samePath(realpathSync.native(path), path), 'vela_edit_indirect_path');
    const root = realpathSync.native(resolve(git(folder, ['rev-parse', '--show-toplevel']).trim()));
    const relativePath = relative(root, path).split(sep).join('/');
    check(within(root, path) && relativePath && !relativePath.split('/').some(segment => segment.startsWith('.')), 'vela_edit_path_ineligible');
    if (create) {
      const insensitivePath = ':(icase,literal)' + relativePath;
      check(!git(root, ['ls-files', '--stage', '--', insensitivePath], false), 'vela_edit_destination_tracked');
      requireUnignored(root, relativePath);
    } else {
      const entry = git(root, ['ls-files', '--stage', '--', relativePath]);
      check(/^100(?:644|755) [a-f0-9]{40,64} 0\t[^\r\n]+\r?\n$/u.test(entry), 'vela_edit_file_ineligible');
    }
    const head = git(root, ['rev-parse', '--verify', 'HEAD']).trim();
    check(/^[a-f0-9]{40,64}$/u.test(head), 'vela_edit_repository_unavailable');
    if (create) {
      check(!git(root, ['diff', '--cached', '--name-only', '--diff-filter=D', '--no-ext-diff', head, '--',
        ':(icase,literal)' + relativePath], false), 'vela_edit_destination_tracked');
      check(parent && parent === directoryIdentity(folder), 'vela_edit_file_changed');
      requireAbsent(path);
      return { target: { path, root, relativePath, head, beforeDigest: null, identity: parent }, body: null };
    }
    const current = regularText(path, byteLimit);
    return { target: { path, root, relativePath, head, beforeDigest: current.digest, identity: current.identity }, body: current.body };
  } catch (error) {
    if (error instanceof VelaError) throw error;
    throw new VelaError('vela_edit_file_ineligible');
  }
}

export function readVelaFileEditTargets(existing: string[], created: string[], privateRoot?: string) {
  check(Array.isArray(existing) && Array.isArray(created) && existing.length + created.length > 0 &&
    existing.length + created.length <= maxEditFiles &&
    [...existing, ...created].every(candidate => typeof candidate === 'string'), 'vela_edit_file_limit');
  const files = [...existing.map(candidate => readVelaFileEditTarget(candidate, privateRoot)),
    ...created.map(candidate => readVelaFileEditTarget(candidate, privateRoot, true))];
  const first = files[0].target;
  check(files.every(({ target }) => samePath(target.root, first.root) && target.head === first.head) &&
    new Set(files.map(({ target }) => target.path.toLowerCase())).size === files.length, 'vela_edit_repository_mismatch');
  check(files.reduce((sum, file) => sum + Buffer.byteLength(file.body ?? ''), 0) <= maxEditTotalBytes, 'vela_edit_file_limit');
  return files;
}

export function validateVelaFileEditTarget(expected: VelaFileEditTarget, privateRoot?: string): string | null {
  const { target, body } = readVelaFileEditTarget(expected.path, privateRoot, expected.beforeDigest === null);
  check(samePath(target.root, expected.root) && target.head === expected.head && target.relativePath === expected.relativePath &&
    target.identity === expected.identity && target.beforeDigest === expected.beforeDigest, 'vela_edit_file_changed');
  return body;
}

export function validateVelaFileEditBytes(expected: VelaFileEditTarget): void {
  try {
    if (expected.beforeDigest === null) {
      check(directoryIdentity(dirname(expected.path)) === expected.identity, 'vela_edit_file_changed');
      requireAbsent(expected.path);
      return;
    }
    const actual = regularText(expected.path);
    check(actual.identity === expected.identity && actual.digest === expected.beforeDigest, 'vela_edit_file_changed');
  } catch { throw new VelaError('vela_edit_file_changed'); }
}

export function validateVelaFileEditHead(expected: VelaFileEditTarget): void {
  try {
    check(git(expected.root, ['rev-parse', '--verify', 'HEAD']).trim() === expected.head, 'vela_edit_file_changed');
  } catch { throw new VelaError('vela_edit_file_changed'); }
}

export function parseVelaFileEdit(output: string, targets: VelaFileEditTarget[], legacy = false) {
  check(Buffer.byteLength(output) <= 49152, 'vela_edit_invalid_proposal');
  let value: unknown;
  try { value = JSON.parse(output); } catch { throw new VelaError('vela_edit_invalid_proposal'); }
  check(isRecord(value) && text(value.summary, 500) &&
    Object.keys(value).sort().join(',') === (legacy ? 'replacement,summary' : 'files,summary'), 'vela_edit_invalid_proposal');
  const rows = legacy ? [{ path: targets[0]?.relativePath, replacement: value.replacement }] : value.files;
  check(Array.isArray(rows) && rows.length > 0 && rows.length <= targets.length, 'vela_edit_invalid_proposal');
  const seen = new Set<string>();
  let total = 0;
  const edits = rows.map(row => {
    check(isRecord(row) && Object.keys(row).sort().join(',') === 'path,replacement' && typeof row.path === 'string' &&
      typeof row.replacement === 'string' && row.replacement.length > 0 && reviewableText(row.replacement) &&
      Buffer.byteLength(row.replacement) <= maxBytes && Buffer.from(row.replacement).toString('utf8') === row.replacement,
    'vela_edit_invalid_proposal');
    const target = targets.find(file => file.relativePath === row.path);
    check(target && !seen.has(row.path), 'vela_edit_invalid_proposal');
    seen.add(row.path);
    total += Buffer.byteLength(row.replacement);
    const digest = sha(row.replacement);
    check(digest !== target.beforeDigest, 'vela_edit_no_change');
    return { target, replacement: row.replacement, digest };
  });
  check(total <= maxEditTotalBytes, 'vela_edit_file_limit');
  // Native picker order controls review and application, never provider ordering.
  return targets.flatMap(target => edits.filter(edit => edit.target === target));
}

function powershell(args: string[], env?: NodeJS.ProcessEnv) {
  const root = process.env.SystemRoot;
  check(root && isAbsolute(root), 'vela_codex_write_unavailable');
  return execFileSync(join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', ...args], { ...processOptions, timeout: 15000, ...(env ? { env } : {}) });
}

export function admitVelaFileEdit(path: string, privateRoot?: string) {
  try {
    const raw = powershell(['-File', join(homedir(), 'AppData', 'Local', 'AeroStorageWatch', 'ReserveGuard.ps1'),
      '-EstimatedCBytes', '67108864', '-EstimatedDBytes',
      [path, privateRoot].some(value => value && /^D:/iu.test(value)) ? '67108864' : '0']);
    check(JSON.parse(raw).allowed === true, 'storage_reserve_admission_denied');
  } catch { throw new VelaError('storage_reserve_admission_denied'); }
}

export function velaEditSiblings(target: VelaFileEditTarget, requestId: string, index?: number) {
  check(/^[a-f0-9-]{36}$/u.test(requestId), 'invalid_vela_edit_request');
  const stem = join(dirname(target.path), '.aerynth-edit-' + requestId + (index === undefined ? '' : '-' + (index + 1)));
  return { stagedPath: stem + '.tmp', backupPath: target.beforeDigest === null ? undefined : stem + '.backup' };
}

export function verifyVelaReplacement(path: string, body: string): VelaFileEditVerification {
  check(Buffer.byteLength(body) <= maxBytes && reviewableText(body), 'vela_edit_file_ineligible');
  const suffix = extname(path).toLowerCase();
  if (suffix === '.json') {
    try { JSON.parse(body.replace(/^\uFEFF/u, '')); } catch { throw new VelaError('vela_edit_invalid_json'); }
    return 'bytes-and-json-syntax';
  }
  if (suffix === '.mjs' || suffix === '.cjs') {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^node_options$/iu.test(key)));
    const result = spawnSync(process.execPath, ['--check', suffix === '.mjs' ? '--input-type=module' : '--input-type=commonjs'],
      { ...processOptions, input: body, env });
    check(result.status === 0, 'vela_edit_invalid_javascript');
    return 'bytes-and-javascript-syntax';
  }
  return 'bytes';
}

export function stageVelaFile(fileEdit: VelaFileEditItem, replacement: string) {
  const { target, stagedPath, backupPath } = fileEdit;
  check(stagedPath && !lstatSync(stagedPath, { throwIfNoEntry: false }) &&
    (target.beforeDigest === null || backupPath && !lstatSync(backupPath, { throwIfNoEntry: false })), 'vela_edit_recovery_files_exist');
  validateVelaFileEditBytes(target);
  const file = openSync(stagedPath, 'wx', 0o600);
  let key: string | undefined;
  try {
    writeFileSync(file, replacement, 'utf8');
    fsyncSync(file);
    key = fileKey(fstatSync(file, { bigint: true }));
  } finally { closeSync(file); }
  const staged = regularText(stagedPath);
  check(staged.digest === fileEdit.afterDigest && (target.beforeDigest !== null || key && staged.fileKey === key),
    'vela_edit_stage_verification_failed');
  return key;
}

export function publishVelaFile(fileEdit: VelaFileEditItem) {
  const { target, stagedPath, backupPath } = fileEdit;
  check(stagedPath, 'vela_edit_stage_verification_failed');
  const staged = regularText(stagedPath);
  check(staged.digest === fileEdit.afterDigest, 'vela_edit_stage_verification_failed');
  validateVelaFileEditBytes(target);
  if (target.beforeDigest === null) {
    check(fileEdit.stagedIdentity && staged.fileKey === fileEdit.stagedIdentity, 'vela_edit_stage_verification_failed');
    const command = [
      "$ErrorActionPreference='Stop'",
      "$stage=[IO.File]::Open($env:AERYNTH_EDIT_STAGE,'Open','Read','Read, Delete')",
      "$sha=[Security.Cryptography.SHA256]::Create()",
      "try { if ($stage.Length -gt 8192) { throw 'stale_edit' }; " +
        "$digest=[BitConverter]::ToString($sha.ComputeHash($stage)).Replace('-',''); " +
        "if ($digest -ne $env:AERYNTH_EDIT_AFTER) { throw 'stale_edit' }; " +
        "[IO.File]::Move($env:AERYNTH_EDIT_STAGE,$env:AERYNTH_EDIT_TARGET) } " +
        "finally { $sha.Dispose(); $stage.Dispose() }",
    ].join('; ');
    powershell(['-Command', command], { ...process.env, AERYNTH_EDIT_STAGE: stagedPath,
      AERYNTH_EDIT_TARGET: target.path, AERYNTH_EDIT_AFTER: fileEdit.afterDigest });
    return;
  }
  check(backupPath && !lstatSync(backupPath, { throwIfNoEntry: false }), 'vela_edit_recovery_files_exist');
  const command = [
    "$ErrorActionPreference='Stop'",
    "$old=[IO.File]::Open($env:AERYNTH_EDIT_TARGET,'Open','Read','Read, Delete')",
    "$sha=[Security.Cryptography.SHA256]::Create()",
    "try { if ($old.Length -gt 8192 -or [IO.File]::Exists($env:AERYNTH_EDIT_BACKUP)) { throw 'stale_edit' }; " +
      "$digest=[BitConverter]::ToString($sha.ComputeHash($old)).Replace('-',''); " +
      "if ($digest -ne $env:AERYNTH_EDIT_BEFORE) { throw 'stale_edit' }; " +
      "[IO.File]::Replace($env:AERYNTH_EDIT_STAGE,$env:AERYNTH_EDIT_TARGET,$env:AERYNTH_EDIT_BACKUP,$false) } " +
      "finally { $sha.Dispose(); $old.Dispose() }",
  ].join('; ');
  powershell(['-Command', command], { ...process.env, AERYNTH_EDIT_STAGE: stagedPath, AERYNTH_EDIT_TARGET: target.path,
    AERYNTH_EDIT_BACKUP: backupPath, AERYNTH_EDIT_BEFORE: target.beforeDigest });
}

/** Match the published bytes and either the captured original or the staged
 * file identity. Another writer may have supplied identical bytes. */
export function observeVelaFileEdit(file: VelaFileEditItem, privateRoot?: string): Pick<VelaFileEditItemView, 'state' | 'verification'> {
  try {
    const path = eligibleFilePath(file.target.path, privateRoot);
    const root = realpathSync.native(file.target.root);
    check(samePath(root, file.target.root) && within(root, path) &&
      relative(root, path).split(sep).join('/') === file.target.relativePath, 'vela_edit_file_changed');
    if (file.target.beforeDigest === null) {
      check(directoryIdentity(dirname(path)) === file.target.identity, 'vela_edit_file_changed');
      if (!lstatSync(path, { throwIfNoEntry: false })) return { state: 'unchanged' };
      const current = regularText(path);
      if (current.digest === file.afterDigest && file.stagedIdentity && current.fileKey === file.stagedIdentity)
        return { state: 'applied', verification: verifyVelaReplacement(path, current.body) };
      return { state: 'conflict' };
    }
    const current = regularText(path);
    const original = file.backupPath && existsSync(file.backupPath) ? regularText(file.backupPath) : undefined;
    if (current.digest === file.afterDigest && original?.digest === file.target.beforeDigest)
      return { state: 'applied', verification: verifyVelaReplacement(file.target.path, current.body) };
    if (current.digest === file.target.beforeDigest && current.identity === file.target.identity && !original)
      return { state: 'unchanged' };
    return { state: current.digest === file.afterDigest && !original ? 'unknown' : 'conflict' };
  } catch { return { state: 'unknown' }; }
}
