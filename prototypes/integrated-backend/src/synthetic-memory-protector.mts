import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SecretProtector } from '../../openai-provider/native-storage.mts';

const format = Buffer.from('aerynth.synthetic-memory-custody/1:');
const keyPrefix = 'aerynth.personal-context.key/1:';
const payloadLength = keyPrefix.length + 43;
const nonceLength = 12;
const tagLength = 16;

interface Options {
  profileRoot: string;
  databasePath: string;
  fixtureKey: Uint8Array;
}

export interface SyntheticMemoryRestartDescriptor {
  readonly contract: 'aerynth.memory-fixture-restart@1';
  readonly profileRoot: string;
  readonly expiresAt: number;
}

interface RestartAuthority {
  check(): void;
  assertWorkerExited(): void;
}

type Protector = SecretProtector & { close(): void };
interface Restart {
  readonly descriptor: SyntheticMemoryRestartDescriptor;
  claim(descriptor: SyntheticMemoryRestartDescriptor): Promise<Protector>;
  close(): void;
}

function canonicalStat(path: string) {
  const stat = lstatSync(path, { bigint: true });
  if (stat.isSymbolicLink() || realpathSync(path) !== path)
    throw Error('synthetic_memory_profile_mismatch');
  return stat;
}

function sameFile(current: { dev: bigint; ino: bigint }, expected: { dev: bigint; ino: bigint }) {
  return current.dev === expected.dev && current.ino === expected.ino;
}

function sameMarker(current: ReturnType<typeof canonicalStat>, expected: ReturnType<typeof canonicalStat>) {
  return sameFile(current, expected) && current.ctimeNs === expected.ctimeNs && current.mtimeNs === expected.mtimeNs;
}

function readDescriptor(path: string, profileRoot: string) {
  const stat = canonicalStat(path);
  if (!stat.isFile() || stat.nlink !== 1n || stat.size < 1n || stat.size > 8192n)
    throw Error('synthetic_memory_profile_mismatch');
  const fd = openSync(path, 'r');
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!sameFile(before, stat) || before.size !== stat.size || before.nlink !== 1n)
      throw Error('synthetic_memory_profile_mismatch');
    const buffer = Buffer.alloc(8193);
    let count = 0;
    while (count < buffer.length) {
      const read = readSync(fd, buffer, count, buffer.length - count, null);
      if (!read) break;
      count += read;
    }
    const after = canonicalStat(path);
    if (count !== Number(before.size) || !sameFile(after, before) || after.size !== before.size ||
        after.nlink !== 1n || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs)
      throw Error('synthetic_memory_profile_mismatch');
    const bytes = buffer.subarray(0, count);
    const descriptor = JSON.parse(bytes.toString('utf8'));
    if (descriptor?.contract !== 'aerynth.memory-fixture-descriptor@1' || descriptor.profileRoot !== profileRoot)
      throw Error('synthetic_memory_profile_mismatch');
    return { stat, expiresAt: descriptor.expiresAt as unknown, digest: createHash('sha256').update(bytes).digest('hex') };
  } catch { throw Error('synthetic_memory_profile_mismatch'); }
  finally { closeSync(fd); }
}

function readConsumedMarker(path: string) {
  const stat = canonicalStat(path);
  if (!stat.isFile() || stat.nlink !== 1n || stat.size !== 0n)
    throw Error('synthetic_memory_profile_mismatch');
  return stat;
}

function absent(path: string): boolean {
  try { lstatSync(path); return false; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw error;
  }
}

function personalContextKey(value: string): boolean {
  const encoded = value.slice(keyPrefix.length);
  return value.startsWith(keyPrefix) && /^[A-Za-z0-9_-]{43}$/u.test(encoded) &&
    /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u.test(encoded);
}

/** For an already admitted synthetic fixture host. This module issues no
 * admission and must never be wired to a production secret broker. */
export function createSyntheticMemoryProtector(options: Options & { mode: 'create' }):
  Protector & { prepareRestart(authority: RestartAuthority): Promise<Restart> } {
  if (options.mode !== 'create') throw Error('synthetic_memory_custody_invalid');
  return createProtector(options, 'create');
}

