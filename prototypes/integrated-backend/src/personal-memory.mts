import type { DatabaseSync } from 'node:sqlite';
import type { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import type { ConversationSourceRef, PersonalContextHost, PersonalCrypto } from '../../personal-context/src/contracts.ts';
import { openPersonalContextCrypto, type PersonalContextCrypto } from '../../personal-context/src/protected-key.mts';
import { PersonalContextError, PersonalContextService } from '../../personal-context/src/service.mts';
import type { NativeHostServices } from './native-host.mts';

interface Options {
  kernel: WorkspaceKernel;
  secrets: NativeHostServices['secrets'];
  host: PersonalContextHost;
}

const lockedCrypto: PersonalCrypto = {
  available: () => false,
  encrypt() { throw new PersonalContextError('private_crypto_unavailable'); },
  decrypt() { throw new PersonalContextError('private_crypto_unavailable'); },
};

/** Private process composition. BackendCore supplies its canonical authorization
 * and closes the owner before releasing the kernel or the OS broker. */
export class NativePersonalMemory {
  private readonly options: Options;
  private opening?: Promise<PersonalContextService>;
  private crypto?: PersonalContextCrypto;
  private closed = false;

  constructor(options: Options) {
    this.options = options;
  }

  open(): Promise<PersonalContextService> {
    if (this.closed) return Promise.reject(new PersonalContextError('personal_memory_closed'));
    this.opening ??= this.initialize().catch(error => {
      this.opening = undefined;
      throw error;
    });
    return this.opening;
  }

  /** Fresh profiles can report default consent without initializing OS custody. */
  hasStorage(): boolean {
    return this.transaction(db => !!db.prepare(
      "SELECT 1 FROM sqlite_schema WHERE type='table' AND name IN ('personal_context_key','personal_context_schema','personal_context_heads','personal_context_revisions','personal_context_dependencies','personal_context_conversation_sources') LIMIT 1",
    ).get());
  }

  /** Called inside the source owner's synchronous transaction after source
   * authority is established. Erasure needs metadata, including when locked. */
  eraseConversationSource(source: ConversationSourceRef) {
    this.requireOpen();
    return this.transaction(db => PersonalContextService.eraseExistingConversationSource({
      db, transaction: this.transaction, host: this.options.host, crypto: lockedCrypto,
    }, source));
  }

  private createService(db: DatabaseSync, crypto: PersonalCrypto) {
    return new PersonalContextService({ db, transaction: this.transaction, host: this.options.host, crypto });
  }

  private readonly transaction = <T,>(work: (db: DatabaseSync) => T): T => {
    this.requireOpen();
    return this.options.kernel.withTransaction(work);
  };

  private async initialize(): Promise<PersonalContextService> {
    const crypto = await openPersonalContextCrypto({ transaction: this.transaction, protector: this.options.secrets });
    try {
      this.requireOpen();
      const service = this.transaction(db => this.createService(db, crypto));
      this.crypto = crypto;
      return service;
    } catch (error) {
      crypto.close();
      throw error;
    }
  }

  private requireOpen(): void {
    if (this.closed) throw new PersonalContextError('personal_memory_closed');
  }

  close(): void {
    this.closed = true;
    this.crypto?.close();
    this.crypto = undefined;
    this.opening = undefined;
  }
}
