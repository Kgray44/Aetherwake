import type {
  VelaActiveCard,
  VelaClient,
  VelaRequest,
  VelaState,
} from "../../../vela-core/src/contracts.ts";
import type { WorkspacePresentationContext } from "../../../application-contract/contracts.ts";

/** Browser transport only. Native main owns provider consent; backend owns identity and state. */
export function createVelaClient(options: {
  command(name: string, input: unknown): Promise<unknown>;
  changed(name: string, result: unknown, mayPresent?: () => boolean): Promise<void>;
  requestRefreshFailed?(): void;
  presentationFence?(): () => boolean;
  observationFence?(): () => boolean;
  observed(state: VelaState): void;
  presentation?(): WorkspacePresentationContext | null;
  activeCard?(): VelaActiveCard | undefined;
}): VelaClient {
  const submit = async (input: unknown): Promise<VelaRequest> => {
    const submissionId = crypto.randomUUID();
    const response = options.command("vela", { name: "request", input, submissionId }) as Promise<VelaRequest>;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const readReceipt = () => options.command("vela", {
      name: "submissionStatus",
      input: { submissionId },
    }).catch(() => null) as Promise<VelaRequest | null>;
    const recovered = new Promise<VelaRequest>((resolve) => {
      async function check() {
        const recorded = await readReceipt();
        if (settled) return;
        if (recorded?.id) resolve(recorded);
        else timer = setTimeout(check, 750);
      }
      timer = setTimeout(check, 750);
    });
    try {
      return await Promise.race([response, recovered]);
    } catch (error) {
      if (error instanceof Error && /(?:^|: )backend_disconnected$/.test(error.message)) {
        settled = true;
        clearTimeout(timer);
        const recorded = await readReceipt();
        if (recorded?.id) return recorded;
      }
      throw error;
    } finally {
      settled = true;
      clearTimeout(timer);
    }
  };
  const invoke = async <T>(name: string, input: unknown): Promise<T> => {
    const mayPresent =
      name === "request" || name === "apply"
        ? options.presentationFence?.()
        : undefined;
    const observing = name === "state" || name === "open";
    const current = observing ? options.observationFence?.() : undefined;
    const presentation = name === "apply" ? options.presentation?.() : null;
    const result = name === "request" ? await submit(input) : await options.command("vela", {
      name,
      input,
      ...(presentation ? { presentation: structuredClone(presentation) } : {}),
    });
    if (observing) {
      if (current && !current()) throw Error("vela_observation_superseded");
      options.observed(result as VelaState);
    }
    if (name === "request" && (result as VelaRequest).state === "responded") {
      // A conversational reply can render independently of workspace hydration.
      void Promise.resolve().then(() => options.changed(name, result, mayPresent)).catch(reportRequestRefreshFailure);
      return result as T;
    }
    if (
      [
        "native",
        "request",
        "fileProposal",
        "pickSources",
        "applyFileEdit",
        "missionFileEdit",
        "hostOperation",
        "verifyFileEdit",
        "reconcileFileEdit",
        "reconcileProviderTurn",
        "apply",
        "review",
        "preferences",
        "reviewAttention",
        "adaptationPolicy",
        "explicitPreference",
        "reviewPreference",
        "resetPreferences",
      ].includes(name)
    ) {
      try {
        await options.changed(name, result, mayPresent);
      } catch (error) {
        if (name !== "request") throw error;
        // The native request receipt remains authoritative if presentation fails.
        reportRequestRefreshFailure();
      }
    }
    return result as T;
  };
  function reportRequestRefreshFailure() {
    try { options.requestRefreshFailed?.(); } catch { /* Feedback cannot invalidate the receipt. */ }
  }
  return {
    hostOperation:input=>invoke('hostOperation',input),
    missionFileEdit:input=>invoke('missionFileEdit',input),
    state: () => invoke("state", {}),
    open: () => invoke("open", {}),
    search: (input) => invoke("search", input),
    presentation: (input) => invoke("presentation", input),
    request: (input) => {
      const activeCard = input.semanticContext ? undefined : options.activeCard?.();
      return invoke("request", activeCard ? { ...input, activeCard } : input);
    },
    native: (input) => invoke("native", input),
    fileProposal: (input) => invoke("fileProposal", input),
    pickSources: (input) => invoke("pickSources", input),
    routingOptions: (input) => invoke("routingOptions", input),
    saveRoutingSettings: (input) => invoke("saveRoutingSettings", input),
    rateRoutingResponse: (input) => invoke("rateRoutingResponse", input),
    applyFileEdit: (input) => invoke("applyFileEdit", input),
    verifyFileEdit: (input) => invoke("verifyFileEdit", input),
    reconcileFileEdit: (input) => invoke("reconcileFileEdit", input),
    reconcileProviderTurn: (input) => invoke("reconcileProviderTurn", input),
    review: (input) => invoke("review", input),
    apply: (input) => invoke("apply", input),
    cancel: (input) => invoke("cancel", input),
    preferences: (input) => invoke("preferences", input),
    reviewAttention: (input) => invoke("reviewAttention", input),
    adaptationPolicy: (input) => invoke("adaptationPolicy", input),
    explicitPreference: (input) => invoke("explicitPreference", input),
    reviewPreference: (input) => invoke("reviewPreference", input),
    resetPreferences: (input) => invoke("resetPreferences", input),
  };
}
