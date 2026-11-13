import type { DatabaseSync } from 'node:sqlite';
import type { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import type { PersonalContextHost } from '../../personal-context/src/contracts.ts';
import { openPersonalContextCrypto, type PersonalContextCrypto } from '../../personal-context/src/protected-key.mts';
import { PersonalContextError, PersonalContextService } from '../../personal-context/src/service.mts';
import type { NativeHostServices } from './native-host.mts';

interface Options {
  kernel: WorkspaceKernel;
  secrets: NativeHostServices['secrets'];
  host: PersonalContextHost;
}

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

  private async initialize(): Promise<PersonalContextService> {
    const { kernel, secrets, host } = this.options;
    const transaction = <T,>(work: (db: DatabaseSync) => T): T => {
      this.requireOpen();
      return kernel.withTransaction(work);
    };
    const crypto = await openPersonalContextCrypto({ transaction, protector: secrets });
    try {
      this.requireOpen();
      const db = transaction(connection => connection);
      const service = new PersonalContextService({ db, transaction, host, crypto });
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
