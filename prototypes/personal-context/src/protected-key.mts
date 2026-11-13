import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { SecretProtector } from '../../openai-provider/native-storage.mts';
import type { PersonalCrypto } from './contracts.ts';
import { PersonalContextError } from './service.mts';

const keyPrefix = 'aerynth.personal-context.key/1:';
const nonceBytes = 12;
const tagBytes = 16;

interface CustodyOptions {
  transaction<T>(work: (db: DatabaseSync) => T): T;
  protector: SecretProtector;
}

export interface PersonalContextCrypto extends PersonalCrypto {
  close(): void;
}

function keyRow(db: DatabaseSync) {
  return db.prepare('SELECT version, wrapped_key FROM personal_context_key WHERE singleton=1').get();
}

function hasRetainedMemory(db: DatabaseSync) {
  for (const table of ['personal_context_heads', 'personal_context_revisions', 'personal_context_dependencies']) {
    if (db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table)
      && db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()) return true;
  }
  return false;
}

/** Unlock through the private native protector outside SQLite transactions. The
 * canonical connection retains only the OS-wrapped key, including in backups. */
export async function openPersonalContextCrypto({ transaction, protector }: CustodyOptions): Promise<PersonalContextCrypto> {
  if (!await protector.available().catch(() => false)) throw new PersonalContextError('private_key_unavailable');
  let row = transaction(db => {
    db.exec(`CREATE TABLE IF NOT EXISTS personal_context_key (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1),
      version INTEGER NOT NULL,
      wrapped_key BLOB NOT NULL
    )`);
    const current = keyRow(db);
    if (!current && hasRetainedMemory(db)) throw new PersonalContextError('private_key_missing');
    return current;
  });
  if (!row) {
    const candidate = randomBytes(32);
    let wrapped: Uint8Array;
    try {
      const plaintext = keyPrefix + candidate.toString('base64url');
      wrapped = await protector.seal(plaintext);
      if (!(wrapped instanceof Uint8Array) || !wrapped.length || wrapped.length > 16384
        || Buffer.from(wrapped).includes(Buffer.from(plaintext))
        || Buffer.from(wrapped).includes(candidate)) throw new Error('Invalid wrapped key');
    } catch {
      throw new PersonalContextError('private_key_unavailable');
    } finally {
      candidate.fill(0);
    }
    row = transaction(db => {
      const current = keyRow(db);
      if (current) return current;
      if (hasRetainedMemory(db)) throw new PersonalContextError('private_key_missing');
      db.prepare('INSERT INTO personal_context_key VALUES(1,1,?)').run(wrapped);
      return keyRow(db);
    });
  }
  if (!row || row.version !== 1 || !(row.wrapped_key instanceof Uint8Array)
    || !row.wrapped_key.length || row.wrapped_key.length > 16384) throw new PersonalContextError('private_key_unavailable');

  let key: Buffer;
  try {
    const envelope = await protector.open(row.wrapped_key);
    const encoded = envelope.slice(keyPrefix.length);
    if (!envelope.startsWith(keyPrefix) || !/^[A-Za-z0-9_-]{43}$/.test(encoded)) throw new Error('Invalid key envelope');
    key = Buffer.from(encoded, 'base64url');
    if (key.toString('base64url') !== encoded) {
      key.fill(0);
      throw new Error('Invalid key encoding');
    }
  } catch {
    throw new PersonalContextError('private_key_unavailable');
  }
  let open = true;
  const requireOpen = () => {
    if (!open) throw new PersonalContextError('private_crypto_unavailable');
  };
  return {
    available: () => open,
    encrypt(plaintext, purpose) {
      requireOpen();
      const nonce = randomBytes(nonceBytes);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(Buffer.from(purpose));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
    },
    decrypt(ciphertext, purpose) {
      requireOpen();
      if (ciphertext.length < nonceBytes + tagBytes) throw new PersonalContextError('private_content_unavailable');
      const decipher = createDecipheriv('aes-256-gcm', key, ciphertext.subarray(0, nonceBytes));
      decipher.setAAD(Buffer.from(purpose));
      decipher.setAuthTag(ciphertext.subarray(nonceBytes, nonceBytes + tagBytes));
      return Buffer.concat([decipher.update(ciphertext.subarray(nonceBytes + tagBytes)), decipher.final()]);
    },
    close() {
      open = false;
      key.fill(0);
    },
  };
}
