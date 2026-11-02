import {
  CHATGPT_PLAN_PROVIDER,
  type ProviderConnectionRequest,
  type ProviderConnectionStatus,
} from "../../../application-contract/provider-connections.ts";

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = "") => {
  const value = document.createElement(tag);
  value.textContent = text;
  return value;
};

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
  codex.append(codexSummary, codexCheck, codexStatus);
  root.append(heading, status, actions, boundary, details, codex);

  function paint() {
    if (disposed) return;
    connect.hidden = current?.pending === true || current?.state === "ready";
    cancel.hidden = current?.pending !== true;
    chat.hidden = current?.state !== "ready";
    connect.disabled =
      busy ||
      current?.storageAvailable !== true ||
      current.state === "recovery-required";
    cancel.disabled = busy;
    chat.disabled = busy;
    refresh.disabled = busy || current?.state !== "ready";
    refreshSession.disabled = busy || current?.registrationVersion == null;
    disconnect.disabled = busy || current?.registrationVersion == null;
    if (!current) {
      if (errorLabel) status.textContent = errorLabel;
      return;
    }
    const labels = {
      unavailable: "Secure connection storage is unavailable.",
      disconnected: "Not connected",
      "identity-only": "Signed in. ChatGPT plan usage has not been granted.",
      ready: "ChatGPT plan connected",
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
  async function update(input: ProviderConnectionRequest) {
    const revision = ++requestRevision;
    const value = await options.command(input);
    if (disposed || revision !== requestRevision) return value;
    errorLabel = null;
    current = value;
    paint();
    schedule();
    if (!value.pending && connectRequested) {
      connectRequested = false;
      if (value.state === "ready") {
        // This discovery belongs to the user's explicit connect action, never
        // to ordinary history browsing or passive provider-list rendering.
        await update({
          type: "refreshModels",
          providerId: CHATGPT_PLAN_PROVIDER,
        });
      }
    }
    if (!disposed && input.type !== "status" && input.type !== "connect")
      await options.changed?.();
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
    connectRequested = true;
    void run({ type: "connect", providerId: CHATGPT_PLAN_PROVIDER });
  };
  cancel.onclick = () => {
    connectRequested = false;
    void run({ type: "cancel", providerId: CHATGPT_PLAN_PROVIDER });
  };
  refresh.onclick = () => {
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
    if (busy || disposed || current?.state !== "ready") return;
    void (async () => {
      busy = true;
      paint();
      try {
        await update({
          type: "refreshModels",
          providerId: CHATGPT_PLAN_PROVIDER,
        });
        if (!disposed && current?.state === "ready")
          await options.newConversation();
      } catch (error) {
        failed(error);
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
      clearTimeout(timer);
    },
  };
}
