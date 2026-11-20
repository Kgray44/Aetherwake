#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { telemetryDelta, telemetryTaskId, withIndependentActivity } from '../../agent-system/observatory/telemetry-delta.mjs';
import { projectJournal, readTask } from './export-journal.mjs';
import { openObservatoryConnector } from './observatory-connector.mjs';

const maxStateBytes = 3 * 1024 * 1024 + 16384;
const finalDeliveryWindowMs = 30_000;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const key = value => createHash('sha256').update(value).digest('hex');
const identity = value => typeof value === 'string' && telemetryTaskId.test(value);

export function observatoryDirectory() {
  const git = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
  return join(git, 'agent-harness', 'observatory-sync');
}

async function privateDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (process.platform !== 'win32' && (info.mode & 0o077))) {
    throw Error('Observatory checkpoints require a private directory');
  }
}

async function jsonFile(path) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.size > maxStateBytes || (process.platform !== 'win32' && (info.mode & 0o077))) {
      throw Error('Invalid private Observatory checkpoint');
    }
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
}

async function save(path, data) {
  const serialized = JSON.stringify(data);
  if (Buffer.byteLength(serialized) > maxStateBytes) throw Error('Observatory checkpoint exceeds its limit');
  const temporary = path + '.' + randomUUID();
  const file = await open(temporary, 'wx', 0o600);
  try {
    try { await file.writeFile(serialized); await file.sync(); }
    finally { await file.close(); }
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export async function connectObservatory({ directory = observatoryDirectory(), verification, connector = openObservatoryConnector } = {}) {
  if (verification !== undefined && !uuid.test(verification)) throw Error('Invalid verification namespace');
  const connected = connector();
  try {
    await connected.call({ task_id: 'aads_connection_probe', ...(verification ? { verification } : {}) });
    await privateDirectory(directory);
    await save(join(directory, 'connection.json'), { version: 1, ...(verification ? { verification } : {}) });
  } finally { connected.close(); }
}

function nextGeneration(baseline) {
  return new Date(Math.max(Date.now(), (Date.parse(baseline?.projection?.generated_at) || 0) + 1)).toISOString();
}

function checkReceipt(receipt, projection) {
  if (!/^[a-f0-9]{64}$/.test(receipt?.digest) || receipt.generated_at !== projection.generated_at ||
      !Number.isFinite(Date.parse(receipt.received_at)) || receipt.events !== projection.events.length ||
      receipt.records !== projection.records.length) throw Error('Missing or inconsistent telemetry receipt');
  return { digest: receipt.digest, received_at: receipt.received_at, projection };
}

async function journalStamp(directory) {
  return (await Promise.all([directory, join(directory, 'records')].map(async path => {
    try {
      const info = await lstat(path, { bigint: true });
      if (!info.isDirectory() || info.isSymbolicLink() || (process.platform !== 'win32' && (info.mode & 0o077n))) {
        throw Error('Telemetry source must be a private journal');
      }
      return [info.ino, info.mtimeNs].join(':');
    } catch (error) { if (error.code !== 'ENOENT') throw error; return 'missing'; }
  }))).join('|');
}

export function journalDelivery({ task, journal, statePath, connector, verification, activityOnly = false }) {
  const args = { task_id: task.id, ...(verification ? { verification } : {}) };
  const cache = { events: new Map(), records: new Map() };
  let stamp, previousScan = 0;
  return async function synchronize({ force = false } = {}) {
    const now = Date.now();
    const started = performance.now();
    const nextStamp = await journalStamp(journal);
    if (!force && stamp === nextStamp && now - previousScan < 60000) return null;
    const disk = await jsonFile(statePath);
    let baseline = disk?.baseline;
    let pending = disk?.pending;
    const persist = value => save(statePath, { version: 1, ...value });
    if (disk?.version !== 1 && disk !== null) throw Error('Unsupported telemetry checkpoint version');

    // A persisted request is retried byte-for-byte. The backend recognizes an
    // already committed projection even when the original receipt was lost.
    async function send(batch) {
      try {
        const receipt = await connector.call({ ...args, change: batch.change });
        return { baseline: checkReceipt(receipt, batch.snapshot), retry:false };
      } catch (error) {
        if (error.status !== 409) throw error;
        const remote = (await connector.call(args)).baseline;
        const retry = !remote || !!telemetryDelta(withIndependentActivity(batch.snapshot, remote, {activityOnly}), remote);
        return { baseline:remote, retry };
      }
    }
    if (pending) {
      const delivery = await send(pending);
      baseline = delivery.baseline;
      await persist({ baseline });
      pending = null;
    }
    // New local journals can submit with a null baseline directly. A conflict
    // is resolved via authenticated readback, never an unconditional overwrite.
    if (baseline == null && (activityOnly || disk)) baseline = (await connector.call(args)).baseline;
    const preparing = performance.now();
    const local = JSON.parse(await projectJournal({ task, directory: journal, cache, generatedAt: nextGeneration(baseline) }));
    if (activityOnly && (local.records.length!==1 ||
        local.events.some(event=>event.kind!=='engineering_activity'||event.attempt_id))) {
      throw Error('Independent activity requires a Task-only journal of unbound engineering receipts');
    }
    const snapshot = withIndependentActivity(local, baseline, {activityOnly});
    const change = telemetryDelta(snapshot, baseline);
    const scanMs = performance.now() - preparing;
    if (change) {
      pending = { change, snapshot };
      await persist({ baseline, pending });
      const delivered = await send(pending);
      if (delivered.retry) {
        // Preserve the canonical journal. A later attempt will rebase against
        // the new remote generation without replaying an older mutation.
        await persist({ baseline: delivered.baseline });
        throw Error('Observatory telemetry baseline changed');
      }
      baseline = delivered.baseline;
    }
    const newestEvent = baseline?.projection.events.map(event => event.occurred_at).sort().at(-1);
    const status = { last_success: baseline?.received_at ?? null, events: baseline?.projection.events.length ?? 0,
      records: baseline?.projection.records.length ?? 0, sent_events: change?.events.length ?? 0,
      sent_records: change?.records.length ?? 0, sync_ms: Math.round(performance.now() - started), prepare_ms: Math.round(scanMs),
      newest_event_delivery_ms: newestEvent ? Date.parse(baseline.received_at) - Date.parse(newestEvent) : null,
      source_generated_at: baseline?.projection.generated_at ?? null, error: null };
    await persist({ baseline, status, journal_stamp:nextStamp });
    stamp = nextStamp;
    previousScan = now;
    return status;
  };
}

export async function readObservatoryConnection(directory) {
  const config = await jsonFile(join(directory, 'connection.json'));
  if (config && (config.version !== 1 ||
      (config.verification !== undefined && (typeof config.verification !== 'string' || !uuid.test(config.verification))))) {
    throw Error('Invalid Observatory connection');
  }
  return config;
}

export async function recoverWorkerTelemetry({taskId, telemetryDirectory, verification, connector}) {
  if (!identity(taskId) || (verification !== undefined && (typeof verification!=='string'||!uuid.test(verification)))) {
    throw Error('Invalid recovery Task or namespace');
  }
  const journal = resolve(telemetryDirectory,'claimed-execution.journal');
  const directory = join(telemetryDirectory,'observatory-sync');
  const queue = join(directory,verification??'live');
  try {
    if (await realpath(queue)!==queue || await realpath(journal)!==journal) return null;
  } catch (error) { if (error.code==='ENOENT') return null; throw error; }
  const config = await readObservatoryConnection(directory);
  if (config && config.verification!==verification) return null;
  const name = key(JSON.stringify([taskId,journal]));
  const source = await jsonFile(join(queue,name+'.source'));
  if (source?.task?.id!==taskId || source.task.repository!=='Kgray44/Aetherwake' ||
      source.journal!==journal || source.activityOnly) return null;
  const statePath=join(queue,name+'.state');
  const checkpoint=await jsonFile(statePath);
  if (!checkpoint?.pending && checkpoint?.journal_stamp===await journalStamp(journal)) return null;
  const synchronize=journalDelivery({task:source.task,journal,statePath,connector,verification});
  const status=await synchronize({force:true});
  await save(join(queue,name+'.status'),status);
  return status;
}

export async function startObservatorySync({ task, journal, directory = observatoryDirectory(), verificationNamespace,
  managedConnection, activityOnly = false }) {
  const config = await readObservatoryConnection(directory) ??
    (managedConnection ? { version:1,verification:verificationNamespace ?? undefined } : null);
  if (!config || task.repository !== 'Kgray44/Aetherwake') return null;
  if (!identity(task.id) || (verificationNamespace !== undefined && (config.verification ?? null) !== verificationNamespace)) {
    throw Error('Invalid Observatory telemetry namespace or Task identity');
  }
  await privateDirectory(directory);
  const scope = config.verification ?? 'live';
  const queue = join(directory, scope);
  await privateDirectory(queue);
  const source = { task, journal: resolve(journal), ...(activityOnly ? {activityOnly:true} : {}) };
  const name = key(JSON.stringify([task.id, source.journal, ...(activityOnly ? ['activity-only'] : [])]));
  await save(join(queue, name + '.source'), source);
  const control = new AbortController();
  let connector;
  let current;
  let failures = 0;
  let retryAt = 0;
  let retiring = false;
  const statusPath = join(queue, name + '.status');
  const deliveries = new Map();
  const status = async value => { try { await save(statusPath, value); } catch { /* Never block task execution. */ } };

  async function flush(force = false) {
    if (current || control.signal.aborted || (!force && Date.now() < retryAt)) return current;
    current = (async () => {
      try {
        connector ??= managedConnection ?? openObservatoryConnector({ signal: control.signal });
        // Keep the current Task first and revisit older offline journals in bounded batches.
        const names = (await readdir(queue)).filter(file => /^[a-f0-9]{64}\.source$/.test(file)).map(file => file.slice(0, -7));
        const rotate = names.filter(other => other !== name);
        const start = rotate.length ? Math.floor(Date.now() / 15000) % rotate.length : 0;
        for (const id of [name, ...rotate.slice(start).concat(rotate.slice(0, start)).slice(0, 3)]) {
          if (control.signal.aborted || (retiring && id !== name)) break;
          const source = await jsonFile(join(queue, id + '.source'));
          if (!source || !identity(source.task?.id) || source.task.repository !== task.repository) continue;
          if (!deliveries.has(id)) deliveries.set(id, journalDelivery({ ...source, statePath: join(queue, id + '.state'),
            connector: { call: params => connector.call(params) }, verification: config.verification }));
          const report = await deliveries.get(id)({ force: force && id === name });
          if (id === name && report) await status(report);
        }
        failures = 0;
        return true;
      } catch (error) {
        if (control.signal.aborted) return false;
        failures = Math.min(failures + 1, 5);
        retryAt = Date.now() + Math.min(120000, 4000 * 2 ** failures);
        await status({ error: Number.isInteger(error.status) ? 'site_http_' + error.status : 'delivery_unavailable',
          checked_at: new Date().toISOString(), retry_at: new Date(retryAt).toISOString() });
        if (!managedConnection) connector?.close();
        connector = undefined;
        return false;
      }
    })();
    try { await current; } finally { current = null; }
  }

  const timer = setInterval(() => { void flush(); }, 15000);
  timer.unref();
  void flush();
  return {
    async finish() {
      retiring = true;
      clearInterval(timer);
      const timeout = new AbortController();
      const finishing = (async () => {
        await current;
        for (let attempt = 0; attempt < 3 && !control.signal.aborted; attempt += 1) {
          if (await flush(true)) break;
          if (attempt < 2) await delay(400 * (attempt + 1), undefined, { signal: control.signal }).catch(() => {});
        }
      })();
      const finished = await Promise.race([
        finishing.then(() => true),
        delay(finalDeliveryWindowMs, false, { signal: timeout.signal }).catch(() => false),
      ]);
      timeout.abort();
      control.abort();
      if (!managedConnection) connector?.close();
      return finished ? jsonFile(statusPath).catch(() => null) : null;
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, flag, value, ...extra] = process.argv.slice(2);
    if (command === 'connect' && (!flag || flag === '--verification' && value && !extra.length)) {
      await connectObservatory({ verification: value });
      process.stdout.write('Observatory connected through the installed Codex Sites plugin.\n');
    } else if (command === 'sync' && flag && value && !extra.length) {
      const task = await readTask(flag);
      const session = await startObservatorySync({ task, journal: resolve(value) });
      if (!session) throw Error('Connect Observatory first');
      const report = await session.finish();
      if (!report?.last_success || report.error) throw Error('Delivery pending');
      process.stdout.write(JSON.stringify(report) + '\n');
    } else throw Error('Use connect [--verification UUID] or sync <task.json> <journal>');
  } catch {
    process.stderr.write('Observatory sync could not start. Check the command and installed Sites plugin.\n');
    process.exitCode = 1;
  }
}
