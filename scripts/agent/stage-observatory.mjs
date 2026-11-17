#!/usr/bin/env node
/** Stage sanitized snapshots while an explicitly selected Task journal is active. */
import { createHash, randomUUID } from 'node:crypto';
import { watch } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { MAX_SYNC_BYTES } from '../../agent-system/observatory/sites/sync.mjs';
import { projectJournal, readTask } from './export-journal.mjs';
import { withJournalLock } from './journal.mjs';

function contentsDigest(snapshot) {
  const { generated_at, ...contents } = snapshot;
  return createHash('sha256').update(JSON.stringify(contents)).digest('hex');
}

export function stageSnapshot(options) {
  return withJournalLock(options.stagingDirectory, () => writeSnapshot(options));
}

async function writeSnapshot({ taskFile, journal, stagingDirectory }) {
  const staged = join(stagingDirectory, 'observatory-projection.json');
  const task = await readTask(taskFile);
  const serialized = await projectJournal({ task, directory: journal });
  const snapshot = JSON.parse(serialized);
  await mkdir(stagingDirectory, { recursive: true, mode: 0o700 });
  const directory = await lstat(stagingDirectory);
  if (!directory.isDirectory() || directory.isSymbolicLink() ||
      (process.platform !== 'win32' && (directory.mode & 0o077))) throw Error('Use a private staging directory');
  try {
    const previous = await open(staged, 'r');
    try {
      const stat = await previous.stat();
      if (!stat.isFile() || stat.size > MAX_SYNC_BYTES) throw Error('Invalid staged projection file');
      const old = JSON.parse(await previous.readFile('utf8'));
      if (old.repository !== task.repository ||
          old.records?.find(record => record.record_type === 'task')?.id !== snapshot.records.find(record => record.record_type === 'task')?.id) {
        throw Error('Use a separate staging directory for each task');
      }
      if (contentsDigest(old) === contentsDigest(snapshot)) return { changed: false, generated_at: old.generated_at };
    } finally { await previous.close(); }
  } catch (cause) { if (cause.code !== 'ENOENT') throw cause; }

  const temporary = join(stagingDirectory, '.projection-' + randomUUID());
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try { await handle.writeFile(serialized); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, staged);
  } finally { await unlink(temporary).catch(cause => { if (cause.code !== 'ENOENT') throw cause; }); }
  return { changed: true, generated_at: snapshot.generated_at, records: snapshot.records.length, events: snapshot.events.length };
}

async function identity(path) {
  try {
    const stat = await lstat(path, { bigint: true });
    return [stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
  } catch (cause) { if (cause.code === 'ENOENT') return 'missing'; throw cause; }
}

/** Watch only journal commits and the selected Task file. Poll metadata to recover missed notifications. */
export async function watchSnapshots(options, onStatus, signal) {
  const { taskFile, journal } = options;
  const records = join(journal, 'records');
  let dirty = true;
  let lastIdentity = '';
  let lastPoll = 0;
  let failures = 0;
  const watchers = new Map();
  const paths = [journal, records, dirname(taskFile)];
  function bind(path) {
    if (watchers.has(path)) return;
    try {
      const watcher = watch(path, (_event, file) => {
        if (!file || (path === dirname(taskFile) ? file === basename(taskFile) : /^(?:[a-f0-9]{64}\.json|records)$/.test(file))) dirty = true;
      });
      watchers.set(path, watcher);
      watcher.on('error', () => { watcher.close(); watchers.delete(path); dirty = true; });
    } catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
  }
  try {
    while (!signal.aborted) {
      if (Date.now() - lastPoll >= 5000) {
        lastPoll = Date.now();
        const current = (await Promise.all([taskFile, journal, records].map(identity))).join('|');
        if (current !== lastIdentity) dirty = true;
        lastIdentity = current;
        for (const path of paths) bind(path);
      }
      if (dirty) {
        dirty = false;
        try {
          const result = await stageSnapshot(options);
          if (result.changed || failures) onStatus({ state: 'ready_for_authenticated_import', ...result });
          failures = 0;
        } catch (cause) {
          onStatus({ state: 'stage_failed', code: cause.code ?? 'invalid_or_unavailable_journal' });
          if (++failures <= 3) {
            await sleep(1000 * failures, undefined, { signal });
            dirty = true;
          }
        }
      }
      await sleep(1000, undefined, { signal });
    }
  } catch (cause) { if (!signal.aborted || cause.name !== 'AbortError') throw cause; }
  finally { for (const watcher of watchers.values()) watcher.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [taskFile, journal, stagingDirectory, mode, ...extra] = process.argv.slice(2);
  const controller = new AbortController();
  process.on('SIGINT', () => controller.abort());
  process.on('SIGTERM', () => controller.abort());
  const report = value => process.stdout.write(JSON.stringify(value) + '\n');
  try {
    if (!taskFile || !journal || !stagingDirectory || (mode && mode !== '--watch') || extra.length) {
      throw Error('Usage: node scripts/agent/stage-observatory.mjs <task.json> <journal> <private-staging-directory> [--watch]');
    }
    const options = { taskFile: resolve(taskFile), journal: resolve(journal), stagingDirectory: resolve(stagingDirectory) };
    if (mode === '--watch') await watchSnapshots(options, report, controller.signal);
    else report({ state: 'ready_for_authenticated_import', ...await stageSnapshot(options) });
  } catch (cause) {
    process.stderr.write('Observatory staging: ' + (cause.code ?? (cause.message.startsWith('Usage:') ? cause.message : 'snapshot could not be staged')) + '\n');
    process.exitCode = 1;
  }
}
