#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, readFile, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { telemetryDelta, telemetryTaskId } from '../../agent-system/observatory/telemetry-delta.mjs';
import { projectJournal, readTask } from './export-journal.mjs';
import { openObservatoryConnector } from './observatory-connector.mjs';

const maxStateBytes = 3 * 1024 * 1024 + 16384;
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

export function journalDelivery({ task, journal, statePath, connector, verification }) {
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
        return checkReceipt(receipt, batch.snapshot);
      } catch (error) {
        if (error.status !== 409) throw error;
        const remote = (await connector.call(args)).baseline;
        if (!remote) return null;
        if (telemetryDelta(batch.snapshot, remote)) return null;
        return remote;
      }
    }
    if (pending) {
      baseline = await send(pending);
      await persist({ baseline });
      pending = null;
    }
    // New local journals can submit with a null baseline directly. A conflict
    // is resolved via authenticated readback, never an unconditional overwrite.
    if (disk && (baseline === undefined || baseline === null)) baseline = (await connector.call(args)).baseline;
    const preparing = performance.now();
    const snapshot = JSON.parse(await projectJournal({ task, directory: journal, cache, generatedAt: nextGeneration(baseline) }));
    const change = telemetryDelta(snapshot, baseline);
    const scanMs = performance.now() - preparing;
    if (change) {
      pending = { change, snapshot };
      await persist({ baseline, pending });
      const delivered = await send(pending);
      if (!delivered) {
        // Preserve the canonical journal. A later attempt will rebase against
        // the new remote generation without replaying an older mutation.
        await persist({ baseline: undefined });
        throw Error('Observatory telemetry baseline changed');
      }
      baseline = delivered;
    }
    const newestEvent = baseline?.projection.events.map(event => event.occurred_at).sort().at(-1);
    const status = { last_success: baseline?.received_at ?? null, events: baseline?.projection.events.length ?? 0,
      records: baseline?.projection.records.length ?? 0, sent_events: change?.events.length ?? 0,
      sent_records: change?.records.length ?? 0, sync_ms: Math.round(performance.now() - started), prepare_ms: Math.round(scanMs),
      newest_event_delivery_ms: newestEvent ? Date.parse(baseline.received_at) - Date.parse(newestEvent) : null,
      source_generated_at: baseline?.projection.generated_at ?? null, error: null };
    await persist({ baseline, status });
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

export async function startObservatorySync({ task, journal, directory = observatoryDirectory(), verificationNamespace }) {
  const config = await readObservatoryConnection(directory);
  if (!config || task.repository !== 'Kgray44/Aetherwake') return null;
  if (!identity(task.id) || (verificationNamespace !== undefined && (config.verification ?? null) !== verificationNamespace)) {
    throw Error('Invalid Observatory telemetry namespace or Task identity');
  }
  await privateDirectory(directory);
  const scope = config.verification ?? 'live';
  const queue = join(directory, scope);
  await privateDirectory(queue);
  const name = key(JSON.stringify([task.id, resolve(journal)]));
  await save(join(queue, name + '.source'), { task, journal: resolve(journal) });
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
    if (current || control.signal.aborted || Date.now() < retryAt) return current;
    current = (async () => {
      try {
        connector ??= openObservatoryConnector({ signal: control.signal });
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
      } catch (error) {
        if (control.signal.aborted) return;
        failures = Math.min(failures + 1, 5);
        retryAt = Date.now() + Math.min(120000, 4000 * 2 ** failures);
        await status({ error: Number.isInteger(error.status) ? 'site_http_' + error.status : 'delivery_unavailable',
          checked_at: new Date().toISOString(), retry_at: new Date(retryAt).toISOString() });
        connector?.close();
        connector = undefined;
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
        await flush(true);
      })();
      await Promise.race([finishing, delay(8000, undefined, { signal: timeout.signal }).catch(() => {})]);
      timeout.abort();
      control.abort();
      connector?.close();
      return jsonFile(statusPath).catch(() => null);
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
