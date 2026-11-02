import {
  CHATGPT_PLAN_PROVIDER,
  type ProviderConnectionRequest,
  type ProviderConnectionStatus,
} from "../../../application-contract/provider-connections.ts";

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = "") => {
  const value = document.createElement(tag);
  value.textContent = text;
  if (tag === "button" || tag === "summary")
    value.dataset.aerynthMotionControl = "true";
  return value;
};

// Presentation accepts the same fixed remote-code vocabulary as the native
// projection. It never renders arbitrary remote errors, URLs or body text.
const catalogCodes = new Set([
  "subscription_sharing_usage_limit_exceeded", "subscription_sharing_usage_unavailable",
  "subscription_sharing_unsupported_capability", "subscription_sharing_route_not_supported",
  "subscription_sharing_invalid_user", "subscription_sharing_user_unavailable",
  "subscription_sharing_user_not_eligible", "chatpass_v2_scope_not_authorized",
  "chatpass_v2_invalid_authorization_context", "invalid_grant", "invalid_refresh_token",
  "token_expired", "refresh_token_expired", "refresh_token_invalidated",
  "refresh_token_reused", "invalid_client", "insufficient_quota", "rate_limit_exceeded", "invalid_api_key",
]);

/** Account controls, never a credential editor. Consent takes place in the
 * official browser; only the native host receives the authorization callback. */
