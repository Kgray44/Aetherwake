import { execFile } from 'node:child_process';
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

const runFile = promisify(execFile);
const sha = /^[a-f0-9]{40}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const remote = 'https://github.com/Kgray44/Aetherwake.git';
const approvedBranch = task => 'codex/aads-task-' + task.id.slice(5);
export const availableTransferCredential = token =>
  typeof token === 'string' && /^(github_pat_|ghs_)[A-Za-z0-9_]{20,}$/.test(token);

function environment(token) {
  const allowed = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'SYSTEMDRIVE', 'TMP', 'TEMP', 'TMPDIR', 'LANG']);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase())));
  const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: nullDevice, GIT_TERMINAL_PROMPT: '0',
    GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraHeader',
    GIT_CONFIG_VALUE_0: 'Authorization: Basic ' + Buffer.from('x-access-token:' + token).toString('base64') };
}

async function optionalFile(path, max, filesystem) {
  try {
    const info = await filesystem.lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > max) throw Error('Untrusted Git metadata');
    return await filesystem.readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function transferReviewedCandidate({ job, workspace, scratchRoot, token, gitBin, authorize, signal,
  run = runFile, filesystem = { lstat, mkdtemp, readFile, realpath, rm, writeFile } }) {
  const { task, integration_id: id } = job;
  if (!uuid.test(id) || !task?.id?.startsWith('task_') || !uuid.test(task.id.slice(5)) ||
      !sha.test(task.head_sha) || !sha.test(task.parent_sha) || task.branch !== approvedBranch(task) ||
      !uuid.test(job.ref_id ?? id) || job.branch !== 'aads/integration/' + (job.ref_id ?? id) || !availableTransferCredential(token) ||
      typeof gitBin !== 'string' || !isAbsolute(gitBin)) return { status: 'failed' };

  const env = environment(token);
  const readEnv = { ...env, GIT_CONFIG_COUNT: '0', GIT_CONFIG_VALUE_0: '' };
  const git = async (cwd, args, options = {}) => (await run(gitBin, [
    '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'protocol.allow=never',
    '-c', 'protocol.https.allow=always', '-c', 'http.followRedirects=false', '-C', cwd, ...args,
  ], { env: readEnv, windowsHide: true, timeout: 20_000, maxBuffer: 16 * 1024, signal, ...options })).stdout.trim();
  let scratch;
  let sending = false;
  try {
    const root = await filesystem.realpath(workspace);
    const gitDir = join(root, '.git');
    const objectDir = join(gitDir, 'objects');
    if (root !== workspace || await filesystem.realpath(gitDir) !== gitDir ||
        await filesystem.realpath(objectDir) !== objectDir || objectDir.includes(delimiter) ||
        await optionalFile(join(objectDir, 'info', 'alternates'), 4096, filesystem) !== null) return { status: 'failed' };
    const [configured, identity, dirty] = await Promise.all([
      git(root, ['config', '--local', '--get-all', 'remote.origin.url']),
      git(root, ['rev-parse', '--show-toplevel', '--absolute-git-dir', 'HEAD']),
      git(root, ['status', '--porcelain', '--untracked-files=normal', '--ignore-submodules=none']),
    ]);
    const [top, actualGit, currentHead] = identity.split(/\r?\n/);
    if (dirty || currentHead !== task.head_sha ||
        !/^https:\/\/github\.com\/Kgray44\/Aetherwake(?:\.git)?$/i.test(configured) ||
        await filesystem.realpath(top) !== root || await filesystem.realpath(actualGit) !== gitDir ||
        await git(root, ['symbolic-ref', '--short', 'HEAD']) !== task.branch) return { status: 'failed' };

    const shallow = await optionalFile(join(gitDir, 'shallow'), 4096, filesystem);
    const shallowBase = shallow?.trim();
    if (shallow !== null && !sha.test(shallowBase)) return { status: 'failed' };
    scratch = await filesystem.mkdtemp(join(scratchRoot, '.aads-transfer-'));
    await git(scratch, ['init', '--bare', '--template=']);
    if (shallowBase) await filesystem.writeFile(join(scratch, 'shallow'), shallowBase + '\n', { flag: 'wx' });
    const objectEnv = { ...readEnv, GIT_ALTERNATE_OBJECT_DIRECTORIES: objectDir };
    const identityLine = await git(scratch, ['show', '--no-patch', '--format=%H %P %T', task.head_sha], { env: objectEnv });
    const [head, parent, tree, extra] = identityLine.split(' ');
    if (head !== task.head_sha || parent !== task.parent_sha || !sha.test(tree) || extra) return { status: 'failed' };
    if (await git(scratch, ['cat-file', '-t', tree], { env: objectEnv }) !== 'tree') return { status: 'failed' };
    if (shallowBase) await git(scratch, ['merge-base', '--is-ancestor', shallowBase, head], { env: objectEnv });
    if (!await authorize(tree, shallowBase) || signal?.aborted) return { status: 'failed' };

    const ref = 'refs/heads/' + job.branch;
    const pushEnv = { ...env, GIT_ALTERNATE_OBJECT_DIRECTORIES: objectDir };
    sending = true;
    await git(scratch, ['push', '--porcelain', '--no-verify', remote, head + ':' + ref],
      { env: pushEnv, timeout: 60_000 });
    return { status: 'submitted', tree_sha: tree };
  } catch {
    return { status: sending ? 'unknown' : 'failed' };
  } finally {
    if (scratch && dirname(scratch) === scratchRoot) {
      await filesystem.rm(scratch, { recursive: true, force: true }).catch(() => {});
    }
  }
}
