import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
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
  mode: 'create' | 'reopen';
}

function canonicalStat(path: string) {
  const stat = lstatSync(path, { bigint: true });
  if (stat.isSymbolicLink() || realpathSync(path) !== path)
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
export function createSyntheticMemoryProtector({ profileRoot, databasePath, fixtureKey, mode }: Options):
  SecretProtector & { close(): void } {
  if (!['create', 'reopen'].includes(mode) || !(fixtureKey instanceof Uint8Array) ||
      fixtureKey.byteLength !== 32 || !fixtureKey.some(byte => byte !== 0))
    throw Error('synthetic_memory_custody_invalid');
  if (!isAbsolute(profileRoot) || resolve(profileRoot) !== profileRoot ||
      !/^memory-witness-[a-z0-9-]+$/u.test(basename(profileRoot)) ||
      resolve(databasePath) !== databasePath || dirname(databasePath) !== profileRoot ||
      !/^[a-z0-9-]+\.sqlite$/u.test(basename(databasePath)))
    throw Error('synthetic_memory_profile_mismatch');

  const markerPath = join(profileRoot, 'synthetic-packaged.started');
  const root = canonicalStat(profileRoot), marker = canonicalStat(markerPath);
  if (!root.isDirectory() || !marker.isFile() || marker.size !== 0n || marker.nlink !== 1n)
    throw Error('synthetic_memory_profile_mismatch');
  const readDatabase = () => {
    const stat = canonicalStat(databasePath);
    if (!stat.isFile() || stat.nlink !== 1n) throw Error('synthetic_memory_profile_mismatch');
    return stat;
  };
  if (mode === 'create' && !absent(databasePath)) throw Error('synthetic_memory_custody_state');
  let database = mode === 'reopen' ? readDatabase() : undefined;
  if (mode === 'reopen') {
    const db = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const row = db.prepare('SELECT version, wrapped_key FROM personal_context_key WHERE singleton=1').get();
      if (row?.version !== 1 || !(row.wrapped_key instanceof Uint8Array) ||
          row.wrapped_key.length !== format.length + nonceLength + tagLength + payloadLength ||
          !Buffer.from(row.wrapped_key).subarray(0, format.length).equals(format))
        throw Error('synthetic_memory_custody_state');
    } catch { throw Error('synthetic_memory_custody_state'); }
    finally { db.close(); }
  }
  const aad = Buffer.from(JSON.stringify([format.toString(), profileRoot, databasePath, root.dev.toString(),
    root.ino.toString(), marker.ino.toString()]));
  const key = Buffer.from(fixtureKey);
  let closed = false;
  let sealed: Buffer | undefined;

  function checkRoot() {
    if (closed) throw Error('synthetic_memory_custody_closed');
    const currentRoot = canonicalStat(profileRoot), currentMarker = canonicalStat(markerPath);
    if (!currentRoot.isDirectory() || currentRoot.dev !== root.dev || currentRoot.ino !== root.ino ||
        !currentMarker.isFile() || currentMarker.dev !== marker.dev || currentMarker.ino !== marker.ino ||
        currentMarker.nlink !== 1n || currentMarker.size !== 0n)
      throw Error('synthetic_memory_profile_mismatch');
  }

  function checkDatabase() {
    checkRoot();
    const current = readDatabase();
    if (database && (current.dev !== database.dev || current.ino !== database.ino))
      throw Error('synthetic_memory_profile_mismatch');
    database = current;
    return Buffer.concat([aad, Buffer.from(JSON.stringify([current.dev.toString(), current.ino.toString()]))]);
  }

  return {
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
    async seal(value) {
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
    async open(value) {
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
    close() {
      closed = true;
      key.fill(0);
      sealed = undefined;
    },
  };
}