export function mountProviderConnections(
  root: HTMLElement,
  options: {
    command(
      input: ProviderConnectionRequest,
    ): Promise<ProviderConnectionStatus>;
    newConversation(): Promise<void>;
    codex(): Promise<{ authentication: string; models: string[] }>;
    changed?(): void | Promise<void>;
  },
) {
  let current: ProviderConnectionStatus | null = null;
  let disposed = false,
    busy = false,
    connectRequested = false;
  let requestRevision = 0;
  let errorLabel: string | null = null;
  let catalogSignature = "";
  let catalogRecoveryUnconfirmed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const heading = node("h3", "ChatGPT plan"),
    status = node("p", "Checking connection…"),
    actions = node("div"),
    connect = node("button", "Continue with ChatGPT"),
    cancel = node("button", "Cancel sign-in"),
    chat = node("button", "New chat"),
    details = node("details"),
    summary = node("summary", "Connection actions"),
    refresh = node("button", "Refresh models"),
    refreshSession = node("button", "Refresh session"),
    disconnect = node("button", "Disconnect"),
    catalogDetails = node("details"),
    catalogSummary = node("summary", "Model discovery details"),
    catalogFacts = node("dl"),
    boundary = node(
      "p",
      "History is saved in Aerynth. ChatGPT history and account memory are not connected.",
    ),
    codex = node("details"),
    codexSummary = node("summary", "Codex"),
    codexCheck = node("button", "Check installed Codex"),
    codexStatus = node("p");
  root.className = "application-connections";
  actions.className = "connection-actions";
  boundary.className = "connection-boundary";
  catalogDetails.className = "connection-catalog-diagnostic";
  catalogDetails.hidden = true;
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  for (const [button, action] of [
    [connect, "connect"],
    [cancel, "cancel"],
    [chat, "chat"],
    [refresh, "refreshModels"],
    [refreshSession, "refreshSession"],
    [disconnect, "disconnect"],
  ] as const) {
    button.type = "button";
    button.dataset.connectionAction = action;
  }
  codexCheck.type = "button";
  codexStatus.setAttribute("role", "status");
  actions.append(connect, cancel, chat);
  details.append(summary, refresh, refreshSession, disconnect);
  catalogDetails.append(catalogSummary, catalogFacts);
  codex.append(codexSummary, codexCheck, codexStatus);
  root.append(heading, status, actions, boundary, details, catalogDetails, codex);

  const modelsReady = () => current?.state === "ready" &&
    current.planUsageEnabled === true && current.modelCatalog?.state === "ready" && !catalogRecoveryUnconfirmed;
  const modelFailureLabel = () => current?.modelCatalog?.diagnostic.httpStatus === 403
    ? "Signed in. Model discovery was not permitted."
    : current?.modelCatalog?.diagnostic.outcome === "invalid-catalog"
      ? "Signed in. Model discovery returned an unsupported response."
      : "Signed in. Model discovery could not be completed. Use Refresh models to try again.";
  function paintCatalog() {
    const diagnostic = catalogRecoveryUnconfirmed ? undefined : current?.modelCatalog?.diagnostic;
    catalogDetails.hidden = diagnostic?.contract !== "aerynth.model-catalog-diagnostic@1";
    if (catalogDetails.hidden || !diagnostic) { catalogFacts.replaceChildren(); catalogSignature = ""; return; }
    const rows: [string, string][] = [
      ["HTTP", Number.isInteger(diagnostic.httpStatus) && diagnostic.httpStatus! >= 100 && diagnostic.httpStatus! <= 599 ? String(diagnostic.httpStatus) : "Not observed"],
      ["Response shape", ["error", "detail", "models", "data", "other", "invalid-json", "unavailable"].includes(diagnostic.bodyShape) ? diagnostic.bodyShape : "unavailable"],
    ];
    if (typeof diagnostic.remoteCode === "string" && catalogCodes.has(diagnostic.remoteCode)) rows.push(["Code", diagnostic.remoteCode]);
    if (typeof diagnostic.serverRequestId === "string" && /^req_[A-Za-z0-9_-]{1,128}$/.test(diagnostic.serverRequestId)) rows.push(["Request", diagnostic.serverRequestId]);
    const signature = JSON.stringify(rows);
    if (signature !== catalogSignature) { catalogSignature = signature; catalogFacts.replaceChildren(...rows.flatMap(([label, text]) => [node("dt", label), node("dd", text)])); }
  }

  function paint() {
    if (disposed) return;
    root.dataset.connectionState = current?.state ?? "unknown";
    root.dataset.modelCatalogState = catalogRecoveryUnconfirmed ? "unconfirmed" : current?.modelCatalog?.state ?? "unobserved";
    connect.hidden = current?.pending === true || current?.state === "ready";
    cancel.hidden = current?.pending !== true;
    chat.hidden = current?.state !== "ready";
    connect.disabled =
      busy ||
      current?.storageAvailable !== true ||
      current.state === "recovery-required";
    cancel.disabled = busy;
    chat.disabled = busy || !modelsReady();
    refresh.disabled = busy || current?.state !== "ready";
    refreshSession.disabled = busy || current?.registrationVersion == null;
    disconnect.disabled = busy || current?.registrationVersion == null;
    paintCatalog();
    if (!current) {
      if (errorLabel) status.textContent = errorLabel;
      return;
    }
    const labels = {
      unavailable: "Secure connection storage is unavailable.",
      disconnected: "Not connected",
      "identity-only": "Signed in. ChatGPT plan usage has not been granted.",
      ready: current.modelCatalog?.state === "ready"
        ? "Signed in. Models are ready."
        : current.modelCatalog?.state === "unavailable"
          ? modelFailureLabel()
          : "Signed in. Models have not been checked.",
      expired: "Sign in again or refresh this session.",
      "recovery-required":
        "This connection needs native recovery before it can be used.",
    };
    status.textContent =
      errorLabel ??
      (current.pending
        ? "Finish signing in in your browser…"
        : labels[current.state]);
  }
  function schedule() {
    clearTimeout(timer);
    if (!disposed && current?.pending)
      timer = setTimeout(() => {
        void update({
          type: "status",
          providerId: CHATGPT_PLAN_PROVIDER,
        }).catch(failed);
      }, 2000);
  }
  const failed = (_error: unknown) => {
    if (!disposed) {
      errorLabel =
        "The connection could not be completed. Your local conversations are preserved.";
      paint();
    }
  };
  async function notifyChanged(revision: number) {
    if (disposed || revision !== requestRevision) return;
    try { await options.changed?.(); }
    catch {
      if (disposed || revision !== requestRevision || errorLabel) return;
      errorLabel = current?.state === "ready"
        ? "Signed in. Updating the application view did not finish."
        : "Connection state updated. Updating the application view did not finish.";
      paint();
    }
  }
  async function recoverModelFailure(revision: number) {
    if (disposed || revision !== requestRevision) return;
    const recoveryRevision = ++requestRevision;
    catalogRecoveryUnconfirmed = true;
    // One local status read retrieves the native diagnostic. This is neither a
    // model GET retry nor another OAuth/session operation.
    try {
      const value = await options.command({ type: "status", providerId: CHATGPT_PLAN_PROVIDER });
      if (disposed || recoveryRevision !== requestRevision) return;
      current = value;
      catalogRecoveryUnconfirmed = false;
      schedule();
    } catch {
      if (disposed || recoveryRevision !== requestRevision) return;
    }
    errorLabel = current?.state === "ready" ? modelFailureLabel() : "Model discovery could not be completed.";
    paint();
    await notifyChanged(recoveryRevision);
  }
  async function update(input: ProviderConnectionRequest) {
    const revision = ++requestRevision;
    let value: ProviderConnectionStatus;
    try { value = await options.command(input); }
    catch (error) {
      if (disposed || revision !== requestRevision) return null;
      if (input.type === "connect") connectRequested = false;
      if (input.type === "refreshModels") await recoverModelFailure(revision);
      else failed(error);
      return null;
    }
    if (disposed || revision !== requestRevision) return null;
    errorLabel = null;
    current = value;
    catalogRecoveryUnconfirmed = false;
    paint();
    schedule();
    if (!value.pending && connectRequested) {
      connectRequested = false;
      if (value.state === "ready") {
        // This discovery belongs to the user's explicit connect action, never
        // to ordinary history browsing or passive provider-list rendering.
        const wasBusy = busy;
        busy = true;
        paint();
        try {
          await update({ type: "refreshModels", providerId: CHATGPT_PLAN_PROVIDER });
        } finally { busy = wasBusy; paint(); }
      }
    }
    if (!disposed && input.type !== "status" && input.type !== "connect")
      await notifyChanged(revision);
    return value;
  }
  async function run(input: ProviderConnectionRequest) {
    if (disposed || busy) return;
    busy = true;
    paint();
    try {
      await update(input);
    } catch (error) {
      if (input.type === "connect") connectRequested = false;
      failed(error);
    } finally {
      busy = false;
      paint();
    }
  }
  connect.onclick = () => {
    if (disposed || busy || connect.disabled || connect.hidden) return;
    connectRequested = true;
    void run({ type: "connect", providerId: CHATGPT_PLAN_PROVIDER });
  };
  cancel.onclick = () => {
    if (disposed || busy || cancel.disabled || cancel.hidden) return;
    connectRequested = false;
    void run({ type: "cancel", providerId: CHATGPT_PLAN_PROVIDER });
  };
  refresh.onclick = () => {
    if (disposed || busy || refresh.disabled) return;
    void run({ type: "refreshModels", providerId: CHATGPT_PLAN_PROVIDER });
  };
  refreshSession.onclick = () => {
    if (current?.registrationVersion != null)
      void run({
        type: "refreshSession",
        providerId: CHATGPT_PLAN_PROVIDER,
        expectedVersion: current.registrationVersion,
      });
  };
  disconnect.onclick = () => {
    if (current?.registrationVersion != null)
      void run({
        type: "disconnect",
        providerId: CHATGPT_PLAN_PROVIDER,
        expectedVersion: current.registrationVersion,
      });
  };
  chat.onclick = () => {
    if (busy || disposed || !modelsReady()) return;
    void (async () => {
      busy = true;
      paint();
      try {
        const value = await update({
          type: "status",
          providerId: CHATGPT_PLAN_PROVIDER,
        });
        if (!disposed && value && current === value && modelsReady())
          await options.newConversation();
      } catch (error) {
        if (!disposed) { errorLabel = "Signed in. The new chat could not be opened."; paint(); }
      } finally {
        busy = false;
        paint();
      }
    })();
  };
  codexCheck.onclick = () => {
    codexCheck.disabled = true;
    void options
      .codex()
      .then(
        (value) => {
          if (!disposed)
            codexStatus.textContent = `Authentication: ${value.authentication}. ${value.models.length} catalog entries; account access is checked on send.`;
        },
        () => {
          if (!disposed) codexStatus.textContent = "Codex is unavailable.";
        },
      )
      .finally(() => {
        if (!disposed) codexCheck.disabled = false;
      });
  };
  paint();
  const ready = update({
    type: "status",
    providerId: CHATGPT_PLAN_PROVIDER,
  }).catch(failed);
  return {
    ready,
    refresh: () =>
      update({ type: "status", providerId: CHATGPT_PLAN_PROVIDER }),
    dispose() {
      disposed = true;
      requestRevision++;
      connectRequested = false;
      clearTimeout(timer);
    },
  };
}
