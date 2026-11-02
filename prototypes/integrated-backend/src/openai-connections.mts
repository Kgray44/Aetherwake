import {
  PROVIDER_CONNECTION_CONTRACT,
  type ProviderConnectionStatus,
  type ProviderConnectionRequest,
} from "../../application-contract/provider-connections.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import type { DatabaseSync } from "node:sqlite";
import type { NativeHostServices } from "./native-host.mts";
import type {
  NativeAuthorizationStart,
  NativeCredential,
  NativeCredentialVault,
  ModelCatalogDiagnostic,
} from "../../openai-provider/contracts.mts";
import type { SiwcSessionManager } from "../../openai-provider/auth.mts";
import type { SqliteNativeVault } from "../../openai-provider/native-storage.mts";
import type { NativeLoopbackListener } from "../../openai-provider/loopback.mts";

export const CHATGPT_PLAN_REGISTRATION = "aerynth.chatgpt-plan.primary";
export type PublicConnectionRequest = Pick<
  ProviderConnectionRequest,
  "providerId"
> & { type: "status" };
export type PublicConnectionStatus = ProviderConnectionStatus;
export interface PlanModelCatalog {
  providerId: "chatgpt-plan-responses";
  boundaryDigest: string;
  observedAt: number;
  catalogOnly: true;
  models: { id: string; label: string }[];
}
export interface OpenAIConnectionsOptions {
  db: DatabaseSync;
  transaction<T>(work: (sameDb: DatabaseSync) => T): T;
  nativeHost?: NativeHostServices;
  localEligibility?: {
    kind: "local-personal-project";
    scope: "current-owner-local-installation";
    decisionRef: string;
  };
  authorizeRecovery?: (review: {
    registrationId: string;
    expectedFence: number;
    expectedVersion: number | null;
  }) => Promise<void>;
  fetch?: typeof fetch;
  now?: () => number;
  listenerTimeoutMs?: number;
}
const safeCodes = new Set([
  "connection_unavailable",
  "connection_closed",
  "connection_cancelled",
  "connection_busy",
  "connection_timeout",
  "invalid_connection_request",
  "connection_attempt_unavailable",
  "local_registration_not_authorized",
  "native_auth_connection_mismatch",
  "unsupported_native_auth_schema",
  "native_secret_unavailable",
  "native_secret_protocol",
  "native_secret_capacity",
  "native_secret_backpressure",
  "native_secret_timeout",
  "native_secret_closed",
  "native_secret_failed",
  "os_encryption_unavailable",
  "secret_reencryption_required",
  "protected_secret_unavailable",
  "protected_record_binding_mismatch",
  "invalid_protected_registration",
  "auth_lock_recovery_required",
  "auth_lock_busy",
  "auth_storage_busy",
  "auth_storage_unavailable",
  "auth_lock_lost",
  "auth_lock_required",
  "auth_recovery_unavailable",
  "auth_recovery_denied",
  "auth_recovery_changed",
  "registration_changed",
  "registration_owner_changed",
  "credential_registration_conflict",
  "authorization_denied",
  "authorization_failed",
  "authorization_attempt_unavailable",
  "oauth_state_mismatch",
  "callback_client_mismatch",
  "callback_issuer_mismatch",
  "callback_binding_mismatch",
  "callback_binding_unavailable",
  "callback_closed",
  "callback_expired",
  "invalid_identity_token",
  "identity_nonce_or_time_mismatch",
  "selected_identity_mismatch",
  "invalid_token_response",
  "replacement_refresh_token_required",
  "plan_credentials_unavailable",
  "refresh_unavailable",
  "invalid_grant",
  "invalid_client",
  "invalid_refresh_token",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
  "model_catalog_unavailable",
  "invalid_model_catalog",
  "ambiguous_model_catalog",
  "credential_boundary_mismatch",
  "credential_expired",
  "chatgpt_plan_grant_required",
  "provider_failed",
  "subscription_sharing_usage_limit_exceeded",
  "subscription_sharing_usage_unavailable",
  "subscription_sharing_user_unavailable",
]);
export class OpenAIConnectionError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(safeCodes.has(code) ? code : "connection_unavailable");
    this.name = "OpenAIConnectionError";
    this.code = this.message;
  }
}
const code = (error: unknown) =>
  error &&
  typeof error === "object" &&
  "code" in error &&
  typeof error.code === "string" &&
  safeCodes.has(error.code)
    ? error.code
    : "connection_unavailable";
