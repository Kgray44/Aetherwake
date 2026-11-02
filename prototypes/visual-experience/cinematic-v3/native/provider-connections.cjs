const PROVIDER = "chatgpt-plan-responses";
const CONTRACT = "aerynth.provider-connection@1";
const STATES = new Set([
  "unavailable",
  "disconnected",
  "identity-only",
  "ready",
  "expired",
  "recovery-required",
]);
const exact = (input, keys) =>
  input &&
  typeof input === "object" &&
  !Array.isArray(input) &&
  Reflect.ownKeys(input).length === keys.length &&
  keys.every(
    (key) =>
      Object.hasOwn(input, key) &&
      Object.hasOwn(Object.getOwnPropertyDescriptor(input, key), "value"),
  );
const version = (value) => Number.isSafeInteger(value) && value > 0;

function safeStatus(value) {
  if (
    !value ||
    value.contract !== CONTRACT ||
    value.providerId !== PROVIDER ||
    value.billingRoute !== "chatgpt-plan" ||
    !STATES.has(value.state) ||
    typeof value.pending !== "boolean" ||
    typeof value.storageAvailable !== "boolean" ||
    typeof value.planUsageEnabled !== "boolean" ||
    !(
      value.registrationVersion === null || version(value.registrationVersion)
    ) ||
    value.inferenceVerified !== false ||
    value.nativeAccountHistory !== false ||
    value.nativeAccountMemory !== false ||
    value.nativeAccountSync !== false
  )
    throw Error("invalid_provider_connection_status");
  return {
    contract: CONTRACT,
    providerId: PROVIDER,
    billingRoute: "chatgpt-plan",
    state: value.state,
    storageAvailable: value.storageAvailable,
    pending: value.pending,
    registrationVersion: value.registrationVersion,
    planUsageEnabled: value.planUsageEnabled,
    inferenceVerified: false,
    nativeAccountHistory: false,
    nativeAccountMemory: false,
    nativeAccountSync: false,
    ...(typeof value.errorCode === "string" &&
    /^[a-z][a-z0-9_]{2,80}$/.test(value.errorCode)
      ? { errorCode: value.errorCode }
      : {}),
  };
}
function authorizationStart(value) {
  if (
    !exact(value, ["attemptId", "authorizationUrl", "expiresAt"]) ||
    typeof value.attemptId !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      value.attemptId,
    ) ||
    typeof value.authorizationUrl !== "string" ||
    value.authorizationUrl.length > 16384 ||
    !Number.isFinite(value.expiresAt) ||
    value.expiresAt <= Date.now()
  )
    throw Error("invalid_native_sign_in_start");
  const url = new URL(value.authorizationUrl);
  if (
    url.origin !== "https://auth.openai.com" ||
    url.pathname !== "/api/accounts/authorize" ||
    url.username ||
    url.password ||
    url.hash ||
    url.href !== value.authorizationUrl
  )
    throw Error("invalid_native_sign_in_destination");
  return value;
}

/** Native main-frame broker. Only this owned instance sees an OAuth URL or
 * attempt ID. Public callers cannot provide a URL, callback, token or grant. */
function createProviderConnectionBroker({ call, openExternal }) {
  let attemptId = null,
    preparing = false,
    closed = false,
    generation = 0;
  const status = async () =>
    safeStatus(
      await call("providerConnection", {
        type: "status",
        providerId: PROVIDER,
      }),
    );
  const privateCall = (type, input = {}) =>
    call("providerAuth", { providerId: PROVIDER, type, ...input });
  return {
    async command(input) {
      if (closed) throw Error("provider_connection_closed");
      const descriptors =
        input && typeof input === "object" && !Array.isArray(input)
          ? Object.getOwnPropertyDescriptors(input)
          : {};
      if (
        !Object.hasOwn(descriptors.type ?? {}, "value") ||
        !Object.hasOwn(descriptors.providerId ?? {}, "value")
      )
        throw Error("invalid_provider_connection_request");
      const withVersion = ["disconnect", "refreshSession"].includes(
        input?.type,
      );
      if (
        !exact(
          input,
          withVersion
            ? ["type", "providerId", "expectedVersion"]
            : ["type", "providerId"],
        ) ||
        input.providerId !== PROVIDER ||
        ![
          "status",
          "connect",
          "cancel",
          "disconnect",
          "refreshSession",
          "refreshModels",
        ].includes(input.type) ||
        (withVersion && !version(input.expectedVersion))
      )
        throw Error("invalid_provider_connection_request");
      if (input.type === "status") return status();
      if (input.type === "refreshModels")
        return safeStatus(await call("providerConnection", input));
      if (input.type === "cancel") {
        generation++;
        const current = attemptId;
        attemptId = null;
        if (current) await privateCall("cancel", { attemptId: current });
        return status();
      }
      if (input.type === "disconnect" || input.type === "refreshSession") {
        if (preparing) throw Error("sign_in_in_progress");
        return safeStatus(
          await privateCall(
            input.type === "disconnect" ? "disconnect" : "refresh",
            { expectedVersion: input.expectedVersion },
          ),
        );
      }
      if (preparing) throw Error("sign_in_in_progress");
      if (attemptId && (await status()).pending)
        throw Error("sign_in_in_progress");
      preparing = true;
      const revision = ++generation;
      let started;
      try {
        const candidate = await privateCall("begin");
        if (
          typeof candidate?.attemptId === "string" &&
          /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
            candidate.attemptId,
          )
        )
          started = { attemptId: candidate.attemptId };
        started = authorizationStart(candidate);
        if (closed || revision !== generation) {
          await privateCall("cancel", { attemptId: started.attemptId });
          return status();
        }
        attemptId = started.attemptId;
        await openExternal(started.authorizationUrl);
        if (closed || revision !== generation) {
          await privateCall("cancel", { attemptId: started.attemptId });
          return status();
        }
        // Core starts a caught, privately owned callback completion and returns
        // immediately. No five-minute OAuth listener occupies an RPC timeout.
        return safeStatus(await privateCall("finish", { attemptId }));
      } catch (error) {
        if (started)
          await privateCall("cancel", { attemptId: started.attemptId }).catch(
            () => {},
          );
        attemptId = null;
        throw Error(
          error?.message === "invalid_native_sign_in_destination"
            ? error.message
            : "provider_sign_in_unavailable",
        );
      } finally {
        preparing = false;
      }
    },
    close() {
      closed = true;
      generation++;
      attemptId = null;
    },
  };
}
module.exports = { createProviderConnectionBroker, safeStatus };