function createProtector({ profileRoot, databasePath, fixtureKey }: Options, mode: 'create' | 'reopen',
  checkRestart?: () => void): Protector & { prepareRestart(authority: RestartAuthority): Promise<Restart> } {
  if (!(fixtureKey instanceof Uint8Array) ||
      fixtureKey.byteLength !== 32 || !fixtureKey.some(byte => byte !== 0))
    throw Error('synthetic_memory_custody_invalid');
  if (!isAbsolute(profileRoot) || resolve(profileRoot) !== profileRoot ||
      !/^memory-witness-[a-z0-9-]+$/u.test(basename(profileRoot)) ||
      resolve(databasePath) !== databasePath || dirname(databasePath) !== profileRoot ||
      !/^[a-z0-9-]+\.sqlite$/u.test(basename(databasePath)))
    throw Error('synthetic_memory_profile_mismatch');

  const markerPath = join(profileRoot, 'synthetic-packaged.started');
  const consumedPath = join(profileRoot, 'synthetic-packaged.consumed');
  const root = canonicalStat(profileRoot);
  if (!root.isDirectory()) throw Error('synthetic_memory_profile_mismatch');
  const marker = readDescriptor(markerPath, profileRoot);
  const consumed = readConsumedMarker(consumedPath);
  const readDatabase = () => {
    const stat = canonicalStat(databasePath);
    if (!stat.isFile() || stat.nlink !== 1n) throw Error('synthetic_memory_profile_mismatch');
    return stat;
  };
  if (mode === 'create' && !absent(databasePath)) throw Error('synthetic_memory_custody_state');
  let database = mode === 'reopen' ? readDatabase() : undefined;
  function readEnvelope() {
    const db = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const row = db.prepare('SELECT version, wrapped_key FROM personal_context_key WHERE singleton=1').get();
      if (row?.version !== 1 || !(row.wrapped_key instanceof Uint8Array) ||
          row.wrapped_key.length !== format.length + nonceLength + tagLength + payloadLength ||
          !Buffer.from(row.wrapped_key).subarray(0, format.length).equals(format))
        throw Error('synthetic_memory_custody_state');
      return Buffer.from(row.wrapped_key);
    } catch { throw Error('synthetic_memory_custody_state'); }
    finally { db.close(); }
  }
  const aad = Buffer.from(JSON.stringify([format.toString(), profileRoot, databasePath, root.dev.toString(),
    root.ino.toString(), marker.stat.dev.toString(), marker.stat.ino.toString(), marker.digest,
    consumed.dev.toString(), consumed.ino.toString()]));
  const key = Buffer.from(fixtureKey);
  let closed = false;
  let sealed: Buffer | undefined;

  function checkProfileBinding() {
    const currentRoot = canonicalStat(profileRoot);
    const currentMarker = readDescriptor(markerPath, profileRoot);
    if (!currentRoot.isDirectory() || !sameFile(currentRoot, root) ||
        !sameMarker(currentMarker.stat, marker.stat) || currentMarker.digest !== marker.digest ||
        !sameMarker(readConsumedMarker(consumedPath), consumed))
      throw Error('synthetic_memory_profile_mismatch');
  }

  function checkRoot() {
    if (closed) throw Error('synthetic_memory_custody_closed');
    checkRestart?.();
    checkProfileBinding();
  }

  function checkDatabase() {
    checkRoot();
    const current = readDatabase();
    if (database && (current.dev !== database.dev || current.ino !== database.ino))
      throw Error('synthetic_memory_profile_mismatch');
    database = current;
    return Buffer.concat([aad, Buffer.from(JSON.stringify([current.dev.toString(), current.ino.toString()]))]);
  }

  let preparingRestart = false;
  const protector = {
    async available() {
      try {
        if (database) checkDatabase();
        else {
          checkRoot();
          if (!absent(databasePath)) readDatabase();
        }
        return true;
      } catch { return false; }
    },
    async seal(value: string) {
      const binding = checkDatabase();
      if (mode !== 'create' || sealed) throw Error('synthetic_memory_custody_state');
      if (typeof value !== 'string' || !personalContextKey(value)) throw Error('synthetic_memory_key_envelope_invalid');
      const nonce = randomBytes(nonceLength);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(binding);
      const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      sealed = Buffer.concat([format, nonce, cipher.getAuthTag(), body]);
      return Buffer.from(sealed);
    },
    async open(value: Uint8Array) {
      const binding = checkDatabase();
      const bytes = Buffer.from(value);
      if (bytes.length !== format.length + nonceLength + tagLength + payloadLength ||
          !bytes.subarray(0, format.length).equals(format) ||
          (mode === 'create' && !sealed?.equals(bytes)))
        throw Error('synthetic_memory_key_envelope_invalid');
      try {
        const tagStart = format.length + nonceLength;
        const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(format.length, tagStart));
        decipher.setAAD(binding);
        decipher.setAuthTag(bytes.subarray(tagStart, tagStart + tagLength));
        const plain = Buffer.concat([decipher.update(bytes.subarray(tagStart + tagLength)), decipher.final()]);
        try {
          const value = plain.toString('utf8');
          if (!personalContextKey(value)) throw Error('invalid Personal Context key');
          return value;
        } finally { plain.fill(0); }
      } catch { throw Error('synthetic_memory_key_envelope_invalid'); }
    },
    // The admitted parent owns the worker and calls this only after exit.
    async prepareRestart(authority: RestartAuthority): Promise<Restart> {
      if (mode !== 'create' || preparingRestart || !sealed || !database)
        throw Error('synthetic_memory_custody_state');
      preparingRestart = true;
      let restartKey: Buffer | undefined;
      try {
        const expiresAt = marker.expiresAt;
        const checkAdmission = () => {
          authority.check();
          if (typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt) || Date.now() >= expiresAt)
            throw Error('synthetic_memory_restart_expired');
        };
        checkAdmission();
        authority.assertWorkerExited();
        checkDatabase();
        const backendPath = join(profileRoot, 'synthetic-backend.started');
        const backend = readConsumedMarker(backendPath);
        const envelope = readEnvelope();
        // The original owner must have persisted exactly the envelope it sealed.
        await protector.open(envelope);
        checkAdmission();
        checkDatabase();
        if (!readEnvelope().equals(envelope) || !sameMarker(readConsumedMarker(backendPath), backend))
          throw Error('synthetic_memory_profile_mismatch');

        const restartPath = join(profileRoot, 'synthetic-backend.restart');
        try { writeFileSync(restartPath, '', { flag: 'wx', mode: 0o600 }); }
        catch { throw Error('synthetic_memory_restart_marker_unavailable'); }
        const restart = readConsumedMarker(restartPath);
        const descriptor = Object.freeze({
          contract: 'aerynth.memory-fixture-restart@1', profileRoot, expiresAt: expiresAt as number,
        } as const);
        restartKey = Buffer.from(key);
        const retainedKey = restartKey;
        const check = () => {
          checkAdmission();
          checkProfileBinding();
          if (!sameMarker(readConsumedMarker(restartPath), restart) ||
              !sameMarker(readConsumedMarker(backendPath), backend))
            throw Error('synthetic_memory_profile_mismatch');
        };
        let used = false;
        let cancelled = false;
        return {
          descriptor,
          async claim(request) {
            if (used) throw Error('synthetic_memory_restart_consumed');
            used = true;
            let reopened: ReturnType<typeof createProtector> | undefined;
            try {
              if (request?.contract !== descriptor.contract || request.profileRoot !== descriptor.profileRoot ||
                  request.expiresAt !== descriptor.expiresAt)
                throw Error('synthetic_memory_restart_descriptor_mismatch');
              check();
              reopened = createProtector({ profileRoot, databasePath, fixtureKey: retainedKey }, 'reopen', check);
              const currentEnvelope = readEnvelope();
              if (!currentEnvelope.equals(envelope)) throw Error('synthetic_memory_custody_state');
              await reopened.open(currentEnvelope);
              if (cancelled) throw Error('synthetic_memory_restart_consumed');
              check();
              return { available: reopened.available, open: reopened.open, seal: reopened.seal, close: reopened.close };
            } catch (error) {
              reopened?.close();
              throw error;
            } finally { retainedKey.fill(0); }
          },
          close() {
            cancelled = true;
            used = true;
            retainedKey.fill(0);
          },
        };
      } catch (error) {
        restartKey?.fill(0);
        throw error;
      } finally {
        protector.close();
      }
    },
    close() {
      closed = true;
      key.fill(0);
      sealed = undefined;
    },
  };
  return protector;
}