const check: (value: unknown, error: string) => asserts value = (
  value,
  error,
) => {
  if (!value) throw new OpenAIConnectionError(error);
};
const statusRequest: PublicConnectionRequest = {
  type: "status",
  providerId: "chatgpt-plan-responses",
};
interface Operation {
  controller: AbortController;
  casDepth: number;
  done: Promise<void>;
}
interface Flight extends Operation {
  attemptId: string | null;
  listener: NativeLoopbackListener | null;
  manager: SiwcSessionManager | null;
  timer: ReturnType<typeof setTimeout> | null;
  finishing: boolean;
  cleaned: boolean;
}
interface Runtime {
  manager: SiwcSessionManager;
  vault: SqliteNativeVault;
  listen: typeof import("../../openai-provider/loopback.mts").createLoopbackListener;
  models: typeof import("../../openai-provider/responses.mts").fetchModelCatalog;
}

/** Canonical-native auth coordination only. No conversation, resource, model or execution store. */
export class OpenAIConnections {
  private readonly options: OpenAIConnectionsOptions;
  private readonly operation = new AsyncLocalStorage<Operation>();
  private readonly stopped = new AbortController();
  private closed = false;
  private runtimePromise: Promise<Runtime> | null = null;
  private catalogObservation: {
    version: number;
    state: "ready" | "unavailable";
    diagnostic: ModelCatalogDiagnostic;
  } | null = null;
  private pending: Flight | null = null;
  private mutation: Operation | null = null;
  constructor(options: OpenAIConnectionsOptions) {
    this.options = {
      ...options,
      localEligibility: options.localEligibility
        ? structuredClone(options.localEligibility)
        : undefined,
    };
    check(
      options.listenerTimeoutMs === undefined ||
        (Number.isSafeInteger(options.listenerTimeoutMs) &&
          options.listenerTimeoutMs > 0 &&
          options.listenerTimeoutMs <= 300000),
      "invalid_connection_request",
    );
  }
  private assert() {
    check(!this.closed, "connection_closed");
    check(
      !this.operation.getStore()?.controller.signal.aborted,
      "connection_cancelled",
    );
  }
  private tx<T>(work: (db: DatabaseSync) => T): T {
    return this.options.transaction((db) => {
      check(db === this.options.db, "native_auth_connection_mismatch");
      if (this.operation.getStore()?.casDepth) this.assert();
      return work(db);
    });
  }
  private async bounded<T>(
    promise: Promise<T>,
    extra?: AbortSignal,
  ): Promise<T> {
    this.assert();
    const signal = AbortSignal.any([
      this.stopped.signal,
      AbortSignal.timeout(15000),
      ...(this.operation.getStore()
        ? [this.operation.getStore()!.controller.signal]
        : []),
      ...(extra ? [extra] : []),
    ]);
    if (signal.aborted) throw new OpenAIConnectionError("connection_cancelled");
    return new Promise((resolve, reject) => {
      const fail = () => {
        cleanup();
        reject(
          new OpenAIConnectionError(
            this.closed
              ? "connection_closed"
              : this.operation.getStore()?.controller.signal.aborted
                ? "connection_cancelled"
                : "connection_timeout",
          ),
        );
      };
      const cleanup = () => signal.removeEventListener("abort", fail);
      signal.addEventListener("abort", fail, { once: true });
      promise.then(
        (value) => {
          cleanup();
          try {
            this.assert();
            resolve(value);
          } catch (error) {
            reject(error);
          }
        },
        (error) => {
          cleanup();
          reject(new OpenAIConnectionError(code(error)));
        },
      );
    });
  }
  private async nativeFetch(
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ): Promise<Response> {
    this.assert();
    const op = this.operation.getStore(),
      signal = AbortSignal.any([
        this.stopped.signal,
        ...(op ? [op.controller.signal] : []),
        ...(init?.signal ? [init.signal] : []),
      ]);
    return this.bounded(
      (this.options.fetch ?? fetch)(input, { ...init, signal }),
      signal,
    );
  }
  private async storageAvailable(): Promise<boolean> {
    if (!this.options.nativeHost || this.closed) return false;
    this.assert();
    return (
      (await this.bounded(this.options.nativeHost.secrets.available())) === true
    );
  }
  private eligible() {
    const value = this.options.localEligibility;
    return (
      value?.kind === "local-personal-project" &&
      value.scope === "current-owner-local-installation" &&
      typeof value.decisionRef === "string" &&
      value.decisionRef.length > 0 &&
      value.decisionRef.length <= 256 &&
      !/[\r\n\0]/.test(value.decisionRef)
    );
  }
  private base(storageAvailable = false): PublicConnectionStatus {
    return {
      contract: PROVIDER_CONNECTION_CONTRACT,
      providerId: "chatgpt-plan-responses",
      billingRoute: "chatgpt-plan",
      state: "unavailable",
      storageAvailable,
      pending: !!this.pending,
      registrationVersion: null,
      planUsageEnabled: false,
      inferenceVerified: false,
      nativeAccountHistory: false,
      nativeAccountMemory: false,
      nativeAccountSync: false,
    };
  }
  private async getRuntime(verified = false): Promise<Runtime> {
    this.assert();
    check(this.options.nativeHost, "connection_unavailable");
    check(
      verified || (await this.storageAvailable()),
      "os_encryption_unavailable",
    );
    check(this.eligible(), "local_registration_not_authorized");
    if (this.runtimePromise) return this.runtimePromise;
    const task = (async () => {
      // Importing this coordinator/default fixtures does not load jose or provider runtime.
      const [auth, storage, loopback, responses] = await Promise.all([
        import("../../openai-provider/auth.mts"),
        import("../../openai-provider/native-storage.mts"),
        import("../../openai-provider/loopback.mts"),
        import("../../openai-provider/responses.mts"),
      ]);
      this.assert();
      this.tx((db) => {
        this.assert();
        const expected = [
          "openai_native_auth_schema",
          "openai_native_auth_host",
          "openai_native_auth_registration",
          "openai_native_auth_lease",
        ];
        const present = expected.filter(
          (name) =>
            !!db
              .prepare(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
              )
              .get(name),
        );
        if (!present.length) db.exec(storage.NATIVE_AUTH_SCHEMA_SQL);
        else {
          check(
            present.length === expected.length,
            "unsupported_native_auth_schema",
          );
          const versions = db
            .prepare("SELECT version FROM openai_native_auth_schema")
            .all();
          check(
            versions.length === 1 && versions[0].version === 1,
            "unsupported_native_auth_schema",
          );
        }
      });
      const host = this.options.nativeHost!;
      const vault = new storage.SqliteNativeVault({
        db: this.options.db,
        transaction: (work) => this.tx(work),
        now: this.options.now,
        authorizeRecovery: this.options.authorizeRecovery,
        protector: {
          available: () => this.storageAvailable(),
          seal: async (plain) => {
            this.assert();
            return this.bounded(host.secrets.seal(plain));
          },
          open: async (cipher) => {
            this.assert();
            return this.bounded(host.secrets.open(cipher));
          },
        },
      });
      const guarded: NativeCredentialVault = {
        read: async (id) => {
          this.assert();
          const value = await vault.read(id);
          this.assert();
          return value;
        },
        compareAndSwap: async (id, version, next) => {
          this.assert();
          const op = this.operation.getStore();
          if (op) op.casDepth++;
          try {
            await vault.compareAndSwap(id, version, next);
            this.assert();
          } finally {
            if (op) op.casDepth--;
          }
        },
        withLock: (id, work) => {
          this.assert();
          return vault.withLock(id, work);
        },
      };
      const fetcher: typeof fetch = (input, init) =>
        this.nativeFetch(input, init);
      const manager = new auth.SiwcSessionManager({
        vault: guarded,
        host: {
          getOrCreate: async (make) => {
            this.assert();
            const result = await vault.getOrCreate(make);
            this.assert();
            return result;
          },
        },
        now: this.options.now,
        fetch: vault.guardedFetch(fetcher),
        policy: {
          assertListener: async (binding) => {
            this.assert();
            const flight = this.pending;
            check(flight?.listener, "callback_binding_unavailable");
            await flight.listener.assertBinding(binding);
            this.assert();
          },
          authorizeNewRegistration: async () => {
            this.assert();
            check(this.eligible(), "local_registration_not_authorized");
            return structuredClone(this.options.localEligibility!);
          },
        },
      });
      return {
        manager,
        vault,
        listen: loopback.createLoopbackListener,
        models: responses.fetchModelCatalog,
      };
    })();
    this.runtimePromise = task;
    try {
      return await task;
    } catch (error) {
      if (this.runtimePromise === task) this.runtimePromise = null;
      throw new OpenAIConnectionError(code(error));
    }
  }
  async status(
    request: PublicConnectionRequest = statusRequest,
  ): Promise<PublicConnectionStatus> {
    check(
      request &&
        typeof request === "object" &&
        !Array.isArray(request) &&
        Object.keys(request).length === 2 &&
        request.type === "status" &&
        request.providerId === "chatgpt-plan-responses",
      "invalid_connection_request",
    );
    let available = false;
    try {
      available = await this.storageAvailable();
      if (!available) return this.base(false);
      const runtime = await this.getRuntime(true),
        lock = runtime.vault.lockStatus(CHATGPT_PLAN_REGISTRATION);
      if (lock.state === "recovery-required")
        return {
          ...this.base(true),
          state: "recovery-required",
          registrationVersion: lock.registrationVersion,
          errorCode: "auth_lock_recovery_required",
        };
      const current = await runtime.manager.status(CHATGPT_PLAN_REGISTRATION);
      if (current.state !== "ready" || current.version !== this.catalogObservation?.version)
        this.catalogObservation = null;
      return {
        ...this.base(true),
        state: current.state,
        registrationVersion: current.version,
        planUsageEnabled: current.planUsageEnabled,
        ...(this.catalogObservation ? {
          modelCatalog: {
            state: this.catalogObservation.state,
            diagnostic: structuredClone(this.catalogObservation.diagnostic),
          },
        } : {}),
      };
    } catch (error) {
      return { ...this.base(available), errorCode: code(error) };
    }
  }
  private async clean(flight: Flight) {
    if (flight.cleaned) return;
    flight.cleaned = true;
    flight.controller.abort();
    if (flight.timer) clearTimeout(flight.timer);
    if (flight.attemptId) flight.manager?.cancelSignIn(flight.attemptId);
    if (this.pending === flight) this.pending = null;
    await flight.listener?.close();
  }
  /** PRIVATE native route: URL must never be returned by renderer-facing providerConnection. */
  async begin(): Promise<NativeAuthorizationStart> {
    this.catalogObservation = null;
    this.assert();
    check(!this.pending && !this.mutation, "connection_busy");
    const flight: Flight = {
      controller: new AbortController(),
      casDepth: 0,
      done: Promise.resolve(),
      attemptId: null,
      listener: null,
      manager: null,
      timer: null,
      finishing: false,
      cleaned: false,
    };
    this.pending = flight;
    const task = this.operation.run(flight, async () => {
      const runtime = await this.getRuntime();
      flight.manager = runtime.manager;
      const listeningAt = Date.now();
      flight.listener = await runtime.listen(
        this.options.listenerTimeoutMs === undefined
          ? {}
          : { timeoutMs: this.options.listenerTimeoutMs },
      );
      this.assert();
      const start = await runtime.manager.prepareSignIn(
        CHATGPT_PLAN_REGISTRATION,
        flight.listener.binding,
      );
      flight.attemptId = start.attemptId;
      this.assert();
      const state = new URL(start.authorizationUrl).searchParams.get("state");
      check(state, "connection_attempt_unavailable");
      flight.listener.bindAttempt(start.attemptId, state);
      const expiresAt = Math.min(
        start.expiresAt,
        listeningAt + (this.options.listenerTimeoutMs ?? 300000),
      );
      flight.timer = setTimeout(
        () => {
          void this.clean(flight).catch(() => {});
        },
        Math.max(1, expiresAt - Date.now()),
      );
      return { ...start, expiresAt };
    });
    flight.done = task.then(
      () => {},
      () => {},
    );
    try {
      return await task;
    } catch (error) {
      const failure = flight.controller.signal.aborted
        ? "connection_cancelled"
        : code(error);
      await this.clean(flight);
      throw new OpenAIConnectionError(failure);
    }
  }
  /** Callback comes only from the owned loopback listener, never an RPC field. */
  async finish(attemptId: string): Promise<PublicConnectionStatus> {
    this.assert();
    const flight = this.pending;
    check(
      flight &&
        flight.attemptId === attemptId &&
        flight.listener &&
        flight.manager &&
        !flight.finishing,
      "connection_attempt_unavailable",
    );
    flight.finishing = true;
    const task = this.operation.run(flight, async () => {
      const callback = await flight.listener!.waitCallback(attemptId);
      this.assert();
      await flight.manager!.completeCallback(
        attemptId,
        callback,
        flight.listener!.binding,
      );
      this.assert();
    });
    flight.done = task.then(
      () => {},
      () => {},
    );
    let failure: string | undefined;
    try {
      await task;
    } catch (error) {
      failure = flight.controller.signal.aborted
        ? "connection_cancelled"
        : code(error);
    } finally {
      await this.clean(flight);
    }
    if (failure) throw new OpenAIConnectionError(failure);
    return this.status();
  }
  async cancel(attemptId?: string): Promise<PublicConnectionStatus> {
    const flight = this.pending;
    if (flight) {
      check(
        attemptId === undefined || flight.attemptId === attemptId,
        "connection_attempt_unavailable",
      );
      await this.clean(flight);
      await flight.done;
    }
    return this.status();
  }
  private async mutate<T>(work: (runtime: Runtime) => Promise<T>): Promise<T> {
    this.assert();
    check(!this.pending && !this.mutation, "connection_busy");
    const op: Operation = {
      controller: new AbortController(),
      casDepth: 0,
      done: Promise.resolve(),
    };
    this.mutation = op;
    const task = this.operation.run(op, async () =>
      work(await this.getRuntime()),
    );
    op.done = task.then(
      () => {},
      () => {},
    );
    try {
      return await task;
    } catch (error) {
      throw new OpenAIConnectionError(
        op.controller.signal.aborted ? "connection_cancelled" : code(error),
      );
    } finally {
      if (this.mutation === op) this.mutation = null;
    }
  }
  async refresh(expectedVersion: number): Promise<PublicConnectionStatus> {
    check(
      Number.isSafeInteger(expectedVersion) && expectedVersion >= 1,
      "invalid_connection_request",
    );
    await this.mutate((runtime) =>
      runtime.manager.refresh(CHATGPT_PLAN_REGISTRATION, expectedVersion),
    );
    return this.status();
  }
  async disconnect(
    expectedVersion: number,
  ): Promise<{
    status: PublicConnectionStatus;
    remoteRevocation: "confirmed" | "unconfirmed" | "not-needed";
  }> {
    check(
      Number.isSafeInteger(expectedVersion) && expectedVersion >= 1,
      "invalid_connection_request",
    );
    await this.cancel();
    const result = await this.mutate((runtime) =>
      runtime.manager.signOut(CHATGPT_PLAN_REGISTRATION, expectedVersion),
    );
    return {
      status: await this.status(),
      remoteRevocation: result.remoteRevocation,
    };
  }
  async resolveCredential(expectedVersion: number): Promise<NativeCredential> {
    check(
      Number.isSafeInteger(expectedVersion) && expectedVersion >= 1,
      "invalid_connection_request",
    );
    const runtime = await this.getRuntime();
    try {
      return await runtime.manager.resolvePlanCredential(
        CHATGPT_PLAN_REGISTRATION,
        expectedVersion,
      );
    } catch (error) {
      throw new OpenAIConnectionError(code(error));
    }
  }
  async revalidateCredential(
    expectedVersion: number,
    boundaryDigest: string,
  ): Promise<void> {
    check(
      typeof boundaryDigest === "string" &&
        /^[a-f0-9]{64}$/.test(boundaryDigest),
      "invalid_connection_request",
    );
    const current = await this.resolveCredential(expectedVersion);
    check(
      current.boundaryDigest === boundaryDigest,
      "credential_boundary_mismatch",
    );
  }
  private acceptCatalogObservation(expectedVersion: number) {
    if (this.catalogObservation?.version === expectedVersion)
      this.catalogObservation.state = "ready";
  }
  async modelCatalog(expectedVersion: number): Promise<PlanModelCatalog> {
    check(
      Number.isSafeInteger(expectedVersion) && expectedVersion >= 1,
      "invalid_connection_request",
    );
    return this.mutate(async (runtime) => {
      this.catalogObservation = null;
      const result = await runtime.models({
        providerId: "chatgpt-plan-responses",
        configurationId: CHATGPT_PLAN_REGISTRATION,
        resolveCredential: () =>
          runtime.manager.resolvePlanCredential(
            CHATGPT_PLAN_REGISTRATION,
            expectedVersion,
          ),
        fetch: (input, init) => this.nativeFetch(input, init),
        now: this.options.now,
        onDiagnostic: (diagnostic) => {
          if (!this.closed && !this.operation.getStore()?.controller.signal.aborted)
            this.catalogObservation = {
              version: expectedVersion,
              state: "unavailable",
              diagnostic: structuredClone(diagnostic),
            };
        },
      });
      this.assert();
      await this.revalidateCredential(expectedVersion, result.boundaryDigest);
      if (result.models.length > 0) this.acceptCatalogObservation(expectedVersion);
      return { ...result, providerId: "chatgpt-plan-responses" };
    });
  }
  async recover(
    expectedFence: number,
    expectedVersion: number | null,
  ): Promise<PublicConnectionStatus> {
    await this.mutate((runtime) =>
      runtime.vault.recoverAbandoned(
        CHATGPT_PLAN_REGISTRATION,
        expectedFence,
        expectedVersion,
      ),
    );
    return this.status();
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.stopped.abort();
    const flight = this.pending;
    if (flight) {
      await this.clean(flight);
      await flight.done;
    }
    const mutation = this.mutation;
    if (mutation) {
      mutation.controller.abort();
      await mutation.done;
    }
  }
}
